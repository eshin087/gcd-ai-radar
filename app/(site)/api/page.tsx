import { promises as fs } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import Link from "next/link";
import { RuleText } from "@/components/ui/RuleText";
import {
  META_FIELDS,
  ROW_FIELDS,
  SUMMARY_FIELDS,
  YEAR_INDEX_FIELDS,
  incidentFields,
  slimFields,
  type FieldDoc,
} from "@/lib/api-docs";
import { VULN_DB_PUBLISHERS } from "@/lib/counting";
import { COUNTING_RULES, DISCLOSED_RULE } from "@/lib/counting-rules";
import { CSV_COLUMNS } from "@/lib/csv";
import { lastUpdated, loadIncidents, siteUrl } from "@/lib/data";
import { OG_IMAGES } from "@/lib/og-list";
import { SITE } from "@/lib/site";
import { buildSummary } from "@/lib/summary";
import { REAL_WORLD_MIN_SEVERITY } from "@/lib/taxonomy";
import vercel from "@/vercel.json";

export const metadata: Metadata = {
  title: "API",
  description: `Every public file ${SITE.name} publishes, with its URL, fields, update cadence and cache headers, the counting rules to respect, how to cite the data, and an embeddable card.`,
};

/** The date the files below were first documented and promised. */
const STABLE_SINCE = "2026-10-18";

const CHANGES = [
  { date: "2026-10-18", text: "API documented. summary.json added. /embed card added. Existing files and fields documented as they were; nothing renamed." },
] as const;

const SECTIONS = [
  ["quick-start", "Quick start"],
  ["files", "Files"],
  ["cadence", "Updates and caching"],
  ["summary", "summary.json"],
  ["fields", "Record fields"],
  ["counting", "Counting rules"],
  ["embed", "Embed"],
  ["attribution", "Attribution"],
  ["changes", "Stability and changes"],
] as const;

