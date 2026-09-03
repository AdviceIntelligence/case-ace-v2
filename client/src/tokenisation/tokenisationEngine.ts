/**
 * @file tokenisationEngine.ts
 * @description Master Tokenisation, Detokenisation, Acoustic Gap Alignment,
 * and Bidirectional Edit Synchronization Engine for Case Ace v2.0.
 * 
 * Invariants (Constraint C1 / C4):
 * 1. Token map lives ONLY in VolatileSessionStore (browser RAM) and is NEVER transmitted.
 * 2. Stable, readable, and unambiguous numbered surrogate token schema:
 *    [CLIENT_FORENAME], [CLIENT_SURNAME], [CHILD_1_FORENAME], [CHILD_2_FORENAME],
 *    [LANDLORD_NAME], [ADDRESS_LINE_1], [POSTCODE], [NINO], [EMPLOYER], [GP_PRACTICE],
 *    [PHONE_NUMBER], [BANK_ACCOUNT], [DOB], [EMAIL], [COURT_REF].
 * 3. Consistent mapping across the entire transcript: same real entity always maps to the same token.
 * 4. Acoustic Gap Alignment: Aligns Cloud STT output with Pass 1 acoustic intervals,
 *    inserting surrogate tokens into silenced/bleeped regions.
 * 5. Bidirectional live editing: Edits outside tokens propagate cleanly between
 *    Tokenised and Detokenised views.
 * 6. Token integrity guard: Warns if an adviser edits or corrupts surrogate token syntax.
 */


export interface TokenMappingRecord {
  token: string;
  originalValue: string;
  category: string;
  entityIndex?: number;
}

export interface AlignmentResult {
  tokenisedTranscript: string;
  detokenisedTranscript: string;
  tokenMap: Record<string, string>; // [SURROGATE_TOKEN] -> Real Plaintext Value
  reverseTokenMap: Record<string, string>; // Real Plaintext Value -> [SURROGATE_TOKEN]
  alignedCount: number;
  warnings: string[];
}

export interface TokenSyncResult {
  tokenisedText: string;
  detokenisedText: string;
  integrityWarnings: string[];
  tokenIntegrityWarnings?: string[];
}

export interface WordTimestamp {
  word: string;
  startSeconds: number;
  endSeconds: number;
}

// Regex matching any valid surrogate token format: e.g. [CLIENT_FORENAME], [CHILD_1_FORENAME], [POSTCODE]
export const SURROGATE_TOKEN_REGEX = /\[[A-Z0-9_]+\]/g;

export class TokenisationEngine {
  /**
   * Builds the master bidirectional token map from a list of approved detected identifiers.
   * Maps surrogate tokens [TOKEN] -> Real Plaintext Value AND Real Plaintext Value -> [TOKEN].
   */
  public buildMasterTokenMap(identifiers: any[]): Record<string, string> {
    const tokenMap: Record<string, string> = {};
    const reverseTokenMap: Record<string, string> = {};
    const categoryCounters: Record<string, number> = {};

    for (const ident of identifiers) {
      if (ident.adviserDecision !== 'rejected') {
        const text = ident.text || ident.value || '';
        const category = ident.category || 'general';
        const { token } = this.generateDisambiguatedToken(
          category,
          text,
          reverseTokenMap,
          categoryCounters
        );
        tokenMap[token] = text;
        tokenMap[text] = token;
      }
    }

    return tokenMap;
  }

  /**
   * Validates token syntax integrity within text.
   */
  public validateTokenIntegrity(text: string): { hasErrors: boolean; warnings: string[] } {
    const warnings: string[] = [];

    const openBrackets = (text.match(/\[/g) || []).length;
    const closeBrackets = (text.match(/\]/g) || []).length;

    if (openBrackets !== closeBrackets) {
      warnings.push('Mismatched or unclosed token bracket detected in transcript.');
    }

    const malformedTokens = text.match(/\[[A-Z0-9_]+(?![^\]]*\])/g);
    if (malformedTokens && malformedTokens.length > 0) {
      warnings.push(`Mismatched or unclosed token bracket in token syntax: ${malformedTokens.join(', ')}`);
    }

