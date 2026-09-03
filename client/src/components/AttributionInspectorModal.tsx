/**
 * @file AttributionInspectorModal.tsx
 * @description Modal for Inspecting Segment-Level Transcript Attributions in Case Ace v2.0.
 */

import React from 'react';
import { X, Quote, Clock, FileText, CheckCircle2 } from 'lucide-react';
import type { CaseNoteAttribution } from '../state/volatileStore.ts';

interface AttributionInspectorModalProps {
  attribution: CaseNoteAttribution | null;
  onClose: () => void;
}

export const AttributionInspectorModal: React.FC<AttributionInspectorModalProps> = ({
  attribution,
  onClose,
}) => {
  if (!attribution) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="attr-inspector-title"
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
          maxWidth: '560px',
          width: '100%',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
          overflow: 'hidden',
          border: '1px solid #CBD5E1',
        }}
      >
        {/* Header */}
        <div
          style={{
            backgroundColor: '#F8FAFC',
            padding: '1rem 1.25rem',
            borderBottom: '1px solid #E2E8F0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Quote size={18} color="#0284C7" />
            <h3 id="attr-inspector-title" style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#0F172A' }}>
              Transcript Segment Attribution
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: '#64748B',
              padding: '0.25rem',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '1.25rem' }}>
          {/* Section & Time Badges */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
            <span
              style={{
                fontSize: '0.75rem',
                backgroundColor: '#EFF6FF',
                color: '#1D4ED8',
                padding: '0.2rem 0.5rem',
                borderRadius: '4px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
              }}
            >
              <FileText size={12} /> {attribution.sectionName}
            </span>
            <span
              style={{
                fontSize: '0.75rem',
                backgroundColor: '#F1F5F9',
                color: '#475569',
                padding: '0.2rem 0.5rem',
                borderRadius: '4px',
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
              }}
            >
              <Clock size={12} /> {attribution.timestampRange}
            </span>
            <span
              style={{
                fontSize: '0.75rem',
                backgroundColor: '#ECFDF5',
                color: '#047857',
                padding: '0.2rem 0.5rem',
                borderRadius: '4px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
              }}
            >
              <CheckCircle2 size={12} /> {attribution.segmentId}
            </span>
          </div>

          {/* Statement in Case Note */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
              Drafted Case Note Statement:
            </label>
            <div
              style={{
                padding: '0.75rem',
                backgroundColor: '#F8FAFC',
                borderRadius: '6px',
                fontSize: '0.875rem',
                color: '#1E293B',
                lineHeight: 1.5,
                border: '1px solid #E2E8F0',
              }}
            >
              {attribution.statementText}
            </div>
          </div>

          {/* Underlying Transcript Quote */}
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
              Direct Transcript Quote:
            </label>
            <div
              style={{
                padding: '0.75rem',
                backgroundColor: '#EFF6FF',
                borderRadius: '6px',
                fontSize: '0.875rem',
                color: '#1E40AF',
                lineHeight: 1.5,
                border: '1px solid #BFDBFE',
                fontStyle: 'italic',
              }}
            >
              "{attribution.transcriptSnippet}"
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            backgroundColor: '#F8FAFC',
            padding: '0.75rem 1.25rem',
            borderTop: '1px solid #E2E8F0',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '0.4rem 1rem',
              borderRadius: '6px',
              border: '1px solid #CBD5E1',
              backgroundColor: '#FFFFFF',
              color: '#334155',
              fontWeight: 600,
              fontSize: '0.8125rem',
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
