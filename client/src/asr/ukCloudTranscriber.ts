/**
 * ukCloudTranscriber
 *
 * The transcription stage. Sends a consultation's audio to Google Speech-to-Text v2 in
 * europe-west2 (London), in chunks small enough for the synchronous `recognize` method, and
 * stitches the results into one transcript with word-level timings.
 *
 * What this replaced, and why
 * ---------------------------
 * The previous Pass One claimed to run Whisper in the browser. It did not: it detected speech
 * energy and then fabricated words named `token_1_1`, `token_1_2` and so on. No speech
 * recognition library was ever present in the project. On-device transcription was abandoned
 * rather than completed, for two reasons:
 *
 *   1. It contradicts Constraint C1. Browser inference runtimes cache model weights in Cache
 *      Storage or IndexedDB, both of which storageGuard.ts deletes on start-up. The model
 *      could not be cached, so every consultation would begin with a 40MB to 250MB download.
 *   2. Browser-sized models are weakest on proper nouns, spelled letters and dictated digits,
 *      which are exactly the identifiers the redaction stage exists to catch. A local pass
 *      would have been least reliable precisely where it mattered most.
 *
 * What is claimed now
 * -------------------
 * Audio leaves the device. It goes to a UK region, with data logging explicitly disabled, and
 * nothing is retained. It is never written to disk at either end: chunking exists so that the
 * audio never has to be staged in Cloud Storage, which `batchRecognize` would require. The
 * privacy control that survives is the one after this stage: identifiers are removed from the
 * transcript, and the adviser confirms that, before any text reaches the drafting model.
 */

import { audioRedactionEngine } from '../audio/audioRedactionEngine.ts';
import { buildCloudSttPhraseSet } from './adviceSectorPhraseSet.ts';
import { planTranscriptionChunks, sliceChunk, type AudioChunk } from './audioChunker.ts';
import { environment } from '../config/environments.ts';
import { volatileAuthStore } from '../state/authStore.ts';
import type { AsrSegment, AsrWord } from '../state/volatileStore.ts';

export const LOW_CONFIDENCE_THRESHOLD = 0.7;

/** Attempts per chunk before the consultation is failed. */
const MAX_CHUNK_ATTEMPTS = 3;

export interface TranscriptionProgress {
  type: 'PROGRESS';
  chunkIndex: number;
  totalChunks: number;
  percentage: number;
  processedSeconds: number;
  totalSeconds: number;
  elapsedMs: number;
  estimatedRemainingMs: number;
  currentSegmentPreview: string;
}

export type TranscribeProgress = TranscriptionProgress;

export interface TranscriptionResult {
  segments: AsrSegment[];
  fullTranscript: string;
  totalWords: number;
  lowConfidenceWordsCount: number;
  lowConfidenceWords: AsrWord[];
  executionDurationMs: number;
  /** Where the words came from. Recorded so no reader has to infer it. */
  provider: 'google_stt_v2';
  region: string;
  /**
   * Google does not log customer audio or transcripts unless a project opts in to the data
   * logging programme. This project has not, which is a project setting rather than
   * anything this request can assert.
   */
  dataLoggingOptedIn: false;
  chunkCount: number;
  /**
   * Speaker labelling is resolved within a chunk but not across chunks, because each request
   * is diarised independently. Words therefore carry 'unknown' and the adviser assigns roles
   * at review. Stated here so the interface and the documentation cannot drift from it.
   */
  speakerAttribution: 'per_chunk_unresolved';
}

export class CloudSttApiError extends Error {
  public readonly status: number;
  public readonly isRetryable: boolean;

  constructor(message: string, status: number = 500, isRetryable: boolean = false) {
    super(message);
    this.name = 'CloudSttApiError';
    this.status = status;
    this.isRetryable = isRetryable;
  }
}

interface EphemeralCredential {
  purpose: 'speech-to-text';
  provider: string;
  region: string;
  projectId: string;
  endpoint: string;
  accessToken: string;
  expiresAt: string;
  ttlSeconds: number;
  issuedToUser: string;
  role: string;
}

