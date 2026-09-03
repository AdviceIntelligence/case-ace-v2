/**
 * test-phase10.mjs
 * 
 * Formal Automated Verification Suite for Phase 10:
 * Audio Redaction, Acoustic Assertions, Mandatory Verification Pass (Fail-Closed C8),
 * and Volatile Memory Release (C1 / C4).
 */

import { strict as assert } from 'node:assert';
import { AudioRedactionEngine, audioRedactionEngine } from '../client/src/audio/audioRedactionEngine.ts';
import { RedactionVerificationManager, redactionVerificationManager } from '../client/src/redaction/redactionVerificationManager.ts';
import { VolatileSessionStore } from '../client/src/state/volatileStore.ts';
import { identifierEngine } from '../client/src/redaction/identifierEngine.ts';

let passedTests = 0;
let totalTests = 0;

function runTest(description, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✓ ${description}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${description}`);
    console.error(`    Error: ${err.message}`);
    throw err;
  }
}

async function runAsyncTest(description, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✓ ${description}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${description}`);
    console.error(`    Error: ${err.message}`);
    throw err;
  }
}

console.log('\n================================================================');
console.log('Case Ace v2.0 - Phase 10 Verification Suite');
console.log('Audio Redaction, Acoustic Assertions & Fail-Closed Gate');
console.log('================================================================\n');

// -----------------------------------------------------------------------------
// Suite 1: Padding Enforcement & Interval Merging
// -----------------------------------------------------------------------------
console.log('--- Suite 1: Padding Enforcement & Interval Merging ---');

runTest('Minimum padding of 250ms is enforced even if lower value is requested', () => {
  const engine = new AudioRedactionEngine();
  const spans = [
    { id: 'span1', startSec: 2.0, endSec: 3.0, adviserDecision: 'accepted' },
  ];
  const totalDuration = 10.0;

  // Request 100ms padding (below 250ms minimum)
  const intervals = engine.prepareMergedIntervals(spans, totalDuration, { paddingMs: 100 });

  assert.equal(intervals.length, 1);
  const intv = intervals[0];
  // 2.0 - 0.25 = 1.75s, 3.0 + 0.25 = 3.25s
  assert.equal(intv.appliedPaddingSec, 0.25);
  assert.equal(intv.startSec, 1.75);
  assert.equal(intv.endSec, 3.25);
  assert.equal(intv.startSample, Math.floor(1.75 * 16000));
  assert.equal(intv.endSample, Math.ceil(3.25 * 16000));
});

runTest('Custom padding >= 250ms is correctly applied', () => {
  const engine = new AudioRedactionEngine();
  const spans = [
    { id: 'span1', startSec: 4.0, endSec: 5.0, adviserDecision: 'accepted' },
  ];
  const totalDuration = 10.0;

  // Request 400ms padding
  const intervals = engine.prepareMergedIntervals(spans, totalDuration, { paddingMs: 400 });

  assert.equal(intervals.length, 1);
  const intv = intervals[0];
  assert.equal(intv.appliedPaddingSec, 0.40);
  assert.equal(intv.startSec, 3.60);
  assert.equal(intv.endSec, 5.40);
});

runTest('Overlapping and adjacent intervals within padding distance are merged into one contiguous block', () => {
  const engine = new AudioRedactionEngine();
  // First name: 2.0s - 2.5s -> with 300ms padding: 1.7s - 2.8s
  // Last name: 2.7s - 3.2s  -> with 300ms padding: 2.4s - 3.5s
  // Overlap: 2.4s < 2.8s -> should merge into 1.7s - 3.5s
  const spans = [
    { id: 'first_name', startSec: 2.0, endSec: 2.5, adviserDecision: 'accepted' },
    { id: 'last_name', startSec: 2.7, endSec: 3.2, adviserDecision: 'accepted' },
  ];
  const totalDuration = 10.0;

  const intervals = engine.prepareMergedIntervals(spans, totalDuration, { paddingMs: 300 });

  assert.equal(intervals.length, 1, 'Overlapping spans must merge into a single interval');
  assert.equal(intervals[0].startSec, 1.7);
  assert.equal(intervals[0].endSec, 3.5);
  assert.deepEqual(intervals[0].sourceSpanIds, ['first_name', 'last_name']);
});

