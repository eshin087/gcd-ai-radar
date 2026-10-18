# gcd AI Radar

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

- All data lives as JSON in [`/data`](data). Every commit to `main` redeploys the site.
- The collector (`/collector`, TypeScript) classifies candidates with free-tier LLMs
  (Gemini first, Groq as fallback). Anything that cannot be classified waits in
  `data/pending.json`; nothing is dropped and nothing is published unclassified.
- Counts are per incident, not per article: one event covered by fifteen outlets is one
  incident with fifteen sources.
- Only titles, links, dates and our own two-sentence summaries are stored. No article text.

## Status

Scaffold and design-options phase. The collector and backfill land next; see the
[plan in the repository history](https://github.com/eshin087/gcd-ai-radar) and the
Methodology page once deployed.

## Development

```bash
npm install
npm run stub         # regenerate the synthetic stub dataset (design phase only)
npm run dev          # http://localhost:3000 (uses the stub while data/incidents.json is empty)
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

## Licences

Code: [MIT](LICENSE). Data: [CC BY-SA 4.0](LICENSE-DATA.md), with upstream attributions listed there.