async function sizeOf(rel: string): Promise<string | null> {
  try {
    const stat = await fs.stat(path.join(process.cwd(), "public", rel));
    const kb = stat.size / 1024;
    return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(kb))} KB`;
  } catch {
    return null;
  }
}

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="text-lg font-semibold tracking-tight text-ink pt-8 border-t border-line-soft scroll-mt-20">
      {children}
    </h2>
  );
}

function Code({ children, label }: { children: string; label?: string }) {
  return (
    <figure className="space-y-1">
      {label && <figcaption className="label">{label}</figcaption>}
      <pre className="panel overflow-x-auto p-3 text-[12px] leading-relaxed text-soft">
        <code className="font-mono">{children}</code>
      </pre>
    </figure>
  );
}

function FieldTable({ fields }: { fields: readonly FieldDoc[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="label text-left">
            <th className="py-2 pr-4 font-normal">field</th>
            <th className="py-2 pr-4 font-normal">type</th>
            <th className="py-2 font-normal">meaning</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((f) => (
            <tr key={f.name} className="border-t border-line-soft align-top">
              <td className="num py-1.5 pr-4 text-ink whitespace-nowrap">{f.name}</td>
              <td className="num py-1.5 pr-4 text-dim min-w-[10rem]">{f.type}</td>
              <td className="py-1.5 text-soft min-w-[14rem]">
                {f.note}
                {f.values && <div className="num mt-0.5 text-[11px] text-dim break-words">{f.values.join(" · ")}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function asFields(map: Record<string, { type: string; note: string }>): FieldDoc[] {
  return Object.entries(map).map(([name, d]) => ({ name, ...d }));
}

export default async function ApiPage() {
  const [{ incidents }, updated] = await Promise.all([loadIncidents(), lastUpdated()]);
  const base = siteUrl();
  const summary = buildSummary(incidents, { now: new Date(), site: base, lastUpdated: updated });

  const files = [
    { href: "/data/summary.json", label: "summary.json", stable: true, blurb: "The headline numbers and the last 24 months, in one small file. Start here for a widget or a newsletter line." },
    { href: "/data/meta.json", label: "meta.json", stable: true, blurb: "Record counts per year, last collector run, generation time and licence." },
    { href: "/data/incidents.json", label: "incidents.json", stable: true, blurb: "Every published record with all fields and every source: incidents and disclosed vulnerabilities together." },
    { href: "/data/incidents.min.json", label: "incidents.min.json", stable: true, blurb: "Every record without the sources array, with publishers and a disclosed flag." },
    { href: "/data/incidents.csv", label: "incidents.csv", stable: true, blurb: "One row per record, with a record_kind column; list fields joined with \"; \"." },
    { href: "/data/years/index.json", label: "years/index.json", stable: true, blurb: "The years of first report that have records, with counts and file paths." },
    { href: "/data/years/<year>.json", label: "years/<year>.json", stable: true, blurb: "The full records first reported in one year." },
    { href: "/data/incidents/<slug>.json", label: "incidents/<slug>.json", stable: true, blurb: "One full record plus a brief field: the record as a Markdown note for an agent or a ticket. The slug is the one in /incidents/<slug>." },
    { href: "/feed.xml", label: "feed.xml", stable: true, blurb: "RSS 2.0: the 50 most recently reported incidents, every lane (no disclosed vulnerabilities)." },
    { href: "/feed.json", label: "feed.json", stable: true, blurb: "The same as JSON Feed 1.1, with lane, type, severity, state, fix status and CVE ids under _radar." },
    { href: "/changes.json", label: "changes.json", stable: true, blurb: "The newest 500 timeline updates across every record, newest first by added_at. Poll it with If-None-Match." },
    { href: "/llms.txt", label: "llms.txt", stable: true, blurb: "The site for an AI agent: the rules, the endpoints, the lanes, the top tags and one line per live record." },
    { href: "/live.json", label: "live.json", stable: true, blurb: "The home page's counters and per-lane counts." },
    { href: "/lanes/patch/feed.xml", label: "lanes/<lane>/{feed.xml, feed.json, changes.json, llms.txt}", stable: true, blurb: "The four files above per lane: patch, breach, supply_chain, research." },
    { href: "/tags/rce/feed.xml", label: "tags/<tag>/{feed.xml, llms.txt}, tags/<tag>.json", stable: true, blurb: "Per tag: an RSS feed, an llms.txt, and a JSON file with the tag's counts, months and records." },
    { href: "/og/default.png", label: "og/<name>.png", stable: true, blurb: `1200×630 chart images: ${OG_IMAGES.map((i) => i.file).join(", ")}.` },
    { href: "/data/slim/<year>.json", label: "slim/<year>.json", stable: false, blurb: "Slim records per year, what the incidents explorer loads. Internal." },
    { href: "/data/rows/<year>.json", label: "rows/<year>.json", stable: false, blurb: "Compact rows per year, what the dashboard's lists load. Internal." },
    { href: "/data/search-index.json", label: "search-index.json", stable: false, blurb: "Token index for the explorer's search box. Internal." },
  ];
  const sized = await Promise.all(files.map(async (f) => ({ ...f, size: f.href.includes("<") ? null : await sizeOf(f.href) })));

  const cacheRules = vercel.headers.filter((r) => ["/data/(.*)", "/feed.xml", "/og/(.*)"].includes(r.source));
  const consumerRules = COUNTING_RULES.filter((r) => r.forConsumers);
  const t12 = summary.trailing_12;
  const excerpt = JSON.stringify(
    { generated_at: summary.generated_at, trailing_12: t12, monthly: summary.monthly.slice(-2), "…": "…" },
    null,
    2,
  );
  const embedSrc = `${base}/embed?theme=dark&amp;window=12m`;
  const snippet = `<iframe src="${embedSrc}"
  title="${SITE.name}: AI security incidents (the AI lens), last 12 months"
  width="360" height="260" loading="lazy"
  style="border:0;max-width:100%"></iframe>
