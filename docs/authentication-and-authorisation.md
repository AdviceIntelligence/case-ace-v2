# Authentication and Authorisation Architecture

**Document ID**: DOC-SEC-006  
**Classification**: Official  
**System**: Case Ace v2.0 (Citizens Advice Wandsworth)  
**Standard Alignment**: ISO/IEC 27001:2022 (A.5.15, A.5.18, A.8.2, A.8.5), ISO/IEC 27701:2019, RFC 6238, OIDC Core 1.0  
**Data Scope**: UK GDPR Special Category Data Access Control  

---

## 1. Architectural Principles & Threat Context

Case Ace v2.0 implements strict identity and access governance tailored to a zero-persistence advice drafting system:
1. **Mandatory Multi-Factor Authentication (MFA)**: No user may initiate a session without cryptographically verified multi-factor authentication.
2. **Stateless Role-Based Access Control (RBAC)**: Roles are enforced server-side on every request and encoded in short-lived cryptographic tokens.
3. **The Fundamental Privacy Guarantee**:
   > [!IMPORTANT]
   > **ZERO CROSS-SESSION ACCESS GUARANTEE**:  
   > No role—including `supervisor`, `administrator`, and `auditor`—can access another user's consultation data, transcripts, or case notes, **because no session data exists to access**. Consultation data exists only in volatile RAM on the individual adviser's device during an active interview and is destroyed upon session end.

---

## 2. The `AuthProvider` Interface

All authentication flows implement the unified `AuthProvider` interface:

```typescript
export interface AuthProvider {
  readonly providerType: 'entra_id' | 'totp';
  authenticate(params: EntraIdAuthParams | TotpAuthParams): Promise<AuthResult>;
  verifyToken(token: string): Promise<AuthUser | null>;
  refreshToken(refreshToken: string): Promise<AuthResult>;
}
```

---

## 3. Provider Implementations

### 3.1 Primary Provider: `EntraIdProvider` (Microsoft Entra ID)
* **Protocol**: OpenID Connect (OIDC) Authorization Code Flow with Proof Key for Code Exchange (PKCE) per RFC 7636.
* **MFA & Conditional Access**: Enforced via CAW Entra ID Conditional Access policies requiring compliant managed devices and registered authenticator apps.
* **Mandatory `amr` (Authentication Methods References) Claim Verification**:
  * The backend inspects the `amr` claim in the ID token.
  * The token MUST contain explicit MFA indicators (e.g., `mfa`, `fido`, `ngcmfa`, `otp`, `hwk`, `swk`, `sms`).
  * **Fail-Closed Rule**: If the `amr` claim is missing or only contains single-factor identifiers (e.g., `["pwd"]`), the authentication attempt is **immediately rejected with `MFA_REQUIRED`**.
* **Role Resolution**:
  Security group claims (`groups`) drive role assignments:
  * `grp-caw-advisers` $\rightarrow$ `adviser`
  * `grp-caw-supervisors` $\rightarrow$ `supervisor`
  * `grp-caw-admins` $\rightarrow$ `administrator`
  * `grp-caw-auditors` $\rightarrow$ `auditor`

---

### 3.2 Fallback Provider: `TotpProvider` (RFC 6238 TOTP)
* **Purpose**: Development, automated CI testing, and emergency operational fallback if Entra ID registration or federated tenant connectivity stalls.
* **Credentials**:
  * Username.
  * Password hashed with `scrypt` (64-byte derived key, 16-byte random salt).
  * 6-digit Time-Based One-Time Password (TOTP) per RFC 6238 (HMAC-SHA1, 30-second time step, $\pm 1$ step clock drift allowance).
* **Brute-Force Rate Limiting & Account Lockout**:
  * 5 consecutive failed authentication attempts trigger an automatic **15-minute temporary lockout** (`ACCOUNT_LOCKED`).
  * Resets upon successful authentication.
* **Pilot Environment Prohibition**:
  * `TotpProvider` is **forbidden by default in the `pilot` environment**.
  * Any attempt to initialize `TotpProvider` under `APP_ENV=pilot` causes the backend to fail closed immediately at boot, **unless** the interim override below is deliberately set.

