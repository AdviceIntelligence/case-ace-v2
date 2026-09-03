# Data Flow & Trust Boundary Map

**Document Reference**: DOC-03  
**System**: Case Ace v2.0 Client Consultation Recording & Note Drafting System  
**Organisation**: Citizens Advice Wandsworth (CAW)  
**Status**: Verified Architectural Baseline  
**Classification**: Official-Sensitive / Governance Pack  

---

## 1. Visual System Architecture & Trust Boundary Map

> [!NOTE]
> **High-Resolution Vector SVG & Interactive Explorer**:  
> For high-resolution visual presentations, governance reviews, and interactive inspection:
> - **Standalone Vector SVG Diagram**: [`evidence/data-flow-diagram.svg`](file:///Users/mothership2/Library/CloudStorage/GoogleDrive-admin@adviceintelligence.tech/My%20Drive/Google%20AI%20Studio/case-ace-v2/evidence/data-flow-diagram.svg)
> - **Interactive Architecture Explorer**: [`evidence/data_flow_architecture_interactive.html`](file:///Users/mothership2/Library/CloudStorage/GoogleDrive-admin@adviceintelligence.tech/My%20Drive/Google%20AI%20Studio/case-ace-v2/evidence/data_flow_architecture_interactive.html)

### Visual Block Architecture Diagram

```
+===================================================================================================================================+
|                                    CASE ACE v2.0 SYSTEM ARCHITECTURE & TRUST BOUNDARY MAP                                         |
+===================================================================================================================================+

+-------------------------------------+      +--------------------------------------------------------------------------------------+
| TRUST BOUNDARY 0: AUDIO INGRESS     |      | TRUST BOUNDARY 1: CLIENT BROWSER SANDBOX (Volatile Heap RAM Only)                    |
| (Physical / Telephony Ingress)      |      | [Zero Disk Writes | Runtime Storage Guards | Session Closure Isolation]                      |
|                                     |      |                                                                                      |
|  1. In-Person Microphone            |      |  +--------------------------------------------------------------------------------+  |
|     (Web Audio API 16kHz PCM)       |----->|  | 1. Raw Audio Buffer (Float32Array / Uint8Array in RAM)                         |  |
|                                     |      |  |    *Overwritten with 0s on verification via Uint8Array.fill(0) [C1/C7]*         |  |
|  2. Cisco Webex Telephony           |      |  +---------------------------------------+----------------------------------------+  |
|     (SRTP / TLS 1.3 Telephony)      |----->|                                          |                                           |
|     *Cloud Recording: DISABLED*     |      |                                          v                                           |
|                                     |      |  +--------------------------------------------------------------------------------+  |
|  3. File Upload / Import            |      |  | 2. Pass 1 Local ASR Engine (Whisper WASM via Local Web Worker)                 |  |
|     (Video track stripped in RAM)   |----->|  |    *Generates initial draft transcript entirely on device CPU/GPU (0 Network)* |  |
|                                     |      |  +---------------------------------------+----------------------------------------+  |
|  +-------------------------------+  |      |                                          |                                           |
|  | Mandatory Consent Gate        |  |      |                                          v                                           |
|  | - Face-to-Face Plain English  |  |      |  +--------------------------------------------------------------------------------+  |
|  | - Telephony Script            |  |      |  | 3. Multi-Layer Identifier Detection (NER + Regex Engine)                       |  |
|  | - Refusal: Instant Exit &     |  |      |  |    Layer 1: Regex (NINOs, Tel, Postcodes, DOB, Account Nos)                    |  |
|  |   revert to manual typing     |  |      |  |    Layer 2: Local Transformer NER (Names, Organisations, Locations)            |  |
|  +-------------------------------+  |      |  +---------------------------------------+----------------------------------------+  |
+-------------------------------------+      |                                          |                                           |
                                             |                                          v                                           |
                                             |  +--------------------------------------------------------------------------------+  |
                                             |  | 4. Surrogate Tokenisation & Ephemeral Keyring (window.crypto.subtle) [C5]      |  |
                                             |  |    'Jane Doe' -> [CLIENT_NAME_1] | 'SW11 2LN' -> [POSTCODE_1]                  |  |
                                             |  |    *Lookup dictionary retained strictly in volatile RAM closure*               |  |
                                             |  +---------------------------------------+----------------------------------------+  |
                                             |                                          |                                           |
                                             |                                          v                                           |
                                             |  +--------------------------------------------------------------------------------+  |
                                             |  | 5. Phase 9 Redaction Review Gate (Adviser UI Screen)                           |  |
                                             |  |    *Adviser verifies highlighted tokens & manually adds missed PII spans*      |  |
                                             |  +---------------------------------------+----------------------------------------+  |
                                             |                                          |                                           |
                                             |                                          v                                           |
                                             |  +--------------------------------------------------------------------------------+  |
                                             |  | 6. Phase 10 Acoustic Muting & Redaction (LINEAR16 WAV) [C2/C8]                 |  |
                                             |  |    *Mutes audio timestamps matching PII spans | Raw audio wiped with 0s*       |  |
                                             |  +-------------------+-----------------------------------+------------------------+  |
                                             |                      |                                   |                           |
                                             |                      | (Muted WAV Only)                  | (Tokens Only)             |
                                             |                      |                                   |                           |
                                             |                      v                                   v                           |
+-------------------------------------+      |  +--------------------------------------------------------------------------------+  |
| TRUST BOUNDARY 2: CAW BACKEND PROXY |      |  | 7. In-Browser Detokenisation & Adviser Professional Review [C6]                 |  |
| (Google Cloud Run in europe-west2)  |      |  |    *Swaps [CLIENT_NAME_1] back to real client name locally in browser RAM*     |  |
|                                     |      |  |    *Adviser checks advice accuracy, edits gaps, and clicks 'Sign Off'*         |  |
|  +-------------------------------+  |      |  +---------------------------------------+----------------------------------------+  |
|  | 1. Scoped GCP STS Broker      |  |      |                                          |                                           |
|  |    (Exchanges Entra JWT for   |  |      |                                          v                                           |
|  |     15-min downscoped token)  |  |      |  +--------------------------------------------------------------------------------+  |
|  +-------------------------------+  |      |  | 8. destroySession() Deterministic Memory Destruction Engine [C7]               |  |
|  | 2. Strict Audit Log Store     |  |      |  |    Uint8Array.fill(0) wipes all audio | Drops WebCrypto keys | Clears RAM     |  |
|  |    (0-PII Whitelist Schema)   |  |      |  +--------------------------------------------------------------------------------+  |
|  +-------------------------------+  |      +--------------------------------------------------------------------------------------+
+-------------------------------------+                                      |
                   |                                                         | (Adviser Copies Signed Note)
                   v                                                         v
+------------------------------------------------------+      +------------------------------------------------------+
| TRUST BOUNDARY 3: GOOGLE CLOUD (europe-west2 London) |      | TRUST BOUNDARY 4: NATIONAL CASEBOOK CRM              |
| [Pinned to London | Zero Data Retention (ZDR) Terms] |      | (Official Citizens Advice Case Management System)    |
|                                                      |      |                                                      |
|  1. Google Cloud Speech-to-Text v2 (Chirp 2)         |      |  +------------------------------------------------+  |
|     *Receives ONLY Verified Redacted Audio*          |      |  | Casebook Web Application                       |  |
|     *PII audio spans are muted silence*              |      |  | - Adviser manually pastes finalized note       |  |
|                                                      |      |  | - Permanent client record creation             |  |
|  2. Google Cloud Vertex AI (Gemini 1.5 Enterprise)   |      |  | - Subject to national data retention rules     |  |
|     *Receives ONLY Surrogate-Tokenised Text*         |      |  +------------------------------------------------+  |
|     *Zero prompt logging | Zero model retraining*    |      +------------------------------------------------------+
+------------------------------------------------------+
                   ^
                   | (SSO Authentication ONLY)
+------------------------------------------------------+
| MICROSOFT ENTRA ID (Organisational Identity Perimeter|
| [STRICTLY ISOLATED TO INITIAL LOGIN SCREEN]          |
| - Adviser OIDC SSO & MFA Login                       |
| - ZERO access to case notes, transcripts, or audio   |
+------------------------------------------------------+
```

---

## 2. Detailed Trust Boundary Analysis & Transits

| Boundary Transition | Data Elements Transferred | Sensitivity Level | Protective & Cryptographic Controls | Invariant Verified |
| :--- | :--- | :--- | :--- | :--- |
| **Source &rarr; Browser (TB0 &rarr; TB1)** | Live microphone stream, Webex telephony PCM, or imported audio file. | Raw Audio (Contains Direct PII & Special Category Data) | - In-memory Web Audio API buffer allocation.<br>- Video tracks permanently discarded upon file decode.<br>- Webex RTP decrypted using ephemeral in-memory SRTP keys.<br>- Zero disk writes enforced by Storage Guards. | **Constraint C1** (Ephemeral Volatile Audio) |
| **Browser Internal (TB1)** | Raw audio, draft transcript, identifier spans, surrogate token map. | Special Category & Direct Identifiers | - Whisper WASM runs in local web worker sandbox.<br>- Layer 1, 2, 3 NER runs locally in JavaScript.<br>- Token map retained strictly in isolated session closure. | **Constraint C3** (Local-First Detection) |
| **Browser &rarr; Google Cloud STT (TB1 &rarr; TB3)** | **Verified Redacted Audio Only** (16kHz LINEAR16 WAV with acoustic mutes). | De-identified Audio (Acoustically Zeroed PII Spans) | - Mandatory Phase 10 acoustic verification pass.<br>- Fail-closed: upload aborted if any identifier is detected.<br>- Immediate line-rate zeroing of unredacted raw audio (`Uint8Array.fill(0)`).<br>- TLS 1.3 encrypted transit to `europe-west2` (London). | **Constraint C2 / C4 / C8** (Zero Unredacted Audio to Cloud) |
| **Browser &rarr; Vertex AI Gemini (TB1 &rarr; TB3)** | **Surrogate Tokenised Transcript & Prompt** (e.g. `[CLIENT_NAME_1] attends seeking advice...`). | Tokenised Text (Zero Direct PII Spans) | - Multi-layer token substitution replaces all names, NINOs, addresses, phones, emails, and employers.<br>- Zero-temperature inference prompt with strict structural instructions.<br>- Cloud terms guarantee zero data retention and zero model training. | **Constraint C5** (Surrogate Tokenisation) |
| **Cloud &rarr; Browser &rarr; Casebook (TB3 &rarr; TB1 &rarr; TB4)** | Draft note returned with surrogate tokens; re-identified locally in browser. | Client Case Record | - Detokenisation occurs 100% in local browser memory.<br>- Adviser must perform active sign-off and gap confirmation.<br>- Manual copy to Casebook CRM; clipboard wiped upon session exit. | **Constraint C6** (In-Browser Detokenisation) |
| **Browser &rarr; CAW Backend (TB1 &rarr; TB2)** | Security telemetry events (stage transitions, durations, error codes, token counts). | Non-PII Operational Telemetry | - Strict JSON Schema validation rejects any free-text, phone number, NINO, postcode, or unrecognized key.<br>- Authenticated via short-lived JWT. | **Privacy Logging Policy** (0-PII / Zero Free Text) |

---

## 3. Data Residue & Destruction Boundary Guarantee

When any session termination event occurs (Explicit End, Logout, Idle Timeout, Consent Withdrawal, Tab Close, Unrecoverable Error), the `destroySession()` engine executes across all internal memory partitions:

1. **Audio Memory**: All `Float32Array` and `Uint8Array` audio buffers (raw and redacted) are overwritten in-place with zeroes (`.fill(0)`).
2. **Token Store**: The token map dictionary and identifier arrays are deleted and unreferenced.
3. **Draft & Transcript Store**: All text representations of the consultation are cleared.
4. **Web Workers**: The `SessionRecoveryWorker` instance is explicitly sent a termination message and terminated.
5. **Credentials**: Outstanding short-lived GCP STS credentials are revoked and discarded.
6. **Clipboard**: If the adviser copied detokenised case note content, the system wipes the clipboard buffer (where platform permissions allow).

