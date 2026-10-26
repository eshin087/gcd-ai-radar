/**
 * One-time CVSS backfill: every published record that carries CVE ids and
 * no `cvss` gets the highest CVSS 3.1 or 4.0 base score among its CVEs.
 * Writes `cvss` only (lib/schema.ts, one decimal); `updated_at` and every
 * other key stay as they are. Idempotent: a second run finds no candidate
 * and writes nothing.
 *
 *   npx tsx scripts/backfill-cvss.ts --dry-run    look everything up, print the report, write no shard
 *   npx tsx scripts/backfill-cvss.ts              as above, then write data/incidents/<year>.json
 *   npx tsx scripts/backfill-cvss.ts --skip-nvd   GitHub Advisory Database only (quick look)
 *   npx tsx scripts/backfill-cvss.ts --limit=N    at most N network calls this run (resume later)
 *
 * Lookup order, per CVE id: the GitHub Advisory Database by cve_id
 * (GITHUB_TOKEN, else `gh auth token`; CC BY 4.0, thousands of calls an
 * hour), then the NVD CVE API 2.0 for the ids GitHub has no score for, one
 * `cveId=` request each, spaced 6.5 s without NVD_API_KEY (5 per rolling
 * 30 s) or 0.7 s with it. Every answer is cached in
 * collector/.cache/cvss-lookups.json (gitignored), so a rerun, or the real
 * run after a dry run, makes no call it already made.
 *
 * Procedure (docs/operations.md, as for the lane migration): pause the cron
 * (gh workflow disable collect.yml), run, `npm run validate`, commit the
 * shards on the branch, merge, re-enable the cron the same day.
 */
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { HttpError, httpJson, sleep } from "../collector/lib/http";
import { loadState, saveState } from "../collector/lib/state";
import type { Advisory } from "../collector/sources/ghsa";
import { IncidentSchema, type Incident } from "../lib/schema";

const USER_AGENT = "gcd-ai-radar/0.1 (+https://github.com/eshin087/gcd-ai-radar; CVSS backfill)";
const GHSA_SPACING_MS = 150;
const NVD_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0";
export const CACHE_FILE = path.join(process.cwd(), "collector", ".cache", "cvss-lookups.json");

// ---------------------------------------------------------------------------
// Score picking (pure, tested on recorded payloads)

/** A GitHub advisory as the REST API returns it: `cvss` is the legacy field, `cvss_severities` carries v3 and v4 side by side. */
export interface AdvisoryWithScores extends Advisory {
  cvss_severities?: {
    cvss_v3?: { vector_string?: string | null; score?: number | null } | null;
    cvss_v4?: { vector_string?: string | null; score?: number | null } | null;
  } | null;
}

export interface NvdMetric {
  source?: string;
  type?: string;
  cvssData?: { version?: string; vectorString?: string; baseScore?: number; baseSeverity?: string };
}

export interface NvdResponse {
  totalResults?: number;
  vulnerabilities?: { cve: { id: string; vulnStatus?: string; metrics?: Record<string, NvdMetric[] | undefined> } }[];
}

/** CVSS base scores are published with one decimal; the schema takes 0..10. */
export function roundScore(n: number): number {
  return Math.round(n * 10) / 10;
}

/** 0.0 is a real base score (no impact at all); only a score without a vector string is a placeholder, which the readers below drop. */
function validScore(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 10;
}

/** The highest valid score among the candidates, or null when none. */
export function pickScore(scores: readonly (number | null | undefined)[]): number | null {
  const valid = scores.filter(validScore);
  return valid.length ? roundScore(Math.max(...valid)) : null;
}

/**
 * The advisory's highest base score among CVSS v3 and v4. GitHub reports an
 * absent v4 as `{ vector_string: null, score: 0 }`, so a score without a
 * vector string does not count; the legacy `cvss.score` is the fallback.
 */
export function scoreFromAdvisory(adv: AdvisoryWithScores | null | undefined): number | null {
  if (!adv) return null;
  const sev = adv.cvss_severities;
  const scored = (m: { vector_string?: string | null; score?: number | null } | null | undefined) => (m?.vector_string ? m.score : null);
  return pickScore([scored(sev?.cvss_v3), scored(sev?.cvss_v4), adv.cvss?.vector_string ? adv.cvss.score : null]);
}

/** The highest CVSS 3.1 or 4.0 base score in an NVD `cveId=` answer (every metric source, primary or secondary). */
export function scoreFromNvd(data: NvdResponse | null | undefined): number | null {
  const cve = data?.vulnerabilities?.[0]?.cve;
  if (!cve?.metrics) return null;
  const scores: (number | undefined)[] = [];
  for (const key of ["cvssMetricV40", "cvssMetricV31"]) {
    for (const m of cve.metrics[key] ?? []) if (m.cvssData?.vectorString) scores.push(m.cvssData.baseScore);
  }
  return pickScore(scores);
}

// ---------------------------------------------------------------------------
// Applying scores to records (pure)

