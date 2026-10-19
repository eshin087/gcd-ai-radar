/**
 * Runs before `next build` (npm "prebuild" hook). Produces everything under
 * /public that is derived from /data so the static export can serve it:
 *
 *   public/data/incidents.json        full dataset (published records)
 *   public/data/incidents.min.json    slim copy of every record (no sources array), plus the derived owasp_llm and atlas ids
 *   public/data/incidents.csv         spreadsheet-friendly export, with record_kind, owasp_llm and atlas columns
 *   public/data/years/<year>.json     full records per year of first report, plus years/index.json
 *   public/data/rows/<year>.json      compact rows per year: what the dashboard's drawers fetch
 *   public/data/slim/<year>.json      slim records per year: what the incidents explorer fetches
 *   public/data/search-index.json     token index over id, title and products for the explorer's search box
 *   public/data/incidents/<slug>.json one file per incident
 *   public/data/meta.json             counts, last run, generation time
 *   public/data/summary.json          headline numbers and the 24-month series, for widgets (lib/summary.ts)
 *   public/data/briefings/<week>.json the weekly briefings, plus briefings/index.json
 *   public/feed.xml                   RSS of the 50 most recently reported incidents
 *   public/briefing.xml               RSS of the weekly briefings
 *   public/og/*.png                   chart images for sharing (satori + sharp)
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { MetaFile, YearIndexFile } from "../lib/api-docs";
import { briefingSummaryLine } from "../lib/briefing";
import { lastUpdated, loadBriefings, loadIncidents, siteUrl } from "../lib/data";
import type { Briefing, Incident } from "../lib/schema";
import { SITE } from "../lib/site";
import { slim } from "../lib/slim";
import { ATLAS_RELEASE, CATEGORY_META, OWASP_LLM_EDITION, SEVERITY_META, TYPE_META, atlasFor, owaspFor } from "../lib/taxonomy";
import { isDisclosedIncident, recordKind } from "../lib/counting";
import { CSV_COLUMNS, csvCell } from "../lib/csv";
import { compactRow } from "../lib/rows";
import { buildSearchIndex } from "../lib/search";
import { groupByShard } from "../lib/shards";
import { COUNTING_RULE_NOTE, buildSummary } from "../lib/summary";
import { renderOgImages } from "./og";

const PUBLIC = path.join(process.cwd(), "public");

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
}

function toCsv(incidents: Incident[]): string {
  const cols: readonly string[] = CSV_COLUMNS;
  const lines = [cols.join(",")];
  const base = siteUrl();
  for (const i of incidents) {
    const row: Record<string, unknown> = {
      ...i,
      record_kind: recordKind(i),
      // derived from type and categories (lib/taxonomy.ts, /methodology#standards)
      owasp_llm: owaspFor(i),
      atlas: atlasFor(i),
      first_source_url: i.sources[0]?.url ?? "",
      url: `${base}/incidents/${i.slug}`,
    };
    lines.push(cols.map((c) => csvCell(row[c])).join(","));
  }
  return lines.join("\n") + "\n";
}

function rss(incidents: Incident[], base: string, updated: string | null): string {
  const items = incidents
    .slice(0, 50)
    .map((i) => {
      const url = `${base}/incidents/${i.slug}`;
      const cats = i.categories.map((c) => `<category>${escapeXml(CATEGORY_META[c].label)}</category>`).join("");
      const desc = `${i.summary} Severity ${i.severity} (${SEVERITY_META[i.severity].label}). ${TYPE_META[i.type].label}. ${i.source_count} source${i.source_count === 1 ? "" : "s"}.`;
      return `    <item>
      <title>${escapeXml(i.title)}</title>
      <link>${escapeXml(url)}</link>
      <guid isPermaLink="false">${escapeXml(i.id)}</guid>
      <pubDate>${new Date(`${i.first_reported}T12:00:00Z`).toUTCString()}</pubDate>
      <description>${escapeXml(desc)}</description>
      ${cats}
    </item>`;
    })
    .join("\n");
  const lastBuild = updated ? new Date(updated).toUTCString() : new Date().toUTCString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(SITE.name)} — new incidents</title>
    <link>${escapeXml(base)}</link>
    <atom:link href="${escapeXml(base)}/feed.xml" rel="self" type="application/rss+xml" />
    <description>${escapeXml(SITE.description)}</description>
    <language>en</language>
    <lastBuildDate>${lastBuild}</lastBuildDate>
    <copyright>Data CC BY-SA 4.0 · ${escapeXml(SITE.author)}</copyright>
${items}
  </channel>
</rss>
`;
}

function briefingRss(briefings: Briefing[], base: string): string {
  const items = briefings
    .slice(0, 52)
    .map((b) => {
      const url = `${base}/briefing/${b.week}`;
      const title = b.narrative ? `${b.week}: ${b.narrative.headline}` : `This week in AI security, ${b.week}`;
      const notable = b.notable.map((i) => `${i.title} (severity ${i.severity})`).join("; ");
      const desc = [
        `${b.start} to ${b.end}. ${briefingSummaryLine(b)}.`,
        b.narrative ? `${b.narrative.text.replace(/\s+/g, " ")} (Written by a language model from the week's records.)` : "",
        notable ? `Most notable: ${notable}.` : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `    <item>
      <title>${escapeXml(title)}</title>
      <link>${escapeXml(url)}</link>
      <guid isPermaLink="true">${escapeXml(url)}</guid>
      <pubDate>${new Date(b.generated_at).toUTCString()}</pubDate>
      <description>${escapeXml(desc)}</description>
    </item>`;
    })
    .join("\n");
  const lastBuild = briefings[0] ? new Date(briefings[0].generated_at).toUTCString() : new Date().toUTCString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(SITE.name)} — this week in AI security</title>
    <link>${escapeXml(base)}/briefing</link>
    <atom:link href="${escapeXml(base)}/briefing.xml" rel="self" type="application/rss+xml" />
    <description>A weekly briefing on AI cybersecurity incidents: counts from the data, the most notable incidents and a short narrative.</description>
    <language>en</language>
    <lastBuildDate>${lastBuild}</lastBuildDate>
    <copyright>Data CC BY-SA 4.0 · ${escapeXml(SITE.author)}</copyright>
${items}
  </channel>
</rss>
`;
}

async function resetDir(dir: string) {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

async function main() {
  const { incidents } = await loadIncidents();
  const updated = await lastUpdated();
  const base = siteUrl();
  const dataDir = path.join(PUBLIC, "data");
  const perIncident = path.join(dataDir, "incidents");
  const yearsDir = path.join(dataDir, "years");
  const rowsDir = path.join(dataDir, "rows");
  const slimDir = path.join(dataDir, "slim");
  const briefingsDir = path.join(dataDir, "briefings");
  await Promise.all([perIncident, yearsDir, rowsDir, slimDir, briefingsDir].map(resetDir));

  const sorted = [...incidents].sort((a, b) => b.first_reported.localeCompare(a.first_reported) || b.id.localeCompare(a.id));
  const counted = sorted.filter((i) => !isDisclosedIncident(i));
  await fs.writeFile(path.join(dataDir, "incidents.json"), JSON.stringify(sorted, null, 1) + "\n");
  // The download carries the derived standards ids; the explorer's slim shards stay lean and derive them in the browser.
  await fs.writeFile(path.join(dataDir, "incidents.min.json"), JSON.stringify(sorted.map((i) => ({ ...slim(i), owasp_llm: owaspFor(i), atlas: atlasFor(i) }))) + "\n");
  await fs.writeFile(path.join(dataDir, "incidents.csv"), toCsv(sorted));
  await Promise.all(sorted.map((i) => fs.writeFile(path.join(perIncident, `${i.slug}.json`), JSON.stringify(i, null, 1) + "\n")));

  // Year shards: the full records for download, compact rows for the dashboard's drawers, slim records for the explorer.
  const shards = groupByShard(sorted);
  const yearIndex: YearIndexFile["years"] = [];
  for (const [year, records] of shards) {
    const disclosed = records.filter(isDisclosedIncident).length;
    yearIndex.unshift({ year, records: records.length, incidents: records.length - disclosed, disclosed, file: `/data/years/${year}.json` });
    await Promise.all([
      fs.writeFile(path.join(yearsDir, `${year}.json`), JSON.stringify(records, null, 1) + "\n"),
      fs.writeFile(path.join(rowsDir, `${year}.json`), JSON.stringify(records.map(compactRow)) + "\n"),
      fs.writeFile(path.join(slimDir, `${year}.json`), JSON.stringify(records.map(slim)) + "\n"),
    ]);
  }
  const yearIndexFile: YearIndexFile = { generated_at: new Date().toISOString(), years: yearIndex };
  await fs.writeFile(path.join(yearsDir, "index.json"), JSON.stringify(yearIndexFile, null, 2) + "\n");
  const index = buildSearchIndex(sorted);
  await fs.writeFile(path.join(dataDir, "search-index.json"), JSON.stringify(index) + "\n");

  // meta.json and summary.json are documented field by field on /api (lib/api-docs.ts)
  const meta: MetaFile = {
    generated_at: new Date().toISOString(),
    site: base,
    records: sorted.length,
    incidents: counted.length,
    disclosed_vulnerabilities: sorted.length - counted.length,
    counting_rule: COUNTING_RULE_NOTE,
    years: yearIndex.map((y) => ({ year: y.year, records: y.records, incidents: y.incidents, disclosed_vulnerabilities: y.disclosed, file: y.file })),
    last_collector_run: updated,
    standards_mapping: {
      owasp_llm_top_10: OWASP_LLM_EDITION,
      mitre_atlas_release: ATLAS_RELEASE,
      rule: "derived from type and categories, not classified per record; see /methodology#standards",
    },
    license: SITE.dataLicense.name,
    license_url: SITE.dataLicense.url,
  };
  await fs.writeFile(path.join(dataDir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
  const summary = buildSummary(sorted, { now: new Date(), site: base, lastUpdated: updated });
  await fs.writeFile(path.join(dataDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  // the feed carries incidents; disclosed vulnerabilities arrive in vendor batches and would drown it
  await fs.writeFile(path.join(PUBLIC, "feed.xml"), rss(counted, base, updated));

  // Weekly briefings: copied as validated, plus an index, and their own feed.
  const briefings = await loadBriefings();
  await Promise.all(briefings.map((b) => fs.writeFile(path.join(briefingsDir, `${b.week}.json`), JSON.stringify(b, null, 2) + "\n")));
  await fs.writeFile(
    path.join(briefingsDir, "index.json"),
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        briefings: briefings.map((b) => ({
          week: b.week,
          start: b.start,
          end: b.end,
          generated_at: b.generated_at,
          incidents: b.counts.incidents,
          real_world: b.counts.real_world,
          disclosed_vulnerabilities: b.counts.disclosed_vulnerabilities,
          headline: b.narrative?.headline ?? null,
          file: `/data/briefings/${b.week}.json`,
          url: `${base}/briefing/${b.week}`,
        })),
      },
      null,
      2,
    ) + "\n",
  );
  await fs.writeFile(path.join(PUBLIC, "briefing.xml"), briefingRss(briefings, base));

  const t0 = Date.now();
  const written = await renderOgImages(
    { incidents: counted, disclosed: sorted.length - counted.length, now: new Date(), siteHost: base.replace(/^https?:\/\//, "") },
    path.join(PUBLIC, "og"),
  );
  console.log(
    `prebuild: ${sorted.length} records (${counted.length} incidents, ${sorted.length - counted.length} disclosed vulnerabilities) → public/data (${shards.size} year shards × 3, ${Object.keys(index.tokens).length} search tokens, +${sorted.length} per-incident files), public/data/summary.json, public/feed.xml, ${briefings.length} briefings + public/briefing.xml, ${written.length} OG images in ${Date.now() - t0} ms (site ${base})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
