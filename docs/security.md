# Security model

What GCD RADAR is exposed to, what protects it, and where to report a problem. Audits with measurements and dated findings live in `docs/audit-2026-10.md`.

## What runs where

| Part | Runs | Reads | Writes |
|---|---|---|---|
| Site | Static files on Vercel's CDN. No server code, no cookies, no accounts, no analytics. | Its own JSON under `/data` | Nothing |
| Collector | GitHub Actions, hourly, on a fresh runner | RSS and Atom feeds, public APIs and exports, pages behind candidate links (metadata only, robots.txt respected) | `data/` in this repository, pushed to `main` |
| Classifier | Gemini or Groq free tiers, called by the collector | Titles, descriptions and vulnerability metadata of candidates | A strict JSON record per candidate |
| Build | Vercel, on every push to `main` | `data/` | The static site |

Secrets: the LLM keys, an optional NVD key, a Cloudflare Radar token and an optional Vercel deploy hook, held as GitHub Actions secrets. The collector's push uses the workflow's own short-lived `GITHUB_TOKEN`, which cannot change workflow files. No secret reaches the site or the dataset.

## Threats and controls

**A crafted web page reaches the classifier.** Anyone can get a URL in front of the collector through Hacker News or GDELT. Controls: the classifier's output is validated against a strict schema with enumerated fields and length caps; both prompts state that item text is untrusted data and never instructions; low-confidence results go to a review queue; everything the site renders is escaped. Worst case is a misleading record, which the review tool retires.

**A link points at something other than a public web server.** Every fetch, including each redirect hop, must be http(s) to a public address: loopback, private, link-local (cloud metadata), carrier-grade NAT, multicast and reserved ranges are refused, and names are checked against every address they resolve to (`collector/lib/netguard.ts`). Credentials never follow a redirect to another host. Stored source URLs must be http(s), so no other scheme can become a link on an incident page.

**Hostile feed content.** Bodies are capped at 3 MB (400 KB for page metadata, 50 MB for the weekly Excel export), requests time out, retries back off. DOCTYPE declarations are stripped before XML parsing so entity expansion cannot blow up memory. YAML is parsed with the default safe schema.

**Supply chain.** Dependencies are locked; installs run without lifecycle scripts; GitHub actions are pinned to commit hashes; Dependabot proposes updates weekly and a weekly audit fails on high or critical advisories in runtime dependencies; CodeQL scans the TypeScript on every push and weekly.

**Workflow abuse.** Workflow inputs reach shell scripts only as environment variables. `GITHUB_TOKEN` is read-only except where a job declares a write scope (the collector's `contents: write`, the keepalive's `actions: write`). Checkouts that do not push keep no credentials. Pull requests from forks get no secrets.

**Visitors.** The site sends a content-security policy (same-origin scripts, styles, fonts, images and fetches; no framing, no plugins), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, a strict referrer policy and a permissions policy that turns off camera, microphone, geolocation and payment APIs. HSTS with preload comes from Vercel. Inline scripts and styles are still allowed, because a static export cannot carry per-request nonces. The one exception to the framing ban is `/embed`, the card other sites put in an iframe: it sends `frame-ancestors *` and no `X-Frame-Options`, and `tests/headers.test.ts` checks that no other path does. The card is static, has no forms and links out in a new tab, so a framing page can only show it.

**Downloads.** The CSV defuses cells that spreadsheets would run as formulas. The RSS feed escapes every field. Dataset files are served with `Access-Control-Allow-Origin: *` on purpose: they are a public, CC BY-SA 4.0 dataset.

**Data integrity.** The dataset is plain JSON in git, so every change is attributable and reversible; `npm run validate` checks every file against the schema and refuses two records about one CVE. The collector job fails, and the owner is emailed, when classification has stalled for three runs or when its data commit cannot be pushed. A repository ruleset stops `main` from being force-pushed or deleted, and GitHub's secret scanning with push protection rejects any commit that carries a known key format.

## Not defended against

- A compromised maintainer account or GitHub itself.
- A dependency that is malicious in its published code rather than its install script (CodeQL and audits raise the odds of noticing; they do not prevent it).
- Denial of service against Vercel's CDN (Vercel's concern) or against the free LLM tiers (the collector degrades to a pending queue and alarms).
- DNS rebinding between the guard's lookup and the request. The runner is ephemeral and holds no secrets a rebound request could reach.

## Reporting

Open a GitHub issue for anything that is not sensitive. For something that is, use GitHub's private vulnerability reporting on the repository if it is enabled, or contact the maintainer listed on the About page.
