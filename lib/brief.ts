import { timelineOf, type FullIncident } from "./lifecycle";
import { LANE_META, PATCH_META, SEVERITY_META, TYPE_META } from "./taxonomy";

/**
 * The brief: one record as a self-contained Markdown note for a coding
 * agent or an analyst (the "Copy brief" button, and the `brief` field of
 * /data/incidents/<slug>.json). Plain Markdown, no HTML, every fact from the
 * record, and a closing reminder to verify against the vendor's advisory.
 */

const LATEST = 5;

function line(label: string, value: string | null | undefined): string {
  return value ? `- ${label}: ${value}\n` : "";
}

export function buildBrief(i: FullIncident, site: string): string {
  const url = `${site}/incidents/${i.slug}`;
  const sev = SEVERITY_META[i.severity];
  const timeline = timelineOf(i);
  const latest = timeline.slice(-LATEST).reverse();
  const out: string[] = [];
  out.push(`# ${i.title}\n`);
  out.push(`${url} · ${i.id} · ${i.state === "live" ? "live" : `closed${i.closed_at ? ` ${i.closed_at}` : ""}`}\n`);
  out.push(
    `- Lane: ${LANE_META[i.lane].label}\n` +
      `- Severity: ${i.severity} (${sev.label})${i.severity_note ? `: ${i.severity_note}` : ""}\n` +
      `- Fix status: ${PATCH_META[i.patch_status].label}\n` +
      `- First reported: ${i.first_reported}${i.incident_date !== i.first_reported ? ` (happened ${i.incident_date})` : ""}\n` +
      `- AI role: ${TYPE_META[i.type].label}\n` +
      line("Products", i.products.join(", ")) +
      line("CVE ids", i.cve_ids.join(", ")) +
      line("CVSS", i.cvss === null ? null : String(i.cvss)),
  );
  out.push(`## Summary\n\n${i.summary}\n`);
  out.push(`## What to do\n\n${i.action || "No action recorded; read the sources below and the vendor's advisory."}\n`);
  if (i.affected.length || i.fixed_in.length) {
    out.push(`## Affected and fixed versions\n\n${i.affected.map((a) => `- Affected: ${a}`).join("\n")}${i.affected.length && i.fixed_in.length ? "\n" : ""}${i.fixed_in.map((f) => `- Fixed in: ${f}`).join("\n")}\n`);
  }
  if (latest.length) {
    out.push(`## Latest updates\n\n${latest.map((t) => `- ${t.date}: ${t.title}${t.source_url ? ` (${t.source_url})` : ""}`).join("\n")}\n`);
  }
  out.push(`## Sources\n\n${i.sources.map((s) => `- ${s.published_at} ${s.publisher}: ${s.title} ${s.url}`).join("\n")}\n`);
  out.push(`Verify against the vendor's advisory before changing production. Data CC BY-SA 4.0, ${site}.`);
  return out.join("\n");
}