runTest('Distant spans remain distinct separate intervals', () => {
  const engine = new AudioRedactionEngine();
  const spans = [
    { id: 'span1', startSec: 1.0, endSec: 1.5, adviserDecision: 'accepted' }, // 0.7s - 1.8s
    { id: 'span2', startSec: 6.0, endSec: 7.0, adviserDecision: 'accepted' }, // 5.7s - 7.3s
  ];
  const totalDuration = 10.0;

  const intervals = engine.prepareMergedIntervals(spans, totalDuration, { paddingMs: 300 });

  assert.equal(intervals.length, 2);
  assert.equal(intervals[0].startSec, 0.7);
  assert.equal(intervals[0].endSec, 1.8);
  assert.equal(intervals[1].startSec, 5.7);
  assert.equal(intervals[1].endSec, 7.3);
});

runTest('Rejected redaction spans are completely excluded from interval merging', () => {
  const engine = new AudioRedactionEngine();
  const spans = [
    { id: 'approved', startSec: 1.0, endSec: 1.5, adviserDecision: 'accepted' },
    { id: 'rejected', startSec: 2.0, endSec: 2.5, adviserDecision: 'rejected' },
  ];
  const totalDuration = 10.0;

  const intervals = engine.prepareMergedIntervals(spans, totalDuration, { paddingMs: 300 });

  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].sourceSpanIds[0], 'approved');
});

// -----------------------------------------------------------------------------
// Suite 2: Acoustic Redaction & Region Energy Assertions
// -----------------------------------------------------------------------------
console.log('\n--- Suite 2: Acoustic Redaction & Region Energy Assertions ---');

runTest('Digital silence mode replaces audio with pure zeros (RMS = 0.0)', () => {
  const sampleRate = 16000;
  const durationSec = 5.0;
  const totalSamples = durationSec * sampleRate;
  
  // Create synthetic speech audio with sine wave noise
  const rawAudio = new Float32Array(totalSamples);
  for (let i = 0; i < totalSamples; i++) {
    rawAudio[i] = 0.5 * Math.sin(2 * Math.PI * 440 * (i / sampleRate));
  }

  const spans = [
    { id: 'nino_span', startSec: 1.0, endSec: 2.0, adviserDecision: 'accepted' },
  ];

  const result = audioRedactionEngine.redactAudio(rawAudio.buffer, spans, {
    paddingMs: 300,
    mode: 'silence',
    sampleRate,
  });

  // Check duration preservation
  assert.equal(result.redactedSampleCount, totalSamples);
  assert.equal(result.durationSeconds, durationSec);

  // Check that muted interval (0.7s to 2.3s) is purely zero
  const startSample = Math.floor(0.7 * sampleRate);
  const endSample = Math.ceil(2.3 * sampleRate);

  for (let i = startSample; i < endSample; i++) {
    assert.equal(result.redactedFloat32Audio[i], 0.0, `Sample at index ${i} must be zero`);
  }

  // Check unmuted audio outside interval is preserved intact
  assert.equal(result.redactedFloat32Audio[0], rawAudio[0]);
  assert.equal(result.redactedFloat32Audio[startSample - 1], rawAudio[startSample - 1]);
  assert.equal(result.redactedFloat32Audio[endSample + 10], rawAudio[endSample + 10]);

  // Assert acoustic energy
  assert.equal(result.mergedIntervals[0].rmsEnergy, 0.0);
  assert.equal(result.mergedIntervals[0].peakAmplitude, 0.0);
});

runTest('1kHz tone mode replaces speech with smooth sine bleep and envelope', () => {
  const sampleRate = 16000;
  const durationSec = 4.0;
  const totalSamples = durationSec * sampleRate;
  
  const rawAudio = new Float32Array(totalSamples);
  for (let i = 0; i < totalSamples; i++) {
    rawAudio[i] = 0.3 * Math.cos(2 * Math.PI * 220 * (i / sampleRate));
  }

  const spans = [
    { id: 'name_span', startSec: 1.0, endSec: 2.0, adviserDecision: 'accepted' },
  ];

  const result = audioRedactionEngine.redactAudio(rawAudio.buffer, spans, {
    paddingMs: 300,
    mode: '1khz_tone',
    sampleRate,
  });

  const interval = result.mergedIntervals[0];
  assert.ok(interval.rmsEnergy > 0, '1kHz tone must have non-zero RMS energy');
  assert.ok(interval.peakAmplitude <= 0.20, 'Tone peak must remain below 0.20 ceiling');
});

