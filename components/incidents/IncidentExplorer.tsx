"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { IncidentRow, MonthHeading } from "@/components/incidents/IncidentRow";
import { Segmented } from "@/components/ui/Segmented";
import { createShardStore } from "@/components/useShards";
import {
  EMPTY_FILTERS,
  compareRecords,
  filtersQuery,
  laneCount,
  matchesRecord,
  parseFilters,
  recordDate,
  totalOfKind,
  yearsNeeded,
  type ExplorerFacets,
  type ExplorerFilters,
} from "@/lib/explorer";
import { monthLabel } from "@/lib/format";
import { rowOfSlim } from "@/lib/live";
import { hitIds, hitYears, matchesTerms, queryTerms, searchIndex, searchableText, tokenize, type SearchIndex } from "@/lib/search";
import type { SlimIncident } from "@/lib/slim";
import {
  ATLAS_IN_USE,
  ATLAS_TECHNIQUES,
  CATEGORIES,
  CATEGORY_META,
  INCIDENT_TYPES,
  LANES,
  LANE_META,
  ORIGIN_META,
  ORIGINS,
  OWASP_IN_USE,
  OWASP_LLM_META,
  PATCH_META,
  PATCH_STATUSES,
  SEVERITIES,
  SEVERITY_META,
  TARGETS,
  TARGET_META,
  TYPE_META,
} from "@/lib/taxonomy";

/**
 * The archive: a client-side explorer over the year shards of slim records
 * (/data/slim/<year>.json). The current year loads first; older years load
 * when the filters, the sort or the list's length need them (lib/explorer.ts
 * yearsNeeded). Search uses the prebuilt token index (/data/search-index.json)
 * over id, title and products, so it never needs the whole dataset. Filters
 * live in the URL query string (lib/explorer.ts parseFilters/filtersQuery),
 * so any view is a link.
 */

type Filters = ExplorerFilters;
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

function writeFilters(f: Filters) {
  if (typeof window === "undefined") return;
  const qs = filtersQuery(f);
  window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  for (const cb of urlListeners) cb();
}

function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-9 min-w-0 rounded-[2px] border border-line bg-panel px-2 font-mono text-[12.5px] text-ink focus:border-accent focus:outline-none">
        {children}
      </select>
    </label>
  );
}

