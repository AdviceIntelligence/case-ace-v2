/**
 * @file TranscriptReviewPanel.tsx
 * @description Interactive Working Transcript Review, Tokenisation Toggle,
 * Live Bidirectional Editing, and Safe Clipboard Export Component.
 * 
 * Invariants:
 * 1. Default view is DETOKENISED to allow the adviser to review factual accuracy.
 * 2. Toggle state is unmistakable with high-contrast visual status indicators.
 * 3. Live edits in either view propagate cleanly in both directions.
 * 4. Token integrity warning appears if an adviser corrupts surrogate token syntax.
 * 5. Clipboard export of detokenised text triggers a safety confirmation modal.
 * 6. Zero file download path (enforcing Constraint C1).
 */

import React, { useState, useEffect } from 'react';
import {
  Eye,
  Shield,
  AlertTriangle,
  Copy,
  Check,
  Edit3,
  Lock,
} from 'lucide-react';
import { volatileSessionStore, type SessionState } from '../state/volatileStore.ts';
import { tokenisationEngine } from '../tokenisation/tokenisationEngine.ts';
import { DetokenisedCopyModal } from './DetokenisedCopyModal.tsx';

interface TranscriptReviewPanelProps {
  session: SessionState;
  onProceedToDrafting?: () => void;
}

