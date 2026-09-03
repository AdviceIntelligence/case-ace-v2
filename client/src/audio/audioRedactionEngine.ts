/**
 * audioRedactionEngine.ts
 * 
 * Implements Phase 10: Audio Redaction, Region-Level Acoustic Energy Assertions,
 * Interval Merging, and Linear16 WAV Transcoding for Cloud Speech-to-Text v2.
 * 
 * Invariants Enforced:
 * 1. Minimum 250ms padding enforced on both sides of every redaction span.
 * 2. Overlapping or closely adjacent spans (< 100ms apart) are merged into continuous intervals.
 * 3. Exact duration preservation: redacted buffer sample count === raw buffer sample count.
 * 4. Region-level acoustic assertions: RMS energy inside silence-redacted regions must be 0.0.
 * 5. Volatile in-memory operations only: zero disk writes, zero persistent files.
 */

import type { AdviserDecision } from '../state/volatileStore.ts';

export interface RedactionSpan {
  id: string;
  startSec: number;
  endSec: number;
  category?: string;
  surrogateToken?: string;
  adviserDecision?: AdviserDecision;
}

export interface MergedRedactionInterval {
  id: string;
  startSec: number;
  endSec: number;
  startSample: number;
  endSample: number;
  sampleCount: number;
  sourceSpanIds: string[];
  appliedPaddingSec: number;
  mode: 'silence' | '1khz_tone';
  rmsEnergy: number;
  peakAmplitude: number;
}

export interface RedactionEngineConfig {
  paddingMs: number; // Must be >= 250ms
  mode: 'silence' | '1khz_tone';
  sampleRate: number; // Default 16000
  mergeThresholdMs?: number; // Merge intervals separated by <= threshold, default 100ms
}

export interface RedactionResult {
  redactedFloat32Audio: Float32Array;
  redactedArrayBuffer: ArrayBuffer;
  durationSeconds: number;
  sampleRate: number;
  mergedIntervals: MergedRedactionInterval[];
  originalSampleCount: number;
  redactedSampleCount: number;
  paddingAppliedMs: number;
  totalMutedSeconds: number;
}

export class AudioRedactionEngine {
  public static readonly MINIMUM_PADDING_MS = 250;
  public static readonly DEFAULT_PADDING_MS = 300;
  public static readonly DEFAULT_SAMPLE_RATE = 16000;
  public static readonly DEFAULT_MERGE_THRESHOLD_MS = 100;

  /**
   * Validates and merges redaction spans with mandatory minimum 250ms padding.
   */
  public prepareMergedIntervals(
    spans: RedactionSpan[],
    totalDurationSeconds: number,
    config?: Partial<RedactionEngineConfig>
  ): MergedRedactionInterval[] {
    const paddingMs = Math.max(
      AudioRedactionEngine.MINIMUM_PADDING_MS,
      config?.paddingMs ?? AudioRedactionEngine.DEFAULT_PADDING_MS
    );
    const paddingSec = paddingMs / 1000.0;
    const sampleRate = config?.sampleRate ?? AudioRedactionEngine.DEFAULT_SAMPLE_RATE;
    const mergeThresholdSec = (config?.mergeThresholdMs ?? AudioRedactionEngine.DEFAULT_MERGE_THRESHOLD_MS) / 1000.0;
    const mode = config?.mode ?? 'silence';

    // Filter to approved spans with valid time ranges
    const validSpans = spans
      .filter((s) => s.adviserDecision !== 'rejected')
      .filter((s) => typeof s.startSec === 'number' && typeof s.endSec === 'number' && s.endSec > s.startSec);

    if (validSpans.length === 0) {
      return [];
    }

    // Expand each span with padding on both sides
    const expandedIntervals = validSpans.map((span) => {
      const paddedStart = Math.max(0, span.startSec - paddingSec);
      const paddedEnd = Math.min(totalDurationSeconds, span.endSec + paddingSec);
      return {
        id: span.id,
        startSec: paddedStart,
        endSec: paddedEnd,
        sourceSpanIds: [span.id],
      };
    });

    // Sort intervals chronologically by start time
    expandedIntervals.sort((a, b) => a.startSec - b.startSec);

    // Merge overlapping or closely adjacent intervals
    const merged: Array<{
      id: string;
      startSec: number;
      endSec: number;
      sourceSpanIds: string[];
    }> = [];

    for (const current of expandedIntervals) {
      if (merged.length === 0) {
        merged.push({ ...current });
        continue;
      }

      const prev = merged[merged.length - 1];

      // Check if current overlaps or is within mergeThresholdSec of previous
      if (current.startSec <= prev.endSec + mergeThresholdSec) {
        // Merge intervals
        prev.endSec = Math.max(prev.endSec, current.endSec);
        prev.sourceSpanIds.push(...current.sourceSpanIds);
      } else {
        merged.push({ ...current });
      }
    }

    // Convert merged intervals to sample-exact boundaries
    return merged.map((interval, index) => {
      const startSample = Math.max(0, Math.floor(interval.startSec * sampleRate));
      const endSample = Math.min(
        Math.floor(totalDurationSeconds * sampleRate),
        Math.ceil(interval.endSec * sampleRate)
      );
      const sampleCount = Math.max(0, endSample - startSample);

      return {
        id: `merged_interval_${index + 1}`,
        startSec: interval.startSec,
        endSec: interval.endSec,
        startSample,
        endSample,
        sampleCount,
        sourceSpanIds: interval.sourceSpanIds,
        appliedPaddingSec: paddingSec,
        mode,
        rmsEnergy: 0,
        peakAmplitude: 0,
      };
    });
  }

