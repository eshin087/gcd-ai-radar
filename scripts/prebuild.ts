/**
 * Runs before `next build` (npm "prebuild" hook). Produces everything under
 * /public that is derived from /data so the static export can serve it:
 *
 *   public/data/incidents.json        full dataset (published incidents)
 *   public/data/incidents.min.json    slim copy for the client-side incidents list
 *   public/data/incidents.csv         spreadsheet-friendly export
 *   public/data/incidents/<slug>.json one file per incident
 *   public/data/meta.json             counts, last run, generation time
 *   public/feed.xml                   RSS of the 50 most recently reported incidents
 *   public/og/*.png                   chart images for sharing (satori + sharp)
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { lastUpdated, loadIncidents, siteUrl } from "../lib/data";
import type { Incident } from "../lib/schema";
import { SITE } from "../lib/site";
import { slim } from "../lib/slim";
import { CATEGORY_META, SEVERITY_META, TYPE_META } from "../lib/taxonomy";
import { isDisclosedIncident, recordKind } from "../lib/counting";
import { renderOgImages } from "./og";

const PUBLIC = path.join(process.cwd(), "public");

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
}

function csvCell(v: unknown): string {
  const s = Array.isArray(v) ? v.join("; ") : String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(incidents: Incident[]): string {
  const cols = [
    "id", "slug", "title", "type", "categories", "severity", "targets", "products", "incident_date",
    "incident_date_precision", "first_reported", "source_count", "confidence", "origin", "record_kind", "tags", "summary", "first_source_url", "url",
  ];
  const lines = [cols.join(",")];
  const base = siteUrl();
  for (const i of incidents) {
    const row: Record<string, unknown> = { ...i, record_kind: recordKind(i), first_source_url: i.sources[0]?.url ?? "", url: `${base}/incidents/${i.slug}` };
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

async function main() {
  const { incidents } = await loadIncidents();
  const updated = await lastUpdated();
  const base = siteUrl();
  const dataDir = path.join(PUBLIC, "data");
  const perIncident = path.join(dataDir, "incidents");
  await fs.rm(perIncident, { recursive: true, force: true });
  await fs.mkdir(perIncident, { recursive: true });

  const sorted = [...incidents].sort((a, b) => b.first_reported.localeCompare(a.first_reported) || b.id.localeCompare(a.id));
  const counted = sorted.filter((i) => !isDisclosedIncident(i));
  await fs.writeFile(path.join(dataDir, "incidents.json"), JSON.stringify(sorted, null, 1) + "\n");
  await fs.writeFile(path.join(dataDir, "incidents.min.json"), JSON.stringify(sorted.map(slim)) + "\n");
  await fs.writeFile(path.join(dataDir, "incidents.csv"), toCsv(sorted));
  await Promise.all(sorted.map((i) => fs.writeFile(path.join(perIncident, `${i.slug}.json`), JSON.stringify(i, null, 1) + "\n")));
  await fs.writeFile(
    path.join(dataDir, "meta.json"),
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        site: base,
        records: sorted.length,
        incidents: counted.length,
        disclosed_vulnerabilities: sorted.length - counted.length,
        counting_rule: "CVEs and advisories with no confirmed exploitation are disclosed vulnerabilities, not incidents; see /methodology#cves",
        last_collector_run: updated,
        license: "CC BY-SA 4.0",
        license_url: SITE.dataLicense.url,
      },
      null,
      2,
    ) + "\n",
  );
  // the feed carries incidents; disclosed vulnerabilities arrive in vendor batches and would drown it
  await fs.writeFile(path.join(PUBLIC, "feed.xml"), rss(counted, base, updated));

  const t0 = Date.now();
  const written = await renderOgImages(
    { incidents: counted, disclosed: sorted.length - counted.length, now: new Date(), siteHost: base.replace(/^https?:\/\//, "") },
    path.join(PUBLIC, "og"),
  );
  console.log(
    `prebuild: ${sorted.length} records (${counted.length} incidents, ${sorted.length - counted.length} disclosed vulnerabilities) → public/data (+${sorted.length} per-incident files), public/feed.xml, ${written.length} OG images in ${Date.now() - t0} ms (site ${base})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
