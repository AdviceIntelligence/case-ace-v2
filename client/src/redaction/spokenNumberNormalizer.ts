/**
 * @file spokenNumberNormalizer.ts
 * @description Normalizes spoken numbers, dates, phonetic letters, and symbols
 * in advice interview transcripts to facilitate structured deterministic regex matching
 * while maintaining backward character offset mapping to the original transcript.
 */

export interface TokenSpan {
  text: string;
  originalStart: number;
  originalEnd: number;
}

const DIGIT_WORDS: Record<string, string> = {
  zero: '0',
  oh: '0',
  nil: '0',
  nought: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
};

const TEEN_WORDS: Record<string, string> = {
  ten: '10',
  eleven: '11',
  twelve: '12',
  thirteen: '13',
  fourteen: '14',
  fifteen: '15',
  sixteen: '16',
  seventeen: '17',
  eighteen: '18',
  nineteen: '19',
};

const TENS_WORDS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const ORDINAL_WORDS: Record<string, string> = {
  first: '1',
  '1st': '1',
  second: '2',
  '2nd': '2',
  third: '3',
  '3rd': '3',
  fourth: '4',
  '4th': '4',
  fifth: '5',
  '5th': '5',
  sixth: '6',
  '6th': '6',
  seventh: '7',
  '7th': '7',
  eighth: '8',
  '8th': '8',
  ninth: '9',
  '9th': '9',
  tenth: '10',
  '10th': '10',
  eleventh: '11',
  '11th': '11',
  twelfth: '12',
  '12th': '12',
  thirteenth: '13',
  '13th': '13',
  fourteenth: '14',
  '14th': '14',
  fifteenth: '15',
  '15th': '15',
  sixteenth: '16',
  '16th': '16',
  seventeenth: '17',
  '17th': '17',
  eighteenth: '18',
  '18th': '18',
  nineteenth: '19',
  '19th': '19',
  twentieth: '20',
  '20th': '20',
  'twenty-first': '21',
  '21st': '21',
  'twenty-second': '22',
  '22nd': '22',
  'twenty-third': '23',
  '23rd': '23',
  'twenty-fourth': '24',
  '24th': '24',
  'twenty-fifth': '25',
  '25th': '25',
  'twenty-sixth': '26',
  '26th': '26',
  'twenty-seventh': '27',
  '27th': '27',
  'twenty-eighth': '28',
  '28th': '28',
  'twenty-ninth': '29',
  '29th': '29',
  thirtieth: '30',
  '30th': '30',
  'thirty-first': '31',
  '31st': '31',
};

const MONTH_WORDS: Record<string, string> = {
  january: '01',
  jan: '01',
  february: '02',
  feb: '02',
  march: '03',
  mar: '03',
  april: '04',
  apr: '04',
  may: '05',
  june: '06',
  jun: '06',
  july: '07',
  jul: '07',
  august: '08',
  aug: '08',
  september: '09',
  sep: '09',
  sept: '09',
  october: '10',
  oct: '10',
  november: '11',
  nov: '11',
  december: '12',
  dec: '12',
};

/**
 * Converts words like "double five" -> "55", "treble seven" -> "777"
 * and individual digit words "oh seven nine" -> "079"
 */
