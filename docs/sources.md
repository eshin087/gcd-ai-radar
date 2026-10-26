# Sources

Every feed, API and dataset the collector reads, verified live on 2026-10-17 and 2026-10-18 (the general advisory and press feeds and Have I Been Pwned on 2026-10-25). For each source: how it is accessed, its licence or terms, what attribution it requires, which fields it provides and any caveats. The collector's configuration is `collector/config/sources.json`; this page is kept in step with it.

Policy: a source is used only if its feed or API is offered for machine reading, its path is not disallowed in robots.txt, and its terms do not forbid what the collector does (store title, link and date; write an original two-sentence summary; link back). Nothing is fetched behind paywalls or logins, and article text is never stored.

## Query-driven discovery

| Source | Access | Licence / terms | Attribution | Fields | Status |
|---|---|---|---|---|---|
| Hacker News via Algolia | `hn.algolia.com/api/v1/search_by_date`, one request per query phrase, stories with an external link only | Sanctioned public channel for Hacker News data; 10,000 requests per hour per IP | "Search powered by Algolia" (voluntary) | title, url, created_at, points, comments | in use |
| GDELT DOC 2.0 | `api.gdeltproject.org/api/v2/doc/doc`, one query at a time with long gaps | "Unlimited and unrestricted use … must include a citation to the GDELT Project and a link" | "Powered by GDELT" with link (footer) | url, title, seendate, domain, language | in use; frequent rate limiting is expected and tolerated |
| Bluesky search | `api.bsky.app/xrpc/app.bsky.feed.searchPosts` | robots.txt allows crawling the public API; terms are silent on reading | none | external link and title from posts | configured, off by default |
| CISA Known Exploited Vulnerabilities | `cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json` | CC0 1.0 | none required | cveID, vendor, product, name, dateAdded, description | in use |

Not used after verification: Google News RSS search (robots.txt disallows `/rss`; the feed licence is "solely … within a personal feed reader for personal, non-commercial use"; article links are opaque redirects that cannot be resolved over HTTP), Bing News RSS (same personal-use licence), Reddit (robots.txt and Data API terms), Lobste.rs (robots.txt `Disallow: /`).

## Security press

| Source | Feed | Terms and robots | Fields | Status |
|---|---|---|---|---|
| The Hacker News | `feeds.feedburner.com/TheHackersNews` | robots allow-all, no terms page, feed advertised | title, link, date, short snippet | in use |
| SecurityWeek | `securityweek.com/feed/` | robots fine, feed advertised, no terms page | title, link, author, date, categories, one-sentence teaser | in use |
| Krebs on Security | `krebsonsecurity.com/feed/` | robots fine, no terms page | title, link, date, excerpt | in use |
| BleepingComputer | `bleepingcomputer.com/feed/` | Terms: content may be stored only for "personal and non-commercial use"; no clause about the feed | title, link, author, date, teaser | in use: title, link and our own summary only |
| Dark Reading | `darkreading.com/rss.xml` | Informa TechTarget terms forbid "data mining, robots or similar"; the feed itself is open and reading it is its intended purpose | title, link, author, date, dek | in use |
| The Record | `therecord.media/feed` | feed advertised in the site footer; no terms page; `/robots.txt` is not served (404) | title, link, author, date, teaser | in use; the feed holds only the latest 5 items, so it is read every run |
| CyberScoop | `cyberscoop.com/feed/` | robots allow-all except `GPTBot` (disallowed site-wide); no terms page | title, link, author, date, categories, teaser | in use |
| Help Net Security | `helpnetsecurity.com/feed/` | robots allow-all; no terms page | title, link, author, date, categories, teaser | in use; "Week in review" round-ups skipped |
| Wired, Ars Technica | not polled | Condé Nast user agreement forbids automated or periodic access and storage except by search engines | — | cited only when found through other sources |
| The Register | not polled | robots.txt is default-deny (`User-agent: * Disallow: /` on both hosts) with an AI-licensing notice; terms are personal, non-commercial | — | cited only when found through other sources; licensing contact: content-licensing@sitpub.com |

## Vendor and research blogs

