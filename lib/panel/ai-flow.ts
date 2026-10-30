import { addDays, type FullIncident } from "../lifecycle";
import { CATEGORY_META, TARGET_META, type Category, type Target } from "../taxonomy";
import { techOf } from "./technology";
import type { KevStatEntry } from "../stats-schema";
import { recordCves } from "./util";

/**
 * How AI shows up: the week's incidents (lib/panel/attack-types.ts
 * weekIncidents: first reported in the 7 days up to today, every lane, no
 * disclosed CVEs) by the role AI played. AI is the target when the record's
 * type is attack_on_ai, the weapon when it is ai_enabled_attack; the rest had
 * no AI role. Each role names its three most frequent techniques (category
 * keys, leaving out other, general and infra_vuln, which say nothing about the
 * technique) and one case: the highest severity, then the most sources, then
 * the newest. The weak link counts what the flow leaves out: CVE ids named by
 * AI records first reported in the 7 days, disclosed or exploited, and the
 * products of the AI-stack entries CISA listed this year.
 *
 * Never a share over time: the dataset tracked AI incidents only until
 * 19 Oct 2026, so an AI share trend would chart the collector, not the world.
 */

export const FLOW_TECHNIQUES = 3;
const SKIP: ReadonlySet<Category> = new Set<Category>(["other", "general", "infra_vuln"]);

export interface FlowCount {
  key: string;
  label: string;
  n: number;
}

export interface FlowRole {
  n: number;
  techniques: FlowCount[];
  /** The two targets hit most (TARGET_META labels, "n/a" left out). */
  targets: FlowCount[];
  case: { title: string; slug: string } | null;
}

export interface AiFlow {
  total: number;
  target: FlowRole;
  weapon: FlowRole;
  none: number;
  weak: {
    /** Distinct CVE ids named by AI records first reported in the 7 days. */
    cves: number;
    /** Of them, named by a record of severity 3 or more. */
    exploited: number;
    /** AI-stack products CISA listed as exploited since 1 January, alphabetical. */
    kevProducts: string[];
    kevYear: number;
  };
}

function techLabel(key: Category): string {
  // "AI intrusion" keeps its capitals; the rest read as plain words
  return CATEGORY_META[key].short.replace("Prompt inj.", "prompt injection").replace(/^(?!AI\b)(\w)/, (c) => c.toLowerCase());
}

function topTechniques(records: readonly FullIncident[]): FlowCount[] {
  const c = new Map<Category, number>();
  for (const r of records) for (const k of new Set(r.categories)) if (!SKIP.has(k)) c.set(k, (c.get(k) ?? 0) + 1);
  return [...c]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, FLOW_TECHNIQUES)
    .map(([key, n]) => ({ key, label: techLabel(key), n }));
}

function topTargets(records: readonly FullIncident[]): FlowCount[] {
  const c = new Map<Target, number>();
  for (const r of records) for (const t of new Set(r.targets)) if (t !== "n/a") c.set(t, (c.get(t) ?? 0) + 1);
  return [...c]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 2)
    .map(([key, n]) => ({ key, label: TARGET_META[key].label, n }));
}

export function pickCase(records: readonly FullIncident[]): { title: string; slug: string } | null {
  const best = [...records].sort(
    (a, b) => b.severity - a.severity || b.source_count - a.source_count || b.first_reported.localeCompare(a.first_reported) || b.created_at.localeCompare(a.created_at),
  )[0];
  return best ? { title: best.title, slug: best.slug } : null;
}

function role(records: readonly FullIncident[]): FlowRole {
  return { n: records.length, techniques: topTechniques(records), targets: topTargets(records), case: pickCase(records) };
}

export function buildAiFlow(week: readonly FullIncident[], all: readonly FullIncident[], kev: readonly KevStatEntry[], today: string): AiFlow {
  const target = week.filter((i) => i.type === "attack_on_ai");
  const weapon = week.filter((i) => i.type === "ai_enabled_attack");
  const from = addDays(today, -7);
  const cves = new Set<string>();
  const exploited = new Set<string>();
  for (const i of all) {
    if (i.type === "not_ai" || i.first_reported <= from || i.first_reported > today) continue;
    for (const c of recordCves(i)) {
      cves.add(c);
      if (i.severity >= 3) exploited.add(c);
    }
  }
  const yearFrom = `${today.slice(0, 4)}-01-01`;
  const kevAi = kev.filter((e) => e.added >= yearFrom && e.added <= today && techOf(e) === "AI stack");
  return {
    total: week.length,
    target: role(target),
    weapon: role(weapon),
    none: week.length - target.length - weapon.length,
    weak: { cves: cves.size, exploited: exploited.size, kevProducts: [...new Set(kevAi.map((e) => e.product.trim()))].sort((a, b) => a.localeCompare(b)), kevYear: kevAi.length },
  };
}
