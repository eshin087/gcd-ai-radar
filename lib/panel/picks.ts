/**
 * The browser's half of My stack (lib/panel/stack.ts holds the rules): the
 * shapes of public/stats/stack.json, where the picks are stored, and the two
 * steps the page runs on them. No dataset imports, so the page's script stays
 * small.
 */

export const STACK_STORAGE_KEY = "gcd-radar:stack";
export const STACK_FILE = "/stats/stack.json";
export const STACK_MAX = 12;

export interface StackMatch {
  name: string;
  cve: string;
  due: string | null;
}

export interface StackCandidate {
  key: string;
  label: string;
  kind: "vendor" | "ai";
  /** Exploited in the 90 days. */
  n: number;
  /** The red flag's words, or null. */
  flag: string | null;
  /** Every reason it is red, for the tooltip. */
  why: string[];
  /** KEV entries CISA added in the 7 days that belong to it: the sieve's last stage. */
  kev7: StackMatch[];
  href: string;
}

export interface StackFile {
  generated_at: string;
  default: string[];
  candidates: StackCandidate[];
}

/** The KEV additions of the 7 days that belong to any of the picks, once each, nearest deadline first. */
export function stackMatches(file: Pick<StackFile, "candidates">, picks: readonly string[]): StackMatch[] {
  const out = new Map<string, StackMatch>();
  for (const k of picks) for (const m of file.candidates.find((c) => c.key === k)?.kev7 ?? []) if (!out.has(m.cve)) out.set(m.cve, m);
  return [...out.values()].sort((a, b) => (a.due ?? "9").localeCompare(b.due ?? "9") || a.cve.localeCompare(b.cve));
}

/** Picks from a URL or storage: known keys only, in order, no repeats, at most STACK_MAX. */
export function parsePicks(raw: string | null | undefined, known: ReadonlySet<string>): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const k of raw.split(",").map((s) => s.trim().toLowerCase())) if (known.has(k) && !out.includes(k) && out.length < STACK_MAX) out.push(k);
  return out;
}