<noscript><a href="${base}">${SITE.name}: AI security incidents</a></noscript>`;
  const compactSnippet = `<iframe src="${base}/embed?theme=light&amp;compact=1"
  title="${SITE.name}: AI security incidents (the AI lens), last 12 months"
  width="360" height="150" loading="lazy"
  style="border:0;max-width:100%"></iframe>
<noscript><a href="${base}">${SITE.name}: AI security incidents</a></noscript>`;
  const citation = `${SITE.name}, ${base} (accessed YYYY-MM-DD). Data licensed ${SITE.dataLicense.name}.`;
  const citationHtml = `Source: <a href="${base}">${SITE.name}</a>, accessed YYYY-MM-DD.
Data licensed <a href="${SITE.dataLicense.url}">${SITE.dataLicense.name}</a>.`;

  return (
    <div className="max-w-4xl text-[15px] leading-relaxed text-soft space-y-5">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">API</h1>
        <p>
          Every number on {SITE.name} comes from static files anyone can fetch: no key, no sign-up, open to scripts on any site. This page lists each
          file with its fields, says how often it changes, and states the counting rules a figure must keep when it is carried elsewhere. Carry the
          numbers, cite the site and link back.
        </p>
        <p className="num text-[12.5px] text-dim">
          stable since {STABLE_SINCE} · <a href="#changes" className="link">change policy</a>
        </p>
        <nav aria-label="Sections" className="flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
          {SECTIONS.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="link">
              {label}
            </a>
          ))}
        </nav>
      </header>

      <H2 id="quick-start">Quick start</H2>
      <p>
        For the headline figures, fetch <span className="num text-[13px] text-ink">summary.json</span>. As of this build it says{" "}
        <span className="num text-ink">{t12.incidents.toLocaleString("en-US")}</span> incidents in the 12 months from{" "}
        <span className="num">{t12.from}</span> to <span className="num">{t12.to}</span>, of which{" "}
        <span className="num text-ink">{t12.real_world.toLocaleString("en-US")}</span> real-world.
      </p>
      <Code label="curl">{`curl -s ${base}/data/summary.json
curl -s ${base}/data/summary.json | jq '.trailing_12'
curl -sO ${base}/data/incidents.csv`}</Code>
      <Code label="fetch (browser or Node 18+)">{`const res = await fetch("${base}/data/summary.json");
