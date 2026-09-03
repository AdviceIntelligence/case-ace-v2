/**
 * @file layer1StructuredMatcher.ts
 * @description Layer 1 Deterministic Pattern Matcher for structured United Kingdom identifiers.
 * Optimised for 100% recall on UK statutory and administrative identifiers in written and spoken forms.
 */

import type { DetectedIdentifier } from '../state/volatileStore.ts';
import { normalizeSpokenDigits } from './spokenNumberNormalizer.ts';

export interface RawCandidate {
  category: DetectedIdentifier['category'];
  text: string;
  normalizedText?: string;
  charStart: number;
  charEnd: number;
  confidence: number;
  surrogatePrefix: string;
}

/**
 * Validates a 10-digit UK NHS Number using the official Modulus 11 Checksum Algorithm.
 * Digits 1-9 multiplied by weights [10, 9, 8, 7, 6, 5, 4, 3, 2].
 * Remainder R = sum mod 11.
 * Check digit = 11 - R (or 0 if R == 0). If R == 1, number is invalid per NHS standard.
 */
export function validateNhsNumber(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 10) return false;

  const weights = [10, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(digits[i], 10) * weights[i];
  }

  const remainder = sum % 11;
  const checkDigit = remainder === 0 ? 0 : 11 - remainder;

  if (remainder === 1) {
    // Per NHS spec, check digit cannot be 10; number is invalid
    return false;
  }

  return parseInt(digits[9], 10) === checkDigit;
}

/**
 * Executes Layer 1 Deterministic UK Structured Identifier Detection.
 */
