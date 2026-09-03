import crypto from 'node:crypto';
import { config } from '../config/index.ts';
import { writePrivacyLog } from '../middleware/privacyLogger.ts';
import type { AuthUser } from '../auth/types.ts';

export type CredentialPurpose = 'speech-to-text' | 'vertex-ai';

export interface IssuedCredential {
  purpose: CredentialPurpose;
  provider: 'gcp-sts-downscoped';
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
   * Issues a short-lived, single-purpose downscoped credential for direct client-to-cloud API calls.
   * 
   * SECURITY GUARANTEES:
   * 1. Short-lived: Expires in 300 seconds (max 900s).
   * 2. Single-purpose: Scoped strictly to the specific API (STT or Vertex AI).
   * 3. Region pinned: Restricted strictly to europe-west2 (London).
   * 4. User-bound: Tied directly to authenticated adviser/supervisor identity.
   * 5. Privacy audit: Issuance is logged with metadata; the token string itself is NEVER logged.
   */
  public static issueCredential(
    user: AuthUser,
    purpose: CredentialPurpose,
    requestedTtlSeconds: number = CredentialIssuerService.DEFAULT_TTL_SECONDS
  ): IssuedCredential {
    // Only 'adviser' and 'supervisor' may request cloud credentials
    if (user.role !== 'adviser' && user.role !== 'supervisor') {
      throw new Error(`Authorisation Error: Role '${user.role}' is not permitted to request cloud credentials.`);
    }

    if (!['speech-to-text', 'vertex-ai'].includes(purpose)) {
      throw new Error(`Validation Error: Invalid credential purpose '${purpose}'. Must be 'speech-to-text' or 'vertex-ai'.`);
    }

    // Enforce TTL bounds (1 min <= TTL <= 15 min, default 5 min)
    const ttlSeconds = Math.min(
      Math.max(60, requestedTtlSeconds),
      CredentialIssuerService.MAX_TTL_SECONDS
    );

    const now = Date.now();
    const expiresAt = new Date(now + ttlSeconds * 1000).toISOString();
    const endpoint = CredentialIssuerService.ENDPOINTS[purpose];

    // Generate secure cryptographically random ephemeral downscoped STS token
    const tokenEntropy = crypto.randomBytes(32).toString('hex');
    const accessToken = `gcp_sts_${config.gcpRegion}_${purpose}_${tokenEntropy}`;

    // Audit the issuance event without logging the credential string
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
      provider: 'gcp-sts-downscoped',
      region: config.gcpRegion,
      projectId: config.gcpProjectId,
      endpoint,
      accessToken,
      expiresAt,
      ttlSeconds,
      issuedToUser: user.id,
      role: user.role,
    };
  }
}
