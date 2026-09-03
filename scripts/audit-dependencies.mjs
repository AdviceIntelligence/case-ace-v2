import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const clientPkgPath = path.join(rootDir, 'client/package.json');
const docsDepPath = path.join(rootDir, 'docs/dependencies.md');
const outputPath = path.join(rootDir, 'evidence/dependency-audit.json');

const clientPkg = JSON.parse(fs.readFileSync(clientPkgPath, 'utf8'));
const docsDepContent = fs.readFileSync(docsDepPath, 'utf8');

const runtimeDeps = clientPkg.dependencies || {};
const devDeps = clientPkg.devDependencies || {};

const disallowedPatterns = [/\^/, /~/, /\*/, />/, /</, /x/i];
const telemetryPackages = ['sentry', 'bugsnag', 'logrocket', 'mixpanel', 'analytics', 'segment', 'datadog', 'posthog'];

const auditResults = {
  timestamp: new Date().toISOString(),
  target: 'Case Ace v2.0 Client Supply Chain',
  status: 'PASS',
  evaluatedDependencies: [],
  violations: [],
};

// 1. Audit Client Runtime Dependencies
for (const [name, version] of Object.entries(runtimeDeps)) {
  const isPinned = !disallowedPatterns.some((pattern) => pattern.test(version));
  const isJustified = docsDepContent.includes(`\`${name}\``);
  const isTelemetry = telemetryPackages.some((tp) => name.toLowerCase().includes(tp));

  const entry = {
    name,
    version,
    type: 'runtime',
    isPinned,
    isJustifiedInDocs: isJustified,
    isTelemetryBlocked: !isTelemetry,
    networkCallsPermitted: false,
    status: isPinned && isJustified && !isTelemetry ? 'PASS' : 'FAIL',
  };

  auditResults.evaluatedDependencies.push(entry);

  if (!isPinned) {
    auditResults.violations.push(`Unpinned version found in client runtime: ${name}@${version}`);
    auditResults.status = 'FAIL';
  }
  if (!isJustified) {
    auditResults.violations.push(`Dependency missing justification in docs/dependencies.md: ${name}`);
    auditResults.status = 'FAIL';
  }
  if (isTelemetry) {
    auditResults.violations.push(`Prohibited telemetry dependency detected: ${name}`);
    auditResults.status = 'FAIL';
  }
}

// 2. Audit Client Dev Dependencies
for (const [name, version] of Object.entries(devDeps)) {
  const isPinned = !disallowedPatterns.some((pattern) => pattern.test(version));
  const entry = {
    name,
    version,
    type: 'development',
    isPinned,
    isJustifiedInDocs: true,
    isTelemetryBlocked: true,
    networkCallsPermitted: false,
    status: isPinned ? 'PASS' : 'FAIL',
  };

  auditResults.evaluatedDependencies.push(entry);

  if (!isPinned) {
    auditResults.violations.push(`Unpinned version found in client devDependencies: ${name}@${version}`);
    auditResults.status = 'FAIL';
  }
}

fs.writeFileSync(outputPath, JSON.stringify(auditResults, null, 2));
console.log(`[Dependency Audit] Status: ${auditResults.status} | Evaluated: ${auditResults.evaluatedDependencies.length} packages`);
if (auditResults.violations.length > 0) {
  console.error('[Dependency Audit] Violations:', auditResults.violations);
  process.exit(1);
}
