/**
 * Case Ace v2.0 - Full Consultation Audio Pipeline Test
 *
 * Runs an entire recorded consultation (45 to 55 minutes) through the privacy pipeline and
 * measures the claim the whole system rests on: that no client identifier spoken aloud
 * reaches the cloud transcription service.
 *
 * ZERO real client data. The corpus is purpose-recorded synthetic training material whose
 * production notes state that all clients, addresses, National Insurance numbers, employers
 * and telephone numbers are fictional, with numbers from the Ofcom drama range.
 *
 * WHY FULL LENGTH RATHER THAN A SAMPLE
 *   An earlier version targeted 55 second windows around the timestamps in the scenario
 *   scripts. The production notes describe those timestamps as pacing anchors rather than
 *   hard cues, and in practice they had drifted by minutes, so every window missed its
 *   identifier and every result came back untested. Sampling could not answer the question.
 *   A real consultation is 50 minutes long, so the pipeline has to be exercised at that
 *   length regardless.
 *
 * WHAT IT SUBSTITUTES, AND WHY THAT MATTERS
 *   In production, pass one runs in the adviser's browser using Whisper compiled to
 *   WebAssembly, so raw audio never leaves the device. That cannot run in Node. Here pass
 *   one is performed by Cloud Speech-to-Text, which means UNREDACTED audio is sent to the
 *   cloud during this test. That is acceptable only because the corpus is synthetic, and it
 *   is why this harness must never be pointed at a real consultation. A browser-driven test
 *   is still required before the pilot to show the local pass behaves the same way.
 *
 * Audio is uploaded to a dedicated test bucket in europe-west2 for batch recognition and
 * deleted at the end of the run.
 *
 * Usage:
 *   node --experimental-strip-types scripts/e2e-audio-full.mjs [--scenarios 1] [--keep]
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { identifierEngine } from '../client/src/redaction/identifierEngine.ts';
import {
  CANONICAL_MASTER_SYSTEM_INSTRUCTION,
  buildCaseNoteGenerationPrompt,
} from '../backend/src/prompts/caseRecordingMasterPrompt.ts';

const PROJECT = 'case-ace-v2';
const REGION = 'europe-west2';
const STT_SA = `case-ace-stt-sa@${PROJECT}.iam.gserviceaccount.com`;
const VERTEX_SA = `case-ace-vertex-sa@${PROJECT}.iam.gserviceaccount.com`;
const VERTEX_MODEL = 'gemini-3.5-flash';
const BUCKET = 'gs://case-ace-v2-e2e-audio';
const SAMPLE_RATE = 16000;
const WORK = '/tmp/caseace-e2e-full';

const CORPUS_DIR =
  process.env.CASE_ACE_AUDIO_DIR ||
  path.join(
    os.homedir(),
    'Library/CloudStorage/GoogleDrive-admin@adviceintelligence.tech/My Drive/04 Product & Website/04-04 Training Data'
  );

const GROUND_TRUTH_PATTERNS = [
  { category: 'nino', re: /\b[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/g },
  { category: 'postcode', re: /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/g },
  { category: 'phone', re: /\b07\d{3}\s?\d{6}\b/g },
];

const norm = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', ...opts });

function token(sa) {
  return sh('gcloud', ['auth', 'print-access-token', `--impersonate-service-account=${sa}`], {
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function docxText(file) {
  try {
    return sh('unzip', ['-p', file, 'word/document.xml'], { maxBuffer: 64 * 1024 * 1024 })
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ');
  } catch {
    return '';
  }
}

function groundTruth(scriptFile) {
  const text = docxText(scriptFile);
  const out = new Map();
  for (const { category, re } of GROUND_TRUTH_PATTERNS) {
    for (const m of text.match(re) ?? []) {
      out.set(`${category}:${norm(m)}`, { category, value: m.trim() });
    }
  }
  return [...out.values()];
}

/**
 * A dictated identifier does not appear in a transcript in its written form. A National
 * Insurance number read aloud becomes "Z X four eight six two one nine D", and a postcode
 * becomes "S W nine, eight T R". Comparing only against the compact written form would
 * report a leak as clean. This builds the spoken variants too.
 */
const DIGIT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
function spokenVariants(value) {
  const chars = norm(value).split('');
  const spelled = chars
    .map((c) => (/\d/.test(c) ? DIGIT_WORDS[+c] : c))
    .join('');
  const oh = chars.map((c) => (c === '0' ? 'oh' : /\d/.test(c) ? DIGIT_WORDS[+c] : c)).join('');
  return [norm(value), norm(spelled), norm(oh)];
}

function present(value, transcript) {
  const hay = norm(transcript);
  return spokenVariants(value).some((v) => v.length >= 6 && hay.includes(v));
}