export const TranscriptReviewPanel: React.FC<TranscriptReviewPanelProps> = ({
  session,
  onProceedToDrafting,
}) => {
  const [copiedTokenised, setCopiedTokenised] = useState(false);
  const [isDetokenisedModalOpen, setIsDetokenisedModalOpen] = useState(false);
  const [copiedDetokenised, setCopiedDetokenised] = useState(false);
  const [integrityWarnings, setIntegrityWarnings] = useState<string[]>([]);
  const [textValue, setTextValue] = useState<string>('');

  const viewMode = session.transcriptViewMode || 'detokenised';
  const tokenMap = session.tokenMap || {};

  useEffect(() => {
    const current =
      viewMode === 'tokenised'
        ? session.tokenisedWorkingTranscript || session.tokenisedTranscript || ''
        : session.detokenisedWorkingTranscript || session.transcript?.fullTranscript || '';
    setTextValue(current);
  }, [viewMode, session.tokenisedWorkingTranscript, session.detokenisedWorkingTranscript, session.transcript, session.tokenisedTranscript]);

  const handleToggleView = (newMode: 'tokenised' | 'detokenised') => {
    volatileSessionStore.setTranscriptViewMode(newMode);
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const updated = e.target.value;
    setTextValue(updated);

    // Run bidirectional synchronization
    const syncResult = tokenisationEngine.syncEditedTranscript(updated, viewMode, tokenMap);
    setIntegrityWarnings(syncResult.tokenIntegrityWarnings || []);

    if (viewMode === 'tokenised') {
      volatileSessionStore.updateWorkingTranscript(
        updated,
        'tokenised',
        syncResult.detokenisedText,
        syncResult.tokenIntegrityWarnings
      );
    } else {
      volatileSessionStore.updateWorkingTranscript(
        updated,
        'detokenised',
        syncResult.tokenisedText,
        syncResult.tokenIntegrityWarnings
      );
    }
  };

  const handleCopyTokenised = () => {
    const tokenisedContent = session.tokenisedWorkingTranscript || session.tokenisedTranscript || textValue;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(tokenisedContent).then(() => {
        setCopiedTokenised(true);
        setTimeout(() => setCopiedTokenised(false), 2500);
      });
    }
  };

  const handleCopyDetokenisedClick = () => {
    setIsDetokenisedModalOpen(true);
  };

  const handleConfirmDetokenisedCopy = () => {
    setCopiedDetokenised(true);
    setTimeout(() => setCopiedDetokenised(false), 2500);
  };

  return (
    <div
      style={{
        backgroundColor: '#FFFFFF',
        border: '1px solid #CBD5E1',
        borderRadius: '8px',
        padding: '1.25rem',
        marginTop: '1rem',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
      }}
    >
      {/* Header & Mode Switcher */}
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
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#0F172A' }}>
              Working Transcript Review
            </h3>
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
              Cloud STT (europe-west2)
            </span>
            {session.isTranscriptEdited && (
              <span
                style={{
                  fontSize: '0.75rem',
                  padding: '0.2rem 0.5rem',
                  borderRadius: '9999px',
                  fontWeight: 600,
                  backgroundColor: '#F3E8FF',
                  color: '#7E22CE',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                }}
              >
                <Edit3 size={12} /> Edited
              </span>
            )}
          </div>
          <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8125rem', color: '#64748B' }}>
            Verify factual accuracy or correct transcription errors. All edits sync live between views.
          </p>
        </div>

        {/* Segmented View Toggle Control */}
        <div
          role="group"
          aria-label="Transcript View Mode"
          style={{
            display: 'flex',
            backgroundColor: '#F1F5F9',
            padding: '3px',
            borderRadius: '8px',
            border: '1px solid #CBD5E1',
          }}
        >
          <button
            type="button"
            id="toggle-detokenised-btn"
            onClick={() => handleToggleView('detokenised')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.375rem',
              padding: '0.4rem 0.875rem',
              borderRadius: '6px',
              border: 'none',
              fontSize: '0.8125rem',
              fontWeight: viewMode === 'detokenised' ? 700 : 500,
              backgroundColor: viewMode === 'detokenised' ? '#D97706' : 'transparent',
              color: viewMode === 'detokenised' ? '#FFFFFF' : '#475569',
              cursor: 'pointer',
              boxShadow: viewMode === 'detokenised' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
              transition: 'all 0.15s ease',
            }}
          >
            <Eye size={14} />
            Detokenised (Plaintext)
          </button>

          <button
            type="button"
            id="toggle-tokenised-btn"
            onClick={() => handleToggleView('tokenised')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.375rem',
              padding: '0.4rem 0.875rem',
              borderRadius: '6px',
              border: 'none',
              fontSize: '0.8125rem',
              fontWeight: viewMode === 'tokenised' ? 700 : 500,
              backgroundColor: viewMode === 'tokenised' ? '#0284C7' : 'transparent',
              color: viewMode === 'tokenised' ? '#FFFFFF' : '#475569',
              cursor: 'pointer',
              boxShadow: viewMode === 'tokenised' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
              transition: 'all 0.15s ease',
            }}
          >
            <Shield size={14} />
            Tokenised (Pseudonymised)
          </button>
        </div>
      </div>

      {/* Unmistakable View Status Banner */}
      {viewMode === 'detokenised' ? (
        <div
          id="detokenised-view-indicator"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.625rem',
            backgroundColor: '#FEF3C7',
            border: '1px solid #FDE68A',
            borderRadius: '6px',
            padding: '0.625rem 0.875rem',
            marginBottom: '0.75rem',
            color: '#92400E',
            fontSize: '0.8125rem',
            fontWeight: 600,
          }}
        >
          <AlertTriangle size={16} color="#D97706" style={{ flexShrink: 0 }} />
          <span>
            ⚠️ <strong>PLAINTEXT DETOKENISED VIEW</strong> — Contains real client identifiable names and addresses for adviser accuracy review. DO NOT paste into unsecured external channels.
          </span>
        </div>
      ) : (
        <div
          id="tokenised-view-indicator"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.625rem',
            backgroundColor: '#E0F2FE',
            border: '1px solid #BAE6FD',
            borderRadius: '6px',
            padding: '0.625rem 0.875rem',
            marginBottom: '0.75rem',
            color: '#0369A1',
            fontSize: '0.8125rem',
            fontWeight: 600,
          }}
        >
          <Shield size={16} color="#0284C7" style={{ flexShrink: 0 }} />
          <span>
            🛡️ <strong>PSEUDONYMISED TOKENISED VIEW</strong> — Real identifiers are substituted with numbered surrogate tokens (e.g. [CLIENT_FORENAME]). Safe for transmission to AI note drafter.
          </span>
        </div>
      )}

      {/* Token Integrity Warnings Callout */}
      {integrityWarnings.length > 0 && (
        <div
          style={{
            backgroundColor: '#FEE2E2',
            border: '1px solid #FCA5A5',
            borderRadius: '6px',
            padding: '0.625rem 0.875rem',
            marginBottom: '0.75rem',
            color: '#991B1B',
            fontSize: '0.8125rem',
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            <AlertTriangle size={14} /> Token Integrity Alert
          </div>
          <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
            {integrityWarnings.map((w, idx) => (
              <li key={idx}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Editable Working Transcript Textarea */}
      <textarea
        id="working-transcript-editor"
        name="workingTranscript"
        rows={10}
        value={textValue}
        onChange={handleTextChange}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        translate="no"
        className="notranslate"
        data-gramm="false"
        data-enable-grammarly="false"
        placeholder={
          viewMode === 'detokenised'
            ? 'Detokenised working transcript with real names for review...'
            : 'Tokenised working transcript with surrogate tokens...'
        }
        style={{
          width: '100%',
          padding: '0.875rem',
          borderRadius: '6px',
          border: viewMode === 'detokenised' ? '1.5px solid #F59E0B' : '1.5px solid #0284C7',
          fontSize: '0.875rem',
          lineHeight: 1.6,
          fontFamily: 'monospace',
          backgroundColor: '#FFFFFF',
          color: '#1E293B',
          resize: 'vertical',
          boxSizing: 'border-box',
        }}
      />

      {/* Footer Controls: Clipboard Copy & Privacy Enforcement */}
      <div
        style={{
          marginTop: '1rem',
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '0.75rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem', color: '#64748B' }}>
          <Lock size={14} color="#059669" />
          <span>Token map confined to RAM (VolatileStore). File downloads disabled per C1.</span>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          {onProceedToDrafting && (
            <button
              type="button"
              id="proceed-to-drafting-btn"
              onClick={onProceedToDrafting}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.375rem',
                padding: '0.45rem 0.875rem',
                borderRadius: '6px',
                border: 'none',
                backgroundColor: '#004B87',
                color: '#FFFFFF',
                fontWeight: 600,
                fontSize: '0.8125rem',
                cursor: 'pointer',
              }}
            >
              Proceed to Draft Case Note
            </button>
          )}

          <button
            type="button"
            id="copy-tokenised-transcript-btn"
            onClick={handleCopyTokenised}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.375rem',
              padding: '0.45rem 0.875rem',
              borderRadius: '6px',
              border: '1px solid #CBD5E1',
              backgroundColor: '#FFFFFF',
              color: '#0284C7',
              fontWeight: 600,
              fontSize: '0.8125rem',
              cursor: 'pointer',
            }}
          >
            {copiedTokenised ? <Check size={14} color="#059669" /> : <Copy size={14} />}
            {copiedTokenised ? 'Copied Tokenised!' : 'Copy Tokenised'}
          </button>

          <button
            type="button"
            id="copy-detokenised-transcript-btn"
            onClick={handleCopyDetokenisedClick}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.375rem',
              padding: '0.45rem 0.875rem',
              borderRadius: '6px',
              border: '1px solid #F59E0B',
              backgroundColor: '#FFFBEB',
              color: '#92400E',
              fontWeight: 600,
              fontSize: '0.8125rem',
              cursor: 'pointer',
            }}
          >
            {copiedDetokenised ? <Check size={14} color="#059669" /> : <Copy size={14} />}
            {copiedDetokenised ? 'Copied Plaintext!' : 'Copy Detokenised (Sensitive)'}
          </button>
        </div>
      </div>

      {/* Detokenised Copy Safety Warning Modal */}
      <DetokenisedCopyModal
        isOpen={isDetokenisedModalOpen}
        contentToCopy={session.detokenisedWorkingTranscript || textValue}
        contentType="transcript"
        onClose={() => setIsDetokenisedModalOpen(false)}
        onConfirmCopy={handleConfirmDetokenisedCopy}
      />
    </div>
  );
};
