import { isDisclosedIncident } from "../counting";
import { addDays, type FullIncident } from "../lifecycle";
import type { Category } from "../taxonomy";

/**
 * Attack types: the week's incidents by what kind of attack they were, every
 * lane, AI or not. Keyword rules over the title, summary, tags and products;
 * the first rule that matches wins, in this order: ransomware and extortion,
 * supply chain, espionage and state actors, phishing/fraud/deepfakes, malware
 * and botnets, attacks on AI models and agents (an attack on AI whose category
 * is an AI technique), data breaches and leaks, exploited vulnerabilities,
 * other. Disclosed CVEs without exploitation are not incidents and are left
 * out (lib/counting.ts). The AI column counts the incidents whose AI role is
 * target or weapon. A classifier field can replace the rules later; they stay
 * as its fallback.
 */

export const TYPES_DAYS = 7;

export type AttackType = "ransomware" | "supply" | "espionage" | "fraud" | "malware" | "ai" | "breach" | "vuln" | "other";

export const ATTACK_TYPE_LABELS: Record<AttackType, string> = {
  vuln: "Exploited vulnerabilities",
  ai: "Attacks on AI models & agents",
  breach: "Data breaches & leaks",
  supply: "Supply chain",
  fraud: "Phishing, fraud & deepfakes",
  ransomware: "Ransomware & extortion",
  espionage: "Espionage & state actors",
  malware: "Malware & botnets",
  other: "Other",
};

const AI_TECHNIQUES: ReadonlySet<Category> = new Set<Category>(["prompt_injection", "jailbreak", "agent_hijack", "model_theft_extraction", "adversarial_evasion", "data_poisoning"]);

const RX = {
  ransomware: /ransomware|extortion|leak site|lockbit|akira|qilin|clop|black ?basta/,
  supply: /supply[- ]chain|malicious (npm|pypi|package|extension|crate|gem)|typosquat|compromised (package|library|extension|update|script)|hijack\w* .{0,30}script|dependency/,
  espionage: /\bapt\s?\d*\b|espionage|state[- ](sponsored|backed)|nation[- ]state|china[- ](nexus|linked)|russia[- ]linked|north korea|lazarus|typhoon|kimsuky|sandworm|turla|storm-\d+|unc\d+|uat-\d+/,
  fraud: /phish|scam|fraud|deepfake|social[- ]engineering|\bbec\b|impersonat|vishing|smishing|fake (desktop|app|site)/,
  malware: /malware|botnet|infostealer|stealer|trojan|backdoor|\brat\b|loader|cryptominer|wiper|\bworm\b/,
  breach: /breach|leak|exposed|stolen|data theft|exfiltrat|pii|passport/,
  vuln: /vulnerab|cve-\d|exploit|zero[- ]day|\bflaw|\brce\b|code execution|privilege escalation|bypass/,
};

type TypeInput = Pick<FullIncident, "title" | "summary" | "tags" | "products" | "categories" | "type" | "lane">;

export function attackType(i: TypeInput): AttackType {
  const t = [i.title, i.summary, ...i.tags, ...i.products].join(" ").toLowerCase();
  if (RX.ransomware.test(t)) return "ransomware";
  if (RX.supply.test(t)) return "supply";
  if (RX.espionage.test(t)) return "espionage";
  if (RX.fraud.test(t)) return "fraud";
  if (RX.malware.test(t)) return "malware";
  if (i.type === "attack_on_ai" && i.categories.some((c) => AI_TECHNIQUES.has(c))) return "ai";
  if (i.lane === "breach" && !RX.vuln.test(t)) return "breach";
  // "exposed appliances" is not a breach: a patch-lane record with vulnerability words is a vulnerability
  if (i.lane === "patch" && RX.vuln.test(t)) return "vuln";
  if (RX.breach.test(t)) return "breach";
  if (RX.vuln.test(t) || i.lane === "patch") return "vuln";
  return i.lane === "breach" ? "breach" : "other";
}

export interface AttackTypeRow {
  key: AttackType;
  label: string;
  n: number;
  /** Of them, incidents where AI was the target or the weapon. */
  ai: number;
}

/** The incidents first reported in the 7 days up to today (no disclosed CVEs), counted by type, most first; Other last. */
export function weekIncidents(incidents: readonly FullIncident[], today: string): FullIncident[] {
  const from = addDays(today, -TYPES_DAYS);
  return incidents.filter((i) => i.first_reported > from && i.first_reported <= today && !isDisclosedIncident(i));
}

export function buildAttackTypes(week: readonly FullIncident[]): AttackTypeRow[] {
  const rows = new Map<AttackType, AttackTypeRow>();
  for (const i of week) {
    const key = attackType(i);
    const r = rows.get(key) ?? { key, label: ATTACK_TYPE_LABELS[key], n: 0, ai: 0 };
    r.n += 1;
    if (i.type !== "not_ai") r.ai += 1;
    rows.set(key, r);
  }
  return [...rows.values()].sort((a, b) => (a.key === "other" ? 1 : b.key === "other" ? -1 : b.n - a.n || a.label.localeCompare(b.label)));
}
