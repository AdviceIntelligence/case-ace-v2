# Lawful Basis & Consent Basis Analysis

**Document Reference**: CAW-GOV-BASIS-2026-01  
**System**: Case Ace v2.0 Client Consultation Recording & Note Drafting System  
**Organisation**: Citizens Advice Wandsworth (CAW)  
**Applicable Regulation**: UK General Data Protection Regulation (UK GDPR) & Data Protection Act 2018 (DPA 2018)  
**Status**: Formally Approved Governance Position  
**Classification**: Official-Sensitive / Governance  

---

## 1. Executive Summary & Legal Determination

This document presents the formal legal analysis governing the lawful basis for processing personal data and Special Category Data within **Case Ace v2.0**. 

### Formal Determination
Citizens Advice Wandsworth has determined that the primary lawful basis for capturing consultation audio and processing transcripts with AI assistance is:
1. **Personal Data (Article 6)**: **Article 6(1)(a) — Consent**
2. **Special Category Data (Article 9)**: **Article 9(2)(a) — Explicit Consent**, supported by **Article 9(2)(d) — Not-for-Profit Body Legitimate Activities** and **DPA 2018 Schedule 1 Part 1 & 2 (Safeguarding)**.

---

## 2. Evaluation of Lawful Bases (Why Consent Over Legitimate Interests)

Under UK GDPR Article 6, data controllers must identify an appropriate lawful basis. We evaluated two principal candidates: **Legitimate Interests (Article 6(1)(f))** and **Consent (Article 6(1)(a))**.

```
+----------------------------------------------------------------------------------------------------+
| COMPARATIVE ANALYSIS: LEGITIMATE INTERESTS VS CONSENT                                              |
+----------------------------------------------------------------------------------------------------+
| Criterion                   | Legitimate Interests (Art 6(1)(f))    | Consent (Art 6(1)(a)) [SELECTED]     |
+----------------------------------------------------------------------------------------------------+
| Client Autonomy & Control   | Low (Relies on opt-out/objection)     | Maximum (Affirmative Opt-in)         |
| Power Imbalance Mitigation  | Vulnerable clients may feel pressured | Clear, unpressured choice guaranteed |
| Special Category Data Fit   | Does not satisfy Article 9 alone      | Satisfies Art 9(2)(a) Explicit       |
| Service Continuity on Refusal| Risk of perceived service penalty    | Absolute parity of service affirmed  |
| Withdrawal Simplicity       | Complex balancing test required       | Instant, unconditional destruction   |
+----------------------------------------------------------------------------------------------------+
```

### Why Legitimate Interests Was Rejected for Audio Capture
While Citizens Advice Wandsworth has a genuine legitimate interest in producing accurate casework records under the Advice Quality Standard (AQS), audio recording of deeply sensitive, confidential consultations (involving debt crises, domestic abuse, mental health struggles, and benefit sanctions) carries high privacy expectations. Applying Legitimate Interests could create an implicit expectation that clients must submit to recording. To preserve client dignity, trust, and autonomy, CAW selected **Consent**.

---

## 3. The Four Pillars of Valid Consent (UK GDPR Article 7 & ICO Guidance)

To be legally valid, consent under the UK GDPR must be **freely given**, **specific**, **informed**, and **unambiguous**, signified by a clear affirmative action:

### Pillar 1: Freely Given (Addressing Power Dynamics & Vulnerability)
* **The Vulnerability Challenge**: Clients seeking crisis advice (e.g. facing imminent eviction or food poverty) may feel they must agree to recording to receive help.
* **The CAW Safeguard**:
  - Advisers are trained to deliver the consent script with an explicit, neutral statement:  
    *“You do not have to agree to this. If you say no, I will write our notes by hand or type them myself as usual. Your advice, appointment time, and service will be exactly the same.”*
  - No pre-ticked checkboxes or default opt-ins exist in the software.
  - Refusing consent is completely cost-free and creates zero disadvantage for the client.

