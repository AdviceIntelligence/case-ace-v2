/**
 * Case Ace v2.0 - Phase 14: Adviser Review & Sign-Off Engine
 * 
 * DESIGN PRINCIPLES (Anti-Automation Bias & Accountability):
 * 1. Zero Pre-Ticking: No checkbox or confirmation may be initialized to true.
 * 2. Zero Bulk Acknowledge: Every individual gap, low confidence item, and safeguarding risk
 *    must be consciously and individually inspected and confirmed.
 * 3. Zero Cross-Session Memory: Acknowledgements exist strictly in volatile RAM.
 * 4. Solemn Affirmative Declaration: Adviser affirms that the case note is their own
 *    professional record, with full legal and professional liability acknowledged.
 * 5. Elevated Safeguarding Protocol: High-risk indicators route directly to CAW Safeguarding SOP.
 * 6. Casebook Clipboard-Only Export: Strictly no file writes (Constraint C1).
 */

import { volatileSessionStore, type SessionState, type CaseNoteAttribution } from '../state/volatileStore.ts';
import { logSecurityEvent } from '../monitoring/eventLogger.ts';
import { tokenisationEngine } from '../tokenisation/tokenisationEngine.ts';

export interface SafeguardingAssessment {
  isTriggered: boolean;
  triggerReasons: string[];
  policyReference: string;
  policyUrl: string;
}

export interface SignoffReadinessStatus {
  canSignoff: boolean;
  totalGapsCount: number;
  acknowledgedGapsCount: number;
  gapsRemaining: number;
  totalLowConfidenceCount: number;
  confirmedLowConfidenceCount: number;
  lowConfidenceRemaining: number;
  safeguardingTriggered: boolean;
  safeguardingConfirmed: boolean;
  professionalDeclarationConfirmed: boolean;
  unmetRequirements: string[];
}

export const SAFEGUARDING_KEYWORDS = [
  'safeguard',
  'suicid',
  'self-harm',
  'self harm',
  'domestic abuse',
  'domestic violence',
  'child abuse',
  'child neglect',
  'child protection',
  'modern slavery',
  'human trafficking',
  'forced marriage',
  'coercive control',
  'physical violence',
  'sexual violence',
  'assault',
  'threat to life',
  'homeless tonight',
  'street homeless',
  'vulnerable adult',
  'elder abuse',
  'financial coercion',
];

export class SignoffEngine {
  /**
   * Evaluates the case note for potential safeguarding concerns or high-risk vulnerabilities.
   * Scans structured sections and note text for safeguarding triggers.
   */
  public detectSafeguardingSignals(session: SessionState | null): SafeguardingAssessment {
    if (!session) {
      return {
        isTriggered: false,
        triggerReasons: [],
        policyReference: 'CAW-SOP-SAFE-01 (Citizens Advice Safeguarding Procedure)',
        policyUrl: '#caw-safeguarding-sop',
      };
    }

    const reasons: string[] = [];
    const textToScan: string[] = [];

    if (session.structuredCaseNote) {
      const { presentingIssue, supportNeedsVulnerability } = session.structuredCaseNote as any;
      if (presentingIssue?.safeguardingConcern && presentingIssue.safeguardingConcern !== 'None identified during consultation') {
        textToScan.push(presentingIssue.safeguardingConcern);
      }
      if (presentingIssue?.emergencyOrRisk && presentingIssue.emergencyOrRisk !== 'None identified during consultation') {
        textToScan.push(presentingIssue.emergencyOrRisk);
      }
      if (supportNeedsVulnerability?.safeguardingVulnerability) {
        textToScan.push(supportNeedsVulnerability.safeguardingVulnerability);
      }
    }

    if (session.draftCaseNote) {
      textToScan.push(session.draftCaseNote);
    }

    const combinedText = textToScan.join(' ').toLowerCase();

    for (const keyword of SAFEGUARDING_KEYWORDS) {
      if (combinedText.includes(keyword)) {
        reasons.push(`Safeguarding keyword detected: "${keyword}"`);
      }
    }

    // Deduplicate trigger reasons
    const uniqueReasons = Array.from(new Set(reasons));

    return {
      isTriggered: uniqueReasons.length > 0,
      triggerReasons: uniqueReasons,
      policyReference: 'CAW-SOP-SAFE-01 (Citizens Advice Safeguarding Procedure)',
      policyUrl: '#caw-safeguarding-sop',
    };
  }

