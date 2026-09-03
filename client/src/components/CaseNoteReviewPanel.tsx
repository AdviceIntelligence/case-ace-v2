/**
 * @file CaseNoteReviewPanel.tsx
 * @description Phase 14: Adviser Review and Sign-Off Interface.
 * 
 * DESIGN PRINCIPLES:
 * 1. Counter Automation Bias with Deliberate Friction.
 * 2. Synchronized Split-Pane View: Editable Case Note alongside Working Transcript.
 * 3. Bidirectional Navigation:
 *    - Clicking note statement highlights source in transcript.
 *    - Clicking transcript passage highlights produced note section.
 * 4. Zero Pre-Ticking & Zero Bulk Acknowledge.
 * 5. Every Gap and Low Confidence statement must be individually acknowledged.
 * 6. Prominent Safeguarding Routing linking to CAW Safeguarding SOP (CAW-SOP-SAFE-01).
 * 7. Affirmative Professional Responsibility Declaration.
 * 8. Casebook Plaintext Clipboard Export only (No file write per C1).
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  FileText,
  Shield,
  Eye,
  AlertTriangle,
  Check,
  Quote,
  HelpCircle,
  Sparkles,
  ExternalLink,
  ShieldAlert,
} from 'lucide-react';
import { volatileSessionStore, type SessionState, type CaseNoteAttribution } from '../state/volatileStore.ts';
import { tokenisationEngine } from '../tokenisation/tokenisationEngine.ts';
import { signoffEngine } from '../review/signoffEngine.ts';
import { DetokenisedCopyModal } from './DetokenisedCopyModal.tsx';
import { AttributionInspectorModal } from './AttributionInspectorModal.tsx';
import { CasebookExportModal } from './CasebookExportModal.tsx';

interface CaseNoteReviewPanelProps {
  session: SessionState;
  onGenerateCaseNote: () => void;
  isGenerating: boolean;
  onDestroySession?: () => void;
}

export const CaseNoteReviewPanel: React.FC<CaseNoteReviewPanelProps> = ({
  session,
  onGenerateCaseNote,
  isGenerating,
  onDestroySession,
}) => {
  const viewMode = session.caseNoteViewMode || 'detokenised';
  const tokenMap = session.tokenMap || {};

  // Active highlighted segments for bidirectional navigation
  const [highlightedTranscriptSnippet, setHighlightedTranscriptSnippet] = useState<string | null>(null);
  const [highlightedNoteSection, setHighlightedNoteSection] = useState<string | null>(null);
  const [activeAttribution, setActiveAttribution] = useState<CaseNoteAttribution | null>(null);

  // Modals state
  const [isDetokenisedModalOpen, setIsDetokenisedModalOpen] = useState(false);
  const [isCasebookExportModalOpen, setIsCasebookExportModalOpen] = useState(false);
  const [casebookExportText, setCasebookExportText] = useState('');
  const [exportDurationMs, setExportDurationMs] = useState(0);

  // Note text content
  const rawNote = session.draftCaseNote || '';
  const tokenisedNote = tokenisationEngine.tokeniseText(rawNote, tokenMap);
  const detokenisedNote = tokenisationEngine.detokeniseText(rawNote, tokenMap);
  const displayedNote = viewMode === 'tokenised' ? tokenisedNote : detokenisedNote;
  const [noteContent, setNoteContent] = useState(displayedNote);

  // Working transcript content
  const transcriptText =
    session.detokenisedWorkingTranscript ||
    session.cloudAccurateTranscript ||
    session.localDraftTranscript ||
    '';

  const transcriptPaneRef = useRef<HTMLDivElement>(null);
  const noteEditorRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setNoteContent(displayedNote);
  }, [displayedNote, viewMode]);

  // Evaluate Anti-Automation Bias Sign-off Readiness
  const readiness = signoffEngine.evaluateSignoffReadiness(session);
  const safeguardingAssessment = signoffEngine.detectSafeguardingSignals(session);
  const lowConfidenceItems = signoffEngine.extractLowConfidenceAttributions(session.caseNoteAttributions || []);

  const handleToggleView = (mode: 'tokenised' | 'detokenised') => {
    volatileSessionStore.setCaseNoteViewMode(mode);
  };

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const updated = e.target.value;
    setNoteContent(updated);
    if (viewMode === 'tokenised') {
      const detok = tokenisationEngine.detokeniseText(updated, tokenMap);
      volatileSessionStore.updateCaseNoteMarkdown(detok);
    } else {
      volatileSessionStore.updateCaseNoteMarkdown(updated);
    }
  };

  // Bidirectional Navigation: Case Note -> Working Transcript
  const handleAttributionClick = (attr: CaseNoteAttribution) => {
    setActiveAttribution(attr);
    setHighlightedTranscriptSnippet(attr.transcriptSnippet);
    setHighlightedNoteSection(attr.sectionName);

    // Scroll transcript pane into view
    if (transcriptPaneRef.current) {
      const elements = transcriptPaneRef.current.querySelectorAll('[data-snippet-text]');
      for (const el of elements) {
        if (el.textContent?.includes(attr.transcriptSnippet.slice(0, 30))) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          break;
        }
      }
    }
  };

  // Bidirectional Navigation: Working Transcript -> Case Note
  const handleTranscriptLineClick = (lineText: string) => {
    setHighlightedTranscriptSnippet(lineText);

    // Find if any attribution matches this line
    const matched = (session.caseNoteAttributions || []).find((attr) =>
      lineText.toLowerCase().includes(attr.transcriptSnippet.toLowerCase()) ||
      attr.transcriptSnippet.toLowerCase().includes(lineText.toLowerCase())
    );

    if (matched) {
      setHighlightedNoteSection(matched.sectionName);
      setActiveAttribution(matched);
    } else {
      // Find section header in note text
      setHighlightedNoteSection(null);
    }
  };

  // Checkbox handlers for anti-automation friction (strictly individual, no bulk)
  const handleToggleGap = (gapText: string, currentStatus: boolean) => {
    volatileSessionStore.toggleGapAcknowledgement(gapText, !currentStatus);
  };

  const handleToggleLowConfidence = (id: string, currentStatus: boolean) => {
    volatileSessionStore.toggleLowConfidenceConfirmation(id, !currentStatus);
  };

  const handleToggleSafeguarding = (currentStatus: boolean) => {
    volatileSessionStore.setSafeguardingConfirmation(!currentStatus);
  };

  const handleToggleProfessionalDeclaration = (currentStatus: boolean) => {
    volatileSessionStore.setProfessionalDeclaration(!currentStatus);
  };

  // Execute Sign-off
  const handleExecuteSignoff = async () => {
    const adviserName = session.metadata.adviserId || 'Adviser';
    const result = await signoffEngine.executeSignoff(session, adviserName);
    if (result.success) {
      setCasebookExportText(result.casebookNote);
      setExportDurationMs(result.durationMs);
      setIsCasebookExportModalOpen(true);
    }
  };

  const attributions = session.caseNoteAttributions || [];
  const gaps = session.caseNoteGaps || [];

  return (
    <div
      id="phase14-review-signoff-panel"
      style={{
        backgroundColor: '#FFFFFF',
        border: '1px solid #CBD5E1',
        borderRadius: '8px',
        padding: '1.25rem',
        marginTop: '1.5rem',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
      }}
    >
      {/* Header Bar */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '1rem',
          marginBottom: '1rem',
          borderBottom: '1px solid #E2E8F0',
          paddingBottom: '0.875rem',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <FileText size={20} color="#004B87" />
            <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700, color: '#0F172A' }}>
              Phase 14: Adviser Review, Verification & Sign-Off
            </h3>
            {session.promptVersion && (
              <span
                style={{
                  fontSize: '0.75rem',
                  padding: '0.2rem 0.5rem',
                  borderRadius: '9999px',
                  fontWeight: 600,
                  backgroundColor: '#EFF6FF',
                  color: '#1D4ED8',
                }}
              >
                Prompt {session.promptVersion}
              </span>
            )}
          </div>
          <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8125rem', color: '#64748B' }}>
            Conforms to Citizens Advice AQS Level 3 Standard. Professional responsibility rests with the adviser.
          </p>
        </div>

        {/* View Mode Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div
            role="group"
            aria-label="Case Note Token Display Mode"
            style={{
              display: 'inline-flex',
              borderRadius: '6px',
              border: '1px solid #CBD5E1',
              padding: '2px',
              backgroundColor: '#F1F5F9',
            }}
          >
            <button
              type="button"
              id="case-note-toggle-detokenised-btn"
              onClick={() => handleToggleView('detokenised')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.375rem',
                padding: '0.35rem 0.75rem',
                borderRadius: '4px',
                border: 'none',
                backgroundColor: viewMode === 'detokenised' ? '#FFFFFF' : 'transparent',
                color: viewMode === 'detokenised' ? '#0F172A' : '#64748B',
                fontWeight: viewMode === 'detokenised' ? 700 : 500,
                fontSize: '0.8125rem',
                cursor: 'pointer',
                boxShadow: viewMode === 'detokenised' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
              }}
            >
              <Eye size={14} color={viewMode === 'detokenised' ? '#0284C7' : '#64748B'} />
              Detokenised (Plaintext)
            </button>
            <button
              type="button"
              id="case-note-toggle-tokenised-btn"
              onClick={() => handleToggleView('tokenised')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.375rem',
                padding: '0.35rem 0.75rem',
                borderRadius: '4px',
                border: 'none',
                backgroundColor: viewMode === 'tokenised' ? '#1E293B' : 'transparent',
                color: viewMode === 'tokenised' ? '#FFFFFF' : '#64748B',
                fontWeight: viewMode === 'tokenised' ? 700 : 500,
                fontSize: '0.8125rem',
                cursor: 'pointer',
                boxShadow: viewMode === 'tokenised' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
              }}
            >
              <Shield size={14} color={viewMode === 'tokenised' ? '#38BDF8' : '#64748B'} />
              Tokenised [SURROGATE]
            </button>
          </div>

          <button
            type="button"
            onClick={onGenerateCaseNote}
            disabled={isGenerating}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.375rem',
              backgroundColor: '#004B87',
              color: '#FFFFFF',
              border: 'none',
              padding: '0.45rem 0.875rem',
              borderRadius: '6px',
              fontWeight: 600,
              fontSize: '0.8125rem',
              cursor: isGenerating ? 'not-allowed' : 'pointer',
              opacity: isGenerating ? 0.7 : 1,
            }}
          >
            <Sparkles size={14} />
            {isGenerating ? 'Drafting Master Template Note...' : 'Regenerate Note'}
          </button>
        </div>
      </div>

      {/* Prominent Safeguarding Routing Banner (Mandatory Protocol) */}
      {safeguardingAssessment.isTriggered && (
        <div
          id="safeguarding-review-banner"
          style={{
            marginBottom: '1.25rem',
            padding: '1rem 1.25rem',
            borderRadius: '8px',
            backgroundColor: '#FEF2F2',
            border: '2px solid #EF4444',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
            <ShieldAlert size={24} color="#DC2626" style={{ flexShrink: 0, marginTop: '2px' }} />
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h4 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 700, color: '#991B1B' }}>
                  MANDATORY SAFEGUARDING / HIGH RISK ALERT
                </h4>
                <a
                  href={safeguardingAssessment.policyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: '#DC2626',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                    textDecoration: 'underline',
                  }}
                >
                  {safeguardingAssessment.policyReference}
                  <ExternalLink size={12} />
                </a>
              </div>
              <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8125rem', color: '#B91C1C', lineHeight: 1.4 }}>
                Potential safeguarding or vulnerability indicators were identified in this consultation. You must follow CAW Safeguarding SOP protocol before finalizing this case note.
              </p>
              <ul style={{ margin: '0.375rem 0 0 1.25rem', padding: 0, fontSize: '0.75rem', color: '#991B1B' }}>
                {safeguardingAssessment.triggerReasons.map((reason, idx) => (
                  <li key={idx}>{reason}</li>
                ))}
              </ul>
            </div>
          </div>

          <div
            style={{
              paddingTop: '0.5rem',
              borderTop: '1px solid #FECACA',
              display: 'flex',
              alignItems: 'center',
              gap: '0.625rem',
            }}
          >
            <input
              type="checkbox"
              id="safeguarding-confirmation-checkbox"
              checked={session.safeguardingConfirmed || false}
              onChange={() => handleToggleSafeguarding(session.safeguardingConfirmed || false)}
              style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#DC2626' }}
            />
            <label
              htmlFor="safeguarding-confirmation-checkbox"
              style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#7F1D1D', cursor: 'pointer' }}
            >
              I confirm I have assessed all safeguarding risks against CAW-SOP-SAFE-01 and executed required escalations.
            </label>
          </div>
        </div>
      )}

      {/* Side-by-Side Synchronized Split View (Phase 14 Anti-Automation Bias) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.15fr) minmax(0, 0.85fr)',
          gap: '1.25rem',
          minHeight: '480px',
        }}
      >
        {/* Left Pane: Fully Editable Case Note Draft */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label
              htmlFor="case-note-editor-textarea"
              style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#1E293B' }}
            >
              Case Note Draft (Editable) {viewMode === 'tokenised' ? '[Tokenised View]' : '[Detokenised View]'}:
            </label>
            <span style={{ fontSize: '0.75rem', color: '#64748B' }}>
              Click statements or attributions to trace source in transcript
            </span>
          </div>

          {highlightedNoteSection && (
            <div
              style={{
                padding: '0.375rem 0.75rem',
                backgroundColor: '#EFF6FF',
                border: '1px solid #BFDBFE',
                borderRadius: '6px',
                fontSize: '0.75rem',
                color: '#1E40AF',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span>
                Selected Section from Transcript: <strong>{highlightedNoteSection}</strong>
              </span>
              <button
                type="button"
                onClick={() => setHighlightedNoteSection(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#1E40AF',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.75rem',
                }}
              >
                Clear
              </button>
            </div>
          )}

          <textarea
            id="case-note-editor-textarea"
            ref={noteEditorRef}
            value={noteContent}
            onChange={handleContentChange}
            rows={18}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            translate="no"
            className="notranslate"
            data-gramm="false"
            data-gramm_editor="false"
            data-enable-grammarly="false"
            style={{
              width: '100%',
              padding: '0.875rem',
              borderRadius: '8px',
              border: '1px solid #CBD5E1',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              fontSize: '0.8125rem',
              lineHeight: 1.5,
              backgroundColor: '#FFFFFF',
              color: '#0F172A',
              resize: 'vertical',
              flex: 1,
            }}
          />

          {/* Low Confidence Statements Review Box (Deliberate Friction) */}
          {lowConfidenceItems.length > 0 && (
            <div
              style={{
                backgroundColor: '#FFFBEB',
                border: '1px solid #FDE68A',
                borderRadius: '8px',
                padding: '0.875rem 1rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <AlertTriangle size={16} color="#D97706" />
                <h5 style={{ margin: 0, fontSize: '0.8125rem', fontWeight: 700, color: '#92400E' }}>
                  Low-Confidence Statements ({lowConfidenceItems.length}) - Individual Confirmation Required:
                </h5>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {lowConfidenceItems.map((item) => {
                  const isConfirmed = (session.confirmedLowConfidenceAttributions || []).includes(item.id);
                  return (
                    <div
                      key={item.id}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '0.5rem',
                        backgroundColor: '#FFFFFF',
                        padding: '0.5rem 0.75rem',
                        borderRadius: '6px',
                        border: isConfirmed ? '1px solid #86EFAC' : '1px solid #FCD34D',
                      }}
                    >
                      <input
                        type="checkbox"
                        id={`low-conf-${item.id}`}
                        checked={isConfirmed}
                        onChange={() => handleToggleLowConfidence(item.id, isConfirmed)}
                        style={{ marginTop: '3px', cursor: 'pointer', accentColor: '#D97706' }}
                      />
                      <label htmlFor={`low-conf-${item.id}`} style={{ fontSize: '0.75rem', color: '#78350F', cursor: 'pointer', flex: 1 }}>
                        <strong>[{item.sectionName}]</strong> "{item.statementText}"
                        <div style={{ fontSize: '0.6875rem', color: '#92400E', marginTop: '2px' }}>
                          Source: "{item.transcriptSnippet}"
                        </div>
                      </label>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Gaps and Limitations Individual Acknowledgements (Deliberate Friction) */}
          {gaps.length > 0 && (
            <div
              id="gaps-review-box"
              style={{
                backgroundColor: '#F8FAFC',
                border: '1px solid #E2E8F0',
                borderRadius: '8px',
                padding: '0.875rem 1rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <HelpCircle size={16} color="#004B87" />
                <h5 style={{ margin: 0, fontSize: '0.8125rem', fontWeight: 700, color: '#1E293B' }}>
                  Gaps & Limitations ({gaps.length}) - Individual Verification Required:
                </h5>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                {gaps.map((gapText, index) => {
                  const isAck = (session.acknowledgedGaps || []).includes(gapText);
                  return (
                    <div
                      key={index}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        backgroundColor: isAck ? '#F0FDF4' : '#FFFFFF',
                        padding: '0.35rem 0.625rem',
                        borderRadius: '4px',
                        border: isAck ? '1px solid #BBF7D0' : '1px solid #CBD5E1',
                      }}
                    >
                      <input
                        type="checkbox"
                        id={`gap-checkbox-${index}`}
                        checked={isAck}
                        onChange={() => handleToggleGap(gapText, isAck)}
                        style={{ cursor: 'pointer', accentColor: '#004B87' }}
                      />
                      <label
                        htmlFor={`gap-checkbox-${index}`}
                        style={{
                          fontSize: '0.75rem',
                          color: isAck ? '#166534' : '#334155',
                          cursor: 'pointer',
                          fontWeight: isAck ? 600 : 400,
                        }}
                      >
                        {gapText}
                      </label>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right Pane: Source Working Transcript & Attributions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#1E293B' }}>
              Working Transcript (Source Evidence):
            </span>
            <span style={{ fontSize: '0.75rem', color: '#64748B' }}>
              Click any line to find corresponding note section
            </span>
          </div>

          <div
            ref={transcriptPaneRef}
            style={{
              flex: 1,
              maxHeight: '420px',
              overflowY: 'auto',
              padding: '0.875rem',
              backgroundColor: '#F8FAFC',
              borderRadius: '8px',
              border: '1px solid #CBD5E1',
              fontSize: '0.8125rem',
              lineHeight: 1.6,
            }}
          >
            {transcriptText.split('\n').map((line, idx) => {
              if (!line.trim()) return null;
              const isHighlighted = highlightedTranscriptSnippet && line.includes(highlightedTranscriptSnippet);
              return (
                <div
                  key={idx}
                  data-snippet-text={line}
                  onClick={() => handleTranscriptLineClick(line)}
                  style={{
                    padding: '0.35rem 0.5rem',
                    marginBottom: '0.25rem',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    backgroundColor: isHighlighted ? '#FEF08A' : 'transparent',
                    borderLeft: isHighlighted ? '3px solid #EAB308' : '3px solid transparent',
                    color: '#1E293B',
                    transition: 'background-color 0.15s ease',
                  }}
                >
                  {line}
                </div>
              );
            })}
          </div>

          {/* Attributions Quick-Navigator */}
          {attributions.length > 0 && (
            <div
              style={{
                backgroundColor: '#FFFFFF',
                border: '1px solid #E2E8F0',
                borderRadius: '8px',
                padding: '0.75rem',
                maxHeight: '220px',
                overflowY: 'auto',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginBottom: '0.375rem' }}>
                <Quote size={14} color="#004B87" />
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#1E293B' }}>
                  Attribution Evidence Links ({attributions.length}):
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                {attributions.map((attr) => (
                  <button
                    key={attr.id}
                    type="button"
                    onClick={() => handleAttributionClick(attr)}
                    style={{
                      textAlign: 'left',
                      padding: '0.35rem 0.5rem',
                      borderRadius: '4px',
                      border: activeAttribution?.id === attr.id ? '1px solid #38BDF8' : '1px solid transparent',
                      backgroundColor: activeAttribution?.id === attr.id ? '#EFF6FF' : '#F8FAFC',
                      fontSize: '0.6875rem',
                      color: '#334155',
                      cursor: 'pointer',
                    }}
                  >
                    <strong>[{attr.sectionName}]</strong> {attr.statementText.slice(0, 60)}...
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Affirmative Professional Responsibility Declaration (Solemn Legal Requirement) */}
      <div
        id="professional-declaration-box"
        style={{
          marginTop: '1.25rem',
          padding: '1rem 1.25rem',
          borderRadius: '8px',
          backgroundColor: '#F1F5F9',
          border: '1px solid #CBD5E1',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '0.75rem',
        }}
      >
        <input
          type="checkbox"
          id="affirmative-professional-declaration-checkbox"
          checked={session.professionalDeclarationConfirmed || false}
          onChange={() => handleToggleProfessionalDeclaration(session.professionalDeclarationConfirmed || false)}
          style={{ width: '20px', height: '20px', marginTop: '2px', cursor: 'pointer', accentColor: '#004B87' }}
        />
        <div>
          <label
            htmlFor="affirmative-professional-declaration-checkbox"
            style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#0F172A', cursor: 'pointer' }}
          >
            Affirmative Professional Record Declaration (CAW Information Governance Standard):
          </label>
          <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.75rem', color: '#475569', lineHeight: 1.4 }}>
            I confirm that I have reviewed, verified, and edited this case note to ensure factual accuracy. This record represents my own professional work and advice given, not an automated recommendation. I understand that <strong>full professional responsibility for this record rests entirely with me as the advising practitioner.</strong>
          </p>
        </div>
      </div>

      {/* Sign-off Action Bar & Anti-Automation Gate */}
      <div
        style={{
          marginTop: '1.25rem',
          paddingTop: '1rem',
          borderTop: '1px solid #E2E8F0',
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '1rem',
        }}
      >
        {/* Readiness Checklist Indicator */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', fontSize: '0.75rem' }}>
          <span
            style={{
              padding: '0.25rem 0.5rem',
              borderRadius: '9999px',
              fontWeight: 600,
              backgroundColor: readiness.gapsRemaining === 0 ? '#DCFCE7' : '#FEE2E2',
              color: readiness.gapsRemaining === 0 ? '#166534' : '#991B1B',
            }}
          >
            {readiness.acknowledgedGapsCount}/{readiness.totalGapsCount} Gaps Acknowledged
          </span>

          {readiness.totalLowConfidenceCount > 0 && (
            <span
              style={{
                padding: '0.25rem 0.5rem',
                borderRadius: '9999px',
                fontWeight: 600,
                backgroundColor: readiness.lowConfidenceRemaining === 0 ? '#DCFCE7' : '#FEF3C7',
                color: readiness.lowConfidenceRemaining === 0 ? '#166534' : '#92400E',
              }}
            >
              {readiness.confirmedLowConfidenceCount}/{readiness.totalLowConfidenceCount} Low Conf Confirmed
            </span>
          )}

          {readiness.safeguardingTriggered && (
            <span
              style={{
                padding: '0.25rem 0.5rem',
                borderRadius: '9999px',
                fontWeight: 600,
                backgroundColor: readiness.safeguardingConfirmed ? '#DCFCE7' : '#FEE2E2',
                color: readiness.safeguardingConfirmed ? '#166534' : '#991B1B',
              }}
            >
              {readiness.safeguardingConfirmed ? 'Safeguarding Confirmed' : 'Safeguarding Action Pending'}
            </span>
          )}

          <span
            style={{
              padding: '0.25rem 0.5rem',
              borderRadius: '9999px',
              fontWeight: 600,
              backgroundColor: readiness.professionalDeclarationConfirmed ? '#DCFCE7' : '#F1F5F9',
              color: readiness.professionalDeclarationConfirmed ? '#166534' : '#64748B',
            }}
          >
            {readiness.professionalDeclarationConfirmed ? 'Declaration Signed' : 'Declaration Required'}
          </span>
        </div>

        {/* Primary Hard-Locked Sign-off Button */}
        <button
          type="button"
          id="phase14-signoff-btn"
          onClick={handleExecuteSignoff}
          disabled={!readiness.canSignoff}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            backgroundColor: readiness.canSignoff ? '#16A34A' : '#94A3B8',
            color: '#FFFFFF',
            border: 'none',
            padding: '0.625rem 1.25rem',
            borderRadius: '8px',
            fontWeight: 700,
            fontSize: '0.875rem',
            cursor: readiness.canSignoff ? 'pointer' : 'not-allowed',
            boxShadow: readiness.canSignoff ? '0 2px 4px rgba(0,0,0,0.1)' : 'none',
            transition: 'background-color 0.2s ease',
          }}
        >
          <Check size={16} />
          {readiness.canSignoff ? 'Sign Off & Export Casebook Record' : 'Sign Off Locked (Complete Checklist)'}
        </button>
      </div>

      {/* Casebook Export Modal (Clipboard Only, Prompt for Destruction) */}
      <CasebookExportModal
        isOpen={isCasebookExportModalOpen}
        casebookNote={casebookExportText}
        adviserName={session.metadata.adviserId || 'Adviser'}
        durationMs={exportDurationMs}
        onClose={() => setIsCasebookExportModalOpen(false)}
        onDestroySession={() => {
          setIsCasebookExportModalOpen(false);
          if (onDestroySession) {
            onDestroySession();
          } else {
            volatileSessionStore.destroySession();
          }
        }}
      />

      {/* Detokenised Copy Safety Warning Modal */}
      <DetokenisedCopyModal
        isOpen={isDetokenisedModalOpen}
        contentToCopy={detokenisedNote}
        contentType="case_note"
        onClose={() => setIsDetokenisedModalOpen(false)}
        onConfirmCopy={() => {
          setIsDetokenisedModalOpen(false);
        }}
      />

      {/* Attribution Inspector Modal */}
      {activeAttribution && (
        <AttributionInspectorModal
          attribution={activeAttribution}
          onClose={() => setActiveAttribution(null)}
        />
      )}
    </div>
  );
};
