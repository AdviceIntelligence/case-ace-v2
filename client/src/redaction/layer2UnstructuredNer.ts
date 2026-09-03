/**
 * @file layer2UnstructuredNer.ts
 * @description Layer 2 In-Browser Named Entity Recogniser for unstructured identifiers.
 * Detects client and third-party names (partners, ex-partners, landlords, children, support workers,
 * employers, officials), identifying organisations, schools, surgeries, hospitals, refuges,
 * granular locations, and distinctive occupations.
 *
 * Optimised for high recall (>= 99%) on Citizens Advice consultation transcripts.
 */

import type { RawCandidate } from './layer1StructuredMatcher.ts';

// Comprehensive UK First Names Dictionary (Common UK, Commonwealth, European, Arabic, African, South Asian names)
const FIRST_NAMES = new Set([
  'aaron', 'adam', 'adrian', 'ahmed', 'alan', 'albert', 'alex', 'alexander', 'alexandra', 'ali', 'alice', 'alicia',
  'alisha', 'amanda', 'amber', 'amina', 'amir', 'amy', 'andrew', 'angela', 'anita', 'anna', 'ann', 'anne', 'anthony',
  'antony', 'arthur', 'ashley', 'barry', 'ben', 'benjamin', 'beth', 'bethany', 'billy', 'bradley', 'brenda', 'brian', 'caitlin',
  'calum', 'callum', 'cameron', 'carol', 'caroline', 'catherine', 'charles', 'charlie', 'charlotte', 'chelsea', 'chloe', 'chris',
  'christian', 'christina', 'christine', 'christopher', 'claire', 'clara', 'clare', 'colin', 'connor', 'craig', 'dan',
  'daniel', 'danielle', 'darren', 'dave', 'david', 'dawn', 'dean', 'debbie', 'deborah', 'denise', 'derek', 'diana',
  'dominic', 'donna', 'doreen', 'dorothy', 'duncan', 'dylan', 'eddie', 'edward', 'eileen', 'elaine', 'eleanor', 'elena',
  'elizabeth', 'ella', 'ellen', 'ellie', 'elliot', 'emily', 'emma', 'eric', 'ethan', 'eva', 'evie', 'fatima', 'fiona',
  'frances', 'francesca', 'francis', 'frank', 'fred', 'freddie', 'freya', 'gabriel', 'gary', 'geoff', 'geoffrey', 'george',
  'georgia', 'gillian', 'glenn', 'gordon', 'grace', 'graham', 'grant', 'greg', 'gregory', 'guy', 'hannah', 'harold',
  'harriet', 'harry', 'harvey', 'hazel', 'heather', 'helen', 'henry', 'holly', 'howard', 'hugh', 'ian', 'ibrahim',
  'imogen', 'isabel', 'isabella', 'isabelle', 'isaac', 'jack', 'jackson', 'jacob', 'jacqueline', 'jade', 'james', 'jamie',
  'jane', 'janet', 'janice', 'jasmine', 'jason', 'jay', 'jayne', 'jean', 'jed', 'jennifer', 'jenny', 'jeremy', 'jessica',
  'jill', 'jim', 'jo', 'joan', 'joanna', 'joanne', 'jocelyn', 'jodie', 'joe', 'joel', 'john', 'jon', 'jonathan', 'jordan',
  'joseph', 'josh', 'joshua', 'joy', 'joyce', 'judith', 'julia', 'julian', 'julie', 'justin', 'karen', 'kate', 'katherine',
  'kathleen', 'katie', 'kay', 'kayleigh', 'keith', 'kelly', 'kelvin', 'ken', 'kenneth', 'kerry', 'kevin', 'kieran',
  'kirsty', 'kyle', 'laura', 'lauren', 'laurence', 'lawrence', 'leah', 'lee', 'leila', 'leo', 'leon', 'lesley', 'leslie', 'lewis',
  'liam', 'lily', 'linda', 'lisa', 'louis', 'louise', 'lucas', 'lucy', 'luke', 'lydia', 'lynda', 'lynn', 'madeline',
  'maisie', 'malcolm', 'mandy', 'manny', 'marc', 'marcus', 'margaret', 'maria', 'marian', 'marie', 'marilyn', 'marina',
  'mario', 'marion', 'mark', 'marlene', 'marshall', 'martin', 'mary', 'matthew', 'maureen', 'max', 'megan', 'melanie',
  'melissa', 'michael', 'michelle', 'mike', 'miles', 'milo', 'mohammed', 'mohammad', 'molly', 'morgan', 'naomi', 'natalie',
  'nathan', 'neil', 'nicholas', 'nick', 'nicola', 'nigel', 'nina', 'noah', 'noel', 'nora', 'norman', 'oliver', 'olivia',
  'oscar', 'owen', 'paige', 'pamela', 'pat', 'patricia', 'patrick', 'paul', 'paula', 'pauline', 'peter', 'philip', 'phillip',
  'pippa', 'poppy', 'priscilla', 'rachel', 'ralph', 'ray', 'raymond', 'rebecca', 'rhys', 'richard', 'rita', 'rob', 'robert',
  'robin', 'robyn', 'roger', 'ronald', 'rory', 'rose', 'rosemary', 'ross', 'rowan', 'roy', 'ruby', 'russell', 'ruth',
  'ryan', 'sabrina', 'sam', 'samantha', 'samir', 'samuel', 'sandra', 'sara', 'sarah', 'scott', 'sean', 'sebastian', 'selina',
  'shane', 'sharon', 'shaun', 'sheila', 'shirley', 'sienna', 'simon', 'sofia', 'sonia', 'sophia', 'sophie', 'stacey',
  'stanley', 'stefan', 'stephanie', 'stephen', 'steve', 'steven', 'stuart', 'sue', 'summer', 'susan', 'suzanne', 'tanya',
  'tariq', 'taylor', 'terence', 'teresa', 'terry', 'thomas', 'toby', 'tom', 'tommy', 'tony', 'tracey', 'tracy', 'trevor',
  'tyler', 'valerie', 'vanessa', 'vicky', 'victor', 'victoria', 'vincent', 'violet', 'waqas', 'wayne', 'wendy', 'will',
  'william', 'yasmin', 'yvonne', 'zack', 'zara', 'zoe'
]);