/**
 * Keeps a usable Speech-to-Text credential available for as long as the consultation runs.
 *
 * The credential lasts five minutes. A single credential was minted once, before the first
 * chunk, and reused for every chunk after it. An hour of audio is roughly sixty-five chunks,
 * so from about minute five onward every request came back 401 and the whole consultation
 * failed. An adviser would have lost an hour of a client's time, and the client would have to
 * be asked to say it all again.
 *
 * The adviser's own session token expires too, after fifteen minutes, at which point the
 * credential endpoint itself answers 401. That is refreshed here as well, once, rather than
 * ending the consultation.
 */
export class SpeechCredentialProvider {
  /** Re-mint this long before expiry, so a request in flight never uses a dead token. */
  private static readonly RENEW_MARGIN_MS = 60_000;

  private current: EphemeralCredential | null = null;
  private currentExpiresAtMs = 0;
  private hasRefreshedSession = false;

  public async get(): Promise<EphemeralCredential> {
    const stillGood =
      this.current && Date.now() < this.currentExpiresAtMs - SpeechCredentialProvider.RENEW_MARGIN_MS;
    if (stillGood) return this.current!;

    this.current = await this.mint();
    const expiry = Date.parse(this.current.expiresAt);
    this.currentExpiresAtMs = Number.isFinite(expiry)
      ? expiry
      : Date.now() + (this.current.ttlSeconds || 300) * 1000;
    return this.current;
  }

  /** Called when Google rejects a token, so the next attempt fetches a fresh one. */
  public invalidate(): void {
    this.current = null;
    this.currentExpiresAtMs = 0;
  }

  private async mint(): Promise<EphemeralCredential> {
    let response = await this.requestCredential();

    // 401 here is the adviser's session, not the Google token. Refresh it once and retry,
    // rather than losing a consultation because the login aged out mid-interview.
    if (response.status === 401 && !this.hasRefreshedSession) {
      this.hasRefreshedSession = true;
      if (await refreshAdviserSession()) {
        response = await this.requestCredential();
      }
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({}) as any);
      throw new CloudSttApiError(
        `Could not get permission to transcribe (${response.status}): ` +
          `${body?.error || response.statusText}`,
        response.status,
        response.status >= 500 || response.status === 429 || response.status === 401,
      );
    }

    return parseCredentialResponse(await response.json(), response.status);
  }

  private async requestCredential(): Promise<Response> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = volatileAuthStore.getAccessToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    return fetch(`${environment.apiBaseUrl}/api/v1/credentials/issue`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ purpose: 'speech-to-text', ttlSeconds: 300 }),
    });
  }
}

