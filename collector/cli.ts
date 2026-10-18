import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { commitAndPush } from "./git";
import { loadConfig } from "./lib/config";
import { errorMessage, log, setVerbose } from "./lib/log";
import { loadState } from "./lib/state";
import { runCollector, type RunOptions } from "./pipeline/run";
import { maybeUpdateRadar } from "./radar";
import { runReview } from "./review/index";

/**
 * gcd AI Radar collector.
 *
 *   npm run collect                     fetch, classify, publish, commit, push
 *   npm run collect -- --dry-run        everything except writing and committing
 *   npm run collect -- --source=hn      only these sources (comma-separated), ignoring schedules
 *   npm run backfill -- <source> --since=2016-01-01
 *   npm run validate                    Zod-validate every file under /data
 *   npm run review                      walk the review queue
 *   npm run radar                       refresh data/radar.json now (--dry-run to only test the token)
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

function summarize(summary: Awaited<ReturnType<typeof runCollector>>) {
  const c = summary.record.counts;
  log.info(
    `run ${summary.record.id}: fetched ${c.fetched} · prefiltered ${c.prefiltered} · merged ${c.merged} · classified ${c.classified} · published ${c.published} · review ${c.review} · rejected ${c.rejected} · pending ${c.pending}`,
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
      const radarChanged = !sourceIds ? await maybeUpdateRadar(loadConfig().settings, { dryRun }) : false;
      if (commit && (summary.changedFiles.length || radarChanged)) {
        const c = summary.record.counts;
        await commitAndPush(`data: run ${summary.record.started_at.slice(0, 16)}Z (+${c.published} published, +${c.review} review, ${c.merged} merged)`);
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
    case "validate": {
      loadConfig();
      const state = await loadState();
      log.info("config and data files are valid", {
        incidents: state.incidents.length,
        review: state.review.length,
        rejected: state.rejected.length,
        pending: state.pending.length,
        seen: Object.keys(state.seen).length,
        runs: state.runs.length,
      });
      return;
    }
    case "review": {
      await runReview();
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
