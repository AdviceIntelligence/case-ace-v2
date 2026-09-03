# Architecture Decision Records (ADRs)

**Document Reference**: CAW-TECH-ADR-2026-01  
**System**: Case Ace v2.0 Client Consultation Recording & Note Drafting System  
**Organisation**: Citizens Advice Wandsworth (CAW)  
**Status**: Formally Approved Baseline Architecture  
**Classification**: Internal / Technical Reference  

---

## Index of Architectural Decisions

* **ADR-001**: In-Browser Volatile-Only Memory Architecture (Eliminating Client-Side Disk Persistence)
* **ADR-002**: Local-First Whisper WASM for Identifier Extraction
* **ADR-003**: Acoustic Muting & Verified Audio Egress (Zero Raw Audio to Cloud)
* **ADR-004**: Multi-Layer Hybrid Named Entity Recognition (Regex + Contextual NER + Special Category)
* **ADR-005**: Surrogate Tokenisation & In-Browser Reverse Detokenisation for LLM Drafting
* **ADR-006**: Dual-Pass Speech-to-Text Pipeline (Local Whisper + Cloud Chirp 2)
* **ADR-007**: Single-Function Deterministic Session Destruction (`destroySession()`)
* **ADR-008**: Strict Whitelist-Only Telemetry Logging (Zero Free-Text / Zero PII Storage)
* **ADR-009**: Pinning Cloud Sub-Processors Strictly to UK Sovereign Region (`europe-west2` London)
* **ADR-010**: In-Browser SRTP Telephony Decryption for Cisco Webex Integration

---

### ADR-001: In-Browser Volatile-Only Memory Architecture (Eliminating Client Disk Persistence)
* **Status**: ACCEPTED (Phase 1)
* **Context**: UK GDPR Article 5(1)(e) (Storage Limitation) and Article 25 (Data Protection by Design) require minimizing the physical footprint of sensitive advice audio. Saving audio to browser storage (`localStorage`, `sessionStorage`, `IndexedDB`) risks data recovery after browser crashes or computer reassignment.
* **Decision**: All consultation audio, intermediate transcripts, and drafts are stored strictly in volatile JavaScript `ArrayBuffer` / `Float32Array` heap memory. Direct calls to non-volatile browser storage APIs are blocked at build time via automated CI AST linting (`scripts/lint-storage-guard.mjs`).
* **Consequences**: Zero client consultation audio persists to disk. Session state is ephemeral; browser refresh or tab closure instantly frees memory.

---

### ADR-002: Local-First Whisper WASM for Identifier Extraction
* **Status**: ACCEPTED (Phase 8)
* **Context**: Identifying names, addresses, and NINOs requires speech recognition. Sending raw audio to cloud ASR before redaction violates the Zero-Unredacted-Audio egress constraint.
* **Decision**: Execute a quantized local Whisper ASR model (`whisper-base-en-v3` / `whisper.cpp`) compiled to WebAssembly (WASM) with SIMD acceleration running in a dedicated Web Worker within the adviser's browser.
* **Consequences**: Fast preliminary transcription occurs 100% locally on the device without network transmission.

---

### ADR-003: Acoustic Muting & Verified Audio Egress
* **Status**: ACCEPTED (Phase 10)
* **Context**: Muting personal identifiers in the audio stream must be fail-safe before any redacted WAV file is sent to Google Cloud STT v2 for high-fidelity transcription.
* **Decision**: Audio samples corresponding to identified entity timestamps are zeroed in-place (`Uint8Array.fill(0)`). A secondary local ASR verification pass transcribes the muted audio stream. If any identifier sound survives, cloud transmission is blocked immediately.
* **Consequences**: Guarantee that zero audible personal identifiers leave the local browser boundary.

---

### ADR-004: Multi-Layer Hybrid Named Entity Recognition (NER)
* **Status**: ACCEPTED (Phase 8)
* **Context**: Single NER engines suffer from blind spots across structured codes (NINOs, postcodes) vs free-text names, employers, and special category disclosures (safeguarding, medical diagnoses).
* **Decision**: Implement a 3-layer sequential NER pipeline:
  1. *Layer 1*: Deterministic Regex & Checksum Validators (NINO, UK Postcodes, Phone numbers, DOBs).
  2. *Layer 2*: Contextual Gazetteer & Rule-based NER (Names, Creditors, Landlords, Employers).
  3. *Layer 3*: Special Category Health & Safeguarding Classifier.
