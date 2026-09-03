import { writePrivacyLog } from '../middleware/privacyLogger.ts';
import type { AuthUser } from '../auth/types.ts';
import { config } from '../config/index.ts';
import { getRuntimeAccessToken } from './googleTokenProvider.ts';

/**
 * CredentialIssuerService
 *
 * Issues short-lived, single-purpose Google Cloud credentials so the browser can call
 * Speech-to-Text and Vertex AI directly. Audio and transcript therefore travel from the
 * adviser's device to the region-pinned Google endpoint without passing through this
 * service at all, which is the point of the design.
 *
 * WHY THIS IS NOT A DOWNSCOPED STS TOKEN
 *
 * Earlier revisions described a "downscoped STS credential" produced with a Credential
 * Access Boundary, and the previous implementation returned a random string formatted to
 * look like one. It authenticated nothing. Google's Credential Access Boundaries are
 * available for Cloud Storage only; no other service supports them, so a boundary-scoped
 * token for Speech-to-Text or Vertex AI cannot be created. The documented architecture
 * rested on a capability that does not exist.
 *
 * The achievable equivalent, implemented here, reaches the same objective by separating
 * identities rather than by constraining one token:
 *
 *   - Each purpose has its own service account holding exactly one role.
 *       case-ace-stt-sa     -> roles/speech.client
 *       case-ace-vertex-sa  -> roles/aiplatform.user
 *   - The backend's runtime identity holds serviceAccountTokenCreator on each, and mints a
 *     token for the appropriate one via IAM Credentials generateAccessToken.
 *   - The token is short-lived (default 5 minutes) and, by IAM, can do nothing but call
 *     that single API.
 *
 * RESIDUAL RISK, STATED PLAINLY
 *
 * The token handed to the browser is a full access token for a least-privilege service
 * account, not a resource-scoped one. Within its short lifetime, an attacker who obtained
 * it could call that one API at CAW's expense. It could not read storage, reach another
 * project, or touch any other service. The compensating controls are the short lifetime,
 * the single role, the audit record written on every issuance, and the strict CSP that
 * limits where the page may send anything. This is a real reduction against the boundary
 * model that was described but never available, and it should be recorded as such in the
 * threat model rather than left implied.
 */

export type CredentialPurpose = 'speech-to-text' | 'vertex-ai';

export interface IssuedCredential {
  purpose: CredentialPurpose;
  provider: 'gcp-impersonated-service-account';
  region: string;
  projectId: string;
  endpoint: string;
  accessToken: string;
  expiresAt: string;
  ttlSeconds: number;
  issuedToUser: string;
  role: string;
}

export class CredentialIssuerService {
  public static readonly DEFAULT_TTL_SECONDS = 300; // 5 minutes
  public static readonly MAX_TTL_SECONDS = 900; // 15 minutes absolute maximum

  private static readonly ENDPOINTS: Record<CredentialPurpose, string> = {
    'speech-to-text': 'https://europe-west2-speech.googleapis.com',
    'vertex-ai': 'https://europe-west2-aiplatform.googleapis.com',
  };

  /**
   * The step that actually mints a token, isolated so tests can exercise the authorisation,
   * validation, TTL and audit behaviour without reaching Google. The default is the real
   * IAM Credentials call; nothing but a test may replace it.
   */
  private static mintToken: (
    serviceAccount: string,
    ttlSeconds: number
  ) => Promise<{ accessToken: string; expireTime?: string }> = CredentialIssuerService_realMint;

  /** Test seam. Returns a function that restores the real minter. */
  public static setTokenMinterForTesting(
    fn: (serviceAccount: string, ttlSeconds: number) => Promise<{ accessToken: string; expireTime?: string }>
  ): () => void {
    const previous = CredentialIssuerService.mintToken;
    CredentialIssuerService.mintToken = fn;
    return () => {
      CredentialIssuerService.mintToken = previous;
    };
  }

  /** One service account per purpose, each holding exactly one role. */
  private static serviceAccountFor(purpose: CredentialPurpose): string {
    const accounts: Record<CredentialPurpose, string> = {
      'speech-to-text':
        process.env.STT_SERVICE_ACCOUNT || `case-ace-stt-sa@${config.gcpProjectId}.iam.gserviceaccount.com`,
      'vertex-ai':
        process.env.VERTEX_SERVICE_ACCOUNT || `case-ace-vertex-sa@${config.gcpProjectId}.iam.gserviceaccount.com`,
    };
    return accounts[purpose];
  }

