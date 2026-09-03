/**
 * redactionVerificationManager.ts
 * 
 * Orchestrates Phase 10 Mandatory Verification Pass (Failing Closed per Constraint C8).
 * 
 * Flow:
 * 1. Executes padded acoustic redaction and interval merging via AudioRedactionEngine.
 * 2. Runs region-level acoustic energy assertions.
 * 3. Re-runs Pass One speech-to-text on the redacted audio.
 * 4. Runs Phase 8 identifier detection over the verification transcript.
 * 5. If ANY identifier is detected in the verification pass:
 *    - Blocks upload / cloud progression immediately.
 *    - Re-locks Phase 9 gate.
 *    - Highlights surviving identifiers for adviser review.
 *    - Emits security telemetry.
 * 6. If ZERO identifiers survive:
 *    - Transcodes verified audio to 16kHz mono 16-bit LINEAR16 WAV.
 *    - Releases and zeroes unredacted raw audio from volatile RAM (Constraint C1 / C4).
 *    - Commits verified redacted audio to VolatileSessionStore.
 */

import { volatileSessionStore, VolatileSessionStore, type SessionState, type DetectedIdentifier } from '../state/volatileStore.ts';
import { audioRedactionEngine, type RedactionSpan, type MergedRedactionInterval } from '../audio/audioRedactionEngine.ts';
import { identifierEngine } from './identifierEngine.ts';
import { localAsrEngine } from '../asr/localAsrEngine.ts';
import { logSecurityEvent } from '../monitoring/eventLogger.ts';

export interface VerificationProgressEvent {
  step: 'redacting_audio' | 'acoustic_assertions' | 'running_verification_asr' | 'detecting_survivors' | 'complete' | 'failed';
  stepNumber: number;
  totalSteps: number;
  progressPercent: number;
  message: string;
}

export interface VerificationResult {
  success: boolean;
  survivingIdentifiers: DetectedIdentifier[];
  verificationTranscript: string;
  mergedIntervals?: MergedRedactionInterval[];
  totalMutedSeconds?: number;
  errorMessage?: string;
}

export class RedactionVerificationManager {
  /**
   * Collects all approved redaction spans from session state.
   */
  public extractApprovedSpans(session: SessionState): RedactionSpan[] {
    const spans: RedactionSpan[] = [];

    // 1. Detected identifiers from Phase 8
    for (const id of session.detectedIdentifiers) {
      if (id.proposedAction === 'redact' && id.adviserDecision !== 'rejected') {
        spans.push({
          id: id.id,
          startSec: id.audioTimeRange?.startSec ?? 0,
          endSec: id.audioTimeRange?.endSec ?? 0,
          category: id.category,
          surrogateToken: id.surrogateToken,
          adviserDecision: id.adviserDecision,
        });
      }
    }

    // 2. Manual redactions added by adviser in Phase 9
    for (const manual of session.manualRedactions) {
      if (manual.adviserDecision !== 'rejected') {
        spans.push({
          id: manual.id,
          startSec: manual.audioTimeRange?.startSec ?? 0,
          endSec: manual.audioTimeRange?.endSec ?? 0,
          category: manual.category,
          surrogateToken: manual.surrogateToken,
          adviserDecision: manual.adviserDecision,
        });
      }
    }

    return spans;
  }

