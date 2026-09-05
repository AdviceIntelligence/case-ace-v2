/**
 * VolatileSessionStore
 * 
 * Implements strict volatile-only in-memory storage for Case Ace v2.0 (Constraint C1).
 * All session data lives inside this store and nowhere else.
 * 
 * Enforces Non-Negotiable Constraints:
 * - C1: No client data is ever written to persistent storage (localStorage, sessionStorage, IndexedDB, Cache API, etc.).
 * - C2: Backend is stateless; zero persistent session storage on server.
 * - C3: Closing browser irrecoverably destroys session.
 * - C4: Raw audio never leaves device; only redacted audio transmitted after adviser review.
 * - C5: Only tokenised text sent to LLM. Token map exists solely in volatile RAM.
 * - C9: Client phone numbers and contact details live strictly in volatile memory.
 */

import type { ConsentRecord, ImportProvenance } from '../consent/consentManager.ts';
import type { SpeakerChannelMap } from '../audio/audioNormalizer.ts';

export type { SpeakerChannelMap };

export type SessionStage =
  | 'unauthenticated'
  | 'intake'
  | 'local_redaction'
  | 'redaction_review'
  | 'tokenisation'
  | 'prompt_review'
  | 'llm_draft'
  | 'detokenisation'
  | 'draft_review'
  | 'adviser_review'
  | 'signed_off';

export type IntakeType = 'live_microphone' | 'file_import';

export interface AsrWord {
  word: string;
  start: number; // in seconds
  end: number;   // in seconds
  confidence: number; // 0.0 to 1.0
  speaker: 'adviser' | 'client' | 'unknown';
  isLowConfidence: boolean; // true if confidence < 0.70
  escalateToAdviserReview: boolean;
}

export interface AsrSegment {
  id: string;
  start: number;
  end: number;
  speaker: 'adviser' | 'client' | 'unknown';
  text: string;
  words: AsrWord[];
  avgConfidence: number;
  hasLowConfidenceWords: boolean;
}

export interface TranscriptResult {
  segments: AsrSegment[];
  fullTranscript: string;
  words?: AsrWord[];
  totalWords: number;
  lowConfidenceWordsCount: number;
  lowConfidenceWords: AsrWord[];
  executionDurationMs: number;
  provider?: 'google_stt_v2';
  region?: string;
  dataLoggingEnabled?: false;
  chunkCount?: number;
  speakerAttribution?: 'per_chunk_unresolved';
}

export type LocalAsrResult = TranscriptResult;

export type IdentifierLayer = 1 | 2 | 3;

export type IdentifierCategory =
  // Layer 1: Structured UK Identifiers
  | 'national_insurance'
  | 'nhs_number'
  | 'uk_postcode'
  | 'phone_number'
  | 'email_address'
  | 'bank_sort_code'
  | 'bank_account_number'
  | 'benefit_reference'
  | 'passport_number'
  | 'home_office_reference'
  | 'court_case_number'
  | 'hmrc_reference'
  | 'date_of_birth'
  | 'street_address'
  // Layer 2: Unstructured Local NER
  | 'client_name'
  | 'third_party_name'
  | 'child_name'
  | 'partner_name'
  | 'ex_partner_name'
  | 'landlord_name'
  | 'employer_name'
  | 'support_worker_name'
  | 'official_name'
  | 'identifying_organisation'
  | 'identifying_school'
  | 'identifying_medical_practice'
  | 'identifying_hospital'
  | 'identifying_refuge'
  | 'identifying_location'
  | 'distinctive_occupation'
  // Layer 3: Contextual & Special Category Flags
  | 'special_category_health'
  | 'special_category_mental_health'
  | 'special_category_immigration'
  | 'special_category_criminal_justice'
  | 'special_category_domestic_abuse'
  | 'special_category_child_protection'
  | 'special_category_sexual_orientation'
  | 'special_category_religion'
  | 'special_category_ethnicity'
  | 'special_category_trade_union'
  | 'safeguarding_risk_to_life';

export type ProposedAction = 'redact' | 'flag_for_decision';
export type AdviserDecision = 'accepted' | 'rejected' | 'retained_substance' | 'pending';

export interface DecisionConsequences {
  retentionRisk: string;
  redactionImpact: string;
  recommendedDefault: 'tokenise_identifiers' | 'retain_clinical_substance' | 'redact_completely';
}

export interface DetectedIdentifier {
  id: string;
  text: string;
  normalizedText?: string;
  charOffset: {
    start: number;
    end: number;
  };
  audioTimeRange: {
    startSec: number;
    endSec: number;
  };
  category: IdentifierCategory;
  detectionLayer: IdentifierLayer;
  confidence: number;
  proposedAction: ProposedAction;
  adviserDecision: AdviserDecision;
  surrogateToken: string;
  decisionConsequences?: DecisionConsequences;
  speaker?: 'adviser' | 'client' | 'unknown';
}