  /**
   * SECURITY PROPERTIES:
   * 1. Short-lived: expires in 300 seconds by default, 900 maximum.
   * 2. Single-purpose: the identity holds one role and can call one API.
   * 3. Region pinned: the endpoint handed back is the europe-west2 endpoint.
   * 4. User-bound: only an authenticated adviser or supervisor may request one.
   * 5. Audited: issuance is logged with metadata; the token itself is never logged.
   */
  public static async issueCredential(
    user: AuthUser,
    purpose: CredentialPurpose,
    requestedTtlSeconds: number = CredentialIssuerService.DEFAULT_TTL_SECONDS
  ): Promise<IssuedCredential> {
    if (user.role !== 'adviser' && user.role !== 'supervisor') {
      throw new Error(`Authorisation Error: Role '${user.role}' is not permitted to request cloud credentials.`);
    }

    if (!['speech-to-text', 'vertex-ai'].includes(purpose)) {
      throw new Error(`Validation Error: Invalid credential purpose '${purpose}'. Must be 'speech-to-text' or 'vertex-ai'.`);
    }

    const ttlSeconds = Math.min(
      Math.max(60, requestedTtlSeconds),
      CredentialIssuerService.MAX_TTL_SECONDS
    );

    const targetServiceAccount = CredentialIssuerService.serviceAccountFor(purpose);

    // Deliberately no fallback on failure. A caller handed a placeholder credential fails
    // later, somewhere less obvious, with a worse error.
    const minted = await CredentialIssuerService.mintToken(targetServiceAccount, ttlSeconds);
    if (!minted?.accessToken) {
      throw new Error(`Credential issuance for '${purpose}' returned no token.`);
    }

    const expiresAt = minted.expireTime ?? new Date(Date.now() + ttlSeconds * 1000).toISOString();

    writePrivacyLog({
      level: 'info',
      event: 'CREDENTIAL_ISSUED',
      userId: user.id,
      role: user.role,
      purpose,
      ttlSeconds,
      region: config.gcpRegion,
    });

    return {
      purpose,
      provider: 'gcp-impersonated-service-account',
      region: config.gcpRegion,
      projectId: config.gcpProjectId,
      endpoint: CredentialIssuerService.ENDPOINTS[purpose],
      accessToken: minted.accessToken,
      expiresAt,
      ttlSeconds,
      issuedToUser: user.id,
      role: user.role,
    };
  }
}

/**
 * Mints a token for a purpose account for the backend's own use, so server-side calls run
 * under the same least-privilege identity as the browser's. The runtime service account
 * itself holds no API roles at all: it can mint a token for exactly two accounts, and
 * neither of them can do anything but call its one API.
 */
export async function getPurposeAccessToken(
  purpose: CredentialPurpose,
  ttlSeconds: number = CredentialIssuerService.DEFAULT_TTL_SECONDS
): Promise<string> {
  const account =
    purpose === 'vertex-ai'
      ? process.env.VERTEX_SERVICE_ACCOUNT || `case-ace-vertex-sa@${config.gcpProjectId}.iam.gserviceaccount.com`
      : process.env.STT_SERVICE_ACCOUNT || `case-ace-stt-sa@${config.gcpProjectId}.iam.gserviceaccount.com`;
  const minted = await CredentialIssuerService_realMint(account, ttlSeconds);
  return minted.accessToken;
}

/**
 * The real minting step: IAM Credentials generateAccessToken, impersonating the
 * least-privilege service account for the requested purpose. Declared after the class
 * because it is referenced as the default value of a static member.
 */
async function CredentialIssuerService_realMint(
  serviceAccount: string,
  ttlSeconds: number
): Promise<{ accessToken: string; expireTime?: string }> {
  const runtimeToken = await getRuntimeAccessToken();

  const url =
    'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/' +
    `${encodeURIComponent(serviceAccount)}:generateAccessToken`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${runtimeToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      scope: ['https://www.googleapis.com/auth/cloud-platform'],
      lifetime: `${ttlSeconds}s`,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`generateAccessToken failed for ${serviceAccount}: HTTP ${res.status} ${detail}`);
  }

  return (await res.json()) as { accessToken: string; expireTime?: string };
}
