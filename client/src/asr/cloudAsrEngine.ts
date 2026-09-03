/**
 * cloudAsrEngine.ts
 * 
 * Pass Two: Google Cloud Speech-to-Text v2 Client Engine
 * Pinned Region: europe-west2 (London)
 * 
 * Enforces Constitutional Privacy & Security Constraints:
 * - Constraint C4: Enforces in code that ONLY verified, redacted audio can ever be transmitted.
 * - Constraint C1: Processes audio and transcripts strictly in volatile RAM.
 * - Data Logging: Explicitly disabled (enableDataLogging: false).
 * - Ephemeral Credentials: Uses short-lived, downscoped STS credentials issued per-operation.
 * - Domain Adaptation: Applies UK Advice Sector phrase set covering statutory welfare, housing, and debt terms.
 * - Failure Discipline: Never silently falls back to local transcript.
 */

import { volatileSessionStore, type SessionState, type CloudAsrResult, type CloudAsrSegment, type CloudAsrWord } from '../state/volatileStore.ts';
import { buildCloudSttPhraseSet, ADVICE_SECTOR_PHRASE_SET_VERSION } from './adviceSectorPhraseSet.ts';
import { logSecurityEvent } from '../monitoring/eventLogger.ts';
import { environment } from '../config/environments.ts';

export class UnauthorizedAudioTransmissionError extends Error {
  constructor(message: string) {
    super(`[SECURITY VIOLATION] Unauthorized Audio Transmission Blocked: ${message}`);
    this.name = 'UnauthorizedAudioTransmissionError';
  }
}

export class CloudSttApiError extends Error {
  public readonly statusCode?: number;
  public readonly isRetryable: boolean;

  constructor(message: string, statusCode?: number, isRetryable: boolean = true) {
    super(message);
    this.name = 'CloudSttApiError';
    this.statusCode = statusCode;
    this.isRetryable = isRetryable;
  }
}

export interface CloudSttConfig {
  backendBaseUrl: string;
  gcpRegion: string;
  projectId: string;
  languageCode: 'en-GB';
  model: string;
  enableDataLogging: boolean; // MUST be false
}

// The backend lives on its own subdomain (api.caseace...), not on the SPA origin.
// Deriving both values from the environment config keeps a single source of truth and
// prevents the credential request being sent to the SPA host, where the SPA rewrite
// would answer it with index.html instead of JSON.
export const DEFAULT_CLOUD_STT_CONFIG: CloudSttConfig = {
  backendBaseUrl: environment.apiBaseUrl,
  gcpRegion: environment.gcpRegion,
  projectId: environment.gcpProjectId,
  languageCode: 'en-GB',
  model: 'latest_long',
  enableDataLogging: false,
};

export class CloudAsrEngine {
  private config: CloudSttConfig;

  constructor(config: Partial<CloudSttConfig> = {}) {
    this.config = {
      ...DEFAULT_CLOUD_STT_CONFIG,
      ...config,
      // Force invariant: data logging can NEVER be enabled
      enableDataLogging: false,
    };
  }

  /**
   * Pre-Transmission Verification Invariant (Constraint C4):
   * Asserts that only verified redacted audio is transmittable.
   * Throws UnauthorizedAudioTransmissionError if unredacted or unverified state is detected.
   */
  public assertTransmissionAuthorization(session: Readonly<SessionState>): void {
    if (!session) {
      throw new UnauthorizedAudioTransmissionError('No active consultation session found in volatile RAM.');
    }

    if (!session.isGatePassed) {
      throw new UnauthorizedAudioTransmissionError(
        'Phase 9 Adviser Redaction Review Gate has NOT been passed and signed.'
      );
    }

    if (!session.isAudioRedactedAndVerified) {
      throw new UnauthorizedAudioTransmissionError(
        'Phase 10 Audio Redaction and Verification Pass has NOT been completed.'
      );
    }

    if (session.rawAudioBuffer !== null) {
      throw new UnauthorizedAudioTransmissionError(
        'Original unredacted audio buffer is still present in memory. Transmission forbidden per C4.'
      );
    }

    if (!session.redactedAudioWavBuffer || session.redactedAudioWavBuffer.byteLength === 0) {
      throw new UnauthorizedAudioTransmissionError(
        'No verified redacted LINEAR16 WAV audio buffer found in volatile memory.'
      );
    }
  }

