/**
 * The browser's half of My stack (lib/panel/stack.ts holds the rules): the
 * shapes of public/stats/stack.json, where the picks are stored, and the two
 * steps the page runs on them. No dataset imports, so the page's script stays
 * small.
 */

export const STACK_STORAGE_KEY = "gcd-radar:stack";
export const STACK_FILE = "/stats/stack.json";
export const STACK_MAX = 12;
export const STACK_DAYS = 90;

export interface StackMatch {
  name: string;
  cve: string;
  due: string | null;
}

/** What a tile's number is made of: one KEV entry, or one of our exploited records that no KEV entry already stands for. */
export interface StackItem {
  kind: "kev" | "record";
  /** The KEV entry's product, or the record's title. */
  name: string;
  /** Its CVE ids, if any. */
  cves: string[];
  /** The day CISA listed it, or the record's first report. */
  date: string;
  /** The CISA deadline, for a KEV entry that has one. */
  due: string | null;
  cvss: number | null;
  /** Why it is still open, the tile's red reasons item by item; null once it is not. */
  open: "due" | "unpatched" | "partial" | "loss" | null;
  /** Our record when one names the CVE, else NVD. */
  href: string;
  external: boolean;
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
  /** KEV entries CISA added in the 7 days that belong to it: the hero's "hit your stack this week" number. */
  kev7: StackMatch[];
  /** Where the tile's drawer points on: the family's product page, or CISA's catalog searched for the vendor. */
  href: string;
  /** Every item behind `n`, open ones first, then newest first. Only in /stats/stack.json; the page's tiles leave it out. */
  items?: StackItem[];
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

/** What the picks' items cover: every CVE id and record link, each with the labels of the picks that hold it, for marking the ledger's rows. */
export interface StackHits {
  cves: Map<string, string[]>;
  hrefs: Map<string, string[]>;
}

export function stackHits(file: Pick<StackFile, "candidates">, picks: readonly string[]): StackHits {
  const hits: StackHits = { cves: new Map(), hrefs: new Map() };
  const add = (m: Map<string, string[]>, key: string, label: string) => {
    const labels = m.get(key) ?? [];
    if (!labels.includes(label)) labels.push(label);
    m.set(key, labels);
  };
  for (const k of picks) {
    const c = file.candidates.find((x) => x.key === k);
    for (const it of c?.items ?? []) {
      for (const cve of it.cves) add(hits.cves, cve, c!.label);
      add(hits.hrefs, it.href, c!.label);
    }
  }
  return hits;
}

/** The picks a row belongs to, by its CVE ids or its link, in pick order, each once. */
export function rowStack(hits: StackHits, row: { cves?: readonly string[]; href?: string }): string[] {
  const out: string[] = [];
  for (const cve of row.cves ?? []) for (const l of hits.cves.get(cve) ?? []) if (!out.includes(l)) out.push(l);
  if (row.href) for (const l of hits.hrefs.get(row.href) ?? []) if (!out.includes(l)) out.push(l);
  return out;
}

/** Picks from a URL or storage: known keys only, in order, no repeats, at most STACK_MAX. */
export function parsePicks(raw: string | null | undefined, known: ReadonlySet<string>): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const k of raw.split(",").map((s) => s.trim().toLowerCase())) if (known.has(k) && !out.includes(k) && out.length < STACK_MAX) out.push(k);
  return out;
}
