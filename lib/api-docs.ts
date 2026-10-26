import { z } from "zod";
import type { CompactRow } from "./rows";
import { IncidentSchema, type Incident, type TimelineEntry } from "./schema";
import type { SlimIncident } from "./slim";
import type { Summary } from "./summary";

/**
 * What the API page (app/(site)/api/page.tsx) says about each public file.
 * Every map below is typed against the record it documents, so a field added
 * to the schema, the slim record or summary.json fails the typecheck until it
 * is documented here. Types of the full record come from the Zod schema
 * itself (z.toJSONSchema), so they cannot drift from validation.
 */

/** public/data/meta.json, written by scripts/prebuild.ts. */
export interface MetaFile {
  generated_at: string;
  site: string;
  records: number;
  incidents: number;
  disclosed_vulnerabilities: number;
  counting_rule: string;
  years: { year: number; records: number; incidents: number; disclosed_vulnerabilities: number; file: string }[];
  last_collector_run: string | null;
  standards_mapping: { owasp_llm_top_10: string; mitre_atlas_release: string; rule: string };
  license: string;
  license_url: string;
}

/** public/data/years/index.json, written by scripts/prebuild.ts. */
export interface YearIndexFile {
  generated_at: string;
  years: { year: number; records: number; incidents: number; disclosed: number; file: string }[];
}

export interface FieldDoc {
  name: string;
  type: string;
  note: string;
  /** Allowed values of an enum, listed under the row. */
  values?: readonly (string | number)[];
}

