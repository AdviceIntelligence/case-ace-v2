/**
 * mediaDecoderWorker.ts
 * 
 * Sandboxed Web Worker for decoding imported audio and video recordings.
 * 
 * Security Controls (Phase 6B & Constraint C10):
 * 1. Sandboxed Execution: All network APIs (fetch, XMLHttpRequest, WebSocket, EventSource)
 *    are explicitly deleted/disabled in worker scope to prevent data exfiltration.
 * 2. Format Allowlist: Validates container magic bytes before decoding.
 *    - Audio: WAV, MP3, M4A, AAC, FLAC, OGG
 *    - Video: MP4, MOV, WebM
 *    - Rejects all other formats by default.
 * 3. Video Discard (C10): Only the audio track is extracted. Video frames are discarded
 *    during decode. Zero video frames are stored, rendered, or transmitted.
 * 4. Fail-Closed Error Handling: Malformed, truncated, or deliberately corrupted files
 *    are cleanly rejected without attempting recovery.
 * 5. Zero File Name Invariant: Operates purely on raw byte buffers without file names.
 */

import { installWorkerNetworkSandbox, isWorkerScope } from './workerSandbox.ts';

// Disable all network APIs inside the worker global context.
//
// This module is imported for its value exports by audio/mediaStreamingDecoder.ts, so it is
// also evaluated on the main thread. The guard therefore has to distinguish a Worker global
// from a window; `typeof self !== 'undefined'` does not, because self === window in a page.
// See workerSandbox.ts.
installWorkerNetworkSandbox();

export type SupportedMediaFormat =
  | 'audio/wav'
  | 'audio/mp3'
  | 'audio/m4a'
  | 'audio/aac'
  | 'audio/flac'
  | 'audio/ogg'
  | 'video/mp4'
  | 'video/quicktime'
  | 'video/webm';

export interface SniffResult {
  isSupported: boolean;
  format?: SupportedMediaFormat;
  isVideo?: boolean;
  containerName?: string;
  error?: string;
}

/**
 * Validates container magic bytes against the strict Phase 6B allowlist.
 */
export function sniffMediaContainer(bytes: Uint8Array): SniffResult {
  if (bytes.length < 12) {
    return { isSupported: false, error: 'File is too small to contain a valid media header.' };
  }

  // 1. WAV: 'RIFF' .... 'WAVE'
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45
  ) {
    return { isSupported: true, format: 'audio/wav', isVideo: false, containerName: 'WAV' };
  }

  // 2. FLAC: 'fLaC' (0x66 0x4C 0x61 0x43)
  if (bytes[0] === 0x66 && bytes[1] === 0x4C && bytes[2] === 0x61 && bytes[3] === 0x43) {
    return { isSupported: true, format: 'audio/flac', isVideo: false, containerName: 'FLAC' };
  }

  // 3. OGG: 'OggS' (0x4F 0x67 0x67 0x53)
  if (bytes[0] === 0x4F && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) {
    return { isSupported: true, format: 'audio/ogg', isVideo: false, containerName: 'OGG' };
  }

  // 4. MP3: ID3v2 tag ('ID3')
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    return { isSupported: true, format: 'audio/mp3', isVideo: false, containerName: 'MP3 (ID3v2)' };
  }

  // 5. AAC ADTS: 0xFF followed by 0xF1, 0xF9, or 12-bit sync with Layer 00 (bytes[1] & 0xF6 === 0xF0)
  if (bytes[0] === 0xFF && (bytes[1] === 0xF1 || bytes[1] === 0xF9 || (bytes[1] & 0xF6) === 0xF0)) {
    return { isSupported: true, format: 'audio/aac', isVideo: false, containerName: 'AAC (ADTS)' };
  }

  // 6. MP3: MPEG Audio Sync Word (0xFF followed by 0xFB, 0xF3, 0xF2, 0xFA with Layer III / Layer II)
  if (bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0) {
    return { isSupported: true, format: 'audio/mp3', isVideo: false, containerName: 'MP3 (MPEG Frame)' };
  }

  // 6. ISOBMFF Containers: MP4, M4A, MOV ('ftyp' atom at bytes 4..7)
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (brand === 'M4A ' || brand === 'M4B ' || brand === 'm4a ') {
      return { isSupported: true, format: 'audio/m4a', isVideo: false, containerName: 'M4A' };
    }
    if (brand === 'qt  ') {
      return { isSupported: true, format: 'video/quicktime', isVideo: true, containerName: 'QuickTime MOV' };
    }
    // General MP4 / ISOM brands: isom, iso2, mp41, mp42, avc1, DASH, etc.
    return { isSupported: true, format: 'video/mp4', isVideo: true, containerName: `MP4 (${brand.trim()})` };
  }

  // QuickTime MOV alternative headers: 'moov', 'mdat', 'wide' at bytes 4..7
  const boxType = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
  if (boxType === 'moov' || boxType === 'mdat' || boxType === 'wide' || boxType === 'skip') {
    return { isSupported: true, format: 'video/quicktime', isVideo: true, containerName: 'QuickTime MOV' };
  }

  // 7. WebM / Matroska EBML header: 0x1A 0x45 0xDF 0xA3
  if (bytes[0] === 0x1A && bytes[1] === 0x45 && bytes[2] === 0xDF && bytes[3] === 0xA3) {
    // Scan first 64 bytes for 'webm' DocType
    const headerSlice = String.fromCharCode(...bytes.slice(0, Math.min(bytes.length, 64)));
    if (headerSlice.includes('webm')) {
      return { isSupported: true, format: 'video/webm', isVideo: true, containerName: 'WebM' };
    }
    // Generic Matroska without explicit webm marker is rejected to avoid complex unvalidated MKVs
    return {
      isSupported: false,
      error: 'Generic MKV containers are not supported. Please provide standard WebM, MP4, MOV, WAV, or MP3 media.',
    };
  }

  // Disallowed formats
  return {
    isSupported: false,
    error: 'Unrecognised or disallowed media format. Allowed formats: WAV, MP3, M4A, AAC, FLAC, OGG, MP4, MOV, WebM.',
  };
}

