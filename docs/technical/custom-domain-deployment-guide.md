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

Log in to your DNS provider (e.g. Cloudflare, Google Cloud DNS, AWS Route 53, Namecheap, GoDaddy) for the **`adviceintelligence.tech`** zone and configure the following records:

### Table of DNS Records

| Type | Host / Name | Target / Value | TTL | Proxy / CDN Status |
| :--- | :--- | :--- | :--- | :--- |
| **CNAME** | `caseace` | `ghs.googlehosted.com.` *(or Cloud Run / Vercel CNAME)* | Auto / 300s | DNS Only (or Proxied) |
| **CNAME** | `api.caseace` | `ghs.googlehosted.com.` *(or Cloud Run CNAME)* | Auto / 300s | DNS Only (or Proxied) |
| **TXT** | `caseace` | `google-site-verification=...` *(if prompted for domain ownership)* | Auto / 300s | N/A |

> [!TIP]
> If using **Cloudflare DNS**, ensure SSL/TLS encryption mode is set to **Full (Strict)** to guarantee end-to-end TLS 1.3 encryption between Cloudflare edge and the Google Cloud origin.

---

## 3. Hosting & Deployment Options

Choose the deployment model that fits your infrastructure:

### Option A: Google Cloud Run (Recommended — UK Sovereign `europe-west2`)

Deploying directly to Google Cloud Run maintains strict `europe-west2` sovereignty and provides automated Google-managed SSL certificates.

#### Step 1: Build & Push Container Images
```bash
# 1. Set GCP project and region
export GCP_PROJECT_ID="advice-intelligence-prod"
export REGION="europe-west2"
gcloud config set project $GCP_PROJECT_ID
gcloud config set compute/region $REGION

# 2. Authenticate Docker with Google Artifact Registry
gcloud auth configure-docker ${REGION}-docker.pkg.dev

# 3. Build & push Backend container image
docker build -f infrastructure/docker/Dockerfile.backend \
  -t ${REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/case-ace/backend:2.0.0 .
docker push ${REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/case-ace/backend:2.0.0

# 4. Build & push Frontend SPA container image (Nginx hardened)
docker build -f infrastructure/docker/Dockerfile.client \
  --build-arg VITE_APP_ENV=pilot \
  -t ${REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/case-ace/frontend:2.0.0 .
docker push ${REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/case-ace/frontend:2.0.0
```

#### Step 2: Deploy Cloud Run Services
```bash
# Deploy Backend API Service
gcloud run deploy case-ace-api \
  --image ${REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/case-ace/backend:2.0.0 \
  --region ${REGION} \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars APP_ENV=pilot,GCP_REGION=europe-west2,CORS_ORIGIN="https://caseace.adviceintelligence.tech,https://api.caseace.adviceintelligence.tech"

# Deploy Frontend SPA Service
gcloud run deploy case-ace-frontend \
  --image ${REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/case-ace/frontend:2.0.0 \
  --region ${REGION} \
  --platform managed \
  --allow-unauthenticated
```

#### Step 3: Map Custom Domains in Cloud Run
```bash
# Map Frontend to caseace.adviceintelligence.tech
gcloud beta run domain-mappings create \
  --service case-ace-frontend \
  --domain caseace.adviceintelligence.tech \
  --region ${REGION}

# Map Backend to api.caseace.adviceintelligence.tech
gcloud beta run domain-mappings create \
  --service case-ace-api \
  --domain api.caseace.adviceintelligence.tech \
  --region ${REGION}
```
*Cloud Run will display the exact DNS records (typically `ghs.googlehosted.com.`). Google will automatically provision and renew a managed SSL/TLS certificate within 15–30 minutes of DNS propagation.*

---

### Option B: Deploying Frontend via Vercel / Cloudflare Pages

If hosting the frontend on modern edge CDN:
1. Connect your repository to **Vercel** or **Cloudflare Pages**.
2. Set Root Directory to `client/`.
3. Set Build Command to `npm run build` and Output Directory to `dist`.
4. Configure Environment Variable: `VITE_APP_ENV=pilot`.
5. Add Custom Domain: `caseace.adviceintelligence.tech`.
6. Add rewrite rule in `vercel.json` or Cloudflare Transform Rules to route `/api/*` to `https://api.caseace.adviceintelligence.tech/:splat`.

---

### Option C: Ubuntu Linux VPS / Dedicated NGINX Server

If deploying on a managed Ubuntu VM:
```bash
# 1. Clone repository on server
git clone https://github.com/adviceintelligence/case-ace-v2.git /opt/case-ace-v2
cd /opt/case-ace-v2

# 2. Configure Environment File
cp infrastructure/env/.env.pilot.example /etc/case-ace/production.env

# 3. Issue SSL Certificate via Let's Encrypt Certbot
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot certonly --nginx -d caseace.adviceintelligence.tech -d api.caseace.adviceintelligence.tech

# 4. Start Docker Containers
docker compose -f docker-compose.prod.yml up -d --build
```

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

# 2. Test Backend Health Check & Cloud Sovereignty
curl -s https://api.caseace.adviceintelligence.tech/health

# Expected Output:
# {"status":"healthy","gcpRegion":"europe-west2","version":"2.0.0"}

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
