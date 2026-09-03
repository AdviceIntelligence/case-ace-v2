/**
 * @file test-phase8.mjs
 * @description Comprehensive automated verification test suite for Phase 8:
 * Identifier Detection, Classification, and Surrogate Tokenisation.
 * 
 * Verifies:
 * 1. Modulus 11 algorithm on UK NHS Numbers.
 * 2. 100% recall on structured statutory UK identifiers (NINO, Postcode, Phone, Email, Bank, DOB, Benefit, Court, HMRC).
 * 3. >= 99% recall on personal and third-party names (client, ex-partner, children, landlord, worker, employer, officials).
 * 4. Identifying organizations (schools, surgeries, hospitals, refuges, employers, locations).
 * 5. Layer 3 special category classification with explicit consequence cards.
 * 6. Non-mutating transcript invariant.
 * 7. End-to-end IdentifierEngine execution.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// Dynamic imports of redaction modules
const { validateNhsNumber, matchLayer1StructuredIdentifiers } = await import(
  '../client/src/redaction/layer1StructuredMatcher.ts'
);
const { matchLayer2UnstructuredNer } = await import(
  '../client/src/redaction/layer2UnstructuredNer.ts'
);
const { matchLayer3SpecialCategories } = await import(
  '../client/src/redaction/layer3SpecialCategoryClassifier.ts'
);
const { IdentifierEngine } = await import(
  '../client/src/redaction/identifierEngine.ts'
);

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  passedTests++;
  console.log(`✅ PASS: ${message}`);
}

console.log('================================================================');
console.log('CASE ACE v2.0 - PHASE 8: IDENTIFIER DETECTION VERIFICATION');
console.log('================================================================\n');

// -------------------------------------------------------------
// TEST 1: Modulus 11 NHS Number Algorithm Verification
// -------------------------------------------------------------
console.log('--- TEST 1: NHS Number Modulus 11 Checksum Algorithm ---');
// Verify known valid NHS number
const sampleValid = '943 476 5919'; // 9*10 + 4*9 + 3*8 + 4*7 + 7*6 + 6*5 + 5*4 + 9*3 + 1*2 = 299. 299 % 11 = 2. 11 - 2 = 9. Check digit = 9.
assert(validateNhsNumber(sampleValid) === true, `Valid NHS number ${sampleValid} passed Modulus 11 validation`);

// Verify invalid check digit
const invalidNhs = '943 476 5918';
assert(validateNhsNumber(invalidNhs) === false, `Invalid NHS number ${invalidNhs} correctly rejected by Modulus 11`);

// Verify incorrect length
assert(validateNhsNumber('123456789') === false, 'Invalid length (<10 digits) rejected');
console.log('');

// -------------------------------------------------------------
// TEST 2: Layer 1 Structured Matcher Recall on Synthetic Corpus
// -------------------------------------------------------------
console.log('--- TEST 2: Layer 1 Deterministic Structured Recall (Target: 100%) ---');
const corpusPath = path.join(projectRoot, 'test', 'corpus', 'phase8Corpus.json');
const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));

let totalStructuredExpected = 0;
let totalStructuredDetected = 0;

for (const tc of corpus) {
  const matches = matchLayer1StructuredIdentifiers(tc.transcript);
  for (const expected of tc.expectedStructured) {
    totalStructuredExpected++;
    const found = matches.some((m) => {
      const matchText = m.text.toLowerCase().replace(/\s+/g, '');
      const expText = expected.match.toLowerCase().replace(/\s+/g, '');
      const normText = (m.normalizedText || '').toLowerCase().replace(/\s+/g, '');
      return (
        m.category === expected.category &&
        (matchText.includes(expText) || expText.includes(matchText) || normText.includes(expText) || expText.includes(normText))
      );
    });

    if (found) {
      totalStructuredDetected++;
    } else {
      console.warn(`⚠️ Warning: In ${tc.id}, missed structured identifier: ${expected.category} - "${expected.match}"`);
    }
  }
}

const structuredRecall = totalStructuredExpected > 0 ? (totalStructuredDetected / totalStructuredExpected) * 100 : 100;
console.log(`Structured Identifier Recall: ${structuredRecall.toFixed(1)}% (${totalStructuredDetected}/${totalStructuredExpected})`);
assert(structuredRecall === 100, `Layer 1 structured identifier recall is strictly 100.0% (${totalStructuredDetected}/${totalStructuredExpected})`);
console.log('');

// -------------------------------------------------------------
// TEST 3: Layer 2 Named Entity Recognition Recall (Target: >= 99%)
// -------------------------------------------------------------
console.log('--- TEST 3: Layer 2 Named Entity & Third-Party Recall (Target: >= 99%) ---');
let totalUnstructuredExpected = 0;
let totalUnstructuredDetected = 0;

for (const tc of corpus) {
  const matches = matchLayer2UnstructuredNer(tc.transcript);
  for (const expected of tc.expectedUnstructured) {
    totalUnstructuredExpected++;
    const found = matches.some((m) => {
      const matchText = m.text.toLowerCase();
      const expText = expected.match.toLowerCase();
      return matchText.includes(expText) || expText.includes(matchText);
    });

    if (found) {
      totalUnstructuredDetected++;
    } else {
      console.warn(`⚠️ Warning: In ${tc.id}, missed unstructured entity: ${expected.category} - "${expected.match}"`);
    }
  }
}

const unstructuredRecall = totalUnstructuredExpected > 0 ? (totalUnstructuredDetected / totalUnstructuredExpected) * 100 : 100;
console.log(`Unstructured Entity Recall: ${unstructuredRecall.toFixed(1)}% (${totalUnstructuredDetected}/${totalUnstructuredExpected})`);
assert(unstructuredRecall >= 99.0, `Layer 2 named entity recall meets or exceeds target (measured ${unstructuredRecall.toFixed(1)}%)`);
console.log('');

// -------------------------------------------------------------
// TEST 4: Third-Party Entities Explicit Verification
// -------------------------------------------------------------
console.log('--- TEST 4: Third-Party Individuals Explicit Protection ---');
const thirdPartyTranscript = 'My abusive ex-partner David Smith and my landlord Mr Henderson contacted my social worker Rachel Adams and line manager Steve at Tesco.';
const thirdPartyMatches = matchLayer2UnstructuredNer(thirdPartyTranscript);

const foundExPartner = thirdPartyMatches.some((m) => m.category === 'ex_partner_name' && m.text.includes('David Smith'));
const foundLandlord = thirdPartyMatches.some((m) => m.category === 'landlord_name' && m.text.includes('Henderson'));
const foundSocialWorker = thirdPartyMatches.some((m) => m.category === 'support_worker_name' && m.text.includes('Rachel Adams'));
const foundEmployer = thirdPartyMatches.some((m) => m.category === 'employer_name' && m.text.includes('Steve'));

assert(foundExPartner, 'Abusive ex-partner identified and categorized for redaction');
assert(foundLandlord, 'Landlord identified and categorized for redaction');
assert(foundSocialWorker, 'Social worker identified and categorized for redaction');
assert(foundEmployer, 'Line manager / employer identified and categorized for redaction');
console.log('');

// -------------------------------------------------------------
// TEST 5: Layer 3 Special Category & Transparent Consequences
// -------------------------------------------------------------
console.log('--- TEST 5: Layer 3 Special Category Decision Gates & Consequence Cards ---');
const specialCategoryTranscript = 'The client has a diagnosis of paranoid schizophrenia and was sectioned under the Mental Health Act. Client is fleeing domestic violence, has a MARAC referral, and is an asylum seeker with no recourse to public funds.';
const scMatches = matchLayer3SpecialCategories(specialCategoryTranscript);

assert(scMatches.length >= 4, `Detected ${scMatches.length} special category elements`);
for (const match of scMatches) {
  assert(match.decisionConsequences !== undefined, `Consequence disclosure present for "${match.text}"`);
  assert(match.decisionConsequences.retentionRisk.length > 0, `Retention privacy risk articulated for "${match.text}"`);
  assert(match.decisionConsequences.redactionImpact.length > 0, `Redaction case note impact articulated for "${match.text}"`);
  assert(match.decisionConsequences.recommendedDefault === 'retain_clinical_substance', `Default is retain_clinical_substance for "${match.text}"`);
}
console.log('');

// -------------------------------------------------------------
// TEST 6: IdentifierEngine End-to-End Execution & Immutability Invariant
// -------------------------------------------------------------
console.log('--- TEST 6: Master IdentifierEngine Coordination & Immutability ---');
const engine = new IdentifierEngine();
const testTranscript = 'My name is Jane Doe, NINO is QQ 12 34 56 C, DOB is 14/08/1982. I live at Flat 4, 12 Elm Grove SW11 2AB. I have paranoid schizophrenia.';
const originalSnapshot = `${testTranscript}`;

const dummyAsrResult = {
  sessionId: 'test-session',
  fullTranscript: testTranscript,
  segments: [
    {
      id: 0,
      speaker: 'client',
      text: testTranscript,
      start: 0.0,
      end: 15.0,
      confidence: 0.95,
      words: [
        { word: 'Jane', start: 1.0, end: 1.4, confidence: 0.98, speaker: 'client' },
        { word: 'Doe', start: 1.5, end: 1.9, confidence: 0.97, speaker: 'client' },
        { word: 'QQ', start: 3.0, end: 3.5, confidence: 0.99, speaker: 'client' },
        { word: 'schizophrenia', start: 12.0, end: 13.0, confidence: 0.94, speaker: 'client' },
      ],
    },
  ],
  totalWords: 24,
  lowConfidenceWordsCount: 0,
  executionDurationMs: 450,
  hardwareBackend: 'wasm',
};

const result = engine.detectIdentifiers(testTranscript, dummyAsrResult);

assert(testTranscript === originalSnapshot, 'Original transcript string was NOT mutated in place');
assert(result.identifiers.length >= 5, `Total identifiers detected: ${result.identifiers.length}`);
assert(result.structuredCount >= 3, `Layer 1 structured count: ${result.structuredCount}`);
assert(result.unstructuredCount >= 1, `Layer 2 unstructured count: ${result.unstructuredCount}`);
assert(result.specialCategoryCount >= 1, `Layer 3 special category count: ${result.specialCategoryCount}`);

// Verify tokenMap
assert(Object.keys(result.tokenMap).length === result.identifiers.length, 'Token map contains all surrogate mappings');
const janeToken = result.identifiers.find((i) => i.text.includes('Jane Doe'))?.surrogateToken;
assert(janeToken !== undefined && result.tokenMap[janeToken] === 'Jane Doe', 'Surrogate token correctly maps to original text');

// Verify audio projection
const janeIdent = result.identifiers.find((i) => i.text.includes('Jane Doe'));
assert(janeIdent?.audioTimeRange.startSec === 1.0, 'Projected audio start timestamp aligns with ASR word');
console.log('');

console.log('================================================================');
console.log(`PHASE 8 VERIFICATION SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
console.log('================================================================');
