/**
 * @file identifierEngine.ts
 * @description Master Coordinator for Multi-Layer Identifier Detection, Classification,
 * and Surrogate Tokenisation in Case Ace v2.0.
 * 
 * Invariants:
 * 1. Optimised strictly for recall over precision.
 * 2. Equal priority for third-party entities (ex-partners, landlords, children, officials).
 * 3. Layer 3 special categories flagged with transparent consequence trade-offs.
 * 4. Original transcript is never mutated in place.
 * 5. Precise audio time range projection from Pass One AsrWord timestamps.
 */

import type {
  DetectedIdentifier,
  LocalAsrResult,
  IdentifierCategory,
  IdentifierLayer,
  ProposedAction,
  AdviserDecision,
  DecisionConsequences,
} from '../state/volatileStore.ts';
import { matchLayer1StructuredIdentifiers } from './layer1StructuredMatcher.ts';
import { matchLayer2UnstructuredNer } from './layer2UnstructuredNer.ts';
import { matchLayer3SpecialCategories } from './layer3SpecialCategoryClassifier.ts';

export interface IdentifierDetectionResult {
  identifiers: DetectedIdentifier[];
  tokenMap: Record<string, string>;
  tokenisedTranscript: string;
  structuredCount: number;
  unstructuredCount: number;
  specialCategoryCount: number;
  totalDetected: number;
}

export class IdentifierEngine {
  /**
   * Runs all 3 detection layers on the transcript and projects character offsets
   * onto audio time ranges using Pass One ASR word timestamps.
   */
  public detectIdentifiers(
    transcript: string,
    asrResult?: LocalAsrResult | null
  ): IdentifierDetectionResult {
    if (!transcript || transcript.trim().length === 0) {
      return {
        identifiers: [],
        tokenMap: {},
        tokenisedTranscript: '',
        structuredCount: 0,
        unstructuredCount: 0,
        specialCategoryCount: 0,
        totalDetected: 0,
      };
    }

    // Step 1: Collect candidates from all 3 layers
    const layer1Candidates = matchLayer1StructuredIdentifiers(transcript);
    const layer2Candidates = matchLayer2UnstructuredNer(transcript);
    const layer3Candidates = matchLayer3SpecialCategories(transcript);

    // Step 2: Combine and sort candidates by character start index
    interface MergedCandidate {
      category: IdentifierCategory;
      layer: IdentifierLayer;
      text: string;
      normalizedText?: string;
      charStart: number;
      charEnd: number;
      confidence: number;
      surrogatePrefix: string;
      decisionConsequences?: DecisionConsequences;
    }

    const allCandidates: MergedCandidate[] = [
      ...layer1Candidates.map((c) => ({ ...c, layer: 1 as IdentifierLayer })),
      ...layer2Candidates.map((c) => ({ ...c, layer: 2 as IdentifierLayer })),
      ...layer3Candidates.map((c) => ({ ...c, layer: 3 as IdentifierLayer })),
    ];

    // Sort by start index, then longer length first, then lower layer (Layer 1 > 2 > 3)
    allCandidates.sort((a, b) => {
      if (a.charStart !== b.charStart) return a.charStart - b.charStart;
      const lenA = a.charEnd - a.charStart;
      const lenB = b.charEnd - b.charStart;
      if (lenA !== lenB) return lenB - lenA; // Longer span first
      return a.layer - b.layer; // Layer 1 prioritized
    });

    // Step 3: Resolve overlaps & deduplicate
    const resolved: MergedCandidate[] = [];
    for (const cand of allCandidates) {
      let overlaps = false;
      for (const existing of resolved) {
        // Check if spans overlap
        if (Math.max(cand.charStart, existing.charStart) < Math.min(cand.charEnd, existing.charEnd)) {
          overlaps = true;
          break;
        }
      }
      if (!overlaps) {
        resolved.push(cand);
      }
    }

    // Re-sort resolved candidates by start offset
    resolved.sort((a, b) => a.charStart - b.charStart);

    // Step 4: Map character offsets to audio time ranges and assign systematic surrogate tokens
    const categoryCounters: Record<string, number> = {};
    const tokenMap: Record<string, string> = {};
    const detectedIdentifiers: DetectedIdentifier[] = [];

    for (let i = 0; i < resolved.length; i++) {
      const cand = resolved[i];
      const prefix = cand.surrogatePrefix || 'PII';
      categoryCounters[prefix] = (categoryCounters[prefix] || 0) + 1;
      const index = categoryCounters[prefix];
      const surrogateToken = `[${prefix}_${index}]`;

      // Determine proposed action and default adviser decision
      let proposedAction: ProposedAction = 'redact';
      let adviserDecision: AdviserDecision = 'accepted';

      if (cand.layer === 3) {
        proposedAction = 'flag_for_decision';
        adviserDecision = 'retained_substance'; // Default to retaining clinical/legal substance
      }

      // Project audio time range and speaker attribution
      const { audioTimeRange, speaker } = this.projectAudioTimeRange(
        cand.charStart,
        cand.charEnd,
        transcript,
        asrResult
      );

      const identifier: DetectedIdentifier = {
        id: `ident-${i + 1}-${Date.now().toString(36)}`,
        text: cand.text,
        normalizedText: cand.normalizedText,
        charOffset: {
          start: cand.charStart,
          end: cand.charEnd,
        },
        audioTimeRange,
        category: cand.category,
        detectionLayer: cand.layer,
        confidence: cand.confidence,
        proposedAction,
        adviserDecision,
        surrogateToken,
        decisionConsequences: cand.decisionConsequences,
        speaker,
      };

      detectedIdentifiers.push(identifier);
      tokenMap[surrogateToken] = cand.text;
    }

    // Step 5: Construct tokenised transcript for non-mutating preview
    let tokenisedTranscript = '';
    let lastPos = 0;

    for (const ident of detectedIdentifiers) {
      tokenisedTranscript += transcript.slice(lastPos, ident.charOffset.start);
      // For Layer 3 items where default is 'retained_substance', retain original text with indicator
      if (ident.detectionLayer === 3 && ident.adviserDecision === 'retained_substance') {
        tokenisedTranscript += ident.text;
      } else {
        tokenisedTranscript += ident.surrogateToken;
      }
      lastPos = ident.charOffset.end;
    }
    tokenisedTranscript += transcript.slice(lastPos);

    const structuredCount = detectedIdentifiers.filter((d) => d.detectionLayer === 1).length;
    const unstructuredCount = detectedIdentifiers.filter((d) => d.detectionLayer === 2).length;
    const specialCategoryCount = detectedIdentifiers.filter((d) => d.detectionLayer === 3).length;

    return {
      identifiers: detectedIdentifiers,
      tokenMap,
      tokenisedTranscript,
      structuredCount,
      unstructuredCount,
      specialCategoryCount,
      totalDetected: detectedIdentifiers.length,
    };
  }

