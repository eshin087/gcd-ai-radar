# Operations

How the collector is run, what it needs, and what happens when a free tier goes away. The security model is in [security.md](security.md).

## Collector commands

Keys go in `.env` (see `.env.example`). Nothing here is needed to run the site itself.

```bash
npm run collect -- --dry-run   # whole pipeline, no writes, no commit
npm run collect                # fetch, classify, publish, commit
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

The collector runs hourly on GitHub Actions and commits new data to `main`, which redeploys the site; a run that changed only bookkeeping files (the run ledger, the seen and pending lists, `collector-state.json`) commits with `[no site change]` in the subject and Vercel skips that build (`ignoreCommand` in `vercel.json`). Sources keep their own cadence (every run, every six hours, daily, weekly, monthly); `data/collector-state.json` remembers when each last succeeded, so a monthly source stays due on time however short the run ledger is kept. The historical seeds (AI Incident Database, MITRE ATLAS, AVID, NVD, GitHub Advisories) are backfilled from 2016.

## Secrets and variables (GitHub Actions)

| Name | Required | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | yes | Primary classifier (Gemini free tier, Google AI Studio) |
| `GROQ_API_KEY` | no | Fallback classifier (Groq free tier) |
| `NVD_API_KEY` | no | Raises the NVD API limit from 5 to 50 requests per 30 s |
| `CLOUDFLARE_RADAR_TOKEN` | no | Cloudflare API token with Account › Radar › Read; powers the sidebar panel |
| `VERCEL_DEPLOY_HOOK` | no | Deploy hook URL pinged after each data commit |
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