export interface ExtractedEntity {
  id: string;
  category: string;
  originalText: string;
  surrogateToken: string;
  startOffset?: number;
  endOffset?: number;
  confidence?: number;
}

export interface RedactionReviewAudit {
  dwellTimeMs: number;
  lowConfidenceReviewedCount: number;
  manualAddedCount: number;
  manualRemovedCount: number;
  reviewedAt: string;
}

export interface SessionMetadata {
  consultationId: string;
  adviserId: string;
  intakeType: IntakeType;
  createdAt: number;
  updatedAt: number;
  audioDurationSeconds?: number;
  audioSampleRate?: number;
  importProvenance?: ImportProvenance;
  isSignedOff: boolean;
}

export interface SessionState {
  sessionId: string;
  stage: SessionStage;
  intakeType: IntakeType | null;
  clientPhoneNumber: string | null;
  consentRecord: ConsentRecord | null;
  importProvenance?: ImportProvenance | null;
  speakerMap: SpeakerChannelMap | null;
  rawAudioBuffer: ArrayBuffer | null;
  redactedAudioBuffer: ArrayBuffer | null;
  transcript: TranscriptResult | null;
  extractedEntities: ExtractedEntity[];
  detectedIdentifiers: DetectedIdentifier[];
  tokenMap: Record<string, string>; // surrogate_token -> original_pii
  tokenisedTranscript: string | null;
  draftCaseNote: string | null;
  signedCaseNote: string | null;
  metadata: SessionMetadata;
  // Phase 9 Redaction Review Gate State
  acknowledgedLowConfidenceIds: string[];
  gateOpenedTimestampMs: number | null;
  gateCompletedTimestampMs: number | null;
  isGatePassed: boolean;
  manualRedactions: DetectedIdentifier[];
  redactionReviewAudit: RedactionReviewAudit | null;
  // Phase 12 Tokenisation & Detokenisation State
  transcriptViewMode: 'tokenised' | 'detokenised';
  tokenisedWorkingTranscript: string | null;
  detokenisedWorkingTranscript: string | null;
  isTranscriptEdited: boolean;
  tokenIntegrityWarnings: string[];
  // Phase 13 Case Note Generation & Attribution State
  structuredCaseNote: StructuredCaseNote | null;
  tokenisedCaseNoteMarkdown: string | null;
  detokenisedCaseNoteMarkdown: string | null;
  caseNoteAttributions: CaseNoteAttribution[];
  caseNoteGaps: string[];
  caseNoteViewMode: 'tokenised' | 'detokenised';
  promptVersion: string | null;
  modelDetails: string | null;
  // Phase 14 Adviser Review & Sign-off State (Countering Automation Bias)
  acknowledgedGaps: string[];
  confirmedLowConfidenceAttributions: string[];
  safeguardingConfirmed: boolean;
  professionalDeclarationConfirmed: boolean;
  draftGeneratedTimestampMs: number | null;
  signedOffAt: number | null;
  draftToSignoffDurationMs: number | null;
  casebookFormattedNote: string | null;
  isSignedOff: boolean;
}

export interface CaseNoteAttribution {
  id: string;
  sectionName: string;
  fieldKey: string;
  statementText: string;
  segmentId: string;
  timestampRange: string;
  transcriptSnippet: string;
}

export interface StructuredCaseNote {
  presentingIssue: {
    clientExplained: string;
    relevantBackground: string;
    relevantDocuments: string;
    emergencyOrRisk: string;
    relatedIssues: string;
    discriminationIssue: string;
    safeguardingConcern: string;
  };
  clientGoals: {
    clientWouldLike: string;
    immediatePriority: string;
    outcomeAchievableDiscussion: string;
    agreedPurposeOfIntervention: string;
  };
  householdMakeUp: {
    client: string;
    partner: string;
    childrenDependants: string;
    otherHouseholdMembers: string;
    caringResponsibilities: string;
    relevantCircumstances: string;
    currentAccommodation: string;
  };
  incomeFinances: {
    employmentIncome: string;
    benefitsReceived: string;
    benefitsClaimedPending: string;
    benefitEntitlementConsidered: string;
    housingCosts: string;
    otherDebtsLiabilities: string;
    savingsCapital: string;
    immediateFinancialHardship: string;
    financialInfoRequired: string;
  };
  optionsDiscussed: {
    researchUndertaken: string;
    researchConfirmed: string;
    options: Array<{
      optionTitle: string;
      whatThisInvolves: string;
      eligibilityGrounds: string;
      advantages: string;
      disadvantages: string;
      risksConsequences: string;
      costs: string;
      likelyPracticalEffect: string;
      evidenceRequired: string;
      relevantDeadline: string;
    }>;
    clientPreferredOption: string;
    clientUnderstoodOptions: string;
    partialAdviceReason: string;
  };
  deadlinesKeyDates: {
    dates: string[];
    applicableTimeLimit: string;
    finalDateForAction: string;
    clientAdvisedOfDeadline: string;
    urgentActionRequired: string;
  };
  supportNeedsVulnerability: {
    clientCapability: string;
    vulnerabilitySupportNeeds: string;
    effectOnAbility: string;
    reasonableAdjustments: string;
    practicalAssistanceRequired: string;
    clientAccess: string;
    contactArrangements: string;
    conflictOfInterest: string;
    permissionToShare: string;
  };
  actionTaken: {
    actionsDuringIntervention: string[];
    outcomeOfActionTaken: string;
    documentsProducedSent: string;
    clientConfirmedUnderstanding: string;
  };
  nextStepsClient: {
    agreedActions: string[];
    obtain: string[];
    contact: string[];
    submit: string[];
    contingencyIfNoResponse: string;
    contingencyIfCircumstancesChange: string;
    seekAdviceBefore: string;
    invitedToReturn: string;
  };
  nextStepsAdviser: {
    adviserActions: string[];
    followUpContact: {
      date: string;
      time: string;
      channel: string;
      purpose: string;
    };
    contingencyIfNoDocReceived: string;
    outstandingIssuesNextContact: string;
  };
  onwardReferrals: {
    organisation: string;
    reason: string;
    method: string;
    contactDetailsProvided: string;
    urgencyCommunicated: string;
    consentObtained: string;
    assistedInfoProvided: string;
    clientUnderstands: string;
  };
  gapsAndLimitations: string[];
}

