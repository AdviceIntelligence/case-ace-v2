/**
 * audioChunker
 *
 * Splits a consultation's audio into pieces small enough for Google Speech-to-Text v2's
 * synchronous `recognize` method, cutting at the quietest available moment so that words are
 * not sliced in half.
 *
 * Why this exists
 * ---------------
 * `recognize` accepts at most 60 seconds of audio per request. The alternative,
 * `batchRecognize`, handles up to 8 hours but "is only able to transcribe audio stored in
 * Cloud Storage", which would put a client's recording at rest on disk. Chunking keeps the
 * whole pipeline in volatile memory: the audio exists in RAM, is sent in pieces over TLS, and
 * is never written anywhere.
 *
 * The cost is that a chunk boundary can interrupt a sentence, and speaker labels are assigned
 * per request rather than across the whole consultation. Cutting at low energy keeps the first
 * problem rare. The second is corrected by the adviser at review.
 *
 * References:
 *   https://docs.cloud.google.com/speech-to-text/v2/docs/sync-recognize
 *   https://docs.cloud.google.com/speech-to-text/v2/docs/batch-recognize
 */

/** Google's hard limit is 60s. The margin absorbs sample-rate rounding and header bytes. */
export const MAX_CHUNK_SECONDS = 55;

/**
 * A chunk is never shorter than this unless it is the last one, so that the quiet-point search
 * has somewhere to look and a long consultation does not fragment into hundreds of requests.
 */
export const MIN_CHUNK_SECONDS = 35;

/** Window used when scoring how quiet a candidate cut point is. */
const CUT_SEARCH_WINDOW_SECONDS = 0.12;

export interface AudioChunk {
  index: number;
  startSample: number;
  endSample: number;
  /** Offset of this chunk within the consultation, in seconds. Added to every word timing. */
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  chunkIndex?: number;
  startSec?: number;
  endSec?: number;
  durationSec?: number;
  pcmData?: Float32Array | Int16Array;
}

function rmsOver(pcm: Float32Array | Int16Array, start: number, length: number): number {
  const end = Math.min(pcm.length, start + length);
  if (end <= start) return 0;
  let sumSquares = 0;
  for (let i = start; i < end; i++) {
    sumSquares += pcm[i] * pcm[i];
  }
  return Math.sqrt(sumSquares / (end - start));
}

/**
 * Finds the quietest point in [searchStart, searchEnd) to cut at.
 * Returns searchEnd when the range is too small to search, which still yields a valid chunk.
 */
export function findQuietestCutPoint(
  pcm: Float32Array | Int16Array,
  searchStart: number,
  searchEnd: number,
  sampleRate: number,
): number {
  const windowLength = Math.max(1, Math.floor(sampleRate * CUT_SEARCH_WINDOW_SECONDS));
  if (searchEnd - searchStart <= windowLength) return searchEnd;

  // Step by half a window: fine enough to land in a real pause, coarse enough to stay cheap
  // on a 40 minute recording.
  const step = Math.max(1, Math.floor(windowLength / 2));

  let quietestPoint = searchEnd;
  let quietestEnergy = Number.POSITIVE_INFINITY;

  for (let point = searchStart; point + windowLength <= searchEnd; point += step) {
    const energy = rmsOver(pcm, point, windowLength);
    if (energy < quietestEnergy) {
      quietestEnergy = energy;
      quietestPoint = point + Math.floor(windowLength / 2); // cut in the middle of the pause
    }
  }

  return Math.min(searchEnd, Math.max(searchStart, quietestPoint));
}

/**
 * Plans the chunk boundaries for a recording. Pure: it reads the audio but does not copy it.
 * Chunks tile the recording exactly, with no gap and no overlap, so no speech is lost or
 * transcribed twice.
 */
export function planTranscriptionChunks(
  pcm: Float32Array,
  sampleRate: number,
  options: { maxChunkSeconds?: number; minChunkSeconds?: number } = {},
): AudioChunk[] {
  if (!(pcm instanceof Float32Array) || pcm.length === 0) {
    throw new Error('Cannot plan transcription chunks: the recording contains no audio.');
  }
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error(`Cannot plan transcription chunks: invalid sample rate ${sampleRate}.`);
  }

  const maxChunkSeconds = options.maxChunkSeconds ?? MAX_CHUNK_SECONDS;
  const minChunkSeconds = Math.min(options.minChunkSeconds ?? MIN_CHUNK_SECONDS, maxChunkSeconds);

  const maxSamples = Math.floor(maxChunkSeconds * sampleRate);
  const minSamples = Math.floor(minChunkSeconds * sampleRate);

  const chunks: AudioChunk[] = [];
  let cursor = 0;

  while (cursor < pcm.length) {
    const remaining = pcm.length - cursor;

    let endSample: number;
    if (remaining <= maxSamples) {
      endSample = pcm.length;
    } else {
      const hardLimit = cursor + maxSamples;
      const searchStart = Math.min(hardLimit, cursor + minSamples);
      endSample = findQuietestCutPoint(pcm, searchStart, hardLimit, sampleRate);
      // Defensive: never emit an empty or backwards chunk, whatever the search returns.
      if (endSample <= cursor) endSample = hardLimit;
    }

    chunks.push({
      index: chunks.length,
      startSample: cursor,
      endSample,
      startSeconds: cursor / sampleRate,
      endSeconds: endSample / sampleRate,
      durationSeconds: (endSample - cursor) / sampleRate,
    });

    cursor = endSample;
  }

  return chunks;
}

/** Copies one planned chunk out of the recording, ready for encoding. */
export function sliceChunk(pcm: Float32Array, chunk: AudioChunk): Float32Array {
  return pcm.slice(chunk.startSample, chunk.endSample);
}

/**
 * Splits in-memory audio into chunks with attached pcmData (convenience helper).
 */
export function chunkAudioBuffer(
  pcm: Float32Array,
  sampleRate: number,
  options: { targetMaxDurationSec?: number; minSearchDurationSec?: number } = {}
): AudioChunk[] {
  const planned = planTranscriptionChunks(pcm, sampleRate, {
    maxChunkSeconds: options.targetMaxDurationSec,
    minChunkSeconds: options.minSearchDurationSec,
  });

  return planned.map((chunk) => ({
    ...chunk,
    chunkIndex: chunk.index,
    startSec: chunk.startSeconds,
    endSec: chunk.endSeconds,
    durationSec: chunk.durationSeconds,
    pcmData: sliceChunk(pcm, chunk),
  }));
}
