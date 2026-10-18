import { distance } from "fastest-levenshtein";

/** Text helpers for pre-filtering and title similarity. Dependency-light and unit-tested. */

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "in", "on", "at", "to", "for", "by", "with", "from", "as", "is",
  "are", "was", "were", "be", "been", "this", "that", "these", "those", "it", "its", "into", "via", "new",
  "how", "why", "what", "after", "over", "amid", "says", "say", "said", "report", "reports", "reportedly",
  "could", "can", "may", "might", "will", "would", "has", "have", "had", "about", "than", "then", "now",
  "your", "you", "their", "they", "them", "our", "we", "us", "up", "out", "off", "not", "no", "yes",
]);

/** Common " - Publisher" / " | Publisher" suffixes and leading labels. */
export function stripPublisherSuffix(title: string): string {
  let t = title.trim();
  t = t.replace(/\s+[-–—|]\s+[^-–—|]{2,40}$/u, "");
  t = t.replace(/^(breaking|exclusive|update[d]?|opinion|analysis|explainer)\s*:\s*/i, "");
  return t.trim();
}

export function normalizeTitle(title: string): string {
  return stripPublisherSuffix(title)
    .toLowerCase()
    .replace(/[’'`"“”]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const SUFFIXES = ["ations", "ation", "ings", "ing", "ions", "ion", "ers", "er", "edly", "ed", "ly", "es", "s", "e"];

/** Tiny suffix stripper so "remotely/remote", "execution/execute", "attackers/attack" compare equal. */
export function stem(word: string): string {
  let w = word;
  if (w.length >= 6 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  for (let guard = 0; guard < 3; guard++) {
    let changed = false;
    for (const s of SUFFIXES) {
      if (w.endsWith(s) && w.length - s.length >= 4) {
        w = w.slice(0, -s.length);
        changed = true;
        break;
      }
    }
    if (!changed) break;
  }
  return w;
}

export function tokens(title: string): string[] {
  return normalizeTitle(title)
    .split(" ")
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
    .map(stem);
}

/** Sørensen–Dice coefficient over token sets. */
export function dice(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter += 1;
  return (2 * inter) / (sa.size + sb.size);
}

/** 1 − normalized Levenshtein distance. */
export function levRatio(a: string, b: string): number {
  if (!a.length && !b.length) return 1;
  const max = Math.max(a.length, b.length);
  return 1 - distance(a, b) / max;
}

/** Combined similarity in [0,1] used by the dedupe stage. */
export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  return 0.6 * dice(tokens(a), tokens(b)) + 0.4 * levRatio(na, nb);
}

export function sharedTokens(a: string[], b: string[]): number {
  const sb = new Set(b);
  let n = 0;
  for (const t of new Set(a)) if (sb.has(t)) n += 1;
  return n;
}

const CVE_RE = /\bCVE-\d{4}-\d{4,7}\b/gi;

export function extractCves(text: string): string[] {
  const found = text.match(CVE_RE) ?? [];
  return [...new Set(found.map((c) => c.toUpperCase()))];
}

const ADVISORY_LEAD_RE = /^(CVE-\d{4}-\d{4,7}|GHSA(?:-[0-9a-z]{4}){3})\s*:/i;
const ADVISORY_URL_RE = /(?:nvd\.nist\.gov\/vuln\/detail\/|[?&]field_cve=)(CVE-\d{4}-\d{4,7})\b/i;

/**
 * The CVE id an advisory link is about, or null when the link is not an
 * advisory. NVD and KEV links carry the id in the URL; the NVD, GHSA and KEV
 * adapters title their candidates "<own id>: summary". Any other id in such a
 * title is a reference ("incomplete fix of CVE-…") and is not returned. A
 * GHSA advisory without a CVE of its own returns [].
 */
export function advisoryCves(link: { url: string; title: string }): string[] | null {
  const fromUrl = link.url.match(ADVISORY_URL_RE);
  if (fromUrl) return [fromUrl[1]!.toUpperCase()];
  const lead = link.title.match(ADVISORY_LEAD_RE);
  if (!lead) return null;
  const id = lead[1]!.toUpperCase();
  return id.startsWith("CVE-") ? [id] : [];
}

/**
 * CVE ids for a structured seed record (ATLAS, AVID): the ids of the
 * advisories it cites (NVD/KEV links). Ids that only appear in prose or in
 * other reference links (a vendor blog listing five CVEs) are left out.
 */
export function seedCves(refs: { url: string; title: string }[]): string[] {
  return [...new Set(refs.flatMap((r) => advisoryCves(r) ?? []))];
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Builds a case-insensitive matcher for a list of terms. Terms are matched as
 * whole words/phrases: no letter or digit may touch either end, so "ai"
 * matches "AI-powered" but not "aid" or "Thai", and "cve-" matches "CVE-2026-1".
 */
export function buildMatcher(terms: string[]): RegExp {
  const alts = terms
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((t) => {
      const lead = /^[a-z0-9]/.test(t) ? "(?<![a-z0-9])" : "";
      const trail = /[a-z0-9]$/.test(t) ? "(?![a-z0-9])" : "";
      return `${lead}${escapeRe(t).replace(/\s+/g, "\\s+")}${trail}`;
    });
  if (alts.length === 0) return /$^/;
  return new RegExp(`(?:${alts.join("|")})`, "i");
}

export function matchedTerms(text: string, terms: string[]): string[] {
  const hits: string[] = [];
  for (const t of terms) {
    if (buildMatcher([t]).test(text)) hits.push(t);
  }
  return hits;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " ",
  "&#8217;": "’", "&#8216;": "‘", "&#8220;": "“", "&#8221;": "”", "&#8211;": "–", "&#8212;": "—", "&hellip;": "…", "&#8230;": "…",
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&[a-z]+;|&#\d+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m);
}

export function stripHtml(s: string): string {
  return decodeEntities(
    s
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}
