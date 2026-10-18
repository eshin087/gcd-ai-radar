import { XMLParser } from "fast-xml-parser";
import { stripHtml } from "./text";

/** RSS 2.0 / Atom / RSS 1.0 parsing into one flat item shape. */

export interface FeedItem {
  title: string;
  link: string;
  id?: string;
  /** ISO date YYYY-MM-DD, or undefined when the feed gives none. */
  date?: string;
  /** Plain-text summary (description/summary/content), untruncated. */
  summary: string;
  categories: string[];
  /** Raw namespaced fields the caller may need (e.g. arxiv:announce_type). */
  raw: Record<string, unknown>;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  cdataPropName: "__cdata",
  processEntities: true,
  htmlEntities: true,
  trimValues: true,
  parseTagValue: false,
  isArray: (name) => ["item", "entry", "link", "category"].includes(name),
});

function text(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("__cdata" in o) return text(o["__cdata"]);
    if ("#text" in o) return text(o["#text"]);
    if ("@_href" in o) return text(o["@_href"]);
  }
  return "";
}

export function toIsoDate(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const t = Date.parse(s);
  if (Number.isNaN(t)) {
    const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : undefined;
  }
  return new Date(t).toISOString().slice(0, 10);
}

function atomLink(links: unknown): string {
  const arr = Array.isArray(links) ? links : links ? [links] : [];
  const objs = arr.map((l) => (typeof l === "object" && l ? (l as Record<string, unknown>) : { "@_href": text(l) }));
  const alt = objs.find((l) => (l["@_rel"] ?? "alternate") === "alternate" && (!l["@_type"] || String(l["@_type"]).includes("html")));
  return text((alt ?? objs[0])?.["@_href"] ?? "");
}

export function parseFeed(xml: string): FeedItem[] {
  const doc = parser.parse(xml.replace(/^﻿/, "")) as Record<string, unknown>;
  const rss = doc["rss"] as Record<string, unknown> | undefined;
  const channel = (rss?.["channel"] ?? (doc["rdf:RDF"] as Record<string, unknown> | undefined)) as Record<string, unknown> | undefined;
  const feed = doc["feed"] as Record<string, unknown> | undefined;

  if (feed) {
    const entries = (feed["entry"] as Record<string, unknown>[] | undefined) ?? [];
    return entries.map((e) => ({
      title: stripHtml(text(e["title"])),
      link: atomLink(e["link"]),
      id: text(e["id"]) || undefined,
      date: toIsoDate(text(e["published"]) || text(e["updated"])),
      summary: stripHtml(text(e["summary"]) || text(e["content"])),
      categories: ((e["category"] as Record<string, unknown>[] | undefined) ?? []).map((c) => text(c["@_term"] ?? c["@_label"] ?? c)).filter(Boolean),
      raw: e,
    }));
  }

  const items = ((channel?.["item"] ?? (doc["rdf:RDF"] as Record<string, unknown> | undefined)?.["item"]) as Record<string, unknown>[] | undefined) ?? [];
  return items.map((it) => ({
    title: stripHtml(text(it["title"])),
    link: text(it["link"]) || text(it["guid"]) || text(it["@_rdf:about"]),
    id: text(it["guid"]) || undefined,
    date: toIsoDate(text(it["pubDate"]) || text(it["dc:date"]) || text(it["published"])),
    summary: stripHtml(text(it["description"]) || text(it["content:encoded"]) || text(it["summary"])),
    categories: ((it["category"] as unknown[] | undefined) ?? []).map((c) => text(c)).filter(Boolean),
    raw: it,
  }));
}

/** Removes WordPress-style "The post X appeared first on Y." trailers. */
export function stripBoilerplate(summary: string): string {
  return summary
    .replace(/\s*The post .+? appeared first on .+?\.?\s*$/i, "")
    .replace(/\s*Read more\.{0,3}\s*$/i, "")
    .replace(/\s*\[…\]\s*$|\s*\[\.\.\.\]\s*$/g, "…")
    .trim();
}