type JsonSchema = {
  type?: string;
  format?: string;
  enum?: (string | number)[];
  const?: string | number;
  anyOf?: JsonSchema[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
};

const INCIDENT_NOTES: Record<keyof Incident, string> = {
  id: "Stable identifier, AIR-<year>-<number>. Never reused.",
  slug: "URL slug; the record's page is /incidents/<slug>.",
  title: "Headline written for the record.",
  summary: "Two sentences in the site's own words, never quoted article text.",
  type: "attack_on_ai, ai_enabled_attack, or not_ai (no meaningful AI role; such records are never in the AI counts).",
  categories: "Ordered by relevance; the first is the primary category, which monthly counts use.",
  severity: "1 research, 2 disclosed vulnerability, 3 confirmed exploitation, 4 confirmed real-world loss. 3 and 4 are real-world.",
  targets: "Controlled list of who or what was hit.",
  products: "Free-text product names.",
  incident_date: "When it happened: YYYY, YYYY-MM or YYYY-MM-DD.",
  incident_date_precision: "How precise incident_date is.",
  first_reported: "Earliest source date.",
  sources: "The reporting: one entry per article, linking to the original.",
  source_count: "Always equals the length of sources.",
  confidence: "Classifier confidence, 0 to 1.",
  status: "Always \"published\" in the public files.",
  origin: "Where the record came from; seed_* are historical backfills.",
  tags: "Free-text tags.",
  created_at: "When the record was created.",
  updated_at: "When the record last changed.",
  lane: "The live lane: patch, breach, supply_chain or research. Always present in the public files (derived by the rules on /methodology#lanes for records that predate lanes).",
  state: "live or closed, by the rules on /methodology#lanes. Judged at every build; a closed record stays closed.",
  closed_at: "The day a closed record closed; null while live.",
  patch_status: "unpatched, partial, patched, no_fix_needed or unknown.",
  cve_ids: "The CVE ids the record is about, highest first.",
  affected: "Affected versions or products as a source states them, e.g. \"PHP < 8.4.9\".",
  fixed_in: "Fixed versions as a source states them.",
  timeline: "Dated updates, oldest first: the first reports, then what changed. The newest 500 across all records are in /changes.json.",
  action: "What to do, in the site's own words; empty when no source says.",
  severity_note: "Why this severity; empty when the record predates the field.",
  cvss: "A CVSS base score when a source states one, else null.",
};

const SOURCE_NOTES: Record<keyof Incident["sources"][number], string> = {
  url: "Link to the original article or advisory (http or https only).",
  publisher: "Publisher name.",
  title: "The article's own title.",
  published_at: "Publication date.",
};

const TIMELINE_NOTES: Record<keyof TimelineEntry, string> = {
  date: "The day the update is about.",
  title: "One line on what happened or changed.",
  source_url: "The report behind the entry, when there is one.",
  added_at: "When the site learned of the entry; /changes.json orders by it.",
};

function constraint(s: JsonSchema): string {
  const parts: string[] = [];
  if (s.minItems !== undefined || s.maxItems !== undefined) parts.push(`${s.minItems ?? 0}–${s.maxItems ?? "∞"} items`);
  if (s.maxLength !== undefined) parts.push(`≤ ${s.maxLength} chars`);
  if (s.type === "number" && s.minimum !== undefined && s.maximum !== undefined) parts.push(`${s.minimum}–${s.maximum}`);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

/** A short type label for a JSON-schema node: "string (YYYY-MM-DD)", "1 | 2 | 3 | 4", "enum[]". */
export function typeLabel(s: JsonSchema): string {
  if (s.anyOf) return s.anyOf.map((x) => (x.const !== undefined ? String(x.const) : typeLabel(x))).join(" | ");
  if (s.enum) return s.enum.length <= 3 ? s.enum.map((v) => JSON.stringify(v)).join(" | ") : "enum";
  if (s.type === "array") return `${s.items ? typeLabel(s.items) : "unknown"}[]`;
  if (s.type === "string") {
    if (s.format === "date") return "string (YYYY-MM-DD)";
    if (s.format === "date-time") return "string (RFC 3339)";
    if (s.format === "uri") return "string (URL)";
    return "string";
  }
  return s.type ?? "unknown";
}

function enumValues(s: JsonSchema): (string | number)[] | undefined {
  const e = s.enum ?? s.items?.enum;
  return e && e.length > 3 ? e : undefined;
}

/** Fields of a full incident record (incidents.json, years/<year>.json, incidents/<slug>.json), types from the Zod schema. */
export function incidentFields(): FieldDoc[] {
  const schema = z.toJSONSchema(IncidentSchema, { io: "output" }) as JsonSchema;
  const props = schema.properties ?? {};
  const out: FieldDoc[] = [];
  for (const name of Object.keys(INCIDENT_NOTES) as (keyof Incident)[]) {
    const s = props[name];
    if (!s) throw new Error(`api-docs: ${name} is documented but not in IncidentSchema`);
    out.push({ name, type: typeLabel(s) + constraint(s), note: INCIDENT_NOTES[name], values: enumValues(s) });
    if (name === "sources") {
      const item = s.items?.properties ?? {};
      for (const sub of Object.keys(SOURCE_NOTES) as (keyof typeof SOURCE_NOTES)[]) {
        out.push({ name: `sources[].${sub}`, type: typeLabel(item[sub] ?? {}), note: SOURCE_NOTES[sub] });
      }
    }
    if (name === "timeline") {
      const item = s.items?.properties ?? {};
      for (const sub of Object.keys(TIMELINE_NOTES) as (keyof typeof TIMELINE_NOTES)[]) {
        out.push({ name: `timeline[].${sub}`, type: typeLabel(item[sub] ?? {}), note: TIMELINE_NOTES[sub] });
      }
    }
  }
  for (const name of Object.keys(props)) if (!(name in INCIDENT_NOTES)) throw new Error(`api-docs: IncidentSchema field ${name} is not documented`);
  return out;
}

/** Slim record fields: null means "as in the full record". */
export const SLIM_NOTES: Record<keyof SlimIncident, { type: string; note: string } | null> = {
  id: null,
  slug: null,
  title: null,
  summary: null,
  type: null,
  categories: null,
  severity: null,
  targets: null,
  products: null,
  incident_date: null,
  incident_date_precision: null,
  first_reported: null,
  source_count: null,
  publishers: { type: "string[]", note: "Distinct publishers of the sources, in source order. Replaces the sources array." },
  origin: null,
  disclosed: { type: "boolean", note: "True for a disclosed vulnerability (a CVE or advisory with no confirmed exploitation). Count only records where this is false." },
  lane: null,
  state: null,
  patch_status: null,
  cve_ids: null,
  tags: { type: "string[]", note: "Tag slugs as the tag pages use them (/tags/<slug>), at most five; the full record carries the tags as written." },
  last_update: { type: "string (YYYY-MM-DD)", note: "The newest dated activity: a timeline entry, a source or the first report." },
};

export function slimFields(): FieldDoc[] {
  const full = new Map(incidentFields().map((f) => [f.name, f]));
  return (Object.keys(SLIM_NOTES) as (keyof SlimIncident)[]).map((name) => {
    const own = SLIM_NOTES[name];
    if (own) return { name, ...own };
    const f = full.get(name);
    if (!f) throw new Error(`api-docs: slim field ${name} is marked as in the full record, which has no such field`);
    return { ...f, note: "As in the full record." };
  });
}

/** Compact rows (rows/<year>.json) are internal to the dashboard: listed, not promised. */
export const ROW_FIELDS: readonly (keyof CompactRow)[] = [
  "id", "slug", "title", "incident_date", "incident_date_precision", "first_reported", "type", "categories", "severity", "targets", "source_count", "disclosed", "product", "products",
  "lane", "state", "patch_status",
];

export const META_FIELDS: Record<keyof MetaFile, { type: string; note: string }> = {
  generated_at: { type: "string (RFC 3339)", note: "When the deploy generated the files." },
  site: { type: "string (URL)", note: "The site's base URL." },
  records: { type: "integer", note: "Every published record: incidents plus disclosed vulnerabilities." },
  incidents: { type: "integer", note: "Records that count as incidents." },
  disclosed_vulnerabilities: { type: "integer", note: "CVEs and advisories with no confirmed exploitation; not incidents." },
  counting_rule: { type: "string", note: "The disclosed-vulnerability rule in one sentence." },
  years: { type: "object[]", note: "Per year of first report: year, records, incidents, disclosed_vulnerabilities, file (the years/<year>.json path)." },
  last_collector_run: { type: "string (RFC 3339) | null", note: "When the collector last finished a run; null before the first run." },
  standards_mapping: { type: "{ owasp_llm_top_10, mitre_atlas_release, rule }", note: "The OWASP LLM Top 10 edition and MITRE ATLAS release the CSV's owasp_llm and atlas columns refer to. Those columns are derived from type and categories, not classified per record." },
  license: { type: "string", note: "\"CC BY-SA 4.0\"." },
  license_url: { type: "string (URL)", note: "The licence text." },
};

export const YEAR_INDEX_FIELDS: Record<keyof YearIndexFile, { type: string; note: string }> = {
  generated_at: { type: "string (RFC 3339)", note: "When the deploy generated the files." },
  years: { type: "object[]", note: "Newest year first: year, records, incidents, disclosed (disclosed vulnerabilities), file." },
};

const WINDOW_TYPE = "{ from, to, incidents, real_world, prior, delta_pct }";

export const SUMMARY_FIELDS: Record<keyof Summary, { type: string; note: string }> = {
  version: { type: "1", note: "Bumped only for a breaking change, with a change-log entry." },
  generated_at: { type: "string (RFC 3339)", note: "When the deploy generated the file; the windows end in this month." },
  site: { type: "string (URL)", note: "The site's base URL, for the link back." },
  last_collector_run: { type: "string (RFC 3339) | null", note: "When the collector last finished a run." },
  date_basis: { type: "\"incident_date\"", note: "Months are placed by incident date, the site's default axis." },
  counting_rule: { type: "string", note: "The disclosed-vulnerability rule in one sentence." },
  scope: { type: "\"ai\"", note: "Every number in the file counts AI records only (type attack_on_ai or ai_enabled_attack)." },
  scope_note: { type: "string", note: "The AI-lens rule in one sentence." },
  totals: { type: "{ records, incidents, real_world, disclosed_vulnerabilities }", note: "All-time counts of AI records. real_world is incidents of severity 3 or 4. records = incidents + disclosed_vulnerabilities." },
  this_month: { type: "{ month, incidents, last_month, delta_pct }", note: "The current month so far against the whole of last month." },
  year_to_date: { type: "{ year, incidents, last_year_same_period, delta_pct }", note: "This calendar year to date against the same span of last year." },
  trailing_12: { type: WINDOW_TYPE, note: "The last 12 months including the current one; prior is the 12 before. Months are YYYY-MM, inclusive." },
  trailing_24: { type: WINDOW_TYPE, note: "The same for 24 months." },
  provisional_from: { type: "string (YYYY-MM)", note: "First month still provisional (within 60 days of generation): its count will rise." },
  monthly: { type: "{ month, incidents, real_world, disclosed_vulnerabilities, provisional }[]", note: "The last 24 months, oldest first, ending with the current month. Sums to trailing_24." },
  license: { type: "string", note: "\"CC BY-SA 4.0\"." },
  license_url: { type: "string (URL)", note: "The licence text." },
  cite_as: { type: "string", note: "A citation line; replace <date> with the date you accessed the data." },
};
