/**
 * The collector's clock. GitHub runs scheduled workflows when it has room,
 * and in October 2026 the hourly collect.yml ran three to five times a day,
 * so news waited up to seven hours. The Worker's cron trigger starts the
 * collector through workflow_dispatch instead, every 30 minutes, and skips a
 * tick while a run is still queued or running so runs never stack (the
 * workflow's concurrency group would cancel the older waiting one). GitHub's
 * own schedule stays in collect.yml as the fallback.
 *
 * The token is the secret GITHUB_DISPATCH_TOKEN: a fine-grained token for
 * this repository only, with Actions read and write and nothing else.
 */

export const REPO = "eshin087/gcd-ai-radar";
export const WORKFLOW = "collect.yml";
export const BRANCH = "main";
const API = "https://api.github.com";
const TIMEOUT_MS = 8000;

export interface WorkflowRun {
  status: string;
}

/** Run statuses that mean the collector is waiting or working. */
const ACTIVE = new Set(["queued", "in_progress", "waiting", "pending", "requested"]);

export function busy(runs: readonly WorkflowRun[]): boolean {
  return runs.some((r) => ACTIVE.has(r.status));
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "gcd-ai-radar-internet/0.1 (+https://gcd-ai-radar.vercel.app)",
  };
}

/** Starts collect.yml on main unless a run is already queued or running. */
export async function dispatchCollector(token: string, fetcher: typeof fetch = fetch): Promise<"dispatched" | "busy"> {
  const base = `${API}/repos/${REPO}/actions/workflows/${WORKFLOW}`;
  const list = await fetcher(`${base}/runs?per_page=5`, { headers: headers(token), signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!list.ok) throw new Error(`GitHub runs list answered ${list.status}`);
  const body = (await list.json()) as { workflow_runs?: WorkflowRun[] };
  if (busy(body.workflow_runs ?? [])) return "busy";
  const res = await fetcher(`${base}/dispatches`, {
    method: "POST",
    headers: { ...headers(token), "Content-Type": "application/json" },
    body: JSON.stringify({ ref: BRANCH }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // 204 No Content; 200 when GitHub returns the run's details
  if (res.status !== 204 && res.status !== 200) throw new Error(`GitHub dispatch answered ${res.status}`);
  return "dispatched";
}
