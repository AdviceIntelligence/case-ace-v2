# Information Retention & Disposal Schedule

**Document Reference**: CAW-GOV-RET-2026-01  
**System**: Case Ace v2.0 Client Consultation Recording & Note Drafting System  
**Organisation**: Citizens Advice Wandsworth (CAW)  
**Applicable Standard**: UK GDPR Article 5(1)(e) (Storage Limitation) & AQS Level 3  
**Status**: Formally Approved Retention Policy  
**Classification**: Official-Sensitive / Governance  

---

## 1. Executive Summary & Policy Objectives

Under **UK GDPR Article 5(1)(e)**, personal data must be kept in a form which permits identification of data subjects for no longer than is necessary for the purposes for which the personal data are processed. 

This Retention & Disposal Schedule establishes strict, automated, and operational retention timeframes across every data asset processed by or interacting with Case Ace v2.0.

---

## 2. Comprehensive Data Asset Retention Schedule

| Data Asset | Storage Medium & Location | Lawful Purpose | Retention Period | Automated Disposal & Erasure Mechanism | Governing Invariant |
| :--- | :--- | :--- | :---: | :--- | :--- |
| **Raw Consultation Audio** | Browser Volatile RAM (`Float32Array` / `Uint8Array`) | Live consultation capture & local ASR | **0 Days** (Session Lifetime / Max 60 mins) | In-place zeroing (`Uint8Array.fill(0)`) immediately upon Phase 10 verification pass or any of 6 exit paths in `destroySession()`. | **Constraint C1 / C4** |
| **Redacted Consultation Audio** | Browser Volatile RAM (LINEAR16 WAV) | Cloud ASR Pass 2 verification | **0 Days** (Session Lifetime / Max 60 mins) | In-place zeroing (`Uint8Array.fill(0)`) upon `destroySession()`. | **Constraint C2 / C7** |
| **Draft Transcripts & Spans** | Browser Volatile RAM (JavaScript Heap) | NER detection & entity editing | **0 Days** (Session Lifetime) | Object references cleared and set to `null` on `destroySession()`. | **Constraint C3** |
| **Surrogate Token Map** | Browser Volatile RAM (Isolated Closure) | Abstract entity mapping for LLM egress | **0 Days** (Session Lifetime) | Dictionary cleared and deleted on `destroySession()`. | **Constraint C5 / C6** |
| **Final Case Note Draft** | Browser Volatile RAM & Screen UI | Adviser review and sign-off | **0 Days** (Session Lifetime) | Wiped upon `destroySession()`; transferred to Casebook CRM. | **Constraint C6** |
| **Imported Audio Source Files** | Local Adviser Filesystem (`Downloads/` or USB) | External recording ingest | **Immediate Deletion** (Post-Import) | **Adviser SOP Mandate**: Adviser must permanently delete source file (`Shift+Delete` / Empty Trash) immediately after Casebook sign-off. | **SOP Mandate** |
| **Clipboard Buffer** | OS Clipboard (Windows / macOS) | Facilitating copy-paste into Casebook | **0 Days** (Session Lifetime) | `destroySession()` writes empty string `""` to navigator clipboard if detokenised text was copied. | **Constraint C7** |
| **System Audit & Telemetry Logs** | Backend In-Memory / SQLite Database | Operational monitoring & security audit | **365 Days** (12 Months) | Automated daily cron task calls `AuditLogStore.purgeExpired()` purging records older than 365 days. Zero PII stored. | **Privacy Logging Policy** |
| **Cisco Webex Call Detail Records** | Webex Admin Cloud Portal | Telecom diagnostic & billing audit | **30 Days** | Managed by Cisco Webex automated portal purge policy. Zero audio recording stored. | **Processor Agreement** |
| **Official Client Casebook Record** | Casebook CRM (National Citizens Advice System) | Statutory casework record & AQS audit | **6 Years** (Standard Casework Policy) | Governed by Citizens Advice National Retention & Archival Policy. | **National Policy** |

---

## 3. Detailed Disposal & Erasure Protocols

### 1. In-Memory Volatile Destruction (`destroySession()`)
When an advice session ends (via explicit completion, logout, 15-minute idle timeout, consent withdrawal, tab close, or unrecoverable error), the application invokes `destroySession()`:
```typescript
// Deterministic in-memory zeroing protocol
if (rawAudioBuffer) {
  rawAudioBuffer.fill(0); // Cryptographic buffer overwrite
}
if (redactedAudioBuffer) {
  redactedAudioBuffer.fill(0);
}
tokenMap.clear();
transcriptStore.reset();
recoveryWorker.postMessage({ type: 'TERMINATE' });
```

### 2. External File Import Deletion Protocol
When an adviser imports a consultation recording from an approved dictaphone or smartphone voice memo:
1. The file is uploaded into browser RAM (video tracks are discarded instantly).
2. The consultation is transcribed, redacted, drafted, and signed off into Casebook CRM.
3. **Mandatory Action**: The adviser must immediately navigate to their local file directory and permanently delete the audio recording file from their computer and external drive.
4. **Supervisory Check**: Supervisors verify the absence of local audio files during monthly 1-to-1 audits.

### 3. Backend Audit Log Purge Job
The backend service executes an automated purge job every 24 hours:
```typescript
// Automated 365-day retention purge
const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
auditLogStore.purgeExpired(cutoff);
```
All logs older than 365 days are irrevocably deleted from database tables.

---

## 4. Annual Review and Audit

This Retention Schedule is reviewed annually by the CAW Data Protection Officer and Head of Operations. Any modification to cloud sub-processors or storage architectures requires a formal update and board notification.
