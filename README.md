# GCD AI RADAR

A public, zero-cost observatory of AI cybersecurity incidents. It records,
counts, categorizes and charts two kinds of incident, deduplicated and linked
to original reporting:

- **attack_on_ai**: an AI model, agent or AI-powered product was the thing exploited, abused or leaked.
- **ai_enabled_attack**: attackers used AI as a meaningful part of a cyberattack against someone else.

Part of the gcd family ([gcdatlas.com](https://gcdatlas.com)). Live site: see the repository description.

## How it works

```
feeds + APIs ──▶ collector (GitHub Actions, every 6 h) ──▶ /data/*.json ──▶ Next.js static site (Vercel)
                 fetch → pre-filter → dedupe → LLM classify → publish/review/reject → commit
```

- All data lives as JSON in [`/data`](data), the published records sharded by year of first
  report (`data/incidents/<year>.json`), so a collector run rewrites one small file. Every
  commit to `main` redeploys the site.
- The collector (`/collector`, TypeScript) classifies candidates with free-tier LLMs
  (Gemini first, Groq as fallback). Anything that cannot be classified waits in
  `data/pending.json`; nothing is dropped and nothing is published unclassified.
- Counts are per incident, not per article: one event covered by fifteen outlets is one
  incident with fifteen sources.
- Only titles, links, dates and our own two-sentence summaries are stored. No article text.

## Status

Live at https://gcd-ai-radar.vercel.app. The collector runs every 6 hours on GitHub
Actions (it needs `GEMINI_API_KEY`, see below) and commits new data to `main`, which
redeploys the site. The historical seeds (AI Incident Database, MITRE ATLAS, AVID, NVD,
GitHub Advisories) are backfilled from 2016.

## Development

```bash
npm install
npm run dev          # http://localhost:3000
npm test             # unit tests (dedupe, schema, stats)
npm run typecheck && npm run lint
npm run build        # static export to ./out (runs scripts/prebuild.ts first)
```

Collector commands (keys in `.env`, see `.env.example`):

```bash
npm run collect -- --dry-run   # whole pipeline, no writes, no commit
npm run collect                # fetch, classify, publish, commit
npm run backfill -- aiid       # one-time seeds: aiid | atlas | avid | nvd | ghsa
npm run review                 # walk through data/review-queue.json
npm run validate               # Zod-validate every file under /data
npx tsx scripts/shard-incidents.ts   # rebuild data/incidents/<year>.json from a pre-shard data/incidents.json
```

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

Every dependency has a documented way out, and the site keeps working with degraded
features rather than errors:

| If this goes away | What happens | What to do |
|---|---|---|
| Gemini free tier | The router falls through to Groq; if that is gone too, candidates wait in `data/pending.json` and the run exits cleanly | Add any OpenAI-compatible endpoint (OpenRouter, Cloudflare Workers AI, a local Ollama) as a provider in `collector/config/settings.json` (`kind: "openai_compatible"`, see the `_comment` there) and set its env var |
| Groq free tier | Nothing visible; Gemini carries the load | Remove or replace the provider entry |
| Cloudflare Radar | The sidebar panel hides; the last good `data/radar.json` is kept | None required |
| A feed or API | Its errors show on the Sources page; every other source proceeds | Fix or disable the entry in `collector/config/sources.json` |
| GitHub Actions schedules | Nothing runs | `keepalive.yml` re-enables the cron weekly; or run `npm run collect` from any machine with the keys in `.env` |
| Vercel | The site stops deploying | Run the `pages-fallback` workflow (GitHub Pages, manual trigger) or deploy `./out` from `npm run build` to any static host |

## Licences

Code: [MIT](LICENSE). Data: [CC BY-SA 4.0](LICENSE-DATA.md), with upstream attributions listed there.