export function normalizeSpokenDigits(text: string): { normalized: string; spans: TokenSpan[] } {
  // Tokenize while tracking original indices
  const regex = /[\w'-]+|[^\w\s]+/g;
  const rawTokens: TokenSpan[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    rawTokens.push({
      text: match[0],
      originalStart: match.index,
      originalEnd: match.index + match[0].length,
    });
  }

  const outSpans: TokenSpan[] = [];
  let i = 0;

  while (i < rawTokens.length) {
    const curr = rawTokens[i];
    const lower = curr.text.toLowerCase();

    // Check multipliers: "double X" or "treble X" / "triple X"
    if ((lower === 'double' || lower === 'treble' || lower === 'triple') && i + 1 < rawTokens.length) {
      const next = rawTokens[i + 1];
      const nextLower = next.text.toLowerCase();
      const count = lower === 'double' ? 2 : 3;

      let digitChar: string | null = null;
      if (DIGIT_WORDS[nextLower]) {
        digitChar = DIGIT_WORDS[nextLower];
      } else if (/^[0-9]$/.test(next.text)) {
        digitChar = next.text;
      } else if (/^[a-zA-Z]$/.test(next.text)) {
        digitChar = next.text.toUpperCase();
      }

      if (digitChar) {
        const expanded = digitChar.repeat(count);
        outSpans.push({
          text: expanded,
          originalStart: curr.originalStart,
          originalEnd: next.originalEnd,
        });
        i += 2;
        continue;
      }
    }

    // Single digit words
    if (DIGIT_WORDS[lower]) {
      outSpans.push({
        text: DIGIT_WORDS[lower],
        originalStart: curr.originalStart,
        originalEnd: curr.originalEnd,
      });
      i++;
      continue;
    }

    // Teen words
    if (TEEN_WORDS[lower]) {
      outSpans.push({
        text: TEEN_WORDS[lower],
        originalStart: curr.originalStart,
        originalEnd: curr.originalEnd,
      });
      i++;
      continue;
    }

    // Compound tens: "twenty four" -> "24"
    if (TENS_WORDS[lower]) {
      const tensVal = TENS_WORDS[lower];
      if (i + 1 < rawTokens.length) {
        const next = rawTokens[i + 1];
        const nextLower = next.text.toLowerCase();
        if (DIGIT_WORDS[nextLower] && DIGIT_WORDS[nextLower] !== '0') {
          const combined = (tensVal + parseInt(DIGIT_WORDS[nextLower], 10)).toString();
          outSpans.push({
            text: combined,
            originalStart: curr.originalStart,
            originalEnd: next.originalEnd,
          });
          i += 2;
          continue;
        }
      }
      outSpans.push({
        text: tensVal.toString(),
        originalStart: curr.originalStart,
        originalEnd: curr.originalEnd,
      });
      i++;
      continue;
    }

    // Spoken years like "nineteen eighty two" -> "1982", "twenty twenty four" -> "2024"
    if ((lower === 'nineteen' || lower === 'twenty') && i + 1 < rawTokens.length) {
      const century = lower === 'nineteen' ? '19' : '20';
      const next = rawTokens[i + 1];
      const nextLower = next.text.toLowerCase();

      // e.g. "nineteen eighty two" (three tokens: nineteen, eighty, two)
      if (TENS_WORDS[nextLower] && i + 2 < rawTokens.length) {
        const next2 = rawTokens[i + 2];
        const next2Lower = next2.text.toLowerCase();
        if (DIGIT_WORDS[next2Lower] && DIGIT_WORDS[next2Lower] !== '0') {
          const yearEnd = (TENS_WORDS[nextLower] + parseInt(DIGIT_WORDS[next2Lower], 10)).toString();
          outSpans.push({
            text: `${century}${yearEnd}`,
            originalStart: curr.originalStart,
            originalEnd: next2.originalEnd,
          });
          i += 3;
          continue;
        }
      }

      // e.g. "nineteen eighty" or "twenty twenty"
      if (TENS_WORDS[nextLower]) {
        outSpans.push({
          text: `${century}${TENS_WORDS[nextLower]}`,
          originalStart: curr.originalStart,
          originalEnd: next.originalEnd,
        });
        i += 2;
        continue;
      }

      // e.g. "twenty fifteen"
      if (TEEN_WORDS[nextLower]) {
        outSpans.push({
          text: `${century}${TEEN_WORDS[nextLower]}`,
          originalStart: curr.originalStart,
          originalEnd: next.originalEnd,
        });
        i += 2;
        continue;
      }
    }

    // Ordinal numbers (first, 14th, etc.)
    if (ORDINAL_WORDS[lower]) {
      outSpans.push({
        text: ORDINAL_WORDS[lower],
        originalStart: curr.originalStart,
        originalEnd: curr.originalEnd,
      });
      i++;
      continue;
    }

    // Spoken symbols
    if (lower === 'dot') {
      outSpans.push({
        text: '.',
        originalStart: curr.originalStart,
        originalEnd: curr.originalEnd,
      });
      i++;
      continue;
    }
    if (lower === 'at' && i > 0 && i + 1 < rawTokens.length) {
      outSpans.push({
        text: '@',
        originalStart: curr.originalStart,
        originalEnd: curr.originalEnd,
      });
      i++;
      continue;
    }

    // Default: retain token
    outSpans.push(curr);
    i++;
  }

  // Construct normalized text with single space separation
  const normalizedParts: string[] = [];
  for (const span of outSpans) {
    normalizedParts.push(span.text);
  }

  return {
    normalized: normalizedParts.join(' '),
    spans: outSpans,
  };
}

export { MONTH_WORDS, ORDINAL_WORDS, DIGIT_WORDS, TEEN_WORDS, TENS_WORDS };
