import { CURATION_RULES } from "./curation-rules";
import { type FullIncident } from "./lifecycle";
import { SITE } from "./site";
import { tagSlugsOf, type TagEntry } from "./tags";
import { LANE_META, LANES, PATCH_META, SEVERITY_META, type Lane } from "./taxonomy";

/**
 * llms.txt (llmstxt.org): what the site is, the rules behind its numbers,
 * the endpoints, and one line per live record, so an agent can read the
 * live picture in one request. One for the site, one per lane, one per tag.
 */

export type LlmsScope = { kind: "site" } | { kind: "lane"; lane: Lane } | { kind: "tag"; tag: Pick<TagEntry, "slug" | "label" | "group"> };

export interface LlmsInput {
  site: string;
  /** Every published record (lifecycle keys present). */
  incidents: readonly FullIncident[];
  /** The directory tags, most records first. */
  tags: readonly Pick<TagEntry, "slug" | "label" | "live" | "total">[];
  scope: LlmsScope;
  now: Date;
}

export const LLMS_MAX_LIVE = 400;
export const LLMS_MAX_TAGS = 30;

function count(incidents: readonly FullIncident[], lane: Lane): { live: number; total: number } {
  let live = 0;
  let total = 0;
  for (const i of incidents) {
    if (i.lane !== lane) continue;
    total += 1;
    if (i.state === "live") live += 1;
  }
  return { live, total };
}

export function buildLlmsTxt(input: LlmsInput): string {
  const { site, scope } = input;
  const records =
    scope.kind === "lane" ? input.incidents.filter((i) => i.lane === scope.lane) : scope.kind === "tag" ? input.incidents.filter((i) => tagSlugsOf(i).includes(scope.tag.slug)) : input.incidents;
  const live = records.filter((i) => i.state === "live").sort((a, b) => b.first_reported.localeCompare(a.first_reported) || a.id.localeCompare(b.id));
  const title = scope.kind === "site" ? SITE.name : scope.kind === "lane" ? `${SITE.name} · ${LANE_META[scope.lane].label}` : `${SITE.name} · tag: ${scope.tag.label}`;
  const base = scope.kind === "lane" ? `${site}/lanes/${scope.lane}` : scope.kind === "tag" ? `${site}/tags/${scope.tag.slug}` : site;
  const lines: string[] = [];
  lines.push(`# ${title}`, "");
  lines.push(`> ${SITE.tagline}. ${scope.kind === "site" ? "Live security incidents across the web, with an AI lens" : scope.kind === "lane" ? LANE_META[scope.lane].definition : `Records tagged ${scope.tag.label}`}: ${live.length} live, ${records.length} on record. Generated ${input.now.toISOString()}.`, "");
  lines.push(
    "Every record is one real-world event or flaw, counted once however many articles cover it, with a lane (patch now, breaches & attacks, supply chain, research), a state (live or closed by the lane's window), a fix status, a severity (1 research, 2 disclosed vulnerability, 3 confirmed exploitation, 4 confirmed real-world loss) and an AI role (attack on AI, AI-enabled attack, or none). CVEs with no confirmed exploitation are disclosed vulnerabilities, never incidents, and the AI counts on the site cover AI records only.",
    "",
  );
  lines.push(`The curation bar for records with no AI role: ${CURATION_RULES.join(" ")}`, "");
  lines.push("## Endpoints", "");
  lines.push(`- ${base}/feed.xml: RSS of the newest incidents`);
  lines.push(`- ${base}/feed.json: the same as JSON Feed 1.1`);
  lines.push(`- ${base}/changes.json: the newest timeline updates, newest first by added_at; poll it with If-None-Match`);
  if (scope.kind === "site") {
    lines.push(`- ${site}/live.json: the live counters and per-lane counts`);
    lines.push(`- ${site}/data/incidents/<slug>.json: one record, with a Markdown "brief" field`);
    lines.push(`- ${site}/data/incidents.json, ${site}/data/incidents.csv: the whole dataset (CC BY-SA 4.0)`);
    lines.push(`- ${site}/lanes/<lane>/llms.txt and ${site}/tags/<tag>/llms.txt: this file per lane and per tag`);
    lines.push(`- ${site}/api: every file documented field by field`);
  }
  lines.push("");
  if (scope.kind !== "tag") {
    lines.push("## Lanes", "");
    for (const lane of LANES) {
      const c = count(input.incidents, lane);
      lines.push(`- ${LANE_META[lane].label} (${lane}): ${c.live} live, ${c.total} on record. ${LANE_META[lane].definition}`);
    }
    lines.push("");
  }
  if (scope.kind === "site" && input.tags.length) {
    lines.push("## Tags", "");
    lines.push(input.tags.slice(0, LLMS_MAX_TAGS).map((t) => `${t.label} (${t.live} live, ${t.total})`).join(" · "));
    lines.push("");
  }
  lines.push(`## Live records (${live.length})`, "");
  if (live.length === 0) lines.push("None.");
  for (const i of live.slice(0, LLMS_MAX_LIVE)) {
    lines.push(`- [${i.title}](${site}/incidents/${i.slug}): ${LANE_META[i.lane].label} · severity ${i.severity} ${SEVERITY_META[i.severity].label} · ${PATCH_META[i.patch_status].label} · first reported ${i.first_reported}${i.cve_ids.length ? ` · ${i.cve_ids.slice(0, 3).join(", ")}` : ""}`);
  }
  if (live.length > LLMS_MAX_LIVE) lines.push(`- and ${live.length - LLMS_MAX_LIVE} more in ${base}/feed.json and the archive`);
  lines.push("");
  lines.push(`Data CC BY-SA 4.0: cite ${SITE.name} with a link. Verify against the vendor's advisory before changing production.`);
  return lines.join("\n") + "\n";
}