### Pillar 2: Specific & Granular (Tiered Consent Options)
* **The Granularity Requirement**: Consent for recording must be separated from consent to receive advice or share data with referral partners.
* **The CAW Safeguard**:
  - Case Ace v2.0 implements **Tiered Consent (Phase 6)**. Recording consent is captured as an independent, standalone record in the intake interface.
  - Telephony consultations over Cisco Webex require verbal affirmative confirmation before the adviser engages the in-memory stream capture.

### Pillar 3: Informed (Plain English, Easy-Read & Translated Formats)
* **The Clarity Requirement**: Clients must understand who is processing the data, what the AI tool does, how redaction works, and where the data goes.
* **The CAW Safeguard**:
  - CAW provides four distinct versions of the consent disclosure: Standard Plain English, Easy-Read (with visual concepts for learning-disabled clients), Multilingual Summary (Spanish, Portuguese, Polish, Somali, Arabic), and a concise Verbal Telephony Script.
  - Key facts disclosed: Audio stays on the computer until personal names/details are muted; notes are drafted with AI; the adviser personally reviews every word; audio is destroyed immediately after the session.

### Pillar 4: Unambiguous Affirmative Action
* **The Action Requirement**: Consent cannot be inferred from silence, inactivity, or continuation of the conversation.
* **The CAW Safeguard**: The adviser must explicitly click the **"Client Consented to In-Session Recording"** button in the intake UI after receiving the client's verbal or written agreement.

---

## 4. Unconditional Right of Withdrawal (Article 7(3))

Clients have the absolute right to withdraw consent at any time during or after the consultation without giving a reason:

```mermaid
sequenceDiagram
    autonumber
    participant Client as Advice Client
    participant Adviser as Qualified Adviser
    participant UI as Case Ace UI
    participant Memory as Volatile RAM & Workers

    Client->>Adviser: "Please stop recording / I withdraw consent"
    Adviser->>UI: Clicks "Withdraw Consent & Destroy Session"
    UI->>Memory: Calls destroySession({ reason: 'consent_withdrawn' })
    Memory->>Memory: Overwrites all Audio Buffers (Uint8Array.fill(0))
    Memory->>Memory: Purges Token Maps, Transcripts & Worker State
    Memory-->>UI: Session Destroyed Assertion Passed
    UI-->>Adviser: UI resets to Clean State; Advisory Notice Displayed
    Adviser->>Client: "Recording stopped and deleted. Continuing manually."
```

* **Immediate Mechanical Destruction**: Triggering withdrawal invokes `destroySession({ reason: 'consent_withdrawn' })`. This immediately zeroes all audio arrays (`.fill(0)`), clears all transcripts and token dictionaries, terminates workers, and posts a non-PII audit event (`CONSENT_WITHDRAWN`).
* **Zero Residual Processing**: No further automated processing or drafting occurs. The adviser transitions seamlessly to manual note-taking in Casebook CRM.

---

## 5. Special Category Data Analysis (Article 9 & DPA 2018)

Consultations routinely involve Special Category personal data (health diagnoses, disability awards, trade union disputes, racial origin, domestic violence disclosures).

| Statutory Instrument | Applicable Clause | Implementation in Case Ace v2.0 |
| :--- | :--- | :--- |
| **UK GDPR Article 9(2)(a)** | **Explicit Consent** | Explicit consent is obtained covering health and sensitive disclosures made during the session. |
| **UK GDPR Article 9(2)(d)** | **Legitimate Activities of a Not-for-Profit Body** | CAW is an authorized not-for-profit advice charity with appropriate confidentiality safeguards. |
| **DPA 2018 Schedule 1 Part 1 (1)** | **Employment, Social Security and Social Protection** | Processing necessary for advising on statutory welfare benefits, Universal Credit, and disability rights. |
| **DPA 2018 Schedule 1 Part 2 (18)** | **Safeguarding of Children and Individuals at Risk** | Highlighting safeguarding disclosures to protect vulnerable individuals without cloud exposure. |
