import { shardYear } from "./shard-year";

/**
 * The explorer's search index, built at prebuild (public/data/search-index.json)
 * so the search box never needs the whole dataset: every token of every
 * record's id, title and product names, with the records it occurs in. The
 * browser matches each query term as a substring of the tokens, as the old
 * substring search over titles did, and loads only the year shards that hold
 * a hit.
 */

export interface SearchIndex {
  version: 1;
  /** Record ids, grouped by shard year: ids[offsets[k]] .. ids[offsets[k + 1] - 1] belong to years[k]. */
  ids: string[];
  years: number[];
  offsets: number[];
  /** token -> ascending record positions in `ids`. */
  tokens: Record<string, number[]>;
}

export interface Searchable {
  id: string;
  title: string;
  products: readonly string[];
  first_reported: string;
}

/** Lower-cased words split on whitespace and most punctuation; hyphens, dots and underscores stay inside a token ("cve-2025-1234", "gpt-4o", "llama.cpp"). */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[\s,;:()[\]{}<>"'“”‘’`|\\/!?*]+/)) {
    const t = raw.replace(/^[^a-z0-9@#$]+|[^a-z0-9+]+$/g, "");
    if (t) out.push(t);
  }
  return out;
}

/** Query terms, the same way: a term matches a record when some token of it contains the term. */
export function queryTerms(q: string): string[] {
  return tokenize(q);
}

export function matchesTerms(tokens: readonly string[], terms: readonly string[]): boolean {
  return terms.every((term) => tokens.some((t) => t.includes(term)));
}

export function searchableText(r: Searchable): string {
  return `${r.id} ${r.title} ${r.products.join(" ")}`;
}

export function buildSearchIndex(records: readonly Searchable[]): SearchIndex {
  const byYear = new Map<number, Searchable[]>();
  for (const r of records) {
    const y = shardYear(r);
    const list = byYear.get(y);
    if (list) list.push(r);
    else byYear.set(y, [r]);
  }
  const years = [...byYear.keys()].sort((a, b) => b - a);
  const ids: string[] = [];
  const offsets: number[] = [];
  const tokens = new Map<string, number[]>();
  for (const y of years) {
    offsets.push(ids.length);
    for (const r of byYear.get(y)!) {
      const pos = ids.length;
      ids.push(r.id);
      for (const t of new Set(tokenize(searchableText(r)))) {
        const list = tokens.get(t);
        if (list) list.push(pos);
        else tokens.set(t, [pos]);
      }
    }
  }
  offsets.push(ids.length);
  return { version: 1, ids, years, offsets, tokens: Object.fromEntries([...tokens.entries()].sort(([a], [b]) => a.localeCompare(b))) };
}

function intersect(a: ReadonlySet<number>, b: ReadonlySet<number>): Set<number> {
  const out = new Set<number>();
  for (const p of a) if (b.has(p)) out.add(p);
  return out;
}

/** Positions of the records matching every term, or null for an empty query. */
export function searchIndex(index: SearchIndex, q: string): Set<number> | null {
  const terms = queryTerms(q);
  if (terms.length === 0) return null;
  let hits: Set<number> | undefined;
  for (const term of terms) {
    const found = new Set<number>();
    for (const [token, positions] of Object.entries(index.tokens)) {
      if (!token.includes(term)) continue;
      for (const p of positions) found.add(p);
    }
    hits = hits === undefined ? found : intersect(hits, found);
    if (hits.size === 0) break;
  }
  return hits ?? new Set();
}

/** The record ids at the given positions. */
export function hitIds(index: SearchIndex, hits: ReadonlySet<number>): Set<string> {
  return new Set([...hits].map((p) => index.ids[p]!));
}

/** The shard years that hold the given positions. */
export function hitYears(index: SearchIndex, hits: ReadonlySet<number>): number[] {
  const years = new Set<number>();
  for (const p of hits) {
    let k = 0;
    while (k + 1 < index.offsets.length && index.offsets[k + 1]! <= p) k += 1;
    years.add(index.years[k]!);
  }
  return [...years].sort((a, b) => b - a);
}