  /**
   * Performs acoustic redaction on 16kHz mono Float32 PCM audio.
   */
  public redactAudio(
    rawAudioBuffer: ArrayBuffer,
    spans: RedactionSpan[],
    config?: Partial<RedactionEngineConfig>
  ): RedactionResult {
    const sampleRate = config?.sampleRate ?? AudioRedactionEngine.DEFAULT_SAMPLE_RATE;
    const mode = config?.mode ?? 'silence';
    const paddingMs = Math.max(
      AudioRedactionEngine.MINIMUM_PADDING_MS,
      config?.paddingMs ?? AudioRedactionEngine.DEFAULT_PADDING_MS
    );

    const rawSamples = new Float32Array(rawAudioBuffer);
    const totalSamples = rawSamples.length;
    const durationSeconds = totalSamples / sampleRate;

    // Create a new Float32Array copy for redacted audio (never mutate raw until verified)
    const redactedSamples = new Float32Array(totalSamples);
    redactedSamples.set(rawSamples);

    // Prepare merged intervals with padding
    const mergedIntervals = this.prepareMergedIntervals(spans, durationSeconds, {
      ...config,
      paddingMs,
      mode,
      sampleRate,
    });

    let totalMutedSamples = 0;

    for (const interval of mergedIntervals) {
      const start = Math.min(interval.startSample, totalSamples);
      const end = Math.min(interval.endSample, totalSamples);
      const count = Math.max(0, end - start);

      if (count === 0) continue;

      if (mode === 'silence') {
        // Pure digital silence (0.0f)
        for (let i = start; i < end; i++) {
          redactedSamples[i] = 0.0;
        }
      } else if (mode === '1khz_tone') {
        // 1kHz sine wave bleep with 10ms smooth raised cosine fade at boundaries
        const toneFreq = 1000;
        const fadeSamples = Math.min(Math.floor(sampleRate * 0.01), Math.floor(count / 2)); // 10ms fade
        const amplitude = 0.15; // Moderate volume for bleep

        for (let i = start; i < end; i++) {
          const relativeSample = i - start;
          const t = relativeSample / sampleRate;
          let env = 1.0;

          if (relativeSample < fadeSamples) {
            // Fade-in envelope: 0.5 * (1 - cos(pi * n / N))
            env = 0.5 * (1 - Math.cos((Math.PI * relativeSample) / fadeSamples));
          } else if (relativeSample >= count - fadeSamples) {
            // Fade-out envelope
            const outIndex = count - relativeSample;
            env = 0.5 * (1 - Math.cos((Math.PI * outIndex) / fadeSamples));
          }

          redactedSamples[i] = amplitude * env * Math.sin(2 * Math.PI * toneFreq * t);
        }
      }

      totalMutedSamples += count;
    }

    // Run Region-Level Acoustic Energy Assertions
    this.assertRegionAcoustics(redactedSamples, mergedIntervals, mode);

    // Assert exact duration preservation
    if (redactedSamples.length !== totalSamples) {
      throw new Error(
        `Duration Invariant Violation: Redacted audio sample count (${redactedSamples.length}) does not match original (${totalSamples}).`
      );
    }

    const totalMutedSeconds = totalMutedSamples / sampleRate;

    return {
      redactedFloat32Audio: redactedSamples,
      redactedArrayBuffer: redactedSamples.buffer,
      durationSeconds,
      sampleRate,
      mergedIntervals,
      originalSampleCount: totalSamples,
      redactedSampleCount: redactedSamples.length,
      paddingAppliedMs: paddingMs,
      totalMutedSeconds,
    };
  }