  /**
   * Executes the full Phase 10 verification pipeline.
   */
  public async verifyAndCommitRedactedAudio(
    session: SessionState,
    onProgress?: (event: VerificationProgressEvent) => void,
    customAsrRunner?: (audioBuffer: ArrayBuffer, durationSec: number) => Promise<{ transcript: string; lowConfidenceWords: any[] }>,
    targetStore: VolatileSessionStore = volatileSessionStore
  ): Promise<VerificationResult> {
    const rawAudio = session.rawAudioBuffer;
    if (!rawAudio) {
      return {
        success: false,
        survivingIdentifiers: [],
        verificationTranscript: '',
        errorMessage: 'Cannot verify redaction: raw audio buffer is not present in volatile memory.',
      };
    }

    const durationSec = session.metadata.audioDurationSeconds || 0;
    const approvedSpans = this.extractApprovedSpans(session);

    try {
      // -------------------------------------------------------------
      // Step 1: Acoustic Redaction with Minimum 250ms Padding
      // -------------------------------------------------------------
      onProgress?.({
        step: 'redacting_audio',
        stepNumber: 1,
        totalSteps: 4,
        progressPercent: 25,
        message: 'Applying minimum 250ms padded acoustic redaction and interval merging...',
      });

      const redactionResult = audioRedactionEngine.redactAudio(rawAudio, approvedSpans, {
        paddingMs: 300,
        mode: 'silence',
        sampleRate: 16000,
      });

      // -------------------------------------------------------------
      // Step 2: Region-Level Acoustic Energy Assertions
      // -------------------------------------------------------------
      onProgress?.({
        step: 'acoustic_assertions',
        stepNumber: 2,
        totalSteps: 4,
        progressPercent: 50,
        message: 'Verifying region-level RMS energy and zero residual speech in redacted intervals...',
      });

      audioRedactionEngine.assertRegionAcoustics(
        redactionResult.redactedFloat32Audio,
        redactionResult.mergedIntervals,
        'silence'
      );

      // -------------------------------------------------------------
      // Step 3: Re-Run Pass One Local ASR on Redacted Audio
      // -------------------------------------------------------------
      onProgress?.({
        step: 'running_verification_asr',
        stepNumber: 3,
        totalSteps: 4,
        progressPercent: 75,
        message: 'Running Pass One speech-to-text verification pass on redacted audio...',
      });

      let verificationTranscript = '';
      let mockAsrResult: any = null;

      if (customAsrRunner) {
        const asrRes = await customAsrRunner(redactionResult.redactedArrayBuffer, durationSec);
        verificationTranscript = asrRes.transcript;
        mockAsrResult = {
          fullTranscript: asrRes.transcript,
          segments: [],
          totalWords: asrRes.transcript.split(/\s+/).filter(Boolean).length,
          lowConfidenceWordsCount: asrRes.lowConfidenceWords?.length || 0,
          lowConfidenceWords: asrRes.lowConfidenceWords || [],
        };
      } else {
        const asrResult = await localAsrEngine.transcribeAudio(
          redactionResult.redactedArrayBuffer,
          durationSec,
          session.speakerMap
        );
        verificationTranscript = asrResult.fullTranscript;
        mockAsrResult = asrResult;
      }

      // -------------------------------------------------------------
      // Step 4: Phase 8 Identifier Detection on Verification Transcript
      // -------------------------------------------------------------
      onProgress?.({
        step: 'detecting_survivors',
        stepNumber: 4,
        totalSteps: 4,
        progressPercent: 90,
        message: 'Scanning verification transcript for surviving identifiers (Fail Closed C8)...',
      });

      const survivorScan = identifierEngine.detectIdentifiers(verificationTranscript, mockAsrResult);
      const survivingIdentifiers = survivorScan.identifiers;

      // -------------------------------------------------------------
      // Step 5: Fail-Closed Evaluation (Constraint C8)
      // -------------------------------------------------------------
      if (survivingIdentifiers.length > 0) {
        // Redaction verification FAILED: Surviving identifiers detected
        targetStore.setVerificationFailure(survivingIdentifiers, verificationTranscript);

        logSecurityEvent({
          type: 'redaction_verification_failed',
          timestamp: new Date().toISOString(),
          details: {
            survivingCount: survivingIdentifiers.length,
            approvedSpansCount: approvedSpans.length,
            mergedIntervalsCount: redactionResult.mergedIntervals.length,
            totalMutedSeconds: redactionResult.totalMutedSeconds,
          },
        });

        onProgress?.({
          step: 'failed',
          stepNumber: 4,
          totalSteps: 4,
          progressPercent: 100,
          message: `Redaction verification failed: ${survivingIdentifiers.length} surviving identifier(s) detected.`,
        });

        return {
          success: false,
          survivingIdentifiers,
          verificationTranscript,
          mergedIntervals: redactionResult.mergedIntervals,
          totalMutedSeconds: redactionResult.totalMutedSeconds,
          errorMessage: `Verification Pass Failed: ${survivingIdentifiers.length} identifier(s) were still detected in the redacted audio. Upload blocked; returning to redaction gate for adviser review.`,
        };
      }

      // -------------------------------------------------------------
      // Step 6: Verification Succeeded: Encode LINEAR16 WAV & Wipe Raw Audio (C1 / C4)
      // -------------------------------------------------------------
      const wavBuffer = audioRedactionEngine.encodeLinear16Wav(
        redactionResult.redactedFloat32Audio,
        16000
      );

      targetStore.commitVerifiedRedactedAudio(
        redactionResult.redactedArrayBuffer,
        wavBuffer,
        verificationTranscript,
        redactionResult.mergedIntervals
      );

      logSecurityEvent({
        type: 'redaction_verification_passed',
        timestamp: new Date().toISOString(),
        details: {
          approvedSpansCount: approvedSpans.length,
          mergedIntervalsCount: redactionResult.mergedIntervals.length,
          totalMutedSeconds: redactionResult.totalMutedSeconds,
          rawAudioWiped: true,
        },
      });

      onProgress?.({
        step: 'complete',
        stepNumber: 4,
        totalSteps: 4,
        progressPercent: 100,
        message: 'Redaction verified successfully. Raw audio memory wiped. Ready for Cloud Speech-to-Text.',
      });

      return {
        success: true,
        survivingIdentifiers: [],
        verificationTranscript,
        mergedIntervals: redactionResult.mergedIntervals,
        totalMutedSeconds: redactionResult.totalMutedSeconds,
      };
    } catch (err: any) {
      const errMsg = err?.message || 'Unknown error occurred during audio redaction verification.';
      return {
        success: false,
        survivingIdentifiers: [],
        verificationTranscript: '',
        errorMessage: errMsg,
      };
    }
  }
}

export const redactionVerificationManager = new RedactionVerificationManager();
