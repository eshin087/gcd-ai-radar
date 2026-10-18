"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CategoryBadge, SeverityBadge, TypeBadge } from "@/components/ui/Badge";
import { approxDateLabel } from "@/lib/format";
import type { SlimIncident } from "@/lib/slim";
import { CATEGORIES, CATEGORY_META, INCIDENT_TYPES, ORIGIN_META, ORIGINS, SEVERITIES, SEVERITY_META, TARGETS, TARGET_META, TYPE_META } from "@/lib/taxonomy";

/**
 * Client-side explorer over /data/incidents.min.json. Filters live in the URL
 * query string so any view can be linked to. No libraries: plain substring
 * search over title, summary and products.
 */

interface Filters {
  q: string;
  type: string;
  category: string;
  severity: string;
  target: string;
  year: string;
  /** YYYY-MM, set by dashboard drill-downs. */
  month: string;
  publisher: string;
  origin: string;
  /** "1" = real-world only (severity 3-4), set by dashboard drill-downs. */
  real: string;
  /** "reported" dates by first report instead of incident date for month/year filters. */
  by: string;
  sort: "reported" | "incident" | "severity";
}

const EMPTY: Filters = { q: "", type: "", category: "", severity: "", target: "", year: "", month: "", publisher: "", origin: "", real: "", by: "", sort: "reported" };
const PAGE = 50;

function readFilters(): Filters {
  if (typeof window === "undefined") return EMPTY;
  const p = new URLSearchParams(window.location.search);
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
    publisher: p.get("publisher") ?? "",
    origin: p.get("origin") ?? "",
    real: p.get("real") ?? "",
    by: p.get("by") ?? "",
    sort: sort === "incident" || sort === "severity" ? sort : "reported",
  };
}

function writeFilters(f: Filters) {
  if (typeof window === "undefined") return;
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v && !(k === "sort" && v === "reported")) p.set(k, v);
  const qs = p.toString();
  window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
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

export function IncidentExplorer() {
  const [all, setAll] = useState<SlimIncident[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    let cancelled = false;
    fetch("/data/incidents.min.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((rows: SlimIncident[]) => {
        if (cancelled) return;
        // Apply the URL's filters once the data is here, so the first render is already the linked view.
        setFilters(readFilters());
        setAll(rows);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    setShown(PAGE);
    writeFilters(next);
  };

  const years = useMemo(() => {
    const set = new Set<string>();
    for (const i of all ?? []) set.add(i.first_reported.slice(0, 4));
    return [...set].sort().reverse();
  }, [all]);

  const publishers = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of all ?? []) for (const p of i.publishers) counts.set(p, (counts.get(p) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 60);
  }, [all]);

  const results = useMemo(() => {
    if (!all) return [];
    const q = filters.q.trim().toLowerCase();
    const dateOf = (i: SlimIncident) => (filters.by === "reported" ? i.first_reported : i.incident_date.length === 4 ? `${i.incident_date}-07` : i.incident_date);
    const rows = all.filter((i) => {
      if (filters.type && i.type !== filters.type) return false;
      if (filters.category && !filters.category.split(",").some((c) => i.categories.includes(c as SlimIncident["categories"][number]))) return false;
      if (filters.severity && String(i.severity) !== filters.severity) return false;
      if (filters.real === "1" && i.severity < 3) return false;
      if (filters.target && !i.targets.includes(filters.target as SlimIncident["targets"][number])) return false;
      if (filters.month && !dateOf(i).startsWith(filters.month)) return false;
      if (filters.year && !filters.month && !i.first_reported.startsWith(filters.year) && !i.incident_date.startsWith(filters.year)) return false;
      if (filters.publisher && !i.publishers.includes(filters.publisher)) return false;
      if (filters.origin && i.origin !== filters.origin) return false;
      if (q) {
        const hay = `${i.title} ${i.summary} ${i.products.join(" ")} ${i.id}`.toLowerCase();
        if (!q.split(/\s+/).every((term) => hay.includes(term))) return false;
      }
      return true;
    });
    rows.sort((a, b) => {
      if (filters.sort === "severity") return b.severity - a.severity || b.first_reported.localeCompare(a.first_reported);
      if (filters.sort === "incident") return b.incident_date.localeCompare(a.incident_date) || b.first_reported.localeCompare(a.first_reported);
      return b.first_reported.localeCompare(a.first_reported) || b.id.localeCompare(a.id);
    });
    return rows;
  }, [all, filters]);

  const active = Object.entries(filters).filter(([k, v]) => v && k !== "sort" && k !== "by").length;
  const chips: { key: keyof Filters; label: string }[] = [
    ...(filters.month ? [{ key: "month" as const, label: `month: ${filters.month}${filters.by === "reported" ? " (first reported)" : ""}` }] : []),
    ...(filters.real === "1" ? [{ key: "real" as const, label: "real-world only (severity 3–4)" }] : []),
  ];

  return (
    <div className="space-y-5">
      <div className="panel p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        <label className="flex flex-col gap-1 sm:col-span-2 xl:col-span-2">
          <span className="label">search</span>
          <input
            type="search"
            value={filters.q}
            onChange={(e) => update({ q: e.target.value })}
            placeholder="title, summary, product, id"
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
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </Select>
        <Select label="source" value={filters.publisher} onChange={(v) => update({ publisher: v })}>
          <option value="">all</option>
          {publishers.map(([p, n]) => (
            <option key={p} value={p}>
              {p} ({n})
            </option>
          ))}
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
        <div className="num">
          {all ? (
            <>
              {results.length.toLocaleString("en-US")} of {all.length.toLocaleString("en-US")} incidents
              {chips.map((c) => (
                <button key={c.key} type="button" onClick={() => update({ [c.key]: "" } as Partial<Filters>)} className="ml-3 inline-flex items-center gap-1 rounded-[3px] border border-accent/40 bg-accent-tint px-1.5 py-0.5 font-mono text-[11px] text-accent" title="remove this filter">
                  {c.label} ×
                </button>
              ))}
              {active > 0 && (
                <button type="button" onClick={() => update({ ...EMPTY })} className="ml-3 link">
                  clear filters
                </button>
              )}
            </>
          ) : error ? (
            <span className="text-sev-4">could not load the dataset: {error}</span>
          ) : (
            "loading…"
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

      {results.length > shown && (
        <div className="text-center">
          <button type="button" onClick={() => setShown(shown + PAGE)} className="label border border-line rounded-[3px] px-3 py-2 hover:text-ink">
            show {Math.min(PAGE, results.length - shown)} more
          </button>
        </div>
      )}
      {all && results.length === 0 && <p className="text-[13px] text-dim">No incidents match these filters.</p>}
    </div>
  );
}
