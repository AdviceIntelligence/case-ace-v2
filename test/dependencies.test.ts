import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Dependency Supply Chain & Network Call Policy', () => {
  const rootDir = process.cwd();
  const clientPkgPath = path.join(rootDir, 'client/package.json');
  const backendPkgPath = path.join(rootDir, 'backend/package.json');
  const docsDepPath = path.join(rootDir, 'docs/dependencies.md');

  const clientPkg = JSON.parse(fs.readFileSync(clientPkgPath, 'utf8'));
  const backendPkg = JSON.parse(fs.readFileSync(backendPkgPath, 'utf8'));
  const docsDepContent = fs.readFileSync(docsDepPath, 'utf8');

  it('pins all client runtime dependency versions exactly', () => {
    const deps = clientPkg.dependencies || {};
    for (const [name, version] of Object.entries(deps)) {
      expect(version).not.toMatch(/[\^~*><]/);
      expect(version).toMatch(/^\d+\.\d+\.\d+/);
    }
  });

  it('pins all client devDependency versions exactly', () => {
    const devDeps = clientPkg.devDependencies || {};
    for (const [name, version] of Object.entries(devDeps)) {
      expect(version).not.toMatch(/[\^~*><]/);
      expect(version).toMatch(/^\d+\.\d+\.\d+/);
    }
  });

  it('pins all backend dependency versions exactly', () => {
    const deps = backendPkg.dependencies || {};
    for (const [name, version] of Object.entries(deps)) {
      expect(version).not.toMatch(/[\^~*><]/);
      expect(version).toMatch(/^\d+\.\d+\.\d+/);
    }
  });

  it('justifies every client dependency in docs/dependencies.md', () => {
    const deps = clientPkg.dependencies || {};
    for (const [name] of Object.entries(deps)) {
      expect(docsDepContent).toContain(`\`${name}\``);
    }
  });

  it('contains zero forbidden telemetry or network tracking libraries', () => {
    const forbidden = ['sentry', 'bugsnag', 'logrocket', 'mixpanel', 'analytics', 'segment', 'datadog', 'posthog'];
    const allClientDeps = { ...clientPkg.dependencies, ...clientPkg.devDependencies };
    for (const depName of Object.keys(allClientDeps)) {
      for (const banned of forbidden) {
        expect(depName.toLowerCase()).not.toContain(banned);
      }
    }
  });
});
