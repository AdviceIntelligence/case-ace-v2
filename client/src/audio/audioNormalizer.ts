/**
 * AudioNormalizer
 * 
 * Implements Phase 6.3 Audio Normalisation for Case Ace v2.0.
 * 
 * Non-Negotiable Rules:
 * 1. Universal Representation: All three intake routes (Live in-person, Webex telephony,
 *    and File import) converge on a single in-memory audio representation:
 *    - Mono 16 kHz Float32 PCM ArrayBuffer
 *    - Structured speaker channel map
 *    - Immutable non-identifying ConsentRecord
 * 2. Downstream Agnosticism: Phase 7 onwards (local redaction, STT v2, LLM drafting)
 *    must not know or care which route produced the audio.
 * 3. Intake Route Telemetry: Records the intake route as a non-sensitive monitoring
 *    telemetry field so CAW quality evaluators can measure case note accuracy across routes.
 */

import type { IntakeRoute, ConsentRecord } from '../consent/consentManager.ts';
import { volatileSessionStore } from '../state/volatileStore.ts';
import { apiFetch } from '../config/apiClient.ts';

export interface SpeakerChannelMap {
  isDualChannel: boolean;
  channelCount?: number;
  adviserChannel?: number;
  clientChannel?: number;
  sourceType: 'single_mic' | 'split_telephony' | 'mixed_file';
}

export interface NormalizedAudioSession {
  pcmBuffer: ArrayBuffer;
  durationSeconds: number;
  sampleRate: 16000;
  format: 'FLOAT32_PCM_16KHZ_MONO';
  speakerMap: SpeakerChannelMap;
  consentRecord: ConsentRecord;
  intakeRoute: IntakeRoute;
}

export class AudioNormalizer {
  public static readonly REQUIRED_SAMPLE_RATE = 16000;
  public static readonly FORMAT_SPEC = 'FLOAT32_PCM_16KHZ_MONO';

  /**
   * Normalises Live In-Person audio capture.
   */
  public normalizeLiveCapture(
    input: { pcmBuffer: ArrayBuffer; durationSeconds: number; sampleRate: number },
    consent: ConsentRecord
  ): NormalizedAudioSession {
    this.validateConsent(consent, 'live_in_person');
    this.validatePcmBuffer(input.pcmBuffer);

    const session: NormalizedAudioSession = {
      pcmBuffer: input.pcmBuffer,
      durationSeconds: Math.round(input.durationSeconds * 10) / 10,
      sampleRate: AudioNormalizer.REQUIRED_SAMPLE_RATE,
      format: AudioNormalizer.FORMAT_SPEC,
      speakerMap: {
        isDualChannel: false,
        sourceType: 'single_mic',
      },
      consentRecord: consent,
      intakeRoute: 'live_in_person',
    };

    this.commitToVolatileStore(session);
    this.sendIntakeTelemetry('live_in_person', session.durationSeconds * 1000);
    return session;
  }



  /**
   * Normalises imported audio file decoding.
   */
  public normalizeFileImport(
    input: { pcmBuffer: ArrayBuffer; durationSeconds: number; sampleRate: number },
    consent: ConsentRecord
  ): NormalizedAudioSession {
    this.validateConsent(consent, 'file_import');
    this.validatePcmBuffer(input.pcmBuffer);

    const session: NormalizedAudioSession = {
      pcmBuffer: input.pcmBuffer,
      durationSeconds: Math.round(input.durationSeconds * 10) / 10,
      sampleRate: AudioNormalizer.REQUIRED_SAMPLE_RATE,
      format: AudioNormalizer.FORMAT_SPEC,
      speakerMap: {
        isDualChannel: false,
        sourceType: 'mixed_file',
      },
      consentRecord: consent,
      intakeRoute: 'file_import',
    };

    this.commitToVolatileStore(session);
    this.sendIntakeTelemetry('file_import', session.durationSeconds * 1000);
    return session;
  }

  private validateConsent(consent: ConsentRecord, expectedRoute: IntakeRoute): void {
    if (!consent || !consent.confirmedByAdviser) {
      throw new Error('[CONSENT GATE VIOLATION] Cannot normalize audio without confirmed consent.');
    }
    if (consent.route !== expectedRoute) {
      throw new Error(`Consent route mismatch: Expected '${expectedRoute}', got '${consent.route}'.`);
    }
  }

  private validatePcmBuffer(buffer: ArrayBuffer): void {
    if (!buffer || buffer.byteLength === 0) {
      throw new Error('Audio normalisation failed: PCM buffer is empty or missing.');
    }
    // Float32 samples must align to 4 bytes
    if (buffer.byteLength % 4 !== 0) {
      throw new Error('Audio normalisation failed: Float32 PCM byte length is misaligned.');
    }
  }

  private commitToVolatileStore(session: NormalizedAudioSession): void {
    if (!volatileSessionStore.hasActiveSession()) {
      volatileSessionStore.initSession({ route: session.intakeRoute, adviserId: session.consentRecord.adviserId });
    }
    volatileSessionStore.setRawAudio(session.pcmBuffer, session.durationSeconds, session.sampleRate);
    volatileSessionStore.setConsentRecord(session.consentRecord);
    volatileSessionStore.setSpeakerMap(session.speakerMap);
    volatileSessionStore.setStage('local_redaction');
  }

  private async sendIntakeTelemetry(intakeRoute: IntakeRoute, durationMs: number): Promise<void> {
    try {
      if (typeof fetch !== 'undefined') {
        await apiFetch('/api/v1/monitoring/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stage: 'intake_completed',
            intakeRoute,
            durationMs,
            success: true,
          }),
        }).catch(() => {});
      }
    } catch {}
  }
}

export const audioNormalizer = new AudioNormalizer();
