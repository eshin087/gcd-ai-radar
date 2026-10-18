import type { RunRecord } from "../../lib/schema";

/**
 * Health signals for an unattended collector. The site keeps building from
 * old data when classification stops (every provider down, keys revoked,
 * quotas gone), so nothing visible breaks; these turn that silence into a
 * failed job, which GitHub reports to the owner by email.
 */

/**
 * True when the last `n` scheduled runs all had candidates waiting and
 * classified none of them. One such run is normal (a daily quota reset away);
 * three in a row, 18 hours, is not.
 */
export function classificationStalled(runs: RunRecord[], n: number): boolean {
  const scheduled = runs.filter((r) => r.mode === "scheduled").slice(-n);
  return scheduled.length >= n && scheduled.every((r) => r.counts.pending > 0 && r.counts.classified === 0);
}

export function runSummaryMarkdown(record: RunRecord, opts: { stalled: boolean; stalledRuns: number; pendingWarn: number }): string {
  const c = record.counts;
  const l = record.llm;
  const failed = record.sources.filter((s) => !s.ok);
  const lines = [
    `### collect ${record.id} (${record.mode})`,
    "",
    "| fetched | prefiltered | merged | classified | published | review | rejected | pending |",
    "|---:|---:|---:|---:|---:|---:|---:|---:|",
    `| ${c.fetched} | ${c.prefiltered} | ${c.merged} | ${c.classified} | ${c.published} | ${c.review} | ${c.rejected} | ${c.pending} |`,
    "",
    `LLM: ${l.calls} call${l.calls === 1 ? "" : "s"}, ${l.prompt_tokens.toLocaleString("en-US")} prompt + ${l.completion_tokens.toLocaleString("en-US")} completion tokens` +
      (Object.keys(l.by_model).length ? ` (${Object.entries(l.by_model).map(([k, v]) => `${k}: ${v.calls}`).join(", ")})` : ""),
  ];
  if (failed.length) lines.push("", `Sources not ok: ${failed.map((s) => `${s.id}${s.error ? ` (${s.error.slice(0, 80)})` : ""}`).join(", ")}`);
  if (record.errors.length) lines.push("", "Errors:", ...record.errors.slice(0, 10).map((e) => `- ${e}`));
  if (c.pending > opts.pendingWarn) lines.push("", `> ⚠️ ${c.pending} candidates are waiting for classification (warning threshold ${opts.pendingWarn}).`);
  if (opts.stalled) {
    lines.push("", `> ❌ Classification has stalled: the last ${opts.stalledRuns} scheduled runs classified nothing while candidates waited. Check the LLM providers, their keys and quotas (collector/config/settings.json).`);
  }
  return lines.join("\n");
}
