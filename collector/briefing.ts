import { promises as fs } from "node:fs";
import path from "node:path";
import { briefingNumbers, briefingRecords, briefingSummaryLine, isoWeekLabel, parseIsoWeek, previousIsoWeek, rankNotable, shiftIsoWeek, splitWeek } from "../lib/briefing";
import { aiLens } from "../lib/counting";
import { FAMILY_META } from "../lib/families";
import { BriefingIndexSchema, BriefingSchema, type Briefing, type BriefingIndex, type BriefingNumbers, type Incident } from "../lib/schema";
import { TARGET_META } from "../lib/taxonomy";
import { loadConfig } from "./lib/config";
import { errorMessage, log } from "./lib/log";
import { allowedNumbers, narrativeProblems } from "./lib/narrative";
import { DATA_DIR, loadState, type State } from "./lib/state";
import { briefingPrompt, NARRATIVE_DISCLOSED_CAP, NARRATIVE_INCIDENT_CAP } from "./llm/prompts";
import { callsToday, LlmRouter } from "./llm/router";
import { BRIEFING_NARRATIVE_JSON_SCHEMA, BriefingNarrativeOutputSchema } from "./llm/schemas";
import { NoProviderAvailable } from "./llm/types";

/**
 * "This week in AI security": one briefing per ISO week, written on Monday
 * for the week that ended on Sunday. The numbers come from lib/briefing.ts
 * and the published records alone; the narrative is asked of the classifier
 * LLM from those records and checked (collector/lib/narrative.ts) before it
 * is kept. Without a usable model the briefing is still written, with the
 * numbers and the list and a note saying there is no narrative.
 *
 * A briefing is a snapshot: records first reported in that week but
 * collected later are not added to it. The dashboard, which recounts from
 * the data on every build, may therefore show more for the same week.
 */

export const BRIEFINGS_DIR = path.join(DATA_DIR, "briefings");
export const BRIEFING_INDEX_FILE = "index.json";

export interface BriefingRunOptions {
  /** A specific week ("2026-W42"); default is the week before the one containing `now`. */
  week?: string;
  /** Also write the N−1 weeks before the target that are missing (backfill and catch-up). */
  weeks?: number;
  /** Rewrite briefings that already exist. */
  force: boolean;
  dryRun: boolean;
  now?: Date;
}

export interface BriefingRunSummary {
  written: Briefing[];
  skipped: string[];
  /** Weeks whose narrative could not be written (the briefing was still saved). */
  withoutNarrative: string[];
  llm: Record<string, { calls: number; prompt_tokens: number; completion_tokens: number }>;
}

export function briefingFile(week: string): string {
  return path.join(BRIEFINGS_DIR, `${week}.json`);
}

/** The weeks a run should consider, oldest first. */
export function targetWeeks(opts: Pick<BriefingRunOptions, "week" | "weeks">, now: Date): string[] {
  const last = opts.week ?? previousIsoWeek(now);
  if (!parseIsoWeek(last)) throw new Error(`not an ISO week: "${last}" (expected YYYY-Www, e.g. 2026-W42)`);
  const n = Math.max(1, Math.floor(opts.weeks ?? 1));
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(shiftIsoWeek(last, -i));
  return out;
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

export async function readBriefings(dir = BRIEFINGS_DIR): Promise<Briefing[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: Briefing[] = [];
  for (const name of names) {
    if (!/^\d{4}-W\d{2}\.json$/.test(name)) continue;
    out.push(BriefingSchema.parse(JSON.parse(await fs.readFile(path.join(dir, name), "utf8"))));
  }
  return out.sort((a, b) => b.week.localeCompare(a.week));
}

export function buildIndex(briefings: readonly Briefing[], generatedAt: string): BriefingIndex {
  return {
    generated_at: generatedAt,
    briefings: [...briefings]
      .sort((a, b) => b.week.localeCompare(a.week))
      .map((b) => ({
        week: b.week,
        start: b.start,
        end: b.end,
        generated_at: b.generated_at,
        incidents: b.counts.incidents,
        real_world: b.counts.real_world,
        disclosed_vulnerabilities: b.counts.disclosed_vulnerabilities,
        headline: b.narrative?.headline ?? null,
        file: `briefings/${b.week}.json`,
      })),
  };
}

interface NarrativeOutcome {
  narrative: Briefing["narrative"];
  note?: string;
}

/**
 * Asks the router for the narrative, validates the JSON, then checks length,
 * links and numbers; one retry carries the complaints back. Returns null
 * narrative with a note when no provider can serve the call or both attempts
 * fail the checks: the briefing is published without it rather than with a
 * text that cannot be trusted.
 */
export async function writeNarrative(numbers: BriefingNumbers, incidents: Incident[], disclosed: Incident[], router: LlmRouter): Promise<NarrativeOutcome> {
  if (numbers.counts.records === 0) return { narrative: null, note: "No records were first reported this week, so there is nothing to narrate." };
  if (!router.configured) return { narrative: null, note: "No language model key was configured when this briefing was generated; the numbers and the list stand on their own." };
  const ranked = rankNotable(incidents).slice(0, NARRATIVE_INCIDENT_CAP);
  const vulns = rankNotable(disclosed).slice(0, NARRATIVE_DISCLOSED_CAP);
  const prompt = briefingPrompt({ numbers, incidents: ranked, disclosed: vulns });
  const allowed = allowedNumbers(numbers, [...ranked, ...vulns]);
  let feedback = "";
  let lastProblem = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { parsed, provider, model } = await router.completeJson({
        system: prompt.system,
        user: feedback ? `${prompt.user}\n\n${feedback}` : prompt.user,
        schemaName: "weekly_briefing",
        jsonSchema: BRIEFING_NARRATIVE_JSON_SCHEMA,
        temperature: 0.3,
        maxOutputTokens: 2048,
      });
      const check = BriefingNarrativeOutputSchema.safeParse(parsed);
      if (!check.success) {
        lastProblem = check.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        feedback = `Your previous response failed validation: ${lastProblem}. Return the JSON again, following the rules exactly.`;
        continue;
      }
      const text = check.data.narrative.replace(/\s+\n/g, "\n").trim();
      const headline = check.data.headline.trim().replace(/[.\s]+$/, "");
      const problems = narrativeProblems(text, allowed, numbers);
      if (problems.length) {
        lastProblem = problems.join("; ");
        log.warn(`briefing ${numbers.week}: narrative rejected`, { attempt: attempt + 1, problems: lastProblem });
        feedback = `Your previous narrative was rejected: ${lastProblem}. Write it again, following the rules exactly.`;
        continue;
      }
      return { narrative: { headline, text, provider, model, generated_at: new Date().toISOString() } };
    } catch (err) {
      if (err instanceof NoProviderAvailable) {
        log.warn(`briefing ${numbers.week}: no language model available`, { error: err.message.slice(0, 200) });
        return { narrative: null, note: "No language model was available when this briefing was generated; the numbers and the list stand on their own." };
      }
      lastProblem = errorMessage(err).slice(0, 200);
      feedback = `Your previous response was not valid JSON (${lastProblem}). Return only the JSON object.`;
    }
  }
  return { narrative: null, note: `The language model's narrative failed validation twice (${lastProblem.slice(0, 160)}) and was discarded; the numbers and the list stand on their own.` };
}

