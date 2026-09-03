/**
 * @file IdentifierReviewPanel.tsx
 * @description Interactive 3-Layer Identifier Review & Decision Gate for Advisers.
 * Presents Layer 1 structured identifiers, Layer 2 personal/third-party names and organizations,
 * and Layer 3 special category contextual decision gates with explicit consequence disclosures.
 */

import React, { useState } from 'react';
import {
  Shield,
  AlertTriangle,
  CheckCircle,
  Eye,
  EyeOff,
  UserCheck,
  Building,
  MapPin,
  HeartPulse,
  Lock,
} from 'lucide-react';
import type { DetectedIdentifier, AdviserDecision } from '../state/volatileStore.ts';
import { volatileSessionStore } from '../state/volatileStore.ts';

interface IdentifierReviewPanelProps {
  identifiers: DetectedIdentifier[];
  tokenMap?: Record<string, string>;
  onDecisionChange?: (id: string, decision: AdviserDecision) => void;
}

export const IdentifierReviewPanel: React.FC<IdentifierReviewPanelProps> = ({
  identifiers,
  tokenMap: _tokenMap,
  onDecisionChange,
}) => {
  const [activeTab, setActiveTab] = useState<'all' | 'layer1' | 'layer2' | 'layer3'>('all');
  const [showOriginals, setShowOriginals] = useState(false);

  const layer1Items = identifiers.filter((i) => i.detectionLayer === 1);
  const layer2Items = identifiers.filter((i) => i.detectionLayer === 2);
  const layer3Items = identifiers.filter((i) => i.detectionLayer === 3);

  const handleDecision = (id: string, decision: AdviserDecision) => {
    volatileSessionStore.updateIdentifierDecision(id, decision);
    if (onDecisionChange) {
      onDecisionChange(id, decision);
    }
  };

  const getCategoryIcon = (category: string) => {
    if (category.startsWith('special_category_') || category.startsWith('safeguarding_')) {
      return <HeartPulse size={16} color="#DC2626" />;
    }
    if (category.includes('name')) {
      return <UserCheck size={16} color="#2563EB" />;
    }
    if (category.includes('org') || category.includes('school') || category.includes('hospital') || category.includes('practice')) {
      return <Building size={16} color="#0D9488" />;
    }
    if (category.includes('location') || category.includes('address') || category.includes('postcode')) {
      return <MapPin size={16} color="#D97706" />;
    }
    return <Lock size={16} color="#475569" />;
  };

  return (
    <div
      style={{
        backgroundColor: '#FFFFFF',
        borderRadius: '8px',
        border: '1px solid #CBD5E1',
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
      }}
    >
      {/* Header */}
      <div
        style={{
          backgroundColor: '#004B87',
          color: '#FFFFFF',
          padding: '1rem 1.25rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Shield size={20} />
            <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 600 }}>
              Phase 8: Identifier Detection &amp; Classification Review
            </h3>
          </div>
          <span style={{ fontSize: '0.75rem', color: '#93C5FD', display: 'block', marginTop: '0.25rem' }}>
            Optimised for Recall over Precision • All named third parties protected
          </span>
        </div>

        <button
          type="button"
          onClick={() => setShowOriginals(!showOriginals)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.375rem',
            backgroundColor: showOriginals ? '#1E3A8A' : 'rgba(255,255,255,0.15)',
            color: '#FFFFFF',
            border: '1px solid rgba(255,255,255,0.3)',
            padding: '0.375rem 0.75rem',
            borderRadius: '4px',
            fontSize: '0.75rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {showOriginals ? <EyeOff size={14} /> : <Eye size={14} />}
          {showOriginals ? 'Mask Original PII' : 'Reveal Original PII'}
        </button>
      </div>

      {/* Summary Metrics Bar */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '0.5rem',
          padding: '0.75rem 1.25rem',
          backgroundColor: '#F8FAFC',
          borderBottom: '1px solid #E2E8F0',
          fontSize: '0.8125rem',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <span style={{ color: '#64748B', display: 'block', fontSize: '0.6875rem' }}>TOTAL IDENTIFIERS</span>
          <span style={{ fontWeight: 700, fontSize: '1rem', color: '#0F172A' }}>{identifiers.length}</span>
        </div>
        <div style={{ textAlign: 'center' }}>
          <span style={{ color: '#64748B', display: 'block', fontSize: '0.6875rem' }}>LAYER 1 (STRUCTURED)</span>
          <span style={{ fontWeight: 700, fontSize: '1rem', color: '#004B87' }}>{layer1Items.length}</span>
        </div>
        <div style={{ textAlign: 'center' }}>
          <span style={{ color: '#64748B', display: 'block', fontSize: '0.6875rem' }}>LAYER 2 (NAMES &amp; ORGS)</span>
          <span style={{ fontWeight: 700, fontSize: '1rem', color: '#0284C7' }}>{layer2Items.length}</span>
        </div>
        <div style={{ textAlign: 'center' }}>
          <span style={{ color: '#64748B', display: 'block', fontSize: '0.6875rem' }}>LAYER 3 (SPECIAL CAT)</span>
          <span style={{ fontWeight: 700, fontSize: '1rem', color: '#DC2626' }}>{layer3Items.length}</span>
        </div>
      </div>

      {/* Filter Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #E2E8F0', backgroundColor: '#FFFFFF' }}>
        <button
          type="button"
          onClick={() => setActiveTab('all')}
          style={{
            flex: 1,
            padding: '0.625rem',
            border: 'none',
            borderBottom: activeTab === 'all' ? '2px solid #004B87' : '2px solid transparent',
            backgroundColor: 'transparent',
            fontWeight: activeTab === 'all' ? 700 : 500,
            color: activeTab === 'all' ? '#004B87' : '#64748B',
            cursor: 'pointer',
            fontSize: '0.8125rem',
          }}
        >
          All Items ({identifiers.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('layer1')}
          style={{
            flex: 1,
            padding: '0.625rem',
            border: 'none',
            borderBottom: activeTab === 'layer1' ? '2px solid #004B87' : '2px solid transparent',
            backgroundColor: 'transparent',
            fontWeight: activeTab === 'layer1' ? 700 : 500,
            color: activeTab === 'layer1' ? '#004B87' : '#64748B',
            cursor: 'pointer',
            fontSize: '0.8125rem',
          }}
        >
          Layer 1: UK Structured ({layer1Items.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('layer2')}
          style={{
            flex: 1,
            padding: '0.625rem',
            border: 'none',
            borderBottom: activeTab === 'layer2' ? '2px solid #004B87' : '2px solid transparent',
            backgroundColor: 'transparent',
            fontWeight: activeTab === 'layer2' ? 700 : 500,
            color: activeTab === 'layer2' ? '#004B87' : '#64748B',
            cursor: 'pointer',
            fontSize: '0.8125rem',
          }}
        >
          Layer 2: Names &amp; Orgs ({layer2Items.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('layer3')}
          style={{
            flex: 1,
            padding: '0.625rem',
            border: 'none',
            borderBottom: activeTab === 'layer3' ? '2px solid #DC2626' : '2px solid transparent',
            backgroundColor: 'transparent',
            fontWeight: activeTab === 'layer3' ? 700 : 500,
            color: activeTab === 'layer3' ? '#DC2626' : '#64748B',
            cursor: 'pointer',
            fontSize: '0.8125rem',
          }}
        >
          Layer 3: Special Category ({layer3Items.length})
        </button>
      </div>

      {/* Content Area */}
      <div style={{ maxHeight: '420px', overflowY: 'auto', padding: '1rem' }}>
        {identifiers.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: '#64748B', fontSize: '0.875rem' }}>
            No identifiers detected in this consultation transcript.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {identifiers
              .filter((item) => {
                if (activeTab === 'layer1') return item.detectionLayer === 1;
                if (activeTab === 'layer2') return item.detectionLayer === 2;
                if (activeTab === 'layer3') return item.detectionLayer === 3;
                return true;
              })
              .map((item) => (
                <div
                  key={item.id}
                  style={{
                    backgroundColor: item.detectionLayer === 3 ? '#FFFBEB' : '#FFFFFF',
                    border: item.detectionLayer === 3 ? '1px solid #FCD34D' : '1px solid #E2E8F0',
                    borderRadius: '6px',
                    padding: '0.875rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.5rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {getCategoryIcon(item.category)}
                      <span style={{ fontWeight: 700, fontSize: '0.875rem', color: '#0F172A' }}>
                        {item.surrogateToken}
                      </span>
                      <span
                        style={{
                          fontSize: '0.6875rem',
                          backgroundColor: '#EFF6FF',
                          color: '#1E40AF',
                          padding: '0.125rem 0.375rem',
                          borderRadius: '4px',
                          textTransform: 'uppercase',
                          fontWeight: 600,
                        }}
                      >
                        {item.category.replace(/_/g, ' ')}
                      </span>
                      {item.speaker && (
                        <span style={{ fontSize: '0.6875rem', color: '#64748B' }}>
                          Speaker: <strong>{item.speaker}</strong>
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.6875rem', color: '#64748B' }}>
                        Audio: {item.audioTimeRange.startSec}s - {item.audioTimeRange.endSec}s
                      </span>
                      <span
                        style={{
                          fontSize: '0.6875rem',
                          padding: '0.125rem 0.375rem',
                          borderRadius: '4px',
                          backgroundColor: item.detectionLayer === 1 ? '#DCFCE7' : item.detectionLayer === 2 ? '#E0F2FE' : '#FEE2E2',
                          color: item.detectionLayer === 1 ? '#166534' : item.detectionLayer === 2 ? '#0369A1' : '#991B1B',
                          fontWeight: 600,
                        }}
                      >
                        Layer {item.detectionLayer}
                      </span>
                    </div>
                  </div>

                  {/* Detected Text & Token Mapping */}
                  <div style={{ fontSize: '0.8125rem', color: '#334155' }}>
                    <span style={{ color: '#64748B' }}>Detected Span: </span>
                    <strong style={{ fontFamily: 'monospace', backgroundColor: '#F1F5F9', padding: '0.125rem 0.375rem', borderRadius: '4px' }}>
                      {showOriginals ? item.text : '••••••••••••'}
                    </strong>
                    {item.normalizedText && (
                      <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: '#64748B' }}>
                        (Normalized: <code>{item.normalizedText}</code>)
                      </span>
                    )}
                  </div>

                  {/* Layer 3 Consequence & Decision Gate */}
                  {item.detectionLayer === 3 && item.decisionConsequences && (
                    <div
                      style={{
                        backgroundColor: '#FFFFFF',
                        border: '1px solid #FDE68A',
                        borderRadius: '4px',
                        padding: '0.625rem',
                        fontSize: '0.75rem',
                        lineHeight: 1.4,
                      }}
                    >
                      <div style={{ fontWeight: 700, color: '#B45309', marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <AlertTriangle size={14} /> Adviser Decision Required (Judgement Call)
                      </div>
                      <div style={{ color: '#475569', marginBottom: '0.25rem' }}>
                        <strong>Cloud Privacy Risk:</strong> {item.decisionConsequences.retentionRisk}
                      </div>
                      <div style={{ color: '#475569', marginBottom: '0.5rem' }}>
                        <strong>Case Note Impact:</strong> {item.decisionConsequences.redactionImpact}
                      </div>

                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                          type="button"
                          onClick={() => handleDecision(item.id, 'retained_substance')}
                          style={{
                            flex: 1,
                            padding: '0.375rem',
                            borderRadius: '4px',
                            border: item.adviserDecision === 'retained_substance' ? '2px solid #004B87' : '1px solid #CBD5E1',
                            backgroundColor: item.adviserDecision === 'retained_substance' ? '#EFF6FF' : '#FFFFFF',
                            color: item.adviserDecision === 'retained_substance' ? '#004B87' : '#475569',
                            fontWeight: 600,
                            fontSize: '0.6875rem',
                            cursor: 'pointer',
                          }}
                        >
                          ✓ Retain Clinical Substance (Recommended Default)
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDecision(item.id, 'accepted')}
                          style={{
                            flex: 1,
                            padding: '0.375rem',
                            borderRadius: '4px',
                            border: item.adviserDecision === 'accepted' ? '2px solid #DC2626' : '1px solid #CBD5E1',
                            backgroundColor: item.adviserDecision === 'accepted' ? '#FEE2E2' : '#FFFFFF',
                            color: item.adviserDecision === 'accepted' ? '#991B1B' : '#475569',
                            fontWeight: 600,
                            fontSize: '0.6875rem',
                            cursor: 'pointer',
                          }}
                        >
                          X Redact Completely (Replace with Token)
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Layer 1 & 2 Simple Redaction Toggle */}
                  {item.detectionLayer !== 3 && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.25rem' }}>
                      <button
                        type="button"
                        onClick={() => handleDecision(item.id, item.adviserDecision === 'accepted' ? 'rejected' : 'accepted')}
                        style={{
                          padding: '0.25rem 0.625rem',
                          borderRadius: '4px',
                          border: item.adviserDecision === 'accepted' ? '1px solid #16A34A' : '1px solid #DC2626',
                          backgroundColor: item.adviserDecision === 'accepted' ? '#F0FDF4' : '#FEF2F2',
                          color: item.adviserDecision === 'accepted' ? '#166534' : '#991B1B',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                        }}
                      >
                        {item.adviserDecision === 'accepted' ? <CheckCircle size={12} /> : <AlertTriangle size={12} />}
                        {item.adviserDecision === 'accepted' ? 'Redact (Default)' : 'Keep Unredacted (Adviser Override)'}
                      </button>
                    </div>
                  )}
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
};
