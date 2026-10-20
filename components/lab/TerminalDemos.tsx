"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CountUp } from "@/components/fx/CountUp";
import { Ago, NextSweep } from "@/components/fx/NextSweep";
import { prefersReducedMotion } from "@/components/fx/useReducedMotion";
import { KIND_LABEL, SYSTEM_LABEL } from "@/components/fx/glyph/feed";
import type { IntelCase } from "@/lib/threatIntel";

export interface TermData {
  command: string;
  real: number;
  sources: number;
  disclosed: number;
  /** incidents in view and the window they cover */
  count: number;
  window: string;
  share: number;
  lastUpdated: string | null;
  latest: IntelCase[];
}

/** Milliseconds since the panel first scrolled into view (restartable); everything is shown at once under reduced motion. */
function useTimeline(): [number, () => void, React.RefObject<HTMLDivElement | null>] {
  const ref = useRef<HTMLDivElement>(null);
  const [ms, setMs] = useState(0);
  const [run, setRun] = useState(0);
  useEffect(() => {
    if (prefersReducedMotion()) {
      const id = requestAnimationFrame(() => setMs(1e9));
      return () => cancelAnimationFrame(id);
    }
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    let t0 = 0;
    const tick = (now: number) => {
      if (!t0) t0 = now;
      setMs(now - t0);
      if (now - t0 < 9000) raf = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !raf) {
        raf = requestAnimationFrame(tick);
        io.disconnect();
      }
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [run]);
  return [ms, () => setRun((r) => r + 1), ref];
}

const SPIN = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";

function Typed({ text, ms, start, speed = 26 }: { text: string; ms: number; start: number; speed?: number }) {
  const n = Math.max(0, Math.min(text.length, Math.floor((ms - start) / speed)));
  return <>{text.slice(0, n)}</>;
}

function Bar({ value, cells = 14 }: { value: number; cells?: number }) {
  const on = Math.round(value * cells);
  return (
    <span className="text-accent">
      {"█".repeat(on)}
      <span className="text-faint">{"░".repeat(cells - on)}</span>
    </span>
  );
}

function Leader() {
  return <span aria-hidden className="mx-1.5 min-w-4 flex-1 overflow-hidden whitespace-nowrap text-faint/70">{".".repeat(80)}</span>;
}

function Replay({ onClick, className = "" }: { onClick: () => void; className?: string }) {
  return (
    <button type="button" onClick={onClick} className={`font-mono text-[11px] text-dim hover:text-accent ${className}`}>
      ↻ replay
    </button>
  );
}

/** A: a macOS terminal window. */
export function MacTerminal({ d }: { d: TermData }) {
  const [ms, replay, ref] = useTimeline();
  const cmdEnd = 400 + d.command.length * 26;
  const lineAt = (i: number) => cmdEnd + 250 + i * 380;
  const spinner = SPIN[Math.floor(ms / 80) % SPIN.length];
  const row = (i: number, label: string, children: ReactNode, ok = true) => {
    if (ms < lineAt(i)) return null;
    const done = ms > lineAt(i) + 520;
    return (
      <div className="flex items-baseline whitespace-nowrap">
        <span className={`w-5 ${done ? (ok ? "text-[#5fd38d]" : "text-faint") : "text-accent"}`}>{done ? (ok ? "✔" : "–") : spinner}</span>
        <span className="text-soft">{label}</span>
        <Leader />
        {done ? children : <span className="text-faint">working…</span>}
      </div>
    );
  };
  return (
    <div ref={ref} className="overflow-hidden rounded-xl border border-[#2a3247] bg-[#0b0f19]/95 shadow-[0_24px_60px_-20px_rgba(0,0,0,.8)]">
      <div className="flex items-center gap-2 border-b border-[#1d2434] bg-[#121827] px-3.5 py-2.5">
        <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
        <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
        <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        <span className="mx-auto font-mono text-[11.5px] text-dim">gcd@radar — live — zsh — 84×12</span>
        <Replay onClick={replay} />
      </div>
      <div className="min-h-[214px] space-y-1 p-4 font-mono text-[13px] leading-relaxed">
        <div className="whitespace-nowrap">
          <span className="text-[#5fd38d]">gcd@radar</span>
          <span className="text-dim">:</span>
          <span className="text-[#7fdcff]">~</span>
          <span className="text-dim">$ </span>
          <span className="text-ink">
            <Typed text={d.command} ms={ms} start={400} />
          </span>
          {ms < cmdEnd && <span className="cursor-block" />}
        </div>
        {row(0, "incidents", (
          <>
          <span className="num text-ink">
            <CountUp value={d.count} />
          </span>
          <span className="ml-2 text-dim">{d.window}</span>
          </>
        ))}
        {row(1, "real-world", (
          <>
          <span className="num text-accent">
            <CountUp value={d.real} />
          </span>
          <span className="ml-3">
            <Bar value={d.share} />
          </span>
          <span className="ml-2 text-dim">{Math.round(d.share * 100)}% real harm</span>
          </>
        ))}
        {row(2, "deduplicated", (
          <>
          <span className="num text-ink">
            <CountUp value={d.sources} />
          </span>
          <span className="ml-2 text-dim">sources, one event each</span>
          </>
        ))}
        {row(3, "disclosed CVEs", (
          <>
          <span className="num text-soft">
            <CountUp value={d.disclosed} />
          </span>
          <span className="ml-2 text-dim">tracked apart</span>
          </>
        ), false)}
        {row(4, "last sweep", (
          <>
          <span className="text-ink">
            <Ago iso={d.lastUpdated} />
          </span>
          <span className="ml-2 text-dim">
            next in <NextSweep className="text-soft" />
          </span>
          </>
        ))}
        {ms > lineAt(5) && (
          <div className="whitespace-nowrap">
            <span className="text-[#5fd38d]">gcd@radar</span>
            <span className="text-dim">:</span>
            <span className="text-[#7fdcff]">~</span>
            <span className="text-dim">$ </span>
            <span className="cursor-block cursor-blink" />
          </div>
        )}
      </div>
    </div>
  );
}

/** B: a retro CRT, phosphor amber, with a boot sequence. */
export function CrtTerminal({ d }: { d: TermData }) {
  const [ms, replay, ref] = useTimeline();
  const boot = ["GCD RADAR OS 2.6  (C) GCD", "MEMORY TEST ........ 640K OK", "LINK TO SOURCE FEEDS  OK", `LOADING THREAT MODEL  [${"#".repeat(Math.min(16, Math.floor(ms / 90)))}${"-".repeat(Math.max(0, 16 - Math.floor(ms / 90)))}]`];
  const bootDone = 1700;
  const line = (i: number) => ms > bootDone + 300 + i * 320;
  return (
    <div ref={ref} className="crt relative overflow-hidden rounded-[18px] border-[10px] border-[#14110c] bg-[#120c04] p-5 shadow-[inset_0_0_80px_rgba(0,0,0,.9),0_20px_50px_-20px_rgba(0,0,0,.9)]">
      <div className="crt-text min-h-[200px] space-y-0.5 font-mono text-[13px] uppercase leading-relaxed text-[#ffb35c]">
        {boot.map((b, i) => (ms > i * 380 ? <div key={i} className={ms > bootDone ? "opacity-45" : ""}>{b}</div> : null))}
        {ms > bootDone && (
          <div className="pt-2">
            &gt; <Typed text={d.command.toUpperCase()} ms={ms} start={bootDone} speed={22} />
          </div>
        )}
        {line(0) && (
          <div className="flex whitespace-nowrap">
            REAL-WORLD INCIDENTS <Leader />
            <span className="num">{d.real}</span>
          </div>
        )}
        {line(1) && (
          <div className="flex whitespace-nowrap">
            SOURCES, DEDUPLICATED <Leader />
            <span className="num">{d.sources}</span>
          </div>
        )}
        {line(2) && (
          <div className="flex whitespace-nowrap opacity-70">
            DISCLOSED CVES (APART) <Leader />
            <span className="num">{d.disclosed.toLocaleString("en-US")}</span>
          </div>
        )}
        {line(3) && (
          <div className="flex whitespace-nowrap">
            LAST SWEEP <Leader />
            <Ago iso={d.lastUpdated} />
          </div>
        )}
        {line(4) && (
          <div>
            &gt; <span className="cursor-block cursor-blink bg-[#ffb35c]" />
          </div>
        )}
      </div>
      <Replay onClick={replay} className="absolute right-3 top-2 !text-[#ffb35c]/60" />
    </div>
  );
}

/** C: Warp-style command blocks with status chips. */
export function BlockTerminal({ d }: { d: TermData }) {
  const [ms, replay, ref] = useTimeline();
  const second = "radar latest --real --limit 3";
  const b2 = 400 + d.command.length * 22 + 1900;
  const block = (cmd: string, start: number, took: string, children: ReactNode) => {
    if (ms < start) return null;
    const typedEnd = start + cmd.length * 22;
    const done = ms > typedEnd + 450;
    return (
      <div className="rounded-lg border border-[#232b3d] bg-[#0e1320]">
        <div className="flex items-center gap-2 border-b border-[#1a2131] px-3 py-2 font-mono text-[12.5px]">
          <span className="text-[#7fdcff]">❯</span>
          <span className="min-w-0 truncate text-ink">
            <Typed text={cmd} ms={ms} start={start} speed={22} />
          </span>
          {done && (
            <span className="ml-auto flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[11px]">
              <span className="rounded-full bg-[#5fd38d]/12 px-2 py-0.5 text-[#5fd38d]">✓ exit 0</span>
              <span className="rounded-full bg-white/5 px-2 py-0.5 text-dim">{took}</span>
            </span>
          )}
        </div>
        {done && <div className="space-y-1 px-3 py-2.5 font-mono text-[12.5px]">{children}</div>}
      </div>
    );
  };
  return (
    <div ref={ref} className="space-y-2.5 rounded-xl border border-line bg-[#080b13] p-3">
      <div className="flex items-center justify-between px-1">
        <span className="font-mono text-[11px] tracking-[0.14em] text-dim">RADAR · LIVE SESSION</span>
        <Replay onClick={replay} />
      </div>
      {block(d.command, 400, "0.42s", (
        <>
        <div className="flex flex-wrap gap-2">
          {[
            ["real-world", d.real, "text-accent"],
            ["deduplicated", d.sources, "text-ink"],
            ["disclosed CVEs", d.disclosed, "text-soft"],
          ].map(([label, v, tone]) => (
            <span key={label as string} className="rounded-md border border-[#232b3d] bg-[#121829] px-2.5 py-1.5">
              <span className={`num block text-[17px] ${tone as string}`}>
                <CountUp value={v as number} />
              </span>
              <span className="text-[11px] text-dim">{label as string}</span>
            </span>
          ))}
          <span className="rounded-md border border-[#232b3d] bg-[#121829] px-2.5 py-1.5">
            <span className="block text-[17px] text-ink">
              <Ago iso={d.lastUpdated} />
            </span>
            <span className="text-[11px] text-dim">last sweep</span>
          </span>
        </div>
        </>
      ))}
      {block(second, b2, "0.08s", (
        <>
        {d.latest.slice(0, 3).map((c) => (
          <div key={c.slug} className="truncate">
            <span className="text-faint">{c.date.slice(5)} </span>
            <span className="text-[#ff8a7a]">{KIND_LABEL[c.category].toLowerCase()}</span>
            <span className="text-dim"> → </span>
            <span className="text-soft">{c.target ? SYSTEM_LABEL[c.target] : "n/a"}</span>
            <span className="text-dim"> · {c.title}</span>
          </div>
        ))}
        </>
      ))}
      <div className="flex items-center gap-2 rounded-lg border border-[#232b3d] px-3 py-2 font-mono text-[12.5px] text-faint">
        <span className="text-[#7fdcff]">❯</span> type a command <span className="cursor-block cursor-blink ml-0.5" />
      </div>
    </div>
  );
}
