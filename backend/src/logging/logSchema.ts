/**
 * Case Ace v2.0 - Monitoring and Audit Log Strict Schema Enforcer (Phase 16)
 * 
 * Strict Invariants:
 * 1. Whitelist-only schema: Rejects ANY field not explicitly permitted.
 * 2. Zero Free Text: No open text fields anywhere in the schema.
 * 3. Deep PII / Client Data / Filename / Phone Number Rejection.
 * 4. Rejection rather than truncation (fails hard on violation).
 */

export const PERMITTED_EVENT_TYPES = new Set([
  'SESSION_INITIALISED',
  'CONSENT_GIVEN',
  'CONSENT_WITHDRAWN',
  'SESSION_ABANDONED',
  'SESSION_ENDED',
  'AUDIO_RECORDING_STARTED',
  'AUDIO_RECORDING_STOPPED',
  'FILE_IMPORTED',
  'WEBEX_CALL_EVENT',
  'PASS1_LOCAL_ASR_COMPLETED',
  'IDENTIFIERS_DETECTED',
  'REDACTION_GATE_ENTERED',
  'REDACTION_GATE_COMPLETED',
  'ACOUSTIC_VERIFICATION_COMPLETED',
  'CLOUD_STT_REQUESTED',
  'CLOUD_STT_COMPLETED',
  'CLOUD_STT_FALLBACK',
  'TOKENISATION_COMPLETED',
  'CASE_NOTE_DRAFT_REQUESTED',
  'CASE_NOTE_DRAFT_COMPLETED',
  'ADVISER_SIGNOFF_COMPLETED',
  'CASEBOOK_EXPORT_COPIED',
  'CREDENTIALS_REQUESTED',
  'CREDENTIALS_REVOKED',
  'LOGS_ACCESSED',
  'ERROR_OCCURRED',
]);

export const PERMITTED_ROLES = new Set([
  'adviser',
  'supervisor',
  'auditor',
  'administrator',
]);

export const PERMITTED_INTAKE_ROUTES = new Set([
  'live_in_person',
  'webex_telephony',
  'file_import',
]);

export const PERMITTED_SOURCE_EQUIPMENTS = new Set([
  'adviser_workstation',
  'caw_recording_device',
  'supervisor_approved_hardware',
]);

export const PERMITTED_STAGES = new Set([
  'IDLE',
  'idle',
  'consent_gate',
  'recording',
  'pass1_local_asr',
  'identifier_detection',
  'redaction_review',
  'acoustic_verification',
  'cloud_stt',
  'tokenisation',
  'casenote_drafting',
  'adviser_signoff',
  'export_completed',
  'session_destroyed',
]);

export const PERMITTED_CONSENT_STATUSES = new Set([
  'given',
  'withdrawn',
  'abandoned',
]);

export const PERMITTED_ERROR_CODES = new Set([
  'ERR_NONE',
  'ERR_MIC_DENIED',
  'ERR_WEBEX_STREAM_FAILED',
  'ERR_DECODE_FAILED',
  'ERR_LOCAL_ASR_FAILED',
  'ERR_CLOUD_STT_UNAVAILABLE',
  'ERR_CLOUD_STT_TIMEOUT',
  'ERR_TOKEN_INTEGRITY',
  'ERR_LLM_TIMEOUT',
  'ERR_LLM_RATE_LIMIT',
  'ERR_UNAUTHORIZED',
  'ERR_FORBIDDEN',
  'ERR_MEMORY_PRESSURE',
  'ERR_UNKNOWN',
]);

// Set of exact allowed top-level keys in a LogEvent
export const PERMITTED_ROOT_KEYS = new Set([
  'eventType',
  'timestamp',
  'pseudonymousUserId',
  'role',
  'pseudonymousSessionId',
  'intakeRoute',
  'stageReached',
  'stageDurationMs',
  'totalSessionDurationMs',
  'audioDurationSeconds',
  'wordCounts',
  'detectedIdentifierCounts',
  'reviewGateModifications',
  'reviewGateDwellTimeMs',
  'verificationPassResult',
  'modelAndPromptVersions',
  'apiLatencyMs',
  'apiStatusCode',
  'errorCode',
  'errorType',
  'byteCounts',
  'gapsAcknowledgedCount',
  'draftToSignoffDurationMs',
  'consentStatus',
  // Webex specific
  'pseudonymousCallReference',
  'callDurationSeconds',
  'callEventCounts',
  // File Import specific
  'sourceEquipmentCategory',
  'importedRecordingDurationSeconds',
]);