runTest('Acoustic assertion throws error if residual energy detected in silence region', () => {
  const sampleRate = 16000;
  const corruptedSamples = new Float32Array(sampleRate * 2);
  corruptedSamples.fill(0.0);
  corruptedSamples[100] = 0.25; // Non-zero noise injected in silence span

  const intervals = [
    {
      id: 'corrupted_interval',
      startSec: 0.0,
      endSec: 1.0,
      startSample: 0,
      endSample: 500,
      sampleCount: 500,
      sourceSpanIds: ['span1'],
      appliedPaddingSec: 0.25,
      mode: 'silence',
      rmsEnergy: 0,
      peakAmplitude: 0,
    },
  ];

  assert.throws(
    () => {
      audioRedactionEngine.assertRegionAcoustics(corruptedSamples, intervals, 'silence');
    },
    /Acoustic Assertion Failed/,
    'Must throw error when non-zero residual energy is found in silence-redacted zone'
  );
});

// -----------------------------------------------------------------------------
// Suite 3: LINEAR16 WAV Transcoding for Cloud STT v2
// -----------------------------------------------------------------------------
console.log('\n--- Suite 3: LINEAR16 WAV Transcoding ---');

runTest('Encodes 16kHz Float32 PCM into valid 16-bit Linear PCM WAV container', () => {
  const sampleRate = 16000;
  const samples = new Float32Array([0.0, 0.5, -0.5, 1.0, -1.0]);
  
  const wavBuffer = audioRedactionEngine.encodeLinear16Wav(samples, sampleRate);
  const view = new DataView(wavBuffer);

  // Assert WAV Header
  assert.equal(wavBuffer.byteLength, 44 + samples.length * 2);
  
  // RIFF
  const riffStr = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  assert.equal(riffStr, 'RIFF');
  
  // WAVE
  const waveStr = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
  assert.equal(waveStr, 'WAVE');

  // Format chunk: PCM (1), Mono (1), 16000 Hz, 16 bits
  assert.equal(view.getUint16(20, true), 1); // PCM
  assert.equal(view.getUint16(22, true), 1); // Mono
  assert.equal(view.getUint32(24, true), 16000); // 16kHz
  assert.equal(view.getUint16(34, true), 16); // 16-bit

  // Data chunk
  const dataStr = String.fromCharCode(view.getUint8(36), view.getUint8(37), view.getUint8(38), view.getUint8(39));
  assert.equal(dataStr, 'data');
  assert.equal(view.getUint32(40, true), samples.length * 2);

  // Check sample conversion
  assert.equal(view.getInt16(44, true), 0); // 0.0 -> 0
  assert.equal(view.getInt16(46, true), Math.round(0.5 * 0x7fff)); // 0.5 -> 16383
  assert.equal(view.getInt16(48, true), Math.round(-0.5 * 0x8000)); // -0.5 -> -16384
});

// -----------------------------------------------------------------------------
// Suite 4: Fail-Closed Verification Pass (Constraint C8)
// -----------------------------------------------------------------------------
console.log('\n--- Suite 4: Fail-Closed Verification Pass (Constraint C8) ---');

