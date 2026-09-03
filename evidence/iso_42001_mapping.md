# ISO/IEC 42001:2023 AI Management System (AIMS) Mapping

**Document Reference**: DOC-02  
**System**: Case Ace v2.0 Client Consultation Recording & Note Drafting System  
**Organisation**: Citizens Advice Wandsworth (CAW)  
**Standard**: ISO/IEC 42001:2023 (Information Technology — Artificial Intelligence — Management System)  
**Status**: Aligned & Empirically Verified  
**Classification**: Official-Sensitive / Governance Pack  

---

## 1. Executive Statement & Scope Notice

> [!IMPORTANT]
> **Declaration of AI Management Alignment**:
> This document details the technical, governance, and operational controls implemented in Case Ace v2.0 in accordance with **ISO/IEC 42001:2023**.
> **No claim of formal accredited certification is made.** This mapping documents CAW's implementation of responsible, transparent, human-in-the-loop generative AI for advice consultation note-taking.

---

## 2. ISO/IEC 42001:2023 Control Domain Mapping

### Domain 1: AI Policy & Organisational Objectives (Clause 5 & 6)
* **Objective**: Establish organizational boundaries, ethical guardrails, and acceptable use policies for AI deployment.
* **CAW Policy Implementation**:
  - Case Ace v2.0 is strictly constrained to **administrative case note drafting** from consented advice consultations.
  - The AI is **explicitly forbidden** from providing autonomous advice, determining client entitlement, making welfare benefit decisions, or contacting third parties.
  - Professional responsibility for the accuracy, completeness, and clinical/legal validity of the case note remains 100% with the qualified advising professional.
* **Evidence Reference**: [`evidence/model_card.md`](./model_card.md), [`backend/src/prompts/caseRecordingMasterPrompt.ts`](../backend/src/prompts/caseRecordingMasterPrompt.ts).

---

### Domain 2: AI Impact Assessment & Risk Governance (Clause 6.1.2 & Annex B)
* **Objective**: Systematically identify, evaluate, and mitigate risks associated with AI deployment (e.g. hallucination, omission, demographic bias, automation bias, privacy breaches).
* **Identified Risks & Controls**:
  1. **Automation Bias**: Advisers blindly trusting AI-generated drafts.  
     *Control*: Deliberate UI friction in Phase 14 review interface. Mandatory individual confirmation of low-confidence statements, un-ticked gap acknowledgements, and explicit statutory responsibility confirmation before copy/export.
  2. **Harmful Hallucination / Omission**: Fabricating debt figures, benefit deadlines, or advice given.  
     *Control*: Zero-temperature deterministic prompt structure, few-shot grounding in AQS Level 3 standards, explicit gap detection flagging missing documents/facts, and dual-pass verification.
  3. **Demographic & Dialect Bias**: Poor ASR/NER performance on regional accents or non-native English speakers.  
     *Control*: 33-scenario synthetic corpus representing Geordie, Glaswegian, Cockney, Welsh, multicultural accents, and speech impairments. Redaction recall verified at $\ge 92.3\%$ and AQS compliance at 100%.
  4. **Data Exfiltration & Surveillance**: Third-party LLM training on client disclosures.  
     *Control*: Local surrogate tokenisation before network egress. Zero-day retention agreement with Google Cloud Vertex AI in `europe-west2` (London) under enterprise terms ensuring zero model training on client payloads.
* **Evidence Reference**: [`evidence/residual_risk_register.md`](./residual_risk_register.md), [`evidence/redaction_performance_report.md`](./redaction_performance_report.md).

---

### Domain 3: AI Data Governance & Quality Management (Clause 8 & Annex B.4)
* **Objective**: Ensure integrity, provenance, privacy, and suitability of data used across the AI lifecycle.
* **Data Lifecycle Controls**:
  - **Zero Production Client Training Data**: Case Ace v2.0 utilizes frozen foundation models (`gemini-1.5-pro-002` / `gemini-1.5-flash-002`) accessed strictly via inference APIs. No client data is ever used for model fine-tuning, training, or distillation.
  - **Synthetic Test Corpus Governance**: All 33 test scenarios are 100% synthetic, authored by CAW subject-matter experts with known ground truth spans and model case notes.
  - **Local Tokenisation Boundary**: Direct PII (NINOs, Names, Addresses, Phones, Employers) is replaced with surrogate tokens (`[CLIENT_NAME_1]`, `[NINO_1]`) within the browser before the text reaches any AI model.
* **Evidence Reference**: [`test/corpus/syntheticAdviceCorpus.ts`](../test/corpus/syntheticAdviceCorpus.ts), [`client/src/redaction/identifierEngine.ts`](../client/src/redaction/identifierEngine.ts).

---

### Domain 4: Human Oversight, Agency & Professional Responsibility (Annex B.5)
* **Objective**: Guarantee that human agents retain meaningful control, override capability, and ultimate accountability for AI outputs.
* **Phase 14 Adviser Review & Sign-Off Architecture**:
  - **Fully Editable Draft**: Advisers can edit, delete, or append any section of the generated draft.
  - **Bi-Directional Source Grounding**: Clicking any sentence in the draft highlights the exact source utterance in the transcript; clicking a transcript segment displays the corresponding drafted text.
  - **Mandatory Individual Acknowledgements**: Gaps, limitations, and low-confidence statements are highlighted with required individual review actions. No "Accept All" or pre-ticked checkboxes exist.
  - **Prominent Safeguarding Protocol**: Safeguarding disclosures are presented in a dedicated high-visibility panel linking directly to CAW Safeguarding Procedures and designated safeguarding leads (DSLs).
  - **Explicit Affirmation of Responsibility**: Sign-off requires clicking a clear affirmative statement:  
    *“I confirm that this case record is accurate, complete, and represents my professional record of this consultation. I acknowledge that professional responsibility for this advice rests solely with me.”*
* **Evidence Reference**: `client/src/components/AdviserReviewSignOff.tsx`, [`evidence/model_card.md`](./model_card.md).

---

### Domain 5: Transparency, Explainability & Auditability (Annex B.7 & B.8)
* **Objective**: Ensure AI processing is transparent to clients and advisers, and operations are auditable without compromising privacy.
* **Transparency Mechanisms**:
  - **Tiered Client Consent (Phase 6)**: Clear, plain-English explanation provided to clients before consultation start, detailing audio processing, redaction, and right to withdraw consent at any time.
  - **System Auditability**: Immutable audit log store tracking prompt versions (`v2.4.0`), model identifiers (`gemini-1.5-pro-002`), verification pass results, and review gate durations without capturing free text or PII.
* **Evidence Reference**: [`backend/src/logging/logSchema.ts`](../backend/src/logging/logSchema.ts), [`evidence/ropa_entry.md`](./ropa_entry.md).

---

### Domain 6: AI System Lifecycle Management & Continuous Validation (Clause 9 & 10)
* **Objective**: Continuous monitoring, performance evaluation, and regression testing across the system lifecycle.
* **Continuous Testing Pipeline**:
  - Automated benchmark execution on every commit evaluating 33 synthetic scenarios against AQS Level 3 quality criteria and redaction recall/precision thresholds ($\ge 90\%$).
  - Fail-closed network egress interception asserting zero PII leakage.
* **Evidence Reference**: [`test/testingEngine.ts`](../test/testingEngine.ts), [`scripts/test-phase15-17.mjs`](../scripts/test-phase15-17.mjs).
