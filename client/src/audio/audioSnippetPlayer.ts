/**
 * Audio Snippet Player
 * 
 * Plays audio snippets directly from volatile Float32Array PCM in memory.
 * Never writes to disk, never uses blob URLs, never leaks buffers.
 * Enforces Constraint C1 (Volatile-Only Memory Discipline) and C4.
 */

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(sampleRate: number = 16000): AudioContext {
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    sharedAudioCtx = new AudioContextClass({ sampleRate });
  }
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

export interface PlaySnippetOptions {
  pcmData: Float32Array;
  sampleRate?: number;
  startSec: number;
  endSec: number;
  paddingSec?: number; // Pre- and post-roll context padding (default: 0.25s)
  onEnded?: () => void;
  onError?: (err: Error) => void;
}

export interface SnippetPlaybackController {
  stop: () => void;
  isPlaying: () => boolean;
}

/**
 * Plays an audio slice directly from volatile RAM with surrounding context.
 */
export function playAudioSnippet(options: PlaySnippetOptions): SnippetPlaybackController {
  const {
    pcmData,
    sampleRate = 16000,
    startSec,
    endSec,
    paddingSec = 0.25,
    onEnded,
    onError,
  } = options;

  let isPlaying = true;
  let sourceNode: AudioBufferSourceNode | null = null;

  try {
    const audioCtx = getAudioContext(sampleRate);

    // Calculate padded bounds in sample indices
    const actualStartSec = Math.max(0, startSec - paddingSec);
    const totalDurationSec = pcmData.length / sampleRate;
    const actualEndSec = Math.min(totalDurationSec, Math.max(startSec + 0.1, endSec + paddingSec));

    const startSample = Math.floor(actualStartSec * sampleRate);
    const endSample = Math.ceil(actualEndSec * sampleRate);
    const snippetLength = Math.max(1, endSample - startSample);

    // Create an AudioBuffer in memory
    const audioBuffer = audioCtx.createBuffer(1, snippetLength, sampleRate);
    const channelData = audioBuffer.getChannelData(0);

    // Copy slice into channel data
    for (let i = 0; i < snippetLength; i++) {
      const srcIdx = startSample + i;
      channelData[i] = srcIdx < pcmData.length ? pcmData[srcIdx] : 0;
    }

    // Create and play buffer source
    sourceNode = audioCtx.createBufferSource();
    sourceNode.buffer = audioBuffer;
    sourceNode.connect(audioCtx.destination);

    sourceNode.onended = () => {
      isPlaying = false;
      if (onEnded) onEnded();
    };

    sourceNode.start(0);
  } catch (err) {
    isPlaying = false;
    if (onError && err instanceof Error) {
      onError(err);
    } else if (onError) {
      onError(new Error(String(err)));
    }
  }

  return {
    stop: () => {
      if (sourceNode && isPlaying) {
        try {
          sourceNode.stop();
        } catch {
          // Ignore if already stopped
        }
        isPlaying = false;
      }
    },
    isPlaying: () => isPlaying,
  };
}
