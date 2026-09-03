/**
 * Automated Verification Suite for Phase 9: Adviser Redaction Review Gate
 * 
 * Tests:
 * 1. Zero data egress / blocking gate invariant
 * 2. Individual low-confidence region acknowledgement (<0.70)
 * 3. Adviser manual addition and removal of redactions
 * 4. Failsafe anti-rushing invariants (no skip path, mandatory affirmative declaration)
 * 5. Gate dwell time measurement and telemetry logging
 * 6. Outbound destination disclosure and surrogate payload integrity
 */

import { volatileSessionStore } from '../client/src/state/volatileStore.ts';
import {
  checkGateReadiness,
  getOutboundDisclosure,
  executeAffirmativeProceed,
  extractLowConfidenceItems,
} from '../client/src/redaction/redactionGateManager.ts';
import { identifierEngine } from '../client/src/redaction/identifierEngine.ts';
import { getTelemetryBuffer, clearTelemetryBuffer } from '../client/src/monitoring/eventLogger.ts';

let totalTests = 0;
let passedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  passedTests++;
  console.log(`✅ PASS: ${message}`);
}

async function runPhase9Tests() {
  console.log('================================================================');
  console.log('CASE ACE v2.0 - PHASE 9: ADVISER REDACTION REVIEW GATE TESTS');
  console.log('================================================================\n');

  clearTelemetryBuffer();

  // ---------------------------------------------------------
  // TEST 1: Session Initialization & Gate State Invariants
  // ---------------------------------------------------------
  console.log('--- TEST 1: Session Initialization & Gate State Invariants ---');
  
  volatileSessionStore.destroySession();
  assert(!volatileSessionStore.hasActiveSession(), 'VolatileSessionStore is clean before session init');

  volatileSessionStore.initSession('live_microphone', 'adv_sarah_jenkins_4821');
  const initialSession = volatileSessionStore.getState();
  
  assert(initialSession.isGatePassed === false, 'isGatePassed is initially false');
  assert(initialSession.gateOpenedTimestampMs === null, 'gateOpenedTimestampMs is initially null');
  assert(initialSession.gateCompletedTimestampMs === null, 'gateCompletedTimestampMs is initially null');
  assert(initialSession.acknowledgedLowConfidenceIds.length === 0, 'acknowledgedLowConfidenceIds is initially empty');
  assert(initialSession.manualRedactions.length === 0, 'manualRedactions is initially empty');

  // ---------------------------------------------------------
  // TEST 2: Low-Confidence Acoustic Escalation (<0.70)
  // ---------------------------------------------------------
  console.log('\n--- TEST 2: Low-Confidence Acoustic Escalation (<0.70) ---');

  const sampleTranscript = 'Client Jane Doe called regarding National Insurance QQ 12 34 56 A and landlord John Smith at SW11 2AB.';
  
  // Create mock Pass 1 ASR result with 3 low-confidence words (<0.70)
  const mockAsrResult = {
    transcript: sampleTranscript,
    segments: [
      {
        id: 'seg_1',
        speaker: 'adviser',
        text: sampleTranscript,
        start: 0.0,
        end: 8.5,
        confidence: 0.88,
        words: [
          { word: 'Client', start: 0.0, end: 0.5, confidence: 0.95, speaker: 'adviser' },
          { word: 'Jane', start: 0.5, end: 0.9, confidence: 0.55, speaker: 'adviser' }, // LOW CONF
          { word: 'Doe', start: 0.9, end: 1.3, confidence: 0.58, speaker: 'adviser' },  // LOW CONF
          { word: 'called', start: 1.3, end: 1.8, confidence: 0.92, speaker: 'adviser' },
          { word: 'regarding', start: 1.8, end: 2.3, confidence: 0.91, speaker: 'adviser' },
          { word: 'National', start: 2.3, end: 2.8, confidence: 0.95, speaker: 'adviser' },
          { word: 'Insurance', start: 2.8, end: 3.4, confidence: 0.96, speaker: 'adviser' },
          { word: 'QQ', start: 3.4, end: 3.8, confidence: 0.94, speaker: 'adviser' },
          { word: '12', start: 3.8, end: 4.1, confidence: 0.92, speaker: 'adviser' },
          { word: '34', start: 4.1, end: 4.4, confidence: 0.91, speaker: 'adviser' },
          { word: '56', start: 4.4, end: 4.7, confidence: 0.95, speaker: 'adviser' },
          { word: 'A', start: 4.7, end: 5.0, confidence: 0.93, speaker: 'adviser' },
          { word: 'and', start: 5.0, end: 5.3, confidence: 0.88, speaker: 'adviser' },
          { word: 'landlord', start: 5.3, end: 5.9, confidence: 0.89, speaker: 'adviser' },
          { word: 'John', start: 5.9, end: 6.3, confidence: 0.62, speaker: 'adviser' }, // LOW CONF
          { word: 'Smith', start: 6.3, end: 6.8, confidence: 0.94, speaker: 'adviser' },
          { word: 'at', start: 6.8, end: 7.1, confidence: 0.90, speaker: 'adviser' },
          { word: 'SW11', start: 7.1, end: 7.6, confidence: 0.95, speaker: 'adviser' },
          { word: '2AB', start: 7.6, end: 8.2, confidence: 0.96, speaker: 'adviser' },
        ],
      },
    ],
    totalWords: 19,
    executionDurationMs: 340,
    hardwareBackend: 'webgpu',
    lowConfidenceWordsCount: 3,
    lowConfidenceWords: [
      { word: 'Jane', start: 0.5, end: 0.9, confidence: 0.55, speaker: 'adviser' },
      { word: 'Doe', start: 0.9, end: 1.3, confidence: 0.58, speaker: 'adviser' },
      { word: 'John', start: 5.9, end: 6.3, confidence: 0.62, speaker: 'adviser' },
    ],
  };

  volatileSessionStore.setLocalAsrResult(mockAsrResult);
  volatileSessionStore.setLocalDraftTranscript(sampleTranscript);

  // Run Phase 8 Identifier Engine
  const detectionResult = identifierEngine.detectIdentifiers(sampleTranscript, mockAsrResult);
  volatileSessionStore.setDetectedIdentifiers(detectionResult.identifiers);
  volatileSessionStore.setTokenMap(detectionResult.tokenMap);
  volatileSessionStore.setTokenisedTranscript(detectionResult.tokenisedTranscript);

  // Open Redaction Gate
  volatileSessionStore.openRedactionGate();
  const currentSession = volatileSessionStore.getState();

  assert(currentSession.gateOpenedTimestampMs !== null, 'gateOpenedTimestampMs is recorded upon opening gate');
  assert(currentSession.stage === 'redaction_review', 'Session stage transitioned to redaction_review');

  const lowConfItems = extractLowConfidenceItems(currentSession);
  assert(lowConfItems.length >= 3, `Extracted ${lowConfItems.length} low-confidence acoustic items`);
  
  const readiness = checkGateReadiness(currentSession);
  assert(readiness.canProceed === false, 'checkGateReadiness returns canProceed: false when low-confidence items exist');
  assert(readiness.pendingCount >= 3, `Pending count is ${readiness.pendingCount} (blocking unlock)`);
  assert(readiness.blockingReasons.length > 0, 'Blocking reason message is clearly articulated');

  // ---------------------------------------------------------
  // TEST 3: Strict Blocking & Failsafe Invariant Verification
  // ---------------------------------------------------------
  console.log('\n--- TEST 3: Strict Blocking & Failsafe Invariant Verification ---');

  // Attempt to unlock gate directly before acknowledging -> must throw
  let threwExpected = false;
  try {
    volatileSessionStore.unlockGate();
  } catch (err) {
    threwExpected = true;
    assert(err.message.includes('low-confidence region(s) must be individually acknowledged'), 'unlockGate() throws descriptive error on unreviewed items');
  }
  assert(threwExpected, 'volatileSessionStore.unlockGate() strictly blocks execution');

  // Attempt proceed without affirmative checkbox
  const unconfirmedProceed = executeAffirmativeProceed(false);
  assert(unconfirmedProceed.success === false, 'executeAffirmativeProceed(false) returns success: false');
  assert(unconfirmedProceed.error.includes('Affirmative authorization checkbox'), 'Returns affirmative declaration error');

  // Attempt proceed with affirmative checkbox but pending items
  const blockedProceed = executeAffirmativeProceed(true);
  assert(blockedProceed.success === false, 'executeAffirmativeProceed(true) fails when items are pending');
  assert(blockedProceed.error.includes('low-confidence acoustic region'), 'Returns low confidence blocking error');

  // ---------------------------------------------------------
  // TEST 4: Individual Acknowledgement of Low-Confidence Regions
  // ---------------------------------------------------------
  console.log('\n--- TEST 4: Individual Acknowledgement of Low-Confidence Regions ---');

  // Acknowledge first item only
  volatileSessionStore.acknowledgeLowConfidence(lowConfItems[0].id);
  let updatedReadiness = checkGateReadiness(volatileSessionStore.getState());
  assert(updatedReadiness.canProceed === false, 'Gate still blocked after acknowledging only 1 of 3 items');
  assert(updatedReadiness.acknowledgedCount === 1, 'Acknowledged count is 1');
  assert(updatedReadiness.pendingCount === lowConfItems.length - 1, `Pending count decremented to ${updatedReadiness.pendingCount}`);

  // Acknowledge all remaining items individually
  for (let i = 1; i < lowConfItems.length; i++) {
    volatileSessionStore.acknowledgeLowConfidence(lowConfItems[i].id);
  }

  updatedReadiness = checkGateReadiness(volatileSessionStore.getState());
  assert(updatedReadiness.canProceed === true, 'Gate readiness is now TRUE after all items individually acknowledged');
  assert(updatedReadiness.pendingCount === 0, 'Pending low-confidence count reached strictly 0');

  // ---------------------------------------------------------
  // TEST 5: Adviser Manual Redactions & False-Positive Removal
  // ---------------------------------------------------------
  console.log('\n--- TEST 5: Adviser Manual Redactions & False-Positive Removal ---');

  // 1. Add manual text redaction
  const manualTextRedaction = {
    id: 'manual_test_1',
    text: 'SW11 2AB',
    charOffset: { start: sampleTranscript.indexOf('SW11 2AB'), end: sampleTranscript.indexOf('SW11 2AB') + 8 },
    audioTimeRange: { startSec: 7.1, endSec: 8.2 },
    category: 'uk_postcode',
    detectionLayer: 2,
    confidence: 1.0,
    proposedAction: 'redact',
    adviserDecision: 'accepted',
    surrogateToken: '[MANUAL_POSTCODE_001]',
  };
  volatileSessionStore.addManualRedaction(manualTextRedaction);

  const stateWithManual = volatileSessionStore.getState();
  assert(stateWithManual.manualRedactions.length === 1, 'Manual redactions array has 1 item');
  assert(stateWithManual.tokenMap['[MANUAL_POSTCODE_001]'] === 'SW11 2AB', 'Token map contains surrogate mapping for manual item');

  // 2. Remove false positive redaction (un-redact)
  const targetToReject = stateWithManual.detectedIdentifiers.find((d) => d.text.includes('QQ') || d.text.includes('John'));
  if (targetToReject) {
    const rejectedToken = targetToReject.surrogateToken;
    volatileSessionStore.removeRedaction(targetToReject.id);
    const stateAfterRemoval = volatileSessionStore.getState();
    assert(targetToReject.adviserDecision === 'rejected', 'Identifier decision marked as rejected');
    assert(stateAfterRemoval.tokenMap[rejectedToken] === undefined, 'Rejected surrogate token removed from active tokenMap');
  }

  // ---------------------------------------------------------
  // TEST 6: Outbound Transmission Disclosure & Affirmative Unlock
  // ---------------------------------------------------------
  console.log('\n--- TEST 6: Outbound Transmission Disclosure & Affirmative Unlock ---');

  const disclosure = getOutboundDisclosure(volatileSessionStore.getState());
  assert(disclosure.targetRegion === 'europe-west2 (London, United Kingdom)', 'Target region is europe-west2 London');
  assert(disclosure.credentialValiditySeconds === 300, 'Credential validity is 300s ephemeral');
  assert(disclosure.tokenisedPayloadPreview.length > 0, 'Outbound tokenised payload preview generated');
  assert(!disclosure.tokenisedPayloadPreview.includes('QQ 12 34 56 A') || disclosure.manualRemovalsCount > 0, 'Surrogate substitution correctly reflected in outbound preview');

  // Simulate short delay for dwell time calculation
  await new Promise((r) => setTimeout(r, 50));

  // Affirmative proceed
  const proceedResult = executeAffirmativeProceed(true);
  assert(proceedResult.success === true, 'Affirmative proceed succeeds');
  assert(proceedResult.dwellTimeMs > 0, `Active gate dwell time measured (${proceedResult.dwellTimeMs}ms)`);
  
  const finalState = volatileSessionStore.getState();
  assert(finalState.isGatePassed === true, 'isGatePassed is true in volatile state');
  assert(finalState.stage === 'tokenisation', 'Session stage moved to tokenisation');
  assert(finalState.redactionReviewAudit !== null, 'Redaction review audit record attached to session');
  assert(finalState.redactionReviewAudit.dwellTimeMs >= 50, 'Audit record contains non-zero dwell time');

  // ---------------------------------------------------------
  // TEST 7: Security Telemetry Event Verification
  // ---------------------------------------------------------
  console.log('\n--- TEST 7: Security Telemetry Event Verification ---');

  const telemetryEvents = getTelemetryBuffer();
  assert(telemetryEvents.length > 0, `Telemetry buffer received ${telemetryEvents.length} event(s)`);

  const gateEvent = telemetryEvents.find((e) => e.type === 'redaction_gate_completed');
  assert(gateEvent !== undefined, 'Security telemetry recorded "redaction_gate_completed" event');
  assert(gateEvent.details.dwellTimeMs !== undefined, 'Event details contain dwellTimeMs');
  assert(gateEvent.details.lowConfidenceReviewedCount !== undefined, 'Event details contain lowConfidenceReviewedCount');
  
  // Verify ZERO PII or transcript text in telemetry event
  const eventString = JSON.stringify(gateEvent);
  assert(!eventString.includes('Jane'), 'Zero client name in telemetry log');
  assert(!eventString.includes('QQ 12'), 'Zero NINO in telemetry log');
  assert(!eventString.includes('SW11'), 'Zero postcode in telemetry log');
  assert(!eventString.includes('John'), 'Zero landlord name in telemetry log');
  assert(!eventString.includes('transcript'), 'Zero transcript payload key in telemetry log');

  console.log('\n================================================================');
  console.log(`PHASE 9 VERIFICATION SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
  console.log('================================================================\n');
}

runPhase9Tests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
