# Pilot Hard Stop Criteria & Circuit Breakers

**Document Reference**: CAW-PILOT-STOP-2026-01  
**System**: Case Ace v2.0 Client Consultation Recording & Note Drafting System  
**Organisation**: Citizens Advice Wandsworth (CAW)  
**Status**: Formally Approved Prior to Pilot Commencement  
**Effective Date**: 2026-09-02  
**Classification**: Official-Sensitive / Governance  

---

## 1. Principle of Pre-Defined Stop Criteria

> [!CAUTION]
> **Mandatory Governance Pre-Condition**:
> Under ISO/IEC 42001:2023 and CAW Trustee Governance, **Pilot Hard Stop Criteria must be formally established and approved prior to launching any live pilot deployment**. 
> 
> If any of the following pre-defined thresholds is triggered, the pilot is **immediately halted across all participating advisers and bureaux**. The decision to halt is non-discretionary and binding on all operational managers.

---

## 2. Definitive Pilot Circuit Breaker Matrix

```
+----------------------------------------------------------------------------------------------------+
| PRE-DEFINED PILOT HARD STOP CRITERIA                                                               |
+----------------------------------------------------------------------------------------------------+
| Trigger Category       | Specific Hard Stop Condition                              | Action Level  |
+----------------------------------------------------------------------------------------------------+
| **1. Data Protection** | Any confirmed transmission of unredacted client PII       | **IMMEDIATE** |
|                        | (name, NINO, DOB, address) to cloud endpoints (GCP).      | **HALT**      |
| **2. Legal / Advice**   | Any uncorrected material hallucination (e.g. invalid      | **IMMEDIATE** |
|                        | statutory advice or missed court deadline) saved to CRM.  | **HALT**      |
| **3. Client Rights**   | More than 1 formal client complaint regarding consent     | **IMMEDIATE** |
|                        | coercion or recorded dialogue without clear opt-in.       | **HALT**      |
| **4. Technical Failure**| $\ge 3$ consecutive consultation crashes resulting in     | **IMMEDIATE** |
|                        | adviser workflow disruption or data loss.                 | **HALT**      |
| **5. Equality / EqIA** | Systemic ASR failure rate (Word Error Rate $> 25\%$)      | **TARGETED**  |
|                        | resulting in service disparity for non-native / disabled. | **HALT**      |
| **6. Supervisory QA**  | Overall AQS Level 3 pass rate drops below $80.0\%$ in any | **TEMPORARY** |
|                        | single supervisory evaluation week.                       | **PAUSE**     |
+----------------------------------------------------------------------------------------------------+
```

---

## 3. Detailed Circuit Breaker Definitions & Rationales

### Stop Criterion 1: Confirmed Unredacted PII Egress (Zero-Tolerance)
* **Threshold**: Exactly 1 confirmed occurrence of direct personal identifiers bypassing local tokenisation and acoustic muting and reaching Google Cloud Speech-to-Text or Vertex AI.
* **Rationale**: Direct violation of Core Invariant Constraint C5 (Surrogate Tokenisation) and UK GDPR Data Minimisation.
* **Immediate Protocol**:
  1. Revoke all active cloud API keys and bearer tokens.
  2. All 15 advisers instructed to halt Case Ace immediately.
  3. DPO initiates Article 33 breach notification triage within 1 hour.

### Stop Criterion 2: Uncorrected Material Statutory Error in Casebook
* **Threshold**: Exactly 1 confirmed instance where an AI-generated draft note contained an inverted legal fact (e.g. stating a Section 21 notice was valid when invalid) or missed a statutory limitation deadline, which was saved to Casebook and given to a client.
* **Rationale**: Directly prejudices client legal rights and advice safety.
* **Immediate Protocol**:
  1. Supervising Caseworker urgently contacts client to issue a corrected advice letter.
  2. Pilot paused pending root-cause investigation into adviser review gate bypass.

### Stop Criterion 3: Client Consent Grievance
* **Threshold**: $\ge 2$ formal client complaints or documented objections regarding perceived pressure to record consultations.
* **Rationale**: Compromises trust in Citizens Advice Wandsworth and violates UK GDPR freely given consent standards.
* **Immediate Protocol**:
  1. In-person recording suspended across all bureaux.
  2. Consent script training and delivery audited by EDI Lead.

### Stop Criterion 4: Severe Equality / ASR Disparity
* **Threshold**: Transcription Word Error Rate exceeding $25\%$ or failure of entity detection on $\ge 3$ consultations with clients with protected speech characteristics (dysarthria, heavy accents, interpreter sessions).
* **Rationale**: Violates Section 149 of the Equality Act 2010 (Public Sector Equality Duty).
* **Immediate Protocol**:
  1. Case Ace usage paused for affected cohort.
  2. Review of acoustic models and prompt parameters with Lead EDI Caseworker.

---

## 4. Emergency Pilot Halting Procedure (Step-by-Step)

```mermaid
sequenceDiagram
    autonumber
    participant Detector as Adviser / Supervisor / DPO
    participant Ops as Head of Operations
    participant Pilot as 15 Pilot Advisers
    participant Board as Board of Trustees

    Detector->>Ops: Triggers Emergency Stop Notification
    Ops->>Ops: Verifies Condition against Stop Matrix
    Ops->>Pilot: Issues Broadcast "EMERGENCY PILOT HALT - REVERT TO MANUAL"
    Pilot->>Pilot: Close Case Ace; Continue 100% via Standard Manual Notes
    Ops->>Board: Submits Emergency Incident Report (< 24 Hours)
```

1. **Broadcast Notification**: The Head of Operations broadcasts an urgent SMS and Teams message: *"CASE ACE PILOT HALT: All advisers must close Case Ace immediately and revert 100% to manual Casebook note taking."*
2. **Access Revocation**: DevOps team disables production DNS endpoint and invalidates JWT signing secrets.
3. **Casework Continuity**: Consultations proceed without interruption using standard paper/Casebook procedures.
4. **Investigation Report**: A formal report detailing root cause, containment, and remedial options is submitted to the Board within 3 working days.
