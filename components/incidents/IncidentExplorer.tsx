"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { CategoryBadge, SeverityBadge, TypeBadge } from "@/components/ui/Badge";
import { createShardStore } from "@/components/useShards";
import { EMPTY_FILTERS, totalOfKind, yearsNeeded, type ExplorerFacets, type ExplorerFilters } from "@/lib/explorer";
import { approxDateLabel } from "@/lib/format";
import { productFamily } from "@/lib/products";
import { hitIds, hitYears, matchesTerms, queryTerms, searchIndex, searchableText, tokenize, type SearchIndex } from "@/lib/search";
import type { SlimIncident } from "@/lib/slim";
import { CATEGORIES, CATEGORY_META, INCIDENT_TYPES, ORIGIN_META, ORIGINS, SEVERITIES, SEVERITY_META, TARGETS, TARGET_META, TYPE_META } from "@/lib/taxonomy";

/**
 * Client-side explorer over the year shards of slim records
 * (/data/slim/<year>.json). The current year loads first; older years load
 * when the filters, the sort or the list's length need them (lib/explorer.ts
 * yearsNeeded). Search uses the prebuilt token index (/data/search-index.json)
 * over id, title and products, so it never needs the whole dataset. Filters
 * live in the URL query string so any view can be linked to.
 */

type Filters = ExplorerFilters;
const EMPTY = EMPTY_FILTERS;
const PAGE = 50;

const slimShards = createShardStore<SlimIncident>((year) => `/data/slim/${year}.json`);

let indexPromise: Promise<SearchIndex> | null = null;
function loadSearchIndex(): Promise<SearchIndex> {
  if (!indexPromise) {
    indexPromise = fetch("/data/search-index.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .catch((e: Error) => {
        indexPromise = null;
        throw e;
      });
  }
  return indexPromise;
}

/**
 * The URL query string is the explorer's state store: filters are parsed
 * from it on every change and written back with replaceState, so a view is a
 * link. useSyncExternalStore reads it (empty on the server and during
 * hydration, then the real query), and writeFilters notifies the subscribers.
 */
const urlListeners = new Set<() => void>();
function subscribeUrl(cb: () => void) {
  urlListeners.add(cb);
  window.addEventListener("popstate", cb);
  return () => {
    urlListeners.delete(cb);
    window.removeEventListener("popstate", cb);
  };
}
const getSearch = () => window.location.search;
const getServerSearch = () => "";
const noop = () => () => {};

function parseFilters(search: string): Filters {
  const p = new URLSearchParams(search);
  const sort = p.get("sort");
  return {
    ...EMPTY,
    q: p.get("q") ?? "",
    type: p.get("type") ?? "",
    category: p.get("category") ?? "",
    severity: p.get("severity") ?? "",
    target: p.get("target") ?? "",
    year: p.get("year") ?? "",
    month: p.get("month") ?? "",
    from: p.get("from") ?? "",
    to: p.get("to") ?? "",
    publisher: p.get("publisher") ?? "",
    origin: p.get("origin") ?? "",
    real: p.get("real") ?? "",
    by: p.get("by") ?? "",
    product: p.get("product") ?? "",
    kind: p.get("kind") === "disclosed" || p.get("kind") === "all" ? p.get("kind")! : "",
    sort: sort === "incident" || sort === "severity" ? sort : "reported",
  };
}

function writeFilters(f: Filters) {
  if (typeof window === "undefined") return;
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v && !(k === "sort" && v === "reported")) p.set(k, v);
  const qs = p.toString();
  window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  for (const cb of urlListeners) cb();
}

function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="label">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-[3px] border border-line bg-panel px-2 font-mono text-[12.5px] text-ink focus:border-accent focus:outline-none"
      >
        {children}
      </select>
    </label>
  );
}

