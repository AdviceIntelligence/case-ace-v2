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

const jwtSecret = process.env.JWT_SECRET || 'caw-case-ace-london-jwt-dev-secret-minimum-32-chars-long!';

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
      'https://webexapis.com',
    ],
    isSyntheticOnly: false,
    auth: {
      activeProvider: allowTotpInPilot ? 'totp' : 'entra_id',
      enableEntraId: !allowTotpInPilot,
      enableTotp: allowTotpInPilot, // TOTP disabled in pilot unless ALLOW_TOTP_IN_PILOT=true
      allowTotpInPilot,
      jwtSecret: process.env.JWT_SECRET || jwtSecret,
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
