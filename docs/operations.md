# Operations

How the collector is run, what it needs, and what happens when a free tier goes away. The security model is in [security.md](security.md).

## Collector commands

Keys go in `.env` (see `.env.example`). Nothing here is needed to run the site itself.

```bash
npm run collect -- --dry-run   # whole pipeline, no writes, no commit
npm run collect                # fetch, classify, publish, commit
npm run collect -- --source=gdelt   # the GDELT pass alone, ignoring schedules: what collect-gdelt.yml runs every six hours
npm run backfill -- aiid       # one-time seeds: aiid | atlas | avid | nvd | ghsa
npm run review                 # walk through data/review-queue.json
npm run validate               # Zod-validate every file under /data
npm run briefing               # weekly briefing for the ISO week that ended last Sunday (Mondays on Actions)
npm run briefing -- --week=2026-W42 --weeks=8 --force --no-commit   # backfill or rewrite weeks locally
npx tsx scripts/shard-incidents.ts   # rebuild data/incidents/<year>.json from a pre-shard data/incidents.json
npx tsx scripts/migrate-lanes.ts --dry-run   # count what the lifecycle migration would write; drop the flag to write it
```

Each run: fetch, pre-filter (security term or CVE id; an AI term only sets a hint), dedupe (seen, CVE, title, shared rare entity), same-incident checks, merges, clustering, classification (lane, AI role, curation bar), the product pass, the update pass (every merged report becomes a timeline entry and may change the fix status or reopen the record), decide and build, GitHub advisory lookups for version data, then the closer (live records whose window has passed are closed on disk) and the run record. The run's log lists every same-incident check with its trigger and every classification with its lane and `newsworthy` decision under `--verbose`.

### The lifecycle migration (one-off)

Records that predate lanes carry no lifecycle keys and get them derived at load. `scripts/migrate-lanes.ts` writes those derived values into every record (exactly what `withLifecycle` renders, so a missed record looks identical), touching only `data/incidents/<year>.json`. Procedure: `gh workflow disable collect.yml`, `npx tsx scripts/migrate-lanes.ts --dry-run`, then without the flag, `npm run validate`, commit the shards, merge, `gh workflow enable collect.yml` the same day (`keepalive.yml` re-enables it every Monday anyway). The script is idempotent; a second run writes nothing.

### The CVSS backfill (one-off)

`scripts/backfill-cvss.ts` fills `cvss` on every published record that has CVE ids and no score: the highest CVSS 3.1 or 4.0 base score among its CVEs, from the GitHub Advisory Database by `cve_id` first (`GITHUB_TOKEN`, else the gh CLI's token) and the NVD CVE API for the ids GitHub has no score for (6.5 s apart without `NVD_API_KEY`). It writes `cvss` only, never `updated_at`, and caches every answer in `collector/.cache/cvss-lookups.json`, so the real run after a dry run makes no new call. Same procedure as the migration: pause the cron, `--dry-run`, run, `npm run validate`, commit the shards, merge, re-enable the cron. A second run finds no candidate and writes nothing.

The collector runs every 30 minutes on GitHub Actions and commits new data to `main`. GitHub's own schedule fired the hourly slot only three to five times a day, so the Cloudflare Worker's cron (`worker/src/dispatch.ts`, secret `GITHUB_DISPATCH_TOKEN`) starts each run through `workflow_dispatch` and skips a tick while a run is active; the hourly schedule in `collect.yml` stays as the fallback. Every run commits its data to `main`, but the site is rebuilt at most once per deploy window (06 and 18 UTC by default, `DEFAULT_DEPLOY_HOURS_UTC` in `collector/cli.ts`; the repository variable `COLLECTOR_DEPLOY_HOURS` overrides it, `*` deploys every run). The windows are deadlines, not slots a run has to hit: a scheduled run rebuilds the site when a window has opened since the last commit that rebuilt it (the newest commit on `main` without the marker below, read with `git log`), so a schedule that skips the 06:17 and 18:17 slots still rebuilds at its next run, and a second run inside the same window does not rebuild again. Every other scheduled run, and any run that changed only bookkeeping files (the run ledger, the seen and pending lists, `collector-state.json`), commits with `[no site change]` in the subject, Vercel skips that build (`ignoreCommand` in `vercel.json`) and the deploy hook is not pinged. Before 2026-11-01 every run with new data deployed, about 30 builds a day of a 3,400-page site, which filled the Vercel account's deployment storage (347 GB against the Hobby plan's 10 GB). Until 2026-11-09 a run had to start inside a window hour, and with GitHub firing the schedule three to five times a day the site went from 2026-11-05 to 2026-11-08 without a rebuild. A merge to `main` still deploys at once with everything collected so far, and a manual `npm run collect` deploys as before. Each run checks out the tip of `main` when its job starts (`ref: main` in `collect.yml`), not the commit GitHub pinned when it created the run: the workflow's concurrency group queues a run that arrives while another is working, and on 2026-11-09 a queued run worked from a base one data commit behind, redid the same changes and could not push. A push that is still rejected is retried once after a rebase; a rebase conflict (two commits to the same data files) names the files in the log, drops that run's commit and fails the job, and the next run redoes the work from the tip. Sources keep their own cadence (every run, every six hours, daily, weekly, monthly, or a workflow of their own, below); `data/collector-state.json` remembers when each last succeeded, so a monthly source stays due on time however short the run ledger is kept. The historical seeds (AI Incident Database, MITRE ATLAS, AVID, NVD, GitHub Advisories) are backfilled from 2016.

