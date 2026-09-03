import { volatileSessionStore, type SessionState } from './volatileStore.ts';
import { handleWorkerMessage, type WorkerMessage, type WorkerResponse } from '../workers/recoveryWorker.ts';

/**
 * SessionRecoveryManager
 * 
 * Coordinates the SessionRecoveryWorker to protect against accidental browser tab reloads.
 * Synchronizes VolatileSessionStore state with the worker's memory.
 */
export class SessionRecoveryManager {
  private worker: Worker | null = null;
  private simulatedWorkerHandler: ((data: WorkerMessage) => void) | null = null;
  private responseCallbacks: Map<string, (response: any) => void> = new Map();

  constructor() {
    this.init();
  }

  public init(): void {
    if (typeof Worker !== 'undefined' && typeof window !== 'undefined') {
      try {
        const workerCode = `
          let snapshot = null;
          self.onmessage = function(e) {
            const data = e.data;
            if (data.type === 'SNAPSHOT_STORE') {
              snapshot = data.payload;
              self.postMessage({ type: 'SNAPSHOT_SAVED' });
            } else if (data.type === 'RESTORE_REQUEST') {
              self.postMessage({ type: 'RESTORE_RESPONSE', payload: snapshot });
            } else if (data.type === 'DESTROY_SESSION') {
              snapshot = null;
              self.postMessage({ type: 'SESSION_DESTROYED' });
            } else if (data.type === 'TERMINATE') {
              snapshot = null;
              self.close();
            }
          };
        `;
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const workerUrl = URL.createObjectURL(blob);
        this.worker = new Worker(workerUrl);

        this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
          this.handleResponse(e.data);
        };
      } catch (err) {
        this.setupSimulation();
      }
    } else {
      this.setupSimulation();
    }

    volatileSessionStore.setRecoverySnapshotHandler((state) => {
      this.storeSnapshot(state);
    });
  }

  private setupSimulation(): void {
    this.simulatedWorkerHandler = (msg: WorkerMessage) => {
      handleWorkerMessage(msg, (response) => {
        this.handleResponse(response);
      });
    };
  }

  public storeSnapshot(state: Readonly<SessionState> | null): void {
    const message: WorkerMessage = {
      type: 'SNAPSHOT_STORE',
      payload: state ? { ...state } : null,
    };

    if (this.worker) {
      this.worker.postMessage(message);
    } else if (this.simulatedWorkerHandler) {
      this.simulatedWorkerHandler(message);
    }
  }

  public async requestRestore(): Promise<SessionState | null> {
    return new Promise((resolve) => {
      this.responseCallbacks.set('RESTORE_RESPONSE', (responsePayload) => {
        if (responsePayload && typeof responsePayload === 'object' && responsePayload.sessionId) {
          volatileSessionStore.restoreFromSnapshot(responsePayload);
          resolve(responsePayload);
        } else {
          resolve(null);
        }
      });

      const message: WorkerMessage = { type: 'RESTORE_REQUEST' };
      if (this.worker) {
        this.worker.postMessage(message);
      } else if (this.simulatedWorkerHandler) {
        this.simulatedWorkerHandler(message);
      }
    });
  }

  public destroySession(): void {
    const message: WorkerMessage = { type: 'DESTROY_SESSION' };
    if (this.worker) {
      this.worker.postMessage(message);
    } else if (this.simulatedWorkerHandler) {
      this.simulatedWorkerHandler(message);
    }
  }

  private isTerminatedFlag = false;

  public isTerminated(): boolean {
    return this.isTerminatedFlag || (this.worker === null && this.simulatedWorkerHandler === null);
  }

  public terminate(): void {
    const message: WorkerMessage = { type: 'TERMINATE' };
    this.isTerminatedFlag = true;
    if (this.worker) {
      this.worker.postMessage(message);
      this.worker.terminate();
      this.worker = null;
    } else if (this.simulatedWorkerHandler) {
      this.simulatedWorkerHandler(message);
      this.simulatedWorkerHandler = null;
    }
  }

  public reinit(): void {
    this.isTerminatedFlag = false;
    this.init();
  }

  private handleResponse(response: WorkerResponse): void {
    if (response.type === 'RESTORE_RESPONSE') {
      const cb = this.responseCallbacks.get('RESTORE_RESPONSE');
      if (cb) {
        cb(response.payload);
        this.responseCallbacks.delete('RESTORE_RESPONSE');
      }
    }
  }
}

export const sessionRecoveryManager = new SessionRecoveryManager();

