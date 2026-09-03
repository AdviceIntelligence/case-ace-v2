/**
 * CloudSttModal.tsx
 * 
 * Phase 11 Cloud Speech-to-Text v2 Transcription Monitor.
 * Displays real-time progress, region pinning (europe-west2),
 * data logging status (strictly disabled), and phrase set adaptation status.
 */

import React, { useState, useEffect } from 'react';
import { Cloud, ShieldCheck, CheckCircle2, AlertCircle, MapPin } from 'lucide-react';
import { cloudAsrEngine } from '../asr/cloudAsrEngine.ts';
import { ADVICE_SECTOR_PHRASE_SET_VERSION } from '../asr/adviceSectorPhraseSet.ts';
import { volatileSessionStore, type CloudAsrResult } from '../state/volatileStore.ts';

interface CloudSttModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (result: CloudAsrResult) => void;
  onFailure: (error: Error) => void;
  authToken?: string;
}

export const CloudSttModal: React.FC<CloudSttModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  onFailure,
  authToken,
}) => {
  const [stage, setStage] = useState<'validating' | 'issuing_creds' | 'transcribing' | 'completed' | 'failed'>('validating');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [progressPercent, setProgressPercent] = useState<number>(10);
  const [resultSummary, setResultSummary] = useState<CloudAsrResult | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setStage('validating');
      setErrorMessage(null);
      setProgressPercent(10);
      setResultSummary(null);
      return;
    }

    let isCancelled = false;

    const runCloudStt = async () => {
      const session = volatileSessionStore.getState();
      if (!session) {
        setStage('failed');
        setErrorMessage('No active consultation session found in volatile RAM.');
        return;
      }

      try {
        // Step 1: Pre-transmission check
        setStage('validating');
        setProgressPercent(20);
        cloudAsrEngine.assertTransmissionAuthorization(session);

        // Step 2: Ephemeral credential issuance
        setStage('issuing_creds');
        setProgressPercent(45);
        await new Promise((r) => setTimeout(r, 400));

        // Step 3: Transmit to Cloud STT v2
        setStage('transcribing');
        setProgressPercent(75);

        const result = await cloudAsrEngine.transcribeVerifiedAudio(session, authToken);

        if (isCancelled) return;

        setProgressPercent(100);
        setStage('completed');
        setResultSummary(result);

        setTimeout(() => {
          if (!isCancelled) {
            onSuccess(result);
          }
        }, 1000);
      } catch (err: any) {
        if (isCancelled) return;
        setStage('failed');
        setErrorMessage(err.message || 'Speech-to-Text v2 API execution failed.');
        onFailure(err);
      }
    };

    runCloudStt();

    return () => {
      isCancelled = true;
    };
  }, [isOpen, authToken]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cloud-stt-modal-title"
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
        zIndex: 1100,
        padding: '1rem',
      }}
    >
      <div
        style={{
          backgroundColor: '#FFFFFF',
          borderRadius: '10px',
          width: '100%',
          maxWidth: '620px',
          padding: '2rem',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          border: '1px solid #E2E8F0',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <div
            style={{
              padding: '0.625rem',
              backgroundColor: '#EFF6FF',
              borderRadius: '8px',
              color: '#004B87',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Cloud size={28} />
          </div>
          <div>
            <h2 id="cloud-stt-modal-title" style={{ margin: 0, fontSize: '1.25rem', color: '#004B87', fontWeight: 700 }}>
              Pass Two: Cloud Speech Recognition (STT v2)
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem', fontSize: '0.8125rem', color: '#64748B' }}>
              <MapPin size={13} color="#004B87" />
              <span>Region: <strong>europe-west2 (London)</strong></span>
              <span>•</span>
              <ShieldCheck size={13} color="#16A34A" />
              <span>Data Logging: <strong>Disabled</strong></span>
            </div>
          </div>
        </div>

        {/* Progress Bar */}
        <div style={{ margin: '1.5rem 0 1rem 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', color: '#475569', marginBottom: '0.375rem', fontWeight: 600 }}>
            <span>
              {stage === 'validating' && 'Verifying Redaction Gate & Audio Buffer Invariants...'}
              {stage === 'issuing_creds' && 'Acquiring Ephemeral Downscoped STS Credential (300s TTL)...'}
              {stage === 'transcribing' && 'Transcribing with Advice Sector Domain Adaptation...'}
              {stage === 'completed' && 'Transcription Complete!'}
              {stage === 'failed' && 'Cloud Speech-to-Text Error'}
            </span>
            <span>{progressPercent}%</span>
          </div>
          <div style={{ height: '8px', width: '100%', backgroundColor: '#E2E8F0', borderRadius: '4px', overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${progressPercent}%`,
                backgroundColor: stage === 'failed' ? '#DC2626' : '#004B87',
                transition: 'width 0.3s ease-in-out',
              }}
            />
          </div>
        </div>

        {/* Security & Configuration Metadata Audit Card */}
        <div
          style={{
            backgroundColor: '#F8FAFC',
            border: '1px solid #E2E8F0',
            borderRadius: '6px',
            padding: '1rem',
            fontSize: '0.8125rem',
            color: '#334155',
            marginBottom: '1.5rem',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '0.75rem',
          }}
        >
          <div>
            <div style={{ color: '#64748B', fontSize: '0.75rem' }}>Egress Safeguard</div>
            <div style={{ fontWeight: 600, color: '#16A34A' }}>Verified Redacted LINEAR16 Audio Only</div>
          </div>
          <div>
            <div style={{ color: '#64748B', fontSize: '0.75rem' }}>Language & Model</div>
            <div style={{ fontWeight: 600, color: '#004B87' }}>British English (en-GB) • Latest Long</div>
          </div>
          <div>
            <div style={{ color: '#64748B', fontSize: '0.75rem' }}>Domain Adaptation</div>
            <div style={{ fontWeight: 600, color: '#004B87' }}>UK Advice Sector (v{ADVICE_SECTOR_PHRASE_SET_VERSION})</div>
          </div>
          <div>
            <div style={{ color: '#64748B', fontSize: '0.75rem' }}>Speaker Diarisation</div>
            <div style={{ fontWeight: 600, color: '#004B87' }}>2-Speaker Conversational Turn Split</div>
          </div>
        </div>

        {/* Completed State Details */}
        {stage === 'completed' && resultSummary && (
          <div
            style={{
              backgroundColor: '#F0FDF4',
              border: '1px solid #BBF7D0',
              padding: '0.875rem',
              borderRadius: '6px',
              marginBottom: '1.5rem',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.625rem',
            }}
          >
            <CheckCircle2 size={18} color="#16A34A" style={{ flexShrink: 0, marginTop: '2px' }} />
            <div style={{ fontSize: '0.8125rem', color: '#166534' }}>
              <strong>High-Fidelity Working Transcript Generated</strong> ({resultSummary.totalWords} words, {resultSummary.segments.length} turns, avg confidence {(resultSummary.avgConfidence * 100).toFixed(1)}%).
            </div>
          </div>
        )}

        {/* Failed State Details */}
        {stage === 'failed' && (
          <div
            style={{
              backgroundColor: '#FEF2F2',
              border: '1px solid #FECACA',
              padding: '0.875rem',
              borderRadius: '6px',
              marginBottom: '1.5rem',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.625rem',
            }}
          >
            <AlertCircle size={18} color="#DC2626" style={{ flexShrink: 0, marginTop: '2px' }} />
            <div style={{ fontSize: '0.8125rem', color: '#991B1B' }}>
              <strong>Cloud STT v2 Failed:</strong> {errorMessage}
            </div>
          </div>
        )}

        {/* Modal Controls */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
          {stage === 'failed' && (
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '0.5rem 1.25rem',
                backgroundColor: '#DC2626',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: '6px',
                fontWeight: 600,
                fontSize: '0.875rem',
                cursor: 'pointer',
              }}
            >
              Review Failure Options
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