  /**
   * Identifies statements in the draft note that are low confidence or require verification.
   */
  public extractLowConfidenceAttributions(attributions: CaseNoteAttribution[] = []): CaseNoteAttribution[] {
    return attributions.filter((attr) => {
      const lowerStmt = (attr.statementText || '').toLowerCase();
      const lowerSnippet = (attr.transcriptSnippet || '').toLowerCase();
      return (
        lowerStmt.includes('[low confidence]') ||
        lowerSnippet.includes('[low confidence]') ||
        lowerStmt.includes('unverified') ||
        lowerStmt.includes('unclear') ||
        (attr as any).confidenceScore < 0.80 ||
        (attr as any).isLowConfidence === true
      );
    });
  }

  /**
   * Computes whether all anti-automation bias gates are satisfied for sign-off.
   */
  public evaluateSignoffReadiness(session: SessionState | null): SignoffReadinessStatus {
    if (!session) {
      return {
        canSignoff: false,
        totalGapsCount: 0,
        acknowledgedGapsCount: 0,
        gapsRemaining: 0,
        totalLowConfidenceCount: 0,
        confirmedLowConfidenceCount: 0,
        lowConfidenceRemaining: 0,
        safeguardingTriggered: false,
        safeguardingConfirmed: false,
        professionalDeclarationConfirmed: false,
        unmetRequirements: ['No active consultation session.'],
      };
    }

    const unmet: string[] = [];
    const gaps = session.caseNoteGaps || [];
    const acknowledgedGaps = session.acknowledgedGaps || [];
    const gapsRemaining = gaps.filter((g) => !acknowledgedGaps.includes(g));

    if (gapsRemaining.length > 0) {
      unmet.push(`${gapsRemaining.length} gap(s) / limitation(s) must be individually reviewed and acknowledged.`);
    }

    const lowConfidenceItems = this.extractLowConfidenceAttributions(session.caseNoteAttributions || []);
    const confirmedLowConf = session.confirmedLowConfidenceAttributions || [];
    const lowConfRemaining = lowConfidenceItems.filter((item) => !confirmedLowConf.includes(item.id));

    if (lowConfRemaining.length > 0) {
      unmet.push(`${lowConfRemaining.length} low-confidence statement(s) must be individually confirmed.`);
    }

    const safeguarding = this.detectSafeguardingSignals(session);
    if (safeguarding.isTriggered && !session.safeguardingConfirmed) {
      unmet.push('Safeguarding concerns detected: Mandatory verification against CAW-SOP-SAFE-01 required.');
    }

    if (!session.professionalDeclarationConfirmed) {
      unmet.push('Adviser affirmative professional responsibility declaration must be confirmed.');
    }

    const canSignoff = unmet.length === 0 && (session.draftCaseNote || '').trim().length > 0;

    return {
      canSignoff,
      totalGapsCount: gaps.length,
      acknowledgedGapsCount: acknowledgedGaps.length,
      gapsRemaining: gapsRemaining.length,
      totalLowConfidenceCount: lowConfidenceItems.length,
      confirmedLowConfidenceCount: confirmedLowConf.length,
      lowConfidenceRemaining: lowConfRemaining.length,
      safeguardingTriggered: safeguarding.isTriggered,
      safeguardingConfirmed: session.safeguardingConfirmed || false,
      professionalDeclarationConfirmed: session.professionalDeclarationConfirmed || false,
      unmetRequirements: unmet,
    };
  }