  /**
   * Projects text character offsets onto audio timestamps using Pass One ASR words.
   */
  private projectAudioTimeRange(
    charStart: number,
    charEnd: number,
    transcript: string,
    asrResult?: LocalAsrResult | null
  ): { audioTimeRange: { startSec: number; endSec: number }; speaker: 'adviser' | 'client' | 'unknown' } {
    if (!asrResult || !asrResult.segments || asrResult.segments.length === 0) {
      return {
        audioTimeRange: { startSec: 0, endSec: 0 },
        speaker: 'unknown',
      };
    }

    // Flatten all ASR words with estimated cumulative character offsets
    let cumulativeChar = 0;
    let matchedStartSec = -1;
    let matchedEndSec = -1;
    let dominantSpeaker: 'adviser' | 'client' | 'unknown' = 'unknown';

    for (const seg of asrResult.segments) {
      for (const word of seg.words) {
        const wordStart = transcript.indexOf(word.word, cumulativeChar);
        if (wordStart !== -1) {
          const wordEnd = wordStart + word.word.length;
          cumulativeChar = wordEnd;

          // Check if this word overlaps with our entity span
          if (wordEnd > charStart && wordStart < charEnd) {
            if (matchedStartSec === -1 || word.start < matchedStartSec) {
              matchedStartSec = word.start;
            }
            if (matchedEndSec === -1 || word.end > matchedEndSec) {
              matchedEndSec = word.end;
            }
            dominantSpeaker = word.speaker;
          }
        }
      }
    }

    if (matchedStartSec === -1 || matchedEndSec === -1) {
      // Fallback: estimate from relative character position and audio duration
      const duration = asrResult.segments[asrResult.segments.length - 1]?.end || 0;
      const fracStart = charStart / transcript.length;
      const fracEnd = charEnd / transcript.length;
      return {
        audioTimeRange: {
          startSec: Math.max(0, Math.round(fracStart * duration * 100) / 100),
          endSec: Math.min(duration, Math.round(fracEnd * duration * 100) / 100),
        },
        speaker: 'unknown',
      };
    }

    return {
      audioTimeRange: {
        startSec: Math.round(matchedStartSec * 100) / 100,
        endSec: Math.round(matchedEndSec * 100) / 100,
      },
      speaker: dominantSpeaker,
    };
  }
}

export const identifierEngine = new IdentifierEngine();