const STATE_OPTIONS = [
  { key: "", label: "All" },
  { key: "live", label: "Live" },
  { key: "closed", label: "Closed" },
] as const;

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
    const rows = all.filter((i) => {
      if (!matchesRecord(i, filters)) return false;
      if (terms.length) {
        // The index decides once it is here; until then the same token test runs on the rows already loaded.
        if (hitIdSet) return hitIdSet.has(i.id);
        if (!matchesTerms(tokenize(searchableText(i)), terms)) return false;
      }
      return true;
    });
    rows.sort((a, b) => compareRecords(a, b, filters.sort));
    return rows;
  }, [all, filters, hitIdSet]);

  const complete = ready && shards.missing.length === 0 && needed.reason !== "index";
  const inKind = totalOfKind(facets, filters.kind);
  const kindNoun = filters.kind === "disclosed" ? "disclosed vulnerabilities" : filters.kind === "all" ? "records" : "incidents";
  const active = Object.entries(filters).filter(([k, v]) => v && k !== "sort" && k !== "by" && k !== "kind").length;
  /** The default list is the newest years only; older ones arrive as the list grows. */
  const newestOnly = needed.reason === "newest" && needed.years.length < facets.years.length;
  const canGrow = results.length > shown || (newestOnly && complete);
  const dated = filters.by === "reported" ? " (first reported)" : "";
  const chips: { key: keyof Filters; label: string }[] = [
    ...(filters.day ? [{ key: "day" as const, label: `day: ${filters.day}${dated}` }] : []),
    ...(filters.month ? [{ key: "month" as const, label: `month: ${filters.month}${dated}` }] : []),
    ...(filters.from ? [{ key: "from" as const, label: `from: ${filters.from}${dated}` }] : []),
    ...(filters.to ? [{ key: "to" as const, label: `to: ${filters.to}` }] : []),
    ...(filters.real === "1" ? [{ key: "real" as const, label: "real-world only (severity 3–4)" }] : []),
    ...(filters.product ? [{ key: "product" as const, label: `product: ${filters.product}` }] : []),
    ...(filters.tag ? [{ key: "tag" as const, label: `tag: ${filters.tag}` }] : []),
    ...(filters.patch ? [{ key: "patch" as const, label: `fix status: ${filters.patch.split(",").map((s) => PATCH_META[s as keyof typeof PATCH_META]?.label ?? s).join(" or ")}` }] : []),
  ];

  /** The rows on screen, under a heading per month when the order is by date. */
  const visible = useMemo(() => results.slice(0, shown), [results, shown]);
  const groups = useMemo(() => {
    if (filters.sort === "severity") return [{ month: "", rows: visible }];
    const out: { month: string; rows: SlimIncident[] }[] = [];
    for (const i of visible) {
      const month = (filters.sort === "incident" ? recordDate(i, { by: "" }) : i.first_reported).slice(0, 7);
      const last = out[out.length - 1];
      if (last && last.month === month) last.rows.push(i);
      else out.push({ month, rows: [i] });
    }
    return out;
  }, [visible, filters.sort]);
  const countIn = useMemo(() => {
    const m = new Map<string, number>();
    if (filters.sort === "severity") return m;
    for (const i of results) {
      const month = (filters.sort === "incident" ? recordDate(i, { by: "" }) : i.first_reported).slice(0, 7);
      m.set(month, (m.get(month) ?? 0) + 1);
    }
    return m;
  }, [results, filters.sort]);

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
    <div className="space-y-4">
      <div className="space-y-3">
        <input
          type="search"
          value={filters.q}
          onChange={(e) => update({ q: e.target.value })}
          onFocus={() => {
            if (!index) loadSearchIndex().then(setIndex).catch(() => undefined);
          }}
          placeholder="Search titles, products, CVE ids"
          aria-label="Search the archive"
          className="h-10 w-full rounded-[2px] border border-line bg-panel px-3 text-[14px] text-ink placeholder:text-faint focus:border-accent focus:outline-none"
        />
        <div className="overflow-x-auto">
          <Segmented
            label="Lane"
            value={filters.lane || "all"}
            onChange={(v) => update({ lane: v === "all" ? "" : v })}
            options={[
              { key: "all", label: `All ${inKind.toLocaleString("en-US")}` },
              ...LANES.map((l) => ({ key: l, label: `${LANE_META[l].label} ${laneCount(facets.lanes[l], filters.kind).toLocaleString("en-US")}`, title: LANE_META[l].definition })),
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Segmented label="State" size="sm" value={filters.state} onChange={(v) => update({ state: v })} options={STATE_OPTIONS} />
          <Segmented
            label="Severity"
            size="sm"
            value={filters.severity}
            onChange={(v) => update({ severity: v })}
            options={[{ key: "", label: "Any severity" }, ...SEVERITIES.map((s) => ({ key: String(s), label: String(s), title: SEVERITY_META[s].label }))]}
          />
          <button
            type="button"
            aria-pressed={filters.type === "ai"}
            onClick={() => update({ type: filters.type === "ai" ? "" : "ai" })}
            title="Only records where AI was attacked or was the attacker's tool"
            className={`rounded-[2px] border px-2 py-1 font-mono text-[12px] uppercase tracking-[0.08em] ${filters.type === "ai" ? "border-accent/60 bg-accent-tint text-accent" : "border-line text-dim hover:text-ink"}`}
          >
            AI only
          </button>
          <label className="flex items-center gap-2">
            <span className="label">year</span>
            <select value={filters.year} onChange={(e) => update({ year: e.target.value })} className="h-8 rounded-[2px] border border-line bg-panel px-2 font-mono text-[12px] text-ink">
              <option value="">all</option>
              {facets.years.map((y) => (
                <option key={y.year} value={String(y.year)}>
                  {y.year}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="label">sort</span>
            <select value={filters.sort} onChange={(e) => update({ sort: e.target.value as Filters["sort"] })} className="h-8 rounded-[2px] border border-line bg-panel px-2 font-mono text-[12px] text-ink">
              <option value="reported">newest reported</option>
              <option value="incident">newest incident date</option>
              <option value="severity">highest severity</option>
            </select>
          </label>
        </div>
        <details className="group">
          <summary className="label cursor-pointer select-none hover:text-ink">
            <span className="group-open:hidden">▸ more filters</span>
            <span className="hidden group-open:inline">▾ fewer filters</span>
          </summary>
          <div className="mt-3 grid gap-3 border-t border-line-soft pt-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <Select label="AI role" value={filters.type} onChange={(v) => update({ type: v })}>
              <option value="">all records</option>
              <option value="ai">AI records (either type)</option>
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
            <Select label="target" value={filters.target} onChange={(v) => update({ target: v })}>
              <option value="">all</option>
              {TARGETS.map((t) => (
                <option key={t} value={t}>
                  {TARGET_META[t].label}
                </option>
              ))}
            </Select>
            <Select label="fix status" value={filters.patch} onChange={(v) => update({ patch: v })}>
              <option value="">all</option>
              <option value="unpatched,partial">not fully patched</option>
              {PATCH_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {PATCH_META[s].label}
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
            <Select label="owasp llm top 10" value={filters.owasp} onChange={(v) => update({ owasp: v })}>
              <option value="">all</option>
              {OWASP_IN_USE.map((id) => (
                <option key={id} value={id}>
                  {id} {OWASP_LLM_META[id].name}
                </option>
              ))}
            </Select>
            <Select label="mitre atlas" value={filters.atlas} onChange={(v) => update({ atlas: v })}>
              <option value="">all</option>
              {ATLAS_IN_USE.map((id) => (
                <option key={id} value={id}>
                  {id} {ATLAS_TECHNIQUES[id]}
                </option>
              ))}
            </Select>
            <p className="self-end pb-2 text-[12px] text-faint sm:col-span-2 lg:col-span-3 xl:col-span-1">
              OWASP and ATLAS ids are derived from the categories.{" "}
              <Link href="/methodology#standards" className="link">
                How
              </Link>
            </p>
          </div>
        </details>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-dim">
        <div className="num" aria-live="polite" data-archive-status="">
          {status}
        </div>
        {ready &&
          chips.map((c) => (
            <button key={c.key} type="button" onClick={() => update({ [c.key]: "" } as Partial<Filters>)} className="inline-flex items-center gap-1 rounded-[2px] border border-accent/40 bg-accent-tint px-1.5 py-0.5 font-mono text-[12px] text-accent" title="remove this filter">
              {c.label} ×
            </button>
          ))}
        {ready && active > 0 && (
          <button type="button" onClick={() => update({ ...EMPTY_FILTERS })} className="link">
            clear filters
          </button>
        )}
      </div>

      <ol className="border-b border-line-soft">
        {groups.map((g) => (
          <li key={g.month || "all"}>
            <ol>
              {g.month && <MonthHeading month={monthLabel(g.month, true)} count={countIn.get(g.month) ?? g.rows.length} />}
              {g.rows.map((i) => (
                <IncidentRow key={i.id} row={rowOfSlim(i)} variant="full" />
              ))}
            </ol>
          </li>
        ))}
      </ol>

      {canGrow && (
        <div className="text-center">
          <button type="button" onClick={() => setShown(shown + PAGE)} className="label rounded-[2px] border border-line px-3 py-2 hover:text-ink">
            {results.length > shown ? `show ${Math.min(PAGE, results.length - shown)} more` : "load older years"}
          </button>
        </div>
      )}
      {complete && results.length === 0 && <p className="text-[13px] text-dim">No {kindNoun} match these filters.</p>}
    </div>
  );
}
