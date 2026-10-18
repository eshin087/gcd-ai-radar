import ExcelJS from "exceljs";
import { canonicalUrl, urlKey } from "../lib/canonical";
import { httpFetch } from "../lib/http";
import { nowIso } from "../lib/ids";
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
 * Citation: McGregor, S. (2021) "Preventing Repeated Real World AI Failures
 * by Cataloging Incidents: The AI Incident Database."
 */

const HINT =
  "AI Incident Database record (CC BY-SA 4.0). The description is an editor summary; the original reports are listed as sources. In scope only if the incident is a cybersecurity event involving AI (attack on an AI system, or AI used in an attack); AI harms without a security angle are out of scope.";

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

interface Report {
  url: string;
  domain: string;
  title: string;
  date: string;
}

export const aiidAdapter: SourceAdapter = {
  kind: "aiid",
  async fetch(source, ctx) {
    if (!source.url) throw new Error("aiid: no url configured");
    const ua = ctx.settings.fetch.user_agent;
    const exportUrl = await latestExportUrl(source.url, ua);
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

    // Reports grouped by incident id (url, domain, title, date_published only).
    const byIncident = new Map<string, Report[]>();
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
    const security = buildMatcher(ctx.config.keywords.security_terms);
    const since = ctx.since ?? "2016-01-01";

    const out: Candidate[] = [];
    let scanned = 0;
    for (let r = ih.row + 1; r <= incidents.rowCount; r++) {
      const row = incidents.getRow(r).values as Cell[];
      const id = cellText(row[cId]).trim();
      if (!id) continue;
      scanned += 1;
      const date = isoDate(cellText(row[cDate])) ?? "";
      if (!date || date < since) continue;
      const title = cellText(row[cTitle]).trim();
      const description = cellText(row[cDesc]).trim();
      const subdomain = cSub ? cellText(row[cSub]) : "";
      const domain = cDomain ? cellText(row[cDomain]) : "";
      const mitSecurity = /^(2\.2|4\.2)\b/.test(subdomain.trim());
      const keywordSecurity = security.test(`${title}\n${description}`);
      if (!mitSecurity && !keywordSecurity) continue;

      const link = `https://incidentdatabase.ai/cite/${id}`;
      const key = urlKey(link);
      if (ctx.seenKeys?.has(key)) continue;
      const reps = (byIncident.get(id) ?? []).filter((x) => x.date).sort((a, b) => a.date.localeCompare(b.date));
      const sources = reps
        .map((x) => ({ url: canonicalUrl(x.url), raw: x }))
        .filter((x): x is { url: string; raw: Report } => Boolean(x.url))
        .slice(0, 5)
        .map((x) => ({ url: x.url, publisher: publisherFor(x.url, ctx.config.publishers, x.raw.domain || undefined), title: truncate(x.raw.title || x.url, 300), published_at: x.raw.date }));
      const published = sources[0]?.published_at ?? date;
      const parties = [cDeployer && cellText(row[cDeployer]) ? `Deployer: ${cellText(row[cDeployer])}.` : "", cDeveloper && cellText(row[cDeveloper]) ? `Developer: ${cellText(row[cDeveloper])}.` : "", cHarmed && cellText(row[cHarmed]) ? `Harmed: ${cellText(row[cHarmed])}.` : ""]
        .filter(Boolean)
        .join(" ");
      out.push({
        key,
        source_id: source.id,
        origin: "seed_aiid",
        url: link,
        title: truncate(title, 400),
        published_at: published,
        publisher: "AI Incident Database",
        hint: truncate(`${description} ${parties}${subdomain ? ` MIT risk: ${domain} / ${subdomain}.` : ""}`, ctx.settings.fetch.hint_max_chars),
        cve_ids: extractCves(`${title} ${description}`),
        discovered_at: nowIso(),
        extra: { classifier_hint: `${HINT} incident_date: ${date}.`, aiid_id: Number(id), incident_date: date, mit_subdomain: subdomain, additional_sources: sources },
      });
      if (ctx.limit && out.length >= ctx.limit) break;
    }
    log.info(`aiid: ${out.length} security-relevant candidates from ${scanned} incidents`);
    return out;
  },
};
