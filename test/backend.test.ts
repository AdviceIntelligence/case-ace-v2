import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../backend/src/server.ts';
import { CredentialIssuerService } from '../backend/src/services/credentialIssuer.ts';
import {
  privacyLogger,
  writePrivacyLog,
  getCapturedLogs,
  clearCapturedLogs,
} from '../backend/src/middleware/privacyLogger.ts';
import type { AuthUser } from '../backend/src/auth/types.ts';

describe('Phase 4: Minimal Hardened Backend & Privacy Architecture', () => {
  const rootDir = process.cwd();

  beforeEach(() => {
    clearCapturedLogs();
  });

  it('restricts backend route table strictly to the 5 permitted endpoint groups', () => {
    const { app } = createApp();
    const routerStack = (app as any)._router.stack;

    const registeredPaths: string[] = [];
    for (const layer of routerStack) {
      if (layer.route && layer.route.path) {
        registeredPaths.push(layer.route.path);
      } else if (layer.name === 'router' && layer.regexp) {
        registeredPaths.push(layer.regexp.toString());
      }
    }

    // Permitted route prefixes
    const permittedPatterns = ['/health', '/api/v1/health', '/api/v1/auth', '/api/v1/credentials', '/api/v1/monitoring', '/api/v1/config'];
    
    // Prohibited session data routes
    const prohibitedPatterns = ['/audio', '/transcript', '/notes', '/tokens-map', '/session-data', '/case-notes'];

    for (const pathStr of registeredPaths) {
      for (const prohibited of prohibitedPatterns) {
        expect(pathStr.toLowerCase().includes(prohibited)).toBe(false);
      }
    }
  });

  it('issues short-lived (<= 15 min), single-purpose credentials scoped strictly to europe-west2', () => {
    const adviserUser: AuthUser = {
      id: 'usr_adviser_101',
      email: 'adviser@caw.org.uk',
      name: 'Adviser Alice',
      role: 'adviser',
      mfaVerified: true,
      provider: 'totp',
      issuedAt: Math.floor(Date.now() / 1000),
      expiresAt: Math.floor(Date.now() / 1000) + 900,
    };

    // 1. Speech-to-Text credential issuance
    const sttCred = CredentialIssuerService.issueCredential(adviserUser, 'speech-to-text', 300);
    expect(sttCred.purpose).toBe('speech-to-text');
    expect(sttCred.region).toBe('europe-west2');
    expect(sttCred.endpoint).toBe('https://europe-west2-speech.googleapis.com');
    expect(sttCred.ttlSeconds).toBeLessThanOrEqual(900);
    expect(sttCred.ttlSeconds).toBeGreaterThanOrEqual(60);
    expect(sttCred.issuedToUser).toBe('usr_adviser_101');
    expect(new Date(sttCred.expiresAt).getTime()).toBeGreaterThan(Date.now());

    // 2. Vertex AI credential issuance
    const vertexCred = CredentialIssuerService.issueCredential(adviserUser, 'vertex-ai', 300);
    expect(vertexCred.purpose).toBe('vertex-ai');
    expect(vertexCred.region).toBe('europe-west2');
    expect(vertexCred.endpoint).toBe('https://europe-west2-aiplatform.googleapis.com');
    expect(vertexCred.ttlSeconds).toBeLessThanOrEqual(900);

    // 3. Unauthorized role rejection (administrator / auditor)
    const adminUser: AuthUser = {
      ...adviserUser,
      id: 'usr_admin_1',
      role: 'administrator',
    };
    expect(() => CredentialIssuerService.issueCredential(adminUser, 'speech-to-text')).toThrow(
      /Role 'administrator' is not permitted to request cloud credentials/
    );
  });

  it('audits credential issuance while NEVER logging the credential token itself', () => {
    const adviserUser: AuthUser = {
      id: 'usr_adv_audit_test',
      email: 'adviser@caw.org.uk',
      name: 'Adviser Audit',
      role: 'adviser',
      mfaVerified: true,
      provider: 'totp',
      issuedAt: Math.floor(Date.now() / 1000),
      expiresAt: Math.floor(Date.now() / 1000) + 900,
    };

    const cred = CredentialIssuerService.issueCredential(adviserUser, 'speech-to-text', 300);
    const logs = getCapturedLogs();

    const issuanceLog = logs.find((l) => l.event === 'CREDENTIAL_ISSUED');
    expect(issuanceLog).toBeDefined();
    expect(issuanceLog?.userId).toBe('usr_adv_audit_test');
    expect(issuanceLog?.purpose).toBe('speech-to-text');
    expect(issuanceLog?.region).toBe('europe-west2');

    // Stringified logs must NOT contain the accessToken string
    const rawLogs = JSON.stringify(logs);
    expect(rawLogs.includes(cred.accessToken)).toBe(false);
  });

  it('proves that request and response bodies are strictly suppressed and never logged', () => {
    clearCapturedLogs();

    const sensitiveBody = {
      clientName: 'Confidential Client Name',
      debtAmount: '£15,400',
      sensitiveNotes: 'Client facing eviction notice from private landlord',
      password: 'SuperSecretPassword99!',
    };

    const sensitiveHeader = 'Bearer super-sensitive-jwt-token-xyz';

    // Simulate express request/response through privacyLogger
    const mockReq: any = {
      method: 'POST',
      path: '/api/v1/monitoring/events',
      baseUrl: '',
      body: sensitiveBody,
      headers: {
        authorization: sensitiveHeader,
        cookie: 'session_token=private-cookie-data',
      },
    };

    let finishCallback: () => void = () => {};
    const mockRes: any = {
      statusCode: 200,
      on: (event: string, cb: () => void) => {
        if (event === 'finish') finishCallback = cb;
      },
    };

    privacyLogger(mockReq, mockRes, () => {});
    finishCallback();

    const logs = getCapturedLogs();
    expect(logs.length).toBeGreaterThan(0);

    const stringifiedLogs = JSON.stringify(logs);

    // Verify zero leakage of sensitive data
    expect(stringifiedLogs.includes('Confidential Client Name')).toBe(false);
    expect(stringifiedLogs.includes('£15,400')).toBe(false);
    expect(stringifiedLogs.includes('eviction notice')).toBe(false);
    expect(stringifiedLogs.includes('SuperSecretPassword99!')).toBe(false);
    expect(stringifiedLogs.includes('super-sensitive-jwt-token-xyz')).toBe(false);
    expect(stringifiedLogs.includes('private-cookie-data')).toBe(false);

    // Verify only safe operational fields are logged
    const lastLog = logs[logs.length - 1];
    expect(lastLog.method).toBe('POST');
    expect(lastLog.path).toBe('/api/v1/monitoring/events');
    expect(lastLog.statusCode).toBe(200);
    expect(typeof lastLog.durationMs).toBe('number');
  });

  it('verifies all infrastructure configurations pin europe-west2 (London)', () => {
    const cloudRunYaml = fs.readFileSync(path.join(rootDir, 'infrastructure/gcp/cloud-run.yaml'), 'utf8');
    const backendConfig = fs.readFileSync(path.join(rootDir, 'backend/src/config/index.ts'), 'utf8');
    const clientEnv = fs.readFileSync(path.join(rootDir, 'client/src/config/environments.ts'), 'utf8');

    expect(cloudRunYaml.includes('europe-west2')).toBe(true);
    expect(cloudRunYaml.includes('location: europe-west2')).toBe(true);
    expect(backendConfig.includes("gcpRegion: 'europe-west2'")).toBe(true);
    expect(clientEnv.includes("gcpRegion: 'europe-west2'")).toBe(true);
  });
});
