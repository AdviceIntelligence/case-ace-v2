/**
 * googleTokenProvider
 *
 * Obtains Google Cloud access tokens without any credential ever touching disk.
 *
 * On Cloud Run the runtime service account identity is supplied by the metadata server,
 * so there is no key file, no GOOGLE_APPLICATION_CREDENTIALS path and nothing to rotate
 * or leak. This is the pattern the deployment runbook requires, and the reason the
 * previous instruction to download a service account key was removed from it.
 *
 * Locally there is no metadata server, so the developer's own gcloud credentials are used.
 * That path is deliberately restricted to the local environment: it must never be a way for
 * a deployed service to acquire an identity it was not granted.
 *
 * No new dependency is introduced. The backend pins every package and each one is justified
 * in docs/dependencies.md, so a token library would have to earn its place; two REST calls
 * do not justify it.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config/index.ts';

const execFileAsync = promisify(execFile);

const METADATA_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

interface CachedToken {
  token: string;
  expiresAtMs: number;
}

let cached: CachedToken | null = null;

/** Refresh a minute before expiry so a request never travels with a token about to die. */
const EXPIRY_MARGIN_MS = 60_000;

async function fetchFromMetadataServer(): Promise<CachedToken | null> {
  try {
    const res = await fetch(METADATA_TOKEN_URL, {
      headers: { 'Metadata-Flavor': 'Google' },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) return null;
    return {
      token: body.access_token,
      expiresAtMs: Date.now() + (body.expires_in ?? 3600) * 1000,
    };
  } catch {
    // Not running on Google Cloud, or the metadata server is unreachable.
    return null;
  }
}

async function fetchFromLocalGcloud(): Promise<CachedToken | null> {
  if (config.env !== 'local') return null;
  try {
    const { stdout } = await execFileAsync('gcloud', ['auth', 'print-access-token'], {
      timeout: 15_000,
    });
    const token = stdout.trim();
    if (!token) return null;
    // gcloud does not report expiry here; assume the standard hour and refresh early.
    return { token, expiresAtMs: Date.now() + 45 * 60 * 1000 };
  } catch {
    return null;
  }
}

/**
 * Returns an access token for the runtime service account.
 * Throws rather than returning a placeholder: a caller that proceeds without a real
 * credential produces a silent failure downstream, which is the failure mode this codebase
 * has already been bitten by more than once.
 */
export async function getRuntimeAccessToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAtMs - EXPIRY_MARGIN_MS) {
    return cached.token;
  }

  const fresh = (await fetchFromMetadataServer()) ?? (await fetchFromLocalGcloud());

  if (!fresh) {
    throw new Error(
      '[Auth] Could not obtain a Google Cloud access token. On Cloud Run this means the ' +
        'metadata server is unreachable or no service account is attached to the service. ' +
        'Locally it means gcloud is not authenticated (run: gcloud auth login).'
    );
  }

  cached = fresh;
  return fresh.token;
}

/** Test seam: clears the cached token so a test can control token acquisition. */
export function resetTokenCacheForTesting(): void {
  cached = null;
}
