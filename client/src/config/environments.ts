/**
 * Environment configuration for Case Ace v2.0.
 * Strictly isolates runtime environments and enforces region pinning to europe-west2 (London).
 * No shared development environment ever touches real client data.
 */

export type EnvironmentName = 'local' | 'test' | 'pilot';

export interface EnvironmentConfig {
  name: EnvironmentName;
  apiBaseUrl: string;
  gcpRegion: 'europe-west2';
  gcpProjectId: string;
  isSyntheticOnly: boolean;
  allowRealClientData: boolean;
  cspConnectAllowlist: readonly string[];
  maxAudioDurationMinutes: number;
  features: {
    liveMicrophone: boolean;
    webexDialOut: boolean;
    fileImport: boolean;
  };
}

const ENVIRONMENTS: Record<EnvironmentName, EnvironmentConfig> = {
  local: {
    name: 'local',
    apiBaseUrl: 'http://localhost:8080',
    gcpRegion: 'europe-west2',
    gcpProjectId: 'case-ace-v2-local',
    isSyntheticOnly: true,
    allowRealClientData: false,
    cspConnectAllowlist: ['http://localhost:8080', 'ws://localhost:5173'],
    maxAudioDurationMinutes: 120,
    features: {
      liveMicrophone: true,
      webexDialOut: false, // Simulated in local
      fileImport: true,
    },
  },
  test: {
    name: 'test',
    apiBaseUrl: 'https://test-api.caw-case-ace.internal',
    gcpRegion: 'europe-west2',
    gcpProjectId: 'case-ace-v2-test',
    isSyntheticOnly: true,
    allowRealClientData: false,
    cspConnectAllowlist: ['https://test-api.caw-case-ace.internal'],
    maxAudioDurationMinutes: 120,
    features: {
      liveMicrophone: true,
      webexDialOut: true,
      fileImport: true,
    },
  },
  pilot: {
    name: 'pilot',
    apiBaseUrl: 'https://api.caseace.adviceintelligence.tech',
    gcpRegion: 'europe-west2',
    gcpProjectId: 'case-ace-v2',
    isSyntheticOnly: false,
    allowRealClientData: true,
    cspConnectAllowlist: [
      'https://api.caseace.adviceintelligence.tech',
      'https://caseace.adviceintelligence.tech',
      'https://europe-west2-speech.googleapis.com',
      'https://europe-west2-aiplatform.googleapis.com',
      'https://webexapis.com',
    ],
    maxAudioDurationMinutes: 120,
    features: {
      liveMicrophone: true,
      webexDialOut: true,
      fileImport: true,
    },
  },
};

/**
 * Resolves current active environment from build or runtime metadata.
 * Default is 'local' to ensure fail-closed security.
 */
export function getCurrentEnvironment(): EnvironmentConfig {
  const envName = (import.meta.env?.VITE_APP_ENV as EnvironmentName) || 'local';
  const config = ENVIRONMENTS[envName] || ENVIRONMENTS.local;
  return config;
}

export const environment = getCurrentEnvironment();
export { ENVIRONMENTS };
