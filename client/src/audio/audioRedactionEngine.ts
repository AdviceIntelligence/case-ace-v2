/**
 * audioRedactionEngine.ts
 * 
 * Provides Linear16 WAV encoding for audio buffers in volatile memory.
 * Raw audio is converted to standard 16-bit LINEAR16 WAV in-memory for
 * UK Speech-to-Text v2 synchronous recognition in europe-west2.
 */

export class AudioRedactionEngine {
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
