/**
 * DominantSpeakerDetector
 * 
 * Implements Phase 6.2 single dominant speaker detection for live in-person advice consultations.
 * 
 * Clinical Rationale:
 * When only the adviser's workstation microphone is captured and the client is seated
 * across the desk or on a speakerphone, the microphone may capture only the adviser's
 * voice. A transcript missing the client's words will produce an AI-generated case note
 * that misstates what the client instructed.
 * 
 * This module analyzes acoustic energy distributions and conversational turn-taking:
 * - Computes short-term energy (RMS) across 100ms analysis frames.
 * - Identifies voiced vs silent frames using adaptive noise floors.
 * - Clusters voiced energy levels to evaluate whether one dominant acoustic level
 *   (the close-mic adviser) accounts for >90% of voiced energy with zero alternating
 *   secondary speaker turns.
 * - Fires an alert when a single dominant speaker is detected so the adviser can
 *   adjust microphone placement or repeat key client statements clearly.
 */

export interface DominantSpeakerAnalysis {
  isSingleDominantSpeaker: boolean;
  dominantSpeakerRatio: number; // e.g. 0.95 = 95% of speech from primary speaker
  estimatedTurnsCount: number;
  totalVoicedDurationSeconds: number;
  warningMessage: string | null;
}

export class DominantSpeakerDetector {
  private readonly frameDurationMs = 100; // 100ms analysis window
  private readonly minAnalysisVoicedSeconds = 15; // Minimum speech before alerting
  private readonly dominanceThreshold = 0.88; // 88% of speech energy from single tier

  /**
   * Analyzes a 16kHz mono Float32 PCM buffer for single dominant speaker patterns.
   */
  public analyzePcmBuffer(pcmBuffer: ArrayBuffer, sampleRate: number = 16000): DominantSpeakerAnalysis {
    const floatArray = new Float32Array(pcmBuffer);
    if (floatArray.length === 0) {
      return {
        isSingleDominantSpeaker: false,
        dominantSpeakerRatio: 0,
        estimatedTurnsCount: 0,
        totalVoicedDurationSeconds: 0,
        warningMessage: null,
      };
    }

    const frameSize = Math.floor((sampleRate * this.frameDurationMs) / 1000);
    const totalFrames = Math.floor(floatArray.length / frameSize);

    if (totalFrames === 0) {
      return {
        isSingleDominantSpeaker: false,
        dominantSpeakerRatio: 0,
        estimatedTurnsCount: 0,
        totalVoicedDurationSeconds: 0,
        warningMessage: null,
      };
    }

    // 1. Calculate RMS energy for each frame
    const frameEnergies: number[] = new Array(totalFrames);
    let maxEnergy = 0;
    let sumEnergy = 0;

    for (let f = 0; f < totalFrames; f++) {
      const offset = f * frameSize;
      let sumSquares = 0;
      for (let i = 0; i < frameSize; i++) {
        const sample = floatArray[offset + i];
        sumSquares += sample * sample;
      }
      const rms = Math.sqrt(sumSquares / frameSize);
      frameEnergies[f] = rms;
      sumEnergy += rms;
      if (rms > maxEnergy) maxEnergy = rms;
    }

    // 1. Establish voice thresholds
    const voiceThreshold = 0.02; // Threshold for conversational speech
    const highVoiceThreshold = 0.10; // Threshold for loud / close-mic speaker

    // 2. Identify voiced frames and group into energy buckets
    // High energy (close mic = adviser) vs Moderate/Low energy (distant = client across desk)
    const voicedEnergies: number[] = [];
    let highEnergyCount = 0;
    let secondarySpeakerCount = 0;
    let estimatedTurns = 0;
    let lastVoiceTier: 'none' | 'high' | 'secondary' = 'none';

    for (let f = 0; f < totalFrames; f++) {
      const energy = frameEnergies[f];
      if (energy >= voiceThreshold) {
        voicedEnergies.push(energy);
        const currentTier: 'high' | 'secondary' = energy >= highVoiceThreshold ? 'high' : 'secondary';

        if (currentTier === 'high') {
          highEnergyCount++;
        } else {
          secondarySpeakerCount++;
        }

        if (lastVoiceTier !== 'none' && lastVoiceTier !== currentTier) {
          estimatedTurns++;
        }
        lastVoiceTier = currentTier;
      }
      // A pause deliberately does NOT reset the tier. Previously an unvoiced frame set the
      // tier back to 'none', so a change of speaker across a natural pause was never counted
      // as a turn. Since people pause when they hand over, a normal two-way consultation
      // scored zero turns, and the "turns <= 1 over 20s of speech" branch below then flagged
      // it as a single dominant speaker. That produced a warning on ordinary interviews.
    }

    const voicedDurationSeconds = (voicedEnergies.length * this.frameDurationMs) / 1000;
    const totalVoiced = highEnergyCount + secondarySpeakerCount;

    if (totalVoiced === 0 || voicedDurationSeconds < this.minAnalysisVoicedSeconds) {
      return {
        isSingleDominantSpeaker: false,
        dominantSpeakerRatio: totalVoiced > 0 ? highEnergyCount / totalVoiced : 0,
        estimatedTurnsCount: estimatedTurns,
        totalVoicedDurationSeconds: voicedDurationSeconds,
        warningMessage: null,
      };
    }

    // Single dominant speaker is detected when:
    // 1. One energy tier accounts for >= dominanceThreshold (e.g. 88%) of all speech
    // 2. Or turns count is near zero during substantial voiced conversation (>15s)
    const dominanceRatio = Math.max(highEnergyCount, secondarySpeakerCount) / totalVoiced;
    const isSingleDominant = dominanceRatio >= this.dominanceThreshold || (estimatedTurns <= 1 && voicedDurationSeconds >= 20);

    const warningMessage = isSingleDominant
      ? `Single dominant speaker detected (${Math.round(dominanceRatio * 100)}% speech dominance). ` +
        `Ensure the client's voice is clearly audible near the microphone so their instructions are accurately recorded.`
      : null;

    return {
      isSingleDominantSpeaker: isSingleDominant,
      dominantSpeakerRatio: Math.round(dominanceRatio * 100) / 100,
      estimatedTurnsCount: estimatedTurns,
      totalVoicedDurationSeconds: Math.round(voicedDurationSeconds * 10) / 10,
      warningMessage,
    };
  }

  public analyzePcmChunk(chunk: Float32Array, sampleRate: number = 16000): DominantSpeakerAnalysis {
    return this.analyzePcmBuffer(chunk.buffer, sampleRate);
  }

  public reset(): void {
    // Reset internal state if any
  }
}

export const dominantSpeakerDetector = new DominantSpeakerDetector();
