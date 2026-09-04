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

---

## 5. Where the Policy Comes From

The policy is generated, not hand-written. `client/src/config/csp.ts` composes it from the
`cspConnectAllowlist` in `client/src/config/environments.ts`, so the origins the application
believes it may contact and the origins the browser permits are the same list.

| Delivery point | Source | Notes |
| :--- | :--- | :--- |
| `<meta http-equiv>` in `index.html` | `cspMeta(env)`, injected at build time by the `case-ace-csp` Vite plugin in place of the `__CSP_POLICY__` placeholder | Omits `frame-ancestors`, which a meta-delivered policy cannot express |
| Vite dev and preview servers | `cspHeader(env)` | Same policy the deployed site receives |
| Firebase Hosting (`firebase.json`) | Literal copy of `cspHeader('pilot')` | A test asserts byte equality; the build fails if they drift |
| Container image (`infrastructure/docker/nginx.conf`) | Literal copy of `cspHeader('pilot')` | Same drift test |

### 5.1 Why a second policy is dangerous

A browser given more than one CSP enforces **all** of them, and the effective permission for
each directive is the **intersection**. This is the failure that reached the deployed pilot:
`index.html` carried a hand-written policy whose `connect-src` still named
`http://localhost:8080`, while the Firebase Hosting header correctly named
`https://api.caseace.adviceintelligence.tech`. The intersection was `'self'` alone. The site
loaded and rendered normally, and every call to the backend, login included, was refused
before it left the page.

Two properties follow, and both are enforced by tests in `scripts/run-tests.mjs` (Suite 1)
and `test/csp.test.ts`:

* Every environment's `connect-src` must contain the origin of its own `apiBaseUrl`.
* No environment other than `local` may name a `localhost` or `127.0.0.1` origin.

### 5.2 Build-time environment is mandatory

`vite build` refuses to run unless `VITE_APP_ENV` names a known environment. A build that
falls back to `local` produces a bundle that points at `http://localhost:8080` behind a
localhost CSP. It deploys cleanly, serves without error, and cannot reach the backend, which
is the most expensive class of failure to diagnose from the outside.
