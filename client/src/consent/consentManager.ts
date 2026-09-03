/**
 * ConsentManager
 * 
 * Implements Phase 6.1 & 6B Consent Gate for Case Ace v2.0.
 * 
 * Non-Negotiable Rules:
 * 1. Recording or import cannot proceed without an affirmative consent action.
 * 2. The consent record must NEVER contain the client's name or any client identifier.
 *    The link between the consent record and the client belongs in Casebook, in the
 *    adviser's own case record, not here.
 * 3. Route-specific wording must be presented for each intake route.
 * 4. On Webex telephone calls, the recording control is disabled until consent is confirmed.
 * 5. One-action consent withdrawal immediately and unconditionally destroys all volatile
 *    session memory without confirmation dialogues. On Webex, the call remains connected
 *    so unrecorded advice can continue.
 * 6. Phase 6B: For file imports, provenance must be captured from controlled lists with
 *    zero free text fields, and file names must never be recorded.
 */

import { destroySession } from '../state/sessionDestruction.ts';

export type IntakeRoute = 'live_in_person' | 'webex_telephony' | 'file_import';

export type SourceEquipment =
  | 'caw_olympus_dictaphone'
  | 'caw_managed_smartphone'
  | 'caw_managed_laptop_teams'
  | 'external_client_device'
  | 'external_third_party_recorder';

export type ConsentAttestationMeans =
  | 'written_intake_agreement'
  | 'verbal_consent_on_tape'
  | 'formal_mandate_form'
  | 'advocate_confirmed_prior_consent';

export type CapturePartyCoverage =
  | 'both_parties_captured'
  | 'adviser_only_captured'
  | 'client_only_captured';

export interface ImportProvenance {
  route: 'file_import';
  sourceEquipment: SourceEquipment;
  originalAppointmentDate: string; // YYYY-MM-DD
  consentAttestationMeans: ConsentAttestationMeans;
  capturePartyCoverage: CapturePartyCoverage;
  isUnmanagedDevice: boolean;
  fileNameDiscarded: true;
}

export interface ConsentRecord {
  consentId: string;
  consentedAt: string; // ISO 8601 timestamp
  route: IntakeRoute;
  adviserId: string;
  confirmedByAdviser: true;
  // For file import route only:
  importProvenance?: ImportProvenance;
  originalAppointmentDate?: string; // Stated appointment date (YYYY-MM-DD)
  importConsentMeans?: ConsentAttestationMeans;
}

export interface ConsentWording {
  title: string;
  adviserInstructions: string;
  clientInformationPoints: string[];
  affirmationStatement: string;
}

export const CONTROLLED_SOURCE_EQUIPMENT_LABELS: Record<SourceEquipment, { label: string; isUnmanaged: boolean }> = {
  caw_olympus_dictaphone: { label: 'CAW-issued Olympus Dictaphone (Managed Hardware)', isUnmanaged: false },
  caw_managed_smartphone: { label: 'CAW-managed Smartphone Voice Memo (Intune MDM)', isUnmanaged: false },
  caw_managed_laptop_teams: { label: 'CAW-managed Laptop Teams/Zoom (Encrypted BitLocker)', isUnmanaged: false },
  external_client_device: { label: 'Client Personal Device Recording (Unmanaged External Device)', isUnmanaged: true },
  external_third_party_recorder: { label: 'Third-Party Audio Recorder (Unmanaged External Device)', isUnmanaged: true },
};

export const CONTROLLED_CONSENT_MEANS_LABELS: Record<ConsentAttestationMeans, string> = {
  written_intake_agreement: 'Written & Signed Client Intake Agreement (Form CAW-01)',
  verbal_consent_on_tape: 'Verbal Consent Recorded Directly on the Audio Track',
  formal_mandate_form: 'Formal Written Client Authority & Mandate Document',
  advocate_confirmed_prior_consent: 'Third-Party Accredited Advocate Verified Consent',
};

export const CONTROLLED_PARTY_COVERAGE_LABELS: Record<CapturePartyCoverage, string> = {
  both_parties_captured: 'Both Parties Captured (Adviser and Client Voices Present)',
  adviser_only_captured: 'Adviser Only Captured (Single Channel Dictation / Notes)',
  client_only_captured: 'Client Only Captured (Client Voice Note / Voicemail)',
};

export class ConsentManager {
  private static readonly FORBIDDEN_CLIENT_PII_KEYS = [
    'name',
    'clientname',
    'client_name',
    'phone',
    'phonenumber',
    'telephone',
    'clientid',
    'client_id',
    'nino',
    'address',
    'postcode',
    'email',
    'dob',
    'filename',
    'file_name',
    'mediafilename',
  ];

