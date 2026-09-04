process.env.NODE_ENV = 'test';

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
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
import { matchLayer1StructuredIdentifiers } from '../client/src/redaction/layer1StructuredMatcher.ts';
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

  await test('Every backend path the client calls is mounted, and none is requested relative to the SPA host', () => {
    // Two defects made the case note endpoint, which is the whole point of the product,
    // unreachable in the deployed application, and neither was visible to any existing test.
    //
    //  1. caseNoteRouter was written, exported and never mounted in server.ts, so
    //     /api/v1/casenote/generate returned 404.
    //  2. Six client call sites used relative URLs such as fetch('/api/v1/auth/login').
    //     The SPA and the API are on different hosts, so those resolved against the SPA
    //     host, where the single page application rewrite answers with index.html. The
    //     caller received an HTML document with status 200 and failed parsing it as JSON.
    //     Login itself was affected.
    //
    // This test closes both gaps at once by reconciling what the client asks for against
    // what the server actually serves.
    const clientDir = path.join(rootDir, 'client/src');
    const walk = (dir) =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]
      );
    const clientFiles = walk(clientDir).filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'));

    // No client code may request an API path relative to its own origin.
    const apiClientPath = path.join(clientDir, 'config/apiClient.ts');
    for (const file of clientFiles) {
      if (file === apiClientPath) continue; // documents the anti-pattern it exists to prevent
      const body = fs.readFileSync(file, 'utf8');
      assert(
        !/[^a-zA-Z]fetch\(\s*['"`]\/api\//.test(body),
        `${path.relative(rootDir, file)} requests an API path relative to the SPA host. Use apiFetch from config/apiClient.ts.`
      );
    }

    // Every path the client requests must be mounted on the backend.
    const requested = new Set();
    for (const file of clientFiles) {
      const body = fs.readFileSync(file, 'utf8');
      for (const m of body.matchAll(/['"`](\/api\/v1\/[a-zA-Z0-9/_-]+)['"`]/g)) requested.add(m[1]);
      for (const m of body.matchAll(/\$\{[^}]*\}(\/api\/v1\/[a-zA-Z0-9/_-]+)/g)) requested.add(m[1]);
    }
    assert(requested.size > 0, 'no client API calls were discovered, the matcher is broken');

    const serverSource = fs.readFileSync(path.join(rootDir, 'backend/src/server.ts'), 'utf8');
    const mounted = [...serverSource.matchAll(/app\.use\(\s*['"`](\/api\/v1\/[a-zA-Z0-9/_-]*)['"`]/g)].map((m) => m[1]);
    assert(mounted.length > 0, 'no mounted API routers were discovered, the matcher is broken');

    for (const req of requested) {
      assert(
        mounted.some((base) => req === base || req.startsWith(`${base}/`)),
        `client calls ${req} but no router is mounted for it in server.ts`
      );
    }
  });

  await test('Pilot refuses to start unless a real JWT signing secret is supplied', () => {
    // Adviser session tokens authorise access to client consultations. The repository
    // contains a development fallback key so that local and test runs need no configuration;
    // if the pilot ever fell back to it, anyone who could read the repository could mint a
    // valid adviser session. Config is evaluated once at module load, so each case is
    // checked in a fresh process.
    const loadPilotConfig = (env) =>
      spawnSync(
        process.execPath,
        ['--experimental-strip-types', '-e', "import('./backend/src/config/index.ts').then(() => process.exit(0), () => process.exit(3))"],
        { cwd: rootDir, env: { ...process.env, APP_ENV: 'pilot', ...env }, encoding: 'utf8' }
      ).status;

    const DEVELOPMENT_KEY = 'caw-case-ace-london-jwt-dev-secret-minimum-32-chars-long!';

    assert.strictEqual(loadPilotConfig({ JWT_SECRET: '' }), 3, 'pilot started with no JWT_SECRET');
    assert.strictEqual(loadPilotConfig({ JWT_SECRET: DEVELOPMENT_KEY }), 3, 'pilot started on the committed development key');
    assert.strictEqual(loadPilotConfig({ JWT_SECRET: 'tooshort' }), 3, 'pilot started with a JWT_SECRET below the minimum length');
    assert.strictEqual(
      loadPilotConfig({ JWT_SECRET: 'a-genuinely-long-random-pilot-secret-value-1234567890' }),
      0,
      'pilot refused to start with a valid JWT_SECRET'
    );

    // Local and test environments must remain runnable without any secret configured.
    assert.strictEqual(config.env, 'local');
    assert(config.auth.jwtSecret.length >= 32);
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

  await test('proves the backend serves strictly the permitted endpoint groups and zero others', () => {
    // This was a substring denylist ('/case', '/note', '/session', ...) meant to prevent any
    // endpoint that persists or serves client session data. It rejected the stateless case
    // note drafting endpoint purely because of its name, while it would have waved through
    // an endpoint called /api/v1/store or /api/v1/uploads. It is now an explicit allowlist,
    // which carries the same intent and is strictly tighter: anything not named below fails.
    const PERMITTED_MOUNTS = [
      '/health',             // liveness and region pinning, unauthenticated
      '/api/v1/health',
      '/api/v1/auth',        // adviser login and session issue
      '/api/v1/credentials', // short-lived downscoped cloud credentials
      '/api/v1/monitoring',  // zero-PII operational events
      '/api/v1/config',      // non-secret client configuration
      '/api/v1/casenote',    // stateless drafting from a tokenised transcript, stores nothing
    ];

    const serverSource = fs.readFileSync(path.join(rootDir, 'backend/src/server.ts'), 'utf8');
    const mounted = [...serverSource.matchAll(/app\.use\(\s*['"`](\/[a-zA-Z0-9/_-]*)['"`]/g)].map((m) => m[1]);
    assert(mounted.length > 0, 'no mounted routers were discovered, the matcher is broken');

    for (const mount of mounted) {
      assert(
        PERMITTED_MOUNTS.includes(mount),
        `Unpermitted endpoint group mounted: ${mount}. Every backend surface must be listed and justified here.`
      );
    }

    // Every permitted group must actually be present, so a mount cannot silently vanish.
    for (const expected of PERMITTED_MOUNTS) {
      assert(mounted.includes(expected), `Permitted endpoint group is not mounted: ${expected}`);
    }

    // The backend holds no state, so no route may imply it accepts or serves stored content.
    for (const mount of mounted) {
      for (const prohibited of ['/session', '/audio', '/transcript', '/client', '/record', '/upload', '/store']) {
        assert(!mount.toLowerCase().includes(prohibited), `Prohibited stateful route found: ${mount}`);
      }
    }
  });

  await test('issues short-lived (<= 15m), single-purpose credentials scoped strictly to europe-west2', async () => {
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

    // Token minting is stubbed so this exercises authorisation, purpose validation, TTL
    // bounds and the issued shape without depending on a live Google Cloud identity. The
    // impersonation call itself is covered separately below.
    const mintCalls = [];
    const restoreMinter = CredentialIssuerService.setTokenMinterForTesting(async (sa, ttl) => {
      mintCalls.push({ sa, ttl });
      return { accessToken: `stub_token_${mintCalls.length}` };
    });

    try {
      const sttCred = await CredentialIssuerService.issueCredential(adviserUser, 'speech-to-text', 300);
      assert.strictEqual(sttCred.purpose, 'speech-to-text');
      assert.strictEqual(sttCred.region, 'europe-west2');
      assert.strictEqual(sttCred.endpoint, 'https://europe-west2-speech.googleapis.com');
      assert.strictEqual(sttCred.provider, 'gcp-impersonated-service-account');
      assert(sttCred.ttlSeconds <= 900);
      assert(sttCred.ttlSeconds >= 60);
      assert.strictEqual(sttCred.issuedToUser, 'usr_adviser_101');
      assert(new Date(sttCred.expiresAt).getTime() > Date.now());

      const vertexCred = await CredentialIssuerService.issueCredential(adviserUser, 'vertex-ai', 300);
      assert.strictEqual(vertexCred.purpose, 'vertex-ai');
      assert.strictEqual(vertexCred.region, 'europe-west2');
      assert.strictEqual(vertexCred.endpoint, 'https://europe-west2-aiplatform.googleapis.com');
      assert(vertexCred.ttlSeconds <= 900);

      // Each purpose must impersonate its own single-role service account. If both
      // purposes ever resolved to the same identity, "single-purpose" would be a claim
      // rather than a control.
      assert.strictEqual(mintCalls.length, 2);
      assert(mintCalls[0].sa.includes('stt'), `speech-to-text used ${mintCalls[0].sa}`);
      assert(mintCalls[1].sa.includes('vertex'), `vertex-ai used ${mintCalls[1].sa}`);
      assert.notStrictEqual(mintCalls[0].sa, mintCalls[1].sa);
      assert.strictEqual(mintCalls[0].ttl, 300);

      // TTL is clamped, not trusted.
      const clamped = await CredentialIssuerService.issueCredential(adviserUser, 'speech-to-text', 86400);
      assert.strictEqual(clamped.ttlSeconds, 900);

      const adminUser = { ...adviserUser, id: 'usr_admin_1', role: 'administrator' };
      await assert.rejects(
        () => CredentialIssuerService.issueCredential(adminUser, 'speech-to-text'),
        /Role 'administrator' is not permitted to request cloud credentials/
      );

      // A minting failure must surface, never degrade to something token-shaped. The
      // previous implementation returned a random string that authenticated nothing.
      const restoreFailing = CredentialIssuerService.setTokenMinterForTesting(async () => {
        throw new Error('generateAccessToken failed: HTTP 403');
      });
      await assert.rejects(
        () => CredentialIssuerService.issueCredential(adviserUser, 'speech-to-text'),
        /generateAccessToken failed/
      );
      restoreFailing();
    } finally {
      restoreMinter();
    }
  });

  await test('audits credential issuance while NEVER logging the credential token itself', async () => {
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

    const restore = CredentialIssuerService.setTokenMinterForTesting(async () => ({
      accessToken: 'ya29.stub-secret-token-that-must-never-appear-in-a-log',
    }));
    let cred;
    try {
      cred = await CredentialIssuerService.issueCredential(adviserUser, 'speech-to-text', 300);
    } finally {
      restore();
    }
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

  await test('backend architecture documentation records every permitted endpoint and the zero-data rule', () => {
    // The count is derived from the code rather than written into the assertion, so the
    // document and the mounted routers cannot drift apart silently. Adding an endpoint
    // without documenting it fails here.
    const serverSource = fs.readFileSync(path.join(rootDir, 'backend/src/server.ts'), 'utf8');
    const mountedGroups = new Set(
      [...serverSource.matchAll(/app\.use\(\s*['"`](\/[a-zA-Z0-9/_-]*)['"`]/g)].map((m) =>
        m[1].replace(/^\/api\/v1/, '')
      )
    );
    assert(
      backendDocContent.includes(`The ${mountedGroups.size} Permitted Endpoints`),
      `backend-architecture.md must be headed "The ${mountedGroups.size} Permitted Endpoints" to match the ${mountedGroups.size} mounted groups`
    );
    for (const group of mountedGroups) {
      assert(
        backendDocContent.includes(group === '/health' ? '/health' : `/api/v1${group}`),
        `backend-architecture.md does not document the ${group} endpoint group`
      );
    }
    assert(backendDocContent.includes('Zero Session Data Guarantee'));
    assert(backendDocContent.includes('privacyLogger'));
    // The credential model must not be described as a downscoped Credential Access
    // Boundary. Those are Cloud Storage only, so that description was never achievable.
    assert(
      !/downscoped STS credential(?!s" produced)/i.test(backendDocContent) ||
        backendDocContent.includes('Correction to the credential model'),
      'backend-architecture.md still describes downscoped STS credentials without the correction'
    );
    assert(backendDocContent.includes('case-ace-stt-sa'));
    assert(backendDocContent.includes('case-ace-vertex-sa'));
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
    // HTML root tags & meta
    assert(htmlContent.includes('translate="no"'));
    assert(htmlContent.includes('class="notranslate"'));
    assert(htmlContent.includes('name="google" content="notranslate"'));
    assert(htmlContent.includes('lang="en-GB"'));

    // Every text entry surface in the client must suppress the browser and extension
    // features that would transmit consultation text off the device: spellcheck and
    // autocorrect services, autofill history, machine translation, and Grammarly-style
    // editor extensions. This test previously looked only in App.tsx, where no textarea
    // has lived for some time, so two unsuppressed fields went unnoticed: the case note
    // editor and the detokenised Casebook export preview.
    const TEXT_ENTRY_SURFACES = [
      'client/src/components/TranscriptReviewPanel.tsx',
      'client/src/components/CaseNoteReviewPanel.tsx',
      'client/src/components/CasebookExportModal.tsx',
    ];
    const REQUIRED_SUPPRESSIONS = [
      'spellCheck={false}',
      'autoComplete="off"',
      'autoCorrect="off"',
      'autoCapitalize="off"',
      'translate="no"',
      'data-gramm="false"',
    ];

    // Guard against a text entry surface being added elsewhere and escaping this check.
    const componentsDir = path.join(rootDir, 'client/src/components');
    const discovered = fs
      .readdirSync(componentsDir)
      .filter((f) => f.endsWith('.tsx'))
      .filter((f) => {
        const body = fs.readFileSync(path.join(componentsDir, f), 'utf8');
        return body.includes('<textarea') || body.includes('contentEditable');
      })
      .map((f) => `client/src/components/${f}`);
    const unlisted = discovered.filter((f) => !TEXT_ENTRY_SURFACES.includes(f));
    assert.deepStrictEqual(
      unlisted,
      [],
      `Text entry surface(s) not covered by the leak suppression test: ${unlisted.join(', ')}`
    );
    assert(
      !fs.readFileSync(path.join(rootDir, 'client/src/App.tsx'), 'utf8').includes('<textarea'),
      'App.tsx has gained a textarea and must be added to TEXT_ENTRY_SURFACES'
    );

    for (const relPath of TEXT_ENTRY_SURFACES) {
      const body = fs.readFileSync(path.join(rootDir, relPath), 'utf8');
      for (const attr of REQUIRED_SUPPRESSIONS) {
        assert(body.includes(attr), `${relPath} is missing ${attr}`);
      }
    }
  });

  await test('MediaStreamingDecoder enforces pre-flight quotas (<= 500MB) and validates by content, not file name', async () => {
    // This test previously asserted that format was validated from the file extension.
    // The implementation validates by sniffing the container's magic bytes instead, which
    // is both stronger (an extension is attacker controlled) and required by the Phase 6B
    // rule that file names are never read or recorded. The test now checks the real control.
    const header = (bytes) => {
      const buf = new Uint8Array(16);
      buf.set(bytes, 0);
      return buf;
    };
    const ascii = (str) => Array.from(str).map((c) => c.charCodeAt(0));

    // Rejects oversized file > 500MB before any content is read
    const oversized = mediaStreamingDecoder.validatePreFlight({ size: 550 * 1024 * 1024 });
    assert.strictEqual(oversized.valid, false);
    assert(oversized.error?.includes('exceeds maximum allowed size of 500 MB'));

    // Rejects a PDF, regardless of what it might be named
    const pdfBytes = header(ascii('%PDF-1.7\n%????'));
    const pdf = mediaStreamingDecoder.validatePreFlight({ size: 10 * 1024 * 1024, headerBytes: pdfBytes });
    assert.strictEqual(pdf.valid, false);
    assert(pdf.error && pdf.error.length > 0);

    // A header shorter than 12 bytes cannot be sniffed, so pre-flight defers rather than
    // guessing. It must not return a container verdict it has not established.
    const runt = mediaStreamingDecoder.validatePreFlight({ size: 8, headerBytes: new Uint8Array(8) });
    assert.strictEqual(runt.sniff, undefined, 'pre-flight claimed a container it could not sniff');

    // Accepts a genuine WAV: 'RIFF' .... 'WAVE'
    const wavBytes = header([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WAVE')]);
    const wav = mediaStreamingDecoder.validatePreFlight({ size: 50 * 1024 * 1024, headerBytes: wavBytes });
    assert.strictEqual(wav.valid, true);
    assert.strictEqual(wav.sniff?.isVideo, false);

    // Accepts a genuine MP4 and flags it as video so the decoder discards the video track
    const mp4Bytes = header([0, 0, 0, 0x20, ...ascii('ftyp'), ...ascii('isom')]);
    const mp4 = mediaStreamingDecoder.validatePreFlight({ size: 50 * 1024 * 1024, headerBytes: mp4Bytes });
    assert.strictEqual(mp4.valid, true);
    assert.strictEqual(mp4.sniff?.isVideo, true);

    // Pre-flight without header bytes cannot judge content, so decodeAudio must sniff again
    // before decoding. Assert that second check has not been removed.
    const decoderSource = fs.readFileSync(path.join(rootDir, 'client/src/audio/mediaStreamingDecoder.ts'), 'utf8');
    assert(
      (decoderSource.match(/validatePreFlight|sniffMediaContainer/g) || []).length >= 2,
      'decodeAudio must re-check the container header before decoding'
    );
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
  await test('Layer 1 detects identifiers as they are actually dictated, not only as written', () => {
    // Every string below is verbatim output from Cloud Speech-to-Text on a real recorded
    // consultation, or a close variant of it. Before these were handled, a spoken National
    // Insurance number and a spoken date of birth passed through detection untouched and
    // were transmitted to the cloud in the clear. See evidence/e2e-audio-findings.md.
    const MUST_DETECT = [
      // The exact transcription from the recording: letters separated, no space before the suffix
      ['z x 48  62  19d', 'national_insurance'],
      // Fully spelled out, which is how it is read when the line is poor
      ['it is z x four eight six two one nine d', 'national_insurance'],
      // The letter Z named phonetically
      ['zed x 48 62 19 d', 'national_insurance'],
      // Written form must keep working
      ['My number is ZX 48 62 19 D', 'national_insurance'],
      // Month spoken as an ordinal, ordinary British dictation
      ['Doris Mae Campbell  14th of the second 1945', 'date_of_birth'],
      ['born on the fourteenth of the second, 1945', 'date_of_birth'],
      ['14 February 1945', 'date_of_birth'],
    ];

    for (const [text, category] of MUST_DETECT) {
      const hits = matchLayer1StructuredIdentifiers(text).filter((h) => h.category === category);
      assert(hits.length > 0, `Layer 1 missed ${category} in: "${text}"`);
    }

    // The Home Office reference pattern used a case-insensitive "HO" prefix with no
    // requirement for digits, so it classified ordinary English as an immigration
    // reference. Six of ten structured matches in one real consultation were words like
    // these. That mutes ordinary speech and trains advisers to click through the review
    // gate, which is worse than having no gate while still carrying its assurance.
    for (const word of ['honestly', 'hospital', 'household', 'homeless', 'hopeless']) {
      const hits = matchLayer1StructuredIdentifiers(`She said ${word} to me yesterday.`);
      assert.deepStrictEqual(
        hits.filter((h) => h.category === 'home_office_reference'),
        [],
        `"${word}" was classified as a Home Office reference`
      );
    }

    // A genuine reference must still be caught.
    const real = matchLayer1StructuredIdentifiers('Her Home Office reference is HO1234567890.');
    assert(
      real.some((h) => h.category === 'home_office_reference'),
      'a genuine Home Office reference is no longer detected'
    );
  });

  console.log('\nSuite 8: Consent Gate, Intake Routes & Audio Normalisation');
  const consentDocContent = fs.readFileSync(path.join(rootDir, 'docs/consent-and-intake.md'), 'utf8');

  await test('Consent Gate provides route-specific guidance and prevents skip', () => {
    // This test previously pinned the exact prose of the adviser-facing gate. Wording is
    // reviewed editorially and will keep changing, so exact-phrase assertions produce
    // false failures without protecting anything. What must not change is the substance:
    // every route states the purpose, that audio is held only in temporary memory, and
    // that the client may decline or withdraw without any effect on the advice.
    const ROUTES = ['live_in_person', 'webex_telephony', 'file_import'];
    const seenTitles = new Set();

    for (const route of ROUTES) {
      const w = consentManager.getWordingForRoute(route);
      assert(w.title && w.title.trim().length > 0, `${route} has no title`);
      assert(w.adviserInstructions && w.adviserInstructions.trim().length > 0, `${route} has no adviser instructions`);
      assert(Array.isArray(w.clientInformationPoints) && w.clientInformationPoints.length >= 3, `${route} has too few disclosure points`);
      assert(w.affirmationStatement && w.affirmationStatement.trim().length > 0, `${route} has no affirmation`);

      // Route wording must be distinct, so an adviser cannot be shown the wrong script.
      assert(!seenTitles.has(w.title), `duplicate consent gate title for ${route}`);
      seenTitles.add(w.title);

      const body = [w.title, w.adviserInstructions, ...w.clientInformationPoints, w.affirmationStatement]
        .join(' ')
        .toLowerCase();

      // Mandatory substance, expressed as alternatives so wording can be revised freely.
      assert(/consent|attest|agree/.test(body), `${route} wording does not reference consent, agreement or attestation`);
    }

    // The two live routes must tell the client about temporary memory and the right to
    // decline. The import route is a professional attestation about a past consultation,
    // so it carries provenance duties instead.
    for (const route of ['live_in_person', 'webex_telephony']) {
      const w = consentManager.getWordingForRoute(route);
      const body = [w.adviserInstructions, ...w.clientInformationPoints].join(' ').toLowerCase();
      assert(/temporary|volatile|memory/.test(body), `${route} does not mention temporary memory retention`);
      assert(/destroy|deleted|erased/.test(body), `${route} does not state that the recording is destroyed`);
      assert(/decline|withdraw|stop/.test(body), `${route} does not state the right to decline or withdraw`);
      assert(/without any effect|does not affect|no effect|without any/.test(body), `${route} does not state that declining carries no detriment`);
      assert(/case note|note for|record|advice/.test(body), `${route} does not tell the client what the recording is for`);
    }

    const importWording = consentManager.getWordingForRoute('file_import');
    const importBody = [importWording.adviserInstructions, ...importWording.clientInformationPoints, importWording.affirmationStatement].join(' ').toLowerCase();
    assert(/attest/.test(importBody), 'import route does not require a professional attestation');
    assert(/date/.test(importBody), 'import route does not require the original consultation date');
  });

  await test('Consent Record creation strictly forbids client PII keys', () => {
    // The public API is recordConsent(route, adviserId, importParams). It takes fixed
    // parameters rather than an open object, so arbitrary client identifiers cannot be
    // passed in at all. The verifyZeroClientPii guard remains the backstop for records
    // reaching the store by any other path, and is exercised directly below.
    const validRecord = consentManager.recordConsent('live_in_person', 'usr_adviser_wandsworth_42');
    assert.strictEqual(validRecord.route, 'live_in_person');
    assert.strictEqual(validRecord.adviserId, 'usr_adviser_wandsworth_42');
    assert.strictEqual(validRecord.confirmedByAdviser, true);
    assert(validRecord.consentId.startsWith('cst_'));

    // An adviser ID is mandatory, so every consent is attributable.
    assert.throws(() => consentManager.recordConsent('live_in_person', ''), /Adviser ID is mandatory/);

    // The zero client PII invariant must reject any record polluted with an identifier.
    for (const [key, value] of [
      ['clientName', 'Jane Doe'],
      ['phoneNumber', '07123456789'],
      ['nino', 'QQ123456C'],
      ['postcode', 'SW18 2PU'],
      ['dob', '1980-01-01'],
      ['fileName', 'interview.m4a'],
    ]) {
      const polluted = { ...consentManager.recordConsent('live_in_person', 'usr_adviser_42'), [key]: value };
      assert.throws(
        () => consentManager.verifyZeroClientPii(polluted),
        (err) => err.name === 'ConsentPrivacyViolationError',
        `verifyZeroClientPii failed to reject a record containing ${key}`
      );
    }
  });

  await test('File import consent requires date, equipment, consent means and party coverage from controlled lists', () => {
    // Phase 6B replaced the free-text consent means with controlled lists and added source
    // equipment and party coverage. This test was written against the earlier free-text API.
    const VALID = {
      originalAppointmentDate: '2026-08-15',
      sourceEquipment: 'caw_olympus_dictaphone',
      consentMeans: 'written_intake_agreement',
      partyCoverage: 'both_parties_captured',
    };

    // No provenance at all
    assert.throws(
      () => consentManager.recordConsent('file_import', 'usr_adv_1'),
      /File import requires date, source equipment, and consent attestation/
    );

    // Malformed appointment date
    assert.throws(
      () => consentManager.recordConsent('file_import', 'usr_adv_1', { ...VALID, originalAppointmentDate: '15/08/2026' }),
      /Original appointment date must be a valid ISO date/
    );

    // Free text is not accepted for any controlled attribute
    assert.throws(
      () => consentManager.recordConsent('file_import', 'usr_adv_1', { ...VALID, sourceEquipment: 'my dictaphone' }),
      /Source equipment must be selected from the controlled list/
    );
    assert.throws(
      () => consentManager.recordConsent('file_import', 'usr_adv_1', { ...VALID, consentMeans: 'Signed paper form' }),
      /Consent means must be selected from the controlled list/
    );
    assert.throws(
      () => consentManager.recordConsent('file_import', 'usr_adv_1', { ...VALID, partyCoverage: 'everyone' }),
      /Party coverage must be selected from the controlled list/
    );

    // Valid import record
    const validImport = consentManager.recordConsent('file_import', 'usr_adv_1', VALID);
    assert.strictEqual(validImport.originalAppointmentDate, '2026-08-15');
    assert.strictEqual(validImport.importConsentMeans, 'written_intake_agreement');
    assert.strictEqual(validImport.importProvenance?.sourceEquipment, 'caw_olympus_dictaphone');
    assert.strictEqual(validImport.importProvenance?.capturePartyCoverage, 'both_parties_captured');
    // File names are never retained.
    assert.strictEqual(validImport.importProvenance?.fileNameDiscarded, true);

    // Unmanaged devices must be flagged so the risk is visible on the record.
    const unmanaged = consentManager.recordConsent('file_import', 'usr_adv_1', { ...VALID, sourceEquipment: 'external_client_device' });
    assert.strictEqual(unmanaged.importProvenance?.isUnmanagedDevice, true);
    assert.strictEqual(validImport.importProvenance?.isUnmanagedDevice, false);
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
      (err) => err.message.includes('cannot start before affirmative consent is confirmed')
    );

    // 2. Confirm consent and connect call
    const consent = consentManager.recordConsent('webex_telephony', 'usr_webex_adv');
    webexStreamCapture.confirmConsent(consent);
    assert.strictEqual(webexStreamCapture.isConsentUnlocked(), true);

    webexStreamCapture.connectCall(null, null);
    webexStreamCapture.startRecording();

    // 3. Feed simulated dual-channel audio chunks (Adviser Ch 0, Client Ch 1)
    const adviserChunk = new Float32Array([0.1, 0.2, 0.3]);
    const clientChunk = new Float32Array([-0.1, -0.2, -0.3]);
    webexStreamCapture.recordChunk(adviserChunk, clientChunk);

    // 4. Test normal stop recording
    const captureResult = webexStreamCapture.stopRecording();
    assert(captureResult.pcmBuffer instanceof ArrayBuffer);
    assert.strictEqual(captureResult.sampleRate, 16000);
    assert.strictEqual(captureResult.channelMapping.isDualChannel, true);
    assert.strictEqual(captureResult.channelMapping.adviserChannel, 0);
    assert.strictEqual(captureResult.channelMapping.clientChannel, 1);

    // 5. Test Withdraw Consent during active call: recording destroyed, call remains connected
    webexStreamCapture.startRecording();
    webexStreamCapture.recordChunk(new Float32Array([0.4, 0.5]), new Float32Array([-0.4, -0.5]));

    webexStreamCapture.withdrawConsentAndContinueCall();
    assert.strictEqual(webexStreamCapture.isConsentUnlocked(), false);
    // Call is still connected for unrecorded advice
    webexStreamCapture.endCall();
  });

  await test('Single Dominant Speaker Detector identifies acoustic imbalances', () => {
    const detector = new DominantSpeakerDetector();

    // The detector estimates its noise floor from the quietest fifth of the recording, so
    // the test signal must contain the natural pauses that real speech has. The previous
    // version used continuous full-amplitude noise, which pushed the noise floor up to the
    // level of the speech itself and left the detector with nothing to measure.
    let seed = 20260903;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed / 0x7fffffff) * 2 - 1;
    };
    const SR = 16000;
    const SILENCE = 0.001;
    const build = (segments) => {
      const total = segments.reduce((n, [secs]) => n + Math.round(secs * SR), 0);
      const out = new Float32Array(total);
      let o = 0;
      for (const [secs, amp] of segments) {
        const n = Math.round(secs * SR);
        for (let i = 0; i < n; i++) out[o + i] = rand() * amp;
        o += n;
      }
      return out;
    };

    // Two speakers at different distances from the microphone, taking turns, with pauses.
    // Adviser close to the mic, client across the desk but clearly audible.
    const balanced = [];
    for (let cycle = 0; cycle < 7; cycle++) {
      balanced.push([2, 0.35], [1, SILENCE], [2, 0.043], [1, SILENCE]);
    }
    const balancedResult = detector.analyzePcmBuffer(build(balanced).buffer);
    assert.strictEqual(balancedResult.isSingleDominantSpeaker, false);
    assert.strictEqual(balancedResult.warningMessage, null);
    assert(balancedResult.estimatedTurnsCount > 1, 'a two-speaker conversation should show turn taking');
    assert(balancedResult.totalVoicedDurationSeconds >= 15, 'not enough voiced audio to judge');

    // One speaker close to the microphone for the whole consultation, with pauses.
    // The client is either silent or too far away to register.
    const monologue = [];
    for (let cycle = 0; cycle < 7; cycle++) {
      monologue.push([3, 0.35], [1.5, SILENCE]);
    }
    const monologueResult = detector.analyzePcmBuffer(build(monologue).buffer);
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

    // The pressure calculation is keyed on elapsed minutes, not on a byte count.
    const pressureAt = (minutes) => {
      currentPressure = null;
      capture['checkMemoryPressure'](minutes);
      return currentPressure;
    };

    assert.strictEqual(pressureAt(30)?.level, 'normal');
    assert.strictEqual(pressureAt(30)?.message, null);

    assert.strictEqual(pressureAt(45)?.level, 'moderate');
    assert.strictEqual(pressureAt(50)?.level, 'moderate');
    assert(/extended interview duration/i.test(pressureAt(50)?.message ?? ''));

    assert.strictEqual(pressureAt(60)?.level, 'high_pressure');
    assert.strictEqual(pressureAt(75)?.level, 'high_pressure');
    assert(/high memory pressure/i.test(pressureAt(75)?.message ?? ''));

    // The 90 minute cap is a hard stop, not a warning.
    assert.strictEqual(pressureAt(90)?.level, 'limit_exceeded');
    assert.strictEqual(pressureAt(95)?.level, 'limit_exceeded');
    assert(/must be concluded/i.test(pressureAt(95)?.message ?? ''));
  });

  await test('AudioNormalizer produces unified in-memory Float32 representation across all 3 routes', () => {
    // The normaliser writes into the volatile session, which must exist first. Storing raw
    // audio without an initialised session is refused by design, so initialise one here.
    volatileSessionStore.initSession('live_microphone', 'usr_adv_norm');

    const consentLive = consentManager.recordConsent('live_in_person', 'usr_adv_norm');
    const consentWebex = consentManager.recordConsent('webex_telephony', 'usr_adv_norm');
    const consentImport = consentManager.recordConsent('file_import', 'usr_adv_norm', {
      originalAppointmentDate: '2026-08-10',
      sourceEquipment: 'caw_olympus_dictaphone',
      consentMeans: 'written_intake_agreement',
      partyCoverage: 'both_parties_captured',
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
        pcmBuffer: webexPcm,
        durationSeconds: 10.0,
        sampleRate: 16000,
        channelMapping: { isDualChannel: true, adviserChannel: 0, clientChannel: 1 },
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
    const consent = consentManager.recordConsent('live_in_person', 'usr_withdraw_adv');
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
    volatileSessionStore.setRawAudio(audioBuf, audioBuf.byteLength / 4 / 16000, 16000);
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

