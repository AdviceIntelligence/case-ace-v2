/**
 * AudioRedactionVerificationModal.tsx
 * 
 * Interactive Modal for Phase 10: Audio Redaction & Mandatory Verification Pass.
 * Enforces Fail-Closed invariant (Constraint C8) and displays step-by-step audit trail.
 */

import React, { useState, useEffect } from 'react';
import { Shield, CheckCircle, XCircle, RefreshCw, ArrowRight } from 'lucide-react';
import {
  redactionVerificationManager,
  type VerificationProgressEvent,
  type VerificationResult,
} from '../redaction/redactionVerificationManager.ts';
import { volatileSessionStore, type DetectedIdentifier } from '../state/volatileStore.ts';

interface AudioRedactionVerificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onVerificationComplete: (result: VerificationResult) => void;
  onReturnToGateWithSurvivors: (survivors: DetectedIdentifier[]) => void;
}

export const AudioRedactionVerificationModal: React.FC<AudioRedactionVerificationModalProps> = ({
  isOpen,
  onClose,
  onVerificationComplete,
  onReturnToGateWithSurvivors,
}) => {
  const [isRunning, setIsRunning] = useState(false);
  const [currentProgress, setCurrentProgress] = useState<VerificationProgressEvent | null>(null);
  const [verificationResult, setVerificationResult] = useState<VerificationResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && !isRunning && !verificationResult) {
      runVerification();
    }
  }, [isOpen]);

  const runVerification = async () => {
    const session = volatileSessionStore.getState();
    if (!session || !session.rawAudioBuffer) {
      setErrorMessage('No raw audio buffer available in volatile memory for redaction verification.');
      return;
    }

    setIsRunning(true);
    setErrorMessage(null);
    setVerificationResult(null);

    try {
      const result = await redactionVerificationManager.verifyAndCommitRedactedAudio(
        session,
        (progress) => {
          setCurrentProgress(progress);
        }
      );

      setVerificationResult(result);
      if (result.success) {
        onVerificationComplete(result);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Verification pipeline encountered an unexpected error.');
    } finally {
      setIsRunning(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="verification-modal-title"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1100,
        padding: '1rem',
      }}
    >
      <div
        style={{
          backgroundColor: '#FFFFFF',
          borderRadius: '12px',
          width: '100%',
          maxWidth: '680px',
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
            backgroundColor: '#004B87',
            color: '#FFFFFF',
            padding: '1.25rem 1.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Shield size={24} color="#FBBF24" />
            <div>
              <h3 id="verification-modal-title" style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700 }}>
                Phase 10: Audio Redaction & Verification
              </h3>
              <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.75rem', color: '#BAE6FD' }}>
                Constraint C8 Fail-Closed Invariant & Acoustic Energy Assertions
              </p>
            </div>
          </div>
        </div>

        {/* Content Body */}
        <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1 }}>
          {/* Progress Steps Overview */}
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: 600 }}>
              <span style={{ color: '#1E293B' }}>Verification Pipeline</span>
              <span style={{ color: isRunning ? '#0284C7' : verificationResult?.success ? '#059669' : '#DC2626' }}>
                {isRunning ? `Step ${currentProgress?.stepNumber || 1} of 4` : verificationResult?.success ? 'Passed (100%)' : 'Failed'}
              </span>
            </div>
            
            {/* Progress Bar */}
            <div style={{ width: '100%', height: '8px', backgroundColor: '#E2E8F0', borderRadius: '4px', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${currentProgress?.progressPercent || 0}%`,
                  backgroundColor: verificationResult?.success ? '#059669' : verificationResult?.success === false ? '#DC2626' : '#0284C7',
                  transition: 'width 0.3s ease-in-out',
                }}
              />
            </div>
          </div>

          {/* Current Step Status */}
          {isRunning && (
            <div
              style={{
                backgroundColor: '#EFF6FF',
                border: '1px solid #BFDBFE',
                borderRadius: '8px',
                padding: '1rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                marginBottom: '1.5rem',
              }}
            >
              <RefreshCw size={20} color="#0284C7" className="animate-spin" />
              <div>
                <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600, color: '#1E40AF' }}>
                  {currentProgress?.message || 'Processing acoustic redaction...'}
                </p>
                <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.75rem', color: '#64748B' }}>
                  Applying ±250ms padding, merging adjacent intervals, and re-running local ASR.
                </p>
              </div>
            </div>
          )}

          {/* Success State */}
          {verificationResult?.success && (
            <div
              style={{
                backgroundColor: '#F0FDF4',
                border: '1px solid #BBF7D0',
                borderRadius: '8px',
                padding: '1.25rem',
                marginBottom: '1.5rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                <CheckCircle size={24} color="#16A34A" style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem', color: '#166534', fontWeight: 700 }}>
                    Redaction Verified & Memory Sanitised
                  </h4>
                  <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.8125rem', color: '#15803D', lineHeight: 1.4 }}>
                    Pass One local speech recognition detected <strong>0 surviving identifiers</strong> in the redacted audio.
                    Region-level acoustic energy assertions verified that all muted intervals contain pure silence.
                  </p>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem', fontSize: '0.75rem', color: '#166534', backgroundColor: '#DCFCE7', padding: '0.75rem', borderRadius: '6px' }}>
                    <div>• Merged Redacted Regions: <strong>{verificationResult.mergedIntervals?.length || 0}</strong></div>
                    <div>• Total Muted Duration: <strong>{(verificationResult.totalMutedSeconds || 0).toFixed(2)}s</strong></div>
                    <div>• Minimum Padding: <strong>250ms applied</strong></div>
                    <div>• Raw Audio Buffer: <strong>Zeroed & Released (C1)</strong></div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Failure State (Surviving Identifiers Detected - C8 Fail-Closed) */}
          {verificationResult?.success === false && (
            <div
              style={{
                backgroundColor: '#FEF2F2',
                border: '2px solid #EF4444',
                borderRadius: '8px',
                padding: '1.25rem',
                marginBottom: '1.5rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                <XCircle size={24} color="#DC2626" style={{ flexShrink: 0, marginTop: '2px' }} />
                <div style={{ flex: 1 }}>
                  <h4 style={{ margin: '0 0 0.25rem 0', fontSize: '1rem', color: '#991B1B', fontWeight: 700 }}>
                    Verification Blocked: Surviving Identifiers Detected (C8)
                  </h4>
                  <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.8125rem', color: '#B91C1C', lineHeight: 1.4 }}>
                    The verification speech-to-text pass detected {verificationResult.survivingIdentifiers.length} identifier(s) in the redacted audio.
                    Per <strong>Constraint C8 (Fail-Closed)</strong>, transmission to Cloud Speech-to-Text is strictly blocked.
                  </p>

                  <div style={{ maxHeight: '180px', overflowY: 'auto', border: '1px solid #FECACA', borderRadius: '6px', backgroundColor: '#FFFFFF', padding: '0.5rem' }}>
                    {verificationResult.survivingIdentifiers.map((survivor, idx) => (
                      <div
                        key={survivor.id || idx}
                        style={{
                          padding: '0.5rem',
                          borderBottom: idx < verificationResult.survivingIdentifiers.length - 1 ? '1px solid #FEE2E2' : 'none',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          fontSize: '0.75rem',
                        }}
                      >
                        <div>
                          <strong style={{ color: '#991B1B' }}>"{survivor.text}"</strong>
                          <span style={{ marginLeft: '0.5rem', color: '#64748B' }}>({survivor.category})</span>
                        </div>
                        <span style={{ color: '#DC2626', fontWeight: 600 }}>
                          {survivor.audioTimeRange?.startSec.toFixed(2)}s - {survivor.audioTimeRange?.endSec.toFixed(2)}s
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {errorMessage && (
            <div style={{ backgroundColor: '#FEF2F2', border: '1px solid #F87171', borderRadius: '6px', padding: '0.75rem', color: '#991B1B', fontSize: '0.8125rem', marginBottom: '1rem' }}>
              <strong>Error:</strong> {errorMessage}
            </div>
          )}
        </div>

        {/* Footer Controls */}
        <div
          style={{
            padding: '1rem 1.5rem',
            backgroundColor: '#F8FAFC',
            borderTop: '1px solid #E2E8F0',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '0.75rem',
          }}
        >
          {verificationResult?.success === false && (
            <button
              type="button"
              onClick={() => {
                onReturnToGateWithSurvivors(verificationResult.survivingIdentifiers);
                onClose();
              }}
              style={{
                backgroundColor: '#DC2626',
                color: '#FFFFFF',
                border: 'none',
                padding: '0.5rem 1rem',
                borderRadius: '6px',
                fontWeight: 700,
                fontSize: '0.875rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.375rem',
              }}
            >
              <RefreshCw size={16} />
              Return to Gate to Expand Redaction
            </button>
          )}

          {verificationResult?.success && (
            <button
              type="button"
              onClick={onClose}
              style={{
                backgroundColor: '#004B87',
                color: '#FFFFFF',
                border: 'none',
                padding: '0.5rem 1.25rem',
                borderRadius: '6px',
                fontWeight: 700,
                fontSize: '0.875rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.375rem',
              }}
            >
              <span>Proceed to Cloud STT v2</span>
              <ArrowRight size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
