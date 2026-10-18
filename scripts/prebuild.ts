/**
 * Runs before `next build` (npm "prebuild" hook). Produces everything under
 * /public that is derived from /data so the static export can serve it:
 *
 *   public/data/incidents.json      full dataset (published incidents)
 *   public/data/incidents.min.json  slim copy for the client-side incidents list
 *   public/data/incidents.csv       spreadsheet-friendly export
 *   public/data/meta.json           counts, last run, generation time
 *   public/feed.xml                 RSS of the 50 most recently reported incidents
 *
 * OG/PNG chart images are added here in a later step.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { lastUpdated, loadIncidents, siteUrl } from "../lib/data";
import type { Incident } from "../lib/schema";
import { SITE } from "../lib/site";
import { CATEGORY_META, SEVERITY_META, TYPE_META } from "../lib/taxonomy";

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
    "incident_date_precision", "first_reported", "source_count", "confidence", "origin", "tags", "summary", "first_source_url",
  ];
  const lines = [cols.join(",")];
  for (const i of incidents) {
    const row: Record<string, unknown> = { ...i, first_source_url: i.sources[0]?.url ?? "" };
    lines.push(cols.map((c) => csvCell(row[c])).join(","));
  }
  return lines.join("\n") + "\n";
}

function slim(i: Incident) {
  return {
    id: i.id,
    slug: i.slug,
    title: i.title,
    summary: i.summary,
    type: i.type,
    categories: i.categories,
    severity: i.severity,
    targets: i.targets,
    products: i.products,
    incident_date: i.incident_date,
    incident_date_precision: i.incident_date_precision,
    first_reported: i.first_reported,
    source_count: i.source_count,
    publishers: [...new Set(i.sources.map((s) => s.publisher))],
    origin: i.origin,
  };
}

function rss(incidents: Incident[], base: string, updated: string | null): string {
  const items = [...incidents]
    .sort((a, b) => b.first_reported.localeCompare(a.first_reported) || b.id.localeCompare(a.id))
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
  const { incidents, isStub } = await loadIncidents();
  const updated = await lastUpdated();
  const base = siteUrl();
  const dataDir = path.join(PUBLIC, "data");
  await fs.mkdir(dataDir, { recursive: true });

  const sorted = [...incidents].sort((a, b) => b.first_reported.localeCompare(a.first_reported) || b.id.localeCompare(a.id));
  await fs.writeFile(path.join(dataDir, "incidents.json"), JSON.stringify(sorted, null, 1) + "\n");
  await fs.writeFile(path.join(dataDir, "incidents.min.json"), JSON.stringify(sorted.map(slim)) + "\n");
  await fs.writeFile(path.join(dataDir, "incidents.csv"), toCsv(sorted));
  await fs.writeFile(
    path.join(dataDir, "meta.json"),
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        site: base,
        incidents: sorted.length,
        is_stub: isStub,
        last_collector_run: updated,
        license: "CC BY-SA 4.0",
        license_url: SITE.dataLicense.url,
      },
      null,
      2,
    ) + "\n",
  );
  await fs.writeFile(path.join(PUBLIC, "feed.xml"), rss(sorted, base, updated));
  console.log(`prebuild: ${sorted.length} incidents${isStub ? " (STUB)" : ""} → public/data, public/feed.xml (site ${base})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