  /**
   * Requests a short-lived, single-purpose downscoped credential from backend.
   */
  public async obtainEphemeralCredential(authToken?: string): Promise<{
    accessToken: string;
    endpoint: string;
    projectId: string;
    expiresAt: string;
  }> {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const response = await fetch(`${this.config.backendBaseUrl}/api/v1/credentials/issue`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          purpose: 'speech-to-text',
          ttlSeconds: 300, // 5 minutes
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new CloudSttApiError(
          `Failed to obtain short-lived STT credentials: ${errorData.error || response.statusText}`,
          response.status,
          response.status >= 500 || response.status === 429
        );
      }

      const data = await response.json();
      return {
        accessToken: data.accessToken,
        endpoint: data.endpoint || `https://${this.config.gcpRegion}-speech.googleapis.com`,
        projectId: data.projectId || this.config.projectId,
        expiresAt: data.expiresAt,
      };
    } catch (err: any) {
      if (err instanceof CloudSttApiError) throw err;
      throw new CloudSttApiError(`Network error obtaining cloud credentials: ${err.message}`, 0, true);
    }
  }

  /**
   * Converts ArrayBuffer to Base64 in browser without writing to disk.
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Transmits verified redacted audio to Cloud Speech-to-Text v2 in europe-west2.
   */
  public async transcribeVerifiedAudio(
    session: Readonly<SessionState>,
    authToken?: string,
    targetStore: typeof volatileSessionStore = volatileSessionStore
  ): Promise<CloudAsrResult> {
    const startTime = Date.now();

    // 1. Mandatory Pre-Transmission Security Assertion
    this.assertTransmissionAuthorization(session);

    // 2. Obtain short-lived STS credential
    const creds = await this.obtainEphemeralCredential(authToken);

    // 3. Prepare Cloud STT v2 API Request Payload
    const phraseSet = buildCloudSttPhraseSet();
    const audioBase64 = this.arrayBufferToBase64(session.redactedAudioWavBuffer!);

    const sttV2Payload = {
      config: {
        features: {
          enableAutomaticPunctuation: true,
          enableWordTimeOffsets: true,
          enableWordConfidence: true,
          diarizationConfig: {
            minSpeakerCount: 2,
            maxSpeakerCount: 2,
          },
        },
        model: this.config.model,
        languageCodes: [this.config.languageCode],
        adaptation: {
          phraseSets: [
            {
              inlinePhraseSet: phraseSet,
            },
          ],
        },
        // Invariant: data logging explicitly false
        dataLoggingConfig: {
          enableDataLogging: false,
        },
      },
      content: audioBase64,
    };

    const targetUrl = `${creds.endpoint}/v2/projects/${creds.projectId}/locations/${this.config.gcpRegion}/recognizers/_:recognize`;

    try {
      // In browser development/test mock environment or live endpoint
      let resultData: any;

      if (creds.accessToken.startsWith('gcp_sts_') && (this.config.backendBaseUrl.includes('localhost') || typeof window === 'undefined' || (window as any).__MOCK_STT__)) {
        // High-fidelity statutory mock transcript for development and automated test suites
        resultData = this.generateHighAccuracyAdviceTranscript(session);
      } else {
        // Direct Cloud API Execution
        const response = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${creds.accessToken}`,
            'X-Goog-User-Project': creds.projectId,
          },
          body: JSON.stringify(sttV2Payload),
        });

        if (!response.ok) {
          const errBody = await response.json().catch(() => ({}));
          throw new CloudSttApiError(
            `Google Cloud Speech-to-Text v2 error (${response.status}): ${errBody.error?.message || response.statusText}`,
            response.status,
            response.status >= 500 || response.status === 429
          );
        }

        resultData = await response.json();
      }

      const parsedResult = this.parseCloudSttResponse(resultData, Date.now() - startTime);

      // 4. Save result into Volatile Session Store
      targetStore.setCloudAsrResult(parsedResult);

      logSecurityEvent({
        type: 'cloud_stt_transcription_completed',
        details: {
          durationMs: parsedResult.requestDurationMs,
          totalWords: parsedResult.totalWords,
          avgConfidence: parsedResult.avgConfidence,
          segmentsCount: parsedResult.segments.length,
          region: parsedResult.region,
          dataLoggingEnabled: parsedResult.dataLoggingEnabled,
        },
      });

      return parsedResult;
    } catch (err: any) {
      const errorMessage = err.message || 'Unknown error occurred during Cloud Speech-to-Text v2 processing.';
      targetStore.setCloudSttFailure(errorMessage);

      logSecurityEvent({
        type: 'cloud_stt_transcription_failed',
        details: {
          errorMessage,
          statusCode: err.statusCode || 0,
          isRetryable: err.isRetryable !== false,
        },
      });

      throw err;
    }
  }

  /**
   * Parses Google Cloud Speech-to-Text v2 JSON response into structured CloudAsrResult.
   */
  public parseCloudSttResponse(data: any, durationMs: number): CloudAsrResult {
    const segments: CloudAsrSegment[] = [];
    let fullTranscript = '';
    let totalConfidenceSum = 0;
    let totalWordCount = 0;

    if (data.results && Array.isArray(data.results)) {
      data.results.forEach((res: any, idx: number) => {
        const alt = res.alternatives?.[0];
        if (!alt) return;

        const text = alt.transcript || '';
        if (text) {
          fullTranscript += (fullTranscript ? ' ' : '') + text.trim();
        }

        const words: CloudAsrWord[] = [];
        if (alt.words && Array.isArray(alt.words)) {
          alt.words.forEach((w: any) => {
            const startSec = this.parseDurationToSeconds(w.startOffset);
            const endSec = this.parseDurationToSeconds(w.endOffset);
            const confidence = typeof w.confidence === 'number' ? w.confidence : 0.95;
            const speakerTag = w.speakerTag || (idx % 2 === 0 ? 1 : 2);

            words.push({
              word: w.word,
              startSec,
              endSec,
              confidence,
              speakerTag,
            });

            totalConfidenceSum += confidence;
            totalWordCount++;
          });
        }

        // Determine dominant speaker for segment
        const speakerTag = words[0]?.speakerTag || (idx % 2 === 0 ? 1 : 2);
        const speaker = speakerTag === 1 ? 'adviser' : 'client';

        segments.push({
          id: `cloud_seg_${idx + 1}`,
          speaker,
          speakerTag,
          startSec: words[0]?.startSec || 0,
          endSec: words[words.length - 1]?.endSec || 0,
          text: text.trim(),
          words,
          avgConfidence: alt.confidence || (words.length > 0 ? words.reduce((acc, w) => acc + w.confidence, 0) / words.length : 0.95),
        });
      });
    }

    const avgConfidence = totalWordCount > 0 ? totalConfidenceSum / totalWordCount : 0.95;

    return {
      segments,
      fullTranscript,
      totalWords: totalWordCount,
      avgConfidence: Number(avgConfidence.toFixed(3)),
      requestDurationMs: durationMs,
      languageCode: 'en-GB',
      modelUsed: this.config.model,
      dataLoggingEnabled: false,
      phraseSetVersion: ADVICE_SECTOR_PHRASE_SET_VERSION,
      region: 'europe-west2',
    };
  }

  private parseDurationToSeconds(duration: string | number | undefined): number {
    if (typeof duration === 'number') return duration;
    if (typeof duration === 'string') {
      // Formats like "1.200s" or "12.5s"
      return parseFloat(duration.replace('s', '')) || 0;
    }
    return 0;
  }

  /**
   * Generates high-accuracy statutory British English transcript for mock/dev environment
   * correctly incorporating surrogate tokens and domain terminology.
   */
  private generateHighAccuracyAdviceTranscript(_session: Readonly<SessionState>): any {
    return {
      results: [
        {
          alternatives: [
            {
              transcript: "Good morning. Welcome to Citizens Advice Wandsworth. My name is [ADVISER_NAME_1] and I will be advising you today.",
              confidence: 0.98,
              words: [
                { word: "Good", startOffset: "0.2s", endOffset: "0.5s", confidence: 0.99, speakerTag: 1 },
                { word: "morning.", startOffset: "0.5s", endOffset: "1.0s", confidence: 0.99, speakerTag: 1 },
                { word: "Welcome", startOffset: "1.1s", endOffset: "1.5s", confidence: 0.98, speakerTag: 1 },
                { word: "to", startOffset: "1.5s", endOffset: "1.6s", confidence: 0.99, speakerTag: 1 },
                { word: "Citizens", startOffset: "1.6s", endOffset: "2.0s", confidence: 0.99, speakerTag: 1 },
                { word: "Advice", startOffset: "2.0s", endOffset: "2.3s", confidence: 0.99, speakerTag: 1 },
                { word: "Wandsworth.", startOffset: "2.3s", endOffset: "3.0s", confidence: 0.99, speakerTag: 1 },
                { word: "My", startOffset: "3.2s", endOffset: "3.4s", confidence: 0.98, speakerTag: 1 },
                { word: "name", startOffset: "3.4s", endOffset: "3.6s", confidence: 0.99, speakerTag: 1 },
                { word: "is", startOffset: "3.6s", endOffset: "3.8s", confidence: 0.98, speakerTag: 1 },
                { word: "[ADVISER_NAME_1]", startOffset: "3.8s", endOffset: "4.5s", confidence: 0.95, speakerTag: 1 },
                { word: "and", startOffset: "4.6s", endOffset: "4.8s", confidence: 0.99, speakerTag: 1 },
                { word: "I", startOffset: "4.8s", endOffset: "4.9s", confidence: 0.99, speakerTag: 1 },
                { word: "will", startOffset: "4.9s", endOffset: "5.1s", confidence: 0.98, speakerTag: 1 },
                { word: "be", startOffset: "5.1s", endOffset: "5.2s", confidence: 0.99, speakerTag: 1 },
                { word: "advising", startOffset: "5.2s", endOffset: "5.6s", confidence: 0.98, speakerTag: 1 },
                { word: "you", startOffset: "5.6s", endOffset: "5.8s", confidence: 0.99, speakerTag: 1 },
                { word: "today.", startOffset: "5.8s", endOffset: "6.2s", confidence: 0.99, speakerTag: 1 },
              ],
            },
          ],
        },
        {
          alternatives: [
            {
              transcript: "Thank you. My name is [CLIENT_NAME_1]. I received a Section 21 notice seeking possession from my landlord yesterday, and the DWP refused my Universal Credit limited capability for work related activity claim. I need to request a mandatory reconsideration and apply for a Discretionary Housing Payment.",
              confidence: 0.97,
              words: [
                { word: "Thank", startOffset: "6.5s", endOffset: "6.8s", confidence: 0.98, speakerTag: 2 },
                { word: "you.", startOffset: "6.8s", endOffset: "7.0s", confidence: 0.99, speakerTag: 2 },
                { word: "My", startOffset: "7.2s", endOffset: "7.4s", confidence: 0.98, speakerTag: 2 },
                { word: "name", startOffset: "7.4s", endOffset: "7.6s", confidence: 0.99, speakerTag: 2 },
                { word: "is", startOffset: "7.6s", endOffset: "7.8s", confidence: 0.98, speakerTag: 2 },
                { word: "[CLIENT_NAME_1].", startOffset: "7.8s", endOffset: "8.5s", confidence: 0.95, speakerTag: 2 },
                { word: "I", startOffset: "8.6s", endOffset: "8.7s", confidence: 0.99, speakerTag: 2 },
                { word: "received", startOffset: "8.7s", endOffset: "9.1s", confidence: 0.98, speakerTag: 2 },
                { word: "a", startOffset: "9.1s", endOffset: "9.2s", confidence: 0.99, speakerTag: 2 },
                { word: "Section", startOffset: "9.2s", endOffset: "9.6s", confidence: 0.99, speakerTag: 2 },
                { word: "21", startOffset: "9.6s", endOffset: "9.9s", confidence: 0.99, speakerTag: 2 },
                { word: "notice", startOffset: "9.9s", endOffset: "10.3s", confidence: 0.99, speakerTag: 2 },
                { word: "seeking", startOffset: "10.3s", endOffset: "10.6s", confidence: 0.98, speakerTag: 2 },
                { word: "possession", startOffset: "10.6s", endOffset: "11.1s", confidence: 0.99, speakerTag: 2 },
                { word: "from", startOffset: "11.1s", endOffset: "11.3s", confidence: 0.98, speakerTag: 2 },
                { word: "my", startOffset: "11.3s", endOffset: "11.5s", confidence: 0.99, speakerTag: 2 },
                { word: "landlord", startOffset: "11.5s", endOffset: "11.9s", confidence: 0.98, speakerTag: 2 },
                { word: "yesterday,", startOffset: "11.9s", endOffset: "12.5s", confidence: 0.97, speakerTag: 2 },
                { word: "and", startOffset: "12.6s", endOffset: "12.7s", confidence: 0.99, speakerTag: 2 },
                { word: "the", startOffset: "12.7s", endOffset: "12.8s", confidence: 0.99, speakerTag: 2 },
                { word: "DWP", startOffset: "12.8s", endOffset: "13.2s", confidence: 0.98, speakerTag: 2 },
                { word: "refused", startOffset: "13.2s", endOffset: "13.6s", confidence: 0.98, speakerTag: 2 },
                { word: "my", startOffset: "13.6s", endOffset: "13.8s", confidence: 0.99, speakerTag: 2 },
                { word: "Universal", startOffset: "13.8s", endOffset: "14.3s", confidence: 0.99, speakerTag: 2 },
                { word: "Credit", startOffset: "14.3s", endOffset: "14.7s", confidence: 0.99, speakerTag: 2 },
                { word: "limited", startOffset: "14.7s", endOffset: "15.0s", confidence: 0.99, speakerTag: 2 },
                { word: "capability", startOffset: "15.0s", endOffset: "15.5s", confidence: 0.99, speakerTag: 2 },
                { word: "for", startOffset: "15.5s", endOffset: "15.7s", confidence: 0.99, speakerTag: 2 },
                { word: "work", startOffset: "15.7s", endOffset: "15.9s", confidence: 0.99, speakerTag: 2 },
                { word: "related", startOffset: "15.9s", endOffset: "16.2s", confidence: 0.99, speakerTag: 2 },
                { word: "activity", startOffset: "16.2s", endOffset: "16.7s", confidence: 0.99, speakerTag: 2 },
                { word: "claim.", startOffset: "16.7s", endOffset: "17.1s", confidence: 0.98, speakerTag: 2 },
                { word: "I", startOffset: "17.3s", endOffset: "17.4s", confidence: 0.99, speakerTag: 2 },
                { word: "need", startOffset: "17.4s", endOffset: "17.6s", confidence: 0.99, speakerTag: 2 },
                { word: "to", startOffset: "17.6s", endOffset: "17.7s", confidence: 0.99, speakerTag: 2 },
                { word: "request", startOffset: "17.7s", endOffset: "18.1s", confidence: 0.98, speakerTag: 2 },
                { word: "a", startOffset: "18.1s", endOffset: "18.2s", confidence: 0.99, speakerTag: 2 },
                { word: "mandatory", startOffset: "18.2s", endOffset: "18.7s", confidence: 0.99, speakerTag: 2 },
                { word: "reconsideration", startOffset: "18.7s", endOffset: "19.5s", confidence: 0.99, speakerTag: 2 },
                { word: "and", startOffset: "19.6s", endOffset: "19.7s", confidence: 0.99, speakerTag: 2 },
                { word: "apply", startOffset: "19.7s", endOffset: "20.0s", confidence: 0.98, speakerTag: 2 },
                { word: "for", startOffset: "20.0s", endOffset: "20.2s", confidence: 0.99, speakerTag: 2 },
                { word: "a", startOffset: "20.2s", endOffset: "20.3s", confidence: 0.99, speakerTag: 2 },
                { word: "Discretionary", startOffset: "20.3s", endOffset: "20.9s", confidence: 0.99, speakerTag: 2 },
                { word: "Housing", startOffset: "20.9s", endOffset: "21.3s", confidence: 0.99, speakerTag: 2 },
                { word: "Payment.", startOffset: "21.3s", endOffset: "21.8s", confidence: 0.99, speakerTag: 2 },
              ],
            },
          ],
        },
        {
          alternatives: [
            {
              transcript: "I understand completely. We will review the validity of the Section 21 notice under Housing Act 1988 rules and prepare your mandatory reconsideration submission today.",
              confidence: 0.99,
              words: [
                { word: "I", startOffset: "22.2s", endOffset: "22.3s", confidence: 0.99, speakerTag: 1 },
                { word: "understand", startOffset: "22.3s", endOffset: "22.8s", confidence: 0.99, speakerTag: 1 },
                { word: "completely.", startOffset: "22.8s", endOffset: "23.4s", confidence: 0.99, speakerTag: 1 },
                { word: "We", startOffset: "23.6s", endOffset: "23.7s", confidence: 0.99, speakerTag: 1 },
                { word: "will", startOffset: "23.7s", endOffset: "23.9s", confidence: 0.99, speakerTag: 1 },
                { word: "review", startOffset: "23.9s", endOffset: "24.2s", confidence: 0.99, speakerTag: 1 },
                { word: "the", startOffset: "24.2s", endOffset: "24.3s", confidence: 0.99, speakerTag: 1 },
                { word: "validity", startOffset: "24.3s", endOffset: "24.8s", confidence: 0.99, speakerTag: 1 },
                { word: "of", startOffset: "24.8s", endOffset: "24.9s", confidence: 0.99, speakerTag: 1 },
                { word: "the", startOffset: "24.9s", endOffset: "25.0s", confidence: 0.99, speakerTag: 1 },
                { word: "Section", startOffset: "25.0s", endOffset: "25.4s", confidence: 0.99, speakerTag: 1 },
                { word: "21", startOffset: "25.4s", endOffset: "25.7s", confidence: 0.99, speakerTag: 1 },
                { word: "notice", startOffset: "25.7s", endOffset: "26.1s", confidence: 0.99, speakerTag: 1 },
                { word: "under", startOffset: "26.1s", endOffset: "26.4s", confidence: 0.99, speakerTag: 1 },
                { word: "Housing", startOffset: "26.4s", endOffset: "26.8s", confidence: 0.99, speakerTag: 1 },
                { word: "Act", startOffset: "26.8s", endOffset: "27.0s", confidence: 0.99, speakerTag: 1 },
                { word: "1988", startOffset: "27.0s", endOffset: "27.5s", confidence: 0.99, speakerTag: 1 },
                { word: "rules", startOffset: "27.5s", endOffset: "27.9s", confidence: 0.98, speakerTag: 1 },
                { word: "and", startOffset: "28.0s", endOffset: "28.1s", confidence: 0.99, speakerTag: 1 },
                { word: "prepare", startOffset: "28.1s", endOffset: "28.5s", confidence: 0.99, speakerTag: 1 },
                { word: "your", startOffset: "28.5s", endOffset: "28.7s", confidence: 0.99, speakerTag: 1 },
                { word: "mandatory", startOffset: "28.7s", endOffset: "29.2s", confidence: 0.99, speakerTag: 1 },
                { word: "reconsideration", startOffset: "29.2s", endOffset: "30.0s", confidence: 0.99, speakerTag: 1 },
                { word: "submission", startOffset: "30.0s", endOffset: "30.6s", confidence: 0.99, speakerTag: 1 },
                { word: "today.", startOffset: "30.6s", endOffset: "31.0s", confidence: 0.99, speakerTag: 1 },
              ],
            },
          ],
        },
      ],
    };
  }
}

export const cloudAsrEngine = new CloudAsrEngine();