function lastRun(state: State): string | null {
  let last: string | null = null;
  for (const r of state.runs) if (r.mode !== "dry-run" && (!last || r.finished_at > last)) last = r.finished_at;
  return last;
}

export function briefingMarkdown(b: Briefing): string {
  const lines = [
    `### briefing ${b.week} (${b.start} to ${b.end})`,
    "",
    briefingSummaryLine(b),
    b.busiest_family ? `Busiest family: ${FAMILY_META[b.busiest_family.family].label} (${b.busiest_family.count}).` : "",
    b.top_targets.length ? `Most-listed targets: ${b.top_targets.map((t) => `${TARGET_META[t.target].label} (${t.count})`).join(", ")}.` : "",
    "",
    ...b.notable.map((i) => `- severity ${i.severity} · ${i.title} (${i.source_count} source${i.source_count === 1 ? "" : "s"})`),
    "",
    b.narrative ? `**${b.narrative.headline}**\n\n${b.narrative.text}\n\n_Narrative by ${b.narrative.model}._` : "",
    ...b.notes.map((n) => `> ${n}`),
  ];
  return lines.filter((l, i, arr) => l !== "" || arr[i - 1] !== "").join("\n");
}

export async function runBriefing(opts: BriefingRunOptions): Promise<BriefingRunSummary> {
  const settings = loadConfig().settings;
  const state = await loadState();
  const now = opts.now ?? new Date();
  const weeks = targetWeeks(opts, now);
  const published = state.incidents.filter((i) => i.status === "published");
  const summary: BriefingRunSummary = { written: [], skipped: [], withoutNarrative: [], llm: {} };
  const router = new LlmRouter(settings.providers, callsToday(state.runs, settings.providers, now));
  for (const line of router.describe()) log.info(`llm: ${line}`);
  // the briefing is the AI week: its dataset line counts the AI records it was computed from
  const ai = aiLens(published);
  const dataset = { records: ai.length, incidents: splitWeek(ai).incidents.length, last_collector_run: lastRun(state) };

  for (const week of weeks) {
    const file = briefingFile(week);
    if (!opts.force && (await exists(file))) {
      log.info(`briefing ${week}: already written, skipping (use --force to rewrite)`);
      summary.skipped.push(week);
      continue;
    }
    const numbers = briefingNumbers(published, week);
    const { incidents, disclosed } = splitWeek(briefingRecords(published, week));
    log.info(`briefing ${week} (${numbers.start} to ${numbers.end}): ${briefingSummaryLine(numbers)}`);
    const { narrative, note } = await writeNarrative(numbers, incidents, disclosed, router);
    const briefing: Briefing = BriefingSchema.parse({
      ...numbers,
      generated_at: new Date().toISOString(),
      narrative,
      notes: note ? [note] : [],
      dataset,
    });
    if (!narrative) summary.withoutNarrative.push(week);
    if (opts.dryRun) {
      log.info(`dry run: not writing ${path.relative(process.cwd(), file)}`);
      console.log(briefingMarkdown(briefing));
    } else {
      await fs.mkdir(BRIEFINGS_DIR, { recursive: true });
      await fs.writeFile(file, JSON.stringify(briefing, null, 2) + "\n");
      log.info(`wrote ${path.relative(process.cwd(), file)}`, { narrative: narrative ? narrative.model : "none" });
    }
    summary.written.push(briefing);
  }

  if (summary.written.length && !opts.dryRun) {
    const index = buildIndex(await readBriefings(), new Date().toISOString());
    await fs.writeFile(path.join(BRIEFINGS_DIR, BRIEFING_INDEX_FILE), JSON.stringify(BriefingIndexSchema.parse(index), null, 2) + "\n");
  }
  summary.llm = router.usage;
  return summary;
}

/** "data: briefing 2026-W42" or "data: briefings 2026-W35..2026-W42 (8)". */
export function briefingCommitMessage(written: readonly Briefing[]): string {
  const weeks = written.map((b) => b.week).sort();
  if (weeks.length === 1) return `data: briefing ${weeks[0]}`;
  return `data: briefings ${weeks[0]}..${weeks[weeks.length - 1]} (${weeks.length})`;
}

export { isoWeekLabel };