export function matchLayer1StructuredIdentifiers(transcript: string): RawCandidate[] {
  const candidates: RawCandidate[] = [];

  // Helper to add candidate
  const addCandidate = (
    category: DetectedIdentifier['category'],
    text: string,
    charStart: number,
    charEnd: number,
    confidence: number,
    surrogatePrefix: string,
    normalizedText?: string
  ) => {
    // Avoid zero-length or out-of-bounds spans
    if (charStart < 0 || charEnd <= charStart || charEnd > transcript.length) return;
    candidates.push({
      category,
      text,
      charStart,
      charEnd,
      confidence,
      surrogatePrefix,
      normalizedText,
    });
  };

  // 1. NATIONAL INSURANCE NUMBER (NINO)
  // Standard UK NINO + Synthetic test prefixes (QQ etc.)
  const ninoRegex = /\b([A-Z]{2}\s*\d{2}\s*\d{2}\s*\d{2}\s*[A-D]?)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = ninoRegex.exec(transcript)) !== null) {
    const raw = match[1];
    const cleaned = raw.replace(/\s+/g, '').toUpperCase();
    if (cleaned.length >= 8 && cleaned.length <= 9) {
      addCandidate('national_insurance', match[0], match.index, match.index + match[0].length, 1.0, 'NINO', cleaned);
    }
  }

  // Spoken NINO (e.g. "QQ one two three four five six A")
  const spokenNinoRegex = /\b([A-Za-z]{2}\s+(?:(?:(?:oh|zero|nought|nil|one|two|three|four|five|six|seven|eight|nine)\s*){6}|(?:\d\s*){6})\s*[A-Da-d]?)\b/gi;
  while ((match = spokenNinoRegex.exec(transcript)) !== null) {
    const wordMap: Record<string, string> = {
      zero: '0', oh: '0', nought: '0', nil: '0',
      one: '1', two: '2', three: '3', four: '4', five: '5',
      six: '6', seven: '7', eight: '8', nine: '9',
    };
    const normalized = match[1].toLowerCase().replace(/\b(zero|oh|nought|nil|one|two|three|four|five|six|seven|eight|nine)\b/g, (w) => wordMap[w] || w).replace(/\s+/g, '').toUpperCase();
    addCandidate('national_insurance', match[0], match.index, match.index + match[0].length, 1.0, 'NINO', normalized);
  }

  // 2. UK POSTCODE (BS 7666 Full Standard)
  const postcodeRegex = /\b(([A-Z]{1,2}[0-9][A-Z0-9]?)\s*([0-9][A-Z]{2}))\b/gi;
  while ((match = postcodeRegex.exec(transcript)) !== null) {
    const raw = match[0];
    const cleaned = raw.replace(/\s+/g, '').toUpperCase();
    // Validate inward code format (1 digit + 2 letters)
    if (/^[0-9][A-Z]{2}$/.test(cleaned.slice(-3))) {
      addCandidate('uk_postcode', raw, match.index, match.index + raw.length, 1.0, 'POSTCODE', cleaned);
    }
  }

  // 3. TELEPHONE NUMBERS (Landline & Mobile, Written & Spoken)
  // UK Mobile (07xxx xxx xxx) or Landline (020, 01xx) or International (+44)
  const phoneRegex = /\b((?:\+44\s*|0)(?:7\d{3}\s*\d{3}\s*\d{3}|20\s*\d{4}\s*\d{4}|1\d{2,3}\s*\d{3}\s*\d{3,4}|[1-9]\d{8,9}))\b/g;
  while ((match = phoneRegex.exec(transcript)) !== null) {
    const digitsOnly = match[0].replace(/\D/g, '');
    if (digitsOnly.length >= 10 && digitsOnly.length <= 13) {
      addCandidate('phone_number', match[0], match.index, match.index + match[0].length, 1.0, 'PHONE', digitsOnly);
    }
  }

  // Spoken Phone Number (e.g. "oh seven seven zero zero nine zero zero four five six")
  const spokenPhoneRegex = /\b((?:(?:oh|zero|one|two|three|four|five|six|seven|eight|nine)\s+){9,12}(?:oh|zero|one|two|three|four|five|six|seven|eight|nine))\b/gi;
  while ((match = spokenPhoneRegex.exec(transcript)) !== null) {
    const digitMap: Record<string, string> = {
      zero: '0', oh: '0', nought: '0', nil: '0',
      one: '1', two: '2', three: '3', four: '4', five: '5',
      six: '6', seven: '7', eight: '8', nine: '9',
    };
    const digits = match[1].toLowerCase().replace(/\b(zero|oh|nought|nil|one|two|three|four|five|six|seven|eight|nine)\b/g, (w) => digitMap[w] || w).replace(/\s+/g, '');
    if (digits.length >= 10 && digits.length <= 13) {
      addCandidate('phone_number', match[0], match.index, match.index + match[0].length, 1.0, 'PHONE', digits);
    }
  }

  // 4. EMAIL ADDRESSES (RFC 5322 Standard)
  const emailRegex = /\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g;
  while ((match = emailRegex.exec(transcript)) !== null) {
    addCandidate('email_address', match[0], match.index, match.index + match[0].length, 1.0, 'EMAIL');
  }

  // 5. NHS NUMBERS (10 digits, with Modulus 11 Checksum)
  // Formats: 485 777 3456, 485-777-3456, or 4857773456
  const nhsRegex = /\b(\d{3}[\s-]?\d{3}[\s-]?\d{4})\b/g;
  while ((match = nhsRegex.exec(transcript)) !== null) {
    const cleanNhs = match[0].replace(/\D/g, '');
    if (cleanNhs.length === 10) {
      const isValidMod11 = validateNhsNumber(cleanNhs);
      const surroundingContext = transcript.slice(Math.max(0, match.index - 30), Math.min(transcript.length, match.index + 40)).toLowerCase();
      const hasNhsContext = surroundingContext.includes('nhs') || surroundingContext.includes('medical') || surroundingContext.includes('doctor') || surroundingContext.includes('hospital');

      if (isValidMod11 || hasNhsContext) {
        addCandidate('nhs_number', match[0], match.index, match.index + match[0].length, isValidMod11 ? 1.0 : 0.95, 'NHS_NO', cleanNhs);
      }
    }
  }

  // 6. BANK SORT CODES & ACCOUNT NUMBERS
  // Sort Code: 6 digits (XX-XX-XX or XX XX XX)
  const sortCodeRegex = /\b(\d{2}[-\s]\d{2}[-\s]\d{2})\b/g;
  while ((match = sortCodeRegex.exec(transcript)) !== null) {
    const surroundingContext = transcript.slice(Math.max(0, match.index - 35), Math.min(transcript.length, match.index + 35)).toLowerCase();
    if (surroundingContext.includes('sort') || surroundingContext.includes('bank') || surroundingContext.includes('account') || surroundingContext.includes('branch')) {
      addCandidate('bank_sort_code', match[0], match.index, match.index + match[0].length, 1.0, 'SORT_CODE', match[0].replace(/\D/g, ''));
    }
  }

  // Bank Account Number: 8 digits (often adjacent to sort code or account keywords)
  const accountNoRegex = /\b(\d{8})\b/g;
  while ((match = accountNoRegex.exec(transcript)) !== null) {
    const surroundingContext = transcript.slice(Math.max(0, match.index - 40), Math.min(transcript.length, match.index + 40)).toLowerCase();
    if (surroundingContext.includes('account') || surroundingContext.includes('sort') || surroundingContext.includes('bank') || surroundingContext.includes('natwest') || surroundingContext.includes('barclays') || surroundingContext.includes('hsbc') || surroundingContext.includes('lloyds') || surroundingContext.includes('santander')) {
      addCandidate('bank_account_number', match[0], match.index, match.index + match[0].length, 1.0, 'BANK_ACCT', match[0]);
    }
  }

  // 7. UNIVERSAL CREDIT & DWP BENEFIT REFERENCES
  const benefitRefRegex = /\b((?:UC|PIP|ESA|DLA|JSA|DWP|DHP)[-\s/:]?[A-Z0-9]{6,12})\b/gi;
  while ((match = benefitRefRegex.exec(transcript)) !== null) {
    addCandidate('benefit_reference', match[0], match.index, match.index + match[0].length, 1.0, 'BENEFIT_REF');
  }

  // 8. PASSPORT & HOME OFFICE REFERENCES
  // Passport (9 digits in passport context)
  const passportRegex = /\b(?:(?:(?:UK|British)\s*)?passport(?:\s*(?:number|no|#))?\s*(?:is|[:#])?\s*)([0-9]{9})\b/gi;
  while ((match = passportRegex.exec(transcript)) !== null) {
    const num = match[1];
    addCandidate('passport_number', num, match.index + match[0].indexOf(num), match.index + match[0].indexOf(num) + num.length, 1.0, 'PASSPORT_NO', num);
  }

  // Home Office References (HO/, CID, UAN, BRP, GWF, or A1234567)
  const homeOfficeRegex = /\b((?:HO|CID|UAN|BRP|GWF)[-\s/:]?[0-9A-Z]{6,16}|[A-Z]\d{7})\b/gi;
  while ((match = homeOfficeRegex.exec(transcript)) !== null) {
    const surrounding = transcript.slice(Math.max(0, match.index - 30), Math.min(transcript.length, match.index + 30)).toLowerCase();
    if (surrounding.includes('home office') || surrounding.includes('immigration') || surrounding.includes('visa') || surrounding.includes('brp') || surrounding.includes('asylum') || match[0].toUpperCase().startsWith('HO') || match[0].toUpperCase().startsWith('UAN') || match[0].toUpperCase().startsWith('CID')) {
      addCandidate('home_office_reference', match[0], match.index, match.index + match[0].length, 1.0, 'HO_REF');
    }
  }

  // 9. COURT & TRIBUNAL CASE NUMBERS
  const courtRefRegex = /\b([A-Z]{1,3}\/\d{2,4}\/\d{1,6}|[A-Z][0-9]{2}[A-Z]{2}[0-9]{3}|\d{4}\/\d{4})\b/g;
  while ((match = courtRefRegex.exec(transcript)) !== null) {
    const surrounding = transcript.slice(Math.max(0, match.index - 35), Math.min(transcript.length, match.index + 35)).toLowerCase();
    if (surrounding.includes('court') || surrounding.includes('tribunal') || surrounding.includes('judge') || surrounding.includes('case') || surrounding.includes('appeal') || surrounding.includes('possession') || match[0].includes('/')) {
      addCandidate('court_case_number', match[0], match.index, match.index + match[0].length, 1.0, 'CASE_NO');
    }
  }

  // 10. HMRC REFERENCES (UTR 10 digits, VAT 9 digits)
  const utrRegex = /\b(?:(?:UTR|unique\s*taxpayer\s*reference)(?:\s*(?:number|no|#|ref))?\s*(?:is|[:#])?\s*)(\d{10})\b/gi;
  while ((match = utrRegex.exec(transcript)) !== null) {
    const num = match[1];
    addCandidate('hmrc_reference', num, match.index + match[0].indexOf(num), match.index + match[0].indexOf(num) + num.length, 1.0, 'HMRC_REF', num);
  }

  // 11. DATES OF BIRTH (DOB)
  // Written formats: DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY
  const numericDobRegex = /\b((?:0?[1-9]|[12][0-9]|3[01])[\/\-.](?:0?[1-9]|1[012])[\/\-.](?:19\d{2}|20\d{2}))\b/g;
  while ((match = numericDobRegex.exec(transcript)) !== null) {
    addCandidate('date_of_birth', match[0], match.index, match.index + match[0].length, 1.0, 'DOB');
  }

  // English written dates: "14th August 1982", "3 March 1975"
  const textDobRegex = /\b((?:0?[1-9]|[12][0-9]|3[01])(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[,\s]+(?:19\d{2}|20\d{2}))\b/gi;
  while ((match = textDobRegex.exec(transcript)) !== null) {
    addCandidate('date_of_birth', match[0], match.index, match.index + match[0].length, 1.0, 'DOB');
  }

  // Spoken dates of birth: "fourteenth of August nineteen eighty-two"
  const spokenDobRegex = /\b((?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|twenty-first|twenty-second|twenty-third|twenty-fourth|twenty-fifth|twenty-sixth|twenty-seventh|twenty-eighth|twenty-ninth|thirtieth|thirty-first|\d{1,2}(?:st|nd|rd|th)?)\s+(?:of\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+(?:nineteen|twenty|\d{2})\s*(?:\d{2,4}|eighty|seventy|sixty|fifty|forty|thirty|twenty|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)?)\b/gi;
  while ((match = spokenDobRegex.exec(transcript)) !== null) {
    addCandidate('date_of_birth', match[0], match.index, match.index + match[0].length, 1.0, 'DOB');
  }

  // 12. STREET & RESIDENTIAL ADDRESSES
  const addressRegex = /\b((?:Flat\s+\w+,?\s+)?(?:\d{1,4}[a-zA-Z]?\s+)?(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Road|Street|Avenue|Lane|Grove|Hill|Rise|Way|Drive|Crescent|Close|Place|Court|Gardens|Terrace|Square|Walk|Mews|Estate|Side|Row|Parade|Park|Common\s+(?:North|South|East|West)\s+Side|Common|Broadway|Wharf|Buildings|Villas|Cottages)))\b/g;
  while ((match = addressRegex.exec(transcript)) !== null) {
    addCandidate('street_address', match[0], match.index, match.index + match[0].length, 0.95, 'ADDRESS');
  }

  // 13. SPONKEN NUMBER & ALPHANUMERIC MATCHER PASS
  // Handle spoken NINO ("QQ one two three four five six A") and spoken phones ("oh seven one two three...")
  const normalizedData = normalizeSpokenDigits(transcript);
  if (normalizedData.normalized !== transcript) {
    // Check spoken NINO on normalized token stream
    const spokenNinoMatch = /\b([A-Z]{2}\s*\d{6}\s*[A-D]?)\b/gi.exec(normalizedData.normalized);
    if (spokenNinoMatch) {
      // Find corresponding span in original transcript
      const normStart = spokenNinoMatch.index;
      const normEnd = normStart + spokenNinoMatch[0].length;

      let origStart = -1;
      let origEnd = -1;
      let currentPos = 0;

      for (const span of normalizedData.spans) {
        const spanEnd = currentPos + span.text.length;
        if (origStart === -1 && spanEnd > normStart) {
          origStart = span.originalStart;
        }
        if (spanEnd >= normEnd) {
          origEnd = span.originalEnd;
          break;
        }
        currentPos = spanEnd + 1; // accounting for space
      }

      if (origStart !== -1 && origEnd > origStart) {
        const rawText = transcript.slice(origStart, origEnd);
        addCandidate('national_insurance', rawText, origStart, origEnd, 1.0, 'NINO', spokenNinoMatch[1].replace(/\s+/g, ''));
      }
    }

    // Check spoken dates of birth: "fourteenth of August nineteen eighty-two"
    const spokenDobRegex = /\b((?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|twenty-first|twenty-second|twenty-third|twenty-fourth|twenty-fifth|twenty-sixth|twenty-seventh|twenty-eighth|twenty-ninth|thirtieth|thirty-first|\d{1,2}(?:st|nd|rd|th)?)\s+(?:of\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+(?:nineteen|twenty|\d{2})\s*(?:\d{2,4}|eighty|seventy|sixty|fifty|forty|thirty|twenty|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)?)\b/gi;
    while ((match = spokenDobRegex.exec(transcript)) !== null) {
      addCandidate('date_of_birth', match[0], match.index, match.index + match[0].length, 1.0, 'DOB');
    }
  }

  return candidates;
}