  /**
   * Region-Level Acoustic Energy Assertions.
   * Asserts that no speech energy remains in any approved redacted region.
   */
  public assertRegionAcoustics(
    redactedSamples: Float32Array,
    mergedIntervals: MergedRedactionInterval[],
    mode: 'silence' | '1khz_tone'
  ): void {
    for (const interval of mergedIntervals) {
      const start = Math.min(interval.startSample, redactedSamples.length);
      const end = Math.min(interval.endSample, redactedSamples.length);
      const count = end - start;

      if (count <= 0) continue;

      let sumSquares = 0.0;
      let peak = 0.0;

      for (let i = start; i < end; i++) {
        const sample = redactedSamples[i];
        const abs = Math.abs(sample);
        sumSquares += sample * sample;
        if (abs > peak) {
          peak = abs;
        }
      }

      const rms = Math.sqrt(sumSquares / count);
      interval.rmsEnergy = rms;
      interval.peakAmplitude = peak;

      if (mode === 'silence') {
        // For silence, RMS energy and peak amplitude must be strictly 0.0
        if (rms > 0.00001 || peak > 0.00001) {
          throw new Error(
            `Acoustic Assertion Failed for region ${interval.id} [${interval.startSec.toFixed(2)}s - ${interval.endSec.toFixed(2)}s]: Expected pure silence (RMS 0.0), but detected residual energy (RMS: ${rms.toFixed(6)}, Peak: ${peak.toFixed(6)}).`
          );
        }
      } else if (mode === '1khz_tone') {
        // For 1kHz tone, ensure peak does not exceed maximum allowable tone ceiling (0.20)
        if (peak > 0.20) {
          throw new Error(
            `Acoustic Assertion Failed for region ${interval.id}: Peak amplitude ${peak} exceeded allowable tone ceiling 0.20.`
          );
        }
      }
    }
  }

  /**
   * Encodes Float32 mono 16kHz PCM into standard 16-bit LINEAR16 WAV format.
   * Required for Cloud Speech-to-Text v2 ingestion.
   */
  public encodeLinear16Wav(float32Audio: Float32Array, sampleRate = 16000): ArrayBuffer {
    const numChannels = 1;
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataByteCount = float32Audio.length * bytesPerSample;
    const totalByteCount = 44 + dataByteCount; // 44-byte standard RIFF WAV header

    const buffer = new ArrayBuffer(totalByteCount);
    const view = new DataView(buffer);

    // Helper to write ASCII strings
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    // 1. RIFF chunk descriptor
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataByteCount, true); // ChunkSize (little-endian)
    writeString(8, 'WAVE');

    // 2. fmt sub-chunk
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
    view.setUint16(20, 1, true); // AudioFormat (1 = Linear PCM)
    view.setUint16(22, numChannels, true); // NumChannels (1 = Mono)
    view.setUint32(24, sampleRate, true); // SampleRate (16000)
    view.setUint32(28, byteRate, true); // ByteRate (16000 * 1 * 2 = 32000)
    view.setUint16(32, blockAlign, true); // BlockAlign (2)
    view.setUint16(34, bitsPerSample, true); // BitsPerSample (16)

    // 3. data sub-chunk
    writeString(36, 'data');
    view.setUint32(40, dataByteCount, true); // Subchunk2Size

    // Convert Float32 [-1.0, 1.0] to signed 16-bit integer [-32768, 32767]
    let offset = 44;
    for (let i = 0; i < float32Audio.length; i++) {
      // Clamp between -1.0 and 1.0
      const s = Math.max(-1.0, Math.min(1.0, float32Audio[i]));
      // Scale to 16-bit signed integer with proper rounding
      const int16 = Math.round(s < 0 ? s * 0x8000 : s * 0x7fff);
      view.setInt16(offset, int16, true); // Little-endian
      offset += 2;
    }

    return buffer;
  }
}

export const audioRedactionEngine = new AudioRedactionEngine();
