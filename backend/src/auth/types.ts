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

export interface AuthResult {
  success: boolean;
  user?: AuthUser;
  accessToken?: string;
  refreshToken?: string;
  error?: string;
  errorCode?: 'INVALID_CREDENTIALS' | 'MFA_REQUIRED' | 'ACCOUNT_LOCKED' | 'ACCESS_DENIED' | 'TOKEN_EXPIRED' | 'AUTHENTICATION_FAILED';
}

export interface EntraIdAuthParams {
  authorizationCode: string;
  codeVerifier: string;
  redirectUri: string;
}

export interface TotpAuthParams {
  username: string;
  passwordHash: string;
  totpCode: string;
}

export interface AuthConfig {
  activeProvider: 'entra_id' | 'totp';
  enableEntraId: boolean;
  enableTotp: boolean;
  /**
   * Deliberate, environment-gated override of the pilot TOTP prohibition.
   * Set only via ALLOW_TOTP_IN_PILOT=true. See docs/authentication-and-authorisation.md s3.2.
   * Must be false before real client consultations are processed.
   */
  allowTotpInPilot?: boolean;
  jwtSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  absoluteSessionCapSeconds: number;
  idleTimeoutSeconds: number;
  entraId: {
    tenantId: string;
    clientId: string;
    clientSecret?: string;
    groupRoleMap: Record<string, UserRole>;
  };
}

export interface AuthProvider {
  readonly providerType: 'entra_id' | 'totp';
  authenticate(params: EntraIdAuthParams | TotpAuthParams): Promise<AuthResult>;
  verifyToken(token: string): Promise<AuthUser | null>;
  refreshToken(refreshToken: string): Promise<AuthResult>;
}

// Runtime marker for Node module resolution
export const AUTH_TYPES_VERSION = '2.0.0';
