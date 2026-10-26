import { isDisclosedIncident } from "./counting";
import { cveIds } from "./products";
import type { Incident, TimelineEntry } from "./schema";
import { ACTION_LANES, type Lane, type PatchStatus, type RecordState } from "./taxonomy";

/**
 * The lifecycle of a record: which lane it is in, whether it is live, what
 * its patch status is, and its timeline. The eleven lifecycle keys are
 * optional on disk (lib/schema.ts): a record the collector classified
 * carries them, an older record does not, and `withLifecycle` fills in the
 * missing ones from the record's other fields so the site, the migration
 * script and the collector agree on one answer. The rules are data here and
 * are rendered verbatim by the Methodology page.
 */

export const LIFECYCLE_KEYS = ["lane", "state", "closed_at", "patch_status", "cve_ids", "affected", "fixed_in", "timeline", "action", "severity_note", "cvss"] as const;
export type LifecycleKey = (typeof LIFECYCLE_KEYS)[number];

export interface Lifecycle {
  lane: Lane;
  state: RecordState;
  closed_at: string | null;
  patch_status: PatchStatus;
  cve_ids: string[];
  affected: string[];
  fixed_in: string[];
  timeline: TimelineEntry[];
  action: string;
  severity_note: string;
  cvss: number | null;
}

/** A record with every lifecycle key present: what the site renders and the public files carry. */
export type FullIncident = Incident & Lifecycle;

/**
 * How long a record stays live, in days. Patch and supply-chain records stay
 * live 14 days after their latest activity, or 60 days while a fix is still
 * missing or partial (an unknown fix status does not extend it). Breaches
 * stay live 14 days after their latest activity; a new report reopens them.
 * Research stays live 14 days after the first report; updates do not extend it.
 */
export const LIFECYCLE_RULES = {
  patch: { any_update_days: 14, unpatched_days: 60 },
  supply_chain: { any_update_days: 14, unpatched_days: 60 },
  breach: { any_update_days: 14 },
  research: { from_first_report_days: 14 },
} as const;

export interface LaneRule {
  id: string;
  lane: Lane;
  /** The rule in the words the Methodology page prints. */
  text: string;
  applies(i: Pick<Incident, "type" | "categories" | "severity">): boolean;
}

/**
 * Where a record without a stored lane belongs, in order: the first rule that
 * applies wins. Written for the AI records that predate lanes; a record
 * classified today carries its lane.
 */
export const LANE_RULES: readonly LaneRule[] = [
  { id: "research", lane: "research", text: "Severity 1 (research or proof of concept) → Research.", applies: (i) => i.severity === 1 },
  { id: "ai-weapon", lane: "breach", text: "An AI-enabled attack (AI was the attacker's tool) → Breaches & attacks.", applies: (i) => i.type === "ai_enabled_attack" },
  {
    id: "supply",
    lane: "supply_chain",
    text: "A primary category of supply chain or data poisoning → Supply chain.",
    applies: (i) => i.categories[0] === "supply_chain" || i.categories[0] === "data_poisoning",
  },
  {
    id: "leak",
    lane: "breach",
    text: "A data leak with confirmed exploitation or loss (severity 3 or 4) → Breaches & attacks.",
    applies: (i) => i.categories[0] === "data_leak" && i.severity >= 3,
  },
  { id: "patch", lane: "patch", text: "Everything else, a flaw in an AI system or tool → Patch now.", applies: () => true },
];

const DAY_MS = 86_400_000;

function dayNumber(iso: string): number {
  const d = iso.length >= 10 ? iso.slice(0, 10) : iso.length === 7 ? `${iso}-15` : `${iso}-07-01`;
  return Math.floor(Date.parse(`${d}T00:00:00Z`) / DAY_MS);
}

/** Whole days from `a` to `b` (negative when `b` is earlier). */
export function daysBetween(a: string, b: string): number {
  return dayNumber(b) - dayNumber(a);
}

export function addDays(iso: string, days: number): string {
  return new Date((dayNumber(iso) + days) * DAY_MS).toISOString().slice(0, 10);
}

type LaneInput = Pick<Incident, "type" | "categories" | "severity" | "lane">;

export function laneOf(i: LaneInput): Lane {
  if (i.lane) return i.lane;
  // a record with no AI role always carries its lane from classification; without one, a flaw is the safe reading
  if (i.type === "not_ai") return "patch";
  return (LANE_RULES.find((r) => r.applies(i)) ?? LANE_RULES[LANE_RULES.length - 1]!).lane;
}

export function isActionLane(lane: Lane): boolean {
  return (ACTION_LANES as readonly string[]).includes(lane);
}

export function patchStatusOf(i: LaneInput & Pick<Incident, "patch_status">): PatchStatus {
  if (i.patch_status) return i.patch_status;
  return laneOf(i) === "breach" ? "no_fix_needed" : "unknown";
}

