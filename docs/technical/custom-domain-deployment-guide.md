# Custom Domain Deployment & DNS Provisioning Guide

**Document Reference**: CAW-DEPLOY-DOM-2026-01  
**Target Domain**: `caseace.adviceintelligence.tech`  
**API Subdomain**: `api.caseace.adviceintelligence.tech`  
**Target Cloud Region**: Google Cloud `europe-west2` (London, United Kingdom)  
**System**: Case Ace v2.0 Client Consultation Recording & Note Drafting System  
**Status**: Formally Approved Operations Guide  
**Classification**: Official-Sensitive / Technical Operations  

---

## 1. Domain Architecture & Network Topology

```
                                  [ User / Adviser Browser ]
                                              │
                      ┌───────────────────────┴───────────────────────┐
                      │ HTTPS / TLS 1.3                               │ HTTPS / TLS 1.3
                      ▼                                               ▼
         https://caseace.adviceintelligence.tech         https://api.caseace.adviceintelligence.tech
         ┌─────────────────────────────────────┐         ┌─────────────────────────────────────┐
         │ Single Page Application (SPA)       │         │ Stateless Backend Proxy (Node.js)   │
         │ - Pure in-browser execution         │         │ - Ephemeral GCP STS Token Issuer    │
         │ - Whisper WASM + Local NER          │         │ - Strict 0-PII Audit Logger         │
         │ - Volatile RAM Storage (Zero-Disk)  │         │ - Entra ID Auth Validation          │
         └──────────────────┬──────────────────┘         └──────────────────┬──────────────────┘
                            │                                               │
                            │ Direct Ephemeral Scoped API Calls             │ gRPC / TLS
                            ▼                                               ▼
         ┌─────────────────────────────────────────────────────────────────────────────────────┐
         │                       GOOGLE CLOUD PLATFORM (europe-west2 London)                   │
         │  • Cloud Speech-to-Text v2 (Verified Redacted LINEAR16 Audio Only)                  │
         │  • Cloud Vertex AI Gemini 1.5 (Surrogate Tokenised Text Prompts Only)               │
         └─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. DNS Zone Record Configuration (`adviceintelligence.tech`)

DNS for `adviceintelligence.tech` is registered and served by **IONOS**. Both hostnames are
CNAME records pointing at their Firebase Hosting sites. These records are in place and
resolving.

| Type | Host / Name | Target / Value | TTL | Status |
| :--- | :--- | :--- | :--- | :--- |
| **CNAME** | `caseace` | `case-ace-app.web.app.` | 300s | In place |
| **CNAME** | `api.caseace` | `case-ace-api.web.app.` | 300s | In place |

DNS resolving is necessary but not sufficient. Each hostname must also be registered against
its site inside Firebase Hosting. If it is not, the site answers "Site Not Found" even though
the CNAME resolves correctly. Firebase issues and renews the TLS certificate automatically
once the domain is connected and DNS has propagated.

---

## 3. Hosting & Deployment Model

### The route in use: Firebase Hosting in front of Cloud Run

> [!IMPORTANT]
> **Cloud Run domain mappings are not available in `europe-west2`.** The custom domains
> therefore cannot be mapped directly onto the Cloud Run service. Firebase Hosting provides
> the custom domain and TLS, and rewrites requests to the Cloud Run service behind it.

```
   caseace.adviceintelligence.tech      api.caseace.adviceintelligence.tech
                |                                        |
   Firebase Hosting site                    Firebase Hosting site
        case-ace-app                             case-ace-api
                |                                        |
   serves client/dist (static SPA)      rewrites ** to Cloud Run service
                                          case-ace-api (europe-west2)
```

Both sites live on the `case-ace-v2` project and are described by `firebase.json` at the
repository root, so the routing and the security headers are version controlled rather than
configured by hand in a console.

#### Step 1: Deploy the backend

Cloud Build compiles the container image in Google Cloud from repository source. No local
Docker installation is needed.

```bash
gcloud run deploy case-ace-api \
  --project=case-ace-v2 \
  --region=europe-west2 \
  --source=. \
  --dockerfile=infrastructure/docker/Dockerfile.backend \
  --service-account=case-ace-api-sa@case-ace-v2.iam.gserviceaccount.com \
  --allow-unauthenticated \
  --set-env-vars=APP_ENV=pilot,GCP_REGION=europe-west2,GCP_PROJECT_ID=case-ace-v2,ALLOW_TOTP_IN_PILOT=true \
  --set-secrets=JWT_SECRET=case-ace-jwt-secret:latest
