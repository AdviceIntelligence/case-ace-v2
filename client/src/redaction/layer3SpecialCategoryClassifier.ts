/**
 * @file layer3SpecialCategoryClassifier.ts
 * @description Layer 3 Contextual & Special Category Classifier under UK GDPR Article 9 & DPA 2018 Schedule 1.
 * 
 * Identifies sensitive and special category disclosures:
 * - Health conditions & mental health diagnoses
 * - Immigration status & asylum matters
 * - Criminal justice disclosures
 * - Domestic abuse disclosures & refuge stays
 * - Child protection matters
 * - Sexual orientation, religion, ethnicity, trade union membership
 * - Safeguarding & immediate risk to life
 * 
 * Generates transparent consequence explanations for adviser decision-making.
 * Defaults to tokenising identifying elements while retaining clinical/legal substance.
 */

import type { RawCandidate } from './layer1StructuredMatcher.ts';
import type { DecisionConsequences } from '../state/volatileStore.ts';

export interface SpecialCategoryMatch extends RawCandidate {
  decisionConsequences: DecisionConsequences;
}

interface PatternRule {
  category: SpecialCategoryMatch['category'];
  prefix: string;
  regex: RegExp;
  retentionRisk: string;
  redactionImpact: string;
}

const SPECIAL_CATEGORY_RULES: PatternRule[] = [
  // 1. Health & Mental Health Diagnoses
  {
    category: 'special_category_mental_health',
    prefix: 'MENTAL_HEALTH_DIAGNOSIS',
    regex: /\b(?:paranoid schizophrenia|schizophrenia|bipolar disorder|severe depression|psychosis|post-traumatic stress disorder|PTSD|sectioned under (?:the )?Mental Health Act|section 2|section 3|psychiatric hospitalisation|suicidal ideation|personality disorder|ADHD|autism spectrum disorder|Asperger's)\b/gi,
    retentionRisk: 'Transmits Article 9 special category health data to external model. Permissible under DPA 2018 Sch 1 advice condition if necessary.',
    redactionImpact: 'Removing diagnosis prevents drafting accurate PIP / ESA mandatory reconsiderations and vulnerability adjustments.',
  },
  {
    category: 'special_category_health',
    prefix: 'HEALTH_CONDITION',
    regex: /\b(?:fibromyalgia|stage \d+ cancer|carcinoma|chronic fatigue syndrome|multiple sclerosis|epilepsy|diabetes type \d+|angina|heart failure|stroke|rheumatoid arthritis|COPD|cerebral palsy|terminal illness)\b/gi,
    retentionRisk: 'Contains special category medical data under UK GDPR Art 9.',
    redactionImpact: 'Crucial clinical substance for disability benefits, concessionary housing, and welfare rights casework.',
  },

  // 2. Immigration Status & Asylum
  {
    category: 'special_category_immigration',
    prefix: 'IMMIGRATION_STATUS',
    regex: /\b(?:asylum seeker|refugee status|indefinite leave to remain|ILR|no recourse to public funds|NRPF|Section 95 asylum support|deportation order|human rights claim under Article 8|spousal visa|undocumented migrant|pre-settled status|settled status|immigration bail|destitution domestic violence concession)\b/gi,
    retentionRisk: 'Immigration history involves sensitive nationality and statutory entitlement data.',
    redactionImpact: 'Immigration status dictates statutory entitlement to Universal Credit, legal aid, and council housing.',
  },

  // 3. Domestic Abuse & Violence Disclosures
  {
    category: 'special_category_domestic_abuse',
    prefix: 'DOMESTIC_ABUSE_DISCLOSURE',
    regex: /\b(?:fleeing domestic (?:violence|abuse)|coercive control|non-molestation order|occupation order|MARAC referral|MARAC|staying in (?:a )?refuge|domestic violence injunction|police domestic abuse incident|DAPN|DAPO|honour-based violence|forced marriage)\b/gi,
    retentionRisk: 'High-risk safeguarding disclosures involving violence or risk to personal safety.',
    redactionImpact: 'Essential evidence to establish priority housing need and Universal Credit domestic abuse easement exemption.',
  },

  // 4. Criminal Justice Involvement
  {
    category: 'special_category_criminal_justice',
    prefix: 'CRIMINAL_JUSTICE',
    regex: /\b(?:released on licence|probation order|community order|spent conviction|unspent conviction|arrested for|custodial sentence|HMP \w+|prison sentence|tagging order|criminal record)\b/gi,
    retentionRisk: 'UK GDPR Article 10 criminal convictions data requiring strict processing grounds.',
    redactionImpact: 'Relevant for tenancy succession, employment checks, and rehabilitation assessment.',
  },

  // 5. Child Protection & Safeguarding
  {
    category: 'special_category_child_protection',
    prefix: 'CHILD_PROTECTION',
    regex: /\b(?:Section 47 child protection|Section 17 child in need|child protection plan|child protection conference|interim care order|social services intervention with children|child in need plan|CIN plan|children's social care)\b/gi,
    retentionRisk: 'Sensitive child safeguarding information requiring elevated duty of confidentiality.',
    redactionImpact: 'Fundamental to safeguarding advocacy and council family support assessments.',
  },

  // 6. Protected Characteristics (Sexual Orientation, Religion, Ethnicity, Trade Union)
  {
    category: 'special_category_sexual_orientation',
    prefix: 'SEXUAL_ORIENTATION',
    regex: /\b(?:gay|lesbian|bisexual|transgender|trans woman|trans man|heterosexual|homosexual)\b/gi,
    retentionRisk: 'Special category sexual orientation data under Article 9.',
    redactionImpact: 'Only required if pertinent to discrimination or asylum claims; otherwise safe to tokenise.',
  },
  {
    category: 'special_category_religion',
    prefix: 'RELIGION',
    regex: /\b(?:practicing Muslim|Christian|Jewish community|Sikh|Hindu|Buddhist|Catholic|Protestant|mosque|synagogue|church|temple congregation)\b/gi,
    retentionRisk: 'Special category religious belief data under Article 9.',
    redactionImpact: 'Only retain if related to faith-based housing, dietary needs, or Equality Act discrimination.',
  },
  {
    category: 'special_category_trade_union',
    prefix: 'TRADE_UNION',
    regex: /\b(?:Unison member|Unite member|RMT member|GMB member|trade union rep|union branch secretary)\b/gi,
    retentionRisk: 'Article 9 trade union membership data.',
    redactionImpact: 'Relevant for employment tribunal representation.',
  },

  // 7. Safeguarding & Immediate Risk to Life
  {
    category: 'safeguarding_risk_to_life',
    prefix: 'RISK_TO_LIFE',
    regex: /\b(?:threatened to kill|immediate threat to life|active suicide plan|attempted suicide|severe self-harm|risk of serious harm|safeguarding emergency)\b/gi,
    retentionRisk: 'Critical safeguarding alert. Disclosing to external AI may breach confidential crisis safety protocols.',
    redactionImpact: 'Adviser must take immediate external safeguarding action in accordance with CAW Safeguarding Policy.',
  },
];

/**
 * Executes Layer 3 Special Category & Contextual Classification.
 */
export function matchLayer3SpecialCategories(transcript: string): SpecialCategoryMatch[] {
  const matches: SpecialCategoryMatch[] = [];

  for (const rule of SPECIAL_CATEGORY_RULES) {
    let match: RegExpExecArray | null;
    while ((match = rule.regex.exec(transcript)) !== null) {
      matches.push({
        category: rule.category,
        text: match[0],
        charStart: match.index,
        charEnd: match.index + match[0].length,
        confidence: 0.95,
        surrogatePrefix: rule.prefix,
        decisionConsequences: {
          retentionRisk: rule.retentionRisk,
          redactionImpact: rule.redactionImpact,
          recommendedDefault: 'retain_clinical_substance',
        },
      });
    }
  }

  return matches;
}
