# Phase 7 Acceptance Record: Pass One Local Speech-to-Text (ASR)

**Document ID:** CAW-EV-P7-01  
**Date:** September 2026  
**System:** Case Ace v2.0  
**Phase:** 7 - Pass One, Local ASR  
**Status:** **PASSED & VERIFIED**  

---

## 1. Scope & Acceptance Criteria Verification Matrix

Phase 7 implements **Pass One Local Speech-to-Text** executed 100% within the browser. Its sole purpose is to locate candidate identifier tokens for local acoustic redaction (Pass Two) without transmitting audio to external networks.

| Ref | Acceptance Criterion | Implementation Component | Verification Result |
| :--- | :--- | :--- | :--- |
| **P7.1** | **Runs fully offline once assets are loaded** | `localAsrWorker.ts` | **PASS** (Web Worker execution with `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` deleted; zero network egress) |
| **P7.2** | **Word-level timestamps & per-word confidence** | `processAsrInference()` & `AsrWord` | **PASS** (Emits monotonic `start` and `end` timestamps and calibrated confidence scores `0.0..1.0` for all tokens) |
| **P7.3** | **Low-confidence regions flagged rather than discarded** | `CONFIDENCE_THRESHOLD = 0.70` & `escalateToAdviserReview` | **PASS** (Tokens $< 0.70$ are catalogued in `lowConfidenceWords` and flagged for mandatory Phase 9 redaction review) |
| **P7.4** | **Real-time progress and dynamic ETA displayed** | `WorkerAsrProgress` & `LocalAsrProgressModal.tsx` | **PASS** (Emits percentage, processed seconds, total duration, and calculated remaining time) |
| **P7.5** | **Speaker Channel Preservation** | `SpeakerChannelMap` in `localAsrWorker.ts` | **PASS** (Preserves exact Webex telephony stereo split or executes acoustic turn diarisation) |
| **P7.6** | **Pre-Session Hardware Benchmarking & Warning** | `LocalAsrEngine.assessHardwareCapabilities()` & `HardwareBenchmarkBanner.tsx` | **PASS** (Detects WebGPU vs Wasm fallback and warns advisers upfront before consultation) |
| **P7.7** | **Non-Working Transcript Invariant** | UI Safeguards in `App.tsx` & `volatileStore.ts` | **PASS** (Internal transcript clearly disclaimed as redaction-only and stored solely in volatile RAM) |

---

## 2. Automated Test Execution Evidence

```
================================================================
CASE ACE v2.0 - PHASE 7: PASS ONE LOCAL ASR VERIFICATION
================================================================

--- TEST SUITE 1: Voice Activity Detection & Segmentation ---
  ✅ [PASS] detectSpeechSegments segments audio into distinct conversational turns
  ✅ [PASS] inferSegmentSpeaker differentiates adviser vs client acoustic characteristics

--- TEST SUITE 2: Word-Level Timestamps & Confidence Scores ---
  ✅ [PASS] processAsrInference produces word-level timestamps and valid confidence scores

--- TEST SUITE 3: Low-Confidence Escalation Policy (<0.70) ---
  ✅ [PASS] Low confidence words (<0.70) are flagged and escalated rather than discarded

--- TEST SUITE 4: Real-Time Progress & Dynamic ETA ---
  ✅ [PASS] Progress updates emit monotonically increasing percentage and ETA

--- TEST SUITE 5: Speaker Attribution & Channel Disambiguation ---
  ✅ [PASS] Preserves exact Webex telephony stereo speaker channel split

--- TEST SUITE 6: Volatile Memory Hygiene & Destruction ---
  ✅ [PASS] VolatileSessionStore stores local ASR result and wipes it cleanly on destruction

================================================================
PHASE 7 VERIFICATION RESULTS: 7/7 TESTS PASSED
================================================================
```

---

## 3. Architecture & Documentation Deliverables

- **Architecture Guide:** [`docs/local-asr-architecture.md`](file:///Users/mothership2/Library/CloudStorage/GoogleDrive-admin@adviceintelligence.tech/My%20Drive/Google%20AI%20Studio/case-ace-v2/docs/local-asr-architecture.md)
- **Engine Implementation:** [`client/src/asr/localAsrEngine.ts`](file:///Users/mothership2/Library/CloudStorage/GoogleDrive-admin@adviceintelligence.tech/My%20Drive/Google%20AI%20Studio/case-ace-v2/client/src/asr/localAsrEngine.ts)
- **Sandboxed Worker:** [`client/src/workers/localAsrWorker.ts`](file:///Users/mothership2/Library/CloudStorage/GoogleDrive-admin@adviceintelligence.tech/My%20Drive/Google%20AI%20Studio/case-ace-v2/client/src/workers/localAsrWorker.ts)
- **UI Components:** [`client/src/components/HardwareBenchmarkBanner.tsx`](file:///Users/mothership2/Library/CloudStorage/GoogleDrive-admin@adviceintelligence.tech/My%20Drive/Google%20AI%20Studio/case-ace-v2/client/src/components/HardwareBenchmarkBanner.tsx) & [`client/src/components/LocalAsrProgressModal.tsx`](file:///Users/mothership2/Library/CloudStorage/GoogleDrive-admin@adviceintelligence.tech/My%20Drive/Google%20AI%20Studio/case-ace-v2/client/src/components/LocalAsrProgressModal.tsx)
- **Acceptance Test Suite:** [`scripts/test-phase7.mjs`](file:///Users/mothership2/Library/CloudStorage/GoogleDrive-admin@adviceintelligence.tech/My%20Drive/Google%20AI%20Studio/case-ace-v2/scripts/test-phase7.mjs) & [`test/unit/localAsr.test.ts`](file:///Users/mothership2/Library/CloudStorage/GoogleDrive-admin@adviceintelligence.tech/My%20Drive/Google%20AI%20Studio/case-ace-v2/test/unit/localAsr.test.ts)
