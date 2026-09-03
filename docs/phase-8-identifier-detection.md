# Phase 8: Identifier Detection, Classification & Surrogate Tokenisation Architecture

## 1. Overview & Regulatory Rationale

Case Ace v2.0 handles special category data under UK GDPR Article 9 and Data Protection Act 2018 Schedule 1 (advice and assistance provided by not-for-profit bodies). To protect client privacy and comply with the **C1 Volatile Memory** and **Zero Direct Data Transmission** invariants, all personal identifiable information (PII) and special category elements are detected, classified, and tokenised before any acoustic redaction (Phase 9) or cloud model interaction (Phase 10).

The system prioritises **recall over precision**:
- **Asymmetric Cost Model**: A false positive costs the adviser a single click to override or refine. A false negative risks sending real client names or identifier data to an external processor.
- **Equal Protection for Third Parties**: Case notes frequently mention third parties (abusive ex-partners, landlords, children, social workers, officials). Detection treats all named individuals as equal first-class targets for redaction.
- **Transparent Consequence Cards for Special Category Data**: Redacting substance such as *"the client has a diagnosis of paranoid schizophrenia and was sectioned in March"* destroys the utility of an AQS Level 3 case note. The system flags special category elements for adviser decision, explicitly disclosing the consequence of redaction (loss of clinical substance) vs retention (privacy disclosure), defaulting to tokenising identifiers while preserving clinical meaning.

---

## 2. Multi-Layer Detection Architecture

```
                                  Pass 1 Raw Transcript
                                            │
               ┌────────────────────────────┼────────────────────────────┐
               ▼                            ▼                            ▼
   ┌───────────────────────┐   ┌────────────────────────┐   ┌─────────────────────────┐
   │        Layer 1        │   │        Layer 2         │   │         Layer 3         │
   │ Structured Patterns   │   │ Unstructured NER       │   │ Special Category        │
   │ (Deterministic Regex) │   │ (Local Dict & Context) │   │ (Clinical & Legal Flags)│
   └───────────┬───────────┘   └───────────┬────────────┘   └────────────┬────────────┘
               │                           │                             │
               │  - NINO (inc. spoken)     │  - Client / Partner Names   │  - Health / Mental Health
               │  - Postcodes (BS 7666)    │  - Abusive Ex-Partners      │  - Domestic Abuse / MARAC
               │  - Phone / Email          │  - Children / Landlords     │  - Immigration / NRPF
               │  - NHS No (Modulus 11)    │  - Social Workers / Judges  │  - Criminal Justice
               │  - Sort Code / Bank Acct  │  - Schools / Refuges        │  - Child Protection
               │  - Benefit / Court Refs   │  - Granular Locations       │  - Trade Union / Religion
               │  - Dates of Birth (DOB)   │  - Distinctive Occupations  │  - Consequence Cards
               │                           │                             │
               └───────────────────────────┼─────────────────────────────┘
                                           │
                                           ▼
                            ┌──────────────────────────────┐
                            │      IdentifierEngine        │
                            │  - Overlap Conflict Resolver │
                            │  - ASR Audio Time Projector  │
                            │  - Surrogate Token Generator │
                            │  - Non-Mutating Tokeniser    │
                            └──────────────┬───────────────┘
                                           │
                        ┌──────────────────┴──────────────────┐
                        ▼                                     ▼
            Volatile Session Store                 Adviser Review Panel
            (Token Map, Audio Ranges)             (Interactive Toggles)
```

### Layer 1: Deterministic Structured Identifiers (Target: 100% Recall)
- **National Insurance Number (NINO)**: Standard alphanumeric format (`QQ 12 34 56 C`) and spoken verbalizations (`QQ one two three four five six A`).
- **UK Postcodes**: Standard BS 7666 formats (`SW11 2AB`, `EC1A 1BB`, `CR2 6XH`).
- **Telephone Numbers**: Landlines (`020 7924 1234`), mobiles (`07700 900123`), international prefixes (`+44`), and spoken digit sequences.
- **Email Addresses**: Full RFC 5322 validation.
- **NHS Number with Modulus 11 Checksum**: 10-digit validation:
  $$\sum_{i=1}^9 d_i \times (11 - i) \pmod{11} = R$$
  $$\text{Check Digit} = 11 - R \quad (\text{if } R=0 \implies 0; \text{ if } R=1 \implies \text{invalid})$$
