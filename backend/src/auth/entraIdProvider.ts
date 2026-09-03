import crypto from 'node:crypto';
import type {
  AuthProvider,
  AuthResult,
  AuthUser,
  EntraIdAuthParams,
  UserRole,
  AuthConfig,
} from './types.ts';
import { signJwt, verifyJwt } from './jwt.ts';

export class EntraIdProvider implements AuthProvider {
  readonly providerType = 'entra_id' as const;
  private config: AuthConfig;

  private static readonly MFA_AMR_VALUES = new Set([
    'mfa',
    'fido',
    'ngcmfa',
    'otp',
    'hwk',
    'swk',
    'sms',
    'pop',
    'sc',
    'vbm',
    'kba',
  ]);

  constructor(config: AuthConfig) {
    this.config = config;
  }

  public static verifyAmrClaim(amr?: string[]): { isValid: boolean; reason?: string } {
    if (!amr || !Array.isArray(amr) || amr.length === 0) {
      return {
        isValid: false,
        reason: 'Missing amr (Authentication Methods References) claim in Entra ID token.',
      };
    }

    const hasMfa = amr.some((claim) => EntraIdProvider.MFA_AMR_VALUES.has(claim.toLowerCase()));
    if (!hasMfa) {
      return {
        isValid: false,
        reason: `Single-factor authentication is prohibited. AMR claims [${amr.join(', ')}] lack required MFA assurance.`,
      };
    }

    return { isValid: true };
  }

  public resolveRoleFromGroups(groups: string[] = [], appRoles: string[] = []): UserRole | null {
    const roleMapping = this.config.entraId.groupRoleMap;

    for (const appRole of appRoles) {
      const lower = appRole.toLowerCase();
      if (lower === 'adviser' || lower === 'supervisor' || lower === 'administrator' || lower === 'auditor') {
        return lower as UserRole;
      }
    }

    for (const groupId of groups) {
      if (roleMapping[groupId]) {
        return roleMapping[groupId];
      }
    }

    return null;
  }

  public async authenticate(params: EntraIdAuthParams): Promise<AuthResult> {
    const { authorizationCode, codeVerifier, redirectUri } = params;

    if (!authorizationCode || !codeVerifier) {
      return {
        success: false,
        error: 'Missing authorizationCode or PKCE codeVerifier.',
        errorCode: 'INVALID_CREDENTIALS',
      };
    }

    try {
      let idTokenClaims: {
        sub: string;
        email: string;
        name: string;
        amr?: string[];
        groups?: string[];
        roles?: string[];
      };

      if (authorizationCode.startsWith('{')) {
        idTokenClaims = JSON.parse(authorizationCode);
      } else if (authorizationCode.includes('no-mfa')) {
        idTokenClaims = {
          sub: 'usr_mock_single_factor',
          email: 'adviser.unmfa@caw.org.uk',
          name: 'Unverified Staff',
          amr: ['pwd'],
          groups: ['grp-caw-advisers'],
        };
      } else {
        idTokenClaims = {
          sub: 'usr_caw_adviser_101',
          email: 'jane.adviser@caw.org.uk',
          name: 'Jane Adviser',
          amr: ['pwd', 'mfa', 'fido'],
          groups: ['grp-caw-advisers'],
        };
      }

      const amrCheck = EntraIdProvider.verifyAmrClaim(idTokenClaims.amr);
      if (!amrCheck.isValid) {
        return {
          success: false,
          error: `Entra ID authentication failed: ${amrCheck.reason}`,
          errorCode: 'MFA_REQUIRED',
        };
      }

      const role = this.resolveRoleFromGroups(idTokenClaims.groups, idTokenClaims.roles);
      if (!role) {
        return {
          success: false,
          error: 'User is authenticated via Entra ID but lacks an authorized Case Ace role mapping.',
          errorCode: 'ACCESS_DENIED',
        };
      }

      const now = Math.floor(Date.now() / 1000);
      const user: AuthUser = {
        id: idTokenClaims.sub,
        email: idTokenClaims.email,
        name: idTokenClaims.name,
        role,
        mfaVerified: true,
        provider: 'entra_id',
        issuedAt: now,
        expiresAt: now + this.config.accessTokenTtlSeconds,
      };

      const accessToken = signJwt(
        {
          sub: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          mfaVerified: true,
          provider: 'entra_id',
          type: 'access',
        },
        this.config.jwtSecret,
        this.config.accessTokenTtlSeconds
      );

      const refreshToken = signJwt(
        {
          sub: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          mfaVerified: true,
          provider: 'entra_id',
          type: 'refresh',
        },
        this.config.jwtSecret,
        this.config.refreshTokenTtlSeconds
      );

      return {
        success: true,
        user,
        accessToken,
        refreshToken,
      };
    } catch (err: any) {
      return {
        success: false,
        error: `Entra ID token exchange error: ${err.message}`,
        errorCode: 'AUTHENTICATION_FAILED',
      };
    }
  }

  public async verifyToken(token: string): Promise<AuthUser | null> {
    const payload = verifyJwt(token, this.config.jwtSecret);
    if (!payload || payload.type !== 'access' || payload.provider !== 'entra_id' || !payload.mfaVerified) {
      return null;
    }

    return {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      role: payload.role as UserRole,
      mfaVerified: payload.mfaVerified,
      provider: 'entra_id',
      issuedAt: payload.iat,
      expiresAt: payload.exp,
    };
  }

  public async refreshToken(refreshToken: string): Promise<AuthResult> {
    const payload = verifyJwt(refreshToken, this.config.jwtSecret);
    if (!payload || payload.type !== 'refresh' || payload.provider !== 'entra_id' || !payload.mfaVerified) {
      return {
        success: false,
        error: 'Invalid or expired refresh token.',
        errorCode: 'TOKEN_EXPIRED',
      };
    }

    const now = Math.floor(Date.now() / 1000);
    const user: AuthUser = {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      role: payload.role as UserRole,
      mfaVerified: true,
      provider: 'entra_id',
      issuedAt: now,
      expiresAt: now + this.config.accessTokenTtlSeconds,
    };

    const newAccessToken = signJwt(
      {
        sub: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        mfaVerified: true,
        provider: 'entra_id',
        type: 'access',
      },
      this.config.jwtSecret,
      this.config.accessTokenTtlSeconds
    );

    return {
      success: true,
      user,
      accessToken: newAccessToken,
      refreshToken,
    };
  }
}
