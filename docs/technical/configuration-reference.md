# Technical Configuration Reference Guide

**Document Reference**: CAW-TECH-CFG-2026-01  
**System**: Case Ace v2.0 Client Consultation Recording & Note Drafting System  
**Organisation**: Citizens Advice Wandsworth (CAW)  
**Status**: Formally Approved Technical Reference  
**Classification**: Internal / Technical Reference  

---

## 1. Environment Variables Reference

```
+----------------------------------------------------------------------------------------------------+
| ENVIRONMENT VARIABLES SPECIFICATION                                                                |
+----------------------------------------------------------------------------------------------------+
| Variable Name                  | Default Value               | Description                         |
+----------------------------------------------------------------------------------------------------+
| `NODE_ENV`                     | `production`                | Application execution environment   |
| `PORT`                         | `8080`                      | Backend HTTP port (injected by Cloud Run) |
| `APP_ENV`                      | `pilot`                     | Selects the config block in backend/src/config |
| `CORS_ORIGIN`                  | `https://caseace.adviceintelligence.tech` | Allowed client web origin           |
| `GCP_PROJECT_ID`               | `case-ace-v2`               | Google Cloud Project identifier     |
| `GCP_REGION`                   | `europe-west2`              | Pinned UK sovereign GCP region      |
| `GCP_SPEECH_RECOGNIZER`        | `chirp2-uk-english`         | Google STT v2 Recognizer resource   |
| `GCP_VERTEX_MODEL`             | `gemini-1.5-pro-002`        | Large Language Model for drafting   |
| `GCP_VERTEX_DRAFT_TEMPERATURE` | `0.2`                       | Low temperature for factual output  |
| `SESSION_IDLE_TIMEOUT_SECONDS` | `900`                       | Inactivity timeout (15 minutes)     |
| `AUDIT_LOG_RETENTION_DAYS`     | `365`                       | Retention period for non-PII logs   |
| `WEBEX_CLIENT_ID`              | *(Encrypted Secret)*        | Cisco Webex OAuth 2.0 Client ID     |
| `WEBEX_REDIRECT_URI`           | `https://caseace.adviceintelligence.tech/api/auth/webex/callback` | Webex OAuth callback URI            |
| `ENTRA_REDIRECT_URI`           | `https://caseace.adviceintelligence.tech/auth/callback` | Microsoft Entra ID callback URI     |
| `ALLOW_TOTP_IN_PILOT`          | `true`                      | Interim TOTP login while Entra ID is unavailable |
| `JWT_SECRET`                   | *(Secret Manager: case-ace-jwt-secret)* | Session token signing key. Never use the committed fallback |
| `VITE_APP_ENV`                 | `pilot`                     | Build-time only. Omitting it makes the SPA fail closed to `local` |
+----------------------------------------------------------------------------------------------------+
```

---

## 2. Client-Side Audio & Buffer Parameters

```typescript
export const AUDIO_CONFIG = {
  sampleRate: 16000,          // 16 kHz mono audio (optimal for Whisper & Chirp 2)
  channelCount: 1,            // Mono recording channel
  maxDurationSeconds: 3600,   // 60-minute hard session limit
  chunkSizeFrames: 4096,      // Web Audio API ScriptProcessor / AudioWorklet buffer
  quantizationBits: 16,       // 16-bit PCM Linear WAV
};
```

---

## 3. Local Whisper WASM Engine Parameters

```typescript
export const WHISPER_CONFIG = {
  modelName: 'whisper-base-en-v3', // 74M parameter quantized model
  threads: 4,                      // WebAssembly SIMD worker threads
  temperature: 0.0,                // Greedy decoding for maximum deterministic output
  language: 'en',                  // Enforce English language transcription
  beamSize: 5,                     // Beam search width
};
```

---

## 4. Prompt & Model Version Registry

| Component | Active Version | Fallback Version | Release Notes |
| :--- | :---: | :---: | :--- |
| **Drafting System Prompt** | `v2.4.0` | `v2.3.9` | AQS Level 3 schema enforcement; anti-injection delimitations. |
| **Foundation LLM** | `gemini-1.5-pro-002` | `gemini-1.5-flash-002` | High-accuracy reasoning; pinned to `europe-west2`. |
| **Cloud ASR Engine** | `chirp_2` | `latest_long` | UK regional accent robustness; 16 kHz mono input. |
| **Local WASM ASR** | `whisper.cpp-1.7` | N/A | In-browser WebAssembly SIMD transcription. |