### GDELT in its own workflow

GDELT answers one query at a time with 30 s gaps and frequent 429s, so a pass took 17 to 40 minutes inside the collector's runs on 2026-11-08 (1667, 1045 and 2429 s) while everything else in a run takes 5 to 10; once the Worker dispatches `collect.yml` every 30 minutes, a pass that long would hold up the ticks. Since 2026-11-08 the `gdelt` entry in `collector/config/sources.json` has `"schedule": "own_workflow"`, which the main sweep never finds due (`isDue` in `collector/pipeline/run.ts`), and `.github/workflows/collect-gdelt.yml` runs `npm run collect -- --source=gdelt` every six hours (02:41, 08:41, 14:41 and 20:41 UTC; `--source` ignores schedules and skips the radar and stats stages). Both workflows share the `collect` concurrency group, and `collect-gdelt.yml` checks out `ref: main` too, so two runs never commit at once and a run that waited in the group starts from the tip: a main run dispatched during a GDELT pass waits in the group, the Worker sees it queued and skips its tick, and GitHub keeps at most one waiting run per group. The deploy rule above applies to the GDELT run like any other scheduled run, because the decision is the collector's own (`windowOpenedSince` in `collector/cli.ts`): it rebuilds the site only when a window has opened since the last rebuild and otherwise commits with `[no site change]`, so the split adds no deployment. `keepalive.yml` re-enables both workflows. A pass still holds the group for its duration, four times a day; what the split buys is a main sweep that is always short, and a pass that is timed, timed out (60 minutes) and visible on its own.

## Secrets and variables (GitHub Actions)

| Name | Required | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | yes | Primary classifier (Gemini free tier, Google AI Studio) |
| `GROQ_API_KEY` | no | Fallback classifier (Groq free tier) |
| `NVD_API_KEY` | no | Raises the NVD API limit from 5 to 50 requests per 30 s |
| `CLOUDFLARE_RADAR_TOKEN` | no | Cloudflare API token with Account › Radar › Read; powers the sidebar panel |
| `VERCEL_DEPLOY_HOOK` | no | Deploy hook URL pinged after a data commit that rebuilds the site (deploy windows only, see above) |
| `COLLECTOR_DEPLOY_HOURS` | no | Repository variable: the deploy windows, UTC hours by which a scheduled run must have rebuilt the site (default `6,18`; `*` for every run) |
| `COLLECTOR_GIT_NAME` / `COLLECTOR_GIT_EMAIL` (variables) | no | Commit identity for data commits (defaults to the GitHub Actions bot) |

Set secrets from your own terminal, never by pasting keys into a chat or issue:

```bash
gh secret set GEMINI_API_KEY
```

## If a free tier disappears

Every dependency has a documented way out, and the site keeps working with degraded features rather than errors:

| If this goes away | What happens | What to do |
|---|---|---|
| Gemini free tier | The router falls through to Groq; if that is gone too, candidates wait in `data/pending.json` and the run exits cleanly | Add any OpenAI-compatible endpoint (OpenRouter, Cloudflare Workers AI, a local Ollama) as a provider in `collector/config/settings.json` (`kind: "openai_compatible"`, see the `_comment` there) and set its env var |
| Groq free tier | Nothing visible; Gemini carries the load | Remove or replace the provider entry |
| Cloudflare Radar | The sidebar panel hides; the last good `data/radar.json` is kept | None required |
| A feed or API | Its errors show on the Sources page; every other source proceeds | Fix or disable the entry in `collector/config/sources.json` |
| GitHub Actions schedules | Nothing runs | `keepalive.yml` re-enables the cron weekly; or run `npm run collect` from any machine with the keys in `.env` |
| Vercel | The site stops deploying | Run the `pages-fallback` workflow (GitHub Pages, manual trigger) or deploy `./out` from `npm run build` to any static host |