function gsutil(args) {
  return sh('gcloud', ['storage', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
}

async function batchTranscribe(localWav, gcsName, sttToken, label) {
  const uri = `${BUCKET}/${gcsName}`;
  gsutil(['cp', localWav, uri]);

  const outPrefix = `${BUCKET}/out-${gcsName.replace(/\W/g, '')}`;
  const url = `https://${REGION}-speech.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/recognizers/_:batchRecognize`;

  const start = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${sttToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      config: {
        explicitDecodingConfig: { encoding: 'LINEAR16', sampleRateHertz: SAMPLE_RATE, audioChannelCount: 1 },
        languageCodes: ['en-GB'],
        model: 'long',
        features: { enableWordTimeOffsets: true, enableAutomaticPunctuation: true },
      },
      files: [{ uri }],
      recognitionOutputConfig: { gcsOutputConfig: { uri: outPrefix } },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!start.ok) throw new Error(`batchRecognize HTTP ${start.status}: ${(await start.text()).slice(0, 300)}`);
  const op = await start.json();

  process.stdout.write(`      ${label}: transcribing`);
  const opUrl = `https://${REGION}-speech.googleapis.com/v2/${op.name}`;
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 10_000));
    const poll = await fetch(opUrl, { headers: { Authorization: `Bearer ${sttToken}` } });
    const state = await poll.json();
    if (state.done) {
      process.stdout.write(' done\n');
      if (state.error) throw new Error(`batch failed: ${JSON.stringify(state.error).slice(0, 300)}`);
      const resultUri = state.response?.results?.[uri]?.uri;
      if (!resultUri) throw new Error(`no result uri: ${JSON.stringify(state.response).slice(0, 300)}`);
      const local = path.join(WORK, `${gcsName}.result.json`);
      gsutil(['cp', resultUri, local]);
      const parsed = JSON.parse(fs.readFileSync(local, 'utf8'));
      const results = parsed.results ?? [];
      const transcript = results.map((r) => r.alternatives?.[0]?.transcript ?? '').join(' ').trim();
      const words = results.flatMap((r) =>
        (r.alternatives?.[0]?.words ?? []).map((w) => ({
          word: w.word,
          start: parseFloat(String(w.startOffset ?? '0s')),
          end: parseFloat(String(w.endOffset ?? '0s')),
          confidence: w.confidence ?? 0.9,
          speaker: 'unknown',
          isLowConfidence: (w.confidence ?? 0.9) < 0.7,
          escalateToAdviserReview: false,
        }))
      );
      return { transcript, words };
    }
    process.stdout.write('.');
  }
  throw new Error('batch recognition timed out after 15 minutes');
}

function asAsrResult(transcript, words) {
  return {
    segments: [
      {
        id: 'seg-1',
        start: words.length ? words[0].start : 0,
        end: words.length ? words[words.length - 1].end : 0,
        speaker: 'unknown',
        text: transcript,
        words,
        avgConfidence: 0.9,
        hasLowConfidenceWords: words.some((w) => w.isLowConfidence),
      },
    ],
    fullTranscript: transcript,
    totalWords: words.length,
    lowConfidenceWordsCount: words.filter((w) => w.isLowConfidence).length,
    lowConfidenceWords: words.filter((w) => w.isLowConfidence),
    executionDurationMs: 0,
    hardwareBackend: 'wasm',
    routeSpeakerSource: 'inferred_acoustic_diarisation',
  };
}

function muteWav(inWav, outWav, ranges) {
  const buf = fs.readFileSync(inWav);
  const header = buf.subarray(0, 44);
  const pcm = Buffer.from(buf.subarray(44));
  let mutedMs = 0;
  for (const { startSec, endSec } of ranges) {
    const from = Math.max(0, Math.floor((startSec - 0.3) * SAMPLE_RATE)) * 2;
    const to = Math.min(pcm.length, Math.ceil((endSec + 0.3) * SAMPLE_RATE) * 2);
    if (to > from) {
      pcm.fill(0, from, to);
      mutedMs += ((to - from) / 2 / SAMPLE_RATE) * 1000;
    }
  }
  fs.writeFileSync(outWav, Buffer.concat([header, pcm]));
  return mutedMs;
}

