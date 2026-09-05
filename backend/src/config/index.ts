import dotenv from 'dotenv';
import type { AuthConfig, UserRole } from '../auth/types.ts';
dotenv.config();

export type EnvironmentName = 'local' | 'test' | 'pilot';

export interface BackendConfig {
  env: EnvironmentName;
  port: number;
  gcpRegion: 'europe-west2';
  gcpProjectId: string;
  corsOrigins: string[];
  cspConnectAllowlist: string[];
  isSyntheticOnly: boolean;
  auth: AuthConfig;
}

const envName: EnvironmentName = (process.env.APP_ENV as EnvironmentName) || 'local';

const defaultGroupRoleMap: Record<string, UserRole> = {
  'grp-caw-advisers': 'adviser',
  'grp-caw-supervisors': 'supervisor',
  'grp-caw-admins': 'administrator',
  'grp-caw-auditors': 'auditor',
};

/**
 * Development-only signing key. This value is committed to the repository and is therefore
 * public to anyone with repository access. It exists so that local and test environments,
 * which never handle real client data, can run without configuration. It must never sign a
 * token in the pilot environment: see resolvePilotJwtSecret below.
 */
const DEVELOPMENT_JWT_SECRET = 'caw-case-ace-london-jwt-dev-secret-minimum-32-chars-long!';
const MINIMUM_JWT_SECRET_LENGTH = 32;

const jwtSecret = process.env.JWT_SECRET || DEVELOPMENT_JWT_SECRET;

/**
 * Returns the pilot signing key, or refuses to start.
 *
 * Adviser session tokens authorise access to client consultations. If the pilot ever fell
 * back to the committed development key, anyone able to read this repository could mint a
 * valid adviser session. Failing to start is the correct behaviour: a backend that will not
 * boot is a visible, immediate problem, whereas one running on a known key is an invisible,
 * indefinite one.
 *
 * The key is supplied from Secret Manager (secret name case-ace-jwt-secret) by the
 * --set-secrets flag on the Cloud Run deployment. See docs/technical/deployment-runbook.md.
 */
function resolvePilotJwtSecret(): string {
  const supplied = process.env.JWT_SECRET;

  if (!supplied || supplied.trim() === '') {
    throw new Error(
      '[CONFIG] Refusing to start: JWT_SECRET is not set in the pilot environment. ' +
        'Supply it from Secret Manager (case-ace-jwt-secret). Adviser session tokens must ' +
        'never be signed with the development fallback key committed to this repository.'
    );
  }

  if (supplied === DEVELOPMENT_JWT_SECRET) {
    throw new Error(
      '[CONFIG] Refusing to start: JWT_SECRET is set to the development fallback key, which ' +
        'is committed to this repository and is not secret. Supply a real secret from ' +
        'Secret Manager (case-ace-jwt-secret).'
    );
  }

  if (supplied.length < MINIMUM_JWT_SECRET_LENGTH) {
    throw new Error(
      `[CONFIG] Refusing to start: JWT_SECRET is ${supplied.length} characters. ` +
        `A minimum of ${MINIMUM_JWT_SECRET_LENGTH} is required.`
    );
  }

  return supplied;
}

/**
 * Deliberate override of the pilot TOTP prohibition, for use only while the Entra ID
 * tenant is not yet available. Documented in docs/authentication-and-authorisation.md s3.2.
 * MUST be unset before real client consultations are processed in the pilot environment.
 */
const allowTotpInPilot = process.env.ALLOW_TOTP_IN_PILOT === 'true';

const configs: Record<EnvironmentName, BackendConfig> = {
  local: {
    env: 'local',
    port: parseInt(process.env.PORT || '8080', 10),
    gcpRegion: 'europe-west2',
    gcpProjectId: process.env.GCP_PROJECT_ID || 'caw-case-ace-local',
    corsOrigins: ['http://localhost:5173', 'http://localhost:4173'],
    cspConnectAllowlist: ["'self'", 'http://localhost:8080', 'ws://localhost:5173'],
    isSyntheticOnly: true,
    auth: {
      activeProvider: (process.env.AUTH_PROVIDER as 'entra_id' | 'totp') || 'totp',
      enableEntraId: process.env.AUTH_PROVIDER === 'entra_id',
      enableTotp: process.env.AUTH_PROVIDER !== 'entra_id', // default to totp in local
      jwtSecret,
      accessTokenTtlSeconds: 900, // 15 minutes
      refreshTokenTtlSeconds: 28800, // 8 hours absolute session cap
      absoluteSessionCapSeconds: 28800,
      idleTimeoutSeconds: 900,
      entraId: {
        tenantId: process.env.ENTRA_TENANT_ID || 'caw-wandsworth-tenant-id',
        clientId: process.env.ENTRA_CLIENT_ID || 'caw-case-ace-client-id',
        groupRoleMap: defaultGroupRoleMap,
      },
    },
  },
  test: {
    env: 'test',
    port: parseInt(process.env.PORT || '8080', 10),
    gcpRegion: 'europe-west2',
    gcpProjectId: process.env.GCP_PROJECT_ID || 'caw-case-ace-test',
    corsOrigins: ['https://test.caw-case-ace.internal'],
    cspConnectAllowlist: ["'self'", 'https://test-api.caw-case-ace.internal'],
    isSyntheticOnly: true,
    auth: {
      activeProvider: 'totp',
      enableEntraId: false,
      enableTotp: true,
      jwtSecret,
      accessTokenTtlSeconds: 900,
      refreshTokenTtlSeconds: 28800,
      absoluteSessionCapSeconds: 28800,
      idleTimeoutSeconds: 900,
      entraId: {
        tenantId: 'test-tenant',
        clientId: 'test-client',
        groupRoleMap: defaultGroupRoleMap,
      },
    },
  },
  pilot: {
    env: 'pilot',
    port: parseInt(process.env.PORT || '8080', 10),
    gcpRegion: 'europe-west2',
    gcpProjectId: process.env.GCP_PROJECT_ID || 'case-ace-v2',
    corsOrigins: [
      'https://caseace.adviceintelligence.tech',
      'https://api.caseace.adviceintelligence.tech',
      'https://adviceintelligence.tech',
      ...(process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : []),
    ],
    cspConnectAllowlist: [
      "'self'",
      'https://api.caseace.adviceintelligence.tech',
      'https://caseace.adviceintelligence.tech',
      'https://europe-west2-speech.googleapis.com',
      'https://europe-west2-aiplatform.googleapis.com',
    ],
    isSyntheticOnly: false,
    auth: {
      activeProvider: allowTotpInPilot ? 'totp' : 'entra_id',
      enableEntraId: !allowTotpInPilot,
      enableTotp: allowTotpInPilot, // TOTP disabled in pilot unless ALLOW_TOTP_IN_PILOT=true
      allowTotpInPilot,
      // Evaluated only when pilot is the active environment, so that local and test runs are
      // not forced to supply a secret they do not need.
      jwtSecret: envName === 'pilot' ? resolvePilotJwtSecret() : jwtSecret,
      accessTokenTtlSeconds: 900,
      refreshTokenTtlSeconds: 28800,
      absoluteSessionCapSeconds: 28800,
      idleTimeoutSeconds: 900,
      entraId: {
        tenantId: process.env.ENTRA_TENANT_ID || 'caw-wandsworth-prod-tenant',
        clientId: process.env.ENTRA_CLIENT_ID || 'caw-case-ace-prod-client',
        clientSecret: process.env.ENTRA_CLIENT_SECRET,
        groupRoleMap: defaultGroupRoleMap,
      },
    },
  },
};

export const config: BackendConfig = configs[envName] || configs.local;
