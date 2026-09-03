import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Content Security Policy Enforcement & Hardening', () => {
  const rootDir = process.cwd();
  const htmlPath = path.join(rootDir, 'client/index.html');
  const viteConfigPath = path.join(rootDir, 'client/vite.config.ts');
  const nginxConfigPath = path.join(rootDir, 'infrastructure/docker/nginx.conf');
  const cspDocPath = path.join(rootDir, 'docs/csp.md');

  const htmlContent = fs.readFileSync(htmlPath, 'utf8');
  const viteConfigContent = fs.readFileSync(viteConfigPath, 'utf8');
  const nginxConfigContent = fs.readFileSync(nginxConfigPath, 'utf8');
  const cspDocContent = fs.readFileSync(cspDocPath, 'utf8');

  it('enforces default-src none in all configurations', () => {
    expect(htmlContent).toContain("default-src 'none'");
    expect(viteConfigContent).toContain("default-src 'none'");
    expect(nginxConfigContent).toContain("default-src 'none'");
  });

  it('strictly forbids unsafe-inline across all directives', () => {
    expect(htmlContent).not.toContain("'unsafe-inline'");
    expect(viteConfigContent).not.toContain("'unsafe-inline'");
    expect(nginxConfigContent).not.toContain("'unsafe-inline'");
  });

  it('strictly forbids general unsafe-eval', () => {
    // Only 'wasm-unsafe-eval' is permitted and justified for local WASM runtime
    expect(htmlContent).not.toMatch(/script-src[^;]*'unsafe-eval'/);
    expect(viteConfigContent).not.toMatch(/script-src[^;]*'unsafe-eval'/);
    expect(nginxConfigContent).not.toMatch(/script-src[^;]*'unsafe-eval'/);
  });

  it('allows wasm-unsafe-eval for in-browser local ASR/NER and justifies it in docs', () => {
    expect(htmlContent).toContain("'wasm-unsafe-eval'");
    expect(cspDocContent).toContain("'wasm-unsafe-eval'");
  });

  it('blocks framing and form submission (frame-ancestors none, form-action none)', () => {
    expect(htmlContent).toContain("frame-ancestors 'none'");
    expect(htmlContent).toContain("form-action 'none'");
    expect(htmlContent).toContain("object-src 'none'");
    expect(nginxConfigContent).toContain("frame-ancestors 'none'");
  });

  it('restricts connect-src without wildcards', () => {
    expect(htmlContent).not.toContain('connect-src *');
    expect(viteConfigContent).not.toContain('connect-src *');
    expect(nginxConfigContent).not.toContain('connect-src *');
  });

  it('forbids third-party font CDNs and external analytics', () => {
    const forbiddenDomains = ['fonts.googleapis.com', 'fonts.gstatic.com', 'google-analytics.com', 'sentry.io'];
    for (const domain of forbiddenDomains) {
      expect(htmlContent).not.toContain(domain);
      expect(viteConfigContent).not.toContain(domain);
      expect(nginxConfigContent).not.toContain(domain);
    }
  });
});