async function main() {
  const arg = (n, d) => {
    const i = process.argv.indexOf(n);
    return i > -1 ? parseInt(process.argv[i + 1], 10) : d;
  };
  const maxScenarios = arg('--scenarios', 1);
  const keep = process.argv.includes('--keep');
  fs.mkdirSync(WORK, { recursive: true });

  const wavs = fs.readdirSync(CORPUS_DIR).filter((f) => f.endsWith('.wav')).sort().slice(0, maxScenarios);
  console.log('Case Ace full-consultation audio pipeline test');
  console.log(`${wavs.length} scenario(s), synthetic corpus, full length\n`);

  const sttToken = token(STT_SA);
  const vertexToken = token(VERTEX_SA);
  const report = [];

  for (const wav of wavs) {
    const id = wav.replace(/\.wav$/, '');
    const truth = groundTruth(path.join(CORPUS_DIR, `${id}.docx`));
    console.log(`--- ${id}`);
    console.log(`    ground truth identifiers in script: ${truth.map((t) => `${t.category} ${t.value}`).join(', ') || 'none'}`);
    const row = { id, groundTruth: truth };

    try {
      // Copy off Google Drive first: seeking deep into a cloud-backed file times out.
      const localSrc = path.join(WORK, `${id}.src.wav`);
      if (!fs.existsSync(localSrc)) {
        process.stdout.write('      copying from Drive...');
        fs.copyFileSync(path.join(CORPUS_DIR, wav), localSrc);
        process.stdout.write(' done\n');
      }
      const full = path.join(WORK, `${id}.16k.wav`);
      sh('ffmpeg', ['-y', '-loglevel', 'error', '-i', localSrc, '-ac', '1', '-ar', String(SAMPLE_RATE), '-acodec', 'pcm_s16le', full]);
      row.durationSeconds = +((fs.statSync(full).size - 44) / 2 / SAMPLE_RATE).toFixed(0);
      console.log(`    duration: ${(row.durationSeconds / 60).toFixed(1)} minutes`);

      const pass1 = await batchTranscribe(full, `${id}.raw.wav`, sttToken, 'pass one (unredacted)');
      row.pass1Words = pass1.words.length;
      fs.writeFileSync(path.join(WORK, `${id}.pass1.txt`), pass1.transcript);

      row.audibleInPassOne = truth.filter((t) => present(t.value, pass1.transcript)).map((t) => `${t.category} ${t.value}`);
      console.log(`    pass one: ${row.pass1Words} words; ground truth actually audible: ${row.audibleInPassOne.length}/${truth.length}`);

      const detection = identifierEngine.detectIdentifiers(pass1.transcript, asAsrResult(pass1.transcript, pass1.words));
      row.detected = detection.totalDetected;
      row.detectedByLayer = {
        structured: detection.structuredCount,
        unstructured: detection.unstructuredCount,
        specialCategory: detection.specialCategoryCount,
      };
      console.log(`    identifiers detected: ${row.detected} (L1 ${detection.structuredCount}, L2 ${detection.unstructuredCount}, L3 ${detection.specialCategoryCount})`);

      const ranges = detection.identifiers.map((i) => i.audioTimeRange).filter((r) => r && r.endSec > r.startSec);
      const redactedWav = path.join(WORK, `${id}.redacted.wav`);
      const mutedMs = muteWav(full, redactedWav, ranges);
      row.muteRanges = ranges.length;
      row.mutedSeconds = +(mutedMs / 1000).toFixed(1);
      console.log(`    audio muted: ${row.mutedSeconds}s of ${row.durationSeconds}s across ${row.muteRanges} ranges`);

      const pass2 = await batchTranscribe(redactedWav, `${id}.redacted.wav`, sttToken, 'pass two (redacted)');
      fs.writeFileSync(path.join(WORK, `${id}.pass2.txt`), pass2.transcript);

      // THE MEASURE THAT MATTERS: only identifiers genuinely audible in pass one can be
      // said to have been redacted or to have survived. The rest are untested.
      const testable = truth.filter((t) => present(t.value, pass1.transcript));
      const survivors = testable.filter((t) => present(t.value, pass2.transcript));
      row.testable = testable.length;
      row.survivors = survivors.map((s) => `${s.category} ${s.value}`);
      console.log(
        survivors.length === 0
          ? `    SURVIVORS in cloud-bound audio: none (of ${testable.length} testable)`
          : `    SURVIVORS in cloud-bound audio: ${row.survivors.join(' | ')}`
      );

      // Draft from the tokenised transcript
      const tokenised = detection.tokenisedTranscript || pass2.transcript;
      const url = `https://${REGION}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/publishers/google/models/${VERTEX_MODEL}:generateContent`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${vertexToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: CANONICAL_MASTER_SYSTEM_INSTRUCTION }] },
          contents: [{ role: 'user', parts: [{ text: buildCaseNoteGenerationPrompt(tokenised, 'E2E Adviser', 'live_in_person') }] }],
          generationConfig: { temperature: 0.1, responseMimeType: 'application/json', maxOutputTokens: 8192 },
        }),
        signal: AbortSignal.timeout(240_000),
      });
      const noteText = res.ok ? ((await res.json())?.candidates?.[0]?.content?.parts?.[0]?.text ?? '') : `HTTP ${res.status}`;
      fs.writeFileSync(path.join(WORK, `${id}.note.json`), noteText);
      try { JSON.parse(noteText); row.noteValidJson = true; } catch { row.noteValidJson = false; }
      row.identifiersInNote = truth.filter((t) => present(t.value, noteText)).map((t) => `${t.category} ${t.value}`);
      console.log(`    case note: ${row.noteValidJson ? 'valid schema' : 'INVALID'}; ground truth identifiers in note: ${row.identifiersInNote.length}`);
    } catch (err) {
      row.error = String(err).slice(0, 400);
      console.log(`    ERROR: ${row.error}`);
    }
    report.push(row);
    console.log('');
  }

  if (!keep) {
    try { gsutil(['rm', '-r', `${BUCKET}/**`]); console.log('Test audio removed from the bucket.'); } catch {}
  }

  fs.mkdirSync('evidence', { recursive: true });
  fs.writeFileSync('evidence/e2e-audio-full.json', JSON.stringify({ generatedAt: new Date().toISOString(), results: report }, null, 2));
  console.log('Written to evidence/e2e-audio-full.json');
  console.log(`Transcripts and notes kept in ${WORK}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
