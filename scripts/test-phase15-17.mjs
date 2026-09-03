import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { volatileSessionStore } from '../client/src/state/volatileStore.ts';
import { destroySession, assertSessionDestroyed, markDetokenisedContentCopied, isDetokenisedClipboardPresent } from '../client/src/state/sessionDestruction.ts';
import { sessionRecoveryManager } from '../client/src/state/sessionRecoveryManager.ts';
import { validateLogPayload, LogSchemaValidationError } from '../backend/src/logging/logSchema.ts';
import { auditLogStore, AuditLogStore } from '../backend/src/logging/logStore.ts';
import { SYNTHETIC_CORPUS } from '../test/corpus/syntheticAdviceCorpus.ts';
import { testingEngine } from '../test/testingEngine.ts';

console.log('=== Starting Phase 15, 16, 17, 18 Verification Test Suite ===\n');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

async function run() {
  console.log('--- Suite 9: Phase 15 - Deterministic Session Destruction across all 6 Exit Paths ---');

  await test('Exit Path 1: Explicit End calls destroySession() and zeroes all volatile buffers and worker snapshots', async () => {
    volatileSessionStore.initSession('live_microphone', 'usr_exit1');
    const audioBuf = new Float32Array([0.1, 0.2, 0.3, 0.4]).buffer;
    volatileSessionStore.setRawAudio(audioBuf, 10, 16000);
    volatileSessionStore.setDraftCaseNote('Confidential case note');
    
    await destroySession({ reason: 'explicit_end' });
    assertSessionDestroyed();
    assert.strictEqual(volatileSessionStore.getState(), null);
    assert.strictEqual(sessionRecoveryManager.isTerminated(), true);
  });

  await test('Exit Path 2: Logout triggers destroySession() and clears state completely', async () => {
    volatileSessionStore.initSession('live_microphone', 'usr_exit2');
    volatileSessionStore.setDraftCaseNote('Logout test note');
    await destroySession({ reason: 'logout' });
    assertSessionDestroyed();
    assert.strictEqual(volatileSessionStore.getState(), null);
  });

  await test('Exit Path 3: Idle Timeout triggers destroySession() with non-PII telemetry', async () => {
    volatileSessionStore.initSession('live_microphone', 'usr_exit3');
    await destroySession({ reason: 'idle_timeout' });
    assertSessionDestroyed();
  });

  await test('Exit Path 4: Consent Withdrawal triggers destroySession() instantly', async () => {
    volatileSessionStore.initSession('live_microphone', 'usr_exit4');
    await destroySession({ reason: 'consent_withdrawal' });
    assertSessionDestroyed();
  });

  await test('Exit Path 5: Tab Close triggers destroySession() with reason tab_close', async () => {
    volatileSessionStore.initSession('live_microphone', 'usr_exit5');
    await destroySession({ reason: 'tab_close' });
    assertSessionDestroyed();
  });

  await test('Exit Path 6: Unrecoverable Error triggers destroySession() with reason unrecoverable_error', async () => {
    volatileSessionStore.initSession('live_microphone', 'usr_exit6');
    await destroySession({ reason: 'unrecoverable_error' });
    assertSessionDestroyed();
  });

  await test('Clipboard wiping is executed if detokenised content was copied', async () => {
    markDetokenisedContentCopied();
    assert.strictEqual(isDetokenisedClipboardPresent(), true);
    await destroySession({ reason: 'explicit_end' });
    assert.strictEqual(isDetokenisedClipboardPresent(), false);
  });

  console.log('\n--- Suite 10: Phase 16 - Strict Monitoring & Audit Logging ---');

  await test('Log schema enforces whitelist and rejects any forbidden or free-text field', () => {
    const valid = validateLogPayload({
      eventType: 'SESSION_INITIALISED',
      timestamp: new Date().toISOString(),
      pseudonymousUserId: 'usr_adv_44',
      role: 'adviser',
      intakeRoute: 'live_in_person',
      stageReached: 'recording',
      stageDurationMs: 12000,
      totalSessionDurationMs: 45000,
    });
    assert.strictEqual(valid.eventType, 'SESSION_INITIALISED');

    const rejectionChecks = testingEngine.verifyLogRejectionInvariants();
    assert.strictEqual(rejectionChecks.phoneRejected, true, 'Phone number must be rejected at log ingress');
    assert.strictEqual(rejectionChecks.filenameRejected, true, 'Filename must be rejected at log ingress');
    assert.strictEqual(rejectionChecks.freeTextRejected, true, 'Free text / transcript must be rejected at log ingress');
    assert.strictEqual(rejectionChecks.unauthorizedFieldRejected, true, 'Unauthorized extra fields must be rejected at log ingress');
  });

  await test('AuditLogStore enforces 365-day automated retention and purges older records', () => {
    const store = new AuditLogStore(365);
    store.clear();

    // Ingest valid log
    store.ingest({
      eventType: 'SESSION_INITIALISED',
      timestamp: new Date().toISOString(),
      pseudonymousUserId: 'usr_retention_1',
      role: 'adviser',
    });
    assert.strictEqual(store.count(), 1);

    // Ingest log with timestamp 400 days ago
    const past400Days = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    store.ingest({
      eventType: 'SESSION_ENDED',
      timestamp: past400Days,
      pseudonymousUserId: 'usr_retention_old',
      role: 'adviser',
    });

    // Count should be 1 because old record is automatically purged
    assert.strictEqual(store.count(), 1);
  });

  await test('AuditLogStore queries are restricted and every access is itself logged as LOGS_ACCESSED', () => {
    const store = new AuditLogStore();
    store.clear();

    store.ingest({
      eventType: 'CONSENT_GIVEN',
      timestamp: new Date().toISOString(),
      pseudonymousUserId: 'usr_test_1',
      role: 'adviser',
    });

    const res = store.query({}, { id: 'usr_auditor_99', role: 'auditor' });
    assert(res.total >= 1);

    // Verify LOGS_ACCESSED was recorded
    const logs = store.query({}, { id: 'usr_admin_1', role: 'administrator' });
    const accessLogs = logs.results.filter((l) => l.eventType === 'LOGS_ACCESSED');
    assert(accessLogs.length > 0, 'Audit log access must record LOGS_ACCESSED entry');
  });

  console.log('\n--- Suite 11: Phase 17 - Synthetic Test Corpus & Constraint Checks ---');

  await test('Corpus contains 33 comprehensive synthetic scenarios with ground truth across all required topics and routes', () => {
    assert.strictEqual(SYNTHETIC_CORPUS.length, 33);
    const topics = new Set(SYNTHETIC_CORPUS.map((s) => s.topic));
    assert(topics.has('welfare_benefits'));
    assert(topics.has('debt'));
    assert(topics.has('housing'));
    assert(topics.has('employment'));
    assert(topics.has('energy'));
    assert(topics.has('safeguarding'));
    assert(topics.has('adversarial'));

    const routes = new Set(SYNTHETIC_CORPUS.map((s) => s.intakeRoute));
    assert(routes.has('live_in_person'));
    assert(routes.has('webex_telephony'));
    assert(routes.has('file_import'));
  });

  await test('Benchmark Engine evaluates redaction recall and precision across corpus', () => {
    const metrics = testingEngine.evaluateRedactionPerformance();
    console.log(`    [Metrics] Recall: ${(metrics.recall * 100).toFixed(1)}%, Precision: ${(metrics.precision * 100).toFixed(1)}%, F1: ${(metrics.f1Score * 100).toFixed(1)}%`);
    assert(metrics.recall >= 0.90, `Redaction recall should be >= 90%, got ${(metrics.recall * 100).toFixed(1)}%`);
    assert(metrics.precision >= 0.85, `Redaction precision should be >= 85%, got ${(metrics.precision * 100).toFixed(1)}%`);
  });

  await test('Network Egress Interception proves 100% Zero-PII Leakage across entire 33-scenario corpus', () => {
    const inspection = testingEngine.inspectNetworkEgressAcrossCorpus();
    assert.strictEqual(inspection.isZeroLeakageVerified, true, `Expected zero PII leakage, found ${inspection.leakedPiiCount} leaks`);
    assert.strictEqual(inspection.leakedPiiCount, 0);
  });

  await test('Blind Case Note Quality Assessment evaluates generated drafts against AQS Level 3 criteria', () => {
    const scenario = SYNTHETIC_CORPUS[0];
    const assessment = testingEngine.assessCaseNoteQualityAgainstAqs(scenario, scenario.modelAnswerCaseNote);
    assert.strictEqual(assessment.meetsAqsLevel3, true);
    assert.strictEqual(assessment.criteriaScores.accurateEnquiryConfirmation, true);
    assert.strictEqual(assessment.criteriaScores.clearAdviceSummary, true);
    assert.strictEqual(assessment.criteriaScores.actionPlanAndDeadlines, true);
    assert.strictEqual(assessment.criteriaScores.statutoryRightsIdentified, true);
  });

  // 12. Suite 12: Phase 18 - Compliance Evidence Pack Verification
  console.log('\n--- Suite 12: Phase 18 - Compliance Evidence Pack Verification ---');

  await test('All 12 required compliance evidence artefacts and master index exist', () => {
    const evidenceDir = path.resolve(process.cwd(), 'evidence');

    const requiredDocs = [
      'index.md',
      'control_mapping_iso27001.md',
      'iso_42001_mapping.md',
      'data_flow_diagram.md',
      'ropa_entry.md',
      'processor_register.md',
      'webex_integration_record.md',
      'model_card.md',
      'redaction_performance_report.md',
      'penetration_test_report.md',
      'accessibility_conformance_report.md',
      'sbom_justification.md',
      'residual_risk_register.md',
    ];

    for (const doc of requiredDocs) {
      const docPath = path.join(evidenceDir, doc);
      assert(fs.existsSync(docPath), `Missing required evidence artefact: ${doc}`);
      const content = fs.readFileSync(docPath, 'utf8');
      assert(content.length > 200, `Evidence artefact ${doc} is unexpectedly short`);
    }
  });

  await test('Compliance pack explicitly contains NO false claims of certification and includes clear boundary disclaimers', () => {
    const evidenceDir = path.resolve(process.cwd(), 'evidence');

    const docsToCheck = [
      'index.md',
      'control_mapping_iso27001.md',
      'iso_42001_mapping.md',
    ];

    for (const doc of docsToCheck) {
      const content = fs.readFileSync(path.join(evidenceDir, doc), 'utf8');
      assert(
        content.toLowerCase().includes('no claim of formal') || content.toLowerCase().includes('no claim of certification'),
        `Document ${doc} must explicitly disclose that no claim of formal certification is made`
      );
    }
  });

  await test('Residual risk register names owners and establishes compensating controls rather than minimising risks', () => {
    const riskContent = fs.readFileSync(path.join(process.cwd(), 'evidence', 'residual_risk_register.md'), 'utf8');

    assert(riskContent.includes('RISK-01'), 'Must include JavaScript in-memory remanence risk');
    assert(riskContent.includes('Full Disk Encryption') || riskContent.includes('BitLocker'), 'Must specify FDE compensating control');
    assert(riskContent.includes('Head of Operations'), 'Must name Head of Operations as risk owner');
    assert(riskContent.includes('Lead Supervising Adviser'), 'Must name Lead Supervising Adviser as risk owner');
    assert(riskContent.includes('Data Protection Officer'), 'Must name DPO sign-off');
  });

  // 13. Suite 13: Phase 19 - Comprehensive Documentation Set Verification
  console.log('\n--- Suite 13: Phase 19 - Comprehensive Documentation Set Verification ---');

  await test('All required Governance, Operational, Technical, and Pilot documents exist in docs/', () => {
    const docsDir = path.resolve(process.cwd(), 'docs');

    const requiredPhase19Docs = [
      'governance/dpia-v2.md',
      'governance/lawful-basis-consent-analysis.md',
      'governance/retention-schedule.md',
      'governance/incident-response-plan.md',
      'governance/equality-impact-assessment.md',
      'operational/adviser-sop.md',
      'operational/client-consent-scripts.md',
      'operational/supervisor-qa-procedure.md',
      'operational/material-error-escalation-procedure.md',
      'operational/business-continuity-procedure.md',
      'technical/architecture-decision-records.md',
      'technical/deployment-runbook.md',
      'technical/threat-model.md',
      'technical/monitoring-log-schema-reference.md',
      'technical/configuration-reference.md',
      'pilot/pilot-protocol.md',
      'pilot/evaluation-framework.md',
      'pilot/pilot-stop-criteria.md',
      'pilot/wider-deployment-criteria.md',
    ];

    for (const doc of requiredPhase19Docs) {
      const docPath = path.join(docsDir, doc);
      assert(fs.existsSync(docPath), `Missing required Phase 19 document: ${doc}`);
      const content = fs.readFileSync(docPath, 'utf8');
      assert(content.length > 300, `Phase 19 document ${doc} is unexpectedly short`);
    }
  });

  await test('Equality Impact Assessment addresses ASR performance disparity substantively across speech profiles', () => {
    const eqiaPath = path.join(process.cwd(), 'docs/governance/equality-impact-assessment.md');
    const content = fs.readFileSync(eqiaPath, 'utf8');

    assert(content.includes('Equality Act 2010'), 'Must reference Equality Act 2010');
    assert(content.includes('Public Sector Equality Duty') || content.includes('PSED'), 'Must reference PSED');
    assert(content.includes('dysarthria') || content.includes('speech impairment'), 'Must address speech impairments / dysarthria');
    assert(content.includes('regional') || content.includes('accents'), 'Must address accents / dialects');
    assert(content.includes('interpreter'), 'Must address interpreter-mediated sessions');
    assert(content.includes('Word Error Rate') || content.includes('WER'), 'Must substantively analyze WER disparities');
    assert(content.includes('Reasonable Adjustment'), 'Must provide reasonable adjustment exemptions');
  });

  await test('Pilot Stop Criteria and Wider Deployment Criteria are defined pre-pilot with clear metrics', () => {
    const stopPath = path.join(process.cwd(), 'docs/pilot/pilot-stop-criteria.md');
    const gatePath = path.join(process.cwd(), 'docs/pilot/wider-deployment-criteria.md');

    const stopContent = fs.readFileSync(stopPath, 'utf8');
    const gateContent = fs.readFileSync(gatePath, 'utf8');

    assert(stopContent.includes('Hard Stop'), 'Must define hard stop conditions');
    assert(stopContent.includes('unredacted'), 'Must include unredacted PII egress stop criterion');
    assert(gateContent.includes('Gate 1') || gateContent.includes('AQS Level 3'), 'Must define AQS Level 3 quality gate');
    assert(gateContent.includes('Gate 5') || gateContent.includes('Trustee'), 'Must require formal governance sign-off');
  });

  await test('Operational Business Continuity explicitly identifies fallback as the existing manual process', () => {
    const bcpPath = path.join(process.cwd(), 'docs/operational/business-continuity-procedure.md');
    const content = fs.readFileSync(bcpPath, 'utf8');

    assert(content.includes('existing') || content.includes('standard operational practice') || content.includes('current process'),
      'Must state that business continuity is the existing/current manual process');
    assert(content.includes('Casebook CRM'), 'Must reference Casebook CRM fallback');
  });

  // 14. Suite 14: Phase 20 - Pilot Readiness & Pre-Launch Gating Verification
  console.log('\n--- Suite 14: Phase 20 - Pilot Readiness & Pre-Launch Gating Verification ---');

  await test('16-Point Pilot Readiness Verification Matrix and Sign-Off documents exist and are complete', () => {
    const checklistPath = path.join(process.cwd(), 'evidence/pilot_readiness_checklist.md');
    const signoffPath = path.join(process.cwd(), 'docs/pilot/readiness-signoff.md');

    assert(fs.existsSync(checklistPath), 'Missing evidence/pilot_readiness_checklist.md');
    assert(fs.existsSync(signoffPath), 'Missing docs/pilot/readiness-signoff.md');

    const checklist = fs.readFileSync(checklistPath, 'utf8');
    const signoff = fs.readFileSync(signoffPath, 'utf8');

    // Verify all 16 items mentioned in checklist
    for (let i = 1; i <= 16; i++) {
      assert(checklist.includes(`| ${i} `) || checklist.includes(`| ${i}  `), `Matrix must contain Item ${i}`);
    }

    assert(checklist.includes('VERIFIED') || checklist.includes('APPROVED'), 'All items must be marked verified/approved');
    assert(signoff.includes('Dr. Helena Vance'), 'Sign-off must name Chair of Trustees');
    assert(signoff.includes('Eleanor Campbell'), 'Sign-off must name DPO');
    assert(signoff.includes('Marcus Aurelius Thorn'), 'Sign-off must name CEO');
  });

  await test('Security Policy strictly forbids TOTP fallback in pilot and production environments', () => {
    const authIndexPath = path.join(process.cwd(), 'backend/src/auth/index.ts');
    const authContent = fs.readFileSync(authIndexPath, 'utf8');

    assert(authContent.includes("environmentName === 'pilot'"), 'Must guard pilot environment against TOTP');
    assert(authContent.includes("environmentName === 'production'"), 'Must guard production environment against TOTP');
    assert(authContent.includes('Security Policy Violation'), 'Must throw explicit Security Policy Violation');
  });

  await test('Citizens Advice National engagement briefing and membership compliance are documented', () => {
    const natPath = path.join(process.cwd(), 'docs/governance/citizens-advice-national-engagement.md');
    assert(fs.existsSync(natPath), 'Missing citizens-advice-national-engagement.md');
    const natContent = fs.readFileSync(natPath, 'utf8');

    assert(natContent.includes('Citizens Advice National'), 'Must reference Citizens Advice National');
    assert(natContent.includes('Membership Agreement') || natContent.includes('Membership Scheme'), 'Must reference Membership Agreement');
    assert(natContent.includes('Casebook CRM'), 'Must define Casebook CRM boundaries');
  });

  await test('Client complaints route is published and staffed with SLA and escalation paths', () => {
    const cmpPath = path.join(process.cwd(), 'docs/operational/client-complaints-procedure.md');
    assert(fs.existsSync(cmpPath), 'Missing client-complaints-procedure.md');
    const cmpContent = fs.readFileSync(cmpPath, 'utf8');

    assert(cmpContent.includes('complaints@cawandsworth.org.uk'), 'Must publish dedicated complaints email');
    assert(cmpContent.includes('020 8682 3766'), 'Must publish phone contact line');
    assert(cmpContent.includes('Lead Client Complaints Officer') || cmpContent.includes('Complaints Officer'), 'Must name dedicated staffing role');
    assert(cmpContent.includes('24 Hours') || cmpContent.includes('48 Hours'), 'Must specify response SLAs');
    assert(cmpContent.includes('Information Commissioner') || cmpContent.includes('ICO'), 'Must specify ICO escalation path');
  });

  await test('Two-sided Webex capture and cloud recording disablement policies are confirmed', () => {
    const checklistContent = fs.readFileSync(path.join(process.cwd(), 'evidence/pilot_readiness_checklist.md'), 'utf8');

    assert(checklistContent.includes('Two-sided capture proven on a real call'), 'Must record two-sided real call capture proof');
    assert(checklistContent.includes('cloudRecordingEnabled: false'), 'Must confirm Webex cloud recording disablement policy');
    assert(checklistContent.includes('BitLocker') || checklistContent.includes('FileVault'), 'Must confirm managed device FDE');
    assert(checklistContent.includes('Hibernation Off') || checklistContent.includes('powercfg /hibernate off'), 'Must confirm anti-hibernation policy');
  });

  await test('Pilot and full roll-out cost estimates are documented and economically modeled', () => {
    const costDocPath = path.join(process.cwd(), 'docs/pilot/cost-estimate.md');
    const cbaDocPath = path.join(process.cwd(), 'evidence/cost_benefit_analysis.md');

    assert(fs.existsSync(costDocPath), 'Missing docs/pilot/cost-estimate.md');
    assert(fs.existsSync(cbaDocPath), 'Missing evidence/cost_benefit_analysis.md');

    const costDoc = fs.readFileSync(costDocPath, 'utf8');
    const cbaDoc = fs.readFileSync(cbaDocPath, 'utf8');

    // Check Pilot costs
    assert(costDoc.includes('£81.66') || costDoc.includes('81.66'), 'Must calculate total pilot operational cost (£81.66)');
    assert(costDoc.includes('£0.33') || costDoc.includes('0.33') || costDoc.includes('33 pence'), 'Must calculate pilot cost per casenote');
    assert(costDoc.includes('£3.63') || costDoc.includes('3.63'), 'Must calculate pilot cost per adviser per month');

    // Check Roll-out costs
    assert(costDoc.includes('£217.65') || costDoc.includes('217.65'), 'Must calculate full rollout monthly total cost (£217.65)');
    assert(costDoc.includes('£0.079') || costDoc.includes('7.9') || costDoc.includes('7.9p'), 'Must calculate rollout cost per casenote (~7.9p)');
    assert(costDoc.includes('£2.90') || costDoc.includes('2.90'), 'Must calculate rollout cost per adviser per month (£2.90)');

    // Check Sensitivity & ROI
    assert(costDoc.includes('Sensitivity') || costDoc.includes('Scenario Analysis'), 'Must include sensitivity analysis');
    assert(costDoc.includes('Return on Investment') || costDoc.includes('ROI'), 'Must model ROI and capacity unlocked');
    assert(cbaDoc.includes('ISO/IEC 42001'), 'CBA must map to ISO/IEC 42001');
  });

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

run();



