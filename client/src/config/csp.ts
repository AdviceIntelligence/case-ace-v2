/**
 * csp
 *
 * The single place the Content Security Policy is composed.
 *
 * Two policies used to be written by hand: an HTTP header (correct for the pilot) and a
 * <meta http-equiv> tag baked into client/index.html (still carrying the local development
 * connect-src). A browser given more than one policy enforces ALL of them, so the effective
 * connect-src was the intersection of the two, which was 'self' alone. Every call from the
 * deployed SPA to https://api.caseace.adviceintelligence.tech was refused before it left the
 * page, and login could never succeed.
 *
 * The policy is now derived from environments.ts, so the allowlist that the application
 * believes it may talk to and the allowlist the browser enforces cannot drift apart.
 */

import { ENVIRONMENTS, type EnvironmentName } from './environments.ts';

/** Directives that never vary by environment. */
const STATIC_DIRECTIVES = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'", // wasm-unsafe-eval: in-browser Whisper/NER pass. See docs/csp.md.
  "style-src 'self'",
  "font-src 'self' data:",
  "img-src 'self' data:",
] as const;

const TAIL_DIRECTIVES = [
  "worker-src 'self' blob:",
  "media-src 'self' blob:",
  "object-src 'none'",
] as const;

/** Only meaningful in an HTTP header; ignored, with a console warning, in a <meta> tag. */
const HEADER_ONLY_DIRECTIVES = ["frame-ancestors 'none'"] as const;

const FINAL_DIRECTIVES = ["form-action 'none'", "base-uri 'self'"] as const;

function connectSrc(envName: EnvironmentName): string {
  const env = ENVIRONMENTS[envName] ?? ENVIRONMENTS.local;
  return ["'self'", ...env.cspConnectAllowlist].join(' ');
}

function compose(envName: EnvironmentName, includeHeaderOnly: boolean): string {
  const directives = [
    ...STATIC_DIRECTIVES,
    `connect-src ${connectSrc(envName)}`,
    ...TAIL_DIRECTIVES,
    ...(includeHeaderOnly ? HEADER_ONLY_DIRECTIVES : []),
    ...FINAL_DIRECTIVES,
  ];
  return `${directives.join('; ')};`;
}

/** The policy to send as a Content-Security-Policy HTTP header. */
export function cspHeader(envName: EnvironmentName): string {
  return compose(envName, true);
}

/**
 * The policy to bake into index.html as a <meta http-equiv> tag.
 * frame-ancestors is omitted because a meta-delivered CSP cannot express it; framing is
 * blocked by the header policy and by X-Frame-Options: DENY.
 */
export function cspMeta(envName: EnvironmentName): string {
  return compose(envName, false);
}

/** Placeholder replaced in client/index.html at build time. */
export const CSP_PLACEHOLDER = '__CSP_POLICY__';
