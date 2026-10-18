import ExcelJS from "exceljs";
import type { Source } from "../../lib/schema";
import { canonicalUrl, urlKey } from "../lib/canonical";
import { httpFetch } from "../lib/http";
import { addDays, nowIso } from "../lib/ids";
import { log } from "../lib/log";
import { publisherFor } from "../lib/publishers";
import { buildMatcher, extractCves, truncate } from "../lib/text";
import type { Candidate, SourceAdapter } from "./types";

/**
 * AI Incident Database (incidentdatabase.ai), via the weekly public Excel
 * export (the GraphQL API is login-gated). Incident metadata is CC BY-SA 4.0;
 * report text is excluded from that licence and is never read here. One
 * download per week at most (their terms forbid high-volume bot access).
 *
 * Security-relevant incidents are selected by the MIT taxonomy (risk
 * subdomains 2.2 "AI system security vulnerabilities and attacks" and 4.2
 * "Cyberattacks…") or by security keywords in the editor-written title and
 * description; the classifier makes the final call.
 *
 * AIID attaches background articles that can predate an incident by years.
 * Only reports dated within BACKGROUND_WINDOW_DAYS before the incident date
 * (or later) are kept as sources, so "first reported" stays honest.
 *
 * Citation: McGregor, S. (2021) "Preventing Repeated Real World AI Failures
 * by Cataloging Incidents: The AI Incident Database."
 */

const HINT =
  "AI Incident Database record (CC BY-SA 4.0). The description is an editor summary; the original reports are listed as sources. In scope only if the incident is a cybersecurity event involving AI (attack on an AI system, or AI used in an attack); AI harms without a security angle are out of scope.";

export const BACKGROUND_WINDOW_DAYS = 45;

type Cell = string | number | boolean | Date | null | undefined | { text?: unknown; hyperlink?: string; richText?: { text: string }[]; result?: unknown };

function cellText(v: Cell): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("");
    if (v.hyperlink) return String(v.hyperlink);
    if (v.text !== undefined) return cellText(v.text as Cell);
    if (v.result !== undefined) return cellText(v.result as Cell);
    return "";
  }
  return String(v);
}

function isoDate(s: string): string | undefined {
  if (!s) return undefined;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return s.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  return new Date(t).toISOString().slice(0, 10);
}

function headerIndex(ws: ExcelJS.Worksheet, mustContain: string[]): { row: number; cols: Map<string, number> } | null {
  for (let r = 1; r <= 5; r++) {
    const values = ws.getRow(r).values as Cell[];
    const cols = new Map<string, number>();
    values.forEach((v, i) => {
      const name = cellText(v).trim().toLowerCase();
      if (name && !cols.has(name)) cols.set(name, i);
    });
    if (mustContain.every((m) => cols.has(m))) return { row: r, cols };
  }
  return null;
}