* **Consequences**: Measured empirical recall $\ge 92.3\%$ on the 33-scenario synthetic benchmark.

---

### ADR-005: Surrogate Tokenisation & In-Browser Reverse Detokenisation
* **Status**: ACCEPTED (Phase 13)
* **Context**: Sending unredacted text transcripts to Large Language Models (LLMs) exposes client PII to cloud endpoints.
* **Decision**: Replace all confirmed personal entities with surrogate tokens (`[CLIENT_NAME_1]`, `[POSTCODE_1]`, `[NINO_1]`) prior to cloud transmission. The LLM (Gemini 1.5 in London) reasons over surrogate tokens and produces a structured AQS note. The browser substitutes real entities back into the draft note locally.
* **Consequences**: Zero direct client PII is exposed to the cloud drafting LLM.

---

### ADR-006: Dual-Pass Speech-to-Text Pipeline
* **Status**: ACCEPTED (Phase 10)
* **Context**: Local Whisper WASM provides initial redaction bounding, but high-volume casework requires 99%+ transcription accuracy across heavy regional dialects and complex benefit terminology.
* **Decision**: Combine local Whisper WASM (Pass 1 - Entity Detection) with Google Cloud STT v2 `chirp_2` / `latest_long` in `europe-west2` (Pass 2 - Verified Redacted Audio Transcription).
* **Consequences**: Combines local privacy boundaries with cloud acoustic accuracy.

---

### ADR-007: Single-Function Deterministic Session Destruction (`destroySession()`)
* **Status**: ACCEPTED (Phase 15)
* **Context**: Multiple exit paths (logout, timeout, tab close, consent withdrawal, error) could lead to orphaned state if destruction logic is fragmented.
* **Decision**: Centralize all teardown logic into a single canonical, non-reentrant `destroySession()` function. Overwrites all `TypedArray` audio buffers with zeroes (`.fill(0)`), clears token maps, terminates recovery workers, revokes cloud credentials, and wipes the clipboard.
* **Consequences**: Guaranteed clean state across all 6 exit paths.

---

### ADR-008: Strict Whitelist-Only Telemetry Logging
* **Status**: ACCEPTED (Phase 16)
* **Context**: Telemetry logs must support operations and security audits without creating a secondary data leak vector.
* **Decision**: Implement a strict JSON schema validator (`logSchema.ts`) that validates telemetry against a strict whitelist of integer counts, enums, durations, and pseudonymous IDs. Rejects any unapproved or free-text fields. Enforces 365-day automated TTL purging.
* **Consequences**: Telemetry logs are incapable of storing client narrative or identifying details.

---

### ADR-009: Pinning Cloud Sub-Processors Strictly to UK Sovereign Region (`europe-west2`)
* **Status**: ACCEPTED (Phase 12)
* **Context**: Post-Brexit UK GDPR International Data Transfer requirements require strict control over cross-border data flows.
* **Decision**: All cloud endpoints (Google Cloud Speech-to-Text v2 and Vertex AI Gemini) are pinned strictly to `europe-west2` (London). Multi-region failover to US or EU regions is disabled.
* **Consequences**: Complete UK data residency; zero international data transfers.

---

### ADR-010: In-Browser SRTP Telephony Decryption for Cisco Webex
* **Status**: ACCEPTED (Phase 5)
* **Context**: Capturing Webex telephone consultations must avoid cloud server-side recording.
* **Decision**: Case Ace integrates with Cisco Webex via OAuth (`spark:calls_read`, `spark:kms`) and WebRTC. Audio RTP streams are encrypted end-to-end and decrypted locally in the adviser's browser sandbox via WebRTC SRTP keys. Cloud recording on Webex is permanently disabled.
* **Consequences**: Telephone consultation audio is captured exclusively in local volatile browser memory.
