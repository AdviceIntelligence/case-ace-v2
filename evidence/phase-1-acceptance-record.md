# Phase 1 Acceptance Record & Control Evidence

**System**: Case Ace v2.0 (Citizens Advice Wandsworth)  
**Phase**: Phase 1 (Repository, Stack, Environments, Dependency Policy, CSP)  
**Date**: 2026-09-01  
**Status**: COMPLETE  

---

## 1. Acceptance Criteria Verification

| Acceptance Criterion | Verification Method | Result | Evidence Artefact |
| :--- | :--- | :--- | :--- |
| **1. Repository scaffolded, builds clean, CSP enforced in all environments** | Multi-package TypeScript build (`client/`, `backend/`), Nginx config audit, Express middleware verification. | **PASS** | `client/vite.config.ts`, `backend/src/middleware/csp.ts`, `infrastructure/docker/nginx.conf`, `test/csp.test.ts` |
| **2. `docs/dependencies.md` justifies every client dependency** | Automated dependency audit checking every entry in `client/package.json` against `docs/dependencies.md`. | **PASS** | `docs/dependencies.md`, `evidence/dependency-audit.json`, `test/dependencies.test.ts` |
| **3. SBOM generated and committed** | CycloneDX 1.5 JSON SBOM generated with purl identifiers, licenses, and scopes. | **PASS** | `evidence/sbom.json` |
| **4. No dependency in client bundle initiates network activity of its own** | Static audit of client packages for telemetry/network calls; elimination of third-party CDNs, analytics, and error loggers. | **PASS** | `evidence/dependency-audit.json`, `docs/dependencies.md` |

---

## 2. Control Framework Traceability

* **ISO/IEC 27001:2022 A.8.20 (Network Security)**: Strict CSP policy (`default-src 'none'`, no `unsafe-inline`, scoped `wasm-unsafe-eval`, strictly allowlisted `connect-src`).
* **ISO/IEC 27001:2022 A.8.30 (Supply Chain Security)**: Exact version pinning across all client and backend dependencies; SBOM generation; zero unvetted packages.
* **ISO/IEC 27001:2022 A.8.31 (Separation of Environments)**: Formal environment separation (`local`, `test`, `pilot`) with programmatic enforcement that `local` and `test` environments process only synthetic fixtures.
* **UK GDPR / DPA 2018 (Data Sovereignty)**: All cloud infrastructure and model endpoint configurations pinned to `europe-west2` (London).
