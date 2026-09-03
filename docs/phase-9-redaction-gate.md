# Phase 9: Adviser Redaction Review Gate & Failsafe Egress Control

## 1. Executive Summary & Privacy Invariant

The **Adviser Redaction Review Gate** is the core technical and operational control upon which the entire privacy architecture of **Case Ace v2.0** rests (implementing **Constraints C1, C4, C5, and C9**).

Under no circumstance is raw audio, client PII, or unstructured consultation text transmitted to external cloud processors (Google Cloud Speech-to-Text v2 or Vertex AI Gemini 1.5 Pro). Before any data packet departs the local device:
1. All local acoustic Pass 1 ASR detections and Layer 1–3 identifier classifications are presented to the adviser in volatile RAM.
2. Every acoustic region where Pass 1 ASR confidence fell below **0.70 (70%)** is isolated in a prominent escalation section and **must be individually auditioned and acknowledged**.
3. The adviser has full agency to add manual redactions (by text or audio time range) or un-redact false positives with a mandatory plaintext disclosure warning.
4. The system presents a transparent outbound transmission statement detailing the cloud processor, designated region (`europe-west2` London, UK), ephemeral credential lifetime (300s), and the exact surrogate-tokenised payload preview.
5. The proceed control is strictly locked until all low-confidence regions are acknowledged and the affirmative declaration is checked.

---

## 2. Technical Architecture & Components

```
+-----------------------------------------------------------------------------------+
|                            VOLATILE MEMORY (RAM ONLY)                             |
|                                                                                   |
|  +---------------------+   +---------------------+   +-------------------------+  |
|  | Pass 1 ASR Output   |   | Layer 1-3 Engine    |   | Low-Confidence Pool     |  |
|  | (16kHz Float32 PCM) |-->| Identifier Detections|-->| (Words < 0.70 Conf)     |  |
|  +---------------------+   +---------------------+   +-------------------------+  |
|                                                                   |               |
|                                                                   v               |
|  +-----------------------------------------------------------------------------+  |
|  |               PHASE 9: ADVISER REDACTION REVIEW GATE MODAL                 |  |
|  |                                                                             |  |
|  |  [Section 1: Low-Confidence Acoustic Regions (Mandatory Individual Ack)]    |  |
|  |  - Ephemeral Web Audio snippet playback from Float32Array in RAM            |  |
|  |  - Acoustic padding (±250ms) without disk writes or Blob URLs               |  |
|  |                                                                             |  |
|  |  [Section 2: Categorised Identifiers & Special Category Art 9 Flags]        |  |
|  |  - Structured / Unstructured / Special Category Consequence Cards           |  |
|  |  - Un-redact confirmation modal (Warns on plaintext transmission)           |  |
|  |                                                                             |  |
|  |  [Section 3: Manual Redaction Tools (Text Substring & Audio Time Range)]     |  |
|  |                                                                             |  |
|  |  [Section 4: Outbound Transmission Disclosure & Exact Surrogate Preview]   |  |
|  |  - Processor: Vertex AI / STT v2 | Region: europe-west2 | TTL: 300s        |  |
|  |                                                                             |  |
|  |  [Section 5: Anti-Rushing Gate Invariant & Dwell Time Timer]                |  |
|  |  - Proceed locked until Pending Low-Conf == 0 & Declaration == Checked      |  |
|  +-----------------------------------------------------------------------------+  |
|                                        |                                          |
|                          Affirmative Authorisation Only                           |
|                                        v                                          |
|  +-----------------------------------------------------------------------------+  |
|  | Egress Dispatch: /v1/events (Dwell Time Telemetry, ZERO PII)                |  |
|  | Session State: isGatePassed = true, stage = 'tokenisation'                  |  |
|  | Outbound Payload: "[CLIENT_NAME_1] attended with [THIRD_PARTY_1]..."        |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+
```

---

## 3. Core Modules