* **Interim Override: `ALLOW_TOTP_IN_PILOT`** (added 3 September 2026):
  * Setting `ALLOW_TOTP_IN_PILOT=true` permits `TotpProvider` under `APP_ENV=pilot`, and switches `activeProvider` to `totp`.
  * It exists for one purpose: to allow the pilot infrastructure to be deployed and exercised **before the CAW Entra ID tenant is available**. It is not a supported operating configuration.
  * The backend emits a `[SECURITY OVERRIDE]` warning at boot naming the environment and the consequence.
  * **Residual risk while set**: adviser identity is not verified against a managed directory, TOTP enrolment is not gated by tenant membership, and group-to-role mapping (`grp-caw-advisers` and siblings) does not apply, so role assignment falls back to local credential records.
  * **Control**: `ALLOW_TOTP_IN_PILOT` must be unset, and `enableEntraId` restored to `true`, before any real client consultation is processed in the pilot environment. This is a gating item for the pilot readiness review and must be recorded in the DPIA as an accepted interim risk while it remains set.

---

## 4. Configuration Mutual Exclusivity & Fail-Closed Enforcement

> [!CAUTION]
> **FAIL-CLOSED DUAL-PROVIDER PROHIBITION**:  
> The system configuration strictly forbids enabling both `EntraIdProvider` and `TotpProvider` simultaneously.  
> If configuration parameters `enableEntraId` and `enableTotp` are both evaluated as `true`, the factory throws an unrecoverable `Security Configuration Error` and halts execution.

```typescript
export function createAuthProvider(config: AuthConfig, environmentName: string): AuthProvider {
  if (config.enableEntraId && config.enableTotp) {
    throw new Error('Security Configuration Error: Mutually exclusive auth providers cannot both be enabled simultaneously.');
  }
  if (!config.enableEntraId && !config.enableTotp) {
    throw new Error('Security Configuration Error: No authentication provider is enabled.');
  }
  if (environmentName === 'pilot' && config.enableTotp) {
    if (!config.allowTotpInPilot) {
      throw new Error('Security Policy Violation: Fallback TOTP is strictly forbidden in pilot.');
    }
    console.warn('[SECURITY OVERRIDE] TOTP active in pilot; directory-backed identity is not in force.');
  }
  return config.enableEntraId ? new EntraIdProvider(config) : new TotpProvider(config);
}
```

---

## 5. Server-Side Role-Based Access Control (RBAC) Matrix

Server-side middleware (`requireAuth`, `requireRole`) strictly gates every API endpoint. Role checks are never delegated solely to the client UI.

| Endpoint | Permitted Roles | Action & Scope |
| :--- | :--- | :--- |
| `POST /api/v1/auth/token`, `POST /api/v1/auth/login` | *Public / Unauthenticated* | Authenticates credentials or OIDC code and returns short-lived tokens. |
| `GET /api/v1/auth/callback` | *Public / Unauthenticated* | Handles OIDC authorization code redirection callback. |
| `POST /api/v1/auth/refresh` | *Authenticated Session* | Issues new access token from valid refresh token. |
| `GET /api/v1/auth/session` | `adviser`, `supervisor`, `administrator`, `auditor` | Returns authenticated user profile and active claims. |
| `POST /api/v1/credentials/issue` | **`adviser`**, **`supervisor`** | Issues short-lived (5m), single-purpose scoped GCP credentials for STT / Vertex AI. |
| `POST /api/v1/monitoring/events` | *All (Internal)* | Ingests operational metric events. Rejects all session data and PII keys. |
| `GET /api/v1/monitoring/aggregate` | **`supervisor`**, **`auditor`** | Returns aggregate operational metrics. Zero consultation text. |
| `GET /api/v1/config` | *All / Unauthenticated* | Returns non-sensitive runtime configuration. |
| `GET /health`, `GET /api/v1/health` | *Public* | Liveness and readiness probe. |
| `* (Session Data Endpoints)` | **NONE (Zero Roles)** | **Non-existent. No endpoint exists to read, write, or list consultation sessions.** |

---

## 6. Session Lifecycle & Ephemerality

* **Access Token TTL**: 15 minutes (900 seconds).
* **Refresh Token TTL / Absolute Session Cap**: 8 hours (28,800 seconds).
* **Client Idle Inactivity Timeout**:
  * Configured for **15 minutes** of inactivity (no mouse, keyboard, or touch events).
  * Upon expiry, `IdleTimeoutManager` immediately executes:
    1. `volatileSessionStore.destroySession()`: Physically zeroes all audio memory buffers (`Uint8Array.fill(0)`), clears token map, and wipes consultation state.
    2. `volatileAuthStore.clearAuth()`: Purges access and refresh tokens from memory.
    3. Prompts user with session expired notification.
* **Destructive Logout Action**:
  * Logging out opens a mandatory modal warning the adviser that unsaved notes will be permanently erased.
  * Confirmation executes immediate, irreversible in-memory wiping.
