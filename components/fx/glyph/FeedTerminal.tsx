"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/components/fx/useReducedMotion";
import type { IntelCase, ThreatIntel } from "@/lib/threatIntel";
import { FATE_WORD, KIND_LABEL, SYSTEM_LABEL, threatFeed, type Fate, type FeedEvent } from "./feed";

/** One log entry: a simulated attack drawn from the 90-day mix, or a real case from the dataset. */
type Entry = { id: number; at: string; born: number; done: boolean } & ({ sim: FeedEvent } | { real: IntelCase });

/** Entries the tube shows, one line each. */
const ENTRIES = 5;
/** ms between new entries, and from an attack's arrival to its result */
const GAP = 4000;
const RESOLVE = 2000;
/** ms per typed character */
const TYPE = 24;
/** every this many entries, one is a real case */
const REAL_EVERY = 4;
const SPIN = "|/-\\";
const TONE: Record<Fate, string> = { blocked: "crt-stop", intercepted: "crt-stop", breach: "crt-red" };
const BOOT = "GCD RADAR OS 2.6 · LINK TO SOURCE FEEDS";
/** ms per boot-line character */
const BOOT_TYPE = 24;

const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 8);

/**
 * The terminal's own feed, on its own slow clock (it does not follow the
 * scene): after the boot line it prints the tail, then one entry every GAP
 * ms, typed out, an attack's result landing RESOLVE ms later. Simulated
 * attacks are drawn from the last 90 days (type, target and breach odds
 * real; the technique and response are typical ones for that type), and
 * every fourth entry is one of the latest real-world cases, linked.
 */
function useFeed(intel: ThreatIntel) {
  const [entries, setEntries] = useState<Entry[]>([]);
  useEffect(() => {
    const feed = threatFeed(intel, 11);
    const timers = new Set<number>();
    let n = 0;
    let ids = 0;
    let realAt = 0;
    const later = (fn: () => void, ms: number) => {
      const id = window.setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
    };
    const make = (when: number, born: number, done: boolean): Entry => {
      n += 1;
      const id = ++ids;
      const real = n % REAL_EVERY === 2 && intel.latest.length ? intel.latest[realAt++ % intel.latest.length] : undefined;
      return real ? { id, at: clock(when), born, done, real } : { id, at: clock(when), born, done, sim: feed.next() };
    };
    const live = () => {
      const e = make(Date.now(), performance.now(), false);
      setEntries((l) => [...l, e].slice(-ENTRIES));
      later(() => setEntries((l) => l.map((x) => (x.id === e.id ? { ...x, done: true } : x))), RESOLVE);
      later(live, GAP);
    };
    later(() => {
      const now = Date.now();
      setEntries(Array.from({ length: 3 }, (_, i) => make(now - (3 - i) * GAP, 0, true)));
      later(live, 1200);
    }, BOOT.length * BOOT_TYPE + 400);
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [intel]);
  return entries;
}

/** A clock for the typing and the spinner, running only while an entry is pending. */
function useTicker(active: boolean) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(performance.now()), 30);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

/** The boot line types itself once, paced by the clock (a throttled tab still finishes it); under reduced motion it is printed whole. */
function useTyped(text: string, reduced: boolean) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const t0 = performance.now();
    const id = window.setInterval(() => {
      const k = Math.min(text.length, Math.floor((performance.now() - t0) / BOOT_TYPE));
      setN(k);
      if (k >= text.length) window.clearInterval(id);
    }, BOOT_TYPE);
    return () => window.clearInterval(id);
  }, [text, reduced]);
  return reduced ? text.length : n;
}

type Part = [shown: string, cursor: boolean];
/** Text typed so far across an entry's three parts, in order: the text shown, and whether the cursor sits at its end. */
function typed(parts: [string, string, string], n: number): [Part, Part, Part] {
  let left = n;
  const one = (p: string): Part => {
    const k = Math.max(0, Math.min(p.length, left));
    const cursor = left >= 0 && left < p.length;
    left -= p.length;
    return [p.slice(0, k), cursor];
  };
  const a = one(parts[0]);
  const b = one(parts[1]);
  return [a, b, one(parts[2])];
}

const Cursor = () => <span className="cursor-block" />;

/**
 * The hero's terminal, an ice-cyan phosphor CRT running `tail -f` on the
 * threat feed: a reverse-video status bar, a boot line, the 90-day numbers,
 * then the last five entries, one line each, newest at the bottom. A new one
 * arrives every four seconds and types itself out (an attack's type and
 * target); two seconds later its result lands (white-cyan when the defences
 * stop it, red on a breach, an amber spinner while it is tracked), and the
 * line's tooltip says how it was carried out and what stopped it. Every
 * fourth entry is a real case from the dataset, its headline linked to its
 * page. Slow on purpose, so each one can be read; the panel's height is
 * fixed, so the log scrolls.
 */
