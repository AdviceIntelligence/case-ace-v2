/**
 * Redaction Review Gate Manager
 * 
 * Enforces the primary privacy gate for Case Ace v2.0 (Phase 9).
 * Prevents any data from leaving the local client machine until:
 * 1. Every low-confidence acoustic region (< 0.70) has been individually acknowledged.
 * 2. The adviser has reviewed proposed redactions, made any manual additions/removals.
 * 3. The adviser has explicitly reviewed the outbound transmission statement.
 * 4. An affirmative proceed action is taken.
 * 
 * Enforces:
 * - Constraint C1: Volatile-only storage.
 * - Constraint C4: Zero raw audio leaves device.
 * - Constraint C5: Only surrogate-tokenised text leaves device.
 * - No skip path, no batch "redact all" bypass, no cross-session preference caching.
 */

import { volatileSessionStore, type SessionState, type AsrWord } from '../state/volatileStore.ts';
import { logSecurityEvent } from '../monitoring/eventLogger.ts';

export interface LowConfidenceItem {
  id: string;
  word: string;
  startSec: number;
  endSec: number;
  confidence: number;
  speaker: 'adviser' | 'client' | 'unknown';
  surroundingContext: string;
  isAcknowledged: boolean;
  sourceType: 'asr_token' | 'low_conf_identifier';
}

export interface GateReadinessStatus {
  canProceed: boolean;
  totalLowConfidenceCount: number;
  acknowledgedCount: number;
  pendingCount: number;
  pendingItems: LowConfidenceItem[];
  allLowConfidenceItems: LowConfidenceItem[];
  blockingReasons: string[];
}

export interface OutboundTransmissionDisclosure {
  targetProcessor: string;
  targetRegion: string;
  targetEndpoint: string;
  credentialScope: string;
  credentialValiditySeconds: number;
  tokenisedPayloadPreview: string;
  totalRedactedTokensCount: number;
  totalRetainedSpecialCategoryCount: number;
  manualAdditionsCount: number;
  manualRemovalsCount: number;
}

/**
 * Extracts and unifies all low-confidence items from ASR results and detected identifiers.
 */
export function extractLowConfidenceItems(state: Readonly<SessionState>): LowConfidenceItem[] {
  const items: LowConfidenceItem[] = [];
  const rawTranscript = state.transcript?.fullTranscript || '';
  const acknowledged = new Set(state.acknowledgedLowConfidenceIds);

  // 1. From Transcript Words (< 0.70 confidence)
  const words: AsrWord[] = state.transcript?.words ?? state.transcript?.segments?.flatMap((s) => s.words) ?? [];
  words
    .filter((w: AsrWord) => w.confidence < 0.70)
    .forEach((w: AsrWord, index: number) => {
      const id = `low_conf_word_${index}_${Math.round(w.start * 100)}`;
      
      // Compute surrounding context (approx ±25 chars)
      const wordStartChar = Math.max(0, rawTranscript.toLowerCase().indexOf(w.word.toLowerCase()));
      const contextStart = Math.max(0, wordStartChar - 25);
      const contextEnd = Math.min(rawTranscript.length, wordStartChar + w.word.length + 25);
      const context = rawTranscript.slice(contextStart, contextEnd);

      items.push({
        id,
        word: w.word,
        startSec: w.start,
        endSec: w.end,
        confidence: w.confidence,
        speaker: w.speaker || 'unknown',
        surroundingContext: context ? `...${context.trim()}...` : `[${w.word}]`,
        isAcknowledged: acknowledged.has(id),
        sourceType: 'asr_token',
      });
    });

  // 2. From Detected Identifiers with confidence < 0.70
  state.detectedIdentifiers
    .filter((d) => d.confidence < 0.70 && d.adviserDecision !== 'rejected')
    .forEach((d) => {
      const id = `low_conf_id_${d.id}`;
      const contextStart = Math.max(0, d.charOffset.start - 25);
      const contextEnd = Math.min(rawTranscript.length, d.charOffset.end + 25);
      const context = rawTranscript.slice(contextStart, contextEnd);

      items.push({
        id,
        word: d.text,
        startSec: d.audioTimeRange.startSec,
        endSec: d.audioTimeRange.endSec,
        confidence: d.confidence,
        speaker: d.speaker || 'unknown',
        surroundingContext: context ? `...${context.trim()}...` : `[${d.text}]`,
        isAcknowledged: acknowledged.has(id),
        sourceType: 'low_conf_identifier',
      });
    });

  return items;
}

/**
 * Checks gate readiness status and enforces blocking constraints.
 */
