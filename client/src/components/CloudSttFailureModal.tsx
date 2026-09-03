/**
 * CloudSttFailureModal.tsx
 * 
 * Explicit Failure Resolution Modal for Cloud Speech-to-Text v2.
 * 
 * Mandatory Privacy & Quality Invariant:
 * On Cloud STT failure, Case Ace NEVER silently downgrades to the local transcript.
 * It presents an explicit, informed choice to the adviser:
 * 1. Retry Cloud Transcription (fresh ephemeral credential).
 * 2. Proceed with Pass 1 Local Transcript (with prominent accuracy warning).
 * 3. Cancel / Abort.
 */

import React from 'react';
import { AlertTriangle, RefreshCw, FileText, XCircle, ShieldAlert } from 'lucide-react';

interface CloudSttFailureModalProps {
  isOpen: boolean;
  errorMessage: string | null;
  onRetry: () => void;
  onProceedWithLocalTranscript: () => void;
  onCancel: () => void;
}

export const CloudSttFailureModal: React.FC<CloudSttFailureModalProps> = ({
  isOpen,
  errorMessage,
  onRetry,
  onProceedWithLocalTranscript,
  onCancel,
}) => {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cloud-stt-failure-title"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1200,
        padding: '1rem',
      }}
    >
      <div
        style={{
          backgroundColor: '#FFFFFF',
          borderRadius: '10px',
          width: '100%',
          maxWidth: '650px',
          padding: '2rem',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.3)',
          border: '1px solid #FECACA',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <div
            style={{
              padding: '0.625rem',
              backgroundColor: '#FEF2F2',
              borderRadius: '8px',
              color: '#DC2626',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <AlertTriangle size={28} />
          </div>
          <div>
            <h2 id="cloud-stt-failure-title" style={{ margin: 0, fontSize: '1.25rem', color: '#991B1B', fontWeight: 700 }}>
              Cloud Transcription Service Unavailable
            </h2>
            <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8125rem', color: '#64748B' }}>
              Case Ace does not silently downgrade transcript sources. Please select how to proceed.
            </p>
          </div>
        </div>

        {/* Error Diagnostics Box */}
        <div
          style={{
            backgroundColor: '#FEF2F2',
            border: '1px solid #FCA5A5',
            borderRadius: '6px',
            padding: '1rem',
            fontSize: '0.8125rem',
            color: '#991B1B',
            marginBottom: '1.5rem',
            fontFamily: 'monospace',
          }}
        >
          <strong>Failure Diagnostic:</strong> {errorMessage || 'Network connection timeout or Google Cloud STT service error.'}
        </div>

        {/* Advisory Comparison Notice */}
        <div
          style={{
            backgroundColor: '#FFFBEB',
            border: '1px solid #FDE68A',
            borderRadius: '6px',
            padding: '1rem',
            marginBottom: '1.5rem',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.75rem',
          }}
        >
          <ShieldAlert size={20} color="#D97706" style={{ flexShrink: 0, marginTop: '2px' }} />
          <div style={{ fontSize: '0.8125rem', color: '#92400E', lineHeight: 1.5 }}>
            <strong style={{ display: 'block', marginBottom: '0.25rem' }}>
              Quality & Accuracy Warning: Local vs Cloud Speech Recognition
            </strong>
            The Pass 1 local in-browser transcript has an estimated Word Error Rate of <strong>15–25%</strong> and lacks statutory domain phrase boosting. Complex welfare terms (e.g. <em>LCWRA</em>, <em>mandatory reconsideration</em>, <em>Section 21</em>) may be garbled. If you proceed with the local transcript, you must thoroughly verify the resulting draft case note.
          </div>
        </div>

        {/* Choice Grid */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
          {/* Option 1: Retry Cloud STT */}
          <button
            type="button"
            id="cloud-stt-retry-btn"
            onClick={onRetry}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '1rem',
              backgroundColor: '#EFF6FF',
              border: '1px solid #BFDBFE',
              borderRadius: '8px',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'background-color 0.15s',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <RefreshCw size={20} color="#004B87" />
              <div>
                <div style={{ fontWeight: 700, color: '#004B87', fontSize: '0.875rem' }}>
                  Option 1: Retry Cloud Speech-to-Text (Recommended)
                </div>
                <div style={{ fontSize: '0.75rem', color: '#64748B' }}>
                  Requests a fresh downscoped credential and retransmits the verified redacted audio to europe-west2.
                </div>
              </div>
            </div>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#004B87', backgroundColor: '#DBEAFE', padding: '0.25rem 0.5rem', borderRadius: '4px' }}>
              Retry
            </span>
          </button>

          {/* Option 2: Fallback to Local Transcript with Explicit Warning */}
          <button
            type="button"
            id="cloud-stt-fallback-local-btn"
            onClick={onProceedWithLocalTranscript}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '1rem',
              backgroundColor: '#FFFBEB',
              border: '1px solid #FCD34D',
              borderRadius: '8px',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'background-color 0.15s',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <FileText size={20} color="#D97706" />
              <div>
                <div style={{ fontWeight: 700, color: '#B45309', fontSize: '0.875rem' }}>
                  Option 2: Proceed with Pass 1 Local Transcript
                </div>
                <div style={{ fontSize: '0.75rem', color: '#78350F' }}>
                  Acknowledges reduced transcription accuracy. Case note will be synthesised from local transcript.
                </div>
              </div>
            </div>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#B45309', backgroundColor: '#FEF3C7', padding: '0.25rem 0.5rem', borderRadius: '4px' }}>
              Acknowledge & Proceed
            </span>
          </button>

          {/* Option 3: Cancel */}
          <button
            type="button"
            id="cloud-stt-cancel-btn"
            onClick={onCancel}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.875rem 1rem',
              backgroundColor: '#F8FAFC',
              border: '1px solid #E2E8F0',
              borderRadius: '8px',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <XCircle size={18} color="#64748B" />
              <div>
                <div style={{ fontWeight: 600, color: '#475569', fontSize: '0.8125rem' }}>
                  Option 3: Cancel & Return to Workspace
                </div>
                <div style={{ fontSize: '0.75rem', color: '#94A3B8' }}>
                  Keeps the verified redacted audio in volatile memory for later processing.
                </div>
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};
