# Standard Operating Procedure SOP-REC-01: Storage, Transfer, and Timely Deletion of Source Audio/Video Recordings

**Document ID:** CAW-SOP-REC-01  
**Version:** 2.0  
**Effective Date:** September 2026  
**Audience:** All Citizens Advice Wandsworth Advisers, Supervisors, and IT Support Staff  
**Classification:** Internal Operating Procedure (Data Protection & Information Governance)  

---

## 1. Purpose and Scope

This Standard Operating Procedure (SOP) defines the mandatory protocols for capturing, transferring, importing, and securely deleting original audio and video recordings of client advice consultations.

Case Ace v2.0 operates **strictly in volatile workstation RAM (Constraint C1)**. It does not store audio on disk and cannot delete files from an adviser's local computer, USB drive, smartphone, or dictaphone. The physical retention and deletion of source recording files remains the direct legal and professional responsibility of the adviser under CAW's Data Protection Policy and the UK General Data Protection Regulation (UK GDPR).

---

## 2. Equipment Classification & Ingestion Rules

| Equipment Category | Examples | Security Classification | Ingestion Protocol |
| :--- | :--- | :--- | :--- |
| **CAW-Managed Dictaphone** | Olympus WS-883 / DM-720 issued by CAW IT | **Managed Device** | Connect via USB to managed laptop; import file into Case Ace; format/erase dictaphone storage immediately following note verification. |
| **CAW-Managed Smartphone** | CAW iPhone/Android enrolled in Intune MDM | **Managed Device** | Record voice memo in corporate container; transfer via encrypted AirDrop/OneDrive to managed laptop; delete voice memo and purge 'Recently Deleted' album. |
| **CAW-Managed Laptop (Teams/Zoom)** | CAW BitLocker-encrypted Dell/Lenovo laptop | **Managed Device** | Save local recording to temporary folder `C:\Temp\Consultations`; import into Case Ace; permanently delete (`Shift + Del`) after Casebook sign-off. |
| **Client Personal Device** | Client voice recording submitted via email/USB | **Unmanaged External Device** | Download to local temp folder; import into Case Ace with 'Unmanaged Device' provenance attestation; permanently delete file immediately after note synthesis. |
| **Third-Party Advocate Recorder** | Recording provided by external case worker | **Unmanaged External Device** | Treat as unmanaged external asset; confirm consent attestation; delete local temporary copy after import. |

---

## 3. Mandatory Five-Step Operating Procedure

### Step 1: Pre-Recording Consent
Before starting any recording on an external device (dictaphone or mobile app), the adviser must obtain affirmative client consent. The adviser must explain:
1. The consultation is recorded solely to produce an accurate case note for Casebook.
2. The recording will be processed in temporary computer memory and destroyed.
3. Declining or stopping recording has zero impact on the advice provided.

### Step 2: File Import into Case Ace
1. Launch Case Ace v2.0 on a CAW-managed workstation.
2. Select **Route 3: Import Recorded Consultation**.
3. Complete the **Provenance & Consent Attestation** modal:
   - Select the original appointment date.
   - Select the recording equipment from the controlled dropdown.
   - Select the consent means (e.g. *Written & Signed Client Intake Agreement*).
   - Select party coverage (*Both Parties* / *Adviser Only* / *Client Only*).
4. Select the file. Case Ace will immediately read the audio into volatile RAM, strip any video tracks, and discard the file name.

### Step 3: Review and Casebook Handoff
1. Review the generated AQS Level 3 draft case note.
2. Make necessary factual edits and sign off the note.
3. Click **Copy to Casebook** and paste the finalized note into the client's official Casebook case file.

### Step 4: Immediate Deletion of Source Recording
Immediately after confirming that the case note is successfully saved in Casebook:
1. **Workstation Temp Folder**: If the file was saved on the laptop, permanently delete it (`Shift + Delete` on Windows / `Option + Command + Delete` on macOS).
2. **Dictaphone**: Select the file on the Olympus dictaphone and press `Erase`, or connect to PC and delete the file from the recorder's memory folder.
3. **Smartphone**: Delete the audio note in the Voice Memos app, then open *Recently Deleted* and tap *Delete All*.
4. **USB Drives**: Permanently delete the file and empty the Recycle Bin / Trash before ejecting the drive.

### Step 5: Session Termination
Click **End Session** or **Log Out** in Case Ace to ensure all volatile memory buffers and surrogate token maps are zeroed.

---

## 4. Prohibited Actions & Strict Invariants

1. **NEVER Rename Files with Client PII**: Do not rename recording files with client names, dates of birth, or National Insurance numbers. Retain default recorder names (e.g. `REC001.MP3`).
2. **NEVER Upload Recordings to Personal Cloud Storage**: Do not store client recordings on personal Google Drive, iCloud, Dropbox, or unapproved network shares.
3. **NEVER Retain Recordings Past Casebook Entry**: Storing recordings longer than necessary to draft the case note violates CAW's Data Protection Impact Assessment (DPIA) and UK GDPR Article 5(1)(e) (Storage Limitation).
4. **NEVER Leave Dictaphones Unattended**: Keep physical dictaphones in locked drawers or in the adviser's direct possession when holding un-erased consultations.

---

## 5. Audit & Compliance Monitoring

1. Supervisors may conduct periodic sampling to verify that dictaphones and workstation temp folders do not contain stale audio files.
2. Any discovery of client recordings retained beyond 24 hours without explicit supervisor authorization must be reported as a Data Protection Incident to the CAW Information Governance Lead.
