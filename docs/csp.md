# Content Security Policy (CSP) Specification & Enforcement

**Document ID**: DOC-SEC-002  
**Classification**: Official  
**System**: Case Ace v2.0 (Citizens Advice Wandsworth)  
**Standard Alignment**: ISO/IEC 27001:2022 A.8.20 (Network security), A.8.26 (Application security requirements), ISO/IEC 27701:2019  

---

## 1. Objective & Security Posture

The Content Security Policy (CSP) for Case Ace v2.0 is designed to enforce the strictest possible boundary:
* **Zero untrusted code execution**: Complete prohibition of `unsafe-inline` scripts and styles.
* **Zero third-party data leakage**: Complete elimination of external font CDNs, analytics providers, error trackers, and unapproved origins.
* **Tightly scoped networking**: Strict `connect-src` allowlists pinned to `europe-west2` backend and cloud service endpoints.
* **Controlled WebAssembly execution**: Scope `wasm-unsafe-eval` solely for local, on-device ASR and NER model weights (WASM/WebGPU).

---

## 2. Directives Matrix

| Directive | Value | Rationale & Justification |
| :--- | :--- | :--- |
| `default-src` | `'none'` | Fail-closed default. Any resource type not explicitly allowed is blocked. |
| `script-src` | `'self' 'wasm-unsafe-eval'` | Scripts must be first-party. `'wasm-unsafe-eval'` is strictly required by browser WebAssembly runtimes (e.g., ONNX Runtime Web / Transformers.js) to compile WASM bytecode in memory. Standard `'unsafe-eval'` is strictly disallowed. |
| `style-src` | `'self'` | Stylesheets must originate from the first-party bundle. No inline styles or external CSS CDNs. |
| `font-src` | `'self' data:` | System fonts and self-hosted static font assets only. No Google Fonts or Typekit. |
| `img-src` | `'self' data:` | First-party image assets and local base64/SVG assets only. |
| `connect-src` | *Environment-specific allowlist* | Limits XHR, `fetch`, and WebSocket connections strictly to approved endpoints (see Section 3). |
| `worker-src` | `'self' blob:` | Permits Web Workers running on-device audio demuxing and Pass 1 ASR/NER in isolated threads. |
| `media-src` | `'self' blob:` | Permits local in-memory playback (`blob:`) of redacted audio for adviser verification. |
| `object-src` | `'none'` | Blocks Flash, Java, and legacy browser plugins. |
| `frame-ancestors` | `'none'` | Prevents clickjacking and framing by any external website. |
| `form-action` | `'none'` | Disables HTML form submissions; state transitions are handled exclusively in memory. |
| `base-uri` | `'self'` | Prevents base tag hijacking attacks. |

---

## 3. Environment-Specific `connect-src` Allowlist

| Environment | `connect-src` Directives | Purpose |
| :--- | :--- | :--- |
| **Local** | `'self' http://localhost:8080 ws://localhost:5173` | Local Vite dev server HMR and local backend API. |
| **Test** | `'self' https://test-api.caw-case-ace.internal` | Synthetic test harness and API mock services. |
| **Pilot** | `'self' https://api.caseace.adviceintelligence.tech https://caseace.adviceintelligence.tech https://europe-west2-speech.googleapis.com https://europe-west2-aiplatform.googleapis.com https://webexapis.com` | Production pilot: Backend API, UK-pinned GCP STT v2, UK-pinned Vertex AI Gemini, and Cisco Webex browser SDK. |

---

## 4. Complementary Security Headers

Every response from the backend and static web server includes:
```http
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), geolocation=(), payment=(), usb=(), display-capture=(), microphone=(self)
```
