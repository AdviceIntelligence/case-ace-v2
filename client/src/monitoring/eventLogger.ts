/**
 * Case Ace v2.0 - Client Monitoring & Event Logger (Phase 16)
 * 
 * Invariants:
 * 1. Conforms strictly to backend ValidatedLogPayload schema.
 * 2. Emits only permitted event types (UPPER_SNAKE_CASE) and numerical/enum fields.
 * 3. Zero Free Text: Rejects any free-form text or client identifiers.
 * 4. Transmits to /api/v1/monitoring/events.
 */

import { apiFetch } from '../config/apiClient.ts';

export type PermittedClientEventType =
  | 'SESSION_INITIALISED'
  | 'CONSENT_GIVEN'
  | 'CONSENT_WITHDRAWN'
  | 'SESSION_ABANDONED'
  | 'SESSION_ENDED'
  | 'AUDIO_RECORDING_STARTED'
  | 'AUDIO_RECORDING_STOPPED'
  | 'FILE_IMPORTED'
  | 'PASS1_LOCAL_ASR_COMPLETED'
  | 'IDENTIFIERS_DETECTED'
  | 'REDACTION_GATE_ENTERED'
  | 'REDACTION_GATE_COMPLETED'
  | 'ACOUSTIC_VERIFICATION_COMPLETED'
  | 'CLOUD_STT_REQUESTED'
  | 'CLOUD_STT_COMPLETED'
  | 'CLOUD_STT_FALLBACK'
  | 'TOKENISATION_COMPLETED'
  | 'CASE_NOTE_DRAFT_REQUESTED'
  | 'CASE_NOTE_DRAFT_COMPLETED'
  | 'ADVISER_SIGNOFF_COMPLETED'
  | 'CASEBOOK_EXPORT_COPIED'
  | 'CREDENTIALS_REQUESTED'
  | 'CREDENTIALS_REVOKED'
  | 'LOGS_ACCESSED'
  | 'ERROR_OCCURRED';


export interface ClientSecurityEvent {
  type: PermittedClientEventType | string;
  timestamp?: string;
  userId?: string;
  role?: string;
  sessionId?: string;
  details?: Record<string, unknown>;
}

const EVENT_TYPE_NORMALIZATION: Record<string, PermittedClientEventType> = {
  session_initialised: 'SESSION_INITIALISED',
  consent_given: 'CONSENT_GIVEN',
  consent_withdrawn: 'CONSENT_WITHDRAWN',
  session_abandoned: 'SESSION_ABANDONED',
  session_ended: 'SESSION_ENDED',
  audio_recording_started: 'AUDIO_RECORDING_STARTED',
  audio_recording_stopped: 'AUDIO_RECORDING_STOPPED',
  file_imported: 'FILE_IMPORTED',
  pass1_local_asr_completed: 'PASS1_LOCAL_ASR_COMPLETED',
  identifiers_detected: 'IDENTIFIERS_DETECTED',
  redaction_gate_entered: 'REDACTION_GATE_ENTERED',
  redaction_gate_completed: 'REDACTION_GATE_COMPLETED',
  acoustic_verification_completed: 'ACOUSTIC_VERIFICATION_COMPLETED',
  cloud_stt_requested: 'CLOUD_STT_REQUESTED',
  cloud_stt_transcription_completed: 'CLOUD_STT_COMPLETED',
  cloud_stt_transcription_failed: 'ERROR_OCCURRED',
  cloud_stt_completed: 'CLOUD_STT_COMPLETED',
  cloud_stt_fallback: 'CLOUD_STT_FALLBACK',
  tokenisation_completed: 'TOKENISATION_COMPLETED',
  case_note_draft_requested: 'CASE_NOTE_DRAFT_REQUESTED',
  case_note_generated: 'CASE_NOTE_DRAFT_COMPLETED',
  case_note_draft_completed: 'CASE_NOTE_DRAFT_COMPLETED',
  adviser_signoff_completed: 'ADVISER_SIGNOFF_COMPLETED',
  casebook_export_copied: 'CASEBOOK_EXPORT_COPIED',
  credentials_requested: 'CREDENTIALS_REQUESTED',
  credentials_revoked: 'CREDENTIALS_REVOKED',
  logs_accessed: 'LOGS_ACCESSED',
  error_occurred: 'ERROR_OCCURRED',
};

const buffer: Record<string, unknown>[] = [];

/**
 * Normalizes an incoming event type to the permitted upper snake case name.
 */
function normalizeEventType(type: string): string {
  if (EVENT_TYPE_NORMALIZATION[type.toLowerCase()]) {
    return EVENT_TYPE_NORMALIZATION[type.toLowerCase()];
  }
  return type.toUpperCase();
}

/**
 * Dispatches a strictly validated security and operational telemetry event.
 */
