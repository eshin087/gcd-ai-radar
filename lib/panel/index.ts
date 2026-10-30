import type { FullIncident } from "../lifecycle";
import type { HomeStats, KevStatEntry, StatsFiles } from "../stats-schema";
import { addDays } from "../lifecycle";
import { buildActNow, buildLatest, type ActNow, type LatestRow } from "./act";
import { buildAiFlow, type AiFlow } from "./ai-flow";
import { buildAttackTypes, weekIncidents, type AttackTypeRow } from "./attack-types";
import { bandOf, levelOf, ratioLevel, type Band, type Level } from "./levels";
import { buildStack, stackMatches, type StackCandidate, type StackFile, type StackMatch } from "./stack";
import { buildSurface, type SurfaceRow } from "./technology";
import { DAY_MS } from "./util";

/**
 * The home page's instrument panel (components/home/panel), built once at
 * build time beside lib/home.ts's counters, from the same files. Prebuild
 * writes it as public/stats/panel.json for scripts/check-home.mjs and the
 * stack candidates as public/stats/stack.json for the browser.
 *
 * The verdict: the day's level is the higher of two. New CVEs: the last 24
 * hours against the thirteen 24-hour windows before it (lib/panel/levels.ts),
 * every window counted back from when NVD was fetched so none is partial.
 * Known exploited: KEV additions in the 7 days against every 7-day window of
 * the 36 months before.
 *
 * The sieve: the week from everything published to what touches the
 * visitor. Published and critical (CVSS 9 or more) are lib/home.ts's 7-day
 * counters; a typical week is this year's NVD total over the days elapsed
 * when it was counted, times seven (busy above 1.25 of it, quiet below 0.75).
 * Known exploited is the 7-day KEV counter. In your stack is those KEV
 * additions that belong to the picks (lib/panel/stack.ts), recomputed in the
 * browser when the picks change.
 */

export const CVE_WINDOWS = 14;
export const KEV_HISTORY_MONTHS = 36;

export interface Verdict {
  level: Level;
  cves24: number | null;
  cvesLevel: Level;
  /** The 24-hour band, for the browser to judge a live count by. */
  cvesBand: Band | null;
  kev7: number | null;
  kevLevel: Level;
  noFullPatch: number;
  inStack: number;
  aiWeek: number;
  incidentsWeek: number;
}

export interface Sieve {
  published: number | null;
  publishedLevel: Level;
  typicalWeek: number | null;
  critical: number | null;
  exploited: number | null;
  exploitedLevel: Level;
  /** The KEV additions behind `exploited`, newest first: the stage's list, inline (a week is a handful). */
  exploitedEntries: KevStatEntry[];
  /** The default stack's matches; the browser recomputes them for the visitor's picks. */
  inStack: StackMatch[];
  nvdFetched: string | null;
}

export interface PanelData {
  verdict: Verdict;
  stack: { tiles: StackCandidate[]; default: string[] };
  act: ActNow;
  latest: LatestRow[];
  types: AttackTypeRow[];
  surface: SurfaceRow[];
  ai: AiFlow;
  sieve: Sieve;
}

/** CVEs per 24-hour window counted back from `endMs`, oldest first; the last window is the 24 hours before endMs. */
export function cveWindows(published: readonly string[], endMs: number, windows = CVE_WINDOWS): number[] {
  const out = new Array<number>(windows).fill(0);
  for (const p of published) {
    const t = Date.parse(p);
    if (t > endMs) continue;
    const k = Math.floor((endMs - t) / DAY_MS);
    if (k < windows) out[windows - 1 - k]! += 1;
  }
  return out;
}

/** KEV additions in every 7-day window ending on each day of the history, and in the 7 days ending today. */
export function kevWeekHistory(added: readonly string[], today: string, months = KEV_HISTORY_MONTHS): { now: number; history: number[] } {
  const perDay = new Map<string, number>();
  for (const a of added) perDay.set(a, (perDay.get(a) ?? 0) + 1);
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const day = (k: number) => new Date(todayMs - k * DAY_MS).toISOString().slice(0, 10);
  const week = (endK: number) => {
    let s = 0;
    for (let k = endK; k < endK + 7; k++) s += perDay.get(day(k)) ?? 0;
    return s;
  };
  const span = Math.round(months * 30.4);
  const history: number[] = [];
  for (let endK = 7; endK + 7 <= span; endK++) history.push(week(endK));
  return { now: week(0), history };
}