const s = await res.json();
const t = s.trailing_12;
console.log(\`\${t.incidents} AI security incidents (the AI lens) from \${t.from} to \${t.to}\`
  + \` (\${t.real_world} real-world), source: ${SITE.name}, ${base}\`);`}</Code>

      <H2 id="files">Files</H2>
      <p className="text-[13.5px]">
        All paths are on <span className="num text-[12.5px]">{base}</span>. Stable files follow the{" "}
        <a href="#changes" className="link">change policy</a>; internal files serve this site&rsquo;s own pages and may change shape without notice.
      </p>
      <ul className="divide-y divide-line-soft border-y border-line-soft">
        {sized.map((f) => (
          <li key={f.href} className="py-2.5 grid gap-1 sm:grid-cols-[13rem_1fr_4.5rem] sm:items-baseline">
            {f.href.includes("<") ? (
              <span className="num text-ink">{f.label}</span>
            ) : (
              <a href={f.href} className="num text-ink hover:text-accent">
                {f.label}
              </a>
            )}
            <span className="text-[12.5px] text-dim">
              {!f.stable && <span className="label mr-2 text-faint">internal</span>}
              {f.blurb}
            </span>
            <span className="num text-[11px] text-faint sm:text-right">{f.size ?? ""}</span>
          </li>
        ))}
      </ul>

      <H2 id="cadence">Updates and caching</H2>
      <ul className="list-disc pl-5 space-y-1">
        <li>
          The collector runs on a fixed schedule (the Sources page lists it per source). A run that finds something commits to the repository, and every
          commit redeploys the site, which regenerates every file on this page.
        </li>
        <li>
          Each JSON file says when it was made: <span className="num text-[13px]">generated_at</span> for the deploy and{" "}
          <span className="num text-[13px]">last_collector_run</span> for the data. Polling more than once an hour gains nothing.
        </li>
        <li>Records change after publication: sources are added, severities rise when exploitation is confirmed, duplicates are merged. Refetch rather than append.</li>
      </ul>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="label text-left">
              <th className="py-2 pr-4 font-normal">path</th>
              <th className="py-2 font-normal">response headers</th>
            </tr>
          </thead>
          <tbody>
            {cacheRules.map((r) => (
              <tr key={r.source} className="border-t border-line-soft align-top">
                <td className="num py-1.5 pr-4 text-ink whitespace-nowrap">{r.source.replace("(.*)", "*")}</td>
                <td className="num py-1.5 text-dim">
                  {r.headers.map((h) => (
                    <div key={h.key}>
                      {h.key}: {h.value}
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[13px] text-dim">
        Read from the site&rsquo;s <span className="num text-[12px]">vercel.json</span>. Every response also carries the site&rsquo;s security headers;
        everything except <span className="num text-[12px]">/embed</span> refuses to be framed.
      </p>

      <H2 id="summary">summary.json</H2>
      <p>
        The headline numbers, computed by the same functions as the dashboard on the same records. Months are placed by incident date; incidents known
        only to the year count in <span className="num text-[13px]">totals</span> but in no month or window. Percent changes are rounded to a tenth, and
        are <span className="num text-[13px]">null</span> when the earlier period had none (the dashboard shows that as &ldquo;new&rdquo;).
      </p>
      <FieldTable fields={asFields(SUMMARY_FIELDS)} />
      <Code label="excerpt, as of this build">{excerpt}</Code>

      <H2 id="fields">Record fields</H2>
      <h3 className="text-[14px] font-medium text-ink">Full record</h3>
      <p className="text-[13.5px]">
        In incidents.json, years/&lt;year&gt;.json and incidents/&lt;slug&gt;.json. Types are generated from the validation schema, so a record that
        does not match them is never published. Definitions of each value are on the{" "}
        <Link href="/methodology#taxonomy" className="link">
          methodology page
        </Link>
        .
      </p>
      <FieldTable fields={incidentFields()} />

      <h3 className="text-[14px] font-medium text-ink pt-2">Slim record</h3>
      <p className="text-[13.5px]">In incidents.min.json: the full record without sources, confidence, status, tags and timestamps, plus two fields.</p>
      <FieldTable fields={slimFields()} />

      <h3 className="text-[14px] font-medium text-ink pt-2">incidents.csv</h3>
      <p className="text-[13.5px]">
        Columns in this order. List fields (categories, targets, products, tags) are joined with &ldquo;; &rdquo;.{" "}
        <span className="num text-[12.5px]">record_kind</span> is <span className="num text-[12.5px]">incident</span> or{" "}
        <span className="num text-[12.5px]">disclosed_vulnerability</span>; <span className="num text-[12.5px]">first_source_url</span> is the first
        source&rsquo;s link and <span className="num text-[12.5px]">url</span> the record&rsquo;s page here.{" "}
        <span className="num text-[12.5px]">owasp_llm</span> and <span className="num text-[12.5px]">atlas</span> list the OWASP LLM Top 10 entries and
        MITRE ATLAS techniques an incident maps to; they are derived from its type and categories, not classified per record (
        <Link href="/methodology#standards" className="link">
          standards mapping
        </Link>
        ), and meta.json names the editions. A cell that a spreadsheet would run as a formula is prefixed with a single quote.
      </p>
      <p className="num text-[12px] text-dim break-words">{CSV_COLUMNS.join(", ")}</p>

      <h3 className="text-[14px] font-medium text-ink pt-2">meta.json</h3>
      <FieldTable fields={asFields(META_FIELDS)} />

      <h3 className="text-[14px] font-medium text-ink pt-2">years/index.json</h3>
      <FieldTable fields={asFields(YEAR_INDEX_FIELDS)} />

      <h3 className="text-[14px] font-medium text-ink pt-2">feed.xml and feed.json</h3>
      <p className="text-[13.5px]">
        RSS 2.0. Each item has the title, a link to the record&rsquo;s page, the record id as a non-permalink guid, the first-report date as pubDate, a
        description (summary, the action when there is one, severity, lane, fix status, AI role, source count), and categories: the lane, the incident
        categories and the tag slugs. feed.json is the same list as JSON Feed 1.1; each item carries the lifecycle under <span className="num">_radar</span>{" "}
        (lane, type, severity, state, patch_status, cve_ids). The lane feeds under /lanes/&lt;lane&gt;/ and the tag feeds under /tags/&lt;tag&gt;/ have the same shape.
      </p>

      <h3 className="text-[14px] font-medium text-ink pt-2">changes.json</h3>
      <p className="text-[13.5px]">
        The newest 500 timeline entries across every record, newest first by <span className="num">added_at</span> (when the site learned of the entry), each
        with the record&rsquo;s id, slug, title, lane, type, severity, state and fix status, the entry&rsquo;s date, text and source URL, and the record&rsquo;s
        page. Poll it with <span className="num">If-None-Match</span>; it changes only when a deploy adds entries. Per lane under /lanes/&lt;lane&gt;/changes.json.
      </p>

      <h3 className="text-[14px] font-medium text-ink pt-2">llms.txt</h3>
      <p className="text-[13.5px]">
        Plain Markdown for an agent: what the site is, the counting and curation rules, the endpoints, the lanes with their counts, the top tags, and one line
        per live record with its lane, severity, fix status, first-report date and CVE ids. The same file per lane and per tag.
      </p>

      <h3 className="text-[14px] font-medium text-ink pt-2">Internal files</h3>
      <p className="text-[13.5px]">
        rows/&lt;year&gt;.json holds compact rows ({ROW_FIELDS.join(", ")}); slim/&lt;year&gt;.json holds slim records; search-index.json maps title,
        id and product tokens to records. They exist for this site&rsquo;s pages and are not covered by the change policy. Use the stable files instead.
      </p>

      <H2 id="counting">Counting rules</H2>
      <p>A figure carried from these files means what it means here only if it keeps these rules. Quoted from the methodology:</p>
      <ul className="list-disc pl-5 space-y-1">
        {consumerRules.map((r) => (
          <li key={r.id}>
            <RuleText text={r.text} />
          </li>
        ))}
        <li>
          Severity {REAL_WORLD_MIN_SEVERITY} and above is what the site calls <em>real-world</em>.
        </li>
      </ul>
      <p>
        <strong className="text-ink">Disclosed vulnerabilities.</strong> {DISCLOSED_RULE}
      </p>
      <p className="text-[13.5px]">
        In code: <span className="num text-[12.5px]">severity &lt; 3</span>, and either <span className="num text-[12.5px]">origin</span> is{" "}
        <span className="num text-[12.5px]">seed_nvd</span> or <span className="num text-[12.5px]">seed_ghsa</span>, or every source&rsquo;s publisher is
        one of {[...VULN_DB_PUBLISHERS].map((p) => `“${p}”`).join(", ")}. summary.json, meta.json and feed.xml already apply it; incidents.min.json
        carries it as <span className="num text-[12.5px]">disclosed</span> and incidents.csv as <span className="num text-[12.5px]">record_kind</span>.
        incidents.json and the year files hold both kinds without a flag, so apply the rule before counting them.
      </p>
      <p className="text-[13.5px]">
        Full context, including the known limits of the numbers, is on the{" "}
        <Link href="/methodology#counting" className="link">
          methodology page
        </Link>
        .
      </p>

      <H2 id="embed">Embed</H2>
      <p>
        A card with the trailing count, its change, the real-world count and the monthly bars, linking back here. It is plain HTML that renders without
        JavaScript; with JavaScript it also fetches summary.json, so a copy cached by your page still shows the latest figures.
      </p>
      <Code label="html">{snippet}</Code>
      <Code label="compact, light">{compactSnippet}</Code>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="label text-left">
              <th className="py-2 pr-4 font-normal">option</th>
              <th className="py-2 pr-4 font-normal">values</th>
              <th className="py-2 font-normal">effect</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-line-soft">
              <td className="num py-1.5 pr-4 text-ink">theme</td>
              <td className="num py-1.5 pr-4 text-dim">dark (default) | light</td>
              <td className="py-1.5">Colours for a dark or a light page.</td>
            </tr>
            <tr className="border-t border-line-soft">
              <td className="num py-1.5 pr-4 text-ink">window</td>
              <td className="num py-1.5 pr-4 text-dim">12m (default) | 24m</td>
              <td className="py-1.5">The trailing window counted and drawn, compared with the window before it.</td>
            </tr>
            <tr className="border-t border-line-soft">
              <td className="num py-1.5 pr-4 text-ink">compact</td>
              <td className="num py-1.5 pr-4 text-dim">1</td>
              <td className="py-1.5">One line of figures without the bars: 150 px tall at 320 px wide, 100 px from 480 px wide.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-[13px] text-dim">Any other value falls back to the default. The card fills the iframe: 260 px tall fits every width from 320 px, and from 480 px wide, where the bars sit beside the figures, 190 px is enough.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <iframe src="/embed?theme=dark&window=12m" title={`${SITE.name} embed, dark`} width="360" height="260" loading="lazy" className="w-full max-w-[360px] border-0" />
        <iframe src="/embed?theme=light&window=24m" title={`${SITE.name} embed, light, 24 months`} width="360" height="260" loading="lazy" className="w-full max-w-[360px] border-0" />
        <iframe src="/embed?compact=1" title={`${SITE.name} embed, compact`} width="360" height="150" loading="lazy" className="w-full max-w-[360px] border-0" />
      </div>

      <H2 id="attribution">Attribution</H2>
      <p>
        The data is{" "}
        <a className="link" href={SITE.dataLicense.url}>
          {SITE.dataLicense.name}
        </a>
        . Reuse it, including commercially, as long as you credit {SITE.name} with a link and the date you accessed it, say if you changed it, and
        release a derived dataset under the same licence. Upstream sources carry their own notices, listed on the{" "}
        <Link href="/data" className="link">
          data page
        </Link>
        ; keep them when you redistribute records.
      </p>
      <Code label="cite as">{citation}</Code>
      <Code label="cite as, html">{citationHtml}</Code>

      <H2 id="changes">Stability and changes</H2>
      <p className="num text-[13px] text-ink">Stable since {STABLE_SINCE}.</p>
      <ul className="list-disc pl-5 space-y-1">
        <li>New fields may appear in any stable file at any time. Read the fields you need and ignore the rest.</li>
        <li>Existing fields are not renamed, removed or given a new meaning without an entry in the change log below.</li>
        <li>A breaking change to summary.json also raises its version.</li>
        <li>Counts change when the data does: records are added, merged and reclassified. A change to how things are counted goes in the methodology&rsquo;s change log.</li>
        <li>Internal files are not covered.</li>
      </ul>
      <h3 className="text-[13px] font-medium text-ink mt-4">Change log</h3>
      <ul className="list-disc pl-5 space-y-1 num text-[12.5px]">
        {CHANGES.map((c) => (
          <li key={c.date + c.text}>
            {c.date} · {c.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
