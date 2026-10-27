import { existsSync, readFileSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import path from "node:path";
import { briefingCommitMessage, briefingMarkdown, readBriefings, runBriefing } from "./briefing";
import { commitAndPush, NO_SITE_CHANGE } from "./git";
import { loadConfig } from "./lib/config";
import { errorMessage, log, setVerbose } from "./lib/log";
import { BOOKKEEPING_FILES, loadState } from "./lib/state";
import { cveClashes } from "./pipeline/dedupe";
import { classificationStalled, runSummaryMarkdown } from "./pipeline/health";
import { runCollector, type RunOptions } from "./pipeline/run";
import type { Incident, RunRecord } from "../lib/schema";
import { maybeUpdateRadar } from "./radar";
import { runReview, runReviewBatch } from "./review/index";
import { readAllStats, runStats } from "./stats/index";
import { STATS_FILES } from "../lib/stats-schema";

/**
 * GCD AI RADAR collector.
 *
 *   npm run collect                     fetch, classify, publish, commit, push
 *   npm run collect -- --dry-run        everything except writing and committing
 *   npm run collect -- --source=hn      only these sources (comma-separated), ignoring schedules
 *   npm run backfill -- <source> --since=2016-01-01
 *   npm run validate                    Zod-validate every file under /data; fail if two records are about one CVE
 *   npm run review                      walk the review queue interactively
 *   npm run review -- --approve=AIR-2026-0001 --reject=AIR-2026-0002 --reason="…"   decide without the walkthrough
 *   npm run radar                       refresh data/radar.json now (--dry-run to only test the token)
 *   npm run stats                       refresh the statistics files under data/stats (--force, --only=kev,epss, --dry-run)
 *   npm run briefing                    write data/briefings/<week>.json for the ISO week that ended on Sunday (skips if present)
 *   npm run briefing -- --week=2026-W41 --weeks=8 --force   a given week, the 8 weeks ending there, rewrite existing ones
 *
 * Flags: --limit=N  --since=YYYY-MM-DD  --no-enrich  --no-commit  --verbose
 */

function loadDotEnv() {
  const file = path.join(process.cwd(), ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const value = m[2]!.replace(/^["']|["']$/g, "");
    if (value && !process.env[m[1]!]) process.env[m[1]!] = value;
  }
}

interface Args {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): Args {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (const a of argv) {
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=", 2);
      flags[k!] = v ?? true;
    } else positional.push(a);
  }
  return { command: positional.shift() ?? "run", positional, flags };
}

/**
 * The data commit's subject: what the run changed. When only bookkeeping
 * files changed (the run ledger, seen and pending lists, collector state) the
 * site is the same and the subject ends with the marker vercel.json's
 * ignoreCommand looks for, so no build is spent on it.
 */
export function runCommitMessage(record: RunRecord, changedFiles: string[] = [], radarChanged = false): string {
  const c = record.counts;
  const base = `data: run ${record.started_at.slice(0, 16)}Z (+${c.published} published, +${c.review} review, ${c.merged} merged, ${c.updated ?? 0} updated, ${c.closed ?? 0} closed)`;
  return siteUnchanged(changedFiles, radarChanged) ? `${base} ${NO_SITE_CHANGE}` : base;
}

/** True when every changed file is bookkeeping (and the radar sidebar data did not change). */
export function siteUnchanged(changedFiles: string[], radarChanged: boolean): boolean {
  return !radarChanged && changedFiles.length > 0 && changedFiles.every((f) => BOOKKEEPING_FILES.has(f));
}

/** `npm run validate`: the checks beyond the schemas, as messages. */
export function validateLifecycle(incidents: Incident[]): string[] {
  const problems: string[] = [];
  for (const i of incidents) {
    if (i.timeline) {
      for (let k = 1; k < i.timeline.length; k++) {
        const a = i.timeline[k - 1]!;
        const b = i.timeline[k]!;
        if (a.date > b.date || (a.date === b.date && a.added_at > b.added_at)) {
          problems.push(`${i.id}: timeline is not sorted at entry ${k}`);
          break;
        }
      }
    }
    if (i.state === "closed" && !i.closed_at) problems.push(`${i.id}: closed without closed_at`);
    if (i.state === "live" && i.closed_at) problems.push(`${i.id}: live with closed_at`);
  }
  return problems;
}

function summarize(summary: Awaited<ReturnType<typeof runCollector>>) {
  const c = summary.record.counts;
  log.info(
    `run ${summary.record.id}: fetched ${c.fetched} · prefiltered ${c.prefiltered} · merged ${c.merged} · classified ${c.classified} · published ${c.published} · review ${c.review} · rejected ${c.rejected} · pending ${c.pending} · updated ${c.updated ?? 0} · closed ${c.closed ?? 0} · reopened ${c.reopened ?? 0}`,
  );
  const l = summary.record.llm;
  log.info(`llm: ${l.calls} calls, ${l.prompt_tokens} prompt + ${l.completion_tokens} completion tokens`, l.by_model);
  for (const e of summary.record.errors) log.warn(`error: ${e}`);
}

async function main() {
  loadDotEnv();
  const { command, positional, flags } = parseArgs(process.argv.slice(2));
  if (flags["verbose"]) setVerbose(true);
  const dryRun = Boolean(flags["dry-run"]);
  const sourceIds = typeof flags["source"] === "string" ? flags["source"].split(",").map((s) => s.trim()).filter(Boolean) : undefined;
  const limit = typeof flags["limit"] === "string" ? Number(flags["limit"]) : undefined;
  const since = typeof flags["since"] === "string" ? flags["since"] : undefined;
  const enrich = !flags["no-enrich"];
  const commit = !flags["no-commit"] && !dryRun;

  switch (command) {
    case "run": {
      const opts: RunOptions = {
        mode: dryRun ? "dry-run" : process.env.GITHUB_ACTIONS ? "scheduled" : "manual",
        dryRun,
        sourceIds,
        limit,
        since,
        enrich,
      };
      const summary = await runCollector(opts);
      summarize(summary);
      const settings = loadConfig().settings;
      const radarChanged = !sourceIds ? await maybeUpdateRadar(settings, { dryRun }) : false;
      // the daily statistics files (data/stats): due once a day, skipped in dry runs so a pipeline rehearsal stays quick
      const statsChanged = !sourceIds && !dryRun ? (await runStats(settings)).changed.length > 0 : false;
      const sideChanged = radarChanged || statsChanged;
      let unpushed = false;
      if (commit && (summary.changedFiles.length || sideChanged)) {
        const quiet = siteUnchanged(summary.changedFiles, sideChanged);
        const result = await commitAndPush(runCommitMessage(summary.record, summary.changedFiles, sideChanged), { deploy: !quiet });
        unpushed = result.committed && !result.pushed;
      }
      // Health: a job summary on Actions, and a failed job (owner gets an email) when classification
      // has stalled or the data commit could not be pushed (rejected by push protection, or the network).
      const stalled = dryRun ? false : classificationStalled((await loadState()).runs, settings.alerts.stalled_runs);
      let md = runSummaryMarkdown(summary.record, { stalled, stalledRuns: settings.alerts.stalled_runs, pendingWarn: settings.alerts.pending_warn });
      if (unpushed) {
        md += "\n\n> ❌ The data commit was made but could not be pushed. If GitHub's push protection rejected it, open the run log for the bypass link or remove the flagged text; the next run retries the push.";
      }
      if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
      if (stalled) {
        log.error(`classification has stalled: the last ${settings.alerts.stalled_runs} scheduled runs classified nothing while candidates waited`);
        process.exitCode = 2;
      }
      if (unpushed) {
        log.error("git: the data commit was not pushed; the site will not update until a push succeeds");
        process.exitCode = 2;
      }
      return;
    }
    case "backfill": {
      const source = positional[0];
      if (!source) throw new Error("backfill needs a source id, e.g. npm run backfill -- atlas --since=2016-01-01");
      const summary = await runCollector({ mode: "backfill", dryRun, sourceIds: [source], limit, since: since ?? "2016-01-01", enrich });
      summarize(summary);
      if (commit && summary.changedFiles.length) {
        const c = summary.record.counts;
        await commitAndPush(`data: backfill ${source} (+${c.published} published, +${c.review} review)`);
      }
      return;
    }
    case "stats": {
      const settings = loadConfig().settings;
      const only = typeof flags["only"] === "string" ? flags["only"].split(",").map((s) => s.trim()).filter(Boolean) : undefined;
      const result = await runStats(settings, { dryRun, force: Boolean(flags["force"]), only });
      if (commit && result.changed.length) {
        await commitAndPush(`data: stats refresh (${result.changed.map((f) => path.basename(f, ".json")).join(", ")})`);
      }
      if (result.failed.length) process.exitCode = 2;
      return;
    }
    case "validate": {
      loadConfig();
      const stats = await readAllStats();
      for (const [key, file] of Object.entries(STATS_FILES) as [keyof typeof STATS_FILES, string][]) {
        if (stats[key] === null && existsSync(path.join(process.cwd(), "data", "stats", file))) {
          log.error(`data/stats/${file} does not match its schema`);
          process.exitCode = 1;
          return;
        }
      }
      const state = await loadState();
      const clashes = cveClashes([...state.incidents, ...state.review]);
      if (clashes.length) {
        log.error(`${clashes.length} CVE id(s) are the subject of more than one record (see docs/cve-dedup.md)`, { clashes: clashes.slice(0, 20) });
        process.exitCode = 1;
        return;
      }
      const lifecycle = validateLifecycle([...state.incidents, ...state.review]);
      if (lifecycle.length) {
        log.error(`${lifecycle.length} lifecycle problem(s)`, { problems: lifecycle.slice(0, 20) });
        process.exitCode = 1;
        return;
      }
      const withLane = state.incidents.filter((i) => i.lane !== undefined).length;
      const live = state.incidents.filter((i) => i.state === "live").length;
      const briefings = await readBriefings();
      log.info("config and data files are valid", {
        incidents: state.incidents.length,
        review: state.review.length,
        rejected: state.rejected.length,
        pending: state.pending.length,
        seen: Object.keys(state.seen).length,
        runs: state.runs.length,
        briefings: briefings.length,
        with_lane: withLane,
        live,
        sources_remembered: Object.keys(state.collector.sources).length,
      });
      return;
    }
    case "briefing": {
      const week = typeof flags["week"] === "string" ? flags["week"] : undefined;
      const weeks = typeof flags["weeks"] === "string" ? Number(flags["weeks"]) : undefined;
      if (weeks !== undefined && !(Number.isInteger(weeks) && weeks >= 1)) throw new Error("--weeks needs a whole number of weeks, e.g. --weeks=8");
      const summary = await runBriefing({ week, weeks, force: Boolean(flags["force"]), dryRun });
      log.info(
        `briefing: ${summary.written.length} written, ${summary.skipped.length} skipped${summary.withoutNarrative.length ? `, ${summary.withoutNarrative.length} without a narrative (${summary.withoutNarrative.join(", ")})` : ""}`,
        { llm: summary.llm },
      );
      if (process.env.GITHUB_STEP_SUMMARY && summary.written.length) {
        await appendFile(process.env.GITHUB_STEP_SUMMARY, `${summary.written.map(briefingMarkdown).join("\n\n")}\n`);
      }
      if (commit && summary.written.length) {
        const result = await commitAndPush(briefingCommitMessage(summary.written));
        if (result.committed && !result.pushed) {
          log.error("git: the briefing commit was not pushed; the site will not show it until a push succeeds");
          process.exitCode = 2;
        }
      }
      return;
    }
    case "review": {
      const list = (v: string | boolean | undefined) => (typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);
      const approve = list(flags["approve"]);
      const rejectIds = list(flags["reject"]);
      if (approve.length || rejectIds.length) {
        await runReviewBatch({ approve, reject: rejectIds, reason: typeof flags["reason"] === "string" ? flags["reason"] : undefined, commit });
      } else {
        await runReview();
      }
      return;
    }
    case "radar": {
      const changed = await maybeUpdateRadar(loadConfig().settings, { dryRun, force: true });
      if (changed && commit) await commitAndPush("data: radar refresh");
      return;
    }
    default:
      throw new Error(`unknown command "${command}"`);
  }
}

main().catch((err) => {
  log.error(errorMessage(err));
  if (process.env.COLLECTOR_DEBUG === "1" && err instanceof Error) console.error(err.stack);
  process.exit(1);
});