export interface FillReport {
  records: number;
  with_cves: number;
  candidates: number;
  filled: number;
  /** Records with CVE ids and no score from either source. */
  unscored: string[];
  by_source: { ghsa: number; nvd: number; both: number };
}

export type ScoreTable = Map<string, { ghsa: number | null; nvd: number | null }>;

/** True for a record the backfill should look at: CVE ids present, `cvss` empty. */
export function isCandidate(i: Incident): boolean {
  return (i.cve_ids?.length ?? 0) > 0 && (i.cvss === null || i.cvss === undefined);
}

/** Writes `cvss` into every candidate whose CVEs have a score; nothing else changes. */
export function fillRecords(incidents: Incident[], scores: ScoreTable): FillReport {
  const report: FillReport = { records: incidents.length, with_cves: 0, candidates: 0, filled: 0, unscored: [], by_source: { ghsa: 0, nvd: 0, both: 0 } };
  for (const i of incidents) {
    if ((i.cve_ids?.length ?? 0) > 0) report.with_cves += 1;
    if (!isCandidate(i)) continue;
    report.candidates += 1;
    const ghsa: number[] = [];
    const nvd: number[] = [];
    for (const id of i.cve_ids ?? []) {
      const s = scores.get(id);
      if (validScore(s?.ghsa)) ghsa.push(s.ghsa);
      if (validScore(s?.nvd)) nvd.push(s.nvd);
    }
    const score = pickScore([...ghsa, ...nvd]);
    if (score === null) {
      report.unscored.push(i.id);
      continue;
    }
    i.cvss = score;
    const check = IncidentSchema.safeParse(i);
    if (!check.success) throw new Error(`${i.id} does not validate with cvss ${score}: ${check.error.issues[0]?.message}`);
    report.filled += 1;
    if (ghsa.length && nvd.length) report.by_source.both += 1;
    else if (ghsa.length) report.by_source.ghsa += 1;
    else report.by_source.nvd += 1;
  }
  return report;
}

// ---------------------------------------------------------------------------
// Lookups with a scratch cache

interface CacheEntry {
  at: string;
  /** False when the source had no record for the id at all. */
  found: boolean;
  score: number | null;
}
interface Cache {
  ghsa: Record<string, CacheEntry>;
  nvd: Record<string, CacheEntry>;
}

async function loadCache(file: string): Promise<Cache> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as Partial<Cache>;
    return { ghsa: parsed.ghsa ?? {}, nvd: parsed.nvd ?? {} };
  } catch {
    return { ghsa: {}, nvd: {} };
  }
}

async function saveCache(file: string, cache: Cache): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const sorted = (r: Record<string, CacheEntry>) => Object.fromEntries(Object.entries(r).sort(([a], [b]) => a.localeCompare(b)));
  await fs.writeFile(file, JSON.stringify({ ghsa: sorted(cache.ghsa), nvd: sorted(cache.nvd) }, null, 1) + "\n");
}

/** GITHUB_TOKEN, else the gh CLI's token; never printed. */
function githubToken(): string | null {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    const t = execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return t || null;
  } catch {
    return null;
  }
}

async function fetchGhsa(cve: string, token: string | null): Promise<CacheEntry> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
  const url = `https://api.github.com/advisories?cve_id=${encodeURIComponent(cve)}&per_page=1`;
  const list = await httpJson<AdvisoryWithScores[]>(url, { userAgent: USER_AGENT, timeoutMs: 20_000, retries: 2, headers, maxBytes: 2_000_000 });
  const adv = Array.isArray(list) && list.length ? list[0]! : null;
  return { at: new Date().toISOString(), found: adv !== null, score: scoreFromAdvisory(adv) };
}

async function fetchNvd(cve: string, apiKey: string | undefined): Promise<CacheEntry> {
  const url = `${NVD_URL}?cveId=${encodeURIComponent(cve)}`;
  const headers: Record<string, string> = apiKey ? { apiKey } : {};
  let data: NvdResponse;
  try {
    data = await httpJson<NvdResponse>(url, { userAgent: USER_AGENT, timeoutMs: 40_000, retries: 2, backoffMs: 7_000, headers, maxBytes: 5_000_000 });
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return { at: new Date().toISOString(), found: false, score: null };
    throw err;
  }
  const found = (data.vulnerabilities?.length ?? 0) > 0;
  return { at: new Date().toISOString(), found, score: scoreFromNvd(data) };
}

export interface RunOptions {
  dryRun: boolean;
  skipNvd: boolean;
  limit: number;
  cacheFile: string;
}

export interface RunReport extends FillReport {
  cves: number;
  calls: { ghsa: number; nvd: number };
  errors: string[];
  wrote: string[];
}

