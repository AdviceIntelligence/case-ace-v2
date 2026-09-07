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
import { logSecurityEvent } from '../monitoring/eventLogger.ts';

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
      // Written for the adviser, who is the person who sees it. The technical wording that
      // used to appear here told them nothing they could act on.
      throw new Error(
        'No sound was captured, so there is nothing to work from. Check that the right ' +
          'microphone is selected and that this site has permission to use it, then record ' +
          'again. Nothing has been sent anywhere.',
      );
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

  /**
   * Records that audio arrived, through the same emitter as every other event.
   *
   * This used to POST its own hand-rolled body straight to the monitoring endpoint:
   * { stage, intakeRoute, durationMs, success }. That is not the validated log schema, so the
   * backend rejected every one with HTTP 400 and the audit log never recorded that a
   * consultation had been captured at all. Going through logSecurityEvent means the payload
   * is built and named the same way as everything else, and cannot drift again.
   */
  private sendIntakeTelemetry(intakeRoute: IntakeRoute, durationMs: number): void {
    logSecurityEvent({
      type: intakeRoute === 'file_import' ? 'FILE_IMPORTED' : 'AUDIO_RECORDING_STOPPED',
      details: {
        stageReached: 'recording',
        stageDurationMs: Math.round(durationMs),
        audioDurationSeconds: Math.round(durationMs / 1000),
      },
    });
  }
}

export const audioNormalizer = new AudioNormalizer();
