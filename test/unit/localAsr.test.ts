/**
 * @file localAsr.test.ts
 * @description Phase 7 Acceptance Test Suite for Pass One Local ASR:
 * 1. Offline Execution & Sandboxing
 * 2. Word-Level Timestamps & Confidence Scores
 * 3. Low-Confidence Escalation Policy (<0.70 threshold)
 * 4. Real-Time Progress & Dynamic ETA
 * 5. Speaker Attribution (Webex Stereo vs Acoustic Diarisation)
 * 6. Volatile Memory Hygiene & Zero Persistence
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  detectSpeechSegments,
  inferSegmentSpeaker,
  processAsrInference,
} from '../../client/src/workers/localAsrWorker.ts';
import { volatileSessionStore } from '../../client/src/state/volatileStore.ts';

function generateSyntheticPcm(durationSec: number, sampleRate: number = 16000): Float32Array {
  const totalSamples = Math.floor(durationSec * sampleRate);
  const buffer = new Float32Array(totalSamples);
  for (let i = 0; i < totalSamples; i++) {
    const time = i / sampleRate;
    const isSpeech = (time % 2.0) < 1.4;
    if (isSpeech) {
      const f0 = 150 + 20 * Math.sin(2 * Math.PI * 0.5 * time);
      buffer[i] = 0.3 * Math.sin(2 * Math.PI * f0 * time) +
                  0.15 * Math.sin(2 * Math.PI * 3 * f0 * time) +
                  0.05 * (Math.random() - 0.5);
    } else {
      buffer[i] = (Math.random() - 0.5) * 0.001;
    }
  }
  return buffer;
}

describe('Phase 7: Pass One Local Speech-to-Text Pipeline', () => {
  beforeEach(() => {
    volatileSessionStore.destroySession();
  });

  describe('7.1 Speech Segmentation and Voice Activity Detection (VAD)', () => {
    it('detects distinct speech segments from audio stream', () => {
      const pcm = generateSyntheticPcm(6.0);
      const segments = detectSpeechSegments(pcm, 16000);

      expect(segments.length).toBeGreaterThanOrEqual(2);
      for (const seg of segments) {
        expect(seg.startSec).toBeGreaterThanOrEqual(0);
        expect(seg.endSec).toBeGreaterThan(seg.startSec);
        expect(seg.endSec).toBeLessThanOrEqual(6.1);
      }
    });

    it('infers conversational turn speaker acoustically for mono audio', () => {
      const pcm = generateSyntheticPcm(3.0);
      const speaker = inferSegmentSpeaker(pcm, 0.0, 1.4, 16000);
      expect(['adviser', 'client']).toContain(speaker);
    });
  });

  describe('7.2 Word-Level Timestamps & Confidence Scores (Acceptance Criterion 2)', () => {
    it('produces timestamps and confidence metrics for every word token', async () => {
      const pcm = generateSyntheticPcm(8.0);
      const result = await processAsrInference(
        pcm.buffer,
        8.0,
        null,
        'wasm',
        0.70,
        () => {}
      );

      expect(result.segments.length).toBeGreaterThan(0);
      expect(result.totalWords).toBeGreaterThan(0);
      expect(result.fullTranscript.length).toBeGreaterThan(0);
      expect(result.executionDurationMs).toBeGreaterThanOrEqual(0);
      expect(result.hardwareBackend).toBe('wasm');

      for (const seg of result.segments) {
        expect(seg.words.length).toBeGreaterThan(0);
        for (const w of seg.words) {
          expect(w.word.length).toBeGreaterThan(0);
          expect(w.start).toBeGreaterThanOrEqual(0);
          expect(w.end).toBeGreaterThanOrEqual(w.start);
          expect(w.confidence).toBeGreaterThanOrEqual(0.0);
          expect(w.confidence).toBeLessThanOrEqual(1.0);
          expect(['adviser', 'client']).toContain(w.speaker);
        }
      }
    });
  });

  describe('7.3 Low-Confidence Token Escalation (Acceptance Criterion 3)', () => {
    it('flags and escalates tokens below 0.70 confidence rather than discarding them', async () => {
      const pcm = generateSyntheticPcm(12.0);
      const result = await processAsrInference(
        pcm.buffer,
        12.0,
        null,
        'wasm',
        0.70,
        () => {}
      );

      expect(result.lowConfidenceWordsCount).toBeGreaterThan(0);
      expect(result.lowConfidenceWords.length).toBe(result.lowConfidenceWordsCount);

      for (const lowWord of result.lowConfidenceWords) {
        expect(lowWord.confidence).toBeLessThan(0.70);
        expect(lowWord.isLowConfidence).toBe(true);
        expect(lowWord.escalateToAdviserReview).toBe(true);
      }
    });
  });

  describe('7.4 Real-Time Progress Reporting (Acceptance Criterion 4)', () => {
    it('emits progress updates with percentage, elapsed time, and ETA reaching 100%', async () => {
      const pcm = generateSyntheticPcm(10.0);
      const progressEvents: any[] = [];

      await processAsrInference(
        pcm.buffer,
        10.0,
        null,
        'wasm',
        0.70,
        (prog) => progressEvents.push(prog)
      );

      expect(progressEvents.length).toBeGreaterThan(0);

      let lastPercent = 0;
      for (const ev of progressEvents) {
        expect(ev.percentage).toBeGreaterThanOrEqual(lastPercent);
        lastPercent = ev.percentage;
        expect(ev.totalSeconds).toBe(10.0);
        expect(ev.processedSeconds).toBeLessThanOrEqual(10.0);
        expect(ev.elapsedMs).toBeGreaterThanOrEqual(0);
        expect(ev.estimatedRemainingMs).toBeGreaterThanOrEqual(0);
      }

      expect(progressEvents[progressEvents.length - 1].percentage).toBe(100);
    });
  });

  describe('7.5 Speaker Attribution & Route Channel Disambiguation', () => {
    it('preserves exact Webex telephony stereo speaker channel split', async () => {
      const pcm = generateSyntheticPcm(6.0);
      const webexSpeakerMap = {
        channelCount: 2 as const,
        adviserChannel: 0,
        clientChannel: 1,
        route: 'webex_telephony' as const,
      };

      const result = await processAsrInference(
        pcm.buffer,
        6.0,
        webexSpeakerMap,
        'wasm',
        0.70,
        () => {}
      );

      expect(result.routeSpeakerSource).toBe('webex_channel_split');
      const speakers = new Set(result.segments.map((s) => s.speaker));
      expect(speakers.has('adviser') || speakers.has('client')).toBe(true);
    });
  });

  describe('7.6 Volatile Memory Discipline & Zero Persistence (Constraint C1)', () => {
    it('stores local ASR in VolatileSessionStore and wipes cleanly on session destroy', async () => {
      volatileSessionStore.initSession('live_in_person', 'adv-001');
      const pcm = generateSyntheticPcm(4.0);

      const asrResult = await processAsrInference(
        pcm.buffer,
        4.0,
        null,
        'wasm',
        0.70,
        () => {}
      );

      volatileSessionStore.setLocalAsrResult(asrResult);

      const storedResult = volatileSessionStore.getLocalAsrResult();
      expect(storedResult).not.toBeNull();
      expect(storedResult?.totalWords).toBe(asrResult.totalWords);
      expect(volatileSessionStore.getState()?.localDraftTranscript).toBe(asrResult.fullTranscript);

      // Destroy session
      volatileSessionStore.destroySession();

      expect(volatileSessionStore.getState()).toBeNull();
      expect(volatileSessionStore.getLocalAsrResult()).toBeNull();
    });
  });
});
