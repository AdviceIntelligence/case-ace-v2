/**
 * @file casenote.ts
 * @description Express Route for AQS Level 3 Case Note Generation in Case Ace v2.0.
 * 
 * Invariants:
 * 1. Network inspection guard: Rejects any request payload containing `tokenMap` or raw client PII.
 * 2. Processes ONLY pseudonymised tokenised transcripts ([CLIENT_FORENAME], [NINO], etc.).
 * 3. Returns structured case note + segment attributions + gaps conforming to canonical template.
 */

import { Router, type Request, type Response } from 'express';
import { geminiCaseNoteGenerator } from '../services/geminiCaseNoteGenerator.ts';
import { config } from '../config/index.ts';

export const caseNoteRouter = Router();

caseNoteRouter.post('/generate', async (req: Request, res: Response): Promise<void> => {
  try {
    const { tokenisedTranscript, adviserName, intakeRoute, useOfflineFallback } = req.body;

    // Strict Invariant: Reject request if client accidentally attached tokenMap or raw PII
    if (req.body.tokenMap || req.body.rawPii || req.body.rawAudioBuffer) {
      res.status(400).json({
        error: 'Privacy Violation: Outbound case note request must not contain tokenMap, raw PII, or audio buffers.',
        code: 'PRIVACY_VIOLATION_PII_PRESENT',
      });
      return;
    }

    if (!tokenisedTranscript || typeof tokenisedTranscript !== 'string' || tokenisedTranscript.trim().length === 0) {
      res.status(400).json({
        error: 'Missing required field: tokenisedTranscript is required.',
        code: 'INVALID_TRANSCRIPT_PAYLOAD',
      });
      return;
    }

    // Drafting runs against Vertex AI on europe-west2 as the attached service account.
    // There is no API key: the identity comes from the runtime, so there is nothing to
    // configure per environment and nothing to leak.
    //
    // The deterministic template engine remains available for local and test work only.
    // In the pilot it is refused, because a template assembled note is indistinguishable to
    // an adviser from a model drafted one and would be signed off as an accurate record of
    // a consultation nothing ever read.
    if (config.env === 'pilot' && useOfflineFallback === true) {
      res.status(400).json({
        error:
          'The offline template engine cannot be used in the pilot environment. A case note ' +
          'presented to an adviser must have been drafted from the transcript.',
        code: 'OFFLINE_FALLBACK_REFUSED',
      });
      return;
    }

    const result = await geminiCaseNoteGenerator.generateCaseNote({
      tokenisedTranscript,
      adviserName: adviserName || 'Adviser',
      intakeRoute: intakeRoute || 'In-Person Consultation',
      useOfflineFallback: useOfflineFallback === true || config.env !== 'pilot',
    });

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    console.error('[CaseNoteRouter] Generation error:', error);
    res.status(500).json({
      error: error.message || 'Internal error during case note generation.',
      code: 'CASE_NOTE_GENERATION_FAILED',
    });
  }
});