- **Bank Sort Codes & Account Numbers**: 6-digit sort codes and 8-digit account numbers verified against financial context.
- **DWP Benefit References**: Universal Credit (`UC-`), PIP, ESA, DLA, JSA, DHP.
- **Passport & Home Office References**: 9-digit passport numbers, `HO/`, `CID`, `UAN`, `BRP`, `GWF`.
- **Court & Tribunal References**: `EA/2023/0001`, `F80YX123`, `1234/2024`.
- **HMRC References**: 10-digit Unique Taxpayer References (UTR) and VAT registration numbers.
- **Dates of Birth (DOB)**: Numeric formats (`DD/MM/YYYY`), written formats (`14th August 1982`), and spoken forms (`fourteenth of August nineteen eighty two`).
- **Street & Residential Addresses**: Street numbers adjacent to UK thoroughfare suffixes (`Road`, `Street`, `Avenue`, `Grove`, `Hill`, `Estate`).

### Layer 2: Local Named Entity Recognition (Target: $\ge 99\%$ Recall)
- **Client & Family Names**: Comprehensive UK first names index + phonetic variations.
- **Third-Party Relationships**:
  - Ex-partners & spouses (*"my abusive ex-partner David Smith"*)
  - Landlords & letting agents (*"landlord Mr Henderson"*)
  - Children (*"my daughter Lily", "my son Tommy"*)
  - Support & social workers (*"social worker Rachel Adams"*)
  - Employers & managers (*"manager Steve at Tesco Express"*)
  - Named officials & decision makers (*"DWP decision maker Mr Davies"*, *"Judge Williams"*)
- **Identifying Organisations**:
  - Schools (*"Honeywell Junior School"*, *"Bolingbroke Academy"*)
  - Medical practices & GP surgeries (*"Lavender Hill Group Practice"*)
  - Hospitals (*"St George's Hospital"*, *"King's College Hospital"*)
  - Refuges & housing associations (*"Solace Women's Aid Refuge"*, *"Wandle Housing"*)
- **Granular Locations**: Specific estates (*"Doddington Estate"*, *"Winstanley Estate"*) where disclosure narrows identity.
- **Distinctive Occupations**: Roles with unique identifiable context (*"Head of HR at Wandsworth Council"*).

### Layer 3: Special Category & Contextual Risk Flags
- **Article 9 Special Categories**:
  - Physical & mental health conditions / diagnoses (*"paranoid schizophrenia"*, *"fibromyalgia"*, *"sectioned under the Mental Health Act"*)
  - Domestic abuse disclosures (*"fleeing domestic violence"*, *"non-molestation order"*, *"MARAC referral"*)
  - Immigration & nationality status (*"asylum seeker"*, *"no recourse to public funds / NRPF"*, *"deportation notice"*)
  - Criminal justice involvement (*"released on licence"*, *"probation order"*, *"HMP Wandsworth"*)
  - Child protection matters (*"Section 47 enquiry"*, *"child in need plan"*)
  - Sexual orientation, religion, and trade union membership (*"Unison member"*)
  - Safeguarding and risk to life flags
- **Transparent Consequence Cards**: For every flagged element, the adviser is presented with:
  1. **Retention Risk**: The exact data privacy implication of retaining the term when calling cloud synthesis.
  2. **Redaction Impact**: The impact on the quality and admissibility of the AQS Level 3 case note.
  3. **Recommended Default**: `retain_clinical_substance` (tokenise personal identifiers while preserving medical/legal diagnostic terminology).

---

## 3. Transcript Immutability & Surrogate Mapping

1. **Non-Mutating Invariant**: The original working transcript is never mutated in place. Retaining character-exact offsets allows the `IdentifierEngine` to project directly to ASR word boundaries and compute start/end acoustic millisecond timestamps for Phase 9 audio bleeping.
2. **Surrogate Token Mapping**: Identifiers are mapped to deterministic surrogate tokens (e.g. `[NINO_1]`, `[CLIENT_NAME_1]`, `[EX_PARTNER_NAME_1]`, `[REFUGE_1]`). The bidirectional mapping table is held exclusively in `VolatileSessionStore` and is wiped upon session termination.
