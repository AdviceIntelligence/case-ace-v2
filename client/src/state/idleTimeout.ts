import { volatileAuthStore } from './authStore.ts';
import { destroySession } from './sessionDestruction.ts';

/**
 * IdleTimeoutManager
 * 
 * Enforces strict 15-minute inactivity timeout.
 * When timeout fires, destroys all volatile memory (buffers, tokens, session data)
 * and logs the user out.
 */
export class IdleTimeoutManager {
  private timeoutMs: number;
  private timerId: any = null;
  private isRunning: boolean = false;
  private onTimeoutCallback: (() => void) | null = null;

  constructor(timeoutMinutes: number = 15) {
    this.timeoutMs = timeoutMinutes * 60 * 1000;
  }

  public start(onTimeout?: () => void): void {
    if (onTimeout) {
      this.onTimeoutCallback = onTimeout;
    }
    this.isRunning = true;
    this.reset();
    this.attachListeners();
  }

  public stop(): void {
    this.isRunning = false;
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.detachListeners();
  }

  public reset = (): void => {
    if (!this.isRunning) return;
    if (this.timerId) {
      clearTimeout(this.timerId);
    }
    this.timerId = setTimeout(() => {
      this.handleTimeout();
    }, this.timeoutMs);
    if (this.timerId && typeof (this.timerId as any).unref === 'function') {
      (this.timerId as any).unref();
    }
  };

  private handleTimeout(): void {
    destroySession({ reason: 'idle_timeout' }).catch((err) => {
      console.warn('[IdleTimeout] destroySession error:', err);
    });
    volatileAuthStore.clearAuth();

    if (this.onTimeoutCallback) {
      this.onTimeoutCallback();
    }

    this.stop();
  }

  private attachListeners(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('mousemove', this.reset, { passive: true });
      window.addEventListener('keydown', this.reset, { passive: true });
      window.addEventListener('touchstart', this.reset, { passive: true });
      window.addEventListener('scroll', this.reset, { passive: true });
    }
  }

  private detachListeners(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('mousemove', this.reset);
      window.removeEventListener('keydown', this.reset);
      window.removeEventListener('touchstart', this.reset);
      window.removeEventListener('scroll', this.reset);
    }
  }
}

export const idleTimeoutManager = new IdleTimeoutManager(15);