type SessionListener = (state: Readonly<SessionState> | null) => void;

export class VolatileSessionStore {
  private state: SessionState | null = null;
  private listeners: Set<SessionListener> = new Set();
  private recoverySnapshotHandler: ((state: Readonly<SessionState> | null) => void) | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      // Warn adviser before accidental navigation/reload if active uncopied notes exist
      window.addEventListener('beforeunload', (event) => {
        if (this.hasUnsavedData()) {
          event.preventDefault();
          event.returnValue = 'You have an active consultation note in volatile memory. If you leave or reload, all uncopied audio, transcripts, and notes will be permanently destroyed.';
          return event.returnValue;
        }
      });
    }
  }

  /**
   * Initializes a new volatile consultation session in RAM.
   */
  public initSession(
    intakeTypeOrOptions: IntakeType | { route?: string; adviserId?: string; clientId?: string; [key: string]: unknown } = 'live_microphone',
    adviserId: string = 'adviser'
  ): Readonly<SessionState> {
    // If an existing session is open, clean up previous buffers first
    if (this.state) {
      this.destroySession();
    }

    const sessionId = crypto.randomUUID();
    const now = Date.now();

    let resolvedIntakeType: IntakeType = 'live_microphone';
    let resolvedAdviserId = adviserId;

    if (typeof intakeTypeOrOptions === 'string') {
      resolvedIntakeType = intakeTypeOrOptions;
    } else if (intakeTypeOrOptions && typeof intakeTypeOrOptions === 'object') {
      if (intakeTypeOrOptions.route === 'in_person' || intakeTypeOrOptions.route === 'live_in_person' || intakeTypeOrOptions.route === 'live_microphone') {
        resolvedIntakeType = 'live_microphone';
      } else {
        resolvedIntakeType = 'file_import';
      }
      if (intakeTypeOrOptions.adviserId && typeof intakeTypeOrOptions.adviserId === 'string') {
        resolvedAdviserId = intakeTypeOrOptions.adviserId;
      }
    }

    this.state = {
      sessionId,
      stage: 'intake',
      intakeType: resolvedIntakeType,
      clientPhoneNumber: null,
      consentRecord: null,
      speakerMap: null,
      rawAudioBuffer: null,
      redactedAudioBuffer: null,
      transcript: null,
      extractedEntities: [],
      detectedIdentifiers: [],
      tokenMap: {},
      tokenisedTranscript: null,
      draftCaseNote: null,
      signedCaseNote: null,
      metadata: {
        consultationId: sessionId,
        adviserId: resolvedAdviserId,
        intakeType: resolvedIntakeType,
        createdAt: now,
        updatedAt: now,
        isSignedOff: false,
      },
      acknowledgedLowConfidenceIds: [],
      gateOpenedTimestampMs: null,
      gateCompletedTimestampMs: null,
      isGatePassed: false,
      manualRedactions: [],
      redactionReviewAudit: null,
      // Phase 12 defaults (Defaults to detokenised for factual checking)
      transcriptViewMode: 'detokenised',
      tokenisedWorkingTranscript: null,
      detokenisedWorkingTranscript: null,
      isTranscriptEdited: false,
      tokenIntegrityWarnings: [],
      // Phase 13 defaults
      structuredCaseNote: null,
      tokenisedCaseNoteMarkdown: null,
      detokenisedCaseNoteMarkdown: null,
      caseNoteAttributions: [],
      caseNoteGaps: [],
      caseNoteViewMode: 'detokenised',
      promptVersion: null,
      modelDetails: null,
      // Phase 14 defaults (strictly no pre-ticking, zero cross-session memory)
      acknowledgedGaps: [],
      confirmedLowConfidenceAttributions: [],
      safeguardingConfirmed: false,
      professionalDeclarationConfirmed: false,
      draftGeneratedTimestampMs: null,
      signedOffAt: null,
      draftToSignoffDurationMs: null,
      casebookFormattedNote: null,
      isSignedOff: false,
    };

    this.notify();
    return this.state;
  }

  public getState(): Readonly<SessionState> | null {
    return this.state;
  }

  public hasActiveSession(): boolean {
    return this.state !== null;
  }

  public hasUnsavedData(): boolean {
    if (!this.state) return false;
    // Unsaved data exists if audio is loaded or notes exist but haven't been signed and copied
    return (
      this.state.rawAudioBuffer !== null ||
      this.state.redactedAudioBuffer !== null ||
      (this.state.draftCaseNote !== null && this.state.signedCaseNote === null)
    );
  }

  public setClientPhoneNumber(phoneNumber: string | null): void {
    if (!this.state) throw new Error('Cannot set phone number on uninitialised session.');
    this.state.clientPhoneNumber = phoneNumber;
    this.state.metadata.updatedAt = Date.now();
    this.notify();
  }

  public setStage(stage: SessionStage): void {
    if (!this.state) throw new Error('Cannot transition stage on uninitialised session.');
    this.state.stage = stage;
    this.state.metadata.updatedAt = Date.now();
    this.notify();
  }

  public getConsentRecord(): Readonly<ConsentRecord> | null {
    return this.state?.consentRecord ?? null;
  }

  public setConsentRecord(record: ConsentRecord): void {
    if (!this.state) throw new Error('Cannot set consent record on uninitialised session.');
    this.state.consentRecord = record;
    if (record.importProvenance) {
      this.state.importProvenance = record.importProvenance;
      this.state.metadata.importProvenance = record.importProvenance;
    }
    this.state.metadata.updatedAt = Date.now();
    this.notify();
  }

  public setImportProvenance(provenance: ImportProvenance): void {
    if (!this.state) throw new Error('Cannot set import provenance on uninitialised session.');
    this.state.importProvenance = provenance;
    this.state.metadata.importProvenance = provenance;
    this.state.metadata.updatedAt = Date.now();
    this.notify();
  }

  public getSpeakerMap(): Readonly<SpeakerChannelMap> | null {
    return this.state?.speakerMap ?? null;
  }

  public setSpeakerMap(speakerMap: SpeakerChannelMap): void {
    if (!this.state) throw new Error('Cannot set speaker map on uninitialised session.');
    this.state.speakerMap = speakerMap;
    this.state.metadata.updatedAt = Date.now();
    this.notify();
  }

  // --- Audio Buffer Accessors and Memory Hygiene ---

  public getRawAudio(): ArrayBuffer | null {
    return this.state?.rawAudioBuffer ?? null;
  }

  public setRawAudio(buffer: ArrayBuffer, durationSeconds?: number, sampleRate?: number): void {
    if (!this.state) throw new Error('Cannot store raw audio on uninitialised session.');
    this.state.rawAudioBuffer = buffer;
    if (durationSeconds) this.state.metadata.audioDurationSeconds = durationSeconds;
    if (sampleRate) this.state.metadata.audioSampleRate = sampleRate;
    this.state.metadata.updatedAt = Date.now();
    this.notify();
  }

  public setRawAudioBuffer(buffer: ArrayBuffer, sampleRate?: number, durationSeconds?: number): void {
    this.setRawAudio(buffer, durationSeconds, sampleRate);
  }

  /**
   * Release and zero raw audio buffer as soon as local redaction has extracted what it needs.
   */
  public releaseRawAudio(): void {
    if (this.state && this.state.rawAudioBuffer) {
      try {
        new Uint8Array(this.state.rawAudioBuffer).fill(0);
      } catch {}
      this.state.rawAudioBuffer = null;
      this.state.metadata.updatedAt = Date.now();
      this.notify();
    }
  }

  public getRedactedAudio(): ArrayBuffer | null {
    return this.state?.redactedAudioBuffer ?? null;
  }

  public setRedactedAudio(buffer: ArrayBuffer): void {
    if (!this.state) throw new Error('Cannot store redacted audio on uninitialised session.');
    this.state.redactedAudioBuffer = buffer;
    this.state.metadata.updatedAt = Date.now();
    this.notify();
  }

  public setRedactedAudioBuffer(buffer: ArrayBuffer): void {
    this.setRedactedAudio(buffer);
  }

  /**
   * Release and zero redacted audio buffer once Cloud Speech-to-Text v2 transmission completes.
   */
  public releaseRedactedAudio(): void {
    if (this.state && this.state.redactedAudioBuffer) {
      try {
        new Uint8Array(this.state.redactedAudioBuffer).fill(0);
      } catch {}
      this.state.redactedAudioBuffer = null;
      this.state.metadata.updatedAt = Date.now();
      this.notify();
    }
  }

  // --- Transcript Accessors and Memory Hygiene ---

  // --- Transcript and Entity Accessors ---

  public getTranscript(): Readonly<TranscriptResult> | null {
    return this.state?.transcript ?? null;
  }

  public getLocalAsrResult(): Readonly<LocalAsrResult> | null {
    return this.getTranscript();
  }

  public setTranscript(resultOrText: TranscriptResult | string): void {
    if (!this.state) throw new Error('Cannot store transcript on uninitialised session.');
    if (typeof resultOrText === 'string') {
      this.state.transcript = {
        fullTranscript: resultOrText,
        segments: [],
        words: [],
        totalWords: resultOrText.trim() ? resultOrText.trim().split(/\s+/).length : 0,
        lowConfidenceWordsCount: 0,
        lowConfidenceWords: [],
        executionDurationMs: 0,
        provider: 'google_stt_v2',
        region: 'europe-west2',
        dataLoggingEnabled: false,
      };
    } else {
      this.state.transcript = { ...resultOrText };
    }
    this.state.metadata.updatedAt = Date.now();
    this.notify();
  }

  public setLocalAsrResult(result: LocalAsrResult | string): void {
    this.setTranscript(result as any);
  }

  public setLocalDraftTranscript(transcript: string): void {
    this.setTranscript(transcript);
  }

  public clearTranscript(): void {
    if (this.state) {
      this.state.transcript = null;
      this.state.metadata.updatedAt = Date.now();
      this.notify();
    }
  }

  public clearLocalAsr(): void {
    this.clearTranscript();
  }

  public getTokenisedTranscript(): string | null {
    return this.state?.tokenisedTranscript ?? null;
  }

  public setDetectedIdentifiers(identifiers: DetectedIdentifier[]): void {
    if (!this.state) throw new Error('Cannot set detected identifiers on uninitialised session.');
    this.state.detectedIdentifiers = [...identifiers];
    this.state.metadata.updatedAt = Date.now();
    this.notify();
  }

  public getDetectedIdentifiers(): DetectedIdentifier[] {
    return this.state ? [...this.state.detectedIdentifiers] : [];
  }

  public updateIdentifierDecision(id: string, decision: AdviserDecision): void {
    if (!this.state) throw new Error('Cannot update identifier decision on uninitialised session.');
    const target = this.state.detectedIdentifiers.find((item) => item.id === id);
    if (target) {
      target.adviserDecision = decision;
      this.state.metadata.updatedAt = Date.now();
      this.notify();
    }
  }

  public setEntitiesAndTokenMap(entities: ExtractedEntity[], tokenMap: Record<string, string>): void {
    if (!this.state) throw new Error('Cannot set entities and token map on uninitialised session.');
    this.state.extractedEntities = [...entities];
    this.state.tokenMap = { ...tokenMap };
    this.state.metadata.updatedAt = Date.now();
    this.notify();
  }

  public setTokenMap(tokenMap: Record<string, string>): void {
    if (!this.state) throw new Error('Cannot set token map on uninitialised session.');
    this.state.tokenMap = { ...tokenMap };
    this.state.metadata.updatedAt = Date.now();
    this.notify();
  }

  public setTokenisedTranscript(transcript: string): void {
    if (!this.state) throw new Error('Cannot set tokenised transcript on uninitialised session.');
    this.state.tokenisedTranscript = transcript;
    this.state.metadata.updatedAt = Date.now();
    this.notify();
  }

  public setDraftCaseNote(note: string): void {
    if (!this.state) throw new Error('Cannot set draft note on uninitialised session.');
    this.state.draftCaseNote = note;
    this.state.metadata.updatedAt = Date.now();
    this.notify();
  }

  public setSignedCaseNote(note: string): void {
    if (!this.state) throw new Error('Cannot set signed note on uninitialised session.');
    this.state.signedCaseNote = note;
    this.state.stage = 'signed_off';
    this.state.metadata.isSignedOff = true;
    this.state.metadata.updatedAt = Date.now();
    this.notify();
  }

  public updateState(partial: Partial<SessionState>): void {
    if (!this.state) throw new Error('Cannot update uninitialised volatile session.');
    this.state = {
      ...this.state,
      ...partial,
      metadata: {
        ...this.state.metadata,
        updatedAt: Date.now(),
      },
    };
    this.notify();
  }

  /**
   * Restores a state snapshot from SessionRecoveryWorker after an accidental page reload.
   */
  public restoreFromSnapshot(snapshot: SessionState): void {
    this.state = {
      ...snapshot,
      metadata: {
        ...snapshot.metadata,
        updatedAt: Date.now(),
      },
    };
    this.notify();
  }

  /**
   * Permanently wipes all in-memory consultation session data.
   * Overwrites ArrayBuffers with zeros before releasing references.
   */
  public destroySession(): void {
    if (this.state) {
      if (this.state.rawAudioBuffer) {
        try {
          new Uint8Array(this.state.rawAudioBuffer).fill(0);
        } catch {}
      }
      if (this.state.redactedAudioBuffer) {
        try {
          new Uint8Array(this.state.redactedAudioBuffer).fill(0);
        } catch {}
      }

      this.state.clientPhoneNumber = null;
      this.state.transcript = null;
      this.state.extractedEntities = [];
      this.state.detectedIdentifiers = [];
      this.state.tokenMap = {};
      this.state.tokenisedTranscript = null;
      this.state.draftCaseNote = null;
      this.state.signedCaseNote = null;
      this.state.consentRecord = null;
      this.state.speakerMap = null;
      this.state.rawAudioBuffer = null;
      this.state.redactedAudioBuffer = null;
      this.state.acknowledgedLowConfidenceIds = [];
      this.state.gateOpenedTimestampMs = null;
      this.state.gateCompletedTimestampMs = null;
      this.state.isGatePassed = false;
      this.state.manualRedactions = [];
      this.state.redactionReviewAudit = null;
      this.state.tokenisedWorkingTranscript = null;
      this.state.detokenisedWorkingTranscript = null;
      this.state.tokenIntegrityWarnings = [];
      this.state.structuredCaseNote = null;
      this.state.tokenisedCaseNoteMarkdown = null;
      this.state.detokenisedCaseNoteMarkdown = null;
      this.state.caseNoteAttributions = [];
      this.state.caseNoteGaps = [];
      this.state.acknowledgedGaps = [];
      this.state.confirmedLowConfidenceAttributions = [];
      this.state.safeguardingConfirmed = false;
      this.state.professionalDeclarationConfirmed = false;
      this.state.draftGeneratedTimestampMs = null;
      this.state.signedOffAt = null;
      this.state.draftToSignoffDurationMs = null;
      this.state.casebookFormattedNote = null;
      this.state.isSignedOff = false;

      this.state = null;
      this.notify();
    }
  }

  /**
   * Opens the Phase 9 Redaction Review Gate and starts the active dwell timer.
   */
  public openRedactionGate(): void {
    if (!this.state) throw new Error('Cannot open gate on uninitialised session.');
    this.state.stage = 'redaction_review';
    if (!this.state.gateOpenedTimestampMs) {
      this.state.gateOpenedTimestampMs = Date.now();
    }
    this.state.metadata.updatedAt = Date.now();
    this.notify();
  }

  /**
   * Acknowledges an individual low-confidence ASR word or identifier region.
   */
  public acknowledgeLowConfidence(id: string): void {
    if (!this.state) throw new Error('Cannot acknowledge low confidence on uninitialised session.');
    if (!this.state.acknowledgedLowConfidenceIds.includes(id)) {
      this.state.acknowledgedLowConfidenceIds = [...this.state.acknowledgedLowConfidenceIds, id];
      this.state.metadata.updatedAt = Date.now();
      this.notify();
    }
  }

  /**
   * Unacknowledges a low-confidence item (if adviser wishes to re-examine).
   */
  public unacknowledgeLowConfidence(id: string): void {
    if (!this.state) throw new Error('Cannot unacknowledge on uninitialised session.');
    this.state.acknowledgedLowConfidenceIds = this.state.acknowledgedLowConfidenceIds.filter((x) => x !== id);
    this.state.metadata.updatedAt = Date.now();
    this.notify();
  }

  /**
   * Adds a manual redaction specified by text selection or audio time range.
   */
  public addManualRedaction(redaction: DetectedIdentifier): void {
    if (!this.state) throw new Error('Cannot add manual redaction on uninitialised session.');
    this.state.manualRedactions = [...this.state.manualRedactions, redaction];
    this.state.detectedIdentifiers = [...this.state.detectedIdentifiers, redaction];
    // Add to token map
    this.state.tokenMap[redaction.surrogateToken] = redaction.text;
    this.state.metadata.updatedAt = Date.now();
    this.notify();
  }

  /**
   * Removes a proposed redaction (un-redact) after adviser confirms plaintext transmission.
   */
  public removeRedaction(identifierId: string): void {
    if (!this.state) throw new Error('Cannot remove redaction on uninitialised session.');
    const target = this.state.detectedIdentifiers.find((d) => d.id === identifierId);
    if (target) {
      target.adviserDecision = 'rejected';
      // Remove from active surrogate token map so it is not replaced
      delete this.state.tokenMap[target.surrogateToken];
      this.state.metadata.updatedAt = Date.now();
      this.notify();
    }
  }

  /**
   * Calculates the active dwell time spent at the gate in milliseconds.
   */
  public getGateDwellTimeMs(): number {
    if (!this.state || !this.state.gateOpenedTimestampMs) return 0;
    const end = this.state.gateCompletedTimestampMs || Date.now();
    return Math.max(0, end - this.state.gateOpenedTimestampMs);
  }

  /**
   * Returns the count of pending low-confidence items awaiting individual review.
   */
  public getPendingLowConfidenceCount(): number {
    if (!this.state) return 0;
    const lowConfWords = this.state.transcript?.lowConfidenceWords || [];
    const lowConfIdentifiers = this.state.detectedIdentifiers.filter((d) => d.confidence < 0.70);
    
    // Total count of unique low confidence tokens
    const totalCount = Math.max(lowConfWords.length, lowConfIdentifiers.length);
    const ackedCount = this.state.acknowledgedLowConfidenceIds.length;
    return Math.max(0, totalCount - ackedCount);
  }

  /**
   * Evaluates if the gate is complete and ready to unlock.
   * Invariant: pending low confidence count must be 0.
   */
  public isGateComplete(): boolean {
    if (!this.state) return false;
    return this.getPendingLowConfidenceCount() === 0;
  }

  /**
   * Unlocks the redaction gate affirmatively.
   * Throws if unacknowledged low confidence items remain.
   */
  public unlockGate(): boolean {
    if (!this.state) throw new Error('Cannot unlock gate on uninitialised session.');
    if (!this.isGateComplete()) {
      throw new Error(`Cannot pass Redaction Review Gate: ${this.getPendingLowConfidenceCount()} low-confidence region(s) must be individually acknowledged.`);
    }

    const now = Date.now();
    this.state.gateCompletedTimestampMs = now;
    this.state.isGatePassed = true;
    this.state.stage = 'tokenisation';
    const dwellTimeMs = this.getGateDwellTimeMs();

    this.state.redactionReviewAudit = {
      dwellTimeMs,
      lowConfidenceReviewedCount: this.state.acknowledgedLowConfidenceIds.length,
      manualAddedCount: this.state.manualRedactions.length,
      manualRemovedCount: this.state.detectedIdentifiers.filter((d) => d.adviserDecision === 'rejected').length,
      reviewedAt: new Date(now).toISOString(),
    };

    this.state.metadata.updatedAt = now;
    this.notify();
    return true;
  }

  // --- Phase 12: Working Transcripts & Tokenisation Controls ---

  public setWorkingTranscripts(
    tokenised: string,
    detokenised: string,
    tokenMap: Record<string, string>
  ): void {
    if (!this.state) throw new Error('Cannot set working transcripts on uninitialised session.');
    this.state.tokenisedWorkingTranscript = tokenised;
    this.state.detokenisedWorkingTranscript = detokenised;
    this.state.tokenisedTranscript = tokenised;
    this.state.tokenMap = { ...tokenMap };
    this.state.metadata.updatedAt = Date.now();
    this.notify();
  }

  public updateWorkingTranscript(
    newText: string,
    mode: 'tokenised' | 'detokenised',
    counterpartText?: string,
    warnings: string[] = []
  ): void {
    if (!this.state) throw new Error('Cannot update transcript on uninitialised session.');
    this.state.isTranscriptEdited = true;
    this.state.tokenIntegrityWarnings = warnings;

    if (mode === 'tokenised') {
      this.state.tokenisedWorkingTranscript = newText;
      this.state.tokenisedTranscript = newText;
      if (counterpartText !== undefined) {
        this.state.detokenisedWorkingTranscript = counterpartText;
      }
    } else {
      this.state.detokenisedWorkingTranscript = newText;
      if (counterpartText !== undefined) {
        this.state.tokenisedWorkingTranscript = counterpartText;
        this.state.tokenisedTranscript = counterpartText;
      }
    }

    this.state.metadata.updatedAt = Date.now();
    this.notify();
  }

  public setTranscriptViewMode(mode: 'tokenised' | 'detokenised'): void {
    if (!this.state) throw new Error('Cannot set transcript view mode on uninitialised session.');
    this.state.transcriptViewMode = mode;
    this.state.metadata.updatedAt = Date.now();
    this.notify();
  }

  public setCaseNoteViewMode(mode: 'tokenised' | 'detokenised'): void {
    if (!this.state) throw new Error('Cannot set case note view mode on uninitialised session.');
    this.state.caseNoteViewMode = mode;
    this.state.metadata.updatedAt = Date.now();
    this.notify();
  }

  // --- Phase 13: Canonical Master Template Case Note Controls ---

  public setGeneratedCaseNote(
    structuredNote: StructuredCaseNote,
    tokenisedMarkdown: string,
    detokenisedMarkdown?: string,
    attributions: CaseNoteAttribution[] = [],
    gaps: string[] = [],
    promptVersion: string = 'v2.4.0',
    modelDetails: any = 'gemini-1.5-pro (europe-west2)'
  ): void {
    if (!this.state) throw new Error('Cannot store generated case note on uninitialised session.');
    this.state.structuredCaseNote = structuredNote;
    this.state.tokenisedCaseNoteMarkdown = tokenisedMarkdown;
    this.state.detokenisedCaseNoteMarkdown = detokenisedMarkdown || (typeof tokenisedMarkdown === 'string' ? tokenisedMarkdown : '');
    this.state.draftCaseNote = this.state.detokenisedCaseNoteMarkdown;
    this.state.caseNoteAttributions = attributions;
    this.state.caseNoteGaps = gaps;
    this.state.promptVersion = promptVersion;
    this.state.modelDetails = typeof modelDetails === 'object' ? JSON.stringify(modelDetails) : String(modelDetails);
    this.state.caseNoteViewMode = 'detokenised';
    this.state.stage = 'draft_review';
    this.state.draftGeneratedTimestampMs = Date.now();
    this.state.acknowledgedGaps = [];
    this.state.confirmedLowConfidenceAttributions = [];
    this.state.safeguardingConfirmed = false;
    this.state.professionalDeclarationConfirmed = false;
    this.state.signedOffAt = null;
    this.state.draftToSignoffDurationMs = null;
    this.state.casebookFormattedNote = null;
    this.state.isSignedOff = false;
    this.state.metadata.updatedAt = Date.now();
    this.notify();
  }

  public updateCaseNoteMarkdown(markdown: string): void {
    if (!this.state) throw new Error('Cannot update case note markdown on uninitialised session.');
    this.state.draftCaseNote = markdown;
    this.state.metadata.updatedAt = Date.now();
    this.notify();
  }

  // --- Phase 14: Anti-Automation Bias Review & Sign-off Controls ---

  public toggleGapAcknowledgement(gapText: string, acknowledged: boolean): void {
    if (!this.state) throw new Error('Cannot acknowledge gap on uninitialised session.');
    const current = new Set(this.state.acknowledgedGaps || []);
    if (acknowledged) {
      current.add(gapText);
    } else {
      current.delete(gapText);
    }
    this.state.acknowledgedGaps = Array.from(current);
    this.state.metadata.updatedAt = Date.now();
    this.notify();
  }

  public toggleLowConfidenceConfirmation(attributionId: string, confirmed: boolean): void {
    if (!this.state) throw new Error('Cannot confirm low confidence statement on uninitialised session.');
    const current = new Set(this.state.confirmedLowConfidenceAttributions || []);
    if (confirmed) {
      current.add(attributionId);
    } else {
      current.delete(attributionId);
    }
    this.state.confirmedLowConfidenceAttributions = Array.from(current);
    this.state.metadata.updatedAt = Date.now();
    this.notify();
  }

  public setSafeguardingConfirmation(confirmed: boolean): void {
    if (!this.state) throw new Error('Cannot set safeguarding confirmation on uninitialised session.');
    this.state.safeguardingConfirmed = confirmed;
    this.state.metadata.updatedAt = Date.now();
    this.notify();
  }

  public setProfessionalDeclaration(confirmed: boolean): void {
    if (!this.state) throw new Error('Cannot set professional declaration on uninitialised session.');
    this.state.professionalDeclarationConfirmed = confirmed;
    this.state.metadata.updatedAt = Date.now();
    this.notify();
  }

  public completeSignoff(
    signedNoteText: string,
    casebookFormattedNote: string,
    durationMs?: number
  ): void {
    if (!this.state) throw new Error('Cannot complete sign-off on uninitialised session.');
    const now = Date.now();
    const calculatedDuration = durationMs ?? (this.state.draftGeneratedTimestampMs ? now - this.state.draftGeneratedTimestampMs : 0);

    this.state.signedCaseNote = signedNoteText;
    this.state.casebookFormattedNote = casebookFormattedNote;
    this.state.isSignedOff = true;
    this.state.signedOffAt = now;
    this.state.draftToSignoffDurationMs = calculatedDuration;
    this.state.stage = 'signed_off';
    this.state.metadata.isSignedOff = true;
    this.state.metadata.updatedAt = now;
    this.notify();
  }

  public setRecoverySnapshotHandler(handler: ((state: Readonly<SessionState> | null) => void) | null): void {
    this.recoverySnapshotHandler = handler;
  }

  public subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const currentState = this.state ? { ...this.state } : null;
    this.listeners.forEach((listener) => {
      try {
        listener(currentState);
      } catch (err) {
        console.error('[VolatileSessionStore] Listener error:', err);
      }
    });

    if (this.recoverySnapshotHandler) {
      try {
        this.recoverySnapshotHandler(currentState);
      } catch (err) {
        console.error('[VolatileSessionStore] Recovery snapshot sync error:', err);
      }
    }
  }
}

export const volatileSessionStore = new VolatileSessionStore();
