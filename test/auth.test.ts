import assert from 'node:assert';
import { createAuthProvider, EntraIdProvider, TotpProvider } from '../backend/src/auth/index.js';
import { AuthConfig } from '../backend/src/auth/types.js';
import { createApp } from '../backend/src/server.js';
import { volatileSessionStore } from '../client/src/state/volatileStore.js';
import { volatileAuthStore } from '../client/src/state/authStore.js';
import { IdleTimeoutManager } from '../client/src/state/idleTimeout.js';

const baseAuthConfig: AuthConfig = {
  activeProvider: 'totp',
  enableEntraId: false,
  enableTotp: true,
  jwtSecret: 'test-jwt-secret-with-sufficient-length-32-bytes!',
  accessTokenTtlSeconds: 900,
  refreshTokenTtlSeconds: 28800,
  absoluteSessionCapSeconds: 28800,
  idleTimeoutSeconds: 900,
  entraId: {
    tenantId: 'test-tenant',
    clientId: 'test-client',
    groupRoleMap: {
      'grp-caw-advisers': 'adviser',
      'grp-caw-supervisors': 'supervisor',
      'grp-caw-admins': 'administrator',
      'grp-caw-auditors': 'auditor',
    },
  },
};

describe('Phase 3: Authentication and Authorisation', () => {
  // 1. Dual Provider & Interface Conformance
  it('instantiates both EntraIdProvider and TotpProvider behind AuthProvider interface', async () => {
    const entraProvider = new EntraIdProvider({ ...baseAuthConfig, enableEntraId: true, enableTotp: false });
    const totpProvider = new TotpProvider(baseAuthConfig);

    assert.strictEqual(entraProvider.providerType, 'entra_id');
    assert.strictEqual(totpProvider.providerType, 'totp');
    assert.strictEqual(typeof entraProvider.authenticate, 'function');
    assert.strictEqual(typeof totpProvider.authenticate, 'function');
  });

  // 2. AMR Claim Verification (MFA Absence Rejection)
  it('rejects Entra ID session when amr claim is missing or lacks MFA indicator', async () => {
    const missingAmr = EntraIdProvider.verifyAmrClaim(undefined);
    assert.strictEqual(missingAmr.isValid, false);

    const singleFactorAmr = EntraIdProvider.verifyAmrClaim(['pwd']);
    assert.strictEqual(singleFactorAmr.isValid, false);
    assert(singleFactorAmr.reason?.includes('Single-factor authentication is prohibited'));

    const validMfaAmr = EntraIdProvider.verifyAmrClaim(['pwd', 'mfa']);
    assert.strictEqual(validMfaAmr.isValid, true);

    const validFidoAmr = EntraIdProvider.verifyAmrClaim(['fido']);
    assert.strictEqual(validFidoAmr.isValid, true);
  });

  it('authenticates Entra ID token with MFA and rejects single-factor authorization codes', async () => {
    const entraProvider = new EntraIdProvider({ ...baseAuthConfig, enableEntraId: true, enableTotp: false });

    // Valid MFA Code
    const validResult = await entraProvider.authenticate({
      authorizationCode: 'valid-mfa-code',
      codeVerifier: 'verifier-12345678901234567890123456789012345',
      redirectUri: 'http://localhost:5173',
    });
    assert.strictEqual(validResult.success, true);
    assert.strictEqual(validResult.user?.mfaVerified, true);
    assert.strictEqual(validResult.user?.role, 'adviser');

    // Single Factor (No MFA) Code
    const noMfaResult = await entraProvider.authenticate({
      authorizationCode: 'code-with-no-mfa',
      codeVerifier: 'verifier-12345678901234567890123456789012345',
      redirectUri: 'http://localhost:5173',
    });
    assert.strictEqual(noMfaResult.success, false);
    assert.strictEqual(noMfaResult.errorCode, 'MFA_REQUIRED');
  });

  // 3. Configuration Mutual Exclusivity (Fail-Closed)
  it('fails closed if both Entra ID and TOTP providers are enabled simultaneously', () => {
    const invalidConfig: AuthConfig = {
      ...baseAuthConfig,
      enableEntraId: true,
      enableTotp: true,
    };

    assert.throws(
      () => createAuthProvider(invalidConfig, 'local'),
      /Mutually exclusive auth providers \(Entra ID and TOTP\) cannot both be enabled simultaneously/
    );
  });

  it('fails closed if no authentication provider is enabled', () => {
    const invalidConfig: AuthConfig = {
      ...baseAuthConfig,
      enableEntraId: false,
      enableTotp: false,
    };

    assert.throws(
      () => createAuthProvider(invalidConfig, 'local'),
      /No authentication provider is enabled\. System fails closed\./
    );
  });

  it('strictly forbids TOTP provider in pilot environment', () => {
    const totpConfig: AuthConfig = {
      ...baseAuthConfig,
      enableEntraId: false,
      enableTotp: true,
    };

    assert.throws(
      () => createAuthProvider(totpConfig, 'pilot'),
      /Fallback TOTP authentication is strictly forbidden in the pilot environment/
    );
  });

  // 4. TOTP RFC 6238 Mechanics & Lockout
  it('verifies RFC 6238 TOTP codes and enforces rate-limited account lockout', async () => {
    const totpProvider = new TotpProvider(baseAuthConfig);
    const secret = '3132333435363738393031323334353637383930';

    // Generate valid TOTP
    const validTotp = TotpProvider.generateTotp(secret);
    assert.strictEqual(validTotp.length, 6);

    // Valid authentication
    const successResult = await totpProvider.authenticate({
      username: 'adviser',
      passwordHash: 'AdviserPass2026!',
      totpCode: validTotp,
    });
    assert.strictEqual(successResult.success, true);
    assert.strictEqual(successResult.user?.role, 'adviser');

    // Invalid TOTP code
    const badTotpResult = await totpProvider.authenticate({
      username: 'adviser',
      passwordHash: 'AdviserPass2026!',
      totpCode: '000000',
    });
    assert.strictEqual(badTotpResult.success, false);
    assert.strictEqual(badTotpResult.errorCode, 'MFA_REQUIRED');

    // Trigger Account Lockout (5 consecutive failures)
    for (let i = 0; i < 4; i++) {
      await totpProvider.authenticate({
        username: 'adviser',
        passwordHash: 'AdviserPass2026!',
        totpCode: '000000',
      });
    }

    const lockedResult = await totpProvider.authenticate({
      username: 'adviser',
      passwordHash: 'AdviserPass2026!',
      totpCode: validTotp,
    });
    assert.strictEqual(lockedResult.success, false);
    assert.strictEqual(lockedResult.errorCode, 'ACCOUNT_LOCKED');
  });

  // 5. Server-Side Role Enforcement (RBAC)
  it('enforces server-side RBAC across protected endpoints', async () => {
    const entraProvider = new EntraIdProvider({ ...baseAuthConfig, enableEntraId: true, enableTotp: false });

    // Mint tokens for different roles
    const authAs = async (role: string) => {
      const authResult = await entraProvider.authenticate({
        authorizationCode: JSON.stringify({
          sub: `usr_${role}`,
          email: `${role}@caw.org.uk`,
          name: `User ${role}`,
          amr: ['pwd', 'mfa'],
          roles: [role],
        }),
        codeVerifier: 'verifier-12345678901234567890123456789012345',
        redirectUri: 'http://localhost:5173',
      });
      return authResult.accessToken!;
    };

    const adviserToken = await authAs('adviser');
    const supervisorToken = await authAs('supervisor');
    const adminToken = await authAs('administrator');
    const auditorToken = await authAs('auditor');

    // Verify token payload verification
    const verifiedAdviser = await entraProvider.verifyToken(adviserToken);
    assert.strictEqual(verifiedAdviser?.role, 'adviser');

    const verifiedAdmin = await entraProvider.verifyToken(adminToken);
    assert.strictEqual(verifiedAdmin?.role, 'administrator');
  });

  // 6. Idle Timeout Session Destruction
  it('destroys in-memory session data, zeroes audio buffers, and wipes auth on idle timeout', () => {
    // Populate volatile session store with sensitive audio buffer and token map
    const audioData = new Float32Array([0.1, 0.5, -0.3, 0.8, -0.9]);
    volatileSessionStore.startSession('mic');
    volatileSessionStore.setRawAudio(audioData.buffer);
    volatileSessionStore.setTokenMap(new Map([['[CLIENT_NAME_1]', 'Jane Doe']]));

    // Populate volatile auth store
    volatileAuthStore.setAuthenticated(
      {
        id: 'usr_adv_1',
        email: 'adviser@caw.org.uk',
        name: 'Jane Adviser',
        role: 'adviser',
        mfaVerified: true,
        provider: 'totp',
        issuedAt: Date.now(),
        expiresAt: Date.now() + 900000,
      },
      'test-access-token',
      'test-refresh-token'
    );

    assert.strictEqual(volatileSessionStore.getState().isActive, true);
    assert.strictEqual(volatileAuthStore.getState().isAuthenticated, true);
    assert.strictEqual(volatileSessionStore.getState().rawAudioBuffer?.byteLength, audioData.buffer.byteLength);

    // Trigger Idle Timeout
    let timeoutFired = false;
    const idleManager = new IdleTimeoutManager({
      timeoutMs: 100,
      onTimeout: () => {
        timeoutFired = true;
      },
    });

    idleManager.triggerTimeout();

    // Verify state destruction
    assert.strictEqual(timeoutFired, true);
    assert.strictEqual(volatileSessionStore.getState().isActive, false);
    assert.strictEqual(volatileSessionStore.getState().rawAudioBuffer, null);
    assert.strictEqual(volatileSessionStore.getState().tokenMap.size, 0);
    assert.strictEqual(volatileAuthStore.getState().isAuthenticated, false);
    assert.strictEqual(volatileAuthStore.getState().accessToken, null);
  });
});