export function checkGateReadiness(state: Readonly<SessionState> | null): GateReadinessStatus {
  if (!state) {
    return {
      canProceed: false,
      totalLowConfidenceCount: 0,
      acknowledgedCount: 0,
      pendingCount: 0,
      pendingItems: [],
      allLowConfidenceItems: [],
      blockingReasons: ['No active consultation session in memory.'],
    };
  }

  const allItems = extractLowConfidenceItems(state);
  const pendingItems = allItems.filter((item) => !item.isAcknowledged);
  const blockingReasons: string[] = [];

  if (pendingItems.length > 0) {
    blockingReasons.push(
      `${pendingItems.length} low-confidence acoustic region(s) (<0.70 confidence) must be individually auditioned and acknowledged.`
    );
  }

  return {
    canProceed: pendingItems.length === 0,
    totalLowConfidenceCount: allItems.length,
    acknowledgedCount: allItems.length - pendingItems.length,
    pendingCount: pendingItems.length,
    pendingItems,
    allLowConfidenceItems: allItems,
    blockingReasons,
  };
}

/**
 * Builds the outbound transmission statement and live payload preview.
 */
export function getOutboundDisclosure(state: Readonly<SessionState>): OutboundTransmissionDisclosure {
  const activeIdentifiers = state.detectedIdentifiers.filter((d) => d.adviserDecision !== 'rejected');
  const specialCategoryCount = activeIdentifiers.filter((d) => d.detectionLayer === 3).length;
  
  // Re-generate current tokenised transcript preview
  const raw = state.transcript?.fullTranscript || '';
  let preview = raw;

  // Sort identifiers by start offset descending to avoid offset collision
  const sorted = [...activeIdentifiers].sort((a, b) => b.charOffset.start - a.charOffset.start);
  for (const id of sorted) {
    if (id.adviserDecision !== 'retained_substance') {
      preview = preview.slice(0, id.charOffset.start) + id.surrogateToken + preview.slice(id.charOffset.end);
    }
  }

  return {
    targetProcessor: 'Google Cloud Vertex AI (Gemini 1.5 Pro) / Cloud Speech-to-Text v2',
    targetRegion: 'europe-west2 (London, United Kingdom)',
    targetEndpoint: 'https://api.caseace.adviceintelligence.tech/v1/generate-note',
    credentialScope: 'https://www.googleapis.com/auth/cloud-platform (Short-Lived Ephemeral Token)',
    credentialValiditySeconds: 300,
    tokenisedPayloadPreview: preview,
    totalRedactedTokensCount: activeIdentifiers.filter((d) => d.adviserDecision !== 'retained_substance').length,
    totalRetainedSpecialCategoryCount: specialCategoryCount,
    manualAdditionsCount: state.manualRedactions.length,
    manualRemovalsCount: state.detectedIdentifiers.filter((d) => d.adviserDecision === 'rejected').length,
  };
}

/**
 * Affirmative proceed handler. Fails closed if any low-confidence item remains unacknowledged
 * or affirmative consent is false.
 */
export function executeAffirmativeProceed(affirmativeConsent: boolean): {
  success: boolean;
  dwellTimeMs: number;
  tokenisedPayload: string;
  error?: string;
} {
  const state = volatileSessionStore.getState();
  if (!state) {
    return { success: false, dwellTimeMs: 0, tokenisedPayload: '', error: 'No active session in volatile store.' };
  }

  if (!affirmativeConsent) {
    return { success: false, dwellTimeMs: 0, tokenisedPayload: '', error: 'Affirmative authorization checkbox must be explicitly checked.' };
  }

  const readiness = checkGateReadiness(state);
  if (!readiness.canProceed) {
    return {
      success: false,
      dwellTimeMs: 0,
      tokenisedPayload: '',
      error: readiness.blockingReasons.join(' '),
    };
  }

  // Update tokenised transcript in state
  const disclosure = getOutboundDisclosure(state);
  volatileSessionStore.setTokenisedTranscript(disclosure.tokenisedPayloadPreview);

  // Unlock the gate
  volatileSessionStore.unlockGate();
  const dwellTimeMs = volatileSessionStore.getGateDwellTimeMs();

  // Dispatch security monitoring telemetry (zero session text or PII transmitted)
  logSecurityEvent({
    type: 'redaction_gate_completed',
    timestamp: new Date().toISOString(),
    details: {
      dwellTimeMs,
      lowConfidenceReviewedCount: readiness.totalLowConfidenceCount,
      manualAddedCount: state.manualRedactions.length,
      manualRemovedCount: state.detectedIdentifiers.filter((d) => d.adviserDecision === 'rejected').length,
      totalTokenCount: disclosure.totalRedactedTokensCount,
    },
  });

  return {
    success: true,
    dwellTimeMs,
    tokenisedPayload: disclosure.tokenisedPayloadPreview,
  };
}
