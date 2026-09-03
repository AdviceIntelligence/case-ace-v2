# Environments & Data Isolation Strategy

**Document ID**: DOC-ENV-003  
**Classification**: Official  
**System**: Case Ace v2.0 (Citizens Advice Wandsworth)  
**Standard Alignment**: ISO/IEC 27001:2022 A.8.31 (Separation of development, test and production environments), ISO/IEC 27701:2019  

---

## 1. Environments Overview

Case Ace v2.0 defines three distinct deployment environments: `local`, `test`, and `pilot`.

| Environment | Purpose | Target Infrastructure | Data Policy | Synthetic Sessions Only? |
| :--- | :--- | :--- | :--- | :--- |
| `local` | Individual developer workstations | Local Node / Vite sandbox | Mock synthetic fixtures | **YES** (Enforced) |
| `test` | Automated CI/CD, integration & security testing | Dedicated testing cluster | Programmatically generated synthetic test cases | **YES** (Enforced) |
| `pilot` | Controlled operational trial with CAW advisers | GCP Cloud Run (`europe-west2`) | Real client consultations | **NO** (Strict Volatile Isolation C1-C10) |

---

## 2. Core Isolation & Data Integrity Guarantees

1. **Zero Real Client Data in Shared Development/Test Environments**:
   * No developer workstation or shared test environment may ever process, ingest, or receive real client advice consultation audio, transcripts, or personal data.
   * Automated tests and local development run strictly against synthetic fixtures in `test/synthetic-fixtures/`.

2. **Region Pinning to `europe-west2` (London)**:
   * All cloud compute, transcription endpoints, AI models, and operational monitoring logs are strictly pinned to Google Cloud Platform's London region (`europe-west2`).
   * No network routing, logging sink, or cloud dependency is permitted outside the United Kingdom.

3. **Runtime Configuration Enforcement**:
   * The `EnvironmentConfig` schema validates environment boundaries at startup.
   * If an environment configuration is ambiguous or invalid, the system **fails closed** and terminates initialization immediately.