export function FeedTerminal({ intel, className = "" }: { intel: ThreatIntel; className?: string }) {
  const reduced = useReducedMotion();
  const entries = useFeed(intel);
  const now = useTicker(!reduced && entries.some((l) => !l.done));
  const boot = useTyped(BOOT, reduced);
  const pct = Math.round(intel.harm * 100);
  const rising = intel.kinds.filter((k) => k.rising).map((k) => KIND_LABEL[k.category]);

  // scroll: when an entry arrives, the log starts its two rows lower and glides up
  const logRef = useRef<HTMLDivElement>(null);
  const seen = useRef<Set<number>>(new Set());
  const ids = entries.map((l) => l.id).join(",");
  useLayoutEffect(() => {
    const list = ids ? ids.split(",").map(Number) : [];
    const fresh = list.filter((id) => !seen.current.has(id)).length;
    const first = seen.current.size === 0;
    seen.current = new Set(list);
    const el = logRef.current;
    if (!el || !fresh || first || reduced) return;
    const row = parseFloat(getComputedStyle(el).lineHeight) || 20;
    for (const a of el.getAnimations()) a.cancel();
    el.animate([{ transform: `translateY(${Math.min(fresh, ENTRIES) * row}px)` }, { transform: "translateY(0)" }], { duration: 420, easing: "cubic-bezier(.2,.7,.2,1)" });
  }, [ids, reduced]);

  return (
    <div className={`crt crt-feed relative overflow-hidden rounded-[12px] border-[4px] font-mono text-[10.5px] uppercase leading-[1.6] sm:text-[11.5px] ${className}`}>
      <div className="crt-text relative space-y-px px-3 pb-2 pt-2">
        <div className="crt-rev -mx-1 mb-1 flex items-center justify-between gap-3 rounded-[2px] px-1.5 font-semibold tracking-[0.08em]">
          <span className="truncate">Threat feed · tail -f</span>
          <span className="flex shrink-0 items-center gap-1.5">
            <span className="cursor-blink inline-block size-[7px] rounded-full bg-[#04101c]" />
            Live
          </span>
        </div>
        <div className="truncate opacity-60">
          {BOOT.slice(0, boot)}
          {boot >= BOOT.length && " ..... OK"}
        </div>
        <div className="truncate">
          <span className="opacity-70">Last {intel.days}d </span>
          <span className="crt-hot">{intel.total.toLocaleString("en-US")}</span> incidents · <span className="crt-hot">{pct}%</span> real harm
          {rising.length > 0 && (
            <>
              <span className="opacity-70"> · rising </span>
              <span className="crt-hot">^ {rising.join(", ")}</span>
            </>
          )}
        </div>
        <div className="flex flex-col justify-end overflow-hidden pt-1" style={{ height: `${ENTRIES * 1.6}em`, boxSizing: "content-box" }}>
          <div ref={logRef} role="log" aria-label="Simulated attacks drawn from the last 90 days of incidents, with the latest real cases">
            {entries.map((e) => {
              const n = e.done || reduced || !e.born ? Infinity : Math.max(0, Math.floor((now - e.born) / TYPE));
              if ("real" in e) {
                const r = e.real;
                const kind = KIND_LABEL[r.category];
                const target = r.target ? SYSTEM_LABEL[r.target] : "AI systems";
                const [k, ti] = typed([kind, r.title, ""], n);
                return (
                  <div key={e.id} className="crt-burn -mx-1 flex items-baseline gap-2 whitespace-nowrap rounded-[2px] px-1" title={`Real case, first reported ${r.date}: ${kind} on ${target}. ${r.title}`}>
                    <span className="hidden w-[8ch] shrink-0 opacity-70 sm:inline">{r.date.slice(5)}</span>
                    <span className="crt-real shrink-0 rounded-[2px] px-1 text-[0.85em] font-semibold">Real</span>
                    <span className="w-[13ch] shrink-0 truncate sm:w-[17ch]">
                      {k[0]}
                      {k[1] && <Cursor />}
                    </span>
                    <Link href={`/incidents/${r.slug}`} className="crt-sub min-w-0 flex-1 truncate normal-case hover:underline">
                      {ti[0] ? `“${ti[0]}${ti[0].length === r.title.length ? "”" : ""}` : "\u00a0"}
                      {ti[1] && <Cursor />}
                    </Link>
                  </div>
                );
              }
              const ev = e.sim;
              const [k, tg] = typed([ev.kind, ev.target, ""], n);
              const typing = n < ev.kind.length + ev.target.length;
              return (
                <div
                  key={e.id}
                  className={`-mx-1 flex items-baseline gap-2 whitespace-nowrap rounded-[2px] px-1 ${e.done && ev.fate === "breach" ? "crt-breach" : ""}`}
                  title={`Simulated from the last 90 days: ${ev.kind} via ${ev.tech}, against ${ev.target}${e.done ? ` · ${FATE_WORD[ev.fate].toLowerCase()} (${ev.response})` : ""}`}
                >
                  <span className="hidden w-[8ch] shrink-0 opacity-70 sm:inline">{e.at}</span>
                  <span className="w-[1ch] shrink-0 crt-hot">{ev.rising ? "^" : ""}</span>
                  <span className="w-[13ch] shrink-0 truncate sm:w-[17ch]">
                    {k[0]}
                    {k[1] && <Cursor />}
                  </span>
                  <span className="hidden opacity-60 sm:inline">{k[0].length === ev.kind.length ? "->" : "  "}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {tg[0]}
                    {tg[1] && <Cursor />}
                  </span>
                  {e.done ? (
                    <span className={`crt-burn shrink-0 font-semibold ${TONE[ev.fate]}`}>{FATE_WORD[ev.fate]}</span>
                  ) : (
                    <span className="crt-amber shrink-0">{typing ? "" : `${reduced ? "*" : SPIN[Math.floor(now / 110) % SPIN.length]} tracking`}</span>
                  )}
                </div>
              );
            })}
            {entries.length === 0 && <div className="opacity-60">reading the tail...</div>}
          </div>
        </div>
        <div>
          &gt; <span className="cursor-block cursor-blink" />
        </div>
      </div>
    </div>
  );
}
