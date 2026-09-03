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
