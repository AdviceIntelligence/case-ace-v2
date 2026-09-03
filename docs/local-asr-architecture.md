# Case Ace v2.0: Pass One Local ASR Architecture

## 1. Architectural Role of Pass One Speech-to-Text

Case Ace v2.0 employs a strict **Two-Pass Speech-to-Text & Redaction Architecture** designed to preserve client privacy while achieving Advice Quality Standard (AQS) Level 3 documentation accuracy.

```
                    ┌───────────────────────────────────────────────┐
                    │          Normalised Audio (16kHz PCM)         │
                    │        Held in Volatile Memory Only           │
                    └───────────────────────┬───────────────────────┘
                                            │
                                            ▼
                    ┌───────────────────────────────────────────────┐
                    │      PASS ONE: Local In-Browser ASR Engine    │
                    │         (WebGPU with Wasm Fallback)           │
                    │      • Word-level timestamps (start / end)    │
                    │      • Per-word confidence scores (0.0..1.0)  │
                    │      • Channel/Acoustic Speaker Attribution   │
                    │      • Low-confidence token escalation (<0.70)│
                    └───────────────────────┬───────────────────────┘
                                            │
                                            ▼
                    ┌───────────────────────────────────────────────┐
                    │          Pass One Internal Transcript         │
                    │   • NEVER leaves the adviser workstation      │
                    │   • NEVER displayed as working case note      │
                    │   • Lives solely in volatile RAM              │
                    └───────────────────────┬───────────────────────┘
                                            │
                                            ▼
                    ┌───────────────────────────────────────────────┐
                    │      PASS TWO: Acoustic Redaction Pipeline    │
                    │     (Locates PII & zeros audio intervals)     │
                    └───────────────────────────────────────────────┘
```

### 1.1 Non-Working Transcript Invariant
The Pass One transcript is **not** the working case note transcript. Whisper small/base models executed in-browser can exhibit minor acoustic errors, hallucinations, or phonetic variations. Its sole function is to provide word-level alignments and candidate token boundaries to feed the local PII extraction and acoustic silence-redaction engine (Phase 8). The adviser is explicitly presented with clear disclaimers preventing mistaking Pass One text for the final case note.

### 1.2 Zero-Exfiltration Invariant
Pass One speech recognition executes 100% locally within a sandboxed Web Worker. All network primitives (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`) are stripped from the worker global scope. No segment, timestamp, or audio slice is transmitted outside the browser memory during Pass One.

---

## 2. Hardware Acceleration & Model Execution

### 2.1 WebGPU and WebAssembly SIMD Fallback
- **WebGPU Backend**: Preferred for hardware-accelerated tensor matrix multiplication. Typical transcription speed is ~0.10–0.20× realtime (~12–25 seconds for a 15-minute consultation).
- **WebAssembly (Wasm) Backend**: Universal fallback for older hardware or virtualized enterprise environments without GPU compute support. Runs multithreaded SIMD operations. Realtime factor is ~0.80–1.20× realtime.

### 2.2 Model Weight Caching Policy (Constraint C1 Permitted Exception)
Per Project Constitution Constraint C1:
- Static model weights (ONNX/safetensors graph) are immutable application assets and may be cached in the browser's Cache API or IndexedDB.
- Consultation audio buffers, intermediate spectrograms, tokens, and transcripts are strictly classified as session data and are **never cached** or persisted.

### 2.3 Pre-Session Hardware Benchmarking & Adviser Warnings
Prior to commencing an advice interview, the application assesses the host device's GPU capabilities via `LocalAsrEngine.assessHardwareCapabilities()`. If WebGPU is unavailable, the adviser is alerted via the `<HardwareBenchmarkBanner />` so expectations on post-interview processing times are established before the consultation starts.

---

## 3. Speaker Attribution & Channel Disambiguation

Knowing whether a phrase originated from the client or the adviser significantly improves entity classification (e.g. distinguishing a client giving their National Insurance number from an adviser reciting an office reference) and downstream case note structure.

1. **Webex Telephony (Exact Split)**:
   When audio originates from the Webex stereo stream capture (`Route = 'webex_telephony'`), Channel 0 represents the adviser's local microphone and Channel 1 represents the client's telephone line. Pass One preserves this exact separation rather than re-deriving it fuzzily.
2. **In-Person Mic & Imported Files (Acoustic Diarisation)**:
   For mono audio sources, Pass One uses an energy and zero-crossing rate voice activity detector (`detectSpeechSegments`) combined with acoustic spectral clustering (`inferSegmentSpeaker`) to segment speech turns.

---

## 4. Low-Confidence Escalation Policy

A mumbled name, indistinct postcode, or quiet telephone audio is the primary failure mode of automated acoustic redaction.

### 4.1 Threshold & Escalation Rule
- **Threshold**: `CONFIDENCE_THRESHOLD = 0.70`.
- **Handling Policy**: Words with confidence score $< 0.70$ are marked with `isLowConfidence: true` and `escalateToAdviserReview: true`.
- **Zero-Drop Rule**: Low-confidence regions are **never silently dropped**. They are catalogued in `LocalAsrResult.lowConfidenceWords` and escalated directly to the Phase 9 Adviser Redaction Verification Gate for mandatory manual sign-off.

---

## 5. Memory Management & Lifecycle Cleanup

All Pass One data structures are held within `VolatileSessionStore`:
- `VolatileSessionStore.localAsrResult`: Holds structured segments, word timestamps, and confidence scores.
- `VolatileSessionStore.localDraftTranscript`: String representation for internal pipeline review.
- On session destruction (`destroySession()`), session reset, or consent withdrawal, all references are cleared and typed arrays zero-filled.
