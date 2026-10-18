import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { log, errorMessage } from "./lib/log";

const exec = promisify(execFile);
const ROOT = process.cwd();

async function git(args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd: ROOT, maxBuffer: 10 * 1024 * 1024 });
  return stdout.trim();
}

export interface CommitResult {
  committed: boolean;
  pushed: boolean;
  sha?: string;
}

/**
 * Stages the data directory, commits as the configured identity (the repo
 * owner's, so Vercel's Hobby plan deploys the push) and pushes with a
 * rebase-and-retry loop. Never force-pushes. Pings the deploy hook if set.
 */
export async function commitAndPush(message: string, opts: { push?: boolean } = {}): Promise<CommitResult> {
  await git(["add", "--", "data"]);
  try {
    await git(["diff", "--cached", "--quiet"]);
    log.info("git: no data changes to commit");
    return { committed: false, pushed: false };
  } catch {
    // there are staged changes
  }
  const name = process.env.COLLECTOR_GIT_NAME || "github-actions[bot]";
  const email = process.env.COLLECTOR_GIT_EMAIL || "41898282+github-actions[bot]@users.noreply.github.com";
  await git(["-c", `user.name=${name}`, "-c", `user.email=${email}`, "commit", "-q", "-m", message]);
  const sha = await git(["rev-parse", "--short", "HEAD"]);
  log.info(`git: committed ${sha}`, { author: name });
  if (opts.push === false) return { committed: true, pushed: false, sha };

  const branch = (await git(["rev-parse", "--abbrev-ref", "HEAD"])) || "main";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await git(["push", "origin", `HEAD:${branch}`]);
      log.info("git: pushed", { branch, attempt });
      await pingDeployHook();
      return { committed: true, pushed: true, sha };
    } catch (err) {
      log.warn(`git: push failed (attempt ${attempt})`, { error: errorMessage(err).slice(0, 200) });
      try {
        await git(["-c", `user.name=${name}`, "-c", `user.email=${email}`, "pull", "--rebase", "origin", branch]);
      } catch (rebaseErr) {
        log.error("git: rebase failed", { error: errorMessage(rebaseErr).slice(0, 200) });
        await git(["rebase", "--abort"]).catch(() => undefined);
      }
    }
  }
  return { committed: true, pushed: false, sha };
}

async function pingDeployHook(): Promise<void> {
  const hook = process.env.VERCEL_DEPLOY_HOOK;
  if (!hook) return;
  try {
    const res = await fetch(hook, { method: "POST" });
    log.info("vercel deploy hook pinged", { status: res.status });
  } catch (err) {
    log.warn("vercel deploy hook failed", { error: errorMessage(err) });
  }
}
