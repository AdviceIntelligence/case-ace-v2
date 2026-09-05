import React, { useState } from 'react';
import { Shield, AlertTriangle, CheckSquare, X, HardDrive } from 'lucide-react';
import {
  consentManager,
  CONTROLLED_SOURCE_EQUIPMENT_LABELS,
  CONTROLLED_CONSENT_MEANS_LABELS,
  CONTROLLED_PARTY_COVERAGE_LABELS,
  type IntakeRoute,
  type ConsentRecord,
  type ConsentWording,
  type SourceEquipment,
  type ConsentAttestationMeans,
  type CapturePartyCoverage,
} from '../consent/consentManager.ts';

interface ConsentGateModalProps {
  isOpen: boolean;
  route: IntakeRoute;
  adviserId: string;
  onClose: () => void;
  onConsentConfirmed: (record: ConsentRecord) => void;
}

export const ConsentGateModal: React.FC<ConsentGateModalProps> = ({
  isOpen,
  route,
  adviserId,
  onClose,
  onConsentConfirmed,
}) => {
  const [isAffirmed, setIsAffirmed] = useState(false);
  const [originalDate, setOriginalDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [sourceEquipment, setSourceEquipment] = useState<SourceEquipment>('caw_olympus_dictaphone');
  const [consentMeans, setConsentMeans] = useState<ConsentAttestationMeans>('written_intake_agreement');
  const [partyCoverage, setPartyCoverage] = useState<CapturePartyCoverage>('both_parties_captured');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const wording: ConsentWording = consentManager.getWordingForRoute(route);
  const isUnmanagedEquipment = CONTROLLED_SOURCE_EQUIPMENT_LABELS[sourceEquipment]?.isUnmanaged ?? false;

  const handleConfirm = () => {
    setErrorMessage(null);
    try {
      if (!isAffirmed) {
        setErrorMessage('You must affirmatively confirm client consent before proceeding.');
        return;
      }

      if (route === 'file_import') {
        if (!originalDate.trim()) {
          setErrorMessage('Please select the original appointment date.');
          return;
        }
      }

      const record = consentManager.recordConsent(
        route,
        adviserId,
        route === 'file_import'
          ? {
              originalAppointmentDate: originalDate,
              sourceEquipment,
              consentMeans,
              partyCoverage,
            }
          : undefined
      );

      onConsentConfirmed(record);
      setIsAffirmed(false);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to create consent record.');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-gate-title"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
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
          borderRadius: '8px',
          maxWidth: '680px',
          width: '100%',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Modal Header */}
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
            <Shield size={24} color="#60A5FA" aria-hidden="true" />
            <h2 id="consent-gate-title" style={{ margin: 0, fontSize: '1.125rem', fontWeight: 600 }}>
              {wording.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cancel and Close"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#93C5FD',
              cursor: 'pointer',
              padding: '0.25rem',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Content */}
        <div style={{ padding: '1.5rem', maxHeight: '75vh', overflowY: 'auto' }}>
          {/* Adviser Guidance Box */}
          <div
            style={{
              backgroundColor: '#EFF6FF',
              borderLeft: '4px solid #004B87',
              padding: '1rem',
              borderRadius: '4px',
              marginBottom: '1.25rem',
            }}
          >
            <p style={{ margin: 0, fontWeight: 600, color: '#004B87', fontSize: '0.875rem' }}>
              {wording.adviserInstructions}
            </p>
            <ul style={{ margin: '0.5rem 0 0 1.25rem', padding: 0, fontSize: '0.8125rem', color: '#1E293B', lineHeight: 1.5 }}>
              {wording.clientInformationPoints.map((point, idx) => (
                <li key={idx} style={{ marginBottom: '0.25rem' }}>
                  {point}
                </li>
              ))}
            </ul>
          </div>

          {/* Import Specific Attestation Fields (Controlled Lists Only) */}
          {route === 'file_import' && (
            <div
              style={{
                backgroundColor: '#F8FAFC',
                border: '1px solid #E2E8F0',
                padding: '1.25rem',
                borderRadius: '6px',
                marginBottom: '1.25rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
              }}
            >
              <h4 style={{ margin: 0, fontSize: '0.875rem', fontWeight: 700, color: '#004B87' }}>
                Provenance & Consent Attestation (Controlled Lists Only)
              </h4>

              {/* 1. Original Appointment Date */}
              <div>
                <label
                  htmlFor="import-original-date"
                  style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#334155', marginBottom: '0.25rem' }}
                >
                  Original Appointment Date *
                </label>
                <input
                  id="import-original-date"
                  type="date"
                  value={originalDate}
                  onChange={(e) => setOriginalDate(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    borderRadius: '4px',
                    border: '1px solid #CBD5E1',
                    fontSize: '0.875rem',
                    backgroundColor: '#FFFFFF',
                  }}
                />
              </div>

              {/* 2. Source Equipment (Controlled List) */}
              <div>
                <label
                  htmlFor="import-source-equipment"
                  style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#334155', marginBottom: '0.25rem' }}
                >
                  Recording Equipment / Source System *
                </label>
                <select
                  id="import-source-equipment"
                  value={sourceEquipment}
                  onChange={(e) => setSourceEquipment(e.target.value as SourceEquipment)}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    borderRadius: '4px',
                    border: '1px solid #CBD5E1',
                    fontSize: '0.875rem',
                    backgroundColor: '#FFFFFF',
                  }}
                >
                  {(Object.keys(CONTROLLED_SOURCE_EQUIPMENT_LABELS) as SourceEquipment[]).map((key) => (
                    <option key={key} value={key}>
                      {CONTROLLED_SOURCE_EQUIPMENT_LABELS[key].label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Unmanaged Device Warning */}
              {isUnmanagedEquipment && (
                <div
                  style={{
                    backgroundColor: '#FEF3C7',
                    borderLeft: '4px solid #D97706',
                    padding: '0.75rem',
                    borderRadius: '4px',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.5rem',
                  }}
                >
                  <AlertTriangle size={16} color="#D97706" style={{ flexShrink: 0, marginTop: '2px' }} aria-hidden="true" />
                  <p style={{ margin: 0, fontSize: '0.75rem', color: '#92400E', lineHeight: 1.4 }}>
                    <strong>Unmanaged Device Notice:</strong> This recording originated from an unmanaged external device.
                    Importing this file into Case Ace does not retroactively secure or sanitise the source device.
                    Ensure the original file is managed and purged in strict compliance with CAW SOP-REC-01 and DPIA protocols.
                  </p>
                </div>
              )}

              {/* 3. Consent Attestation Means (Controlled List) */}
              <div>
                <label
                  htmlFor="import-consent-means"
                  style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#334155', marginBottom: '0.25rem' }}
                >
                  Means of Consent Obtained *
                </label>
                <select
                  id="import-consent-means"
                  value={consentMeans}
                  onChange={(e) => setConsentMeans(e.target.value as ConsentAttestationMeans)}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    borderRadius: '4px',
                    border: '1px solid #CBD5E1',
                    fontSize: '0.875rem',
                    backgroundColor: '#FFFFFF',
                  }}
                >
                  {(Object.keys(CONTROLLED_CONSENT_MEANS_LABELS) as ConsentAttestationMeans[]).map((key) => (
                    <option key={key} value={key}>
                      {CONTROLLED_CONSENT_MEANS_LABELS[key]}
                    </option>
                  ))}
                </select>
              </div>

              {/* 4. Party Coverage (Controlled List) */}
              <div>
                <label
                  htmlFor="import-party-coverage"
                  style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#334155', marginBottom: '0.25rem' }}
                >
                  Parties Captured in Recording *
                </label>
                <select
                  id="import-party-coverage"
                  value={partyCoverage}
                  onChange={(e) => setPartyCoverage(e.target.value as CapturePartyCoverage)}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    borderRadius: '4px',
                    border: '1px solid #CBD5E1',
                    fontSize: '0.875rem',
                    backgroundColor: '#FFFFFF',
                  }}
                >
                  {(Object.keys(CONTROLLED_PARTY_COVERAGE_LABELS) as CapturePartyCoverage[]).map((key) => (
                    <option key={key} value={key}>
                      {CONTROLLED_PARTY_COVERAGE_LABELS[key]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Source File Retention & Responsibility Notice */}
          <div
            style={{
              backgroundColor: '#F1F5F9',
              border: '1px solid #CBD5E1',
              borderRadius: '6px',
              padding: '0.75rem 1rem',
              marginBottom: '1.25rem',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.625rem',
            }}
          >
            <HardDrive size={18} color="#475569" style={{ flexShrink: 0, marginTop: '2px' }} aria-hidden="true" />
            <div>
              <p style={{ margin: 0, fontSize: '0.75rem', color: '#334155', lineHeight: 1.4 }}>
                <strong>Source File Responsibility:</strong> Case Ace operates purely in volatile memory and cannot delete files on your workstation.
                The original source recording remains your responsibility under{' '}
                <a
                  href="#sop-rec-01"
                  onClick={(e) => {
                    e.preventDefault();
                    alert('Refer to CAW Standard Operating Procedure SOP-REC-01: Storage, Transfer, and Timely Deletion of Source Recordings in docs/sop-retention-deletion.md.');
                  }}
                  style={{ color: '#004B87', textDecoration: 'underline', fontWeight: 600 }}
                >
                  CAW SOP-REC-01
                </a>.
              </p>
            </div>
          </div>

          {/* Privacy Invariant Notice */}
          <div
            style={{
              backgroundColor: '#FEF3C7',
              border: '1px solid #FCD34D',
              borderRadius: '6px',
              padding: '0.75rem 1rem',
              marginBottom: '1.25rem',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.5rem',
            }}
          >
            <AlertTriangle size={18} color="#D97706" style={{ flexShrink: 0, marginTop: '2px' }} aria-hidden="true" />
            <p style={{ margin: 0, fontSize: '0.75rem', color: '#92400E', lineHeight: 1.4 }}>
              <strong>Zero Client PII Rule:</strong> The consent record stores only the timestamp, route, adviser identifier, and controlled provenance tags.
              No client names, case references, or file names are ever recorded.
            </p>
          </div>

          {/* Error Banner */}
          {errorMessage && (
            <div
              style={{
                backgroundColor: '#FEF2F2',
                borderLeft: '4px solid #D9381E',
                padding: '0.75rem',
                borderRadius: '4px',
                marginBottom: '1.25rem',
                color: '#991B1B',
                fontSize: '0.8125rem',
              }}
            >
              {errorMessage}
            </div>
          )}

          {/* Affirmation Checkbox */}
          <label
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.75rem',
              padding: '0.875rem',
              backgroundColor: '#F8FAFC',
              border: isAffirmed ? '1px solid #004B87' : '1px solid #CBD5E1',
              borderRadius: '6px',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              id="consent-affirmation-checkbox"
              checked={isAffirmed}
              onChange={(e) => setIsAffirmed(e.target.checked)}
              style={{ marginTop: '3px', cursor: 'pointer', width: '16px', height: '16px' }}
            />
            <span style={{ fontSize: '0.875rem', color: '#1E293B', lineHeight: 1.4, fontWeight: 500 }}>
              {wording.affirmationStatement}
            </span>
          </label>
        </div>

        {/* Modal Actions */}
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
              fontSize: '0.875rem',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>

          <button
            type="button"
            id="confirm-consent-button"
            onClick={handleConfirm}
            disabled={!isAffirmed}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.375rem',
              padding: '0.5rem 1.25rem',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: isAffirmed ? '#004B87' : '#94A3B8',
              color: '#FFFFFF',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: isAffirmed ? 'pointer' : 'not-allowed',
              transition: 'background-color 0.15s ease',
            }}
          >
            <CheckSquare size={16} aria-hidden="true" />
            {route === 'file_import'
              ? 'Attest Consent & Select File'
              : 'Confirm & Proceed'}
          </button>
        </div>
      </div>
    </div>
  );
};
