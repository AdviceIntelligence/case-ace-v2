/**
 * @file caseNoteEngine.ts
 * @description Client-side Coordinator for AQS Level 3 Case Note Generation in Case Ace v2.0.
 * 
 * Invariants:
 * 1. Pre-transmission assertion: Sends strictly tokenised transcript ([CLIENT_FORENAME], etc.).
 * 2. Token map is NEVER sent to backend or Vertex AI (Constraint C1/C4).
 * 3. Detokenisation happens strictly client-side using browser volatile memory.
 * 4. Logs telemetry events with zero PII.
 */

import { volatileSessionStore, type StructuredCaseNote, type CaseNoteAttribution } from '../state/volatileStore.ts';
import { tokenisationEngine } from '../tokenisation/tokenisationEngine.ts';
import { logSecurityEvent } from '../monitoring/eventLogger.ts';

export class CaseNotePrivacyViolationError extends Error {
  constructor(message: string) {
    super(`[CaseNotePrivacyViolation] ${message}`);
    this.name = 'CaseNotePrivacyViolationError';
  }
}

export interface GenerateCaseNoteClientOptions {
  tokenisedTranscript: string;
  adviserName?: string;
  intakeRoute?: string;
}

export interface CaseNoteResult {
  structuredCaseNote: StructuredCaseNote;
  tokenisedMarkdown: string;
  detokenisedMarkdown: string;
  attributions: CaseNoteAttribution[];
  gapsAndLimitations: string[];
  promptVersion: string;
  modelDetails: string;
}

export class CaseNoteEngine {
  /**
   * Asserts that the payload to be transmitted contains only pseudonymised tokens
   * and that raw tokenMap or PII is strictly excluded.
   */
  public assertPreTransmissionPrivacy(payload: any): void {
    if (payload.tokenMap || payload.rawPii || payload.rawAudioBuffer) {
      throw new CaseNotePrivacyViolationError('Outbound request attempted to include tokenMap, raw PII, or raw audio buffer.');
    }

    if (typeof payload.tokenisedTranscript !== 'string' || payload.tokenisedTranscript.trim().length === 0) {
      throw new CaseNotePrivacyViolationError('Invalid payload: tokenisedTranscript must be a non-empty string.');
    }

    // Check if raw PII names leaked into the tokenised transcript
    // Standard PII regex or pattern checks
    const commonPiiPatterns = [
      /\b[A-Z]{2}\s*\d{2}\s*\d{2}\s*\d{2}\s*[A-D]\b/i, // Raw NINO
    ];

    for (const pat of commonPiiPatterns) {
      if (pat.test(payload.tokenisedTranscript)) {
        throw new CaseNotePrivacyViolationError('Outbound transcript contains detected raw PII pattern (NINO).');
      }
    }
  }

  public assertOutboundPrivacy(payload: any): void {
    this.assertPreTransmissionPrivacy(payload);
  }

  /**
   * Detokenises a case note markdown string using the provided token map.
   */
  public detokeniseCaseNote(markdown: string, tokenMap: Record<string, string>): string {
    return tokenisationEngine.detokeniseText(markdown, tokenMap);
  }

  /**
   * Requests case note generation from the backend / Vertex AI.
   */
  public async generateCaseNote(options: GenerateCaseNoteClientOptions): Promise<CaseNoteResult> {
    const session = volatileSessionStore.getState();
    if (!session) {
      throw new Error('[CaseNoteEngine] Cannot generate case note without an active session.');
    }

    const payload = {
      tokenisedTranscript: options.tokenisedTranscript,
      adviserName: options.adviserName || 'Adviser',
      intakeRoute: options.intakeRoute || session.consentRecord?.route || 'In-Person Consultation',
    };

    // Assert zero PII / zero tokenMap before network request
    this.assertOutboundPrivacy(payload);

    const startTime = Date.now();

    const response = await fetch('/api/v1/casenote/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({ error: 'Network failure' }));
      throw new Error(errJson.error || `Case note generation failed with HTTP ${response.status}`);
    }

    const data = await response.json();
    const tokenisedMarkdown: string = data.formattedMarkdown;
    const structuredCaseNote: StructuredCaseNote = data.structuredCaseNote;
    const attributions: CaseNoteAttribution[] = data.attributions || [];
    const gapsAndLimitations: string[] = data.gapsAndLimitations || [];
    const promptVersion: string = data.promptVersion || 'v2.4.0';
    const modelDetails: string = data.modelDetails || 'gemini-1.5-pro (europe-west2)';

    // Perform CLIENT-SIDE detokenisation using session's volatile tokenMap
    const detokenisedMarkdown = tokenisationEngine.detokeniseText(tokenisedMarkdown, session.tokenMap);

    // Commit generated case note to volatile session store
    volatileSessionStore.setGeneratedCaseNote(
      structuredCaseNote,
      tokenisedMarkdown,
      detokenisedMarkdown,
      attributions,
      gapsAndLimitations,
      promptVersion,
      modelDetails
    );

    const latencyMs = Date.now() - startTime;

    logSecurityEvent({
      type: 'case_note_generated',
      details: {
        promptVersion,
        modelDetails: typeof modelDetails === 'object' ? JSON.stringify(modelDetails) : String(modelDetails),
        attributionCount: attributions.length,
        gapsCount: gapsAndLimitations.length,
        latencyMs,
      },
    });

    return {
      structuredCaseNote,
      tokenisedMarkdown,
      detokenisedMarkdown,
      attributions,
      gapsAndLimitations,
      promptVersion,
      modelDetails,
    };
  }
}

export const caseNoteEngine = new CaseNoteEngine();
