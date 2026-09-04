import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { cspHeader, cspMeta, CSP_PLACEHOLDER } from '../client/src/config/csp.ts';
import { ENVIRONMENTS, type EnvironmentName } from '../client/src/config/environments.ts';

/**
 * The policy is generated from environments.ts, so these tests assert the generated strings
 * rather than searching configuration files for substrings. The defect that motivated the
 * rewrite was invisible to a substring search: index.html and the Firebase Hosting header
 * each contained a valid-looking policy, but the browser enforces every policy it is given,
 * and the intersection of the two forbade the SPA from calling its own API.
 */
describe('Content Security Policy Enforcement & Hardening', () => {
  const rootDir = process.cwd();
  const read = (p: string) => fs.readFileSync(path.join(rootDir, p), 'utf8');

  const htmlContent = read('client/index.html');
  const viteConfigContent = read('client/vite.config.ts');
  const nginxConfigContent = read('infrastructure/docker/nginx.conf');
  const cspDocContent = read('docs/csp.md');
  const firebaseConfig = JSON.parse(read('firebase.json'));

  const envNames = Object.keys(ENVIRONMENTS) as EnvironmentName[];
  const policies = envNames.flatMap((name) => [
    [`${name} header`, cspHeader(name)] as const,
    [`${name} meta`, cspMeta(name)] as const,
  ]);

  const connectSrc = (policy: string): string[] => {
    const match = /connect-src ([^;]*)/.exec(policy);
    expect(match, `no connect-src in ${policy}`).not.toBeNull();
    return match![1].trim().split(/\s+/);
  };

  it.each(policies)('%s denies everything by default', (_label, policy) => {
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("form-action 'none'");
    expect(policy).toContain("base-uri 'self'");
  });

  it.each(policies)('%s forbids unsafe-inline and general unsafe-eval', (_label, policy) => {
    expect(policy).not.toContain("'unsafe-inline'");
    expect(policy).not.toMatch(/script-src[^;]*(^|[^-])'unsafe-eval'/);
    expect(policy).toContain("'wasm-unsafe-eval'");
  });

  it.each(policies)('%s has no wildcard connect-src', (_label, policy) => {
    expect(connectSrc(policy)).not.toContain('*');
  });

  it('justifies wasm-unsafe-eval in the CSP documentation', () => {
    expect(cspDocContent).toContain("'wasm-unsafe-eval'");
  });

  it.each(envNames)('%s blocks framing in the header and omits it from the meta tag', (name) => {
    expect(cspHeader(name)).toContain("frame-ancestors 'none'");
    expect(cspMeta(name)).not.toContain('frame-ancestors');
  });

  it.each(envNames)('%s may reach its own configured API origin', (name) => {
    const origin = new URL(ENVIRONMENTS[name].apiBaseUrl).origin;
    expect(connectSrc(cspHeader(name))).toContain(origin);
    expect(connectSrc(cspMeta(name))).toContain(origin);
  });

  it.each(envNames.filter((n) => n !== 'local'))('%s permits no localhost origin', (name) => {
    expect(cspHeader(name)).not.toMatch(/localhost|127\.0\.0\.1/);
    expect(cspMeta(name)).not.toMatch(/localhost|127\.0\.0\.1/);
  });

  it('leaves index.html without a hard-coded policy', () => {
    expect(htmlContent).toContain(CSP_PLACEHOLDER);
    expect(htmlContent).not.toMatch(/localhost/);
    expect(htmlContent).not.toMatch(/content="default-src/);
  });

  it('has the vite config derive its policy rather than restate one', () => {
    expect(viteConfigContent).toContain('cspHeader(');
    expect(viteConfigContent).not.toMatch(/content-security-policy'?\s*:\s*"default-src/i);
  });

  it('keeps the Firebase Hosting header identical to the generated pilot policy', () => {
    const appTarget = firebaseConfig.hosting.find((h: any) => h.target === 'app');
    const header = appTarget.headers
      .flatMap((entry: any) => entry.headers)
      .find((h: any) => h.key === 'Content-Security-Policy');
    expect(header?.value).toBe(cspHeader('pilot'));
  });

  it('keeps the nginx image serving the generated pilot policy', () => {
    expect(nginxConfigContent).toContain(cspHeader('pilot'));
  });

  it('forbids third-party font CDNs and external analytics', () => {
    for (const domain of ['fonts.googleapis.com', 'fonts.gstatic.com', 'google-analytics.com', 'sentry.io']) {
      for (const [, policy] of policies) expect(policy).not.toContain(domain);
      expect(nginxConfigContent).not.toContain(domain);
    }
  });
});