### 3.1 Audio Snippet Player (`client/src/audio/audioSnippetPlayer.ts`)
- **Direct Volatile RAM Playback**: Directly instantiates `AudioBuffer` and `AudioBufferSourceNode` via Web Audio API.
- **Zero Disk Writes**: Never creates `Blob`, `ObjectURL`, or temporary cache entries.
- **Contextual Acoustic Padding**: Applies 250ms–300ms pre/post padding so advisers hear full acoustic context for mumbled or co-articulated words.
- **Immediate Resource Cleanup**: Stops and releases previous sources on item transition.

### 3.2 Redaction Gate Manager (`client/src/redaction/redactionGateManager.ts`)
- **Acoustic Low-Confidence Pool**: Aggregates tokens with $<0.70$ confidence from `localAsrResult.lowConfidenceWords` and `detectedIdentifiers`.
- **Readiness Verification (`checkGateReadiness`)**: Returns `canProceed: false` and explicit blocking reasons whenever `pendingCount > 0`.
- **Outbound Transmission Disclosure (`getOutboundDisclosure`)**: Dynamically computes the exact surrogate-tokenised text string about to depart the browser, along with token counts and region disclosures.
- **Failsafe Proceed Handler (`executeAffirmativeProceed`)**: Fails closed if affirmative consent is absent or pending items exist; records dwell time and emits security telemetry.

### 3.3 Interactive Modal UI (`client/src/components/RedactionReviewGateModal.tsx`)
- **High-Risk Low-Confidence Section**: Visual amber banner with individual card for each low-confidence token, audio playback trigger, and individual acknowledge toggle.
- **Categorised Identifier Review**: Displays detected entities grouped by layer with surrogate tags, audio players, and un-redact confirmation warnings.
- **Manual Redaction Controls**: Enables advisers to redact missed text or specify start/end seconds for acoustic audio bleeps.
- **Live Outbound Disclosure Box**: Provides side-by-side verification of what is redacted vs retained.
- **Anti-Rushing Proceed Bar**: Disables proceed button until all conditions are met; displays active gate dwell timer.

---

## 4. Anti-Rushing Design & Dwell Time Telemetry

Advisers operating between consultations face time pressure. Case Ace specifically defends against habituation and accidental bypass:
1. **No "Redact All" Shortcut**: A single global bypass button is intentionally absent from the codebase.
2. **No Cross-Session Preference Caching**: Review decisions and low-confidence acknowledgements are strictly ephemeral; nothing is written to `localStorage` or indexed across sessions.
3. **Mandatory Affirmative Checkbox**: Requires active click on declaration statement.
4. **Active Gate Dwell Time Measurement**:
   $$\Delta t = t_{\text{completed}} - t_{\text{opened}}$$
   The dwell time is logged to the backend `/v1/events` endpoint in JSON format:
   ```json
   {
     "type": "redaction_gate_completed",
     "timestamp": "2026-09-02T08:04:44.000Z",
     "details": {
       "dwellTimeMs": 14250,
       "lowConfidenceReviewedCount": 3,
       "manualAddedCount": 1,
       "manualRemovedCount": 0,
       "totalTokenCount": 5
     }
   }
   ```
   *Note: Telemetry payloads are strictly sanitized and never contain consultation text, transcripts, audio, or client PII.*

---

## 5. Verification & Acceptance Criteria

All 5 Phase 9 requirements were formally tested and verified via `scripts/test-phase9.mjs`:
- ✅ **Criterion 1**: Zero data egress before affirmative gate authorisation.
- ✅ **Criterion 2**: Individual acknowledgement required for all low-confidence acoustic regions ($<0.70$).
- ✅ **Criterion 3**: Adviser ability to add manual redactions and remove false positives with plaintext warning.
- ✅ **Criterion 4**: Strict absence of bypass/skip paths across all code branches.
- ✅ **Criterion 5**: Accurate gate dwell time captured and dispatched via security telemetry.