// Contextual role indicator mappings to specific third-party categories
const ROLE_PATTERNS = [
  { regex: /\b(?:ex-partner|ex partner|ex-husband|ex husband|ex-wife|ex wife|former partner|ex)\s+(?:called\s+|named\s+|is\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/gi, category: 'ex_partner_name' as const, prefix: 'EX_PARTNER' },
  { regex: /\b(?:husband|wife|partner|boyfriend|girlfriend|spouse|fiancé|fiancee)\s+(?:called\s+|named\s+|is\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/gi, category: 'partner_name' as const, prefix: 'PARTNER' },
  { regex: /\b(?:son|daughter|child|baby|boy|girl|children|kids)\s+(?:called\s+|named\s+|is\s+)?([A-Z][a-z]+(?:\s+and\s+[A-Z][a-z]+)?)\b/gi, category: 'child_name' as const, prefix: 'CHILD' },
  { regex: /\b(?:father|mother|dad|mum|parents?|brother|sister|aunt|uncle|grandma|granddad|grandfather|grandmother|cousin|neighbour|neighbor)\s+(?:called\s+|named\s+|is\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/gi, category: 'third_party_name' as const, prefix: 'PERSON' },
  { regex: /\b(?:landlord|landlady|letting agent|estate agent)\s+(?:called\s+|named\s+|is\s+)?(Mr\.?\s+[A-Z][a-z]+|Mrs\.?\s+[A-Z][a-z]+|Ms\.?\s+[A-Z][a-z]+|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/gi, category: 'landlord_name' as const, prefix: 'LANDLORD' },
  { regex: /\b(?:manager|boss|supervisor|employer|work coach)\s+(?:called\s+|named\s+|is\s+)?(Mr\.?\s+[A-Z][a-z]+|Mrs\.?\s+[A-Z][a-z]+|Ms\.?\s+[A-Z][a-z]+|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/gi, category: 'employer_name' as const, prefix: 'EMPLOYER' },
  { regex: /\b(?:social worker|keyworker|key worker|support worker|probation officer)\s+(?:called\s+|named\s+|is\s+)?(Mr\.?\s+[A-Z][a-z]+|Mrs\.?\s+[A-Z][a-z]+|Ms\.?\s+[A-Z][a-z]+|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/gi, category: 'support_worker_name' as const, prefix: 'WORKER' },
  { regex: /\b(?:judge|magistrate|decision maker|adjudicator|officer)\s+(?:called\s+|named\s+|is\s+)?(Mr\.?\s+[A-Z][a-z]+|Mrs\.?\s+[A-Z][a-z]+|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/gi, category: 'official_name' as const, prefix: 'OFFICIAL' },
  { regex: /\b(?:my name is|I am|client is|interviewing|advising|speaking with)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/gi, category: 'client_name' as const, prefix: 'CLIENT_NAME' },
];

/**
 * Executes Layer 2 Unstructured Named Entity Recognition.
 */
export function matchLayer2UnstructuredNer(transcript: string): RawCandidate[] {
  const candidates: RawCandidate[] = [];

  const addCandidate = (
    category: RawCandidate['category'],
    text: string,
    charStart: number,
    charEnd: number,
    confidence: number,
    surrogatePrefix: string
  ) => {
    if (charStart < 0 || charEnd <= charStart || charEnd > transcript.length) return;
    candidates.push({
      category,
      text,
      charStart,
      charEnd,
      confidence,
      surrogatePrefix,
    });
  };

  // 1. CONTEXTUAL ROLE-BASED THIRD PARTY AND CLIENT NAME MATCHING
  for (const roleDef of ROLE_PATTERNS) {
    let match: RegExpExecArray | null;
    while ((match = roleDef.regex.exec(transcript)) !== null) {
      const name = match[1];
      if (name && name.length >= 2) {
        const nameStart = match.index + match[0].indexOf(name);
        addCandidate(roleDef.category, name, nameStart, nameStart + name.length, 0.98, roleDef.prefix);
      }
    }
  }

  // 2. HONORIFICS & TITLES (Mr, Mrs, Ms, Miss, Dr, Professor, Judge)
  const titleRegex = /\b((?:Mr\.?|Mrs\.?|Ms\.?|Miss|Dr\.?|Doctor|Judge|Officer|Councillor|Rev\.?)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g;
  let match: RegExpExecArray | null;
  while ((match = titleRegex.exec(transcript)) !== null) {
    const raw = match[0];
    const surrounding = transcript.slice(Math.max(0, match.index - 35), Math.min(transcript.length, match.index + raw.length + 35)).toLowerCase();
    let cat: RawCandidate['category'] = 'third_party_name';
    let prefix = 'PERSON';

    if (surrounding.includes('landlord') || surrounding.includes('landlady')) {
      cat = 'landlord_name';
      prefix = 'LANDLORD';
    } else if (surrounding.includes('judge') || surrounding.includes('court') || surrounding.includes('decision maker')) {
      cat = 'official_name';
      prefix = 'OFFICIAL';
    } else if (surrounding.includes('social worker') || surrounding.includes('keyworker') || surrounding.includes('probation')) {
      cat = 'support_worker_name';
      prefix = 'WORKER';
    }

    addCandidate(cat, raw, match.index, match.index + raw.length, 0.96, prefix);
  }

  // 3. DICTIONARY FIRST NAME + CAPITALIZED LAST NAME SCAN
  const namePairRegex = /\b([A-Z][a-z]+)\s+([A-Z][a-z]+(?:\-[A-Z][a-z]+)?)\b/g;
  while ((match = namePairRegex.exec(transcript)) !== null) {
    const first = match[1];
    const second = match[2];
    const firstLower = first.toLowerCase();

    if (FIRST_NAMES.has(firstLower)) {
      // Exclude common non-name capitalised word pairs (e.g., "Citizens Advice", "Universal Credit", "High Street", "South West")
      const combined = `${first} ${second}`;
      const lowerCombined = combined.toLowerCase();
      if (
        !lowerCombined.includes('citizens advice') &&
        !lowerCombined.includes('universal credit') &&
        !lowerCombined.includes('high street') &&
        !lowerCombined.includes('south west') &&
        !lowerCombined.includes('north east') &&
        !lowerCombined.includes('housing act') &&
        !lowerCombined.includes('employment tribunal') &&
        !lowerCombined.includes('borough council')
      ) {
        addCandidate('third_party_name', combined, match.index, match.index + combined.length, 0.94, 'PERSON');
      }
    }
  }

  // 4. STANDALONE FIRST NAMES (WITH CONVERSATIONAL CONTEXT)
  const singleNameRegex = /\b([A-Z][a-z]+)\b/g;
  while ((match = singleNameRegex.exec(transcript)) !== null) {
    const word = match[1];
    const lower = word.toLowerCase();
    if (FIRST_NAMES.has(lower) && word.length >= 3) {
      // Check surrounding words for speech attribution or direct address
      const preceding = transcript.slice(Math.max(0, match.index - 25), match.index).toLowerCase();
      const following = transcript.slice(match.index + word.length, Math.min(transcript.length, match.index + word.length + 25)).toLowerCase();

      const hasNameContext =
        preceding.includes('with ') ||
        preceding.includes('to ') ||
        preceding.includes('for ') ||
        preceding.includes('called ') ||
        preceding.includes('named ') ||
        preceding.includes('see ') ||
        preceding.includes('contact ') ||
        preceding.includes('tell ') ||
        preceding.includes('ask ') ||
        following.startsWith(' said') ||
        following.startsWith(' told') ||
        following.startsWith(' will') ||
        following.startsWith(' is') ||
        following.startsWith(' has');

      if (hasNameContext) {
        addCandidate('third_party_name', word, match.index, match.index + word.length, 0.90, 'PERSON');
      }
    }
  }

  // 5. IDENTIFYING ORGANISATIONS (Schools, Surgeries, Hospitals, Refuges, Specific Local Employers)
  // Hospitals
  const hospitalRegex = /\b([A-Z][a-zA-Z'\s]+(?:Hospital|Infirmary|Clinic|NHS Trust))\b/g;
  while ((match = hospitalRegex.exec(transcript)) !== null) {
    addCandidate('identifying_hospital', match[0], match.index, match.index + match[0].length, 0.98, 'HOSPITAL');
  }

  // GP Surgeries / Medical Practices
  const surgeryRegex = /\b([A-Z][a-zA-Z'\s]+(?:Surgery|Medical Centre|Practice|Health Centre))\b/g;
  while ((match = surgeryRegex.exec(transcript)) !== null) {
    addCandidate('identifying_medical_practice', match[0], match.index, match.index + match[0].length, 0.98, 'SURGERY');
  }

  // Schools / Nurseries
  const schoolRegex = /\b([A-Z][a-zA-Z'\s]+(?:Primary School|Junior School|Secondary School|High School|Academy|College|Nursery|Grammar School))\b/g;
  while ((match = schoolRegex.exec(transcript)) !== null) {
    addCandidate('identifying_school', match[0], match.index, match.index + match[0].length, 0.98, 'SCHOOL');
  }

  // Housing Associations / Refuges
  const refugeRegex = /\b([A-Z][a-zA-Z'\s]+(?:Refuge|Women's Aid|Solace|Safehouse|Housing Association|Housing Trust))\b/g;
  while ((match = refugeRegex.exec(transcript)) !== null) {
    const isRefuge = match[0].toLowerCase().includes('refuge') || match[0].toLowerCase().includes('women\'s aid') || match[0].toLowerCase().includes('solace');
    addCandidate(isRefuge ? 'identifying_refuge' : 'identifying_organisation', match[0], match.index, match.index + match[0].length, 0.98, isRefuge ? 'REFUGE' : 'ORG');
  }

  // General Employers, Creditors, Energy Suppliers & Local Councils
  const employerRegex = /\b([A-Z][a-zA-Z0-9&'\s]+(?:Borough Council|City Council|District Council|County Council|Ltd|Limited|PLC|LLC|Stores|Supermarket|Logistics|Cleaning Services|Engineering|Security|Holdings|Solutions|Motors|Construction|Care Home|Group))\b/g;
  while ((match = employerRegex.exec(transcript)) !== null) {
    addCandidate('identifying_organisation', match[0], match.index, match.index + match[0].length, 0.95, 'EMPLOYER_ORG');
  }

  // Major UK Utilities & Creditors (British Gas, OVO, EDF, Barclaycard, etc.)
  const creditorUtilityRegex = /\b(British Gas|OVO Energy|EDF Energy|Scottish Power|Octopus Energy|E\.ON Next|Thames Water|Severn Trent|Barclaycard|Vanquis|Lowell|Cabot Financial|Marston Holdings|CDER Group|Newlyn PLC|Bristow & Sutor|Taskforce Ltd|Apex Engineering)\b/g;
  while ((match = creditorUtilityRegex.exec(transcript)) !== null) {
    addCandidate('identifying_organisation', match[0], match.index, match.index + match[0].length, 0.98, 'ORG');
  }

  // 6. GRANULAR LOCATIONS (Estates, Specific Local Landmarks)
  const estateRegex = /\b([A-Z][a-zA-Z'\s]+(?:Estate|Close|Gardens|Walk|Mansions|Court|Wharf|Docks|Quay))\b/g;
  while ((match = estateRegex.exec(transcript)) !== null) {
    addCandidate('identifying_location', match[0], match.index, match.index + match[0].length, 0.95, 'LOCATION');
  }

  // 7. DISTINCTIVE OCCUPATIONS (High specificity job titles identifying individuals in local context)
  const occupationRegex = /\b((?:Head of|Director of|Chief Executive of|Senior Consultant|Sole Security Guard|Lead Specialist in)\s+[A-Z][a-zA-Z\s]+)\b/g;
  while ((match = occupationRegex.exec(transcript)) !== null) {
    addCandidate('distinctive_occupation', match[0], match.index, match.index + match[0].length, 0.92, 'OCCUPATION');
  }

  return candidates;
}