export async function run(opts: RunOptions): Promise<RunReport> {
  const state = await loadState();
  const cache = await loadCache(opts.cacheFile);
  const candidates = state.incidents.filter(isCandidate);
  const cves = [...new Set(candidates.flatMap((i) => i.cve_ids ?? []))].sort();
  const calls = { ghsa: 0, nvd: 0 };
  const errors: string[] = [];
  let budget = opts.limit;
  let sinceSave = 0;
  const persist = async (force = false) => {
    sinceSave += 1;
    if (force || sinceSave >= 25) {
      await saveCache(opts.cacheFile, cache);
      sinceSave = 0;
    }
  };

  // 1. GitHub Advisory Database
  const token = githubToken();
  if (!token) console.warn("no GITHUB_TOKEN and no gh token: GitHub lookups run unauthenticated (60 an hour)");
  const ghsaTodo = cves.filter((id) => !cache.ghsa[id]);
  console.log(`${candidates.length} candidate records, ${cves.length} CVE ids, ${cves.length - ghsaTodo.length} already in the cache`);
  for (const id of ghsaTodo) {
    if (budget <= 0) break;
    budget -= 1;
    if (calls.ghsa > 0) await sleep(GHSA_SPACING_MS);
    calls.ghsa += 1;
    try {
      cache.ghsa[id] = await fetchGhsa(id, token);
    } catch (err) {
      errors.push(`ghsa ${id}: ${(err as Error).message.slice(0, 160)}`);
      if (err instanceof HttpError && (err.status === 401 || err.status === 403 || err.status === 429)) break;
      continue;
    }
    await persist();
  }
  await persist(true);

  // 2. NVD for the ids GitHub has no score for
  const nvdTodo = cves.filter((id) => cache.ghsa[id] && cache.ghsa[id]!.score === null && !cache.nvd[id]);
  if (opts.skipNvd) {
    console.log(`skipping NVD for ${nvdTodo.length} CVE ids (--skip-nvd)`);
  } else {
    const apiKey = process.env.NVD_API_KEY;
    const spacing = apiKey ? 700 : 6500;
    const planned = Math.min(nvdTodo.length, Math.max(budget, 0));
    if (planned) console.log(`NVD: ${planned} lookups at ${spacing / 1000} s each, about ${Math.ceil((planned * spacing) / 60_000)} min`);
    for (const id of nvdTodo) {
      if (budget <= 0) break;
      budget -= 1;
      if (calls.nvd > 0) await sleep(spacing);
      calls.nvd += 1;
      try {
        cache.nvd[id] = await fetchNvd(id, apiKey);
      } catch (err) {
        errors.push(`nvd ${id}: ${(err as Error).message.slice(0, 160)}`);
        continue;
      }
      await persist();
      if (calls.nvd % 50 === 0) console.log(`  nvd ${calls.nvd}/${planned}`);
    }
    await persist(true);
  }

  // 3. Apply
  const scores: ScoreTable = new Map();
  for (const id of cves) scores.set(id, { ghsa: cache.ghsa[id]?.score ?? null, nvd: cache.nvd[id]?.score ?? null });
  const fill = fillRecords(state.incidents, scores);
  const pending = cves.filter((id) => !cache.ghsa[id] || (cache.ghsa[id]!.score === null && !cache.nvd[id])).length;
  const report: RunReport = { ...fill, cves: cves.length, calls, errors, wrote: [] };

  console.log(`records ${fill.records}, with CVE ids ${fill.with_cves}, candidates ${fill.candidates}`);
  console.log(`  filled:        ${fill.filled} (GitHub ${fill.by_source.ghsa}, NVD ${fill.by_source.nvd}, both ${fill.by_source.both})`);
  console.log(`  no score:      ${fill.unscored.length}${pending ? ` (${pending} CVE ids not looked up everywhere yet)` : ""}`);
  console.log(`  calls:         GitHub ${calls.ghsa}, NVD ${calls.nvd}`);
  if (errors.length) console.log(`  errors:        ${errors.length}\n    ${errors.slice(0, 10).join("\n    ")}`);
  if (fill.unscored.length) console.log(`  unscored ids:  ${fill.unscored.slice(0, 20).join(", ")}${fill.unscored.length > 20 ? ", …" : ""}`);
  if (opts.dryRun) {
    console.log("dry run: nothing written (the lookup cache is kept)");
    return report;
  }
  if (pending || errors.length) {
    console.log("some CVE ids are still unresolved: writing what is known; rerun to pick up the rest");
  }
  report.wrote = await saveState(state);
  const unexpected = report.wrote.filter((f) => !f.startsWith("incidents/"));
  console.log(report.wrote.length ? `wrote ${report.wrote.join(", ")}` : "nothing to write");
  if (unexpected.length) console.warn(`note: files other than the shards changed too: ${unexpected.join(", ")} (the backfill commit should hold the shards only)`);
  return report;
}

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/backfill-cvss.ts");
if (invokedDirectly) {
  const limit = arg("limit") ? Number(arg("limit")) : Number.POSITIVE_INFINITY;
  if (Number.isNaN(limit) || limit < 0) throw new Error("--limit needs a non-negative number");
  run({ dryRun: process.argv.includes("--dry-run"), skipNvd: process.argv.includes("--skip-nvd"), limit, cacheFile: CACHE_FILE }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
