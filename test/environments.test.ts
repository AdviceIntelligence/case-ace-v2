import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Environment Isolation & UK Region Pinning', () => {
  const rootDir = process.cwd();
  const clientEnvPath = path.join(rootDir, 'client/src/config/environments.ts');
  const backendConfigPath = path.join(rootDir, 'backend/src/config/index.ts');
  const cloudRunPath = path.join(rootDir, 'infrastructure/gcp/cloud-run.yaml');

  const clientEnvContent = fs.readFileSync(clientEnvPath, 'utf8');
  const backendConfigContent = fs.readFileSync(backendConfigPath, 'utf8');
  const cloudRunContent = fs.readFileSync(cloudRunPath, 'utf8');

  it('strictly pins GCP region to europe-west2 (London)', () => {
    expect(clientEnvContent).toContain("gcpRegion: 'europe-west2'");
    expect(backendConfigContent).toContain("gcpRegion: 'europe-west2'");
    expect(cloudRunContent).toContain('europe-west2');
  });

  it('enforces synthetic data only in local and test environments', () => {
    expect(clientEnvContent).toMatch(/name:\s*'local'[\s\S]*?isSyntheticOnly:\s*true/);
    expect(clientEnvContent).toMatch(/name:\s*'test'[\s\S]*?isSyntheticOnly:\s*true/);
    expect(clientEnvContent).toMatch(/name:\s*'pilot'[\s\S]*?isSyntheticOnly:\s*false/);
  });

  it('ensures local development forbids real client data', () => {
    expect(clientEnvContent).toMatch(/name:\s*'local'[\s\S]*?allowRealClientData:\s*false/);
    expect(clientEnvContent).toMatch(/name:\s*'test'[\s\S]*?allowRealClientData:\s*false/);
  });
});
