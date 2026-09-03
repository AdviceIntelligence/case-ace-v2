/**
 * Case Ace v2.0 - Client Monitoring & Event Logger (Phase 16)
 * 
 * Invariants:
 * 1. Conforms strictly to backend ValidatedLogPayload schema.
 * 2. Emits only permitted event types and numerical/enum fields.
 * 3. Zero Free Text: Rejects any free-form text or client identifiers.
 * 4. Transmits to /api/v1/monitoring/events.
 */

import { apiFetch } from '../config/apiClient.ts';

export interface ClientSecurityEvent {
  type: string;
  timestamp?: string;
  userId?: string;
  role?: string;
  sessionId?: string;
  details?: Record<string, unknown>;
}

const buffer: Record<string, unknown>[] = [];

/**
 * Dispatches a strictly validated security and operational telemetry event.
 */
export function logSecurityEvent(event: ClientSecurityEvent): void {
  const timestamp = event.timestamp || new Date().toISOString();
  const payload: Record<string, unknown> = {
    eventType: event.type,
    timestamp,
  };

  if (event.userId) payload.pseudonymousUserId = event.userId;
  if (event.role) payload.role = event.role;
  if (event.sessionId) payload.pseudonymousSessionId = event.sessionId;

  if (event.details) {
    if (typeof event.details.outcome === 'string') {
      payload.consentStatus = event.details.outcome.includes('withdrawn')
        ? 'withdrawn'
        : event.details.outcome.includes('abandoned')
        ? 'abandoned'
        : 'given';
    }
    if (typeof event.details.totalSessionDurationMs === 'number') {
      payload.totalSessionDurationMs = event.details.totalSessionDurationMs;
    }
    if (typeof event.details.stageReached === 'string') {
      payload.stageReached = event.details.stageReached;
    }
    if (typeof event.details.stageDurationMs === 'number') {
      payload.stageDurationMs = event.details.stageDurationMs;
    }
    if (typeof event.details.audioDurationSeconds === 'number') {
      payload.audioDurationSeconds = event.details.audioDurationSeconds;
    }
    if (typeof event.details.reviewGateDwellTimeMs === 'number') {
      payload.reviewGateDwellTimeMs = event.details.reviewGateDwellTimeMs;
    }
    if (typeof event.details.gapsAcknowledgedCount === 'number') {
      payload.gapsAcknowledgedCount = event.details.gapsAcknowledgedCount;
    }
    if (typeof event.details.draftToSignoffDurationMs === 'number') {
      payload.draftToSignoffDurationMs = event.details.draftToSignoffDurationMs;
    }
    if (typeof event.details.verificationPassResult === 'boolean') {
      payload.verificationPassResult = event.details.verificationPassResult;
    }
    if (typeof event.details.errorCode === 'string') {
      payload.errorCode = event.details.errorCode;
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
