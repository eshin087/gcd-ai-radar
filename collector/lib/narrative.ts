import type { BriefingNumbers, Incident } from "../../lib/schema";
import { NARRATIVE_WORDS } from "../llm/prompts";

/**
 * Checks on the briefing narrative a language model returns, beyond the JSON
 * shape. The site promises that every number on it is reproducible from the
 * data, so a narrative whose digits are not in the data (or in the records it
 * was written from) is sent back once with the complaint, then discarded.
 * Pure functions, unit-tested.
 */

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Integers a reader would take as counts: standalone digit runs. Skipped: CVE
 * ids and other identifiers (digits touching letters, "-" or "." on either
 * side, so CVE-2026-1234, GPT-4o, v0.6.3 and 2026-10-12 are not counts),
 * and four-digit years.
 */
export function standaloneNumbers(text: string): number[] {
  const out: number[] = [];
  // Thousands separators allowed; a full stop after the number ends a sentence, one before a digit makes it a version or decimal.
  const re = /(?<![\w.\-])\d+(?:,\d{3})*(?![\w\-]|[.,]\d)/g;
  for (const m of text.matchAll(re)) {
    const raw = m[0].replace(/,/g, "");
    if (/^(19|20)\d\d$/.test(raw)) continue;
    const n = Number(raw);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/** Every integer the narrative may legitimately mention: the computed numbers and whatever the records themselves say. */
export function allowedNumbers(numbers: BriefingNumbers, records: readonly Pick<Incident, "title" | "summary">[]): Set<number> {
  const allowed = new Set<number>([0, 1, 2, 3, 4, 7]); // severities, "1 source", "7 days"
  const c = numbers.counts;
  for (const n of [c.records, c.incidents, c.real_world, c.disclosed_vulnerabilities]) allowed.add(n);
  for (const n of Object.values(c.by_type)) allowed.add(n);
  for (const n of Object.values(c.by_family)) allowed.add(n);
  for (const n of Object.values(c.by_severity)) allowed.add(n);
  for (const n of [numbers.previous.incidents, numbers.previous.real_world, numbers.previous.disclosed_vulnerabilities]) allowed.add(n);
  for (const d of Object.values(numbers.deltas)) {
    allowed.add(Math.abs(d.change));
    if (d.pct !== null) allowed.add(Math.abs(Math.round(d.pct)));
  }
  if (numbers.busiest_family) allowed.add(numbers.busiest_family.count);
  for (const t of numbers.top_targets) allowed.add(t.count);
  for (const i of numbers.notable) allowed.add(i.source_count);
  for (const r of records) for (const n of standaloneNumbers(`${r.title} ${r.summary}`)) allowed.add(n);
  return allowed;
}

const SAME_AS_BEFORE = /\b(unchanged|matching|steady|flat|same (as|number|count|level))\b/i;
/** The site names itself in its own chrome; a narrative that does goes stale when the brand changes. */
const SELF_NAME = /\bgcd\s*ai\s*radar\b|\bobservatory\b/i;
const WRONG_PLURAL = /(?<![\d,.])\b1 (incidents|attacks|occurrences|listings|mentions|entries|vulnerabilities|sources|events|records|CVEs)\b/i;

/**
 * Problems with a narrative, in plain words the model can act on; empty when it passes.
 * With `numbers`, a claim that a count stayed the same is refused unless one actually did.
 */
export function narrativeProblems(text: string, allowed: Set<number>, numbers?: Pick<BriefingNumbers, "deltas">): string[] {
  const problems: string[] = [];
  const words = wordCount(text);
  if (words < NARRATIVE_WORDS.floor) problems.push(`the narrative has ${words} words; write at least ${NARRATIVE_WORDS.floor}`);
  if (words > NARRATIVE_WORDS.max + 40) problems.push(`the narrative has ${words} words; write at most ${NARRATIVE_WORDS.max}`);
  if (/https?:\/\/|www\./i.test(text)) problems.push("the narrative contains a link; write plain prose without links");
  if (/^\s*[#*>\-]|\*\*|\[[^\]]*\]\(/m.test(text)) problems.push("the narrative contains markdown; write plain prose");
  const strange = [...new Set(standaloneNumbers(text))].filter((n) => !allowed.has(n));
  if (strange.length) problems.push(`the narrative cites numbers that are not in the data: ${strange.join(", ")}; use only the counts given`);
  if (numbers && SAME_AS_BEFORE.test(text) && !Object.values(numbers.deltas).some((d) => d.change === 0)) {
    problems.push(`the narrative says a count stayed the same ("${text.match(SAME_AS_BEFORE)![0]}") but every count changed; use the comparison phrases as given`);
  }
  if (SELF_NAME.test(text)) problems.push("the narrative names the site; start with the week itself instead");
  const plural = text.match(WRONG_PLURAL);
  if (plural) problems.push(`"${plural[0]}" should be singular`);
  return problems;
}
