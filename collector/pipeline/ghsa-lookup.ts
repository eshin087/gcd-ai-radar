import { withLifecycle } from "../../lib/lifecycle";
import { IncidentSchema, type Incident } from "../../lib/schema";
import type { Settings } from "../lib/config";
import { httpFetch } from "../lib/http";
import { errorMessage, log } from "../lib/log";
import type { CollectorState } from "../lib/state";
import type { Advisory } from "../sources/ghsa";
import { cleanVersionList } from "./publish";

/**
 * Version data for live patch and supply-chain records that carry a CVE id
 * and no fixed version yet: one GitHub Advisory Database lookup per CVE
 * (`GET /advisories?cve_id=<id>&per_page=1`, CC BY 4.0, GITHUB_TOKEN when
 * set), at most settings.ghsa_lookup.per_run per run. A CVE with no advisory
 * is remembered in collector-state.json and asked again after recheck_days.
 * No record is created here; only affected, fixed_in, patch_status and cvss
 * are filled where the record has none.
 */

export type AdvisoryFetcher = (cve: string) => Promise<Advisory | null>;

export interface LookupOutcome {
  looked_up: number;
  enriched: string[];
  errors: string[];
}

export async function fetchAdvisoryByCve(cve: string, settings: Settings): Promise<Advisory | null> {
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
  const url = `https://api.github.com/advisories?cve_id=${encodeURIComponent(cve)}&per_page=1`;
  const res = await httpFetch(url, { userAgent: settings.fetch.user_agent, timeoutMs: settings.fetch.timeout_ms, retries: 1, headers });
  const list = JSON.parse(res.body) as Advisory[];
  return Array.isArray(list) && list.length ? list[0]! : null;
}

/** Applies an advisory's version data to a record where the record has none. Returns true when something changed. */
export function applyAdvisoryVersions(i: Incident, adv: Advisory, now: string): boolean {
  const full = withLifecycle(i, now.slice(0, 10));
  const affected: string[] = [];
  const fixed: string[] = [];
  for (const v of adv.vulnerabilities ?? []) {
    const pkg = v.package?.name;
    if (!pkg) continue;
    if (v.vulnerable_version_range) affected.push(`${pkg} ${v.vulnerable_version_range}`);
    if (v.first_patched_version) fixed.push(`${pkg} ${v.first_patched_version}`);
  }
  let changed = false;
  if (full.affected.length === 0 && affected.length) {
    full.affected = cleanVersionList(affected);
    changed = true;
  }
  if (full.fixed_in.length === 0 && fixed.length) {
    full.fixed_in = cleanVersionList(fixed);
    changed = true;
  }
  if (full.patch_status === "unknown" && (adv.vulnerabilities?.length ?? 0) > 0) {
    full.patch_status = fixed.length ? "patched" : "unpatched";
    changed = true;
  }
  if (full.cvss === null && typeof adv.cvss?.score === "number") {
    full.cvss = adv.cvss.score;
    changed = true;
  }
  if (!changed) return false;
  full.updated_at = now;
  const check = IncidentSchema.safeParse(full);
  if (!check.success) return false;
  Object.assign(i, check.data);
  return true;
}

/** Records that want a lookup: live, in a lane with a fix, with a CVE id and no fixed version. */
export function lookupCandidates(records: Incident[], cache: CollectorState, settings: Settings, now: string): { record: Incident; cve: string }[] {
  const day = now.slice(0, 10);
  const recheckMs = settings.ghsa_lookup.recheck_days * 86_400_000;
  const out: { record: Incident; cve: string }[] = [];
  for (const i of records) {
    const full = withLifecycle(i, day);
    if (full.state !== "live" || (full.lane !== "patch" && full.lane !== "supply_chain")) continue;
    if (full.fixed_in.length || full.cve_ids.length === 0) continue;
    const cve = full.cve_ids.find((id) => {
      const prev = cache.cve_lookups[id];
      if (!prev) return true;
      if (prev.found) return false; // looked up and applied already (or the record had the data); ask no more
      return Date.parse(now) - Date.parse(prev.at) >= recheckMs;
    });
    if (cve) out.push({ record: i, cve });
    if (out.length >= settings.ghsa_lookup.per_run) break;
  }
  return out;
}

export async function enrichVersions(
  records: Incident[],
  cache: CollectorState,
  settings: Settings,
  now: string,
  fetcher: AdvisoryFetcher = (cve) => fetchAdvisoryByCve(cve, settings),
): Promise<LookupOutcome> {
  const out: LookupOutcome = { looked_up: 0, enriched: [], errors: [] };
  if (settings.ghsa_lookup.per_run === 0) return out;
  for (const { record, cve } of lookupCandidates(records, cache, settings, now)) {
    out.looked_up += 1;
    let adv: Advisory | null;
    try {
      adv = await fetcher(cve);
    } catch (err) {
      out.errors.push(`ghsa lookup ${cve}: ${errorMessage(err).slice(0, 160)}`);
      log.warn(`ghsa lookup ${cve} failed`, { error: errorMessage(err).slice(0, 120) });
      break; // rate limit or outage: the rest wait for the next run
    }
    cache.cve_lookups[cve] = { at: now, found: adv !== null };
    if (adv && applyAdvisoryVersions(record, adv, now)) {
      out.enriched.push(record.id);
      log.info(`versions from GitHub advisory ${adv.ghsa_id} for ${record.id}`, { cve });
    }
  }
  return out;
}
