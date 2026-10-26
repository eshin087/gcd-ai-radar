/**
 * The curation bar for records with no AI role, in the words the Methodology
 * page prints and the classifier prompt carries. A general incident is
 * published only when every rule holds; AI records keep the AI inclusion
 * rule (lib/taxonomy.ts TYPE_META) and use these as advice.
 */
export const CURATION_RULES: readonly string[] = [
  "It names the software, service or organisation affected.",
  "It says what happened or what the flaw allows.",
  "It is one of: exploitation in the wild, a critical rating with a fix or no fix stated, a confirmed breach or outage, or a malicious artefact with named reach.",
  "A follow-up to a known event becomes an update on that record, never a new one.",
  "Surveys, policy, product launches, roundups, opinion and \"report finds\" pieces are not incidents.",
];
