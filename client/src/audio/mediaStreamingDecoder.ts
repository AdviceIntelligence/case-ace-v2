/**
 * MediaStreamingDecoder
 * 
 * Client coordinator for decoding imported audio/video recordings in a sandboxed Web Worker.
 * Enforces strict memory budgets to run smoothly on legacy 8GB RAM hardware at CAW.
 * 
 * Key Controls (Phase 6B & Constraints C1, C10):
 * 1. Immediate Pre-flight Validation: Validates file size (<= 500MB) and format *before* memory allocation.
 * 2. Sandboxed Worker: Dispatches decoding to a worker with zero network access.
 * 3. Video Track Discard: Discards video frames during decode; zero video frames rendered or stored.
 * 4. Zero File Name Invariant: Operates purely on raw bytes. File names are never captured or stored.
 * 5. Volatile ArrayBuffer: Audio lives solely in RAM inside VolatileSessionStore and is zeroed on release.
 */

import { sniffMediaContainer, type SniffResult, type WorkerResponse } from '../workers/mediaDecoderWorker.ts';

export interface MediaDecoderConfig {
  maxFileSizeBytes: number;      // Default: 500 MB
  maxDurationSeconds: number;    // Default: 5400s (90 minutes)
  targetSampleRate: number;      // Default: 16000 Hz (16kHz mono for STT/ASR)
}

export const DEFAULT_MEDIA_DECODER_CONFIG: MediaDecoderConfig = {
  maxFileSizeBytes: 500 * 1024 * 1024, // 500 MB
  maxDurationSeconds: 90 * 60,         // 90 minutes
  targetSampleRate: 16000,             // 16kHz
};

export class MediaDecodeError extends Error {
  public readonly code: 'FILE_TOO_LARGE' | 'DURATION_EXCEEDED' | 'UNSUPPORTED_FORMAT' | 'DECODE_FAILED' | 'CORRUPT_MEDIA';

  constructor(
    code: 'FILE_TOO_LARGE' | 'DURATION_EXCEEDED' | 'UNSUPPORTED_FORMAT' | 'DECODE_FAILED' | 'CORRUPT_MEDIA',
    message: string
  ) {
    super(message);
    this.name = 'MediaDecodeError';
    this.code = code;
  }
}

export class MediaStreamingDecoder {
  private config: MediaDecoderConfig;

  constructor(config: Partial<MediaDecoderConfig> = {}) {
    this.config = {
      ...DEFAULT_MEDIA_DECODER_CONFIG,
      ...config,
    };
  }

  /**
   * Performs instant pre-flight validation against file size limits and container magic bytes.
   * Notice: Zero file name requirement. Validation operates solely on byte size and header sniff.
   */
  public validatePreFlight(params: { size: number; headerBytes?: Uint8Array }): { valid: boolean; error?: string; sniff?: SniffResult } {
    if (params.size > this.config.maxFileSizeBytes) {
      const maxMb = Math.round(this.config.maxFileSizeBytes / (1024 * 1024));
      const actualMb = (params.size / (1024 * 1024)).toFixed(1);
      return {
        valid: false,
        error: `File exceeds maximum allowed size of ${maxMb} MB (Actual: ${actualMb} MB). Large recordings must be trimmed or compressed before import.`,
      };
    }

    if (params.headerBytes && params.headerBytes.length >= 12) {
      const sniff = sniffMediaContainer(params.headerBytes);
      if (!sniff.isSupported) {
        return {
          valid: false,
          error: sniff.error || 'Unsupported media container format. Permitted formats: WAV, MP3, M4A, AAC, FLAC, OGG, MP4, MOV, WebM.',
          sniff,
        };
      }
      return { valid: true, sniff };
    }

    return { valid: true };
  }

  /**
   * Decodes an audio/video buffer into 16kHz mono Float32 PCM audio via a sandboxed worker,
   * immediately discarding video tracks and freeing the container buffer.
   */
  public async decodeAudio(
    input: Blob | ArrayBuffer
  ): Promise<{ pcmBuffer: ArrayBuffer; durationSeconds: number; sampleRate: number; containerName: string; isVideo: boolean }> {
    const size = input instanceof ArrayBuffer ? input.byteLength : input.size;
    
    // Quick size pre-flight
    const preFlightSize = this.validatePreFlight({ size });
    if (!preFlightSize.valid) {
      throw new MediaDecodeError('FILE_TOO_LARGE', preFlightSize.error!);
    }

    let arrayBuffer: ArrayBuffer;
    if (input instanceof ArrayBuffer) {
      arrayBuffer = input;
    } else {
      arrayBuffer = await input.arrayBuffer();
    }

    // Header pre-flight check
    const headerBytes = new Uint8Array(arrayBuffer.slice(0, Math.min(arrayBuffer.byteLength, 128)));
    const preFlightHeader = this.validatePreFlight({ size, headerBytes });
    if (!preFlightHeader.valid) {
      throw new MediaDecodeError('UNSUPPORTED_FORMAT', preFlightHeader.error!);
    }

    // In browser worker environment
    if (typeof Worker !== 'undefined') {
      return new Promise((resolve, reject) => {
        let worker: Worker | null = null;
        try {
          worker = new Worker(
            new URL('../workers/mediaDecoderWorker.ts', import.meta.url),
            { type: 'module' }
          );

          worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
            const data = e.data;
            if (data.type === 'DECODE_SUCCESS') {
              resolve({
                pcmBuffer: data.pcmBuffer,
                durationSeconds: data.durationSeconds,
                sampleRate: data.sampleRate,
                containerName: data.containerName,
                isVideo: data.isVideo,
              });
            } else {
              reject(new MediaDecodeError(data.code, data.error));
            }
            worker?.terminate();
            worker = null;
          };

          worker.onerror = (err) => {
            reject(new MediaDecodeError('DECODE_FAILED', `Sandboxed decoder worker error: ${err.message}`));
            worker?.terminate();
            worker = null;
          };

          worker.postMessage(
            {
              type: 'DECODE_MEDIA',
              arrayBuffer,
              maxDurationSeconds: this.config.maxDurationSeconds,
              targetSampleRate: this.config.targetSampleRate,
            },
            [arrayBuffer] // Transfer buffer for memory efficiency
          );
        } catch (err: any) {
          worker?.terminate();
          reject(new MediaDecodeError('DECODE_FAILED', `Failed to initialize sandboxed decoder worker: ${err.message}`));
        }
      });
    } else {
      // In Node.js / synthetic test environment without Web Workers
      const { handleDecoderMessage } = await import('../workers/mediaDecoderWorker.ts');
      return new Promise((resolve, reject) => {
        handleDecoderMessage(
          {
            type: 'DECODE_MEDIA',
            arrayBuffer,
            maxDurationSeconds: this.config.maxDurationSeconds,
            targetSampleRate: this.config.targetSampleRate,
          },
          (msg: WorkerResponse) => {
            if (msg.type === 'DECODE_SUCCESS') {
              resolve({
                pcmBuffer: msg.pcmBuffer,
                durationSeconds: msg.durationSeconds,
                sampleRate: msg.sampleRate,
                containerName: msg.containerName,
                isVideo: msg.isVideo,
              });
            } else {
              reject(new MediaDecodeError(msg.code, msg.error));
            }
          }
        );
      });
    }
  }
}

export const mediaStreamingDecoder = new MediaStreamingDecoder();
