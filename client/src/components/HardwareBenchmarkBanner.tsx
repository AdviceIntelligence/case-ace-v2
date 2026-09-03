/**
 * HardwareBenchmarkBanner.tsx
 * 
 * Pre-session hardware evaluation banner.
 * Assesses WebGPU hardware acceleration availability vs WebAssembly fallback
 * and alerts the adviser upfront before consultations if processing may take longer.
 */

import React, { useEffect, useState } from 'react';
import { localAsrEngine, type HardwareBenchmarkResult } from '../asr/localAsrEngine.ts';

export const HardwareBenchmarkBanner: React.FC = () => {
  const [benchmark, setBenchmark] = useState<HardwareBenchmarkResult | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    let mounted = true;
    localAsrEngine.assessHardwareCapabilities().then((res) => {
      if (mounted) setBenchmark(res);
    });
    return () => {
      mounted = false;
    };
  }, []);

  if (!benchmark || isDismissed) return null;

  return (
    <div
      className={`p-3 rounded-lg text-xs flex items-center justify-between border mb-4 transition-all ${
        benchmark.hasWebGpu
          ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
          : 'bg-amber-50 border-amber-300 text-amber-950'
      }`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-2.5">
        <span className="text-base select-none" aria-hidden="true">
          {benchmark.hasWebGpu ? '⚡' : '⏱️'}
        </span>
        <div>
          <div className="font-semibold flex items-center gap-2">
            <span>
              {benchmark.hasWebGpu
                ? 'Pass One Hardware Acceleration: WebGPU Active'
                : 'Pass One Processing Mode: WebAssembly CPU Fallback'}
            </span>
            <span
              className={`px-1.5 py-0.5 rounded font-mono text-[10px] uppercase tracking-wider ${
                benchmark.hasWebGpu ? 'bg-emerald-200 text-emerald-800' : 'bg-amber-200 text-amber-900'
              }`}
            >
              {benchmark.recommendedBackend}
            </span>
          </div>
          <p className="mt-0.5 opacity-90 leading-relaxed">{benchmark.advisoryMessage}</p>
        </div>
      </div>
      <button
        onClick={() => setIsDismissed(true)}
        className="ml-4 px-2 py-1 hover:bg-black/5 rounded text-gray-500 hover:text-gray-800 font-medium cursor-pointer"
        aria-label="Dismiss hardware status notice"
      >
        ✕
      </button>
    </div>
  );
};