```

#### Step 2: Build and deploy the SPA

```bash
VITE_APP_ENV=pilot npm run build
firebase deploy --only hosting --project case-ace-v2
```

`VITE_APP_ENV` is required. `client/src/config/environments.ts` fails closed to the `local`
environment, so a build without it produces an SPA pointing at `http://localhost:8080`.

---

### Residency caveat

Cloud Run, Speech-to-Text and Vertex AI are pinned to `europe-west2`. Firebase Hosting is a
global anycast CDN, so TLS terminates at the Google edge nearest the adviser, which may be
outside the United Kingdom. A **regional** external Application Load Balancer in
`europe-west2` would keep termination inside the UK. A *global* external load balancer would
not, since it terminates at the same global edge. This is an open decision that should be
settled and recorded in the DPIA before the pilot processes real client consultations.

---

## 4. Updating Identity & Telephony Integrations

After provisioning `caseace.adviceintelligence.tech`, update the external identity and telephony OAuth callbacks:

### 1. Microsoft Entra ID App Registration
1. Navigate to the **Microsoft Entra Admin Center** (`https://entra.microsoft.com`).
2. Go to **Identity** $\rightarrow$ **Applications** $\rightarrow$ **App registrations** $\rightarrow$ Select **Case Ace Consultation Assistant**.
3. Under **Authentication** $\rightarrow$ **Redirect URIs**:
   - Add Web / SPA Redirect URI:  
     `https://caseace.adviceintelligence.tech/auth/callback`
4. Under **Single Sign-On**, ensure ID tokens and Access tokens are permitted for PKCE authorization flows.
5. Save changes.

### 2. Cisco Webex Developer Portal
1. Navigate to the **Webex Developer Portal** (`https://developer.webex.com/my-apps`).
2. Select your **Case Ace Telephony Ingest Integration**.
3. Under **Redirect URI(s)**:
   - Add: `https://caseace.adviceintelligence.tech/api/auth/webex/callback`  
   - Add: `https://api.caseace.adviceintelligence.tech/api/auth/webex/callback`
4. Save changes.

---

## 5. Post-Deployment Verification & Smoke Test

Run the following verification suite from your terminal once DNS propagation is complete:

```bash
# 1. Test HTTPS & TLS 1.3 Handshake on Frontend
curl -s -I https://caseace.adviceintelligence.tech | grep -iE "http/|content-security-policy|strict-transport-security"

# Expected Output:
# HTTP/2 200 (or HTTP/1.1 200 OK)
# strict-transport-security: max-age=63072000; includeSubDomains; preload
# content-security-policy: default-src 'none'; script-src 'self' 'wasm-unsafe-eval'...

# 2. Test Backend Health Check & Region Pinning
curl -s https://api.caseace.adviceintelligence.tech/health

# Expected Output:
# {"status":"healthy","environment":"pilot","gcpRegion":"europe-west2",
#  "isSyntheticOnly":false,"timestamp":"2026-..."}
#
# An HTML page headed "Congratulations | Cloud Run" means the placeholder image is
# still deployed and the backend deployment has not taken effect.

# 3. Test Ephemeral Credential Minting Endpoint (Authenticated)
curl -s -X POST https://api.caseace.adviceintelligence.tech/api/v1/credentials/issue \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ADVISER_JWT>" \
  -d '{"purpose":"speech-to-text"}'

# Expected Output:
# {"accessToken":"gcp_sts_...","expiresInSeconds":300,"region":"europe-west2"}
```

---

## 6. Ongoing Maintenance & Health Monitoring

- **SSL Expiry Alerting**: Automated monitoring via uptime check probes testing TLS validity every 24 hours.
- **Downtime Fallback**: If `caseace.adviceintelligence.tech` is unreachable, advisers immediately execute the **Business Continuity Procedure** and switch to manual note-taking in Casebook CRM. Advice delivery is never delayed.
