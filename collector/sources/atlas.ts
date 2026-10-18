import YAML from "yaml";
import { canonicalUrl, urlKey } from "../lib/canonical";
import { httpFetch } from "../lib/http";
import { nowIso } from "../lib/ids";
import { log } from "../lib/log";
import { publisherFor } from "../lib/publishers";
import { truncate } from "../lib/text";
import { lookbackStart } from "./rss";
import type { Candidate, SourceAdapter } from "./types";

/**
 * MITRE ATLAS case studies (Apache 2.0, © MITRE). The distributed YAML holds
 * every case study under `case-studies`; the manifest points at the current
 * release file. Studies of type "Exercise" are red-team or research
 * demonstrations (severity 1); "Incident" studies are real-world events.
 */

const HINT =
  "MITRE ATLAS case study. Type 'Incident' = real-world event (severity 3 or 4 depending on impact); type 'Exercise' = red-team or research demonstration (severity 1). incident_date is given in the note.";

interface CaseStudy {
  id: string;
  name: string;
  summary?: string;
  description?: string;
  "case-study-type"?: string;
  type?: string;
  "incident-date"?: string | Date;
  date?: string | Date;
  "date-granularity"?: string;
  "created-date"?: string | Date;
  "modified-date"?: string | Date;
  target?: string;
  actor?: string;
  reporter?: string;
  references?: { title?: string; url?: string }[];
}

function iso(v: string | Date | undefined): string | undefined {
  if (!v) return undefined;
  const s = v instanceof Date ? v.toISOString() : String(v);
  const m = s.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  if (!m) return undefined;
  return `${m[1]}-${m[2] ?? "01"}-${m[3] ?? "01"}`;
}

function cleanTemplate(s: string): string {
  return s.replace(/\{\{[^}]*\}\}/g, "").replace(/\s+/g, " ").trim();
}

async function resolveReleaseUrl(manifestUrl: string, ua: string): Promise<string> {
  const res = await httpFetch(manifestUrl, { userAgent: ua, timeoutMs: 20000, retries: 2 });
  const manifest = YAML.parse(res.body) as Record<string, unknown>;
  const text = JSON.stringify(manifest);
  const match = text.match(/v\d+\/ATLAS-\d{4}\.\d{2}\.yaml/) ?? text.match(/ATLAS-\d{4}\.\d{2}\.yaml/);
  if (!match) throw new Error("atlas: could not find a release file in manifest.yaml");
  const dist = manifestUrl.replace(/\/manifest\.yaml$/, "");
  return `${dist}/${match[0].startsWith("v") ? match[0] : `v6/${match[0]}`}`;
}

export const atlasAdapter: SourceAdapter = {
  kind: "atlas",
  async fetch(source, ctx) {
    if (!source.url) throw new Error("atlas: no url configured");
    const ua = ctx.settings.fetch.user_agent;
    const releaseUrl = await resolveReleaseUrl(source.url, ua);
    const res = await httpFetch(releaseUrl, { userAgent: ua, timeoutMs: 40000, retries: 2, maxBytes: 20_000_000 });
    const doc = YAML.parse(res.body) as Record<string, unknown>;
    const rawStudies = doc["case-studies"];
    // Older releases used a list; current ones key each study by its id.
    const studies: CaseStudy[] = Array.isArray(rawStudies)
      ? (rawStudies as CaseStudy[])
      : Object.entries((rawStudies as Record<string, CaseStudy> | undefined) ?? {}).map(([key, cs]) => ({ ...cs, id: cs.id ?? key }));
    const since = ctx.since ?? lookbackStart(ctx, 45);
    const out: Candidate[] = [];
    for (const cs of studies) {
      const incidentDate = iso(cs["incident-date"] ?? cs.date) ?? "2016-01-01";
      const created = iso(cs["created-date"]) ?? incidentDate;
      const modified = iso(cs["modified-date"]) ?? created;
      if (ctx.since ? incidentDate < ctx.since : modified < since) continue;
      const link = `https://atlas.mitre.org/studies/${cs.id}`;
      const type = cs["case-study-type"] ?? cs.type ?? "unknown";
      const summary = cleanTemplate(cs.summary ?? cs.description ?? "");
      const refs = (cs.references ?? [])
        .map((r) => ({ url: r.url ? canonicalUrl(r.url) : null, title: r.title }))
        .filter((r): r is { url: string; title: string | undefined } => Boolean(r.url))
        .slice(0, 5)
        .map((r) => ({ url: r.url, publisher: publisherFor(r.url, ctx.config.publishers), title: truncate(r.title ?? r.url, 300), published_at: created }));
      out.push({
        key: urlKey(link),
        source_id: source.id,
        origin: "seed_atlas",
        url: link,
        title: truncate(cs.name, 400),
        published_at: created,
        publisher: "MITRE ATLAS",
        hint: truncate(`${summary} Case study type: ${type}.${cs.target ? ` Target: ${cs.target}.` : ""}${cs.actor ? ` Actor: ${cs.actor}.` : ""}`, ctx.settings.fetch.hint_max_chars),
        cve_ids: [],
        discovered_at: nowIso(),
        extra: {
          classifier_hint: `${HINT} incident_date: ${incidentDate} (granularity ${cs["date-granularity"] ?? "unknown"}).`,
          atlas_id: cs.id,
          case_study_type: type,
          incident_date: incidentDate,
          additional_sources: refs,
        },
      });
      if (ctx.limit && out.length >= ctx.limit) break;
    }
    log.info(`atlas: ${out.length} of ${studies.length} case studies selected from ${releaseUrl.split("/").pop()}`);
    return out;
  },
};