export interface ValidatedLogPayload {
  eventType: string;
  timestamp: string;
  pseudonymousUserId?: string;
  role?: string;
  pseudonymousSessionId?: string;
  intakeRoute?: string;
  stageReached?: string;
  stageDurationMs?: number;
  totalSessionDurationMs?: number;
  audioDurationSeconds?: number;
  wordCounts?: { transcriptWords: number; noteWords: number };
  detectedIdentifierCounts?: Record<string, number>;
  reviewGateModifications?: { addedCount: number; removedCount: number };
  reviewGateDwellTimeMs?: number;
  verificationPassResult?: boolean;
  modelAndPromptVersions?: { modelVersion: string; promptVersion: string };
  apiLatencyMs?: number;
  apiStatusCode?: number;
  errorCode?: string;
  errorType?: string;
  byteCounts?: number;
  gapsAcknowledgedCount?: number;
  draftToSignoffDurationMs?: number;
  consentStatus?: string;
  pseudonymousCallReference?: string;
  callDurationSeconds?: number;
  callEventCounts?: { joinCount: number; muteCount: number; holdCount: number; dropCount: number };
  sourceEquipmentCategory?: string;
  importedRecordingDurationSeconds?: number;
}

export class LogSchemaValidationError extends Error {
  public fieldName?: string;
  constructor(message: string, fieldName?: string) {
    super(`[LOG_SCHEMA_REJECTION] ${message}`);
    this.name = 'LogSchemaValidationError';
    this.fieldName = fieldName;
  }
}

// Regex patterns to detect forbidden client identifiers, telephone numbers, and filenames in any value
const PHONE_PATTERN = /(?:(?:\+44\s?|0)(?:7\d{3}|1\d{2,3}|2\d|3\d)\s?\d{3,4}\s?\d{3,4}|\b07\d{9}\b)/;
const FILENAME_PATTERN = /\.(?:wav|mp3|m4a|aac|ogg|flac|mp4|mov|avi|mkv|csv|json|txt|docx|pdf)\b/i;
const PATH_PATTERN = /(?:\/|[A-Z]:\\)[\w\-./\\]+/i;
const NINO_PATTERN = /[A-CEGHJ-PR-TW-Z]{1}[A-CEGHJ-NPR-TW-Z]{1}\s?[0-9]{2}\s?[0-9]{2}\s?[0-9]{2}\s?[A-D]{1}/i;
const POSTCODE_PATTERN = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;

/**
 * Validates a log entry against the strict whitelist schema.
 * Rejects rather than truncates any non-permitted field, free text, or PII leak.
 */
