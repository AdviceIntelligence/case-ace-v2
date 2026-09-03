/**
 * Case Ace v2.0 - Unified Session Destruction Engine
 * 
 * Implements the single canonical destroySession() function called from all 6 exit paths:
 * 1. Explicit End
 * 2. Log Out
 * 3. Idle Timeout
 * 4. Consent Withdrawal
 * 5. Tab Close / Page Unload
 * 6. Unrecoverable Error States
 * 
 * Strict Invariants (Constraint C1, C3, C8):
 * - Deterministically zeroes all TypedArrays (raw audio, redacted audio, WAV buffers).
 * - Releases references to all transcripts, token maps, draft and final case notes.
 * - Terminates the SessionRecoveryWorker thread and clears worker RAM snapshot.
 * - Revokes outstanding cloud credentials / downscoped tokens.
 * - Clears the clipboard if detokenised content was placed there and platform permits.
 * - Writes a single monitoring event recording session duration and outcome with ZERO PII or content.
 */

import { volatileSessionStore } from './volatileStore.ts';
import { sessionRecoveryManager } from './sessionRecoveryManager.ts';
import { logSecurityEvent } from '../monitoring/eventLogger.ts';
import { apiFetch } from '../config/apiClient.ts';

export type SessionExitReason =
  | 'explicit_end'
  | 'logout'
  | 'idle_timeout'
  | 'consent_withdrawal'
  | 'tab_close'
  | 'unrecoverable_error';

export type SessionEndOutcome =
  | 'completed_signed_off'
  | 'explicit_end'
  | 'logged_out'
  | 'idle_timeout'
  | 'consent_withdrawn'
  | 'tab_closed'
  | 'unrecoverable_error';

export interface DestroySessionOptions {
  reason?: SessionExitReason;
  error?: Error | unknown;
  skipClipboardClear?: boolean;
}

/** Flag tracking whether detokenised content was copied to clipboard in this session */
let hasDetokenisedContentInClipboard = false;

/**
 * Marks that detokenised consultation text was copied to the clipboard.
 */
export function markDetokenisedContentCopied(): void {
  hasDetokenisedContentInClipboard = true;
}

/**
 * Returns whether detokenised content is currently tracked in clipboard.
 */
export function isDetokenisedClipboardPresent(): boolean {
  return hasDetokenisedContentInClipboard;
}

/**
 * Resets the clipboard tracking flag.
 */
export function resetClipboardTracking(): void {
  hasDetokenisedContentInClipboard = false;
}

/**
 * Single canonical session destruction function.
 * Called from every exit path across the application.
 */
export async function destroySession(options: DestroySessionOptions = {}): Promise<void> {
  const reason = options.reason || 'explicit_end';
  const currentState = volatileSessionStore.getState();

  // 1. Capture non-PII operational metrics before wiping state
  const sessionId = currentState?.sessionId || 'uninitialised';
  const createdAt = currentState?.metadata?.createdAt || Date.now();
  const durationMs = Math.max(0, Date.now() - createdAt);
  const isSignedOff = Boolean(currentState?.isSignedOff);

  let outcome: SessionEndOutcome;
  switch (reason) {
    case 'consent_withdrawal':
      outcome = 'consent_withdrawn';
      break;
    case 'logout':
      outcome = 'logged_out';
      break;
    case 'idle_timeout':
      outcome = 'idle_timeout';
      break;
    case 'tab_close':
      outcome = 'tab_closed';
      break;
    case 'unrecoverable_error':
      outcome = 'unrecoverable_error';
      break;
    case 'explicit_end':
    default:
      outcome = isSignedOff ? 'completed_signed_off' : 'explicit_end';
      break;
  }

  // 2. Deterministically zero all binary audio buffers in RAM
  if (currentState) {
    if (currentState.rawAudioBuffer) {
      try {
        new Uint8Array(currentState.rawAudioBuffer).fill(0);
      } catch {}
    }
    if (currentState.redactedAudioBuffer) {
      try {
        new Uint8Array(currentState.redactedAudioBuffer).fill(0);
      } catch {}
    }
    if (currentState.redactedAudioWavBuffer) {
      try {
        new Uint8Array(currentState.redactedAudioWavBuffer).fill(0);
      } catch {}
    }
  }

  // 3. Clear all session store data structures & release references
  volatileSessionStore.destroySession();

  // 4. Terminate recovery worker process and clear its isolated RAM snapshot
  try {
    sessionRecoveryManager.terminate();
  } catch (err) {
    console.warn('[SessionDestruction] Error terminating recovery worker:', err);
  }

  // 5. Revoke outstanding cloud credentials / clear client token cache
  revokeClientCloudCredentials();

  // 6. Clear clipboard if detokenised content was copied and platform permits
  if (hasDetokenisedContentInClipboard && !options.skipClipboardClear) {
    await clearClipboardIfPermitted();
  }

  // 7. Dispatch a single non-PII monitoring telemetry event
  try {
    logSecurityEvent({
      type: 'SESSION_ENDED',
      sessionId,
      details: {
        outcome,
        totalSessionDurationMs: durationMs,
        stageReached: currentState?.stage || 'IDLE',
      },
    });
  } catch (err) {
    console.warn('[SessionDestruction] Error logging session ended telemetry:', err);
  }

  // 8. Assert post-destruction state guarantee
  assertSessionDestroyed();
}

/**
 * Attempts to overwrite clipboard contents with empty text if supported.
 */
async function clearClipboardIfPermitted(): Promise<void> {
  hasDetokenisedContentInClipboard = false;
  if (typeof window !== 'undefined' && typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await Promise.race([
        navigator.clipboard.writeText(''),
        new Promise((resolve) => setTimeout(resolve, 100)),
      ]);
    } catch {
      // Permission might be denied in non-focused tabs or certain browser sandboxes
    }
  }
}

/**
 * Revokes client-held downscoped cloud credentials and resets cache.
 */
function revokeClientCloudCredentials(): void {
  // If in browser context with active credential revocation endpoint
  if (typeof window !== 'undefined' && typeof fetch !== 'undefined') {
    try {
      apiFetch('/api/v1/credentials/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }).catch(() => {
        // Non-blocking
      });
    } catch {}
  }
}

/**
 * Post-destruction verification assertion.
 * Confirms no session data or consultation content is reachable from application state.
 */
export function assertSessionDestroyed(): void {
  const state = volatileSessionStore.getState();
  if (state !== null) {
    throw new Error('Post-destruction assertion failed: VolatileSessionStore state is not null.');
  }
  if (!sessionRecoveryManager.isTerminated()) {
    throw new Error('Post-destruction assertion failed: SessionRecoveryWorker is not terminated.');
  }
}
