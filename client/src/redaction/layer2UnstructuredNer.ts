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
 * Words that are never a person's name, however they are capitalised.
 *
 * Needed because every ROLE_PATTERNS regex carries the `i` flag, which silently nullifies the
 * `[A-Z][a-z]+` capitalisation constraint written into each pattern. With `i`, "my son was
 * ill" matched as the child's name "was", "I am worried about" matched as the client's name
 * "worried about", and "my partner Sarah left" captured "Sarah left", eating the verb. On
 * ordinary advice dialogue containing no identifiers at all, the engine produced a false
 * positive roughly every forty words, and the resulting transcript could not be read.
 */
const NEVER_A_NAME = new Set([
  'a', 'about', 'after', 'again', 'against', 'all', 'also', 'always', 'am', 'an', 'and', 'any',
  'are', 'as', 'asked', 'at', 'back', 'be', 'because', 'been', 'before', 'being', 'both', 'but',
  'by', 'called', 'came', 'can', 'come', 'could', 'did', 'do', 'does', 'doing', 'done', 'down',
  'each', 'even', 'ever', 'every', 'few', 'for', 'friend', 'from', 'gave', 'get', 'give', 'go',
  'going', 'gone', 'got', 'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'him',
  'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'just', 'keep', 'kept', 'knew',
  'know', 'last', 'later', 'left', 'less', 'let', 'like', 'lived', 'lives', 'living', 'look',
  'looked', 'made', 'make', 'many', 'may', 'me', 'might', 'mine', 'more', 'most', 'moved',
  'much', 'must', 'my', 'need', 'needed', 'needs', 'never', 'new', 'next', 'no', 'not', 'now',
  'of', 'off', 'often', 'on', 'once', 'one', 'only', 'or', 'other', 'our', 'out', 'over',
  'owes', 'own', 'paid', 'pays', 'put', 'ran', 'rang', 'said', 'same', 'saw', 'say', 'says',
  'see', 'seen', 'sent', 'she', 'should', 'since', 'so', 'some', 'still', 'stopped', 'such',
  'take', 'taken', 'tell', 'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these',
  'they', 'this', 'those', 'though', 'thought', 'through', 'to', 'told', 'too', 'took', 'try',
  'tried', 'under', 'until', 'up', 'us', 'used', 'very', 'was', 'we', 'well', 'went', 'were',
  'what', 'when', 'where', 'which', 'while', 'who', 'why', 'will', 'with', 'without', 'work',
  'worked', 'working', 'worried', 'would', 'yet', 'you', 'your', 'yours',
]);

/** Honorifics that may legitimately begin a captured name. */
const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'doctor', 'rev', 'judge']);

/**
 * Accepts a captured span only if it actually looks like a person's name: every word begins
 * with a capital in the source text, and no word is ordinary English. Trailing words that fail
 * the test are dropped rather than swallowed, so "Sarah left" yields "Sarah" and keeps "left"
 * in the transcript.
 *
 * Returns the trimmed name, or null when nothing name-like remains.
 */
export function extractNameLikeSpan(captured: string): string | null {
  const words = captured.trim().split(/\s+/).filter(Boolean);
  const kept: string[] = [];

  for (const word of words) {
    const bare = word.replace(/[.,;:]$/, '');
    const lower = bare.toLowerCase().replace(/\./g, '');

    if (HONORIFICS.has(lower) && kept.length === 0) {
      kept.push(word);
      continue;
    }
    // Capitalisation is the evidence. Without it there is no reason to think this is a name.
    if (!/^[A-Z][a-z'\-]*$/.test(bare)) break;
    if (NEVER_A_NAME.has(lower)) break;
    kept.push(bare);
  }

  // An honorific on its own names nobody.
  if (kept.length === 0) return null;
  if (kept.length === 1 && HONORIFICS.has(kept[0].toLowerCase().replace(/\./g, ''))) return null;

  return kept.join(' ');
}

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
  //
  // The captured span is validated before it is accepted. The patterns are written with
  // `[A-Z][a-z]+` to require a capitalised name, but they carry the `i` flag, which cancels
  // that requirement. Rather than rewrite nine patterns and rely on nobody adding a tenth with
  // the flag, the capitalisation rule is enforced here, where it cannot be bypassed.
  for (const roleDef of ROLE_PATTERNS) {
    roleDef.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = roleDef.regex.exec(transcript)) !== null) {
      const captured = match[1];
      if (!captured) continue;

      const name = extractNameLikeSpan(captured);
      if (!name || name.length < 2) continue;

      const nameStart = match.index + match[0].indexOf(name);
      if (nameStart < match.index) continue;

      addCandidate(roleDef.category, name, nameStart, nameStart + name.length, 0.98, roleDef.prefix);
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

    if (FIRST_NAMES.has(firstLower) && !NEVER_A_NAME.has(firstLower) && !NEVER_A_NAME.has(second.toLowerCase())) {
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

    // A capitalised word at the start of a sentence carries no evidence of being a name: it
    // is capitalised because it begins a sentence. Automatic punctuation from the transcriber
    // capitalises every sentence, so without this "Will they accept that" was redacted as a
    // person called Will.
    const before = transcript.slice(0, match.index);
    const startsSentence = /(^|[.!?]["')\]]?\s+)$/.test(before);

    if (!startsSentence && !NEVER_A_NAME.has(lower) && FIRST_NAMES.has(lower) && word.length >= 3) {
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