await runAsyncTest('Verification pass SUCCEEDS when 0 surviving identifiers detected', async () => {
  const store = new VolatileSessionStore();
  const session = store.initSession('live_microphone', 'adviser-123');

  // Create 5s raw audio
  const sampleRate = 16000;
  const rawAudio = new Float32Array(sampleRate * 5);
  rawAudio.fill(0.1);
  store.setRawAudio(rawAudio.buffer, 5.0, sampleRate);

  // Set detected identifiers from Phase 8
  const detectedIds = [
    {
      id: 'id_nino',
      text: 'QQ 12 34 56 A',
      charOffset: { start: 10, end: 22 },
      audioTimeRange: { startSec: 1.0, endSec: 2.0 },
      category: 'national_insurance_number',
      detectionLayer: 1,
      confidence: 1.0,
      proposedAction: 'redact',
      adviserDecision: 'accepted',
      surrogateToken: '[NINO_1]',
    },
  ];
  store.setDetectedIdentifiers(detectedIds);

  // Mock ASR Runner that returns a clean redacted transcript (silence replaced the NINO)
  const cleanAsrRunner = async (redactedAudio, duration) => {
    return {
      transcript: 'Hello my benefit reference is [SILENCE] and I need help.',
      lowConfidenceWords: [],
    };
  };

  const result = await redactionVerificationManager.verifyAndCommitRedactedAudio(
    store.getState(),
    null,
    cleanAsrRunner,
    store
  );

  assert.equal(result.success, true);
  assert.equal(result.survivingIdentifiers.length, 0);

  // Verify memory release invariant: rawAudioBuffer must be wiped and null (C1 / C4)
  const updatedState = store.getState();
  assert.equal(updatedState.rawAudioBuffer, null, 'Raw audio buffer must be wiped from memory');
  assert.ok(updatedState.redactedAudioBuffer, 'Redacted audio buffer must be present');
  assert.ok(updatedState.redactedAudioWavBuffer, 'Redacted WAV buffer must be present');
  assert.equal(updatedState.isAudioRedactedAndVerified, true);
  assert.equal(updatedState.stage, 'audio_redacted');
});

await runAsyncTest('Verification pass FAILS CLOSED when surviving identifier is detected in redacted audio', async () => {
  const store = new VolatileSessionStore();
  store.initSession('live_microphone', 'adviser-123');

  // Create 5s raw audio
  const sampleRate = 16000;
  const rawAudio = new Float32Array(sampleRate * 5);
  rawAudio.fill(0.1);
  store.setRawAudio(rawAudio.buffer, 5.0, sampleRate);

  // Set detected identifiers
  const detectedIds = [
    {
      id: 'id_partial_name',
      text: 'Margaret',
      charOffset: { start: 0, end: 8 },
      audioTimeRange: { startSec: 1.0, endSec: 1.5 },
      category: 'personal_name',
      detectionLayer: 2,
      confidence: 0.9,
      proposedAction: 'redact',
      adviserDecision: 'accepted',
      surrogateToken: '[CLIENT_NAME_1]',
    },
  ];
  store.setDetectedIdentifiers(detectedIds);

  // Mock ASR Runner that simulates surviving speech (e.g. surname "Thatcher" survived adjacent to Margaret)
  const survivorAsrRunner = async (redactedAudio, duration) => {
    return {
      // Surviving National Insurance Number in transcript
      transcript: 'My name is [SILENCE] but my national insurance is QQ 12 34 56 C today.',
      lowConfidenceWords: [],
    };
  };

  const result = await redactionVerificationManager.verifyAndCommitRedactedAudio(
    store.getState(),
    null,
    survivorAsrRunner,
    store
  );

  // Strict Fail-Closed Assertions
  assert.equal(result.success, false, 'Must fail closed when identifiers survive');
  assert.ok(result.survivingIdentifiers.length > 0, 'Must record surviving identifiers');
  assert.equal(result.survivingIdentifiers[0].category, 'national_insurance');

  // Check store state: gate must be re-locked, raw audio NOT wiped (so adviser can re-edit intervals)
  const updatedState = store.getState();
  assert.equal(updatedState.isGatePassed, false, 'Gate must be locked on verification failure');
  assert.equal(updatedState.isAudioRedactedAndVerified, false);
  assert.equal(updatedState.stage, 'redaction_review');
  assert.ok(updatedState.rawAudioBuffer !== null, 'Raw audio preserved so adviser can expand redaction boundaries');
  assert.equal(updatedState.survivingIdentifiers.length, 1);
});

console.log('\n================================================================');
console.log(`Results: ${passedTests}/${totalTests} tests passed`);
console.log('Phase 10 Verification Complete.');
console.log('================================================================\n');