async function latestExportUrl(listingUrl: string, ua: string): Promise<string> {
  const res = await httpFetch(listingUrl, { userAgent: ua, timeoutMs: 30000, retries: 2, maxBytes: 5_000_000 });
  const links = [...res.body.matchAll(/https?:\/\/[^"'\s]*AIID_Excel_Export-(\d{8})\.xlsx/g)].map((m) => ({ url: m[0], stamp: m[1]! }));
  if (links.length === 0) throw new Error("aiid: no AIID_Excel_Export-*.xlsx link found on the snapshots page");
  links.sort((a, b) => b.stamp.localeCompare(a.stamp));
  return links[0]!.url;
}

export interface AiidReport {
  url: string;
  domain: string;
  title: string;
  date: string;
}

export interface AiidRecord {
  id: string;
  /** Date harm occurred (editor-resolved), YYYY-MM-DD. */
  date: string;
  title: string;
  description: string;
  deployer: string;
  developer: string;
  harmed: string;
  riskDomain: string;
  riskSubdomain: string;
  reports: AiidReport[];
}

/** Downloads the newest export and returns every incident with its linked reports (url, domain, title, date only). */
export async function loadAiidRecords(listingUrl: string, ua: string): Promise<AiidRecord[]> {
  const exportUrl = await latestExportUrl(listingUrl, ua);
  log.info(`aiid: downloading ${exportUrl.split("/").pop()}`);
  const res = await fetch(exportUrl, { headers: { "user-agent": ua } });
  if (!res.ok) throw new Error(`aiid: HTTP ${res.status} downloading the export`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength > 50_000_000) throw new Error("aiid: export unexpectedly large");

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const incidents = wb.getWorksheet("Incidents");
  const reports = wb.getWorksheet("Reports");
  if (!incidents) throw new Error("aiid: Incidents sheet missing");
  const ih = headerIndex(incidents, ["incident id", "title", "description", "date"]);
  if (!ih) throw new Error("aiid: could not find the Incidents header row");

  const byIncident = new Map<string, AiidReport[]>();
  if (reports) {
    const rh = headerIndex(reports, ["url"]) ?? { row: 2, cols: new Map<string, number>([["incident id", 1], ["title", 2], ["url", 3], ["domain", 4], ["date_published", 5]]) };
    const col = (names: string[]) => names.map((n) => rh.cols.get(n)).find((i) => i !== undefined);
    const cId = col(["incident id", "incident_id"]) ?? 1;
    const cTitle = col(["title"]) ?? 2;
    const cUrl = col(["url"]) ?? 3;
    const cDomain = col(["domain", "source_domain"]) ?? 4;
    const cDate = col(["date_published", "date published", "date"]) ?? 5;
    for (let r = rh.row + 1; r <= reports.rowCount; r++) {
      const row = reports.getRow(r).values as Cell[];
      const id = cellText(row[cId]).trim();
      const url = cellText(row[cUrl]).trim();
      if (!id || !url) continue;
      const list = byIncident.get(id) ?? [];
      list.push({ url, domain: cellText(row[cDomain]), title: cellText(row[cTitle]), date: isoDate(cellText(row[cDate])) ?? "" });
      byIncident.set(id, list);
    }
  }

  const c = (name: string) => ih.cols.get(name);
  const cId = c("incident id")!;
  const cDate = c("date")!;
  const cTitle = c("title")!;
  const cDesc = c("description")!;
  const cDeployer = c("deployer");
  const cDeveloper = c("developer");
  const cHarmed = c("harmed");
  const cDomain = c("risk domain");
  const cSub = c("risk subdomain");
  const text = (row: Cell[], idx: number | undefined) => (idx === undefined ? "" : cellText(row[idx]).trim());

  const out: AiidRecord[] = [];
  for (let r = ih.row + 1; r <= incidents.rowCount; r++) {
    const row = incidents.getRow(r).values as Cell[];
    const id = cellText(row[cId]).trim();
    const date = isoDate(cellText(row[cDate]));
    if (!id || !date) continue;
    out.push({
      id,
      date,
      title: text(row, cTitle),
      description: text(row, cDesc),
      deployer: text(row, cDeployer),
      developer: text(row, cDeveloper),
      harmed: text(row, cHarmed),
      riskDomain: text(row, cDomain),
      riskSubdomain: text(row, cSub),
      reports: byIncident.get(id) ?? [],
    });
  }
  return out;
}

export function isSecurityRelevant(rec: AiidRecord, security: RegExp): boolean {
  return /^(2\.2|4\.2)\b/.test(rec.riskSubdomain.trim()) || security.test(`${rec.title}\n${rec.description}`);
}

/**
 * The sources for an AIID incident: the AIID record page plus up to five
 * original reports dated no earlier than BACKGROUND_WINDOW_DAYS before the
 * incident date (older ones are background reading, not reporting).
 * first_reported is the earliest kept report date, or the incident date.
 */
export function aiidSources(rec: AiidRecord, publishers: Record<string, string>): { sources: Source[]; published_at: string } {
  const floor = addDays(rec.date, -BACKGROUND_WINDOW_DAYS);
  const kept = rec.reports
    .filter((x) => x.date && x.date >= floor)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((x) => ({ url: canonicalUrl(x.url), raw: x }))
    .filter((x): x is { url: string; raw: AiidReport } => Boolean(x.url))
    .slice(0, 5);
  const published_at = kept[0]?.raw.date ?? rec.date;
  const sources: Source[] = [
    { url: `https://incidentdatabase.ai/cite/${rec.id}`, publisher: "AI Incident Database", title: truncate(rec.title, 300), published_at },
    ...kept.map((x) => ({ url: x.url, publisher: publisherFor(x.url, publishers, x.raw.domain || undefined), title: truncate(x.raw.title || x.url, 300), published_at: x.raw.date })),
  ];
  const byUrl = new Map<string, Source>();
  for (const s of sources) if (!byUrl.has(s.url)) byUrl.set(s.url, s);
  return { sources: [...byUrl.values()], published_at };
}

export const aiidAdapter: SourceAdapter = {
  kind: "aiid",
  async fetch(source, ctx) {
    if (!source.url) throw new Error("aiid: no url configured");
    const records = await loadAiidRecords(source.url, ctx.settings.fetch.user_agent);
    const security = buildMatcher(ctx.config.keywords.security_terms);
    const since = ctx.since ?? "2016-01-01";
    const out: Candidate[] = [];
    for (const rec of records) {
      if (rec.date < since || !isSecurityRelevant(rec, security)) continue;
      const link = `https://incidentdatabase.ai/cite/${rec.id}`;
      const key = urlKey(link);
      if (ctx.seenKeys?.has(key)) continue;
      const { sources, published_at } = aiidSources(rec, ctx.config.publishers);
      const parties = [rec.deployer ? `Deployer: ${rec.deployer}.` : "", rec.developer ? `Developer: ${rec.developer}.` : "", rec.harmed ? `Harmed: ${rec.harmed}.` : ""]
        .filter(Boolean)
        .join(" ");
      out.push({
        key,
        source_id: source.id,
        origin: "seed_aiid",
        url: link,
        title: truncate(rec.title, 400),
        published_at,
        publisher: "AI Incident Database",
        hint: truncate(`${rec.description} ${parties}${rec.riskSubdomain ? ` MIT risk: ${rec.riskDomain} / ${rec.riskSubdomain}.` : ""}`, ctx.settings.fetch.hint_max_chars),
        cve_ids: extractCves(`${rec.title} ${rec.description}`),
        discovered_at: nowIso(),
        extra: {
          classifier_hint: `${HINT} incident_date: ${rec.date}.`,
          aiid_id: Number(rec.id),
          incident_date: rec.date,
          mit_subdomain: rec.riskSubdomain,
          additional_sources: sources.slice(1),
        },
      });
      if (ctx.limit && out.length >= ctx.limit) break;
    }
    log.info(`aiid: ${out.length} security-relevant candidates from ${records.length} incidents`);
    return out;
  },
};