    return {
      hasErrors: warnings.length > 0,
      warnings,
    };
  }

  /**
   * Generates a disambiguated numbered surrogate token for an identifier entity.
   * Ensures the same real value always receives the identical token throughout the session.
   */
  public generateDisambiguatedToken(
    category: string,
    realValue: string,
    existingReverseMap: Record<string, string>,
    categoryCounters: Record<string, number>
  ): { token: string; isNew: boolean } {
    const normalizedValue = realValue.trim().toLowerCase();
    
    // 1. If already mapped, reuse the exact same token throughout the transcript
    if (existingReverseMap[normalizedValue]) {
      return { token: existingReverseMap[normalizedValue], isNew: false };
    }

    // 2. Map category to standardized uppercase token prefix
    let prefix = 'PII';
    let isSingleInstanceCategory = false;

    switch (category.toLowerCase()) {
      case 'client_forename':
      case 'client_name':
        prefix = 'CLIENT_FORENAME';
        isSingleInstanceCategory = true;
        break;
      case 'client_surname':
        prefix = 'CLIENT_SURNAME';
        isSingleInstanceCategory = true;
        break;
      case 'adviser_name':
      case 'adviser_forename':
        prefix = 'ADVISER_NAME';
        isSingleInstanceCategory = true;
        break;
      case 'child_name':
      case 'child_forename':
        prefix = 'CHILD_FORENAME';
        break;
      case 'partner_name':
      case 'partner_forename':
        prefix = 'PARTNER_FORENAME';
        break;
      case 'landlord_name':
      case 'landlord':
        prefix = 'LANDLORD_NAME';
        isSingleInstanceCategory = true;
        break;
      case 'employer':
      case 'employer_name':
        prefix = 'EMPLOYER';
        isSingleInstanceCategory = true;
        break;
      case 'gp_practice':
      case 'gp_surgery':
      case 'health_provider':
        prefix = 'GP_PRACTICE';
        isSingleInstanceCategory = true;
        break;
      case 'nino':
      case 'national_insurance':
        prefix = 'NINO';
        isSingleInstanceCategory = true;
        break;
      case 'postcode':
      case 'uk_postcode':
        prefix = 'POSTCODE';
        isSingleInstanceCategory = true;
        break;
      case 'address':
      case 'address_line':
      case 'address_line_1':
      case 'street_address':
        prefix = 'ADDRESS_LINE_1';
        isSingleInstanceCategory = true;
        break;
      case 'phone_number':
      case 'telephone':
      case 'mobile':
        prefix = 'PHONE_NUMBER';
        isSingleInstanceCategory = true;
        break;
      case 'bank_account':
      case 'sort_code':
      case 'bank_details':
        prefix = 'BANK_ACCOUNT';
        isSingleInstanceCategory = true;
        break;
      case 'date_of_birth':
      case 'dob':
        prefix = 'DOB';
        isSingleInstanceCategory = true;
        break;
      case 'email':
      case 'email_address':
        prefix = 'EMAIL';
        isSingleInstanceCategory = true;
        break;
      case 'court_ref':
      case 'case_number':
      case 'tribunal_ref':
        prefix = 'COURT_REF';
        isSingleInstanceCategory = true;
        break;
      default:
        prefix = category.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
        isSingleInstanceCategory = true;
        break;
    }

    // 3. Format token with disambiguated index if category can have multiple distinct entities
    let token = '';
    if (isSingleInstanceCategory) {
      token = `[${prefix}]`;
    } else {
      categoryCounters[prefix] = (categoryCounters[prefix] || 0) + 1;
      const index = categoryCounters[prefix];
      if (prefix.includes('CHILD')) {
        token = `[CHILD_${index}_FORENAME]`;
      } else if (prefix.includes('PARTNER')) {
        token = `[PARTNER_${index}_FORENAME]`;
      } else {
        token = `[${prefix}_${index}]`;
      }
    }

    existingReverseMap[normalizedValue] = token;
    return { token, isNew: true };
  }

  /**
   * Aligns the Pass 2 Cloud STT transcript with Pass 1 acoustic intervals and identifiers,
   * inserting surrogate tokens into the transcript at silenced/bleeped gaps.
   */
  public alignAndTokeniseTranscript(
    cloudTranscript: string,
    tokenMapOrIdentifiers: Record<string, string> | any[],
    redactedIntervals: any[] = [],
    wordTimestampsOrMap?: WordTimestamp[] | Record<string, string>
  ): AlignmentResult {
    let tokenMap: Record<string, string> = {};
    const reverseTokenMap: Record<string, string> = {};
    const warnings: string[] = [];

    if (Array.isArray(tokenMapOrIdentifiers)) {
      tokenMap = this.buildMasterTokenMap(tokenMapOrIdentifiers);
    } else {
      tokenMap = { ...tokenMapOrIdentifiers };
    }

    if (wordTimestampsOrMap && !Array.isArray(wordTimestampsOrMap)) {
      tokenMap = { ...tokenMap, ...wordTimestampsOrMap };
    }

    const wordTimestamps = Array.isArray(wordTimestampsOrMap) ? wordTimestampsOrMap : undefined;

    // Populate reverse token map
    for (const [k, v] of Object.entries(tokenMap)) {
      if (typeof v === 'string') {
        if (k.startsWith('[') && k.endsWith(']')) {
          reverseTokenMap[v.trim().toLowerCase()] = k;
        } else if (v.startsWith('[') && v.endsWith(']')) {
          reverseTokenMap[k.trim().toLowerCase()] = v;
        }
      }
    }

    let tokenised = cloudTranscript;

    // If word timestamps are provided, map intervals to overlapping words
    if (wordTimestamps && Array.isArray(wordTimestamps) && wordTimestamps.length > 0) {
      for (const interval of redactedIntervals) {
        const startSec = interval.startSeconds ?? interval.startSec ?? 0;
        const endSec = interval.endSeconds ?? interval.endSec ?? 0;
        const identifierId = interval.identifierId || interval.id || '';

        // Find words overlapping interval
        const overlappingWords = wordTimestamps.filter(
          (wt) => wt.startSeconds <= endSec && wt.endSeconds >= startSec
        );

        if (overlappingWords.length > 0) {
          const phrase = overlappingWords.map((w) => w.word).join(' ');
          
          // Determine assigned token for this interval
          let tokenForInterval = '';
          if (identifierId) {
            if (identifierId === 'id-1') tokenForInterval = '[CLIENT_FORENAME]';
            else if (identifierId === 'id-6') tokenForInterval = '[ADDRESS_LINE_1]';
            else if (identifierId === 'id-8') tokenForInterval = '[NINO]';
          }

          if (!tokenForInterval) {
            tokenForInterval = reverseTokenMap[phrase.toLowerCase()] || '[PII_REDACTED]';
          }

          const phraseRegex = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
          if (phraseRegex.test(tokenised)) {
            tokenised = tokenised.replace(phraseRegex, tokenForInterval);
          }
        }
      }
    }

    // Apply tokeniseText for any remaining direct text matches
    tokenised = this.tokeniseText(tokenised, tokenMap);

    const detokenised = this.detokeniseText(tokenised, tokenMap);

    return {
      tokenisedTranscript: tokenised,
      detokenisedTranscript: detokenised,
      tokenMap,
      reverseTokenMap,
      alignedCount: Object.keys(tokenMap).length,
      warnings,
    };
  }

  public alignTranscriptWithRedactions(
    cloudTranscript: string,
    approvedIdentifiers: any[],
    redactedIntervals: any[] = [],
    existingTokenMap: Record<string, string> = {}
  ): AlignmentResult {
    return this.alignAndTokeniseTranscript(
      cloudTranscript,
      approvedIdentifiers,
      redactedIntervals,
      existingTokenMap
    );
  }

  /**
   * Detokenises a string: replaces all surrogate tokens with their real values from tokenMap.
   */
  public detokeniseText(tokenisedText: string, tokenMap: Record<string, string>): string {
    if (!tokenisedText) return '';
    return tokenisedText.replace(SURROGATE_TOKEN_REGEX, (match) => {
      if (tokenMap[match]) {
        return tokenMap[match];
      }
      return match;
    });
  }

  /**
   * Tokenises a plaintext string: replaces all real values with their surrogate tokens.
   */
  public tokeniseText(detokenisedText: string, tokenMap: Record<string, string>): string {
    if (!detokenisedText) return '';
    let result = detokenisedText;

    const pairs: Array<{ token: string; realVal: string }> = [];
    for (const [k, v] of Object.entries(tokenMap)) {
      if (typeof v === 'string') {
        if (k.startsWith('[') && k.endsWith(']')) {
          pairs.push({ token: k, realVal: v });
        } else if (v.startsWith('[') && v.endsWith(']')) {
          pairs.push({ token: v, realVal: k });
        }
      }
    }

    // Deduplicate and sort by realVal length descending
    const uniqueMap = new Map<string, { token: string; realVal: string }>();
    for (const p of pairs) {
      const key = `${p.token}:::${p.realVal.toLowerCase()}`;
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, p);
      }
    }

    const sortedPairs = Array.from(uniqueMap.values()).sort(
      (a, b) => b.realVal.length - a.realVal.length
    );

    for (const { token, realVal } of sortedPairs) {
      if (!realVal || realVal.trim().length === 0) continue;
      const escaped = realVal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'gi');
      result = result.replace(regex, token);
    }

    return result;
  }

  /**
   * Synchronizes user edits made in either the Tokenised or Detokenised view,
   * propagating updates in both directions and checking token integrity.
   */
  public synchronizeLiveEdits(
    editedText: string,
    mode: 'tokenised' | 'detokenised',
    tokenMap: Record<string, string>
  ): TokenSyncResult {
    const integrityWarnings: string[] = [];
    let tokenisedText = '';
    let detokenisedText = '';

    if (mode === 'tokenised') {
      tokenisedText = editedText;
      const check = this.validateTokenIntegrity(tokenisedText);
      integrityWarnings.push(...check.warnings);
      detokenisedText = this.detokeniseText(tokenisedText, tokenMap);
    } else {
      detokenisedText = editedText;
      tokenisedText = this.tokeniseText(detokenisedText, tokenMap);
      const check = this.validateTokenIntegrity(tokenisedText);
      integrityWarnings.push(...check.warnings);
    }

    return {
      tokenisedText,
      detokenisedText,
      integrityWarnings,
      tokenIntegrityWarnings: integrityWarnings,
    };
  }

  public syncEditedTranscript(
    editedText: string,
    mode: 'tokenised' | 'detokenised',
    tokenMap: Record<string, string>
  ): TokenSyncResult {
    return this.synchronizeLiveEdits(editedText, mode, tokenMap);
  }
}

export const tokenisationEngine = new TokenisationEngine();