export function validateLogPayload(payload: unknown): ValidatedLogPayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new LogSchemaValidationError('Log payload must be a non-null JSON object.');
  }

  const obj = payload as Record<string, unknown>;

  // 1. Check for unauthorized extra fields
  for (const key of Object.keys(obj)) {
    if (!PERMITTED_ROOT_KEYS.has(key)) {
      throw new LogSchemaValidationError(`Field '${key}' is not on the permitted log whitelist and is rejected.`, key);
    }
  }

  // 2. Validate mandatory eventType
  if (typeof obj.eventType !== 'string' || !PERMITTED_EVENT_TYPES.has(obj.eventType)) {
    throw new LogSchemaValidationError(`Invalid or forbidden eventType: '${obj.eventType}'`, 'eventType');
  }

  // 3. Validate timestamp
  if (typeof obj.timestamp !== 'string' || isNaN(Date.parse(obj.timestamp))) {
    throw new LogSchemaValidationError(`Invalid timestamp format: '${obj.timestamp}'`, 'timestamp');
  }

  // 4. Validate pseudonymous IDs (must start with controlled prefix and contain no PII/phone/filenames)
  if (obj.pseudonymousUserId !== undefined) {
    if (typeof obj.pseudonymousUserId !== 'string' || !/^[a-zA-Z0-9_\-]+$/.test(obj.pseudonymousUserId) || obj.pseudonymousUserId.length > 64) {
      throw new LogSchemaValidationError('pseudonymousUserId must be a clean alphanumeric token under 64 chars.', 'pseudonymousUserId');
    }
    assertNoPiiLeak(obj.pseudonymousUserId, 'pseudonymousUserId');
  }

  if (obj.pseudonymousSessionId !== undefined) {
    if (typeof obj.pseudonymousSessionId !== 'string' || !/^[a-zA-Z0-9_\-]+$/.test(obj.pseudonymousSessionId) || obj.pseudonymousSessionId.length > 64) {
      throw new LogSchemaValidationError('pseudonymousSessionId must be a clean alphanumeric token under 64 chars.', 'pseudonymousSessionId');
    }
    assertNoPiiLeak(obj.pseudonymousSessionId, 'pseudonymousSessionId');
  }

  if (obj.pseudonymousCallReference !== undefined) {
    if (typeof obj.pseudonymousCallReference !== 'string' || !/^[a-zA-Z0-9_\-]+$/.test(obj.pseudonymousCallReference) || obj.pseudonymousCallReference.length > 64) {
      throw new LogSchemaValidationError('pseudonymousCallReference must be a clean alphanumeric token under 64 chars.', 'pseudonymousCallReference');
    }
    assertNoPiiLeak(obj.pseudonymousCallReference, 'pseudonymousCallReference');
  }

  // 5. Validate Enums
  if (obj.role !== undefined) {
    if (typeof obj.role !== 'string' || !PERMITTED_ROLES.has(obj.role)) {
      throw new LogSchemaValidationError(`Invalid role: '${obj.role}'`, 'role');
    }
  }

  if (obj.intakeRoute !== undefined) {
    if (typeof obj.intakeRoute !== 'string' || !PERMITTED_INTAKE_ROUTES.has(obj.intakeRoute)) {
      throw new LogSchemaValidationError(`Invalid intakeRoute: '${obj.intakeRoute}'`, 'intakeRoute');
    }
  }

  if (obj.stageReached !== undefined) {
    if (typeof obj.stageReached !== 'string' || !PERMITTED_STAGES.has(obj.stageReached)) {
      throw new LogSchemaValidationError(`Invalid stageReached: '${obj.stageReached}'`, 'stageReached');
    }
  }

  if (obj.consentStatus !== undefined) {
    if (typeof obj.consentStatus !== 'string' || !PERMITTED_CONSENT_STATUSES.has(obj.consentStatus)) {
      throw new LogSchemaValidationError(`Invalid consentStatus: '${obj.consentStatus}'`, 'consentStatus');
    }
  }

  if (obj.sourceEquipmentCategory !== undefined) {
    if (typeof obj.sourceEquipmentCategory !== 'string' || !PERMITTED_SOURCE_EQUIPMENTS.has(obj.sourceEquipmentCategory)) {
      throw new LogSchemaValidationError(`Invalid sourceEquipmentCategory: '${obj.sourceEquipmentCategory}'`, 'sourceEquipmentCategory');
    }
  }

  if (obj.errorCode !== undefined) {
    if (typeof obj.errorCode !== 'string' || !PERMITTED_ERROR_CODES.has(obj.errorCode)) {
      throw new LogSchemaValidationError(`Invalid errorCode: '${obj.errorCode}'`, 'errorCode');
    }
  }

  // 6. Validate Integer / Numeric metrics
  validateNonNegativeInteger(obj.stageDurationMs, 'stageDurationMs');
  validateNonNegativeInteger(obj.totalSessionDurationMs, 'totalSessionDurationMs');
  validateNonNegativeNumber(obj.audioDurationSeconds, 'audioDurationSeconds');
  validateNonNegativeInteger(obj.reviewGateDwellTimeMs, 'reviewGateDwellTimeMs');
  validateNonNegativeInteger(obj.apiLatencyMs, 'apiLatencyMs');
  validateNonNegativeInteger(obj.byteCounts, 'byteCounts');
  validateNonNegativeInteger(obj.gapsAcknowledgedCount, 'gapsAcknowledgedCount');
  validateNonNegativeInteger(obj.draftToSignoffDurationMs, 'draftToSignoffDurationMs');
  validateNonNegativeNumber(obj.callDurationSeconds, 'callDurationSeconds');
  validateNonNegativeNumber(obj.importedRecordingDurationSeconds, 'importedRecordingDurationSeconds');

  if (obj.apiStatusCode !== undefined) {
    if (typeof obj.apiStatusCode !== 'number' || !Number.isInteger(obj.apiStatusCode) || obj.apiStatusCode < 100 || obj.apiStatusCode > 599) {
      throw new LogSchemaValidationError('apiStatusCode must be a valid HTTP status code (100-599).', 'apiStatusCode');
    }
  }

  if (obj.verificationPassResult !== undefined && typeof obj.verificationPassResult !== 'boolean') {
    throw new LogSchemaValidationError('verificationPassResult must be a boolean.', 'verificationPassResult');
  }

  // 7. Validate Structured Sub-Objects (Strict sub-schemas with ZERO free text)
  if (obj.wordCounts !== undefined) {
    if (!obj.wordCounts || typeof obj.wordCounts !== 'object' || Array.isArray(obj.wordCounts)) {
      throw new LogSchemaValidationError('wordCounts must be an object with integer word counts.', 'wordCounts');
    }
    const wc = obj.wordCounts as Record<string, unknown>;
    for (const k of Object.keys(wc)) {
      if (!['transcriptWords', 'noteWords'].includes(k)) {
        throw new LogSchemaValidationError(`Unknown sub-field in wordCounts: '${k}'`, 'wordCounts');
      }
      validateNonNegativeInteger(wc[k], `wordCounts.${k}`);
    }
  }

  if (obj.detectedIdentifierCounts !== undefined) {
    if (!obj.detectedIdentifierCounts || typeof obj.detectedIdentifierCounts !== 'object' || Array.isArray(obj.detectedIdentifierCounts)) {
      throw new LogSchemaValidationError('detectedIdentifierCounts must be an object mapping category to integer count.', 'detectedIdentifierCounts');
    }
    const counts = obj.detectedIdentifierCounts as Record<string, unknown>;
    for (const [category, count] of Object.entries(counts)) {
      if (typeof category !== 'string' || !/^[A-Z0-9_]{2,40}$/.test(category)) {
        throw new LogSchemaValidationError(`Invalid identifier category key: '${category}'`, 'detectedIdentifierCounts');
      }
      validateNonNegativeInteger(count, `detectedIdentifierCounts.${category}`);
    }
  }

  if (obj.reviewGateModifications !== undefined) {
    if (!obj.reviewGateModifications || typeof obj.reviewGateModifications !== 'object' || Array.isArray(obj.reviewGateModifications)) {
      throw new LogSchemaValidationError('reviewGateModifications must be an object.', 'reviewGateModifications');
    }
    const rgm = obj.reviewGateModifications as Record<string, unknown>;
    for (const k of Object.keys(rgm)) {
      if (!['addedCount', 'removedCount'].includes(k)) {
        throw new LogSchemaValidationError(`Unknown sub-field in reviewGateModifications: '${k}'`, 'reviewGateModifications');
      }
      validateNonNegativeInteger(rgm[k], `reviewGateModifications.${k}`);
    }
  }

  if (obj.callEventCounts !== undefined) {
    if (!obj.callEventCounts || typeof obj.callEventCounts !== 'object' || Array.isArray(obj.callEventCounts)) {
      throw new LogSchemaValidationError('callEventCounts must be an object.', 'callEventCounts');
    }
    const cec = obj.callEventCounts as Record<string, unknown>;
    for (const k of Object.keys(cec)) {
      if (!['joinCount', 'muteCount', 'holdCount', 'dropCount'].includes(k)) {
        throw new LogSchemaValidationError(`Unknown sub-field in callEventCounts: '${k}'`, 'callEventCounts');
      }
      validateNonNegativeInteger(cec[k], `callEventCounts.${k}`);
    }
  }

  if (obj.modelAndPromptVersions !== undefined) {
    if (!obj.modelAndPromptVersions || typeof obj.modelAndPromptVersions !== 'object' || Array.isArray(obj.modelAndPromptVersions)) {
      throw new LogSchemaValidationError('modelAndPromptVersions must be an object.', 'modelAndPromptVersions');
    }
    const mapv = obj.modelAndPromptVersions as Record<string, unknown>;
    for (const k of Object.keys(mapv)) {
      if (!['modelVersion', 'promptVersion'].includes(k)) {
        throw new LogSchemaValidationError(`Unknown sub-field in modelAndPromptVersions: '${k}'`, 'modelAndPromptVersions');
      }
      if (typeof mapv[k] !== 'string' || !/^[a-zA-Z0-9.\-_]+$/.test(mapv[k] as string) || (mapv[k] as string).length > 32) {
        throw new LogSchemaValidationError(`Invalid version string in modelAndPromptVersions.${k}`, `modelAndPromptVersions.${k}`);
      }
    }
  }

  return obj as unknown as ValidatedLogPayload;
}