  /**
   * Returns route-specific consent wording and adviser guidance.
   */
  public getWordingForRoute(route: IntakeRoute): ConsentWording {
    switch (route) {
      case 'live_in_person':
        return {
          title: 'Face-to-Face Consultation Consent Gate',
          adviserInstructions:
            'Before starting recording, explain the following points to the client in terms they understand:',
          clientInformationPoints: [
            'This consultation is being recorded using an AI assistant solely to produce an accurate case note for your file.',
            'The recording is processed in temporary computer memory and is permanently destroyed when this advice session ends.',
            'Your raw voice recording never leaves this computer.',
            'You may decline to be recorded, or withdraw consent at any time during the interview, without any effect whatsoever on the advice you receive.',
          ],
          affirmationStatement:
            'I confirm that I have explained these points to the client in terms they understood, and the client has affirmatively consented to being recorded.',
        };

      case 'webex_telephony':
        return {
          title: 'Telephone Call (Webex) Consent Gate',
          adviserInstructions:
            'At the start of the telephone call, inform the client before initiating recording. The record button remains disabled until confirmed:',
          clientInformationPoints: [
            'Advise the client that you wish to record the call to draft their case note.',
            'Inform them that the audio is held only in temporary workstation memory and destroyed when the session ends.',
            'Explain that declining or stopping recording does not affect the telephone advice consultation.',
          ],
          affirmationStatement:
            'I confirm that I have informed the client on this call of the recording purpose and temporary memory retention, and the client has agreed to proceed.',
        };

      case 'file_import':
        return {
          title: 'Imported Recording Professional Attestation',
          adviserInstructions:
            'Because this recording took place previously or on another device, you must provide an explicit professional attestation regarding consent and provenance:',
          clientInformationPoints: [
            'Attest that valid consent was obtained from the client at the time of the original interview.',
            'Confirm the date on which the interview took place using the controlled calendar field.',
            'Select the source equipment, consent means, and party coverage from controlled lists (zero free text allowed).',
            'Understand that original recordings on your local device remain your professional responsibility under CAW SOP-REC-01.',
          ],
          affirmationStatement:
            'I professionally attest that valid client consent was affirmatively obtained at the time of the original consultation, and all provenance attributes selected below are accurate.',
        };
    }
  }

  /**
   * Records affirmative consent for a consultation route.
   * Strictly enforces Zero Client PII invariant and controlled list selections for imports.
   */
  public recordConsent(
    route: IntakeRoute,
    adviserId: string,
    importParams?: {
      originalAppointmentDate: string;
      sourceEquipment: SourceEquipment;
      consentMeans: ConsentAttestationMeans;
      partyCoverage: CapturePartyCoverage;
    }
  ): ConsentRecord {
    if (!adviserId || adviserId.trim() === '') {
      throw new Error('[ConsentGate] Adviser ID is mandatory to establish professional accountability.');
    }

    const consentId = `cst_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const consentedAt = new Date().toISOString();

    let importProvenance: ImportProvenance | undefined;

    if (route === 'file_import') {
      if (!importParams) {
        throw new Error('[ConsentGate] File import requires date, source equipment, and consent attestation.');
      }
      if (!importParams.originalAppointmentDate || !/^\d{4}-\d{2}-\d{2}$/.test(importParams.originalAppointmentDate)) {
        throw new Error('[ConsentGate] Original appointment date must be a valid ISO date (YYYY-MM-DD).');
      }
      if (!importParams.sourceEquipment || !(importParams.sourceEquipment in CONTROLLED_SOURCE_EQUIPMENT_LABELS)) {
        throw new Error('[ConsentGate] Source equipment must be selected from the controlled list.');
      }
      if (!importParams.consentMeans || !(importParams.consentMeans in CONTROLLED_CONSENT_MEANS_LABELS)) {
        throw new Error('[ConsentGate] Consent means must be selected from the controlled list.');
      }
      if (!importParams.partyCoverage || !(importParams.partyCoverage in CONTROLLED_PARTY_COVERAGE_LABELS)) {
        throw new Error('[ConsentGate] Party coverage must be selected from the controlled list.');
      }

      const isUnmanaged = CONTROLLED_SOURCE_EQUIPMENT_LABELS[importParams.sourceEquipment].isUnmanaged;

      importProvenance = {
        route: 'file_import',
        sourceEquipment: importParams.sourceEquipment,
        originalAppointmentDate: importParams.originalAppointmentDate,
        consentAttestationMeans: importParams.consentMeans,
        capturePartyCoverage: importParams.partyCoverage,
        isUnmanagedDevice: isUnmanaged,
        fileNameDiscarded: true,
      };
    }

    const record: ConsentRecord = {
      consentId,
      consentedAt,
      route,
      adviserId,
      confirmedByAdviser: true,
      importProvenance,
      originalAppointmentDate: importParams?.originalAppointmentDate,
      importConsentMeans: importParams?.consentMeans,
    };

    this.verifyZeroClientPii(record);

    return record;
  }

  /**
   * Asserts that the consent record contains strictly non-identifying operational metadata.
   */
  public verifyZeroClientPii(record: ConsentRecord): void {
    const serialized = JSON.stringify(record).toLowerCase();

    for (const forbiddenKey of ConsentManager.FORBIDDEN_CLIENT_PII_KEYS) {
      if (serialized.includes(`"${forbiddenKey}"`)) {
        throw new ConsentPrivacyViolationError(
          `[PRIVACY INVARIANT VIOLATION] Consent record contains forbidden client identifier key: '${forbiddenKey}'. Client PII belongs in Casebook, never in Case Ace.`
        );
      }
    }
  }

  /**
   * Withdraws consent with instant one-action destruction.
   */
  public withdrawConsent(route?: IntakeRoute, onWebexContinue?: () => void): void {
    destroySession({ reason: 'consent_withdrawal' }).catch((err) => {
      console.warn('[ConsentManager] destroySession error:', err);
    });

    if (route === 'webex_telephony' && onWebexContinue) {
      onWebexContinue();
    }
  }
}

export class ConsentPrivacyViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConsentPrivacyViolationError';
  }
}

export const consentManager = new ConsentManager();