| Source | Feed | Notes | Status |
|---|---|---|---|
| OpenAI News | `openai.com/news/rss.xml` | only feed; keyword-filtered | in use |
| Anthropic | sitemap diff of `anthropic.com/sitemap.xml` (news, research, engineering) | no RSS or Atom feed exists; new dated pages are fetched once for title and description, robots.txt honoured | in use |
| Google Security Blog | `security.googleblog.com/feeds/posts/default?alt=rss&redirect=false` | dormant since 2026-04 | in use |
| Google DeepMind | `deepmind.google/blog/rss.xml` | needs gzip; mostly product news | in use |
| Google Threat Intelligence | `cloudblog.withgoogle.com/topics/threat-intelligence/rss/` | full-text feed; only titles and a hint are read | in use |
| Microsoft Security Blog | `microsoft.com/en-us/security/blog/feed/` plus the threat-intelligence and AI topic feeds | — | in use |
| MSRC Security Update Guide | `api.msrc.microsoft.com/update-guide/rss` | thousands of one-line CVE items; only titles mentioning Copilot, AI or agents pass | in use |
| Meta Engineering (security) | `engineering.fb.com/category/security/feed/` | ai.meta.com has no feed | in use |
| Simon Willison | `simonwillison.net/tags/prompt-injection.atom`, `…/tags/security.atom` | specialist: skips the keyword gate | in use |
| Embrace The Red | `embracethered.com/blog/index.xml` | specialist | in use |
| Trail of Bits | `blog.trailofbits.com/index.xml` | — | in use |
| Unit 42 (Palo Alto Networks) | `unit42.paloaltonetworks.com/tag/ai/feed/` and `/feed/` | Protect AI's research moved here after its acquisition | in use |
| HiddenLayer | sitemap diff of `hiddenlayer.com/sitemap.xml` (research, advisories) | no feed | in use |
| Cisco Talos | `blog.talosintelligence.com/rss/` | — | in use |
| OWASP GenAI Security Project | `genai.owasp.org/feed/` | specialist | in use |
| Straiker | `straiker.ai/blog/rss.xml` | specialist; some marketing posts | in use |
| Trend Micro Research | `feeds.trendmicro.com/TrendMicroResearch` (plain HTTP: the HTTPS endpoint fails the TLS handshake) | — | in use |
| Checkmarx Zero | `checkmarx.com/feed/?post_type=zero-post` | — | in use |
| Lakera, huntr, Project Zero, Meta AI | not polled | no feed or no dated sitemap (Lakera, huntr, Meta AI); Project Zero's feed is 11 MB with no AI content | — |

## Advisory feeds (patch lane)

Official advisory feeds read for the general lanes. They are machine-readable by design and sit on the same footing as the MSRC feed above: a vendor's or agency's syndication of its own advisories.

| Source | Feed | Licence / terms | Attribution | Status |
|---|---|---|---|---|
| CISA Cybersecurity Alerts | `cisa.gov/cybersecurity-advisories/alerts.xml` | US government work (17 U.S.C. § 105), public domain; robots.txt disallows only Drupal system paths | none required | in use; "CISA Adds … to Known Exploited Vulnerabilities Catalog" items skipped because the KEV source carries them |
| CERT-EU Security Advisories | `cert.europa.eu/publications/security-advisories-rss` | robots.txt blacklists a few named crawlers and allows everything else; EU institutions' reuse policy (Decision 2011/833/EU, reuse with source acknowledgement) | link to cert.europa.eu | in use, daily |
| NCSC (UK) | `ncsc.gov.uk/api/1/services/v1/all-rss-feed.xml` | Crown copyright under the Open Government Licence v3.0. Terms page (2026-10-25): "you may use or reuse the content published on the Websites without prior permission but must adhere to and accept the terms of the Open Government Licence (OGL) v3.0. You must acknowledge the source of the content and include a link to the Open Government Licence wherever possible." The site's WAF answers `/robots.txt` with an "unavailable" page to non-browser agents while the feed itself is served | "Contains public sector information licensed under the Open Government Licence v3.0" with link, on the Sources page | in use, daily; only items mentioning an exploit, vulnerability, breach or incident pass |
| Cisco Security Advisories | `sec.cloudapps.cisco.com/security/center/psirtrss20/CiscoSecurityAdvisory.xml` | public PSIRT feed offered for syndication on the Cisco Security Center | link | in use; only critical or exploited advisories pass |
| Palo Alto Networks Security Advisories | `security.paloaltonetworks.com/rss.xml` | public PSIRT feed offered for syndication | link | in use; same filter |
| Fortinet PSIRT Advisories | `fortiguard.com/rss/ir.xml` (302-redirects to a fortinet.com host) | public PSIRT feed offered for syndication | link | in use; same filter, plus advisories with a CVSSv3 score of 9.0 or above, since Fortinet states severity as a score |

## Research

| Source | Access | Licence / terms | Attribution | Status |
|---|---|---|---|---|
| arXiv cs.CR | `rss.arxiv.org/rss/cs.CR` (daily, weekdays); the API only for backfills, one request every three seconds | Metadata including abstracts is CC0 1.0; terms require at most one request every three seconds and forbid storing or serving e-prints | "Thank you to arXiv for use of its open access interoperability." (footer); links go to abstract pages only | in use, severity 1 by default |

## Structured and historical seeds

