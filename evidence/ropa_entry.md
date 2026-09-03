# UK GDPR Article 30: Record of Processing Activities (ROPA)

**Document Reference**: DOC-04  
**Organisation**: Citizens Advice Wandsworth (CAW)  
**ICO Data Controller Registration**: Z6294719  
**System**: Case Ace v2.0 Client Consultation Recording & Note Drafting System  
**Date of Entry**: 2026-09-02  
**Information Governance Review Cycle**: Annual / Post-Major System Upgrade  
**Classification**: Official-Sensitive / Governance Pack  

---

## 1. Data Controller & Information Governance Details

| Field | Detail |
| :--- | :--- |
| **Data Controller** | Citizens Advice Wandsworth (CAW) |
| **Registered Address** | Battersea Library, 265 Lavender Hill, London, SW11 1JB |
| **Data Protection Officer (DPO)** | dpo@cawandsworth.org.uk |
| **Information Asset Owner (IAO)** | Head of Operations, Citizens Advice Wandsworth |
| **Lead Technical Contact** | Lead Systems Architect / AI Technical Lead |

---

## 2. Description of Processing Activity

| Attribute | Details |
| :--- | :--- |
| **Name of Processing Activity** | Client Consultation Audio Processing and AI-Assisted Case Recording (Case Ace v2.0) |
| **Purpose of Processing** | Assisting qualified generalist advisers and caseworkers in drafting accurate, structured, and comprehensive case notes of client advice consultations in compliance with the Advice Quality Standard (AQS Level 3 - Advice and Casework). |
| **Categories of Data Subjects** | Members of the public accessing Citizens Advice Wandsworth services across Wandsworth and South West London seeking advice on welfare benefits, Universal Credit, disability benefits, debt, housing, employment, energy, and community care. |
| **Categories of Personal Data** | - Spoken consultation voice audio (client and adviser).<br>- Consultation transcripts.<br>- Personal identifiers: Full Names, Dates of Birth, National Insurance Numbers (NINO), UK Postcodes, Street Addresses, Telephone Numbers, Email Addresses.<br>- Financial Data: Bank account details, wage slips, creditor reference numbers, debt schedules, Universal Credit payment statements.<br>- Employment records and employer names. |
| **Special Category Data (Article 9)** | - **Health & Disability Data**: Medical conditions, mental health disclosures, PIP/ESA/DLA assessment records, GP surgery and consultant names.<br>- **Racial / Ethnic Origin & Nationality**: Immigration status, nationality, language/interpreter requirements.<br>- **Trade Union Membership**: Disclosed in employment dispute consultations.<br>- **Safeguarding / Risk to Life**: Disclosures of domestic abuse, suicide/self-harm risk, child protection concerns. |

---

## 3. Lawful Basis for Processing (UK GDPR & DPA 2018)

| Layer | Lawful Basis | Legal Instrument & Statutory Condition |
| :--- | :--- | :--- |
| **Personal Data (Article 6)** | **Consent** (Article 6(1)(a)) | Freely given, specific, informed, and unambiguous consent obtained from the client prior to audio capture. Client is informed of their right to withdraw consent at any time without affecting their advice service. |
| **Special Category Data (Article 9)** | **Explicit Consent** (Article 9(2)(a))<br>& **Not-for-Profit Body Activities** (Article 9(2)(d)) | Explicit affirmative consent obtained for processing special category health, disability, and immigration data disclosed during the advice session. Supported by DPA 2018 Schedule 1 Part 1 condition. |
| **Criminal Offence / Safeguarding Data** | **DPA 2018 Schedule 1 Part 2** (Safeguarding of Children and Individuals at Risk) | Section 10(5) and Schedule 1, Part 2, paragraph 18 (Safeguarding of individuals at risk). |

---

## 4. Recipients & Data Processors

| Processor Name | Role in Processing | Data Elements Disclosed | Location & Data Residency | Contractual & Security Terms |
| :--- | :--- | :--- | :--- | :--- |
| **Google Cloud Platform (GCP)** | Speech-to-Text v2 (Pass 2 Cloud ASR) | **Verified Redacted Audio ONLY** (LINEAR16 WAV with all PII spans muted). | `europe-west2` (London, UK) | Google Cloud Data Processing Addendum (DPA), Model Terms, Zero-day data retention, zero training on customer data. |
| **Google Cloud Vertex AI** | Generative AI Note Drafting (Gemini 1.5) | **Surrogate Tokenised Text ONLY** (e.g. `[CLIENT_NAME_1]`, `[NINO_1]`). | `europe-west2` (London, UK) | Google Cloud Vertex AI Terms of Service, Zero Customer Data Logging, zero training on prompts/responses. |
| **Cisco Systems Inc.** | Cisco Webex Telephony API (Telephony Ingest) | Telephony RTP Audio Stream (Real-time stream for duration of active call). | London Data Centre / In-Memory Transit | Cisco Cloud Services Agreement, Webex Security Architecture, Cloud Recording Disabled. |
| **Microsoft Corporation** | Microsoft Entra ID (Adviser SSO & MFA) | Adviser corporate identity, email, and authentication timestamps. | UK / EU Tenant | Microsoft Online Services Terms (OST) and DPA. |

---

## 5. Retention Schedule & Erasure Guarantees

| Data Asset | Storage Medium | Retention Period | Disposal / Erasure Mechanism |
| :--- | :--- | :--- | :--- |
| **Raw Consultation Audio** | Browser Volatile RAM (`Float32Array`) | **0 Days** (Duration of consultation capture up to Phase 10 verification only). | Explicit in-memory overwriting (`Uint8Array.fill(0)`) upon Phase 10 verification pass or session destruction. |
| **Redacted Consultation Audio** | Browser Volatile RAM (`Uint8Array`) | **0 Days** (Duration of consultation up to adviser sign-off). | In-memory zeroing (`Uint8Array.fill(0)`) upon `destroySession()`. |
| **Surrogate Token Map & Transcripts** | Browser Volatile RAM (JavaScript Heap) | **0 Days** (Duration of active session only). | Nullified and unreferenced upon `destroySession()`; browser tab release. |
| **Final Detokenised Case Note** | Casebook CRM (National Citizens Advice System) | As defined by Citizens Advice National Retention Policy (typically 6 years). | Exported manually by adviser into Casebook; immediately purged from Case Ace RAM. |
| **System Security & Audit Telemetry** | Backend In-Memory / SQLite Store | **365 Days (12 Months)** | Automated daily TTL purge job (`purgeExpired()`); zero free text or client identifiers stored. |

---

## 6. International Data Transfers

> [!IMPORTANT]
> **Zero Third-Country International Data Transfers**:
> All cloud processing facilities utilized by Case Ace v2.0 (Google Cloud Speech-to-Text, Vertex AI Gemini, Cisco Webex UK Telephony, Microsoft Entra ID) are provisioned strictly within the **United Kingdom (`europe-west2` London region)**. No personal data or consultation audio is transferred outside the UK.
