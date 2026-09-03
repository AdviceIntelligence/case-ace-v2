/**
 * @file DetokenisedCopyModal.tsx
 * @description Safety Confirmation Modal for Copying Detokenised Plaintext Content.
 * 
 * Invariants:
 * 1. Default to safety: Warns the adviser prominently before unredacted client data reaches the system clipboard.
 * 2. Explicit confirmation: Requires affirmative click ("I understand and confirm copy").
 * 3. Never offers a file download path (enforcing Constraint C1).
 * 4. Logs security telemetry on confirmation with zero PII in details.
 */

import React from 'react';
import { AlertTriangle, Copy, X, ShieldAlert } from 'lucide-react';
import { logSecurityEvent } from '../monitoring/eventLogger.ts';

interface DetokenisedCopyModalProps {
  isOpen: boolean;
  contentToCopy: string;
  contentType: 'transcript' | 'case_note';
  onClose: () => void;
  onConfirmCopy: () => void;
}

export const DetokenisedCopyModal: React.FC<DetokenisedCopyModalProps> = ({
  isOpen,
  contentToCopy,
  contentType,
  onClose,
  onConfirmCopy,
}) => {
  if (!isOpen) return null;

  const handleConfirm = () => {
    // Perform clipboard copy
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(contentToCopy).catch((err) => {
        console.error('Clipboard copy failed:', err);
      });
    }

    logSecurityEvent({
      type: 'detokenised_clipboard_copied',
      details: {
        contentType,
        characterLength: contentToCopy.length,
      },
    });

    onConfirmCopy();
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="detokenised-copy-title"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
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
          maxWidth: '540px',
          width: '100%',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.08)',
          overflow: 'hidden',
          border: '2px solid #F59E0B',
        }}
      >
        {/* Header */}
        <div
          style={{
            backgroundColor: '#FEF3C7',
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid #FDE68A',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div
              style={{
                backgroundColor: '#D97706',
                color: '#FFFFFF',
                borderRadius: '50%',
                width: '36px',
                height: '36px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <AlertTriangle size={20} aria-hidden="true" />
            </div>
            <div>
              <h3
                id="detokenised-copy-title"
                style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700, color: '#92400E' }}
              >
                Sensitive Plaintext Data Warning
              </h3>
              <span style={{ fontSize: '0.8125rem', color: '#B45309', fontWeight: 500 }}>
                Unredacted Client Identifiable Information
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: '#92400E',
              padding: '0.25rem',
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '1.5rem' }}>
          <div
            style={{
              backgroundColor: '#FFFBEB',
              borderLeft: '4px solid #D97706',
              padding: '1rem',
              borderRadius: '0 6px 6px 0',
              marginBottom: '1.25rem',
            }}
          >
            <p style={{ margin: 0, fontSize: '0.875rem', color: '#92400E', lineHeight: 1.5 }}>
              You are about to copy the <strong>detokenised {contentType === 'transcript' ? 'transcript' : 'case note'}</strong> containing real names, addresses, and identifiers to your workstation clipboard.
            </p>
          </div>

          <div style={{ fontSize: '0.875rem', color: '#334155', lineHeight: 1.6 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <ShieldAlert size={18} color="#D97706" style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong>Strict Usage Rule:</strong> This unredacted text is intended exclusively for your internal Citizens Advice case management (Casebook) review.
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <ShieldAlert size={18} color="#D97706" style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong>Data Leakage Prevention:</strong> Never paste this unredacted content into external emails, public AI tools, or unencrypted messaging channels.
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
              <ShieldAlert size={18} color="#059669" style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong>Zero Local Disk Writing:</strong> In compliance with privacy policy (C1), saving detokenised files to disk is disabled.
              </div>
            </div>
          </div>
        </div>

        {/* Footer Controls */}
        <div
          style={{
            backgroundColor: '#F8FAFC',
            padding: '1rem 1.5rem',
            borderTop: '1px solid #E2E8F0',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '0.75rem',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '6px',
              border: '1px solid #CBD5E1',
              backgroundColor: '#FFFFFF',
              color: '#475569',
              fontWeight: 600,
              fontSize: '0.875rem',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            id="confirm-detokenised-copy-btn"
            onClick={handleConfirm}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 1.25rem',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: '#D97706',
              color: '#FFFFFF',
              fontWeight: 700,
              fontSize: '0.875rem',
              cursor: 'pointer',
              boxShadow: '0 2px 4px rgba(217, 119, 6, 0.3)',
            }}
          >
            <Copy size={16} />
            I Understand — Copy Plaintext
          </button>
        </div>
      </div>
    </div>
  );
};