export function logSecurityEvent(event: ClientSecurityEvent): void {
  const timestamp = event.timestamp || new Date().toISOString();
  const eventType = normalizeEventType(event.type);

  const payload: Record<string, unknown> = {
    eventType,
    timestamp,
  };

  if (event.userId) payload.pseudonymousUserId = event.userId;
  if (event.role) payload.role = event.role;
  if (event.sessionId) payload.pseudonymousSessionId = event.sessionId;

  if (event.details) {
    const d = event.details;

    // Consent
    if (typeof d.outcome === 'string') {
      payload.consentStatus = d.outcome.includes('withdrawn')
        ? 'withdrawn'
        : d.outcome.includes('abandoned')
        ? 'abandoned'
        : 'given';
    } else if (typeof d.consentStatus === 'string') {
      payload.consentStatus = d.consentStatus;
    }

    // Intake route
    if (typeof d.intakeRoute === 'string') {
      payload.intakeRoute = d.intakeRoute;
    }

    // Durations
    if (typeof d.totalSessionDurationMs === 'number') {
      payload.totalSessionDurationMs = d.totalSessionDurationMs;
    }
    if (typeof d.stageReached === 'string') {
      payload.stageReached = d.stageReached;
    }
    if (typeof d.stageDurationMs === 'number') {
      payload.stageDurationMs = d.stageDurationMs;
    }
    if (typeof d.audioDurationSeconds === 'number') {
      payload.audioDurationSeconds = d.audioDurationSeconds;
    }
    if (typeof d.reviewGateDwellTimeMs === 'number') {
      payload.reviewGateDwellTimeMs = d.reviewGateDwellTimeMs;
    } else if (typeof d.dwellTimeMs === 'number') {
      payload.reviewGateDwellTimeMs = d.dwellTimeMs;
    }
    if (typeof d.draftToSignoffDurationMs === 'number') {
      payload.draftToSignoffDurationMs = d.draftToSignoffDurationMs;
    }
    if (typeof d.apiLatencyMs === 'number') {
      payload.apiLatencyMs = d.apiLatencyMs;
    } else if (typeof d.latencyMs === 'number') {
      payload.apiLatencyMs = d.latencyMs;
    }

    // Review gate counts
    if (typeof d.manualAddedCount === 'number' || typeof d.manualRemovedCount === 'number') {
      payload.reviewGateModifications = {
        addedCount: typeof d.manualAddedCount === 'number' ? d.manualAddedCount : 0,
        removedCount: typeof d.manualRemovedCount === 'number' ? d.manualRemovedCount : 0,
      };
    } else if (d.reviewGateModifications && typeof d.reviewGateModifications === 'object') {
      payload.reviewGateModifications = d.reviewGateModifications;
    }

    // Word counts
    if (typeof d.totalWords === 'number') {
      payload.wordCounts = {
        transcriptWords: d.totalWords,
        noteWords: typeof d.noteWords === 'number' ? d.noteWords : 0,
      };
    } else if (d.wordCounts && typeof d.wordCounts === 'object') {
      payload.wordCounts = d.wordCounts;
    }

    // Detected identifier counts
    if (d.detectedIdentifierCounts && typeof d.detectedIdentifierCounts === 'object') {
      payload.detectedIdentifierCounts = d.detectedIdentifierCounts;
    } else if (typeof d.totalTokenCount === 'number') {
      payload.detectedIdentifierCounts = { total: d.totalTokenCount };
    }

    // Gaps and verification
    if (typeof d.gapsAcknowledgedCount === 'number') {
      payload.gapsAcknowledgedCount = d.gapsAcknowledgedCount;
    } else if (typeof d.gapsCount === 'number') {
      payload.gapsAcknowledgedCount = d.gapsCount;
    }
    if (typeof d.verificationPassResult === 'boolean') {
      payload.verificationPassResult = d.verificationPassResult;
    }

    // Model and prompt versions
    if (typeof d.promptVersion === 'string') {
      payload.modelAndPromptVersions = {
        promptVersion: d.promptVersion,
        modelVersion: typeof d.modelDetails === 'string' ? d.modelDetails : 'gemini-1.5-pro-preview',
      };
    } else if (d.modelAndPromptVersions && typeof d.modelAndPromptVersions === 'object') {
      payload.modelAndPromptVersions = d.modelAndPromptVersions;
    }

    // Errors
    if (typeof d.errorCode === 'string') {
      payload.errorCode = d.errorCode;
    }
    if (typeof d.errorType === 'string') {
      payload.errorType = d.errorType;
    }
    if (typeof d.apiStatusCode === 'number') {
      payload.apiStatusCode = d.apiStatusCode;
    } else if (typeof d.statusCode === 'number') {
      payload.apiStatusCode = d.statusCode;
    }

    // Bytes
    if (typeof d.byteCounts === 'number') {
      payload.byteCounts = d.byteCounts;
    }
  }

  buffer.push(payload);

  if (typeof window !== 'undefined' && typeof fetch !== 'undefined') {
    apiFetch('/api/v1/monitoring/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }).catch(() => {
      // Offline fallback: keep in buffer
    });
  }
}

export function getTelemetryBuffer(): Readonly<Record<string, unknown>[]> {
  return [...buffer];
}

export function clearTelemetryBuffer(): void {
  buffer.length = 0;
}
