"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { IncidentRow } from "@/components/incidents/IncidentRow";
import { RowLegend } from "@/components/incidents/RowLegend";
import { Segmented } from "@/components/ui/Segmented";
import { FULL_ROWS, boardsWithAll, type LaneBoard, type LiveRow } from "@/lib/live";
import { LANE_META, type Lane } from "@/lib/taxonomy";

/**
 * The feed: lane tabs with counts, an "AI only" switch and a search box over
 * the live rows, then the current lane's groups. The lane and the switch are
 * mirrored in the URL (?lane=, ?ai=1) so a view is a link; the server renders
 * the default view, the browser switches after hydration.
 */

const listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("popstate", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("popstate", cb);
  };
}
const getSearch = () => window.location.search;
const getServerSearch = () => "";
const noop = () => () => {};

function readView(search: string, keys: readonly string[]): { lane: string; ai: boolean } {
  const p = new URLSearchParams(search);
  const lane = p.get("lane") ?? "";
  return { lane: keys.includes(lane) ? lane : "all", ai: p.get("ai") === "1" };
}

function writeView(view: { lane: string; ai: boolean }) {
  const p = new URLSearchParams(window.location.search);
  if (view.lane && view.lane !== "all") p.set("lane", view.lane);
  else p.delete("lane");
  if (view.ai) p.set("ai", "1");
  else p.delete("ai");
  const qs = p.toString();
  window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  for (const cb of listeners) cb();
}

function Group({ group, rows }: { group: LaneBoard["groups"][number]; rows: LiveRow[] }) {
  const [more, setMore] = useState(false);
  const shown = more ? rows : rows.slice(0, FULL_ROWS);
  return (
    <section data-group={group.key} className="space-y-0">
      <h3 className="flex items-baseline justify-between gap-3 border-t border-line pt-4 pb-1 font-mono text-[12px] uppercase tracking-[0.1em] text-dim">
        <span>{group.label}</span>
        <span className="num text-faint">{rows.length}</span>
      </h3>
      <ol>
        {shown.map((r) => (
          <IncidentRow key={r.id} row={r} variant="full" />
        ))}
      </ol>
      {rows.length > FULL_ROWS && !more && (
        <button type="button" onClick={() => setMore(true)} className="label mt-3 rounded-[2px] border border-line px-3 py-2 hover:text-ink">
          show {rows.length - FULL_ROWS} more
        </button>
      )}
    </section>
  );
}

export function LiveBoard({ lanes, today }: { lanes: LaneBoard[]; today: string }) {
  // the "All" tab is built here so its rows never ship twice
  const boards = useMemo(() => boardsWithAll(lanes, today), [lanes, today]);
  const keys = useMemo(() => boards.map((b) => b.key), [boards]);
  const search = useSyncExternalStore(subscribe, getSearch, getServerSearch);
  const view = useMemo(() => readView(search, keys), [search, keys]);
  const [q, setQ] = useState("");
  // false on the server and during hydration, true once the browser owns the board (what scripts/check-live.mjs waits for)
  const ready = useSyncExternalStore(noop, () => true, () => false);

  const current = boards.find((b) => b.key === view.lane) ?? boards[0]!;
  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const keep = (r: LiveRow) => {
    if (view.ai && !r.ai) return false;
    if (terms.length) {
      const hay = `${r.title} ${r.products.join(" ")} ${r.cve_ids.join(" ")} ${r.id}`.toLowerCase();
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    return true;
  };
  const groups = current.groups.map((g) => ({ group: g, rows: g.rows.filter(keep) })).filter((g) => g.rows.length > 0);
  const visible = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <div data-live-board="" data-live-ready={ready ? "1" : "0"} data-lane={current.key} data-visible={visible} className="space-y-4">
      <div className="flex flex-col gap-3">
        <div className="overflow-x-auto">
          <Segmented
            label="Lane"
            value={current.key}
            onChange={(k) => writeView({ ...view, lane: k })}
            options={boards.map((b) => ({ key: b.key, label: `${b.label} ${b.count}`, title: b.key === "all" ? "The three action lanes together" : LANE_META[b.key as Lane].definition }))}
          />
        </div>
        <RowLegend />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            aria-pressed={view.ai}
            onClick={() => writeView({ ...view, ai: !view.ai })}
            title="Only records where AI was attacked or was the attacker's tool"
            className={`rounded-[2px] border px-2 py-1 font-mono text-[12px] uppercase tracking-[0.08em] ${view.ai ? "border-accent/60 bg-accent-tint text-accent" : "border-line text-dim hover:text-ink"}`}
          >
            AI only
          </button>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter the live list: title, product, CVE"
            aria-label="Filter the live list"
            className="h-8 min-w-0 flex-1 rounded-[2px] border border-line bg-panel px-2.5 text-[13px] text-ink placeholder:text-faint focus:border-accent focus:outline-none"
          />
        </div>
      </div>

      <p className="font-mono text-[12px] text-dim" aria-live="polite">
        <span className="num text-ink">{visible}</span> live in {current.label.toLowerCase()}
        {view.ai ? " · AI records only" : ""}
        {terms.length > 0 && (
          <>
            {" · "}
            <Link href={`/incidents?q=${encodeURIComponent(q.trim())}`} className="link">
              search the archive for “{q.trim()}” →
            </Link>
          </>
        )}
      </p>

      {groups.length === 0 ? (
        <p className="border-t border-line py-6 text-[14px] text-dim">Nothing live matches. Closed records are in the archive.</p>
      ) : (
        groups.map((g) => <Group key={g.group.key} group={g.group} rows={g.rows} />)
      )}
    </div>
  );
}
