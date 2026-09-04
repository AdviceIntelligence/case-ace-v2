/**
 * In-Memory Authentication Store
 * 
 * NON-NEGOTIABLE PRIVACY CONSTRAINT C1:
 * Auth tokens and user profile exist strictly in volatile memory.
 * No localStorage, no sessionStorage, no cookies containing session data.
 */

export type UserRole = 'adviser' | 'supervisor' | 'administrator' | 'auditor';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  mfaVerified: boolean;
  provider: 'entra_id' | 'totp';
  issuedAt: number;
  expiresAt: number;
}

export interface AuthState {
  isAuthenticated: boolean;
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  sessionStartTime: number | null;
}

type AuthListener = (state: AuthState) => void;

class VolatileAuthStore {
  private state: AuthState = {
    isAuthenticated: false,
    user: null,
    accessToken: null,
    refreshToken: null,
    sessionStartTime: null,
  };

  private listeners: Set<AuthListener> = new Set();

  public getState(): AuthState {
    return { ...this.state };
  }

  public getAccessToken(): string | null {
    return this.state.accessToken;
  }

  public getRefreshToken(): string | null {
    return this.state.refreshToken;
  }

  public subscribe(listener: AuthListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  public setAuthenticated(user: AuthUser, accessToken: string, refreshToken: string): void {
    this.state = {
      isAuthenticated: true,
      user,
      accessToken,
      refreshToken,
      sessionStartTime: Date.now(),
    };
    this.notify();
  }

  public setTokens(accessToken: string, refreshToken?: string): void {
    this.state.accessToken = accessToken;
    if (refreshToken) {
      this.state.refreshToken = refreshToken;
    }
    this.notify();
  }

  /**
   * Destructively clears all authentication state from volatile memory.
   */
  public clearAuth(): void {
    this.state = {
      isAuthenticated: false,
      user: null,
      accessToken: null,
      refreshToken: null,
      sessionStartTime: null,
    };
    this.notify();
  }

  private notify(): void {
    const currentState = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(currentState);
      } catch (err) {
        console.error('Error in auth listener:', err);
      }
    }
  }
}

export const volatileAuthStore = new VolatileAuthStore();
