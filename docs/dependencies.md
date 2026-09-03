# Client Dependency Policy & Justification Register

**Document ID**: DOC-DEP-001  
**Classification**: Official  
**System**: Case Ace v2.0 (Citizens Advice Wandsworth)  
**Standard Alignment**: ISO/IEC 27001:2022 A.8.30 (Outsourced development), ISO/IEC 27701:2019, ISO/IEC 42001:2023  

---

## 1. Supply Chain & Dependency Policy

Every third-party dependency in the client bundle is a supply chain risk to a system handling Special Category Data (under UK GDPR Article 9) and confidential advice consultations.

### Policy Rules:
1. **Absolute Pinning**: Every dependency version must be exact (no ranges, no `^`, no `~`).
2. **Zero Network Calling**: Any library that initiates automated telemetry, beacons, background update checks, or external HTTP/WebSocket connections is strictly rejected.
3. **Exclusivity Justification**: Each package must be justified by demonstrating that native Web Platform APIs cannot fulfill the functional or accessibility requirement.
4. **Permissive Open Source Licensing**: Only approved OSI licenses (MIT, Apache-2.0, BSD-3-Clause, ISC) are permitted.
5. **Continuous SBOM Verification**: Software Bill of Materials (SBOM) must be generated and tracked in the `evidence/` repository.

---

## 2. Client Production Dependencies (`client/dependencies`)

| Package | Pinned Version | License | What It Does | Why Platform Cannot Do It | Network Call Audit |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `react` | `19.0.0` | MIT | Core declarative UI component model and reactive rendering engine. | Vanilla DOM manipulation for multi-stage interactive workflows creates high state-synchronization complexity and higher bug density in complex client-side accessibility trees. React provides predictable unidirectional dataflow without server rendering. | **PASS**: Zero network calls. Pure in-memory component runtime. Verified in audit. |
| `react-dom` | `19.0.0` | MIT | Target DOM renderer for React. Mounts virtual DOM trees to browser DOM. | Required pairing for React in browser environments. Directly manipulates local DOM tree only. | **PASS**: Zero network calls. Pure DOM rendering runtime. |
| `lucide-react` | `0.475.0` | MIT | Accessible, tree-shakeable SVG icon components for UI feedback and screen-reader status indicators. | Custom handcrafted SVGs across all statuses (mic, lock, shield, alert) would duplicate effort and introduce accessibility inconsistencies. Lucide provides pure static JSX SVG components. | **PASS**: Zero network calls. Compiles to static SVG elements in the bundle. No external asset fetching. |

---

## 3. Client Build & Development Dependencies (`client/devDependencies`)

| Package | Pinned Version | License | Purpose in Build Pipeline | In Runtime Bundle? | Network Activity |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `typescript` | `5.7.3` | Apache-2.0 | Static type checking and compile-time verification of constraints. | No (stripped at compile time) | None during compilation. |
| `vite` | `6.1.0` | MIT | Local development server and ES module bundler. | No (build tool) | Local dev server only (localhost); builds static bundle. |
| `@vitejs/plugin-react` | `4.3.4` | MIT | Babel/SWC transform plugin for JSX in Vite. | No (build tool) | None. |
| `@types/react` | `19.0.8` | MIT | TypeScript type definitions for React. | No (type declaration) | None. |
| `@types/react-dom` | `19.0.3` | MIT | TypeScript type definitions for ReactDOM. | No (type declaration) | None. |

---

## 4. Rejection Register (Evaluated & Disallowed Dependencies)

The following dependencies were evaluated and explicitly rejected:

* **Sentry / Bugsnag / LogRocket**: **REJECTED**. Violates Constraint C1, C2, and C9. Client-side error monitors capture stack traces, console logs, and DOM snapshots which could leak confidential client consultation data to third-party servers.
* **Google Analytics / Mixpanel / Segment**: **REJECTED**. Violates Constraint C1 and supply chain policy. Automated telemetry and tracking cookies are strictly forbidden.
* **Google Fonts / Adobe Typekit**: **REJECTED**. Violates CSP and privacy constraints. System fonts and self-hosted fonts are used exclusively.
* **Axios / Request wrappers**: **REJECTED**. Native `fetch` API provides all required HTTP capabilities with zero supply chain overhead.
* **Redux Persist / LocalStorage adapters**: **REJECTED**. Violates Constraint C1 (Zero Non-Volatile Persistence).
