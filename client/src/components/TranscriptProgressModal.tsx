/**
 * TranscriptProgressModal.tsx
 * 
 * Progress and status modal for UK Sovereign Cloud Speech-to-Text v2 (London).
 * 
 * Invariants:
 * 1. Progress Visibility: Shows chunk index, percentage, and current stage.
 * 2. Privacy Disclaimers: Clear sovereign privacy claim (europe-west2, enableDataLogging: false, zero disk writes).
 * 3. Low-Confidence Detection: Highlights low-confidence words detected for review gate.
 */

import React from 'react';
import type { TranscribeProgress } from '../asr/ukCloudTranscriber.ts';

interface TranscriptProgressModalProps {
  isOpen: boolean;
  progress: TranscribeProgress | null;
  lowConfidenceCount?: number;
  onCancel?: () => void;
}

export const TranscriptProgressModal: React.FC<TranscriptProgressModalProps> = ({
  isOpen,
  progress,
  lowConfidenceCount = 0,
}) => {
  if (!isOpen) return null;

  const percentage = progress ? progress.progressPercent : 0;
  const currentChunk = progress ? progress.currentChunk : 0;
  const totalChunks = progress ? progress.totalChunks : 0;
  const message = progress ? progress.message : 'Preparing transcription...';

  return (
    <div
      className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="transcript-modal-title"
    >
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 border border-slate-200">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
          <div className="flex items-center gap-2">
            <span className="flex h-3 w-3 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
              <span className="relative inline-flex full-rounded h-3 w-3 bg-indigo-600"></span>
            </span>
            <h3 id="transcript-modal-title" className="text-base font-semibold text-slate-800">
              UK Sovereign Transcription
            </h3>
          </div>
          <span className="text-xs px-2 py-0.5 rounded font-mono font-medium bg-emerald-100 text-emerald-800 border border-emerald-300">
            🇬🇧 europe-west2 (London)
          </span>
        </div>

        {/* Informative Privacy Banner */}
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 text-xs text-indigo-950 mb-5 leading-relaxed">
          <div className="font-semibold flex items-center gap-1.5 mb-1">
            <svg className="w-4 h-4 text-indigo-600 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 1.944A11.954 11.954 0 012.166 5C2.056 5.649 2 6.319 2 7c0 5.225 3.34 9.67 8 11.317C14.66 16.67 18 12.225 18 7c0-.682-.057-1.35-.166-2.001A11.954 11.954 0 0110 1.944zM11 14a1 1 0 11-2 0 1 1 0 012 0zm0-7a1 1 0 10-2 0v3a1 1 0 102 0V7z"
                clipRule="evenodd"
              />
            </svg>
            In-Memory Processing (Zero Retention)
          </div>
          Audio is chunked into memory and transcribed in London with zero data logging (<code className="bg-indigo-100 px-1 py-0.5 rounded text-[11px]">enableDataLogging: false</code>). The LLM that drafts your case note will never see client identifiers.
        </div>

        {/* Progress Metrics */}
        <div className="space-y-3 mb-5">
          <div className="flex justify-between items-center text-sm font-medium text-slate-700">
            <span>{message}</span>
            <span>{percentage}%</span>
          </div>

          <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden border border-slate-200">
            <div
              className="bg-indigo-600 h-full rounded-full transition-all duration-300 ease-out"
              style={{ width: `${percentage}%` }}
              role="progressbar"
              aria-valuenow={percentage}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>

          {totalChunks > 0 && (
            <div className="text-xs text-slate-500 text-center font-mono">
              Chunk {currentChunk} of {totalChunks}
            </div>
          )}
        </div>

        {lowConfidenceCount > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-xs text-amber-900 flex items-center gap-2">
            <span className="font-semibold">⚠️ {lowConfidenceCount} unclear words flagged</span>
            <span className="text-amber-700">— will be highlighted in the review gate.</span>
          </div>
        )}
      </div>
    </div>
  );
};

export const LocalAsrProgressModal = TranscriptProgressModal;