export function IncidentExplorer({ facets }: { facets: ExplorerFacets }) {
  // Filters come from the URL; nothing loads until hydration has read it, so a linked view fetches only its own years.
  const search = useSyncExternalStore(subscribeUrl, getSearch, getServerSearch);
  const ready = useSyncExternalStore(noop, () => true, () => false);
  const filters = useMemo(() => parseFilters(search), [search]);
  const [shown, setShown] = useState(PAGE);
  const [index, setIndex] = useState<SearchIndex | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);

  // The search index is fetched the first time a query is set (or linked to).
  const wantIndex = filters.q.trim().length > 0;
  useEffect(() => {
    if (!wantIndex || index) return;
    let cancelled = false;
    loadSearchIndex()
      .then((i) => {
        if (!cancelled) setIndex(i);
      })
      .catch((e: Error) => {
        if (!cancelled) setIndexError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [wantIndex, index]);

  const hits = useMemo(() => (index && filters.q.trim() ? searchIndex(index, filters.q) : null), [index, filters.q]);
  const hitIdSet = useMemo(() => (index && hits ? hitIds(index, hits) : null), [index, hits]);
  const searchYears = useMemo(() => (index && hits ? hitYears(index, hits) : null), [index, hits]);

  const needed = useMemo(() => (ready ? yearsNeeded(filters, facets, searchYears, shown) : { years: [], reason: "newest" as const }), [ready, filters, facets, searchYears, shown]);
  const shards = slimShards.useShards(needed.years);
  const all = shards.partial;

  const update = (patch: Partial<Filters>) => {
    writeFilters({ ...filters, ...patch });
    setShown(PAGE);
  };

  const results = useMemo(() => {
    const terms = queryTerms(filters.q);
    const dateOf = (i: SlimIncident) => (filters.by === "reported" ? i.first_reported : i.incident_date.length === 4 ? `${i.incident_date}-07` : i.incident_date);
    const rows = all.filter((i) => {
      if (filters.kind === "" && i.disclosed) return false;
      if (filters.kind === "disclosed" && !i.disclosed) return false;
      if (filters.type && i.type !== filters.type) return false;
      if (filters.category && !filters.category.split(",").some((c) => i.categories.includes(c as SlimIncident["categories"][number]))) return false;
      if (filters.severity && String(i.severity) !== filters.severity) return false;
      if (filters.real === "1" && i.severity < 3) return false;
      if (filters.target && !i.targets.includes(filters.target as SlimIncident["targets"][number])) return false;
      if (filters.month && !dateOf(i).startsWith(filters.month)) return false;
      if (filters.from && dateOf(i).slice(0, 7) < filters.from) return false;
      if (filters.to && dateOf(i).slice(0, 7) > filters.to) return false;
      if (filters.year && !filters.month && !i.first_reported.startsWith(filters.year) && !i.incident_date.startsWith(filters.year)) return false;
      if (filters.publisher && !i.publishers.includes(filters.publisher)) return false;
      if (filters.origin && i.origin !== filters.origin) return false;
      if (filters.product && productFamily(i.products[0] ?? "") !== filters.product) return false;
      if (terms.length) {
        // The index decides once it is here; until then the same token test runs on the rows already loaded.
        if (hitIdSet) return hitIdSet.has(i.id);
        if (!matchesTerms(tokenize(searchableText(i)), terms)) return false;
      }
      return true;
    });
    rows.sort((a, b) => {
      if (filters.sort === "severity") return b.severity - a.severity || b.first_reported.localeCompare(a.first_reported);
      if (filters.sort === "incident") return b.incident_date.localeCompare(a.incident_date) || b.first_reported.localeCompare(a.first_reported);
      return b.first_reported.localeCompare(a.first_reported) || b.id.localeCompare(a.id);
    });
    return rows;
  }, [all, filters, hitIdSet]);

  const complete = ready && shards.missing.length === 0 && needed.reason !== "index";
  const inKind = totalOfKind(facets, filters.kind);
  const kindNoun = filters.kind === "disclosed" ? "disclosed vulnerabilities" : filters.kind === "all" ? "records" : "incidents";
  const active = Object.entries(filters).filter(([k, v]) => v && k !== "sort" && k !== "by" && k !== "kind").length;
  /** The default list is the newest years only; older ones arrive as the list grows. */
  const newestOnly = needed.reason === "newest" && needed.years.length < facets.years.length;
  const canGrow = results.length > shown || (newestOnly && complete);
  const chips: { key: keyof Filters; label: string }[] = [
    ...(filters.month ? [{ key: "month" as const, label: `month: ${filters.month}${filters.by === "reported" ? " (first reported)" : ""}` }] : []),
    ...(filters.from ? [{ key: "from" as const, label: `from: ${filters.from}${filters.by === "reported" ? " (first reported)" : ""}` }] : []),
    ...(filters.to ? [{ key: "to" as const, label: `to: ${filters.to}` }] : []),
    ...(filters.real === "1" ? [{ key: "real" as const, label: "real-world only (severity 3–4)" }] : []),
    ...(filters.product ? [{ key: "product" as const, label: `product: ${filters.product}` }] : []),
  ];

  let status: React.ReactNode;
  if (shards.error) status = <span className="text-sev-4">could not load the dataset: {shards.error}</span>;
  else if (indexError) status = <span className="text-sev-4">could not load the search index: {indexError}</span>;
  else if (!ready || (!complete && results.length === 0)) status = needed.reason === "index" ? "loading the search index…" : "loading…";
  else if (newestOnly && active === 0)
    status = (
      <>
        {inKind.toLocaleString("en-US")} {kindNoun} · newest first
      </>
    );
  else
    status = (
      <>
        {results.length.toLocaleString("en-US")} of {inKind.toLocaleString("en-US")} {kindNoun}
        {!complete && <span className="text-faint"> · loading {needed.reason === "index" ? "the search index" : "older years"}…</span>}
      </>
    );

  return (
    <div className="space-y-5">
      <div className="panel p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        <label className="flex flex-col gap-1 sm:col-span-2 xl:col-span-2">
          <span className="label">search</span>
          <input
            type="search"
            value={filters.q}
            onChange={(e) => update({ q: e.target.value })}
            onFocus={() => {
              if (!index) loadSearchIndex().then(setIndex).catch(() => undefined);
            }}
            placeholder="title, product, id"
            className="h-9 rounded-[3px] border border-line bg-panel px-2 text-[13.5px] text-ink placeholder:text-faint focus:border-accent focus:outline-none"
          />
        </label>
        <Select label="type" value={filters.type} onChange={(v) => update({ type: v })}>
          <option value="">all</option>
          {INCIDENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_META[t].label}
            </option>
          ))}
        </Select>
        <Select label="category" value={filters.category} onChange={(v) => update({ category: v })}>
          <option value="">all</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_META[c].label}
            </option>
          ))}
        </Select>
        <Select label="severity" value={filters.severity} onChange={(v) => update({ severity: v })}>
          <option value="">all</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={String(s)}>
              {s} {SEVERITY_META[s].label}
            </option>
          ))}
        </Select>
        <Select label="target" value={filters.target} onChange={(v) => update({ target: v })}>
          <option value="">all</option>
          {TARGETS.map((t) => (
            <option key={t} value={t}>
              {TARGET_META[t].label}
            </option>
          ))}
        </Select>
        <Select label="year" value={filters.year} onChange={(v) => update({ year: v })}>
          <option value="">all</option>
          {facets.years.map((y) => (
            <option key={y.year} value={String(y.year)}>
              {y.year}
            </option>
          ))}
        </Select>
        <Select label="source" value={filters.publisher} onChange={(v) => update({ publisher: v })}>
          <option value="">all</option>
          {facets.publishers.map(([p, n]) => (
            <option key={p} value={p}>
              {p} ({n})
            </option>
          ))}
        </Select>
        <Select label="records" value={filters.kind} onChange={(v) => update({ kind: v })}>
          <option value="">incidents</option>
          <option value="disclosed">disclosed CVEs</option>
          <option value="all">both</option>
        </Select>
        <Select label="origin" value={filters.origin} onChange={(v) => update({ origin: v })}>
          <option value="">all</option>
          {ORIGINS.map((o) => (
            <option key={o} value={o}>
              {ORIGIN_META[o].label}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-[13px] text-dim">
        <div className="num" aria-live="polite">
          {status}
          {ready &&
            chips.map((c) => (
              <button key={c.key} type="button" onClick={() => update({ [c.key]: "" } as Partial<Filters>)} className="ml-3 inline-flex items-center gap-1 rounded-[3px] border border-accent/40 bg-accent-tint px-1.5 py-0.5 font-mono text-[11px] text-accent" title="remove this filter">
                {c.label} ×
              </button>
            ))}
          {ready && active > 0 && (
            <button type="button" onClick={() => update({ ...EMPTY })} className="ml-3 link">
              clear filters
            </button>
          )}
        </div>
        <label className="flex items-center gap-2">
          <span className="label">sort</span>
          <select
            value={filters.sort}
            onChange={(e) => update({ sort: e.target.value as Filters["sort"] })}
            className="h-7 rounded-[3px] border border-line bg-panel px-2 font-mono text-[11px] text-ink"
          >
            <option value="reported">newest reported</option>
            <option value="incident">newest incident date</option>
            <option value="severity">highest severity</option>
          </select>
        </label>
      </div>

      <ol className="divide-y divide-line-soft border-y border-line-soft">
        {results.slice(0, shown).map((i) => (
          <li key={i.id} className="py-3 grid gap-2 sm:grid-cols-[6.5rem_1fr_auto] sm:gap-4">
            <div className="num text-[12px] text-dim sm:pt-0.5">
              <div>{i.first_reported}</div>
              <div className="text-faint">{i.id}</div>
            </div>
            <div className="min-w-0">
              <Link href={`/incidents/${i.slug}`} className="text-[15px] leading-snug text-ink hover:text-accent">
                {i.title}
              </Link>
              <p className="mt-1 text-[13px] text-dim leading-relaxed line-clamp-2">{i.summary}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {i.disclosed && (
                  <span className="inline-flex items-center rounded-[3px] border border-line px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-[0.08em] text-dim" title="A CVE or advisory with no confirmed exploitation: tracked separately, not counted as an incident">
                    disclosed CVE
                  </span>
                )}
                <SeverityBadge severity={i.severity} />
                <TypeBadge type={i.type} short />
                {i.categories.map((c) => (
                  <CategoryBadge key={c} category={c} />
                ))}
                <span className="num self-center text-[10.5px] text-faint">
                  {i.targets.map((t) => TARGET_META[t].label).join(", ")}
                  {i.products.length ? ` · ${i.products.slice(0, 3).join(", ")}` : ""}
                </span>
              </div>
            </div>
            <div className="num text-[11px] text-dim sm:text-right whitespace-nowrap">
              <div>{i.source_count} source{i.source_count === 1 ? "" : "s"}</div>
              <div className="text-faint">{approxDateLabel(i.incident_date, i.incident_date_precision)}</div>
            </div>
          </li>
        ))}
      </ol>

      {canGrow && (
        <div className="text-center">
          <button type="button" onClick={() => setShown(shown + PAGE)} className="label border border-line rounded-[3px] px-3 py-2 hover:text-ink">
            {results.length > shown ? `show ${Math.min(PAGE, results.length - shown)} more` : "load older years"}
          </button>
        </div>
      )}
      {complete && results.length === 0 && <p className="text-[13px] text-dim">No {kindNoun} match these filters.</p>}
    </div>
  );
}