export function buildPanel(incidents: readonly FullIncident[], stats: StatsFiles, home: HomeStats, now: Date): { panel: PanelData; stackFile: StackFile } {
  const nowIso = now.toISOString();
  const today = nowIso.slice(0, 10);
  const kev = stats.kev?.entries ?? [];
  const c = home.counters;

  const stackFile = buildStack(incidents, kev, today, nowIso);
  const act = buildActNow(incidents, kev, today);
  const week = weekIncidents(incidents, today);
  const ai = buildAiFlow(week, incidents, kev, today);

  // the levels
  let cvesBand: Band | null = null;
  let cvesLevel: Level = 1;
  if (stats.cvesRecent) {
    const end = Math.min(now.getTime(), Date.parse(stats.cvesRecent.fetched_at));
    const w = cveWindows(
      stats.cvesRecent.cves.map((x) => x.published),
      end,
    );
    cvesBand = bandOf(w.slice(0, -1));
    cvesLevel = levelOf(c.cves_24h ?? w[w.length - 1]!, cvesBand);
  }
  let kevLevel: Level = 1;
  if (stats.kev) {
    const k = kevWeekHistory(
      kev.map((e) => e.added),
      today,
    );
    kevLevel = levelOf(c.kev_7d ?? k.now, bandOf(k.history));
  }

  // the sieve's typical week, from the year's NVD total when it was counted
  let typicalWeek: number | null = null;
  const nvd = stats.nvdCounts;
  if (nvd) {
    const fetched = nvd.fetched_at.slice(0, 10);
    const year = Number(fetched.slice(0, 4));
    const total = nvd.years.find((y) => y.year === year)?.total;
    const elapsed = (Date.parse(`${fetched}T00:00:00Z`) - Date.parse(`${year}-01-01T00:00:00Z`)) / DAY_MS + 1;
    if (total && elapsed >= 14) typicalWeek = Math.round((total / elapsed) * 7);
  }

  const inStack = stackMatches(stackFile, stackFile.default);
  const panel: PanelData = {
    verdict: {
      level: Math.max(cvesLevel, kevLevel) as Level,
      cves24: c.cves_24h,
      cvesLevel,
      cvesBand,
      kev7: c.kev_7d,
      kevLevel,
      noFullPatch: act.noFullPatch,
      inStack: inStack.length,
      aiWeek: ai.target.n + ai.weapon.n,
      incidentsWeek: ai.total,
    },
    stack: { tiles: stackFile.default.map((k) => stackFile.candidates.find((x) => x.key === k)!), default: stackFile.default },
    act,
    latest: buildLatest(incidents, nowIso),
    types: buildAttackTypes(week).filter((t) => t.key !== "other" || t.n > 0),
    surface: buildSurface(kev, today),
    ai,
    sieve: {
      published: c.cves_7d,
      publishedLevel: c.cves_7d === null ? 1 : ratioLevel(c.cves_7d, typicalWeek),
      typicalWeek,
      critical: c.critical_7d,
      exploited: c.kev_7d,
      exploitedLevel: kevLevel,
      exploitedEntries: kev.filter((e) => e.added > addDays(today, -7) && e.added <= today).sort((a, b) => b.added.localeCompare(a.added) || a.cve.localeCompare(b.cve)),
      inStack,
      nvdFetched: stats.cvesRecent?.fetched_at ?? null,
    },
  };
  return { panel, stackFile };
}

export { LEVEL_WORDS } from "./levels";
export type { Level } from "./levels";
export type { StackCandidate, StackFile, StackMatch } from "./stack";
export type { ActRow, LatestRow } from "./act";
export type { AttackTypeRow } from "./attack-types";
export type { SurfaceRow } from "./technology";
export type { AiFlow, FlowRole } from "./ai-flow";