| Source | Access | Licence | Attribution | Fields | Status |
|---|---|---|---|---|---|
| AI Incident Database | weekly public Excel export linked from `incidentdatabase.ai/research/snapshots/` (the GraphQL API requires a login) | incident metadata CC BY-SA 4.0; the report text field is excluded from that licence and is never read; terms forbid high-volume bot access, so one download per week | McGregor, S. (2021) "Preventing Repeated Real World AI Failures by Cataloging Incidents: The AI Incident Database." | incident id, date, title, description, deployer, developer, harmed parties, MIT taxonomy, report urls, domains and dates | in use, weekly; selected by MIT risk subdomains 2.2 and 4.2 or security keywords |
| MITRE ATLAS case studies | `raw.githubusercontent.com/mitre-atlas/atlas-data/main/dist/manifest.yaml` → current `v6/ATLAS-YYYY.MM.yaml` | Apache 2.0, © 2021-2026 The MITRE Corporation, approved for public release | link to atlas.mitre.org | id, name, description, type (Incident / Exercise), date, references, target, actor | in use, monthly |
| AVID (AI Vulnerability Database) | `github.com/avidml/avid-db` vulnerability and curated report JSON files | MIT | link | id, description, references, affected artifacts, dates | one-time backfill seed (upstream dormant since 2026-03) |
| NVD CVE API 2.0 | `services.nvd.nist.gov/rest/json/cves/2.0` with `keywordSearch` + `keywordExactMatch` for the allow-listed products, incremental by last-modified date in windows of at most 120 days; 5 requests per 30 s without a key, 50 with a free key | US government work, public domain | "This product uses the NVD API but is not endorsed or certified by the NVD." (footer and record pages) | cve id, published, description, CVSS, references, KEV flag | in use |
| GitHub Advisory Database | `api.github.com/advisories?ecosystem=…&affects=…&modified=>=…` for the allow-listed packages | CC BY 4.0 | link to github.com/advisories | ghsa id, cve id, summary, description, severity, affected packages and ranges, dates | in use |
| Have I Been Pwned breaches | `haveibeenpwned.com/api/v3/breaches` (no API key needed for this endpoint; an identifying User-Agent is required on every request), daily | breach API is CC BY 4.0: "you must identify Have I Been Pwned as the source of the data. Clear and visible attribution with a link to haveibeenpwned.com should be present anywhere data from the service is used" | "Breach data from Have I Been Pwned" with link (footer and Sources page) | name, title, domain, breach date, added date, account count, description, data classes, verified / spam-list / stealer-log / malware / fabricated / retired flags | in use; verified breaches of 100,000+ accounts added in the last 30 days; the description is read as a classifier hint only and never stored |

## Reference frameworks

Not fetched by the collector. Their ids and names are copied into `lib/taxonomy.ts`, which maps each category to them (see the Methodology page, "Standards mapping"). Checked again when a new edition or release appears.

| Framework | Version used | Verified from | Licence | Attribution | Used for |
|---|---|---|---|---|---|
| OWASP Top 10 for LLM Applications | 2025 edition (LLM01-LLM10) | `genai.owasp.org/llm-top-10/` and each entry's `genai.owasp.org/llmrisk/…` page, 2026-10-18 | CC BY-SA 4.0 ("Unless otherwise specified, all content on the site is Creative Commons Attribution-ShareAlike v4.0") | © OWASP Foundation, with link | entry ids, names and links on incident pages, explorer filter, `owasp_llm` export column |
| MITRE ATLAS techniques | data release 2026.09 (`dist/v6/ATLAS-2026.09.yaml`) | `github.com/mitre-atlas/atlas-data`; technique pages at `atlas.mitre.org/techniques/<id>`, 2026-10-18 | Apache 2.0, © 2021-2026 The MITRE Corporation | link to atlas.mitre.org | technique ids, names and links on incident pages, explorer filter, `atlas` export column |

## Sidebar signal

| Source | Access | Licence | Attribution | Status |
|---|---|---|---|---|
| Cloudflare Radar | `api.cloudflare.com/client/v4/radar/…` with an API token (Account › Radar › Read); bot share of HTTP requests, top AI crawlers, crawl purpose; refreshed every six days | data CC BY-NC 4.0 | "Cloudflare Radar" with link | shown only when a token is configured; not part of the incident dataset |

## Fetching rules

- Descriptive User-Agent on every request (`gcd-ai-radar/…` with a link to the repository).
- Timeouts, three retries with exponential backoff, gzip, a 3 MB body cap; one failing source never stops the run.
- Page fetches for metadata (sitemap sources, link enrichment) check the host's robots.txt first and fetch each page at most once.
- Rate limits documented by a source are honoured (arXiv 3 s, NVD 6.5 s without a key, GDELT 30 s between queries).
