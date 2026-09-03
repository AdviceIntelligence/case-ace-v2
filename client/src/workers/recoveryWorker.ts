/**
 * SessionRecoveryWorker
 * 
 * Dedicated Web Worker holding volatile session backup in its isolated RAM.
 * Allows accidental page reload recovery within the same browser tab/process
 * without writing any data to non-volatile storage.
 * 
 * Strict Invariant (Constraint C3):
 * - ZERO persistent storage (no IndexedDB, no Cache API, no localStorage).
 * - Terminated immediately on browser close, logout, idle timeout, or explicit session end.
 */

export interface WorkerMessage {
  type: 'SNAPSHOT_STORE' | 'RESTORE_REQUEST' | 'DESTROY_SESSION' | 'TERMINATE';
  payload?: any;
}

export interface WorkerResponse {
  type: 'RESTORE_RESPONSE' | 'SNAPSHOT_SAVED' | 'SESSION_DESTROYED' | 'PONG';
  payload?: any;
}

let sessionSnapshot: any = null;

export function handleWorkerMessage(data: WorkerMessage, post: (msg: WorkerResponse) => void, closeSelf?: () => void): void {
  switch (data.type) {
    case 'SNAPSHOT_STORE':
      sessionSnapshot = data.payload ? { ...data.payload } : null;
      post({ type: 'SNAPSHOT_SAVED' });
      break;

    case 'RESTORE_REQUEST':
      post({ type: 'RESTORE_RESPONSE', payload: sessionSnapshot });
      break;

    case 'DESTROY_SESSION':
      if (sessionSnapshot) {
        if (sessionSnapshot.rawAudioBuffer) {
          try {
            new Uint8Array(sessionSnapshot.rawAudioBuffer).fill(0);
          } catch {}
        }
        if (sessionSnapshot.redactedAudioBuffer) {
          try {
            new Uint8Array(sessionSnapshot.redactedAudioBuffer).fill(0);
          } catch {}
        }
        if (sessionSnapshot.redactedAudioWavBuffer) {
          try {
            new Uint8Array(sessionSnapshot.redactedAudioWavBuffer).fill(0);
          } catch {}
        }
      }
      sessionSnapshot = null;
      post({ type: 'SESSION_DESTROYED' });
      break;

    case 'TERMINATE':
      if (sessionSnapshot) {
        if (sessionSnapshot.rawAudioBuffer) {
          try {
            new Uint8Array(sessionSnapshot.rawAudioBuffer).fill(0);
          } catch {}
        }
        if (sessionSnapshot.redactedAudioBuffer) {
          try {
            new Uint8Array(sessionSnapshot.redactedAudioBuffer).fill(0);
          } catch {}
        }
        if (sessionSnapshot.redactedAudioWavBuffer) {
          try {
            new Uint8Array(sessionSnapshot.redactedAudioWavBuffer).fill(0);
          } catch {}
        }
        sessionSnapshot = null;
      }
      if (typeof closeSelf === 'function') {
        closeSelf();
      }
      break;
  }
}

// In standard Web Worker context:
if (typeof self !== 'undefined' && typeof (self as any).postMessage === 'function' && typeof window === 'undefined') {
  self.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
    handleWorkerMessage(
      event.data,
      (msg) => self.postMessage(msg),
      () => self.close()
    );
  });
}
