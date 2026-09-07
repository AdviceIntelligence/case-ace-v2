import { volatileAuthStore } from './authStore.ts';
import { destroySession } from './sessionDestruction.ts';

/**
 * IdleTimeoutManager
 *
 * Destroys the session and logs the adviser out after fifteen minutes with no mouse, key,
 * touch or scroll activity. The control exists to protect a workstation left unattended.
 *
 * It cannot run during a consultation. An adviser conducting an interview does not touch the
 * keyboard, and a genuine advice interview contains long silences: a client reading a letter,
 * finding a document, or taking the time they need to describe something difficult. Ten
 * minutes of quiet is ordinary. With the timer running, the session would be destroyed and
 * the recording zeroed part-way through, in front of the client.
 *
 * So work in progress suspends the timer rather than weakening it. A machine with a live
 * microphone in an advice interview is not an unattended machine. The timer resumes the
 * moment the work finishes, and a hard ceiling still ends a session that has genuinely been
 * abandoned mid-recording.
 */
export class IdleTimeoutManager {
  /**
   * Longest a session may stay suspended before the timeout applies anyway. Set beyond the
   * 90 minute cap on a single recording, so it can only be reached by a session nobody came
   * back to.
   */
  private static readonly MAX_SUSPENSION_MS = 3 * 60 * 60 * 1000;

  private timeoutMs: number;
  private timerId: any = null;
  private isRunning: boolean = false;
  private onTimeoutCallback: (() => void) | null = null;

  /** Named reasons the timer is currently held off. Empty means the timer runs. */
  private suspensions = new Set<string>();
  private suspendedSinceMs: number | null = null;
  private ceilingTimerId: any = null;

  constructor(timeoutMinutes: number = 15) {
    this.timeoutMs = timeoutMinutes * 60 * 1000;
  }

  /**
   * Holds the timeout off while something is genuinely in progress, such as recording a
   * consultation or transcribing one. Reasons nest: the timer resumes only when every
   * reason has been released.
   */
  public suspend(reason: string): void {
    const wasRunningFreely = this.suspensions.size === 0;
    this.suspensions.add(reason);

    if (wasRunningFreely) {
      this.suspendedSinceMs = Date.now();
      if (this.timerId) {
        clearTimeout(this.timerId);
        this.timerId = null;
      }
      // A session abandoned mid-recording must still end eventually.
      this.ceilingTimerId = setTimeout(() => {
        this.suspensions.clear();
        this.suspendedSinceMs = null;
        this.handleTimeout();
      }, IdleTimeoutManager.MAX_SUSPENSION_MS);
    }
  }

  public resume(reason: string): void {
    if (!this.suspensions.delete(reason)) return;
    if (this.suspensions.size > 0) return;

    this.suspendedSinceMs = null;
    if (this.ceilingTimerId) {
      clearTimeout(this.ceilingTimerId);
      this.ceilingTimerId = null;
    }
    this.reset();
  }

  public isSuspended(): boolean {
    return this.suspensions.size > 0;
  }

  /** How long the timeout has been held off, for the audit record. */
  public getSuspendedForMs(): number {
    return this.suspendedSinceMs === null ? 0 : Date.now() - this.suspendedSinceMs;
  }

  public getSuspensionReasons(): string[] {
    return [...this.suspensions];
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
    if (this.ceilingTimerId) {
      clearTimeout(this.ceilingTimerId);
      this.ceilingTimerId = null;
    }
    this.suspensions.clear();
    this.suspendedSinceMs = null;
    this.detachListeners();
  }

  public reset = (): void => {
    if (!this.isRunning) return;
    // While work is in progress the countdown does not exist, so there is nothing to reset.
    if (this.suspensions.size > 0) return;
    if (this.timerId) {
      clearTimeout(this.timerId);
    }
    this.timerId = setTimeout(() => {
      this.handleTimeout();
    }, this.timeoutMs);
    // Deliberately NOT unref'd. unref() is a no-op in the browser, which is this class's
    // only real runtime, but under Node it tells the event loop that this timer need not
    // keep the process alive. In the test runner that timer is the only live handle, so
    // Node exited cleanly mid-await and the remaining suites never ran while `npm test`
    // still reported success. A mandatory security timeout should also never be marked as
    // optional work.
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
