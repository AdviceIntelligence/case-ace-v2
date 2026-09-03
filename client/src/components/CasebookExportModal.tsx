/**
 * @file CasebookExportModal.tsx
 * @description Casebook Clipboard Export & Session Destruction Modal (Phase 14).
 * 
 * Invariants:
 * 1. Exports detokenised Casebook format directly to clipboard only.
 * 2. Strictly NO file write or file download path (enforces Constraint C1).
 * 3. Immediately prompts for active session destruction once copied.
 */

import React, { useState } from 'react';
import { ShieldCheck, Copy, Check, Trash2, AlertOctagon, ExternalLink, Clock } from 'lucide-react';
import { logSecurityEvent } from '../monitoring/eventLogger.ts';
import { volatileSessionStore } from '../state/volatileStore.ts';
import { markDetokenisedContentCopied } from '../state/sessionDestruction.ts';

interface CasebookExportModalProps {
  isOpen: boolean;
  casebookNote: string;
  adviserName: string;
  durationMs: number;
  onClose: () => void;
  onDestroySession: () => void;
}

export const CasebookExportModal: React.FC<CasebookExportModalProps> = ({
  isOpen,
  casebookNote,
  adviserName,
  durationMs,
  onClose,
  onDestroySession,
}) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopy = async () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(casebookNote);
        markDetokenisedContentCopied();
        setCopied(true);
        const activeSessionId = volatileSessionStore.getState()?.sessionId || 'unknown';
        logSecurityEvent({
          type: 'casebook_export_copied',
          sessionId: activeSessionId,
          details: {
            adviserName,
            charCount: casebookNote.length,
            timestamp: new Date().toISOString(),
          },
        });
        setTimeout(() => setCopied(false), 4000);
      } catch (err) {
        console.error('Failed to copy to clipboard', err);
      }
    }
  };

  const minutes = Math.floor(durationMs / 60000);
  const seconds = Math.floor((durationMs % 60000) / 1000);
  const timeFormatted = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="casebook-export-title"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '1rem',
      }}
    >
      <div
        style={{
          backgroundColor: '#FFFFFF',
          borderRadius: '12px',
          width: '100%',
          maxWidth: '780px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          border: '1px solid #CBD5E1',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '1.25rem 1.5rem',
            backgroundColor: '#F0FDF4',
            borderBottom: '1px solid #BBF7D0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '8px',
                backgroundColor: '#DCFCE7',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ShieldCheck size={24} color="#15803D" />
            </div>
            <div>
              <h3
                id="casebook-export-title"
                style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700, color: '#166534' }}
              >
                Case Note Signed Off & Ready for Casebook
              </h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
                <span style={{ fontSize: '0.8125rem', color: '#15803D' }}>
                  Signed by {adviserName}
                </span>
                <span style={{ color: '#86EFAC' }}>•</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.8125rem', color: '#15803D' }}>
                  <Clock size={13} />
                  Review time: {timeFormatted}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Info Banner */}
        <div
          style={{
            padding: '0.875rem 1.5rem',
            backgroundColor: '#EFF6FF',
            borderBottom: '1px solid #DBEAFE',
            fontSize: '0.8125rem',
            color: '#1E40AF',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <ExternalLink size={16} color="#2563EB" style={{ flexShrink: 0 }} />
          <span>
            <strong>Paste Directly into Casebook:</strong> Copy this plain-text record and paste it into the Casebook client session. File downloads are permanently disabled per CAW Data Governance Rule C1.
          </span>
        </div>

        {/* Content Box */}
        <div style={{ padding: '1.25rem 1.5rem', overflowY: 'auto', flex: 1, backgroundColor: '#F8FAFC' }}>
          <label
            htmlFor="casebook-content-preview"
            style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#64748B', marginBottom: '0.5rem' }}
          >
            DETOKENISED CASEBOOK PLAINTEXT RECORD:
          </label>
          <textarea
            id="casebook-content-preview"
            readOnly
            value={casebookNote}
            rows={14}
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
            }}
          />
        </div>

        {/* Actions & Destruction Warning */}
        <div
          style={{
            padding: '1.25rem 1.5rem',
            backgroundColor: '#FFFFFF',
            borderTop: '1px solid #E2E8F0',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
            <button
              type="button"
              id="casebook-copy-btn"
              onClick={handleCopy}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                backgroundColor: copied ? '#16A34A' : '#004B87',
                color: '#FFFFFF',
                border: 'none',
                padding: '0.75rem 1.5rem',
                borderRadius: '8px',
                fontWeight: 700,
                fontSize: '0.9375rem',
                cursor: 'pointer',
                flex: 1,
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                transition: 'background-color 0.2s ease',
              }}
            >
              {copied ? <Check size={18} /> : <Copy size={18} />}
              {copied ? 'Copied to Clipboard! Ready to Paste into Casebook' : 'Copy Casebook Note to Clipboard'}
            </button>

            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '0.75rem 1.25rem',
                borderRadius: '8px',
                border: '1px solid #CBD5E1',
                backgroundColor: '#FFFFFF',
                color: '#475569',
                fontWeight: 600,
                fontSize: '0.875rem',
                cursor: 'pointer',
              }}
            >
              Return to Review
            </button>
          </div>

          {/* Prompt for Session Destruction */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1rem',
              padding: '0.875rem 1rem',
              borderRadius: '8px',
              backgroundColor: '#FEF2F2',
              border: '1px solid #FECACA',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
              <AlertOctagon size={18} color="#DC2626" style={{ flexShrink: 0 }} />
              <span style={{ fontSize: '0.8125rem', color: '#991B1B' }}>
                Finished pasting into Casebook? Destroy active session in volatile RAM to prevent data persistence.
              </span>
            </div>

            <button
              type="button"
              id="destroy-session-post-export-btn"
              onClick={onDestroySession}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.375rem',
                backgroundColor: '#DC2626',
                color: '#FFFFFF',
                border: 'none',
                padding: '0.5rem 1rem',
                borderRadius: '6px',
                fontWeight: 700,
                fontSize: '0.8125rem',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              <Trash2 size={14} />
              Destroy Session Now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
