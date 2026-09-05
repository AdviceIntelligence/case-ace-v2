import React, { useState, useEffect, useRef } from 'react';
import {
  volatileSessionStore,
  type SessionState,
  type DetectedIdentifier,
  type IdentifierCategory,
} from '../state/volatileStore.ts';
import {
  checkGateReadiness,
  getOutboundDisclosure,
  executeAffirmativeProceed,
  type LowConfidenceItem,
  type OutboundTransmissionDisclosure,
} from '../redaction/redactionGateManager.ts';
import { playAudioSnippet, type SnippetPlaybackController } from '../audio/audioSnippetPlayer.ts';

interface RedactionReviewGateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProceedSuccess: (tokenisedPayload: string) => void;
}

export const RedactionReviewGateModal: React.FC<RedactionReviewGateModalProps> = ({
  isOpen,
  onClose,
  onProceedSuccess,
}) => {
  const [session, setSession] = useState<SessionState | null>(volatileSessionStore.getState());
  const [activeTab, setActiveTab] = useState<'low_confidence' | 'identifiers' | 'manual' | 'outbound'>('low_confidence');
  const [playingItemId, setPlayingItemId] = useState<string | null>(null);
  const playbackRef = useRef<SnippetPlaybackController | null>(null);

  // Manual Redaction inputs
  const [manualText, setManualText] = useState('');
  const [manualCategory, setManualCategory] = useState<IdentifierCategory>('third_party_name');
  const [manualStartSec, setManualStartSec] = useState<number>(0);
  const [manualEndSec, setManualEndSec] = useState<number>(1);

  // Un-redact confirmation modal state
  const [unredactTarget, setUnredactTarget] = useState<DetectedIdentifier | null>(null);

  // Affirmative consent checkbox
  const [affirmativeConsent, setAffirmativeConsent] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Dwell timer
  const [dwellSeconds, setDwellSeconds] = useState<number>(0);

  useEffect(() => {
    const unsubscribe = volatileSessionStore.subscribe((state) => {
      setSession(state ? { ...state } : null);
    });
    return () => {
      unsubscribe();
      if (playbackRef.current) {
        playbackRef.current.stop();
      }
    };
  }, []);

  useEffect(() => {
    if (isOpen) {
      volatileSessionStore.openRedactionGate();
      setDwellSeconds(Math.floor(volatileSessionStore.getGateDwellTimeMs() / 1000));
      const interval = setInterval(() => {
        setDwellSeconds(Math.floor(volatileSessionStore.getGateDwellTimeMs() / 1000));
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [isOpen]);

  if (!isOpen || !session) return null;

  const readiness = checkGateReadiness(session);
  const disclosure: OutboundTransmissionDisclosure = getOutboundDisclosure(session);

  // Audio Playback Handler
  const handlePlaySnippet = (itemId: string, startSec: number, endSec: number) => {
    if (playbackRef.current) {
      playbackRef.current.stop();
    }

    if (playingItemId === itemId) {
      setPlayingItemId(null);
      return;
    }

    if (!session.rawAudioBuffer) {
      alert('Raw audio buffer not present in volatile store.');
      return;
    }

    const pcmData = new Float32Array(session.rawAudioBuffer);
    setPlayingItemId(itemId);

    playbackRef.current = playAudioSnippet({
      pcmData,
      sampleRate: session.metadata.audioSampleRate || 16000,
      startSec,
      endSec,
      paddingSec: 0.3,
      onEnded: () => {
        setPlayingItemId(null);
      },
      onError: (err) => {
        console.error('Audio playback error:', err);
        setPlayingItemId(null);
      },
    });
  };

  // Low confidence item acknowledgement
  const handleAcknowledgeLowConfidence = (item: LowConfidenceItem) => {
    if (item.isAcknowledged) {
      volatileSessionStore.unacknowledgeLowConfidence(item.id);
    } else {
      volatileSessionStore.acknowledgeLowConfidence(item.id);
    }
  };

  // Add manual text redaction
  const handleAddManualTextRedaction = () => {
    if (!manualText.trim()) return;

    const transcript = session.transcript?.fullTranscript || '';
    const startPos = transcript.indexOf(manualText);
    const endPos = startPos !== -1 ? startPos + manualText.length : 0;

    const newId: DetectedIdentifier = {
      id: `manual_${Date.now()}`,
      text: manualText,
      charOffset: { start: Math.max(0, startPos), end: Math.max(0, endPos) },
      audioTimeRange: { startSec: 0, endSec: 0 },
      category: manualCategory,
      detectionLayer: 2,
      confidence: 1.0,
      proposedAction: 'redact',
      adviserDecision: 'accepted',
      surrogateToken: `[MANUAL_${manualCategory.toUpperCase()}_${Date.now().toString().slice(-4)}]`,
    };

    volatileSessionStore.addManualRedaction(newId);
    setManualText('');
  };

  // Add manual audio range redaction
  const handleAddManualAudioRedaction = () => {
    if (manualEndSec <= manualStartSec) {
      alert('End time must be greater than start time.');
      return;
    }

    const newId: DetectedIdentifier = {
      id: `manual_audio_${Date.now()}`,
      text: `[Audio Range ${manualStartSec}s - ${manualEndSec}s]`,
      charOffset: { start: 0, end: 0 },
      audioTimeRange: { startSec: manualStartSec, endSec: manualEndSec },
      category: 'third_party_name',
      detectionLayer: 2,
      confidence: 1.0,
      proposedAction: 'redact',
      adviserDecision: 'accepted',
      surrogateToken: `[AUDIO_BLEEP_${Date.now().toString().slice(-4)}]`,
    };

    volatileSessionStore.addManualRedaction(newId);
  };

  // Remove proposed redaction
  const handleConfirmUnredact = () => {
    if (unredactTarget) {
      volatileSessionStore.removeRedaction(unredactTarget.id);
      setUnredactTarget(null);
    }
  };

  // Proceed handler
  const handleProceed = () => {
    setErrorMessage(null);
    const result = executeAffirmativeProceed(affirmativeConsent);
    if (result.success) {
      onProceedSuccess(result.tokenisedPayload);
      onClose();
    } else {
      setErrorMessage(result.error || 'Failed to authorize redactions.');
    }
  };

  const formatTimer = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remSecs = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${remSecs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden text-slate-100">
        
        {/* Header Bar */}
        <div className="px-6 py-4 bg-slate-800 border-b border-slate-700 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="bg-rose-600 text-white text-xs font-bold px-2 py-0.5 rounded tracking-wider uppercase">
                Privacy Gate C1 / C5
              </span>
              <h2 className="text-xl font-bold text-white tracking-wide">
                Adviser Redaction Review Gate
              </h2>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              No data leaves this workstation until all low-confidence acoustic regions are individually auditioned and approved.
            </p>
          </div>

          <div className="flex items-center gap-4">
            {/* Dwell Timer */}
            <div className="bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-700 text-center">
              <span className="text-[10px] text-slate-400 block uppercase tracking-wider">Gate Dwell Time</span>
              <span className="text-sm font-mono font-bold text-amber-400">{formatTimer(dwellSeconds)}</span>
            </div>

            {/* Pending Counter */}
            <div className={`px-3 py-1.5 rounded-lg border text-center ${
              readiness.pendingCount > 0 
                ? 'bg-rose-950/60 border-rose-700 text-rose-300' 
                : 'bg-emerald-950/60 border-emerald-700 text-emerald-300'
            }`}>
              <span className="text-[10px] block uppercase tracking-wider">Low Confidence Pending</span>
              <span className="text-sm font-mono font-bold">
                {readiness.pendingCount} / {readiness.totalLowConfidenceCount}
              </span>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-700 bg-slate-850 px-6">
          <button
            onClick={() => setActiveTab('low_confidence')}
            className={`py-3 px-4 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === 'low_confidence'
                ? 'border-amber-500 text-amber-400 bg-slate-800/60'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>⚠️ Low-Confidence Regions</span>
            {readiness.pendingCount > 0 && (
              <span className="bg-rose-600 text-white text-xs px-1.5 py-0.2 rounded-full font-bold">
                {readiness.pendingCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('identifiers')}
            className={`py-3 px-4 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === 'identifiers'
                ? 'border-indigo-500 text-indigo-400 bg-slate-800/60'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>🏷️ Categorised Redactions ({session.detectedIdentifiers.filter((d) => d.adviserDecision !== 'rejected').length})</span>
          </button>

          <button
            onClick={() => setActiveTab('manual')}
            className={`py-3 px-4 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === 'manual'
                ? 'border-cyan-500 text-cyan-400 bg-slate-800/60'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>✏️ Add / Edit Redaction</span>
          </button>

          <button
            onClick={() => setActiveTab('outbound')}
            className={`py-3 px-4 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === 'outbound'
                ? 'border-emerald-500 text-emerald-400 bg-slate-800/60'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>📡 Outbound Disclosure & Payload</span>
          </button>
        </div>

        {/* Tab Content Body */}
        <div className="flex-1 p-6 overflow-y-auto space-y-6">

          {/* TAB 1: LOW CONFIDENCE REGIONS */}
          {activeTab === 'low_confidence' && (
            <div className="space-y-4">
              <div className="bg-amber-950/40 border border-amber-800/80 rounded-lg p-4 text-amber-200 text-xs">
                <p className="font-bold text-amber-300 text-sm mb-1 flex items-center gap-1.5">
                  <span>⚠️ High-Risk Acoustic Regions (&lt;0.70 Confidence)</span>
                </p>
                <p>
                  The local speech-to-text model was uncertain about the acoustic tokens listed below.
                  Mumbled names, muffled phone numbers, or third-party disclosures often occur in low-confidence spans.
                  <strong> Every region must be individually reviewed and acknowledged</strong> before Case Ace allows transmission.
                </p>
              </div>

              {readiness.allLowConfidenceItems.length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  <span className="text-3xl block mb-2">🎉</span>
                  <p className="font-medium text-slate-300">No low-confidence acoustic regions detected.</p>
                  <p className="text-xs text-slate-500 mt-1">All Pass One ASR tokens scored &ge; 70% confidence.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {readiness.allLowConfidenceItems.map((item) => (
                    <div
                      key={item.id}
                      className={`p-3.5 rounded-lg border transition-all ${
                        item.isAcknowledged
                          ? 'bg-slate-850 border-slate-700 opacity-80'
                          : 'bg-slate-800/90 border-amber-500/80 shadow-md ring-1 ring-amber-500/30'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white text-base">"{item.word}"</span>
                            <span className="bg-amber-500/20 text-amber-300 text-[10px] font-mono px-1.5 py-0.5 rounded border border-amber-500/30">
                              {Math.round(item.confidence * 100)}% Conf
                            </span>
                            <span className="bg-slate-700 text-slate-300 text-[10px] px-1.5 py-0.5 rounded uppercase">
                              {item.speaker}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400 mt-1 font-mono italic">
                            {item.surroundingContext}
                          </p>
                          <p className="text-[10px] text-slate-500 mt-0.5">
                            Timestamp: {item.startSec.toFixed(2)}s – {item.endSec.toFixed(2)}s
                          </p>
                        </div>

                        {/* Play Snippet */}
                        <button
                          onClick={() => handlePlaySnippet(item.id, item.startSec, item.endSec)}
                          className={`px-2.5 py-1.5 rounded text-xs font-semibold flex items-center gap-1 transition-colors ${
                            playingItemId === item.id
                              ? 'bg-rose-600 text-white animate-pulse'
                              : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                          }`}
                        >
                          {playingItemId === item.id ? '⏹ Stop' : '▶ Play'}
                        </button>
                      </div>

                      <div className="mt-3 pt-2.5 border-t border-slate-700/60 flex items-center justify-between">
                        <span className="text-[11px] text-slate-400">
                          {item.isAcknowledged ? '✅ Acknowledged' : '⚠️ Requires Review'}
                        </span>
                        <button
                          onClick={() => handleAcknowledgeLowConfidence(item)}
                          className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                            item.isAcknowledged
                              ? 'bg-slate-700 hover:bg-slate-600 text-slate-300'
                              : 'bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold'
                          }`}
                        >
                          {item.isAcknowledged ? 'Unacknowledge' : 'Acknowledge & Confirm'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: CATEGORISED REDACTIONS */}
          {activeTab === 'identifiers' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <p>Click "Remove" on any false-positive redaction to retain the plaintext word.</p>
                <span>Total Active Redactions: {session.detectedIdentifiers.filter((d) => d.adviserDecision !== 'rejected').length}</span>
              </div>

              <div className="space-y-2.5">
                {session.detectedIdentifiers.map((id) => (
                  <div
                    key={id.id}
                    className={`p-3 rounded-lg border flex flex-wrap items-center justify-between gap-3 ${
                      id.adviserDecision === 'rejected'
                        ? 'bg-slate-900/50 border-slate-800 opacity-40 line-through'
                        : id.detectionLayer === 3
                        ? 'bg-purple-950/30 border-purple-800/60'
                        : id.detectionLayer === 1
                        ? 'bg-blue-950/30 border-blue-800/60'
                        : 'bg-slate-800 border-slate-700'
                    }`}
                  >
                    <div className="flex-1 min-w-[280px]">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white">"{id.text}"</span>
                        <span className="bg-indigo-900/60 text-indigo-300 font-mono text-xs px-2 py-0.5 rounded border border-indigo-700/50">
                          {id.surrogateToken}
                        </span>
                        <span className="bg-slate-700 text-slate-300 text-[10px] px-1.5 py-0.5 rounded uppercase font-mono">
                          {id.category}
                        </span>
                        <span className="text-[10px] text-slate-500">
                          Layer {id.detectionLayer}
                        </span>
                      </div>

                      {id.decisionConsequences && (
                        <div className="mt-1.5 text-[11px] text-purple-300/90 bg-purple-950/40 p-1.5 rounded border border-purple-800/30">
                          <strong>Consequence:</strong> {id.decisionConsequences.retentionRisk}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Audio Playback for Identifier */}
                      {id.audioTimeRange.endSec > id.audioTimeRange.startSec && (
                        <button
                          onClick={() => handlePlaySnippet(id.id, id.audioTimeRange.startSec, id.audioTimeRange.endSec)}
                          className={`px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1 ${
                            playingItemId === id.id
                              ? 'bg-rose-600 text-white animate-pulse'
                              : 'bg-slate-700 hover:bg-slate-600 text-slate-200'
                          }`}
                        >
                          {playingItemId === id.id ? '⏹' : '▶ Play'}
                        </button>
                      )}

                      {/* Remove Redaction Button */}
                      {id.adviserDecision !== 'rejected' ? (
                        <button
                          onClick={() => setUnredactTarget(id)}
                          className="px-2.5 py-1 rounded text-xs bg-rose-900/40 hover:bg-rose-800/60 text-rose-300 border border-rose-700/50"
                        >
                          Remove
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            id.adviserDecision = 'accepted';
                            volatileSessionStore.updateState({ detectedIdentifiers: [...session.detectedIdentifiers] });
                          }}
                          className="px-2.5 py-1 rounded text-xs bg-slate-700 hover:bg-slate-600 text-slate-300"
                        >
                          Restore
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: MANUAL REDACTION TOOL */}
          {activeTab === 'manual' && (
            <div className="space-y-6">
              <div className="bg-slate-800 p-4 rounded-lg border border-slate-700 space-y-3">
                <h4 className="font-bold text-sm text-cyan-300">1. Redact Missed Text from Transcript</h4>
                <p className="text-xs text-slate-400">
                  Enter any identifying name, address, or term that was not automatically flagged:
                </p>
                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    value={manualText}
                    onChange={(e) => setManualText(e.target.value)}
                    placeholder="Enter word or phrase to redact..."
                    className="flex-1 min-w-[240px] px-3 py-2 bg-slate-950 border border-slate-700 rounded text-sm text-white focus:outline-none focus:border-cyan-500"
                  />
                  <select
                    value={manualCategory}
                    onChange={(e) => setManualCategory(e.target.value as IdentifierCategory)}
                    className="px-3 py-2 bg-slate-950 border border-slate-700 rounded text-sm text-slate-200"
                  >
                    <option value="client_name">Client Name</option>
                    <option value="third_party_name">Third Party Name</option>
                    <option value="ex_partner_name">Ex-Partner Name</option>
                    <option value="child_name">Child Name</option>
                    <option value="landlord_name">Landlord Name</option>
                    <option value="employer_name">Employer Name</option>
                    <option value="identifying_organisation">Organisation / School</option>
                    <option value="street_address">Street Address</option>
                    <option value="uk_postcode">Postcode</option>
                    <option value="phone_number">Phone Number</option>
                  </select>
                  <button
                    onClick={handleAddManualTextRedaction}
                    disabled={!manualText.trim()}
                    className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-800 text-white font-semibold text-sm rounded transition-colors"
                  >
                    Add Text Redaction
                  </button>
                </div>
              </div>

              <div className="bg-slate-800 p-4 rounded-lg border border-slate-700 space-y-3">
                <h4 className="font-bold text-sm text-cyan-300">2. Redact Audio Time Range (Acoustic Bleep)</h4>
                <p className="text-xs text-slate-400">
                  Specify start and end seconds in the audio to be zeroed out:
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-slate-400">Start (s):</span>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      value={manualStartSec}
                      onChange={(e) => setManualStartSec(parseFloat(e.target.value) || 0)}
                      className="w-24 px-2 py-1.5 bg-slate-950 border border-slate-700 rounded text-sm text-white"
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-slate-400">End (s):</span>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      value={manualEndSec}
                      onChange={(e) => setManualEndSec(parseFloat(e.target.value) || 0)}
                      className="w-24 px-2 py-1.5 bg-slate-950 border border-slate-700 rounded text-sm text-white"
                    />
                  </div>
                  <button
                    onClick={handleAddManualAudioRedaction}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm rounded transition-colors"
                  >
                    Redact Audio Range
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: OUTBOUND DISCLOSURE & PAYLOAD */}
          {activeTab === 'outbound' && (
            <div className="space-y-4">
              <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 space-y-3 text-xs">
                <h4 className="font-bold text-sm text-emerald-400">Outbound Transmission Statement</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-slate-300">
                  <div>
                    <span className="text-slate-500 block">Target Cloud Processor:</span>
                    <strong className="text-white">{disclosure.targetProcessor}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Designated Data Region:</span>
                    <strong className="text-white">{disclosure.targetRegion}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Credential Scope & Validity:</span>
                    <span className="font-mono text-slate-300">{disclosure.credentialValiditySeconds}s Ephemeral Token</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Total Redacted Entities:</span>
                    <span className="font-bold text-emerald-300">{disclosure.totalRedactedTokensCount} tokens</span>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Tokenised Payload Preview (Exact text leaving the device)
                </h4>
                <div className="p-4 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-slate-200 leading-relaxed whitespace-pre-wrap max-h-60 overflow-y-auto">
                  {disclosure.tokenisedPayloadPreview}
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Footer & Proceed Control */}
        <div className="p-5 bg-slate-800 border-t border-slate-700 space-y-3">
          {errorMessage && (
            <div className="p-2.5 bg-rose-950/80 border border-rose-700 text-rose-200 text-xs rounded">
              ⚠️ {errorMessage}
            </div>
          )}

          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <label className="flex items-start gap-2.5 text-xs text-slate-300 cursor-pointer max-w-xl">
              <input
                type="checkbox"
                checked={affirmativeConsent}
                onChange={(e) => setAffirmativeConsent(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-700 text-indigo-600 focus:ring-indigo-500"
              />
              <span>
                <strong>Affirmative Declaration:</strong> I have reviewed all proposed redactions and auditioned any low-confidence acoustic regions. I authorise transmission of the surrogate-tokenised transcript to the designated processor.
              </span>
            </label>

            <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-medium rounded transition-colors"
              >
                Cancel
              </button>

              <button
                onClick={handleProceed}
                disabled={!readiness.canProceed || !affirmativeConsent}
                className={`px-5 py-2.5 rounded-lg text-sm font-bold flex items-center gap-2 transition-all shadow-lg ${
                  readiness.canProceed && affirmativeConsent
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer ring-2 ring-emerald-400/50'
                    : 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
                }`}
              >
                {readiness.pendingCount > 0 ? (
                  <span>🔒 Review {readiness.pendingCount} Pending to Proceed</span>
                ) : !affirmativeConsent ? (
                  <span>🔒 Tick Declaration to Proceed</span>
                ) : (
                  <span>✓ Authorise & Proceed to Drafting</span>
                )}
              </button>
            </div>
          </div>
        </div>

      </div>

      {/* Un-Redact Plaintext Warning Confirmation Dialog */}
      {unredactTarget && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/85 p-4">
          <div className="bg-slate-900 border border-rose-600/80 rounded-xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <h3 className="text-lg font-bold text-rose-400 flex items-center gap-2">
              <span>⚠️ Confirm Un-Redaction (Data Disclosure)</span>
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              You are about to remove redaction for:
              <br />
              <strong className="text-white text-sm block my-1 font-mono bg-slate-950 p-2 rounded border border-slate-800">
                "{unredactTarget.text}" ({unredactTarget.category})
              </strong>
              If confirmed, this value <strong>will be transmitted in plaintext</strong> to the cloud model and included in the prompt payload.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setUnredactTarget(null)}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-xs font-semibold text-white rounded"
              >
                Cancel (Keep Redacted)
              </button>
              <button
                onClick={handleConfirmUnredact}
                className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white rounded"
              >
                I Understand, Transmit Plaintext
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
