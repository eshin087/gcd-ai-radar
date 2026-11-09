# CLAUDE.md: gcdRadar

Project instructions for Claude Code. How the site, collector and deploys work is in
[docs/operations.md](docs/operations.md); read it before changing the collector, its workflows or `vercel.json`.

## Deployment storage (user request, 2026-11-01)

The Vercel account is on the Hobby plan: **10 GB of deployment storage for every project together**, and each
retained deployment counts in full. On 2026-11-01 it showed 347 GB. This site was one of the two causes: every
collector run with new data rebuilt and redeployed all ~3,400 pages, about 30 deployments a day.

1. **Data commits don't deploy on their own.** A scheduled collector run rebuilds the site at most once per deploy
   window (06 and 18 UTC, `DEFAULT_DEPLOY_HOURS_UTC` in `collector/cli.ts`): the windows are deadlines, and a run
   rebuilds only when one has opened since the last commit that rebuilt the site; every other run commits with
   `[no site change]` and `vercel.json`'s `ignoreCommand` skips the build. Keep that marker on any new automated
   commit that does not need the site rebuilt (stats refreshes, backfills, bookkeeping), and never add a schedule,
   workflow or deploy hook that deploys more often without the user's yes.
2. **Widen the windows on purpose only.** The `COLLECTOR_DEPLOY_HOURS` repository variable changes them (`*` means
   every run). Add hours only when the user wants fresher data on the site, and say what it costs: each extra
   window is one more full deployment per day.
3. **Keep the build output lean.** Don't put large exports, archives or media under `public/` or into the static
   output; serve changing data from the Cloudflare Worker or another store instead of rebuilding for it.
4. **Retention** is 1 week (1 day for errored and canceled) on every project and as the team default. Don't
   lengthen it without the user's yes.
5. When the usage page nears the limit, check deploy count and size per project first (`vercel api /v6/deployments`)
   before deleting anything, and ask the user before bulk removals.