function validateNonNegativeInteger(val: unknown, fieldName: string): void {
  if (val !== undefined) {
    if (typeof val !== 'number' || !Number.isInteger(val) || val < 0) {
      throw new LogSchemaValidationError(`Field '${fieldName}' must be a non-negative integer.`, fieldName);
    }
  }
}

function validateNonNegativeNumber(val: unknown, fieldName: string): void {
  if (val !== undefined) {
    if (typeof val !== 'number' || isNaN(val) || val < 0) {
      throw new LogSchemaValidationError(`Field '${fieldName}' must be a non-negative number.`, fieldName);
    }
  }
}

function assertNoPiiLeak(val: string, fieldName: string): void {
  if (PHONE_PATTERN.test(val)) {
    throw new LogSchemaValidationError(`Field '${fieldName}' contains forbidden phone number pattern.`, fieldName);
  }
  if (FILENAME_PATTERN.test(val)) {
    throw new LogSchemaValidationError(`Field '${fieldName}' contains forbidden filename pattern.`, fieldName);
  }
  if (PATH_PATTERN.test(val)) {
    throw new LogSchemaValidationError(`Field '${fieldName}' contains forbidden filesystem path pattern.`, fieldName);
  }
  if (NINO_PATTERN.test(val)) {
    throw new LogSchemaValidationError(`Field '${fieldName}' contains forbidden NINO pattern.`, fieldName);
  }
  if (POSTCODE_PATTERN.test(val)) {
    throw new LogSchemaValidationError(`Field '${fieldName}' contains forbidden Postcode pattern.`, fieldName);
  }
}
