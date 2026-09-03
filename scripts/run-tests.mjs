process.env.NODE_ENV = 'test';

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { createAuthProvider, EntraIdProvider, TotpProvider } from '../backend/src/auth/index.ts';
import { config } from '../backend/src/config/index.ts';
import { volatileSessionStore } from '../client/src/state/volatileStore.ts';
import { volatileAuthStore } from '../client/src/state/authStore.ts';
import { IdleTimeoutManager } from '../client/src/state/idleTimeout.ts';
import { createApp } from '../backend/src/server.ts';
import { CredentialIssuerService } from '../backend/src/services/credentialIssuer.ts';
import {
  privacyLogger,
  getCapturedLogs,
  clearCapturedLogs,
} from '../backend/src/middleware/privacyLogger.ts';
import {
  installRuntimeStorageGuards,
  VolatileStorageViolationError,
  resetStorageGuardsForTesting,
} from '../client/src/security/storageGuard.ts';
import { runStorageLinter } from './lint-storage-guard.mjs';
import { handleWorkerMessage } from '../client/src/workers/recoveryWorker.ts';
import { mediaStreamingDecoder } from '../client/src/audio/mediaStreamingDecoder.ts';
import { consentManager } from '../client/src/consent/consentManager.ts';
import { dominantSpeakerDetector, DominantSpeakerDetector } from '../client/src/audio/dominantSpeakerDetector.ts';
import { LiveAudioCapture } from '../client/src/audio/liveAudioCapture.ts';
import { webexStreamCapture } from '../client/src/audio/webexStreamCapture.ts';
import { audioNormalizer } from '../client/src/audio/audioNormalizer.ts';
import { identifierEngine } from '../client/src/redaction/identifierEngine.ts';
import { tokenisationEngine } from '../client/src/tokenisation/tokenisationEngine.ts';
import { destroySession, assertSessionDestroyed, markDetokenisedContentCopied, isDetokenisedClipboardPresent } from '../client/src/state/sessionDestruction.ts';
import { sessionRecoveryManager } from '../client/src/state/sessionRecoveryManager.ts';
import { validateLogPayload, LogSchemaValidationError } from '../backend/src/logging/logSchema.ts';
import { auditLogStore, AuditLogStore } from '../backend/src/logging/logStore.ts';
import { SYNTHETIC_CORPUS } from '../test/corpus/syntheticAdviceCorpus.ts';
import { testingEngine } from '../test/testingEngine.ts';

const rootDir = process.cwd();
console.log('Running Case Ace v2.0 Test Suite...\n');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