  /**
   * Formats the detokenised case note for direct copy-pasting into Casebook.
   * Cleans markdown artifacts while preserving structured hierarchy and mandatory headers.
   */
  public formatCasebookExport(
    noteMarkdown: string,
    metadata: {
      adviserName: string;
      intakeRoute: string;
      consultationDate?: string;
      tokenMap?: Record<string, string>;
    }
  ): string {
    const dateStr = metadata.consultationDate || new Date().toLocaleDateString('en-GB', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const header = [
      '======================================================================',
      'CITIZENS ADVICE CONSULTATION RECORD (CASEBOOK FORMAT)',
      '======================================================================',
      `DATE: ${dateStr}`,
      `ADVISER: ${metadata.adviserName}`,
      `INTAKE ROUTE: ${metadata.intakeRoute}`,
      `RECORD STATUS: Signed Off (Professional Record of Advising Practitioner)`,
      '----------------------------------------------------------------------\n',
    ].join('\n');

    // Detokenise first if a token map is provided
    let detokenised = metadata.tokenMap
      ? tokenisationEngine.detokeniseText(noteMarkdown, metadata.tokenMap)
      : noteMarkdown;

    // Clean markdown headings, bold tags, and list syntax to match Casebook plain text conventions
    let cleaned = detokenised
      .replace(/^### (.*$)/gim, '\n--- $1 ---')
      .replace(/^## (.*$)/gim, '\n========================================\n$1\n========================================')
      .replace(/^# (.*$)/gim, '\n======================================================================\n$1\n======================================================================')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1');

    return header + cleaned.trim() + '\n\n' + [
      '----------------------------------------------------------------------',
      `CASE RECORDING AUDIT: Formatted via Case Ace v2.0 (AQS Level 3 Standard)`,
      `PROFESSIONAL RESPONSIBILITY: Verified and signed by ${metadata.adviserName}`,
      '======================================================================',
    ].join('\n');
  }

  /**
   * Executes the final sign-off: detokenises the note, generates the Casebook export,
   * measures duration from draft generation to sign-off, and logs security audit telemetry.
   */
  public async executeSignoff(
    session: SessionState,
    adviserName: string,
    targetStore = volatileSessionStore
  ): Promise<{
    success: boolean;
    casebookNote: string;
    durationMs: number;
    errorMessage?: string;
  }> {
    const readiness = this.evaluateSignoffReadiness(session);
    if (!readiness.canSignoff) {
      return {
        success: false,
        casebookNote: '',
        durationMs: 0,
        errorMessage: `Cannot sign off: ${readiness.unmetRequirements.join('; ')}`,
      };
    }

    const rawNote = session.draftCaseNote || session.detokenisedCaseNoteMarkdown || '';
    const detokenisedNote = tokenisationEngine.detokeniseText(rawNote, session.tokenMap || {});
    const durationMs = session.draftGeneratedTimestampMs
      ? Date.now() - session.draftGeneratedTimestampMs
      : 0;

    const casebookFormatted = this.formatCasebookExport(rawNote, {
      adviserName,
      intakeRoute: session.consentRecord?.route || 'In-Person Consultation',
      tokenMap: session.tokenMap || {},
    });

    targetStore.completeSignoff(detokenisedNote, casebookFormatted, durationMs);

    // Dispatch non-sensitive monitoring event (Phase 14 telemetry)
    logSecurityEvent({
      type: 'signoff_completed',
      sessionId: session.sessionId,
      details: {
        adviserId: session.metadata.adviserId,
        draftToSignoffDurationMs: durationMs,
        gapsAcknowledgedCount: (session.acknowledgedGaps || []).length,
        lowConfidenceConfirmedCount: (session.confirmedLowConfidenceAttributions || []).length,
        safeguardingTriggered: readiness.safeguardingTriggered,
        timestamp: new Date().toISOString(),
      },
    });

    return {
      success: true,
      casebookNote: casebookFormatted,
      durationMs,
    };
  }
}

export const signoffEngine = new SignoffEngine();
