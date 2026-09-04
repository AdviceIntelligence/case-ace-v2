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
import { CloudAsrEngine, CloudSttApiError } from './cloudAsrEngine.ts';
import { planTranscriptionChunks, sliceChunk, type AudioChunk } from './audioChunker.ts';
import { environment } from '../config/environments.ts';
import type { AsrSegment, AsrWord } from '../state/volatileStore.ts';

export const LOW_CONFIDENCE_THRESHOLD = 0.7;

/** Attempts per chunk before the consultation is failed. */
const MAX_CHUNK_ATTEMPTS = 3;

export interface TranscriptionProgress {
  type: 'PROGRESS';
  chunkIndex: number;
  currentChunk?: number;
  totalChunks: number;
  percentage: number;
  progressPercent?: number;
  message?: string;
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
  dataLoggingEnabled: false;
  chunkCount: number;
  /**
   * Speaker labelling is resolved within a chunk but not across chunks, because each request
   * is diarised independently. Words therefore carry 'unknown' and the adviser assigns roles
   * at review. Stated here so the interface and the documentation cannot drift from it.
   */
  speakerAttribution: 'per_chunk_unresolved';
  hardwareBackend?: 'webgpu' | 'wasm';
  routeSpeakerSource?: 'webex_channel_split' | 'inferred_acoustic_diarisation';
}


export class TranscriptionFailedError extends Error {
  public readonly chunkIndex: number;
  public readonly startSeconds: number;
  public readonly endSeconds: number;

  constructor(chunk: AudioChunk, cause: string) {
    const from = Math.round(chunk.startSeconds);
    const to = Math.round(chunk.endSeconds);
    super(
      `Transcription failed for the audio between ${from}s and ${to}s after ${MAX_CHUNK_ATTEMPTS} ` +
        `attempts: ${cause}. The consultation has not been transcribed. No partial transcript is ` +
        `produced, because a silently missing passage could hide an identifier from review.`,
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
  private readonly credentialSource: CloudAsrEngine;

  constructor(credentialSource: CloudAsrEngine = new CloudAsrEngine()) {
    this.credentialSource = credentialSource;
  }

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
      dataLoggingEnabled: false,
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
  private async createGoogleRecognizer(authToken?: string): Promise<RecognizeChunkFn> {
    const creds = await this.credentialSource.obtainEphemeralCredential(authToken);
    const phraseSet = buildCloudSttPhraseSet();
    const url =
      `${creds.endpoint}/v2/projects/${creds.projectId}/locations/${environment.gcpRegion}` +
      `/recognizers/_:recognize`;

    return async (wavBuffer: ArrayBuffer) => {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${creds.accessToken}`,
          'X-Goog-User-Project': creds.projectId,
        },
        body: JSON.stringify({
          config: {
            features: {
              enableAutomaticPunctuation: true,
              enableWordTimeOffsets: true,
              enableWordConfidence: true,
            },
            model: 'latest_long',
            languageCodes: ['en-GB'],
            adaptation: { phraseSets: [{ inlinePhraseSet: phraseSet }] },
            dataLoggingConfig: { enableDataLogging: false },
          },
          content: encodeBase64(wavBuffer),
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}) as any);
        throw new CloudSttApiError(
          `Speech-to-Text v2 returned ${response.status}: ${body?.error?.message || response.statusText}`,
          response.status,
          response.status >= 500 || response.status === 429,
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

