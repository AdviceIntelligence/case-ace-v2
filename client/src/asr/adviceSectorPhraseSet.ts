/**
 * adviceSectorPhraseSet.ts
 * 
 * Version-Controlled UK Advice Sector Domain Adaptation Phrase Set
 * for Google Cloud Speech-to-Text v2.
 * 
 * Version: 1.2.0
 * Pinned Region: europe-west2 (London)
 * 
 * Purpose:
 * General conversational ASR models frequently mistranscribe complex UK statutory,
 * welfare, housing, and debt terminology. This phrase set provides acoustic adaptation
 * boosts for standard Citizens Advice and AQS Level 3 terminology to ensure high
 * transcription fidelity before case note synthesis.
 */

export interface AdaptationPhrase {
  value: string;
  boost: number; // 1.0 to 20.0 (recommended 5.0 - 15.0 for specific statutory phrases)
  category: 'welfare_benefits' | 'housing_tenancy' | 'debt_money' | 'employment_rights' | 'immigration_safeguarding' | 'legal_tribunal';
}

export const ADVICE_SECTOR_PHRASE_SET_VERSION = '1.2.0';

export const ADVICE_SECTOR_PHRASES: AdaptationPhrase[] = [
  // ---------------------------------------------------------------------------
  // 1. Welfare Benefits & Social Security
  // ---------------------------------------------------------------------------
  { value: 'mandatory reconsideration', boost: 15.0, category: 'welfare_benefits' },
  { value: 'limited capability for work related activity', boost: 15.0, category: 'welfare_benefits' },
  { value: 'limited capability for work', boost: 12.0, category: 'welfare_benefits' },
  { value: 'LCWRA', boost: 14.0, category: 'welfare_benefits' },
  { value: 'LCW', boost: 12.0, category: 'welfare_benefits' },
  { value: 'Universal Credit standard allowance', boost: 14.0, category: 'welfare_benefits' },
  { value: 'Universal Credit housing element', boost: 12.0, category: 'welfare_benefits' },
  { value: 'Personal Independence Payment', boost: 14.0, category: 'welfare_benefits' },
  { value: 'PIP daily living component', boost: 14.0, category: 'welfare_benefits' },
  { value: 'PIP mobility component', boost: 14.0, category: 'welfare_benefits' },
  { value: 'Disability Living Allowance', boost: 12.0, category: 'welfare_benefits' },
  { value: 'Employment and Support Allowance', boost: 12.0, category: 'welfare_benefits' },
  { value: 'Work Capability Assessment', boost: 15.0, category: 'welfare_benefits' },
  { value: 'Discretionary Housing Payment', boost: 15.0, category: 'welfare_benefits' },
  { value: 'DHP', boost: 14.0, category: 'welfare_benefits' },
  { value: 'Council Tax Reduction scheme', boost: 12.0, category: 'welfare_benefits' },
  { value: 'Council Tax Support', boost: 10.0, category: 'welfare_benefits' },
  { value: 'Budgeting Advance', boost: 12.0, category: 'welfare_benefits' },
  { value: 'Hardship Payment', boost: 12.0, category: 'welfare_benefits' },
  { value: 'Carer’s Allowance', boost: 10.0, category: 'welfare_benefits' },
  { value: 'Attendance Allowance', boost: 10.0, category: 'welfare_benefits' },
  { value: 'Pension Credit guarantee credit', boost: 12.0, category: 'welfare_benefits' },
  { value: 'managed migration', boost: 12.0, category: 'welfare_benefits' },
  { value: 'transitional protection', boost: 12.0, category: 'welfare_benefits' },
  { value: 'claimant commitment', boost: 12.0, category: 'welfare_benefits' },
  { value: 'benefit sanction', boost: 10.0, category: 'welfare_benefits' },
  { value: 'benefit cap', boost: 10.0, category: 'welfare_benefits' },
  { value: 'bedroom tax', boost: 10.0, category: 'welfare_benefits' },
  { value: 'two-child limit', boost: 10.0, category: 'welfare_benefits' },

  // ---------------------------------------------------------------------------
  // 2. Housing & Tenancy Law
  // ---------------------------------------------------------------------------
  { value: 'Section 21 notice', boost: 15.0, category: 'housing_tenancy' },
  { value: 'Section 8 notice seeking possession', boost: 15.0, category: 'housing_tenancy' },
  { value: 'assured shorthold tenancy', boost: 14.0, category: 'housing_tenancy' },
  { value: 'accelerated possession procedure', boost: 14.0, category: 'housing_tenancy' },
  { value: 'warrant of eviction', boost: 14.0, category: 'housing_tenancy' },
  { value: 'warrant of possession', boost: 12.0, category: 'housing_tenancy' },
  { value: 'stay of execution', boost: 12.0, category: 'housing_tenancy' },
  { value: 'Housing Act 1988', boost: 12.0, category: 'housing_tenancy' },
  { value: 'Housing Act 1996 Part VII', boost: 14.0, category: 'housing_tenancy' },
  { value: 'homelessness duty', boost: 12.0, category: 'housing_tenancy' },
  { value: 'priority need', boost: 14.0, category: 'housing_tenancy' },
  { value: 'intentional homelessness', boost: 14.0, category: 'housing_tenancy' },
  { value: 'local connection', boost: 12.0, category: 'housing_tenancy' },
  { value: 'suitability review under Section 202', boost: 15.0, category: 'housing_tenancy' },
  { value: 'temporary accommodation', boost: 12.0, category: 'housing_tenancy' },
  { value: 'tenancy deposit protection scheme', boost: 12.0, category: 'housing_tenancy' },
  { value: 'prescribed information', boost: 10.0, category: 'housing_tenancy' },
  { value: 'gas safety certificate', boost: 10.0, category: 'housing_tenancy' },
  { value: 'Energy Performance Certificate', boost: 10.0, category: 'housing_tenancy' },
  { value: 'How to rent guide', boost: 10.0, category: 'housing_tenancy' },
  { value: 'disrepair pre-action protocol', boost: 14.0, category: 'housing_tenancy' },
  { value: 'retaliatory eviction', boost: 12.0, category: 'housing_tenancy' },
  { value: 'illegal eviction and harassment', boost: 14.0, category: 'housing_tenancy' },
  { value: 'Rent Repayment Order', boost: 12.0, category: 'housing_tenancy' },
  { value: 'HMO licensing', boost: 12.0, category: 'housing_tenancy' },

  // ---------------------------------------------------------------------------
  // 3. Debt & Money Advice
  // ---------------------------------------------------------------------------
  { value: 'Debt Relief Order', boost: 15.0, category: 'debt_money' },
  { value: 'DRO approved intermediary', boost: 14.0, category: 'debt_money' },
  { value: 'DRO moratorium', boost: 15.0, category: 'debt_money' },
  { value: 'Standard Breathing Space', boost: 14.0, category: 'debt_money' },
  { value: 'Mental Health Crisis Moratorium', boost: 15.0, category: 'debt_money' },
  { value: 'Individual Voluntary Arrangement', boost: 12.0, category: 'debt_money' },
  { value: 'statutory debt repayment plan', boost: 12.0, category: 'debt_money' },
  { value: 'priority debt', boost: 14.0, category: 'debt_money' },
  { value: 'non-priority debt', boost: 14.0, category: 'debt_money' },
  { value: 'county court judgment', boost: 14.0, category: 'debt_money' },
  { value: 'CCJ', boost: 12.0, category: 'debt_money' },
  { value: 'attachment of earnings order', boost: 12.0, category: 'debt_money' },
  { value: 'charging order', boost: 12.0, category: 'debt_money' },
  { value: 'third party debt order', boost: 12.0, category: 'debt_money' },
  { value: 'statutory demand', boost: 12.0, category: 'debt_money' },
  { value: 'Taking Control of Goods', boost: 14.0, category: 'debt_money' },
  { value: 'enforcement agent', boost: 12.0, category: 'debt_money' },
  { value: 'controlled goods agreement', boost: 12.0, category: 'debt_money' },
  { value: 'Statute Barred debt', boost: 12.0, category: 'debt_money' },
  { value: 'Limitation Act 1980', boost: 12.0, category: 'debt_money' },
  { value: 'Standard Financial Statement', boost: 12.0, category: 'debt_money' },

  // ---------------------------------------------------------------------------
  // 4. Employment & Worker Rights
  // ---------------------------------------------------------------------------
  { value: 'constructive unfair dismissal', boost: 14.0, category: 'employment_rights' },
  { value: 'Acas early conciliation', boost: 15.0, category: 'employment_rights' },
  { value: 'Employment Tribunal', boost: 12.0, category: 'employment_rights' },
  { value: 'statutory redundancy pay', boost: 12.0, category: 'employment_rights' },
  { value: 'unlawful deduction from wages', boost: 12.0, category: 'employment_rights' },
  { value: 'Statutory Sick Pay', boost: 10.0, category: 'employment_rights' },
  { value: 'Statutory Maternity Pay', boost: 10.0, category: 'employment_rights' },
  { value: 'zero-hours contract', boost: 10.0, category: 'employment_rights' },

  // ---------------------------------------------------------------------------
  // 5. Immigration & Safeguarding
  // ---------------------------------------------------------------------------
  { value: 'no recourse to public funds', boost: 15.0, category: 'immigration_safeguarding' },
  { value: 'NRPF', boost: 14.0, category: 'immigration_safeguarding' },
  { value: 'change of conditions application', boost: 14.0, category: 'immigration_safeguarding' },
  { value: 'EUSS pre-settled status', boost: 14.0, category: 'immigration_safeguarding' },
  { value: 'EUSS settled status', boost: 14.0, category: 'immigration_safeguarding' },
  { value: 'derivative right to reside', boost: 14.0, category: 'immigration_safeguarding' },
  { value: 'MARAC referral', boost: 15.0, category: 'immigration_safeguarding' },
  { value: 'Independent Domestic Violence Adviser', boost: 14.0, category: 'immigration_safeguarding' },
  { value: 'IDVA', boost: 14.0, category: 'immigration_safeguarding' },
  { value: 'Destitution Domestic Violence Concession', boost: 15.0, category: 'immigration_safeguarding' },
  { value: 'Section 17 Children Act 1989', boost: 15.0, category: 'immigration_safeguarding' },
  { value: 'Care Act 2014 assessment', boost: 14.0, category: 'immigration_safeguarding' },

  // ---------------------------------------------------------------------------
  // 6. Courts, Tribunals & Governance
  // ---------------------------------------------------------------------------
  { value: 'First-tier Tribunal Social Entitlement Chamber', boost: 15.0, category: 'legal_tribunal' },
  { value: 'Upper Tribunal', boost: 12.0, category: 'legal_tribunal' },
  { value: 'HMCTS', boost: 12.0, category: 'legal_tribunal' },
  { value: 'AQS Level 3 Generalist Advice', boost: 14.0, category: 'legal_tribunal' },
  { value: 'Citizens Advice Wandsworth', boost: 14.0, category: 'legal_tribunal' },
  { value: 'Casebook', boost: 12.0, category: 'legal_tribunal' },
];

/**
 * Returns formatted Google Cloud Speech-to-Text v2 Adaptation PhraseSet object.
 */
export function buildCloudSttPhraseSet() {
  return {
    phrases: ADVICE_SECTOR_PHRASES.map((item) => ({
      value: item.value,
      boost: item.boost,
    })),
  };
}