/** Exchanges the refresh token for a new session. Returns false if it cannot. */
async function refreshAdviserSession(): Promise<boolean> {
  const refreshToken = volatileAuthStore.getRefreshToken();
  if (!refreshToken) return false;

  try {
    const response = await fetch(`${environment.apiBaseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) return false;

    const data = await response.json();
    if (!data?.accessToken) return false;

    volatileAuthStore.setTokens(data.accessToken, data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates that a credential response carries what this client needs, and says what is
 * missing when it does not. Exported for the contract test, which feeds it the exact object
 * the backend route serialises.
 */
function parseCredentialResponse(body: unknown, status = 200): EphemeralCredential {
  const credential = (body ?? {}) as Partial<EphemeralCredential>;

  const missing = (['accessToken', 'endpoint', 'projectId'] as const).filter(
    (field) => typeof credential[field] !== 'string' || credential[field] === '',
  );
  if (missing.length > 0) {
    throw new CloudSttApiError(
      'The credential service returned a response this client cannot use: ' +
        `${missing.join(', ')} missing. Transcription cannot start.`,
      status,
      false,
    );
  }

  return credential as EphemeralCredential;
}

export const parseCredentialResponseForTesting = parseCredentialResponse;


/**
 * Speech-to-Text v2 model identifiers. `latest_long` is a v1 name and v2 rejects it.
 * `long` is the general purpose long-form model, supported for en-GB on the European
 * endpoints, with automatic punctuation, word timings and word confidence.
 * https://docs.cloud.google.com/speech-to-text/docs/transcription-model
 */
export const STT_V2_MODEL = 'long';

/**
 * Fields RecognitionConfig actually has in speech.v2. Anything outside this set makes Google
 * reject the whole request with "Invalid JSON payload received. Unknown name ... Cannot find
 * field", which is what happened with an invented `dataLoggingConfig`.
 * https://docs.cloud.google.com/speech-to-text/docs/reference/rpc/google.cloud.speech.v2
 */
export const RECOGNITION_CONFIG_FIELDS = [
  'autoDecodingConfig',
  'explicitDecodingConfig',
  'model',
  'languageCodes',
  'features',
  'adaptation',
  'transcriptNormalization',
  'translationConfig',
] as const;

/**
 * Builds the RecognitionConfig for one chunk.
 *
 * On data logging: there is no per-request switch, and the request used to carry an invented
 * `dataLoggingConfig` that made Google reject every consultation. Google does not log
 * customer audio or transcripts by default; logging is an opt-in programme enabled per
 * project, in exchange for discounted pricing. The control is therefore "this project has
 * not opted in", which is a project setting to be evidenced in the DPIA, not a flag this
 * code can set. https://docs.cloud.google.com/speech-to-text/docs/v1/data-logging
 */
export function buildRecognitionConfig(phraseSet: unknown): Record<string, unknown> {
  return {
    // The audio is sent as LINEAR16 WAV, so the RIFF header carries the encoding, sample rate
    // and channel count. Without a decoding config the request is rejected outright.
    autoDecodingConfig: {},
    model: STT_V2_MODEL,
    languageCodes: ['en-GB'],
    features: {
      enableAutomaticPunctuation: true,
      enableWordTimeOffsets: true,
      enableWordConfidence: true,
    },
    adaptation: { phraseSets: [{ inlinePhraseSet: phraseSet }] },
  };
}

export class TranscriptionFailedError extends Error {
  public readonly chunkIndex: number;
  public readonly startSeconds: number;
  public readonly endSeconds: number;

  constructor(chunk: AudioChunk, cause: string) {
    const from = Math.round(chunk.startSeconds);
    const to = Math.round(chunk.endSeconds);
    super(
      `Could not transcribe the audio between ${from}s and ${to}s after ${MAX_CHUNK_ATTEMPTS} ` +
        `attempts: ${cause}\n\n` +
        'Your recording is safe and still open in this session. Nothing has been lost, and you ' +
        'can try again. No part of the transcript is kept, because a silently missing passage ' +
        'could hide a personal detail from your check.',
    );
    this.name = 'TranscriptionFailedError';
    this.chunkIndex = chunk.index;
    this.startSeconds = chunk.startSeconds;
    this.endSeconds = chunk.endSeconds;
  }
}

/** Injectable so tests can drive the stitching without a network or a Google account. */
export type RecognizeChunkFn = (
  wavBuffer: ArrayBuffer,
  chunk: AudioChunk,
) => Promise<{ results?: unknown[] }>;

interface ParsedWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
}

/** Google returns durations as "1.200s". Absent values mean the start of the chunk. */
function parseGoogleDuration(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string' || value.length === 0) return 0;
  const seconds = parseFloat(value.endsWith('s') ? value.slice(0, -1) : value);
  return Number.isFinite(seconds) ? seconds : 0;
}

export class UkCloudTranscriber {
  constructor() {}

  /**
   * Transcribes a whole consultation. Throws rather than returning a partial transcript.
   */
  public async transcribe(
    pcm: Float32Array,
    sampleRate: number,
    options: {
      authToken?: string;
      onProgress?: (progress: TranscriptionProgress) => void;
      recognizeChunk?: RecognizeChunkFn;
    } = {},
  ): Promise<TranscriptionResult> {
    const startedAt = Date.now();
    const chunks = planTranscriptionChunks(pcm, sampleRate);
    const totalSeconds = pcm.length / sampleRate;

    const recognize =
      options.recognizeChunk ?? (await this.createGoogleRecognizer(options.authToken));

    const segments: AsrSegment[] = [];
    const lowConfidenceWords: AsrWord[] = [];
    const transcriptParts: string[] = [];
    let totalWords = 0;

    for (const chunk of chunks) {
      const wav = audioRedactionEngine.encodeLinear16Wav(sliceChunk(pcm, chunk), sampleRate);
      const response = await this.recognizeWithRetries(recognize, wav, chunk);
      const words = this.extractWords(response);

      const chunkSegment = this.buildSegment(chunk, words);
      if (chunkSegment) {
        segments.push(chunkSegment);
        transcriptParts.push(chunkSegment.text);
        totalWords += chunkSegment.words.length;
        for (const word of chunkSegment.words) {
          if (word.isLowConfidence) lowConfidenceWords.push(word);
        }
      }

      options.onProgress?.(this.buildProgress(chunk, chunks, totalSeconds, startedAt, chunkSegment));
    }

    return {
      segments,
      fullTranscript: transcriptParts.join(' ').trim(),
      totalWords,
      lowConfidenceWordsCount: lowConfidenceWords.length,
      lowConfidenceWords,
      executionDurationMs: Date.now() - startedAt,
      provider: 'google_stt_v2',
      region: environment.gcpRegion,
      dataLoggingOptedIn: false,
      chunkCount: chunks.length,
      speakerAttribution: 'per_chunk_unresolved',
    };
  }

  private async recognizeWithRetries(
    recognize: RecognizeChunkFn,
    wav: ArrayBuffer,
    chunk: AudioChunk,
  ): Promise<{ results?: unknown[] }> {
    let lastError = 'unknown error';

    for (let attempt = 1; attempt <= MAX_CHUNK_ATTEMPTS; attempt++) {
      try {
        return await recognize(wav, chunk);
      } catch (err: any) {
        lastError = err?.message || String(err);
        const retryable = !(err instanceof CloudSttApiError) || err.isRetryable;
        if (!retryable || attempt === MAX_CHUNK_ATTEMPTS) break;
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
      }
    }

    throw new TranscriptionFailedError(chunk, lastError);
  }

  private extractWords(response: { results?: unknown[] }): ParsedWord[] {
    const words: ParsedWord[] = [];
    if (!Array.isArray(response?.results)) return words;

    for (const result of response.results as any[]) {
      const alternative = result?.alternatives?.[0];
      if (!alternative) continue;

      if (Array.isArray(alternative.words) && alternative.words.length > 0) {
        for (const w of alternative.words) {
          const text = (w.word ?? '').toString().trim();
          if (!text) continue;
          words.push({
            word: text,
            start: parseGoogleDuration(w.startOffset ?? w.startTime),
            end: parseGoogleDuration(w.endOffset ?? w.endTime),
            confidence: typeof w.confidence === 'number' ? w.confidence : 0,
          });
        }
        continue;
      }

      // Word timings are requested, but a result may still arrive without them. Keeping the
      // text with zero timings is better than discarding what the client actually said; the
      // redaction review still shows it, it just cannot be scrubbed to.
      const transcript = (alternative.transcript ?? '').toString().trim();
      if (transcript) {
        for (const text of transcript.split(/\s+/)) {
          words.push({ word: text, start: 0, end: 0, confidence: alternative.confidence ?? 0 });
        }
      }
    }

    return words;
  }

  /** Converts one chunk's words into a segment, shifting timings into consultation time. */
  private buildSegment(chunk: AudioChunk, parsed: ParsedWord[]): AsrSegment | null {
    if (parsed.length === 0) return null;

    const words: AsrWord[] = parsed.map((w) => {
      const isLowConfidence = w.confidence < LOW_CONFIDENCE_THRESHOLD;
      return {
        word: w.word,
        start: Math.round((chunk.startSeconds + w.start) * 100) / 100,
        end: Math.round((chunk.startSeconds + w.end) * 100) / 100,
        confidence: w.confidence,
        speaker: 'unknown',
        isLowConfidence,
        escalateToAdviserReview: isLowConfidence,
      };
    });

    const avgConfidence =
      words.reduce((sum, w) => sum + w.confidence, 0) / Math.max(1, words.length);

    return {
      id: `seg-${chunk.index + 1}`,
      start: Math.round(chunk.startSeconds * 100) / 100,
      end: Math.round(chunk.endSeconds * 100) / 100,
      speaker: 'unknown',
      text: words.map((w) => w.word).join(' '),
      words,
      avgConfidence: Math.round(avgConfidence * 100) / 100,
      hasLowConfidenceWords: words.some((w) => w.isLowConfidence),
    };
  }

  private buildProgress(
    chunk: AudioChunk,
    chunks: AudioChunk[],
    totalSeconds: number,
    startedAt: number,
    segment: AsrSegment | null,
  ): TranscriptionProgress {
    const processedSeconds = chunk.endSeconds;
    const elapsedMs = Date.now() - startedAt;
    const rate = processedSeconds > 0 ? elapsedMs / processedSeconds : 0;

    return {
      type: 'PROGRESS',
      chunkIndex: chunk.index,
      totalChunks: chunks.length,
      percentage: Math.min(100, Math.round((processedSeconds / totalSeconds) * 100)),
      processedSeconds: Math.round(processedSeconds * 10) / 10,
      totalSeconds: Math.round(totalSeconds * 10) / 10,
      elapsedMs,
      estimatedRemainingMs: Math.round(Math.max(0, totalSeconds - processedSeconds) * rate),
      currentSegmentPreview: segment ? segment.text.substring(0, 60) : '',
    };
  }

  /**
   * Builds the real Google recogniser: one short-lived credential reused across every chunk of
   * the consultation, so a 40 minute session mints one token rather than forty.
   */
  private async createGoogleRecognizer(_authToken?: string): Promise<RecognizeChunkFn> {
    const credentials = new SpeechCredentialProvider();
    const phraseSet = buildCloudSttPhraseSet();

    // A credential is resolved per chunk rather than once per consultation, so a five minute
    // token cannot end a sixty minute interview. The provider hands back the cached one until
    // it is close to expiry, so a normal session still mints a handful, not one per chunk.
    return async (wavBuffer: ArrayBuffer) => {
      const creds = await credentials.get();
      const url =
        `${creds.endpoint}/v2/projects/${creds.projectId}/locations/${environment.gcpRegion}` +
        `/recognizers/_:recognize`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${creds.accessToken}`,
          'X-Goog-User-Project': creds.projectId,
        },
        body: JSON.stringify({
          config: buildRecognitionConfig(phraseSet),
          content: encodeBase64(wavBuffer),
        }),
      });

      if (!response.ok) {
        // A rejected token must not end the consultation: drop it so the retry mints a new one.
        if (response.status === 401 || response.status === 403) credentials.invalidate();

        const body = await response.json().catch(() => ({}) as any);
        throw new CloudSttApiError(
          `Speech-to-Text returned ${response.status}: ${body?.error?.message || response.statusText}`,
          response.status,
          response.status >= 500 ||
            response.status === 429 ||
            response.status === 401 ||
            response.status === 403,
        );
      }

      return response.json();
    };
  }
}

/** Base64 without touching disk or a Blob URL. */
function encodeBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const blockSize = 0x8000; // avoids blowing the argument limit on long recordings
  for (let i = 0; i < bytes.length; i += blockSize) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + blockSize)) as any);
  }
  return btoa(binary);
}

export const ukCloudTranscriber = new UkCloudTranscriber();
export type UkCloudTranscriberError = TranscriptionFailedError;

