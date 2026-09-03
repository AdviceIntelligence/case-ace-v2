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

    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY;

    // The generator falls back to a deterministic template engine when no model credential
    // is configured. That fallback exists for local and test runs, where it is useful.
    // In the pilot it would be actively dangerous: the adviser would be handed a
    // template-assembled note that no model ever produced, presented identically to a real
    // draft, and would sign it off as an accurate record of the consultation. If the model
    // is not configured in the pilot, this endpoint must fail visibly instead.
    if (config.env === 'pilot' && (!apiKey || useOfflineFallback === true)) {
      res.status(503).json({
        error:
          'Case note drafting is unavailable: no language model credential is configured for ' +
          'this environment. The offline template engine must never produce a case note that ' +
          'an adviser could mistake for a model-drafted record.',
        code: 'MODEL_NOT_CONFIGURED',
      });
      return;
    }

    const result = await geminiCaseNoteGenerator.generateCaseNote({
      tokenisedTranscript,
      adviserName: adviserName || 'Adviser',
      intakeRoute: intakeRoute || 'In-Person Consultation',
      apiKey,
      useOfflineFallback: useOfflineFallback === true || !apiKey,
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