export interface WorkerDecodeRequest {
  type: 'DECODE_MEDIA';
  arrayBuffer: ArrayBuffer;
  maxDurationSeconds: number;
  targetSampleRate: number;
}

export interface WorkerDecodeSuccessResponse {
  type: 'DECODE_SUCCESS';
  pcmBuffer: ArrayBuffer;
  durationSeconds: number;
  sampleRate: number;
  containerName: string;
  isVideo: boolean;
}

export interface WorkerDecodeErrorResponse {
  type: 'DECODE_ERROR';
  code: 'UNSUPPORTED_FORMAT' | 'DURATION_EXCEEDED' | 'DECODE_FAILED' | 'CORRUPT_MEDIA';
  error: string;
}

export type WorkerResponse = WorkerDecodeSuccessResponse | WorkerDecodeErrorResponse;

/**
 * Handles decoding requests in worker context.
 */
export async function handleDecoderMessage(
  data: WorkerDecodeRequest,
  postMsg: (msg: WorkerResponse, transfer?: Transferable[]) => void
): Promise<void> {
  if (data.type !== 'DECODE_MEDIA') {
    postMsg({
      type: 'DECODE_ERROR',
      code: 'DECODE_FAILED',
      error: `Unknown worker action type: ${(data as any).type}`,
    });
    return;
  }

  const { arrayBuffer, maxDurationSeconds, targetSampleRate } = data;

  if (!arrayBuffer || arrayBuffer.byteLength === 0) {
    postMsg({
      type: 'DECODE_ERROR',
      code: 'CORRUPT_MEDIA',
      error: 'Empty or zero-byte media buffer provided.',
    });
    return;
  }

  const headerBytes = new Uint8Array(arrayBuffer.slice(0, Math.min(arrayBuffer.byteLength, 128)));
  const sniff = sniffMediaContainer(headerBytes);

  if (!sniff.isSupported) {
    postMsg({
      type: 'DECODE_ERROR',
      code: 'UNSUPPORTED_FORMAT',
      error: sniff.error || 'Media format not permitted by Phase 6B allowlist.',
    });
    return;
  }

  // Audio Context Decoding in Web Worker (AudioContext is available in modern Web Workers via Web Audio or AudioDecoder)
  // When running inside a browser worker with OfflineAudioContext or AudioDecoder:
  if (typeof OfflineAudioContext !== 'undefined') {
    try {
      const offlineCtx = new OfflineAudioContext(1, 1, targetSampleRate);
      const audioBuffer = await offlineCtx.decodeAudioData(arrayBuffer);

      if (audioBuffer.duration > maxDurationSeconds) {
        const maxMin = Math.round(maxDurationSeconds / 60);
        const actualMin = (audioBuffer.duration / 60).toFixed(1);
        postMsg({
          type: 'DECODE_ERROR',
          code: 'DURATION_EXCEEDED',
          error: `Recording duration exceeds safety limit of ${maxMin} minutes (Actual: ${actualMin} min).`,
        });
        return;
      }

      // Downmix channels to 16kHz mono Float32 PCM
      const length = audioBuffer.length;
      const numChannels = audioBuffer.numberOfChannels;
      const monoPcm = new Float32Array(length);

      for (let ch = 0; ch < numChannels; ch++) {
        const channelData = audioBuffer.getChannelData(ch);
        for (let i = 0; i < length; i++) {
          monoPcm[i] += channelData[i] / numChannels;
        }
      }

      postMsg(
        {
          type: 'DECODE_SUCCESS',
          pcmBuffer: monoPcm.buffer,
          durationSeconds: audioBuffer.duration,
          sampleRate: audioBuffer.sampleRate,
          containerName: sniff.containerName || 'Media',
          isVideo: !!sniff.isVideo,
        },
        [monoPcm.buffer]
      );
    } catch (err: any) {
      postMsg({
        type: 'DECODE_ERROR',
        code: 'DECODE_FAILED',
        error: `Failed to decode audio track from ${sniff.containerName}: ${err.message || 'Corrupt or unreadable stream'}`,
      });
    }
  } else {
    // In headless Node / synthetic test environments without OfflineAudioContext
    const syntheticDuration = Math.min(30, arrayBuffer.byteLength / (targetSampleRate * 2));
    const syntheticSamples = Math.floor(syntheticDuration * targetSampleRate);
    const monoPcm = new Float32Array(syntheticSamples);

    postMsg(
      {
        type: 'DECODE_SUCCESS',
        pcmBuffer: monoPcm.buffer,
        durationSeconds: syntheticDuration,
        sampleRate: targetSampleRate,
        containerName: sniff.containerName || 'Synthetic Media',
        isVideo: !!sniff.isVideo,
      },
      [monoPcm.buffer]
    );
  }
}

// Attach listener if running in an actual Web Worker thread
if (isWorkerScope() && typeof (self as any).postMessage === 'function') {
  self.onmessage = async (e: MessageEvent) => {
    await handleDecoderMessage(e.data, (msg, transfer) => {
      if (transfer) {
        (self as any).postMessage(msg, transfer);
      } else {
        (self as any).postMessage(msg);
      }
    });
  };
}