/** The timeline a record carries, else one seeded from its sources: one entry per report, oldest first. */
export function timelineOf(i: Pick<Incident, "sources" | "created_at" | "timeline">): TimelineEntry[] {
  if (i.timeline) return [...i.timeline].sort((a, b) => a.date.localeCompare(b.date) || a.added_at.localeCompare(b.added_at));
  return [...i.sources]
    .sort((a, b) => a.published_at.localeCompare(b.published_at))
    .map((s) => ({ date: s.published_at, title: s.title.length > 240 ? `${s.title.slice(0, 239)}…` : s.title, source_url: s.url, added_at: i.created_at }));
}

/** The newest dated activity: a timeline entry, a source, or the first report. Never `updated_at`, which review edits bump. */
export function lastActivity(i: Pick<Incident, "sources" | "first_reported" | "created_at" | "timeline">): string {
  let last = i.first_reported;
  for (const s of i.sources) if (s.published_at > last) last = s.published_at;
  for (const t of timelineOf(i)) if (t.date > last) last = t.date;
  return last;
}

/** The live rule, as data in LIFECYCLE_RULES. `now` is an ISO day. */
export function isLiveByRule(lane: Lane, patch_status: PatchStatus, lastActivityDay: string, firstReported: string, now: string): boolean {
  if (lane === "research") return daysBetween(firstReported, now) <= LIFECYCLE_RULES.research.from_first_report_days;
  const since = daysBetween(lastActivityDay, now);
  const rules = LIFECYCLE_RULES[lane];
  if (since <= rules.any_update_days) return true;
  if ("unpatched_days" in rules && (patch_status === "unpatched" || patch_status === "partial")) return since <= rules.unpatched_days;
  return false;
}

type StateInput = Pick<Incident, "type" | "categories" | "severity" | "lane" | "patch_status" | "state" | "closed_at" | "sources" | "first_reported" | "created_at" | "timeline" | "origin">;

/**
 * Live or closed. A disclosed vulnerability is always closed; a record the
 * collector closed stays closed; anything else is judged by the rule at
 * build time, so a build can close a record but never reopens one against
 * its file (the collector's update pass does that when a report arrives).
 */
export function stateOf(i: StateInput, now: string): RecordState {
  if (isDisclosedIncident(i)) return "closed";
  if (i.state === "closed") return "closed";
  return isLiveByRule(laneOf(i), patchStatusOf(i), lastActivity(i), i.first_reported, now) ? "live" : "closed";
}

/** The day a closed record closed: as stored, else the day its live window ended. Null while live. */
export function closedAtOf(i: StateInput, now: string): string | null {
  if (i.state === "closed" && i.closed_at) return i.closed_at;
  if (stateOf(i, now) === "live") return null;
  if (isDisclosedIncident(i)) return i.first_reported;
  const lane = laneOf(i);
  if (lane === "research") return addDays(i.first_reported, LIFECYCLE_RULES.research.from_first_report_days);
  const rules = LIFECYCLE_RULES[lane];
  const ps = patchStatusOf(i);
  const window = "unpatched_days" in rules && (ps === "unpatched" || ps === "partial") ? rules.unpatched_days : rules.any_update_days;
  const end = addDays(lastActivity(i), window);
  return end < now ? end : now;
}

/** Whether a report dated `articleDate` makes a record live again. Research never reopens. */
export function shouldReopen(i: LaneInput, articleDate: string, now: string): boolean {
  const lane = laneOf(i);
  if (lane === "research") return false;
  return daysBetween(articleDate, now) <= LIFECYCLE_RULES[lane].any_update_days;
}

export function cveIdsOf(i: Pick<Incident, "tags" | "title" | "cve_ids">): string[] {
  return i.cve_ids ? [...i.cve_ids] : cveIds(i);
}

/** The group a live patch or supply-chain record is listed under. */
export type PatchGroup = "unpatched" | "partial" | "patched" | "other";
export function patchGroup(i: LaneInput & Pick<Incident, "patch_status">): PatchGroup {
  const ps = patchStatusOf(i);
  return ps === "unpatched" || ps === "partial" || ps === "patched" ? ps : "other";
}

export function deriveLifecycle(i: Incident, now: string): Lifecycle {
  return {
    lane: laneOf(i),
    state: stateOf(i, now),
    closed_at: closedAtOf(i, now),
    patch_status: patchStatusOf(i),
    cve_ids: cveIdsOf(i),
    affected: i.affected ? [...i.affected] : [],
    fixed_in: i.fixed_in ? [...i.fixed_in] : [],
    timeline: timelineOf(i),
    action: i.action ?? "",
    severity_note: i.severity_note ?? "",
    cvss: i.cvss ?? null,
  };
}

/** The record with every lifecycle key present. Idempotent for one `now`. */
export function withLifecycle(i: Incident, now: string): FullIncident {
  return { ...i, ...deriveLifecycle(i, now) };
}

export function isLive(i: Pick<FullIncident, "state">): boolean {
  return i.state === "live";
}
