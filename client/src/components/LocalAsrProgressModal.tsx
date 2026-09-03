/**
 * LocalAsrProgressModal.tsx
 * 
 * Progress and status modal for Pass One Local Speech-to-Text (ASR).
 * 
 * Phase 7 UI Invariants:
 * 1. Progress Visibility: Shows real percentage, elapsed seconds, and dynamic ETA (not an indeterminate spinner).
 * 2. Privacy Disclaimers: Explains plainly that this transcript is solely for internal acoustic redaction and never leaves the device.
 * 3. Low-Confidence Escalation: Highlights low-confidence words detected for escalation to the Phase 9 redaction review gate.
 */

import React from 'react';
import type { WorkerAsrProgress } from '../workers/localAsrWorker.ts';

interface LocalAsrProgressModalProps {
  isOpen: boolean;
  progress: WorkerAsrProgress | null;
  hardwareBackend: 'webgpu' | 'wasm';
  lowConfidenceCount?: number;
  onCancel?: () => void;
}

export const LocalAsrProgressModal: React.FC<LocalAsrProgressModalProps> = ({
  isOpen,
  progress,
  hardwareBackend,
  lowConfidenceCount = 0,
}) => {
  if (!isOpen) return null;

  const percentage = progress ? progress.percentage : 0;
  const elapsedSec = progress ? Math.round(progress.elapsedMs / 1000) : 0;
  const remainingSec = progress ? Math.round(progress.estimatedRemainingMs / 1000) : 0;
  const processedSec = progress ? progress.processedSeconds : 0;
  const totalSec = progress ? progress.totalSeconds : 0;

  return (
    <div
      className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="local-asr-modal-title"
    >
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 border border-slate-200">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
          <div className="flex items-center gap-2">
            <span className="flex h-3 w-3 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-indigo-600"></span>
            </span>
            <h3 id="local-asr-modal-title" className="text-base font-semibold text-slate-800">
              Pass One: Local Speech Recognition
            </h3>
          </div>
          <span
            className={`text-xs px-2 py-0.5 rounded font-mono font-medium ${
              hardwareBackend === 'webgpu'
                ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                : 'bg-amber-100 text-amber-800 border border-amber-300'
            }`}
          >
            {hardwareBackend === 'webgpu' ? '⚡ WebGPU' : '⏱️ WebAssembly'}
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
            Internal Redaction Pass Only
          </div>
          This transcript is processed 100% locally on your machine to locate personal identifiers. It is
          never displayed as the working case note, is never transmitted to any cloud service, and leaves zero
          disk trace.
        </div>

        {/* Progress Metrics */}
        <div className="space-y-3 mb-5">
          <div className="flex justify-between items-center text-sm font-medium text-slate-700">
            <span>Progress: {percentage}%</span>
            <span>
              {processedSec}s / {totalSec}s audio
            </span>
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

          <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 pt-1">
            <div className="bg-slate-50 p-2 rounded border border-slate-200">
              <span className="text-slate-500 block">Elapsed Time:</span>
              <span className="font-semibold text-slate-800">{elapsedSec}s</span>
            </div>
            <div className="bg-slate-50 p-2 rounded border border-slate-200">
              <span className="text-slate-500 block">Estimated Remaining:</span>
              <span className="font-semibold text-slate-800">
                {remainingSec > 0 ? `~${remainingSec}s` : 'Finishing...'}
              </span>
            </div>
          </div>
        </div>

        {/* Live Segment Preview */}
        {progress?.currentSegmentPreview && (
          <div className="mb-4 bg-slate-900 text-slate-200 p-2.5 rounded font-mono text-xs overflow-hidden text-ellipsis whitespace-nowrap">
            <span className="text-indigo-400">Processing: </span>
            {progress.currentSegmentPreview}
          </div>
        )}

        {/* Low Confidence Escalation Notice */}
        {lowConfidenceCount > 0 && (
          <div className="flex items-center gap-2 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-900">
            <span className="font-bold">⚠️ {lowConfidenceCount}</span>
            <span>mumbled or low-confidence words flagged for escalation to review gate.</span>
          </div>
        )}
      </div>
    </div>
  );
};
