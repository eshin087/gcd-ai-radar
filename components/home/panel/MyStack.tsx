"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { Instrument, Pulse } from "@/components/home/panel/Instrument";
import { Num } from "@/components/home/panel/Num";
import { usePanelState } from "@/components/home/panel/PanelState";
import { Drawer } from "@/components/ui/Drawer";
import { STACK_MAX, type StackCandidate, type StackFile } from "@/lib/panel/picks";

/**
 * My stack (lib/panel/stack.ts): one tile per product, its exploitation in the
 * last 90 days, and a red flag only while something is exploited and still
 * open. "choose products" opens every candidate in a drawer; "share link"
 * copies the page's address with the picks in ?stack=, so a bookmark or a
 * teammate's link opens the same stack anywhere.
 */

function Tile({ t }: { t: StackCandidate }) {
  return (
    <div data-stack-tile={t.key} data-flag={t.flag ?? ""} data-n={t.n} title={t.why.length ? t.why.join(" · ") : "nothing exploited and open"} className="min-w-0 border-l border-line-soft pl-3">
      <Link href={t.href} className={`block truncate text-[13px] font-semibold hover:text-accent ${t.flag ? "text-ink" : "text-soft"}`}>
        {t.label}
      </Link>
      <Num value={String(t.n)} className="mt-1 block font-mono text-[28px] font-medium leading-[1.15] text-ink" />
      <div className="mt-0.5 flex min-h-[18px] items-center gap-1.5 overflow-hidden whitespace-nowrap font-mono text-[12px] text-live">
        {t.flag && (
          <>
            <Pulse />
            <span className="truncate">{t.flag}</span>
          </>
        )}
      </div>
    </div>
  );
}

function Chooser({ open, onClose, file, picks, onChange, onReset }: { open: boolean; onClose: () => void; file: StackFile | null; picks: string[]; onChange: (key: string, on: boolean) => void; onReset: () => void }) {
  const titleId = useId();
  const [q, setQ] = useState("");
  const list = (file?.candidates ?? []).filter((c) => !q || c.label.toLowerCase().includes(q.toLowerCase()));
  const groups: [string, StackCandidate[]][] = [
    ["AI products", list.filter((c) => c.kind === "ai")],
    ["Vendors", list.filter((c) => c.kind === "vendor")],
  ];
  return (
    <Drawer open={open} onClose={onClose} titleId={titleId} kicker="My stack · kept in this browser" closeLabel="Close the product list">
      <header className="space-y-1">
        <h2 id={titleId} className="text-[18px] font-semibold leading-tight tracking-tight text-ink">
          Choose your products
        </h2>
        <p className="num text-[13px] text-dim">
          {file ? file.candidates.length : 0} products · {picks.length} of up to {STACK_MAX} chosen · the number is exploitation in the last 90 days
        </p>
      </header>
      <div className="mt-3 flex items-center gap-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter products"
          aria-label="Filter products"
          className="min-w-0 flex-1 rounded-[2px] border border-line bg-transparent px-2 py-1.5 font-mono text-[13px] text-ink placeholder:text-faint focus:border-accent focus:outline-none"
        />
        <button type="button" onClick={onReset} className="font-mono text-[12px] uppercase tracking-[0.08em] text-dim hover:text-accent">
          Reset
        </button>
      </div>
      {!file ? (
        <p className="mt-4 text-[13px] text-dim">Loading…</p>
      ) : (
        groups.map(([name, items]) =>
          items.length ? (
            <section key={name} className="mt-5">
              <h3 className="font-mono text-[12px] uppercase tracking-[0.1em] text-dim">{name}</h3>
              <ol className="mt-1 border-y border-line-soft">
                {items.map((c) => {
                  const on = picks.includes(c.key);
                  const full = !on && picks.length >= STACK_MAX;
                  return (
                    <li key={c.key} className="border-t border-line-soft first:border-t-0">
                      <label className={`flex items-center gap-3 py-2 text-[14px] ${full ? "cursor-not-allowed text-faint" : "cursor-pointer text-soft hover:text-ink"}`}>
                        <input type="checkbox" checked={on} disabled={full} onChange={(e) => onChange(c.key, e.target.checked)} className="accent-[#ffb35c]" />
                        <span className="min-w-0 flex-1 truncate">{c.label}</span>
                        {c.flag && <span className="font-mono text-[12px] text-live">{c.flag}</span>}
                        <span className="num w-8 text-right text-[13px] text-ink">{c.n}</span>
                      </label>
                    </li>
                  );
                })}
              </ol>
            </section>
          ) : null,
        )
      )}
    </Drawer>
  );
}

export function MyStack() {
  const { tiles, picks, isDefault, ready, file, loadFile, setPicks } = usePanelState();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<"" | "copied" | "in the address bar">("");

  const choose = async () => {
    setOpen(true);
    await loadFile();
  };
  const share = async () => {
    const url = `${location.origin}/?stack=${picks.join(",")}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied("copied");
    } catch {
      history.replaceState(null, "", `/?stack=${picks.join(",")}`);
      setCopied("in the address bar");
    }
    window.setTimeout(() => setCopied(""), 2500);
  };
  const change = (key: string, on: boolean) => setPicks(on ? [...picks, key] : picks.filter((k) => k !== key));

  return (
    <Instrument
      id="stack"
      full
      label="My stack"
      sub="exploited in the last 90 days"
      source={
        <>
          <button type="button" onClick={choose} className="text-accent hover:underline">
            choose products
          </button>
          {" · "}
          <button type="button" onClick={share} className="text-accent hover:underline" aria-live="polite">
            {copied ? `link ${copied}` : "share link"}
          </button>
        </>
      }
      caption={
        <>
          Red: exploited and still open, meaning a CISA deadline ahead, no full patch, or confirmed loss.{" "}
          {isDefault ? "Until you choose, these are the most-exploited vendors and AI products." : "Your choice stays in this browser."} The share link carries it to any device or teammate.
        </>
      }
    >
      <div className="overflow-hidden">
        <div data-stack={ready ? "ready" : "wait"} data-tiles={tiles.length} className="-ml-3 grid grid-cols-2 gap-y-4 sm:grid-cols-4 xl:grid-cols-8">
          {tiles.map((t) => (
            <Tile key={t.key} t={t} />
          ))}
        </div>
      </div>
      <Chooser open={open} onClose={() => setOpen(false)} file={file} picks={picks} onChange={change} onReset={() => setPicks([])} />
    </Instrument>
  );
}
