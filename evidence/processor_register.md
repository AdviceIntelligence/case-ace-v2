# Cloud & Sub-Processor Compliance Register

**Document Reference**: DOC-05  
**System**: Case Ace v2.0 Client Consultation Recording & Note Drafting System  
**Organisation**: Citizens Advice Wandsworth (CAW)  
**Applicable Regulation**: UK GDPR Article 28 & Data Protection Act 2018  
**Status**: Formally Approved & Contractually Grounded  
**Classification**: Official-Sensitive / Governance Pack  

---

## 1. Executive Summary & Processor Governance

In accordance with **UK GDPR Article 28(3)**, this register documents all external data processors and infrastructure providers engaged in the operation of Case Ace v2.0. Each processor relationship is governed by a legally binding Data Processing Addendum (DPA), explicit data residency commitments (`europe-west2` London), and verified operational configurations ensuring zero unauthorized data retention or secondary model training.

---

## 2. Comprehensive Sub-Processor Register

### 1. Google Cloud Platform (Speech-to-Text v2)
* **Corporate Entity**: Google Cloud Platform (Google Cloud EMEA Limited, Ireland / Google LLC)
* **Services Utilized**: Google Cloud Speech-to-Text API v2 (`chirp_2` / `latest_long` recognizer model in `europe-west2`).
* **Contractual Instruments**:
  - Google Cloud Master Agreement & Data Processing and Security Terms (DPST).
  - Business Associate Agreement / Model Contractual Clauses (UK Addendum).
* **Data Transferred & Sensitivity**:
  - **Verified Redacted Audio Only**: Padded LINEAR16 mono WAV files where all client names, NINOs, addresses, phones, and identifiers have been acoustically zeroed in the browser.
* **Data Residency Commitment**:
  - Pinned strictly to `europe-west2` (London Data Centre). Service endpoints: `speech.googleapis.com` with regional resource binding `projects/.../locations/europe-west2`.
* **Data Retention & Logging Policy**:
  - **Data Logging Disabled**: Cloud Speech-to-Text Data Logging opt-out active (`enable_word_time_offsets: true`, `model: "latest_long"`, `data_logging: false`). Audio is processed entirely in volatile GPU/CPU RAM and discarded immediately upon response return.
* **Zero Model Training Guarantee**:
  - Google Cloud enterprise terms explicitly prohibit the use of customer audio payloads for foundation model training or system improvement.

---

### 2. Google Cloud Platform (Vertex AI — Gemini 1.5)
* **Corporate Entity**: Google Cloud Platform (Google Cloud EMEA Limited / Google LLC)
* **Services Utilized**: Google Cloud Vertex AI Model Garden (`gemini-1.5-pro-002` / `gemini-1.5-flash-002` endpoints in `europe-west2`).
* **Contractual Instruments**:
  - Google Cloud Master Agreement, Vertex AI Commercial Terms, Google Cloud DPST.
* **Data Transferred & Sensitivity**:
  - **Surrogate Tokenised Transcripts Only**: Consultation text where all direct personal identifiers have been substituted with abstract tokens (e.g. `[CLIENT_NAME_1]`, `[NINO_1]`, `[POSTCODE_1]`).
* **Data Residency Commitment**:
  - Pinned strictly to `europe-west2` (London Data Centre). Endpoint: `europe-west2-aiplatform.googleapis.com`.
* **Data Retention & Logging Policy**:
  - **Zero Customer Data Retention**: Prompts and completions are processed ephemerally during active inference and are not stored in persistent cloud logs or disk cache.
* **Zero Model Training Guarantee**:
  - Google Cloud Vertex AI terms contractually guarantee that customer prompt inputs and generated model outputs are **never** used to train, fine-tune, or improve Google foundation models or shared systems.

---

### 3. Cisco Systems, Inc. (Cisco Webex)
* **Corporate Entity**: Cisco Systems, Inc. (Cisco International Limited, UK)
* **Services Utilized**: Cisco Webex Calling API / Webex Webhooks / Webex KMS (Telephony Ingest).
* **Contractual Instruments**:
  - Cisco Universal Cloud Agreement (UCA) & Privacy Data Sheet for Cisco Webex Calling.
* **Data Transferred & Sensitivity**:
  - Real-time telephony audio stream (RTP packets) during active inbound/outbound advice calls.
  - Call metadata (pseudonymous call IDs, durations, start/end timestamps).
* **Data Residency Commitment**:
  - UK / European Telephony Infrastructure. Media nodes located within the United Kingdom.
* **Webex Cloud Recording & Retention Position**:
  - **Cloud Recording Disabled**: CAW Webex Organisation settings enforce `Cloud Recording = Disabled`. No consultation audio is ever recorded or persisted in Cisco Webex Cloud Storage.
  - **Call Detail Record (CDR) Retention**: Call metadata (calling/called number, duration, call ID) is retained in the CAW Webex administrative portal for 30 days per standard telecom audit policy and purged automatically.

---

### 4. Microsoft Corporation (Microsoft Entra ID)
* **Corporate Entity**: Microsoft Corporation (Microsoft Ireland Operations Limited / Microsoft Limited, UK)
* **Services Utilized**: Microsoft Entra ID (formerly Azure Active Directory) for Single Sign-On (SSO) and Multi-Factor Authentication (MFA).
* **Contractual Instruments**:
  - Microsoft Online Services Terms (OST) and Microsoft Data Protection Addendum (DPA).
* **Data Transferred & Sensitivity**:
  - Adviser corporate identity, email address, user role, and session authentication tokens.
* **Data Residency Commitment**:
  - UK Data Boundary / UK Tenancy.

---

## 3. Sub-Processor Audit & Verification Schedule

| Sub-Processor | Verification Method | Frequency | Last Verification Date | Next Audit Date |
| :--- | :--- | :--- | :--- | :--- |
| **Google Cloud (STT v2)** | SOC 2 Type II Report & ISO 27001 Certificate Review; Endpoint configuration assertion (`europe-west2`). | Annual | 2026-08-15 | 2027-08-15 |
| **Google Cloud (Vertex AI)** | Google Cloud Privacy Compliance Review; Zero-retention configuration validation. | Annual | 2026-08-15 | 2027-08-15 |
| **Cisco Systems (Webex)** | Webex Admin Console Policy Audit (Cloud Recording Disabled assertion). | Bi-annual | 2026-08-20 | 2027-02-20 |
| **Microsoft (Entra ID)** | Entra ID Conditional Access Policy & MFA Audit. | Annual | 2026-08-10 | 2027-08-10 |