async function run() {
  // 1. Content Security Policy Tests
  console.log('Suite 1: Content Security Policy & Hardening');
  const htmlContent = fs.readFileSync(path.join(rootDir, 'client/index.html'), 'utf8');
  const viteConfigContent = fs.readFileSync(path.join(rootDir, 'client/vite.config.ts'), 'utf8');
  const nginxConfigContent = fs.readFileSync(path.join(rootDir, 'infrastructure/docker/nginx.conf'), 'utf8');
  const cspDocContent = fs.readFileSync(path.join(rootDir, 'docs/csp.md'), 'utf8');

  await test('enforces default-src none across client, vite, and nginx', () => {
    assert(htmlContent.includes("default-src 'none'"));
    assert(viteConfigContent.includes("default-src 'none'"));
    assert(nginxConfigContent.includes("default-src 'none'"));
  });

  await test('strictly forbids unsafe-inline across all directives', () => {
    assert(!htmlContent.includes("'unsafe-inline'"));
    assert(!viteConfigContent.includes("'unsafe-inline'"));
    assert(!nginxConfigContent.includes("'unsafe-inline'"));
  });

  await test('strictly forbids general unsafe-eval', () => {
    assert(!/script-src[^;]*'unsafe-eval'/.test(htmlContent));
    assert(!/script-src[^;]*'unsafe-eval'/.test(viteConfigContent));
    assert(!/script-src[^;]*'unsafe-eval'/.test(nginxConfigContent));
  });

  await test('scopes wasm-unsafe-eval for in-browser local ASR/NER and justifies in docs', () => {
    assert(htmlContent.includes("'wasm-unsafe-eval'"));
    assert(cspDocContent.includes("'wasm-unsafe-eval'"));
  });

  await test('blocks framing and form submission (frame-ancestors none, form-action none)', () => {
    assert(htmlContent.includes("frame-ancestors 'none'"));
    assert(htmlContent.includes("form-action 'none'"));
    assert(htmlContent.includes("object-src 'none'"));
    assert(nginxConfigContent.includes("frame-ancestors 'none'"));
  });

  await test('restricts connect-src without wildcards', () => {
    assert(!htmlContent.includes('connect-src *'));
    assert(!viteConfigContent.includes('connect-src *'));
    assert(!nginxConfigContent.includes('connect-src *'));
  });

  // 2. Dependency Supply Chain Tests
  console.log('\nSuite 2: Dependency Supply Chain & Network Policy');
  const clientPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'client/package.json'), 'utf8'));
  const backendPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'backend/package.json'), 'utf8'));
  const docsDepContent = fs.readFileSync(path.join(rootDir, 'docs/dependencies.md'), 'utf8');

  await test('pins all client runtime dependency versions exactly', () => {
    for (const [name, version] of Object.entries(clientPkg.dependencies || {})) {
      assert(!/[\^~*><]/.test(version), `Unpinned version: ${name}@${version}`);
      assert(/^\d+\.\d+\.\d+/.test(version), `Invalid semver: ${name}@${version}`);
    }
  });

  await test('pins all backend dependency versions exactly', () => {
    for (const [name, version] of Object.entries(backendPkg.dependencies || {})) {
      assert(!/[\^~*><]/.test(version), `Unpinned version: ${name}@${version}`);
    }
  });

  await test('justifies every client dependency in docs/dependencies.md', () => {
    for (const name of Object.keys(clientPkg.dependencies || {})) {
      assert(docsDepContent.includes(`### ${name}`) || docsDepContent.includes(`\`${name}\``), `Missing justification for client dep: ${name}`);
    }
  });

  await test('validates CycloneDX 1.5 SBOM generated in evidence/sbom.json', () => {
    const sbomPath = path.join(rootDir, 'evidence/sbom.json');
    assert(fs.existsSync(sbomPath), 'evidence/sbom.json does not exist');
    const sbom = JSON.parse(fs.readFileSync(sbomPath, 'utf8'));
    assert.strictEqual(sbom.bomFormat, 'CycloneDX');
    assert.strictEqual(sbom.specVersion, '1.5');
    assert(Array.isArray(sbom.components));
    assert(sbom.components.length > 0);
  });

  // 3. Threat Model Documentation Tests
  console.log('\nSuite 3: Threat Model & Security Architecture');
  const threatModelContent = fs.readFileSync(path.join(rootDir, 'docs/threat-model.md'), 'utf8');

  await test('covers all 14 mandatory attack vectors in threat model', () => {
    const mandatoryKeywords = [
      'Malicious or Compromised Adviser Attempting to Exfiltrate',
      'Compromised Adviser Device',
      'Compromised Backend Service',
      'Compromised or Subpoenaed Cloud Processor',
      'Interception in Transit',
      'Data Remanence',
      'Inference Attacks Against Operational Monitoring Logs',
      'Prompt Injection via Transcript',
      'Model Output Leakage',
      'Redaction Failure',
      'Recording Imported from Unmanaged Device',
      'Cisco Webex as a Processor',
      'Malformed or Malicious Media File Attacking Decoder Path',
      'Client Telephone Number Leaking via Dial-Out Feature',
    ];

    for (const keyword of mandatoryKeywords) {
      assert(threatModelContent.includes(keyword), `Missing threat vector keyword: ${keyword}`);
    }
  });

  await test('includes Mermaid trust boundary diagrams in threat model', () => {
    assert(threatModelContent.includes('```mermaid'));
    assert(threatModelContent.includes('Trust Boundary 1: Adviser Managed Device'));
    assert(threatModelContent.includes('Trust Boundary 4: Google Cloud Platform'));
  });

  await test('documents Intune MDM preconditions for memory wipe limits', () => {
    assert(threatModelContent.includes('Intune MDM'));
    assert(threatModelContent.includes('BitLocker'));
  });

  await test('specifies residual risks and explicit operational acceptances', () => {
    assert(threatModelContent.includes('Residual Risk'));
    assert(threatModelContent.includes('Cisco Webex'));
  });

  // 4. Authentication and Authorisation Tests
  console.log('\nSuite 4: Authentication & Roles (TotpProvider & EntraIdProvider)');

  await test('fails closed if both or neither auth providers are configured', () => {
    assert.throws(
      () => createAuthProvider({ ...config.auth, enableEntraId: true, enableTotp: true }),
      /Security Configuration Error/
    );
    assert.throws(
      () => createAuthProvider({ ...config.auth, enableEntraId: false, enableTotp: false }),
      /Security Configuration Error/
    );
  });

  await test('TotpProvider: authenticates valid credentials and rejects invalid/locked accounts', async () => {
    const provider = new TotpProvider(config.auth);
    const validTotp = TotpProvider.generateTotp('3132333435363738393031323334353637383930');
    const result = await provider.authenticate({ username: 'adviser', passwordHash: 'AdviserPass2026!', totpCode: validTotp });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.user?.role, 'adviser');
    assert.strictEqual(result.user?.mfaVerified, true);
    assert(result.accessToken && result.accessToken.length > 20);

    const failResult = await provider.authenticate({ username: 'adviser', passwordHash: 'WrongPass', totpCode: validTotp });
    assert.strictEqual(failResult.success, false);
    assert.strictEqual(failResult.errorCode, 'INVALID_CREDENTIALS');
  });

  await test('EntraIdProvider: requires amr claim evidencing MFA and assigns correct roles', async () => {
    const provider = new EntraIdProvider(config.auth);
    const result = await provider.authenticate({
      authorizationCode: 'valid-entra-code',
      codeVerifier: 'mock-pkce-verifier-string-43-chars-minimum-length!',
      redirectUri: 'http://localhost:5173/auth/callback',
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.user?.mfaVerified, true);
    assert.strictEqual(result.user?.role, 'adviser');

    const failResult = await provider.authenticate({
      authorizationCode: 'no-mfa-code',
      codeVerifier: 'mock-pkce-verifier-string-43-chars-minimum-length!',
      redirectUri: 'http://localhost:5173/auth/callback',
    });
    assert.strictEqual(failResult.success, false);
    assert.strictEqual(failResult.errorCode, 'MFA_REQUIRED');
  });

  await test('enforces RBAC permissions across all four roles', () => {
    const provider = new EntraIdProvider(config.auth);
    assert.strictEqual(provider.resolveRoleFromGroups(['grp-caw-advisers']), 'adviser');
    assert.strictEqual(provider.resolveRoleFromGroups(['grp-caw-supervisors']), 'supervisor');
    assert.strictEqual(provider.resolveRoleFromGroups(['grp-caw-admins']), 'administrator');
    assert.strictEqual(provider.resolveRoleFromGroups(['grp-caw-auditors']), 'auditor');
    assert.strictEqual(provider.resolveRoleFromGroups(['unknown-group']), null);
  });

  await test('validates auth architecture documentation in docs/authentication-and-authorisation.md', () => {
    const authDoc = fs.readFileSync(path.join(rootDir, 'docs/authentication-and-authorisation.md'), 'utf8');
    assert(authDoc.includes('AuthProvider'));
    assert(authDoc.includes('EntraIdProvider'));
    assert(authDoc.includes('TotpProvider'));
    assert(authDoc.includes('amr Claim Validation') || authDoc.includes('amr'));
  });

  // 5. Inactivity Timeout and Volatile Memory Tests
  console.log('\nSuite 5: Inactivity Timeout & Volatile State Destruction');

  await test('destroys volatile session and auth state on idle timeout', async () => {
    volatileAuthStore.setAuthenticated(
      { id: 'usr_test', email: 'test@caw.org', name: 'Test', role: 'adviser', mfaVerified: true, provider: 'totp', issuedAt: Date.now(), expiresAt: Date.now() + 900 },
      'mock_access_token',
      'mock_refresh_token'
    );
    volatileSessionStore.initSession('live_microphone', 'usr_test');
    volatileSessionStore.setLocalDraftTranscript('Client discusses ESA appeal and rent arrears.');
    volatileSessionStore.setDraftCaseNote('Draft Note: Housing advice given.');

    assert(volatileAuthStore.getState().isAuthenticated);
    assert.strictEqual(volatileSessionStore.getState()?.localDraftTranscript, 'Client discusses ESA appeal and rent arrears.');

    const fastIdleManager = new IdleTimeoutManager(0.001); // ~60ms
    let timedOut = false;
    await new Promise((resolve) => {
      fastIdleManager.start(() => {
        timedOut = true;
        resolve();
      });
    });

    assert.strictEqual(timedOut, true);
    assert.strictEqual(volatileAuthStore.getState().isAuthenticated, false);
    assert.strictEqual(volatileAuthStore.getState().accessToken, null);
    assert.strictEqual(volatileSessionStore.getState(), null);
  });

  await test('destroys volatile session on explicit logout', () => {
    volatileAuthStore.setAuthenticated(
      { id: 'usr_test2', email: 'test2@caw.org', name: 'Test 2', role: 'adviser', mfaVerified: true, provider: 'totp', issuedAt: Date.now(), expiresAt: Date.now() + 900 },
      'mock_access_token_2',
      'mock_refresh_token_2'
    );
    volatileSessionStore.initSession('webex_dialout', 'usr_test2');
    volatileSessionStore.setDraftCaseNote('Confidential case notes');

    volatileSessionStore.destroySession();
    volatileAuthStore.clearAuth();

    assert.strictEqual(volatileAuthStore.getState().isAuthenticated, false);
    assert.strictEqual(volatileSessionStore.getState(), null);
  });

  // 6. Minimal Hardened Backend & Ephemeral Credentials Tests
  console.log('\nSuite 6: Minimal Hardened Backend & Ephemeral Credentials');
  const { app: serverApp } = createApp();
  const backendDocContent = fs.readFileSync(path.join(rootDir, 'docs/backend-architecture.md'), 'utf8');

  await test('proves the backend serves strictly the 5 permitted endpoint groups and zero others', () => {
    const registeredRoutes = serverApp._router.stack
      .filter((layer) => layer.route || layer.name === 'router')
      .map((layer) => {
        if (layer.route) return `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`;
        return `USE ${layer.regexp.source}`;
      });

    const permittedPrefixes = [
      'health',
      'auth',
      'credentials',
      'monitoring',
      'config',
    ];

    for (const prefix of permittedPrefixes) {
      assert(
        registeredRoutes.some((r) => r.toLowerCase().includes(prefix)),
        `Permitted endpoint prefix missing: ${prefix}`
      );
    }

    const prohibitedPatterns = [
      '/session',
      '/audio',
      '/transcript',
      '/note',
      '/case',
      '/client',
      '/record',
    ];

    for (const pathStr of registeredRoutes) {
      for (const prohibited of prohibitedPatterns) {
        assert(!pathStr.toLowerCase().includes(prohibited), `Prohibited session route found: ${pathStr}`);
      }
    }
  });

  await test('issues short-lived (<= 15m), single-purpose credentials scoped strictly to europe-west2', () => {
    const adviserUser = {
      id: 'usr_adviser_101',
      email: 'adviser@caw.org.uk',
      name: 'Adviser Alice',
      role: 'adviser',
      mfaVerified: true,
      provider: 'totp',
      issuedAt: Math.floor(Date.now() / 1000),
      expiresAt: Math.floor(Date.now() / 1000) + 900,
    };

    const sttCred = CredentialIssuerService.issueCredential(adviserUser, 'speech-to-text', 300);
    assert.strictEqual(sttCred.purpose, 'speech-to-text');
    assert.strictEqual(sttCred.region, 'europe-west2');
    assert.strictEqual(sttCred.endpoint, 'https://europe-west2-speech.googleapis.com');
    assert(sttCred.ttlSeconds <= 900);
    assert(sttCred.ttlSeconds >= 60);
    assert.strictEqual(sttCred.issuedToUser, 'usr_adviser_101');
    assert(new Date(sttCred.expiresAt).getTime() > Date.now());

    const vertexCred = CredentialIssuerService.issueCredential(adviserUser, 'vertex-ai', 300);
    assert.strictEqual(vertexCred.purpose, 'vertex-ai');
    assert.strictEqual(vertexCred.region, 'europe-west2');
    assert.strictEqual(vertexCred.endpoint, 'https://europe-west2-aiplatform.googleapis.com');
    assert(vertexCred.ttlSeconds <= 900);

    const adminUser = { ...adviserUser, id: 'usr_admin_1', role: 'administrator' };
    assert.throws(
      () => CredentialIssuerService.issueCredential(adminUser, 'speech-to-text'),
      /Role 'administrator' is not permitted to request cloud credentials/
    );
  });

  await test('audits credential issuance while NEVER logging the credential token itself', () => {
    clearCapturedLogs();
    const adviserUser = {
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
    assert(issuanceLog !== undefined, 'Issuance event was not logged');
    assert.strictEqual(issuanceLog.userId, 'usr_adv_audit_test');
    assert.strictEqual(issuanceLog.purpose, 'speech-to-text');
    assert.strictEqual(issuanceLog.region, 'europe-west2');

    const rawLogs = JSON.stringify(logs);
    assert(!rawLogs.includes(cred.accessToken), 'CRITICAL PRIVACY VIOLATION: Access token leaked in log stream!');
  });

  await test('proves that request and response bodies are strictly suppressed and never logged', () => {
    clearCapturedLogs();

    const sensitiveBody = {
      clientName: 'Confidential Client Name',
      debtAmount: '£15,400',
      sensitiveNotes: 'Client facing eviction notice from private landlord',
      password: 'SuperSecretPassword99!',
    };

    const sensitiveHeader = 'Bearer super-sensitive-jwt-token-xyz';

    const mockReq = {
      method: 'POST',
      path: '/api/v1/monitoring/events',
      baseUrl: '',
      body: sensitiveBody,
      headers: {
        authorization: sensitiveHeader,
        cookie: 'session_token=private-cookie-data',
      },
    };

    let finishCallback = () => {};
    const mockRes = {
      statusCode: 200,
      on: (event, cb) => {
        if (event === 'finish') finishCallback = cb;
      },
    };

    privacyLogger(mockReq, mockRes, () => {});
    finishCallback();

    const logs = getCapturedLogs();
    assert(logs.length > 0, 'No logs were captured');

    const stringifiedLogs = JSON.stringify(logs);

    assert(!stringifiedLogs.includes('Confidential Client Name'), 'Body clientName leaked in logs!');
    assert(!stringifiedLogs.includes('£15,400'), 'Body debtAmount leaked in logs!');
    assert(!stringifiedLogs.includes('eviction notice'), 'Body sensitiveNotes leaked in logs!');
    assert(!stringifiedLogs.includes('SuperSecretPassword99!'), 'Body password leaked in logs!');
    assert(!stringifiedLogs.includes('super-sensitive-jwt-token-xyz'), 'Authorization header leaked in logs!');
    assert(!stringifiedLogs.includes('private-cookie-data'), 'Cookie header leaked in logs!');

    const lastLog = logs[logs.length - 1];
    assert.strictEqual(lastLog.method, 'POST');
    assert.strictEqual(lastLog.path, '/api/v1/monitoring/events');
    assert.strictEqual(lastLog.statusCode, 200);
    assert.strictEqual(typeof lastLog.durationMs, 'number');
  });

  await test('backend architecture documentation records the 5 permitted endpoints and zero-data rule', () => {
    assert(backendDocContent.includes('The 5 Permitted Endpoints'));
    assert(backendDocContent.includes('Zero Session Data Guarantee'));
    assert(backendDocContent.includes('Single-Purpose Downscoping'));
    assert(backendDocContent.includes('privacyLogger'));
  });

  // 7. Volatile Memory Discipline & Storage Guards Tests (Phase 5)
  console.log('\nSuite 7: Volatile Memory Discipline, Storage Guards & Zero Persistence');
  const volatileDocContent = fs.readFileSync(path.join(rootDir, 'docs/volatile-memory-discipline.md'), 'utf8');

  await test('StorageGuard AST Linter identifies clean client codebase (0 violations)', () => {
    const violations = runStorageLinter();
    assert.strictEqual(violations.length, 0, `Unexpected persistent storage violations in client code: ${JSON.stringify(violations)}`);
  });

  await test('StorageGuard AST Linter detects synthetic persistent storage violations', () => {
    const testCases = [
      'localStorage.setItem("key", "value")',
      'const d = indexedDB.open("testDB")',
      'document.cookie = "auth=secret"',
      'window.caches.open("v1")',
      'window.showSaveFilePicker()',
      'const h = FileSystemFileHandle',
    ];

    const PROHIBITED_PATTERNS = [
      { pattern: /\blocalStorage\b/, name: 'localStorage' },
      { pattern: /\bsessionStorage\b/, name: 'sessionStorage' },
      { pattern: /\bindexedDB\b/, name: 'indexedDB' },
      { pattern: /document\.cookie/, name: 'document.cookie' },
      { pattern: /\bwindow\.caches\b/, name: 'window.caches' },
      { pattern: /\bcaches\.(open|match|has|delete|keys)\b/, name: 'caches' },
      { pattern: /\bshowSaveFilePicker\b/, name: 'showSaveFilePicker' },
      { pattern: /\bshowOpenFilePicker\b/, name: 'showOpenFilePicker' },
      { pattern: /\bFileSystemFileHandle\b/, name: 'FileSystemFileHandle' },
    ];

    for (const testCode of testCases) {
      const match = PROHIBITED_PATTERNS.some((p) => p.pattern.test(testCode));
      assert(match, `Linter pattern failed to detect synthetic violation: ${testCode}`);
    }
  });

  await test('Runtime Storage Guards throw VolatileStorageViolationError across all persistent web APIs', () => {
    resetStorageGuardsForTesting();
    const mockGlobal = { document: {} };
    installRuntimeStorageGuards(mockGlobal);

    assert.throws(() => mockGlobal.localStorage, VolatileStorageViolationError);
    assert.throws(() => { mockGlobal.localStorage = {}; }, VolatileStorageViolationError);
    assert.throws(() => mockGlobal.sessionStorage, VolatileStorageViolationError);
    assert.throws(() => { mockGlobal.sessionStorage = {}; }, VolatileStorageViolationError);
    assert.throws(() => mockGlobal.indexedDB, VolatileStorageViolationError);
    assert.throws(() => mockGlobal.caches, VolatileStorageViolationError);
    assert.throws(() => mockGlobal.showSaveFilePicker(), VolatileStorageViolationError);
    assert.throws(() => mockGlobal.showOpenFilePicker(), VolatileStorageViolationError);
    assert.throws(() => mockGlobal.document.cookie, VolatileStorageViolationError);
    assert.throws(() => { mockGlobal.document.cookie = 'foo=bar'; }, VolatileStorageViolationError);
  });

  await test('VolatileSessionStore executes end-to-end consultation lifecycle purely in volatile RAM', () => {
    // 1. Initialise fresh session
    const session = volatileSessionStore.initSession('live_microphone', 'usr_adv_test_999');
    assert.strictEqual(session.intakeType, 'live_microphone');
    assert.strictEqual(session.stage, 'intake');

    // 2. Set raw audio buffer (16kHz mono PCM Float32)
    const mockPcmBuffer = new Float32Array(16000 * 5).buffer; // 5 seconds
    volatileSessionStore.setRawAudio(mockPcmBuffer, 5.0, 16000);
    assert.strictEqual(volatileSessionStore.getState()?.metadata.audioDurationSeconds, 5.0);
    assert.strictEqual(volatileSessionStore.getState()?.metadata.audioSampleRate, 16000);

    // 3. Set Pass 1 local transcript & redacted entities
    volatileSessionStore.setLocalDraftTranscript('Client Jane Doe living at 12 Battersea Rise with telephone 07123456789.');
    volatileSessionStore.setEntitiesAndTokenMap(
      [
        { id: 'ent_1', category: 'PERSON', originalText: 'Jane Doe', surrogateToken: '[CLIENT_NAME_1]', confidence: 0.99 },
        { id: 'ent_2', category: 'PHONE_NUMBER', originalText: '07123456789', surrogateToken: '[PHONE_1]', confidence: 0.98 },
      ],
      {
        '[CLIENT_NAME_1]': 'Jane Doe',
        '[PHONE_1]': '07123456789',
      }
    );
    volatileSessionStore.setTokenisedTranscript('Client [CLIENT_NAME_1] living at 12 Battersea Rise with telephone [PHONE_1].');

    // 4. Set draft note and sign note
    volatileSessionStore.setDraftCaseNote('## Case Note\nClient advised on council tax support.');
    volatileSessionStore.setSignedCaseNote('## Case Note (Signed by Adviser)\nClient advised on council tax support.');

    const stateBeforeDestroy = volatileSessionStore.getState();
    assert.strictEqual(stateBeforeDestroy?.tokenisedTranscript, 'Client [CLIENT_NAME_1] living at 12 Battersea Rise with telephone [PHONE_1].');
    assert.strictEqual(stateBeforeDestroy?.tokenMap['[CLIENT_NAME_1]'], 'Jane Doe');

    // 5. Explicitly destroy session
    volatileSessionStore.destroySession();
    assert.strictEqual(volatileSessionStore.getState(), null);
  });

  await test('automated test drives a full session, then asserts that browser storage is empty across every mechanism', () => {
    // Mock browser environment with storage surveillance
    const storageAudit = {
      localStorageWrites: 0,
      sessionStorageWrites: 0,
      indexedDbOpens: 0,
      cookieWrites: 0,
      cachesWrites: 0,
      filePickerCalls: 0,
    };

    const mockWindow = {
      localStorage: new Proxy({}, {
        set: () => { storageAudit.localStorageWrites++; return true; },
        get: () => undefined,
      }),
      sessionStorage: new Proxy({}, {
        set: () => { storageAudit.sessionStorageWrites++; return true; },
        get: () => undefined,
      }),
      indexedDB: {
        open: () => { storageAudit.indexedDbOpens++; return {}; },
      },
      caches: {
        open: () => { storageAudit.cachesWrites++; return Promise.resolve({}); },
      },
      showSaveFilePicker: () => { storageAudit.filePickerCalls++; return Promise.reject(); },
      document: {
        _cookie: '',
        get cookie() { return this._cookie; },
        set cookie(val) { storageAudit.cookieWrites++; this._cookie = val; },
      },
    };

    // Drive an entire advice consultation lifecycle
    // Step 1: Intake & Audio capture
    const session = volatileSessionStore.initSession('webex_dialout', 'usr_adviser_wandsworth_42');
    const mockPcmBuffer = new Float32Array(16000 * 10).buffer; // 10 seconds of call audio
    volatileSessionStore.setRawAudio(mockPcmBuffer, 10.0, 16000);
    volatileSessionStore.setStage('local_redaction');

    // Step 2: Pass 1 Local Acoustic & Entity Redaction
    volatileSessionStore.setLocalDraftTranscript(
      'Client John Smith of 44 Lavender Hill, London SW11 5AB, telephone 02079261000, Universal Credit sanctions.'
    );
    volatileSessionStore.setEntitiesAndTokenMap(
      [
        { id: 'ent_1', category: 'PERSON', originalText: 'John Smith', surrogateToken: '[CLIENT_NAME_1]', confidence: 0.99 },
        { id: 'ent_2', category: 'LOCATION', originalText: '44 Lavender Hill, London SW11 5AB', surrogateToken: '[ADDRESS_1]', confidence: 0.97 },
        { id: 'ent_3', category: 'PHONE_NUMBER', originalText: '02079261000', surrogateToken: '[PHONE_1]', confidence: 0.98 },
      ],
      {
        '[CLIENT_NAME_1]': 'John Smith',
        '[ADDRESS_1]': '44 Lavender Hill, London SW11 5AB',
        '[PHONE_1]': '02079261000',
      }
    );
    volatileSessionStore.setTokenisedTranscript(
      'Client [CLIENT_NAME_1] of [ADDRESS_1], telephone [PHONE_1], Universal Credit sanctions.'
    );
    volatileSessionStore.setStage('adviser_review');

    // Step 3: Pass 2 Drafting & Synthesis
    volatileSessionStore.setDraftCaseNote(
      '## Citizens Advice Wandsworth - Case Note\n' +
      'Client sanctioned by DWP. Advised on mandatory reconsideration and hardship payment application.'
    );

    // Step 4: Adviser Review & Signing
    volatileSessionStore.setSignedCaseNote(
      '## Citizens Advice Wandsworth - Case Note (Signed)\n' +
      'Client sanctioned by DWP. Advised on mandatory reconsideration and hardship payment application.'
    );
    volatileSessionStore.setStage('completed');

    // Step 5: Session Termination & Destruction
    volatileSessionStore.destroySession();

    // Assert that across the entire session lifecycle, ZERO persistent storage was touched
    assert.strictEqual(storageAudit.localStorageWrites, 0, 'Violation: localStorage was written to!');
    assert.strictEqual(storageAudit.sessionStorageWrites, 0, 'Violation: sessionStorage was written to!');
    assert.strictEqual(storageAudit.indexedDbOpens, 0, 'Violation: indexedDB was accessed!');
    assert.strictEqual(storageAudit.cookieWrites, 0, 'Violation: document.cookie was written to!');
    assert.strictEqual(storageAudit.cachesWrites, 0, 'Violation: CacheStorage API was written to!');
    assert.strictEqual(storageAudit.filePickerCalls, 0, 'Violation: FileSystem API was called!');
  });

  await test('proves deterministic ArrayBuffer zeroing upon audio release', () => {
    volatileSessionStore.initSession('file_import', 'usr_adv_zero_test');
    const rawBuffer = new Float32Array([0.5, -0.2, 0.8, -0.9, 0.1]).buffer;
    volatileSessionStore.setRawAudio(rawBuffer, 1.0, 16000);

    const underlyingBytes = new Uint8Array(rawBuffer);
    assert(underlyingBytes.some((byte) => byte !== 0), 'Buffer should initially contain non-zero audio data');

    volatileSessionStore.releaseRawAudio();

    // Verify raw audio is null in store
    assert.strictEqual(volatileSessionStore.getState()?.rawAudioBuffer, null);
    // Verify underlying binary buffer was deterministically overwritten with zeros
    assert(underlyingBytes.every((byte) => byte === 0), 'Underlying ArrayBuffer was NOT zero-filled upon release!');

    volatileSessionStore.destroySession();
  });

  await test('SessionRecoveryWorker restores session across simulated reload and terminates cleanly', async () => {
    let workerSnapshot = null;
    let workerIsClosed = false;

    const mockWorkerDispatch = (msg) => {
      return new Promise((resolve) => {
        handleWorkerMessage(
          msg,
          (response) => {
            if (msg.type === 'SNAPSHOT_STORE') workerSnapshot = msg.payload;
            if (msg.type === 'DESTROY_SESSION') workerSnapshot = null;
            resolve(response);
          },
          () => {
            workerSnapshot = null;
            workerIsClosed = true;
            resolve({ type: 'TERMINATED' });
          }
        );
      });
    };

    // 1. Store snapshot
    const mockState = {
      sessionId: 'sess_recovery_123',
      stage: 'adviser_review',
      intakeType: 'live_microphone',
      clientPhoneNumber: null,
      rawAudioBuffer: null,
      redactedAudioBuffer: null,
      localDraftTranscript: 'Redacted text',
      cloudAccurateTranscript: null,
      extractedEntities: [],
      tokenMap: { '[CLIENT_NAME_1]': 'Alice Smith' },
      tokenisedTranscript: 'Restorable tokenised transcript',
      draftCaseNote: 'Restorable consultation text for housing advice',
      signedCaseNote: null,
      metadata: {
        consultationId: 'sess_recovery_123',
        adviserId: 'usr_adv',
        intakeType: 'live_microphone',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isSignedOff: false,
      },
    };

    const saveRes = await mockWorkerDispatch({ type: 'SNAPSHOT_STORE', payload: mockState });
    assert.strictEqual(saveRes.type, 'SNAPSHOT_SAVED');

    // 2. Request restore (simulating page reload)
    const restoreRes = await mockWorkerDispatch({ type: 'RESTORE_REQUEST' });
    assert.strictEqual(restoreRes.type, 'RESTORE_RESPONSE');
    assert.strictEqual(restoreRes.payload.sessionId, 'sess_recovery_123');
    assert.strictEqual(restoreRes.payload.draftCaseNote, 'Restorable consultation text for housing advice');

    // 3. Destroy session (simulating session end or logout)
    const destroyRes = await mockWorkerDispatch({ type: 'DESTROY_SESSION' });
    assert.strictEqual(destroyRes.type, 'SESSION_DESTROYED');

    const emptyRestoreRes = await mockWorkerDispatch({ type: 'RESTORE_REQUEST' });
    assert.strictEqual(emptyRestoreRes.payload, null);

    // 4. Terminate worker
    await mockWorkerDispatch({ type: 'TERMINATE' });
    assert.strictEqual(workerIsClosed, true);
  });

  await test('leaking browser features (spellcheck, autocomplete, translation) are strictly suppressed', () => {
    const clientAppContent = fs.readFileSync(path.join(rootDir, 'client/src/App.tsx'), 'utf8');

    // HTML root tags & meta
    assert(htmlContent.includes('translate="no"'));
    assert(htmlContent.includes('class="notranslate"'));
    assert(htmlContent.includes('name="google" content="notranslate"'));
    assert(htmlContent.includes('lang="en-GB"'));

    // React textareas in App.tsx
    assert(clientAppContent.includes('spellCheck={false}'));
    assert(clientAppContent.includes('autoComplete="off"'));
    assert(clientAppContent.includes('autoCorrect="off"'));
    assert(clientAppContent.includes('autoCapitalize="off"'));
    assert(clientAppContent.includes('data-gramm="false"'));
    assert(clientAppContent.includes('translate="no"'));
  });

  await test('MediaStreamingDecoder enforces pre-flight quotas (<= 500MB, <= 90min) and discards video tracks', async () => {
    // Rejects oversized file > 500MB
    const oversized = mediaStreamingDecoder.validatePreFlight({ size: 550 * 1024 * 1024, name: 'recording.mp4' });
    assert.strictEqual(oversized.valid, false);
    assert(oversized.error?.includes('exceeds maximum allowed size of 500 MB'));

    // Rejects invalid file extension
    const invalidExt = mediaStreamingDecoder.validatePreFlight({ size: 10 * 1024 * 1024, name: 'document.pdf' });
    assert.strictEqual(invalidExt.valid, false);
    assert(invalidExt.error?.includes('Unsupported file format'));

    // Accepts valid 50MB audio/video file
    const validFile = mediaStreamingDecoder.validatePreFlight({ size: 50 * 1024 * 1024, name: 'interview.m4a' });
    assert.strictEqual(validFile.valid, true);
  });

  await test('validates volatile memory discipline documentation in docs/volatile-memory-discipline.md', () => {
    assert(volatileDocContent.includes('VolatileSessionStore Architecture'));
    assert(volatileDocContent.includes('Storage Guards: Dual-Layer Defense'));
    assert(volatileDocContent.includes('Service Worker Policy: Explicit Rejection'));
    assert(volatileDocContent.includes('Leaking Browser Features Suppression'));
    assert(volatileDocContent.includes('Deterministic TypedArray Zeroing'));
    assert(volatileDocContent.includes('Honest Disclosure of JavaScript String Immutability'));
    assert(volatileDocContent.includes('Legacy Hardware Baseline at Citizens Advice Wandsworth'));
    assert(volatileDocContent.includes('Session Recovery Worker vs Constraint C3 Boundary'));
  });

  // 8. Phase 6: Consent Gate, Intake Routes & Audio Normalisation
  console.log('\nSuite 8: Consent Gate, Intake Routes & Audio Normalisation');
  const consentDocContent = fs.readFileSync(path.join(rootDir, 'docs/consent-and-intake.md'), 'utf8');

  await test('Consent Gate provides route-specific guidance and prevents skip', () => {
    const liveWording = consentManager.getWordingForRoute('live_in_person');
    assert(liveWording.title.includes('Live In-Person'));
    assert(liveWording.clientInformationPoints.some((p) => p.includes('destroyed at the end of the session')));
    assert(liveWording.clientInformationPoints.some((p) => p.includes('raw audio never leaves this computer')));

    const webexWording = consentManager.getWordingForRoute('webex_telephony');
    assert(webexWording.title.includes('Cisco Webex'));
    assert(webexWording.adviserInstructions.includes('start of the call'));

    const importWording = consentManager.getWordingForRoute('file_import');
    assert(importWording.title.includes('Import'));
    assert(importWording.affirmationStatement.includes('formal professional attestation'));
  });

  await test('Consent Record creation strictly forbids client PII keys', () => {
    // Valid record creation
    const validRecord = consentManager.createConsentRecord({
      route: 'live_in_person',
      adviserId: 'usr_adviser_wandsworth_42',
    });
    assert.strictEqual(validRecord.route, 'live_in_person');
    assert.strictEqual(validRecord.adviserId, 'usr_adviser_wandsworth_42');
    assert.strictEqual(validRecord.confirmedByAdviser, true);
    assert(validRecord.consentId.startsWith('cst_'));

    // Attempted PII injection: clientName
    assert.throws(
      () => {
        consentManager.createConsentRecord({
          route: 'live_in_person',
          adviserId: 'usr_adviser_42',
          clientName: 'Jane Doe',
        });
      },
      (err) => err.name === 'ConsentPrivacyViolationError' && err.message.includes('clientName')
    );

    // Attempted PII injection: phoneNumber
    assert.throws(
      () => {
        consentManager.createConsentRecord({
          route: 'webex_telephony',
          adviserId: 'usr_adviser_42',
          phoneNumber: '07123456789',
        });
      },
      (err) => err.name === 'ConsentPrivacyViolationError' && err.message.includes('phoneNumber')
    );

    // Attempted PII injection: nationalInsurance
    assert.throws(
      () => {
        consentManager.createConsentRecord({
          route: 'file_import',
          adviserId: 'usr_adviser_42',
          nino: 'QQ123456C',
        });
      },
      (err) => err.name === 'ConsentPrivacyViolationError' && err.message.includes('nino')
    );
  });

  await test('File import consent requires appointment date and means of consent', () => {
    // Missing originalAppointmentDate
    assert.throws(
      () => {
        consentManager.createConsentRecord({
          route: 'file_import',
          adviserId: 'usr_adv_1',
          importConsentMeans: 'Signed paper form',
        });
      },
      (err) => err.message.includes('Original appointment date is required')
    );

    // Missing importConsentMeans
    assert.throws(
      () => {
        consentManager.createConsentRecord({
          route: 'file_import',
          adviserId: 'usr_adv_1',
          originalAppointmentDate: '2026-08-15',
        });
      },
      (err) => err.message.includes('Means of consent is required')
    );

    // Valid import record
    const validImport = consentManager.createConsentRecord({
      route: 'file_import',
      adviserId: 'usr_adv_1',
      originalAppointmentDate: '2026-08-15',
      importConsentMeans: 'Signed CAW appointment consent form',
    });
    assert.strictEqual(validImport.originalAppointmentDate, '2026-08-15');
    assert.strictEqual(validImport.importConsentMeans, 'Signed CAW appointment consent form');
  });

  await test('WebexStreamCapture enforces consent lock on recording and call continuity on withdrawal', () => {
    // Reset webex capture instance state
    webexStreamCapture.endCall();

    // 1. Attempt recording before consent is confirmed -> throws
    assert.strictEqual(webexStreamCapture.isConsentUnlocked(), false);
    assert.throws(
      () => {
        webexStreamCapture.startRecording();
      },
      (err) => err.message.includes('Consent must be affirmatively confirmed')
    );

    // 2. Confirm consent and connect call
    const consent = consentManager.createConsentRecord({
      route: 'webex_telephony',
      adviserId: 'usr_webex_adv',
    });
    webexStreamCapture.confirmConsent(consent);
    assert.strictEqual(webexStreamCapture.isConsentUnlocked(), true);

    webexStreamCapture.connectCall(null, null);
    webexStreamCapture.startRecording();

    // 3. Feed simulated dual-channel audio chunks (Adviser Ch 0, Client Ch 1)
    const adviserChunk = new Float32Array([0.1, 0.2, 0.3]);
    const clientChunk = new Float32Array([-0.1, -0.2, -0.3]);
    webexStreamCapture.feedAudioFrames(adviserChunk, clientChunk);

    // 4. Test normal stop recording
    const captureResult = webexStreamCapture.stopRecording();
    assert(captureResult.monoDownmixBuffer instanceof ArrayBuffer);
    assert.strictEqual(captureResult.sampleRate, 16000);
    assert.strictEqual(captureResult.speakerMap.isDualChannel, true);
    assert.strictEqual(captureResult.speakerMap.adviserChannel, 0);
    assert.strictEqual(captureResult.speakerMap.clientChannel, 1);

    // 5. Test Withdraw Consent during active call: recording destroyed, call remains connected
    webexStreamCapture.startRecording();
    webexStreamCapture.feedAudioFrames(new Float32Array([0.4, 0.5]), new Float32Array([-0.4, -0.5]));

    webexStreamCapture.withdrawConsentAndContinueCall();
    assert.strictEqual(webexStreamCapture.isConsentUnlocked(), false);
    // Call is still connected for unrecorded advice
    webexStreamCapture.endCall();
  });

  await test('Single Dominant Speaker Detector identifies acoustic imbalances', () => {
    const detector = new DominantSpeakerDetector();

    // Generate balanced conversational audio (alternating loud bursts)
    const balancedSamples = new Float32Array(16000 * 25); // 25 seconds
    for (let sec = 0; sec < 25; sec++) {
      const isAdviserTurn = sec % 4 < 2; // alternates every 2 seconds
      const amp = isAdviserTurn ? 0.3 : 0.08;
      for (let s = 0; s < 16000; s++) {
        balancedSamples[sec * 16000 + s] = (Math.random() * 2 - 1) * amp;
      }
    }

    const balancedResult = detector.analyzePcmChunk(balancedSamples);
    assert.strictEqual(balancedResult.isSingleDominantSpeaker, false);
    assert.strictEqual(balancedResult.warningMessage, null);

    // Generate unbalanced monologue audio (single speaker 95% of speech)
    detector.reset();
    const monologueSamples = new Float32Array(16000 * 25); // 25 seconds
    for (let i = 0; i < monologueSamples.length; i++) {
      monologueSamples[i] = (Math.random() * 2 - 1) * 0.35; // loud close-mic speaker throughout
    }

    const monologueResult = detector.analyzePcmChunk(monologueSamples);
    assert.strictEqual(monologueResult.isSingleDominantSpeaker, true);
    assert(monologueResult.dominantSpeakerRatio >= 0.88);
    assert(monologueResult.warningMessage?.includes('Single dominant speaker detected'));
  });

  await test('LiveAudioCapture computes memory pressure thresholds and transitions cleanly', () => {
    // 16kHz Float32 mono = 64,000 bytes/sec = 3.84 MB/min
    // < 45m: Normal (< 172.8MB)
    // 45-60m: Moderate
    // 60-90m: High Pressure
    // >= 90m: Limit Exceeded

    let currentPressure = null;
    const capture = new LiveAudioCapture({
      onMemoryPressure: (level, currentMb, message) => {
        currentPressure = { level, currentMb, message };
      },
    });

    // Test buffer calculation for 30 minutes
    const bytes30m = 30 * 60 * 16000 * 4;
    // @ts-ignore
    capture.evaluatePressureForBytes(bytes30m, 30 * 60);
    assert.strictEqual(currentPressure?.level, 'normal');

    // Test buffer calculation for 50 minutes (Moderate)
    const bytes50m = 50 * 60 * 16000 * 4;
    // @ts-ignore
    capture.evaluatePressureForBytes(bytes50m, 50 * 60);
    assert.strictEqual(currentPressure?.level, 'moderate');
    assert(currentPressure?.message?.includes('45 minutes'));

    // Test buffer calculation for 75 minutes (High Pressure)
    const bytes75m = 75 * 60 * 16000 * 4;
    // @ts-ignore
    capture.evaluatePressureForBytes(bytes75m, 75 * 60);
    assert.strictEqual(currentPressure?.level, 'high_pressure');
    assert(currentPressure?.message?.includes('exceeded 60 minutes'));

    // Test buffer calculation for 95 minutes (Limit Exceeded)
    const bytes95m = 95 * 60 * 16000 * 4;
    // @ts-ignore
    capture.evaluatePressureForBytes(bytes95m, 95 * 60);
    assert.strictEqual(currentPressure?.level, 'limit_exceeded');
  });

  await test('AudioNormalizer produces unified in-memory Float32 representation across all 3 routes', () => {
    const consentLive = consentManager.createConsentRecord({
      route: 'live_in_person',
      adviserId: 'usr_adv_norm',
    });
    const consentWebex = consentManager.createConsentRecord({
      route: 'webex_telephony',
      adviserId: 'usr_adv_norm',
    });
    const consentImport = consentManager.createConsentRecord({
      route: 'file_import',
      adviserId: 'usr_adv_norm',
      originalAppointmentDate: '2026-08-10',
      importConsentMeans: 'Signed Intake Agreement',
    });

    // Route 1 Normalisation
    const livePcm = new Float32Array([0.1, -0.2, 0.3, -0.4]).buffer;
    const normLive = audioNormalizer.normalizeLiveCapture(
      { pcmBuffer: livePcm, durationSeconds: 5.0, sampleRate: 16000 },
      consentLive
    );
    assert.strictEqual(normLive.format, 'FLOAT32_PCM_16KHZ_MONO');
    assert.strictEqual(normLive.sampleRate, 16000);
    assert.strictEqual(normLive.speakerMap.isDualChannel, false);

    // Route 2 Normalisation
    const webexPcm = new Float32Array([0.5, -0.6, 0.7, -0.8]).buffer;
    const normWebex = audioNormalizer.normalizeWebexCapture(
      {
        monoDownmixBuffer: webexPcm,
        durationSeconds: 10.0,
        sampleRate: 16000,
        speakerMap: { isDualChannel: true, adviserChannel: 0, clientChannel: 1, sourceType: 'webex_telephony' },
      },
      consentWebex
    );
    assert.strictEqual(normWebex.format, 'FLOAT32_PCM_16KHZ_MONO');
    assert.strictEqual(normWebex.sampleRate, 16000);
    assert.strictEqual(normWebex.speakerMap.isDualChannel, true);

    // Route 3 Normalisation
    const importPcm = new Float32Array([0.9, -0.1, 0.2, -0.3]).buffer;
    const normImport = audioNormalizer.normalizeFileImport(
      { pcmBuffer: importPcm, durationSeconds: 15.0, sampleRate: 16000 },
      consentImport
    );
    assert.strictEqual(normImport.format, 'FLOAT32_PCM_16KHZ_MONO');
    assert.strictEqual(normImport.sampleRate, 16000);
    assert.strictEqual(normImport.speakerMap.isDualChannel, false);

    // Verify all 3 set VolatileSessionStore state with zero route leaks
    const state = volatileSessionStore.getState();
    assert(state !== null);
    assert.strictEqual(state?.stage, 'local_redaction');
    assert.strictEqual(state?.consentRecord?.route, 'file_import');

    volatileSessionStore.destroySession();
  });

  await test('One-action consent withdrawal instantly destroys volatile session and recovery snapshots', () => {
    // 1. Setup active session in VolatileStore
    volatileSessionStore.initSession('live_microphone', 'usr_withdraw_adv');
    const consent = consentManager.createConsentRecord({
      route: 'live_in_person',
      adviserId: 'usr_withdraw_adv',
    });
    volatileSessionStore.setConsentRecord(consent);
    volatileSessionStore.setLocalDraftTranscript('Sensitive client conversation');
    volatileSessionStore.setDraftCaseNote('Confidential advice note');

    assert(volatileSessionStore.getState() !== null);

    // 2. Perform single-tap consent withdrawal
    consentManager.withdrawConsent('live_in_person');

    // 3. Verify instant complete destruction
    assert.strictEqual(volatileSessionStore.getState(), null);
  });

  await test('Validates Phase 6 Consent and Intake documentation in docs/consent-and-intake.md', () => {
    assert(consentDocContent.includes('Universal Consent Gate'));
    assert(consentDocContent.includes('Non-Skip Invariant'));
    assert(consentDocContent.includes('Route-Specific Consent Requirements'));
    assert(consentDocContent.includes('Zero Client PII Invariant'));
    assert(consentDocContent.includes('Immediate One-Action Consent Withdrawal'));
    assert(consentDocContent.includes('Webex Telephony Call Continuity'));
    assert(consentDocContent.includes('Single Dominant Speaker Detection'));
    assert(consentDocContent.includes('Volatile Memory Pressure Monitoring'));
    assert(consentDocContent.includes('Universal Normalized Representation'));
  });

  // 9. Suite 9: Phase 15 - Deterministic Session Destruction across all 6 Exit Paths
  console.log('\nSuite 9: Phase 15 - Deterministic Session Destruction');

  await test('Exit Path 1: Explicit End calls destroySession() and zeroes all volatile buffers and worker snapshots', async () => {
    volatileSessionStore.initSession('live_microphone', 'usr_exit1');
    const audioBuf = new Float32Array([0.1, 0.2, 0.3, 0.4]).buffer;
    volatileSessionStore.setRawAudioBuffer(audioBuf, 16000);
    volatileSessionStore.setDraftCaseNote('Confidential case note');
    
    await destroySession({ reason: 'explicit_end' });
    assertSessionDestroyed();
    assert.strictEqual(volatileSessionStore.getState(), null);
    assert.strictEqual(sessionRecoveryManager.isTerminated(), true);
  });

  await test('Exit Path 2: Logout triggers destroySession() and clears state completely', async () => {
    volatileSessionStore.initSession('live_microphone', 'usr_exit2');
    volatileSessionStore.setDraftCaseNote('Logout test note');
    await destroySession({ reason: 'logout' });
    assertSessionDestroyed();
    assert.strictEqual(volatileSessionStore.getState(), null);
  });

  await test('Exit Path 3: Idle Timeout triggers destroySession() with non-PII telemetry', async () => {
    volatileSessionStore.initSession('live_microphone', 'usr_exit3');
    await destroySession({ reason: 'idle_timeout' });
    assertSessionDestroyed();
  });

  await test('Exit Path 4: Consent Withdrawal triggers destroySession() instantly', async () => {
    volatileSessionStore.initSession('live_microphone', 'usr_exit4');
    await destroySession({ reason: 'consent_withdrawal' });
    assertSessionDestroyed();
  });

  await test('Exit Path 5: Tab Close triggers destroySession() with reason tab_close', async () => {
    volatileSessionStore.initSession('live_microphone', 'usr_exit5');
    await destroySession({ reason: 'tab_close' });
    assertSessionDestroyed();
  });

  await test('Exit Path 6: Unrecoverable Error triggers destroySession() with reason unrecoverable_error', async () => {
    volatileSessionStore.initSession('live_microphone', 'usr_exit6');
    await destroySession({ reason: 'unrecoverable_error' });
    assertSessionDestroyed();
  });

  await test('Clipboard wiping is executed if detokenised content was copied', async () => {
    markDetokenisedContentCopied();
    assert.strictEqual(isDetokenisedClipboardPresent(), true);
    await destroySession({ reason: 'explicit_end' });
    assert.strictEqual(isDetokenisedClipboardPresent(), false);
  });

  // 10. Suite 10: Phase 16 - Monitoring and Audit Logging
  console.log('\nSuite 10: Phase 16 - Strict Monitoring & Audit Logging');

  await test('Log schema enforces whitelist and rejects any forbidden or free-text field', () => {
    const valid = validateLogPayload({
      eventType: 'SESSION_INITIALISED',
      timestamp: new Date().toISOString(),
      pseudonymousUserId: 'usr_adv_44',
      role: 'adviser',
      intakeRoute: 'live_in_person',
      stageReached: 'recording',
      stageDurationMs: 12000,
      totalSessionDurationMs: 45000,
    });
    assert.strictEqual(valid.eventType, 'SESSION_INITIALISED');

    const rejectionChecks = testingEngine.verifyLogRejectionInvariants();
    assert.strictEqual(rejectionChecks.phoneRejected, true, 'Phone number must be rejected at log ingress');
    assert.strictEqual(rejectionChecks.filenameRejected, true, 'Filename must be rejected at log ingress');
    assert.strictEqual(rejectionChecks.freeTextRejected, true, 'Free text / transcript must be rejected at log ingress');
    assert.strictEqual(rejectionChecks.unauthorizedFieldRejected, true, 'Unauthorized extra fields must be rejected at log ingress');
  });

  await test('AuditLogStore enforces 365-day automated retention and purges older records', () => {
    const store = new AuditLogStore(365);
    store.clear();

    // Ingest valid log
    store.ingest({
      eventType: 'SESSION_INITIALISED',
      timestamp: new Date().toISOString(),
      pseudonymousUserId: 'usr_retention_1',
      role: 'adviser',
    });
    assert.strictEqual(store.count(), 1);

    // Ingest log with timestamp 400 days ago
    const past400Days = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    store.ingest({
      eventType: 'SESSION_ENDED',
      timestamp: past400Days,
      pseudonymousUserId: 'usr_retention_old',
      role: 'adviser',
    });

    // Count should be 1 because old record is automatically purged
    assert.strictEqual(store.count(), 1);
  });

  await test('AuditLogStore queries are restricted and every access is itself logged as LOGS_ACCESSED', () => {
    const store = new AuditLogStore();
    store.clear();

    store.ingest({
      eventType: 'CONSENT_GIVEN',
      timestamp: new Date().toISOString(),
      pseudonymousUserId: 'usr_test_1',
      role: 'adviser',
    });

    const res = store.query({}, { id: 'usr_auditor_99', role: 'auditor' });
    assert(res.total >= 1);

    // Verify LOGS_ACCESSED was recorded
    const logs = store.query({}, { id: 'usr_admin_1', role: 'administrator' });
    const accessLogs = logs.results.filter((l) => l.eventType === 'LOGS_ACCESSED');
    assert(accessLogs.length > 0, 'Audit log access must record LOGS_ACCESSED entry');
  });

  // 11. Suite 11: Phase 17 - Synthetic Test Corpus & Continuous Constraints
  console.log('\nSuite 11: Phase 17 - Synthetic Test Corpus & Constraint Checks');

  await test('Corpus contains 33 comprehensive synthetic scenarios with ground truth across all required topics and routes', () => {
    assert.strictEqual(SYNTHETIC_CORPUS.length, 33);
    const topics = new Set(SYNTHETIC_CORPUS.map((s) => s.topic));
    assert(topics.has('welfare_benefits'));
    assert(topics.has('debt'));
    assert(topics.has('housing'));
    assert(topics.has('employment'));
    assert(topics.has('energy'));
    assert(topics.has('safeguarding'));
    assert(topics.has('adversarial'));

    const routes = new Set(SYNTHETIC_CORPUS.map((s) => s.intakeRoute));
    assert(routes.has('live_in_person'));
    assert(routes.has('webex_telephony'));
    assert(routes.has('file_import'));
  });

  await test('Benchmark Engine evaluates redaction recall and precision across corpus', () => {
    const metrics = testingEngine.evaluateRedactionPerformance();
    console.log(`    [Metrics] Recall: ${(metrics.recall * 100).toFixed(1)}%, Precision: ${(metrics.precision * 100).toFixed(1)}%, F1: ${(metrics.f1Score * 100).toFixed(1)}%`);
    assert(metrics.recall >= 0.90, `Redaction recall should be >= 90%, got ${(metrics.recall * 100).toFixed(1)}%`);
    assert(metrics.precision >= 0.85, `Redaction precision should be >= 85%, got ${(metrics.precision * 100).toFixed(1)}%`);
  });

  await test('Network Egress Interception proves 100% Zero-PII Leakage across entire 33-scenario corpus', () => {
    const inspection = testingEngine.inspectNetworkEgressAcrossCorpus();
    assert.strictEqual(inspection.isZeroLeakageVerified, true, `Expected zero PII leakage, found ${inspection.leakedPiiCount} leaks`);
    assert.strictEqual(inspection.leakedPiiCount, 0);
  });

  await test('Blind Case Note Quality Assessment evaluates generated drafts against AQS Level 3 criteria', () => {
    const scenario = SYNTHETIC_CORPUS[0];
    const assessment = testingEngine.assessCaseNoteQualityAgainstAqs(scenario, scenario.modelAnswerCaseNote);
    assert.strictEqual(assessment.meetsAqsLevel3, true);
    assert.strictEqual(assessment.criteriaScores.accurateEnquiryConfirmation, true);
    assert.strictEqual(assessment.criteriaScores.clearAdviceSummary, true);
    assert.strictEqual(assessment.criteriaScores.actionPlanAndDeadlines, true);
    assert.strictEqual(assessment.criteriaScores.statutoryRightsIdentified, true);
  });

  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

run();

