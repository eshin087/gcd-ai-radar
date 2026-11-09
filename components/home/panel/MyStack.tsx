"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { Instrument, Pulse } from "@/components/home/panel/Instrument";
import { ScoreOrDash } from "@/components/home/panel/marks";
import { Num } from "@/components/home/panel/Num";
import { usePanelState } from "@/components/home/panel/PanelState";
import { Drawer } from "@/components/ui/Drawer";
import { dateLabel } from "@/lib/format";
import { STACK_DAYS, STACK_MAX, type StackCandidate, type StackFile, type StackItem } from "@/lib/panel/picks";

/**
 * My stack (lib/panel/stack.ts): one tile per product, its exploitation in the
 * last 90 days, and a red flag only while something is exploited and still
 * open. A tile opens the list behind its number (the candidate's `items`,
 * fetched with /stats/stack.json on first use). "choose products" opens every
 * candidate in a drawer; "share link" copies the page's address with the
 * picks in ?stack=, so a bookmark or a teammate's link opens the same stack
 * anywhere.
 */

/** The flag in fewer letters, for the four-across tiles of a phone. */
function shortFlag(flag: string): string {
  return flag.startsWith("due") ? flag : flag === "confirmed loss" ? "loss" : flag === "no patch yet" ? "no patch" : "partial";
}

function Tile({ t, onOpen }: { t: StackCandidate; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-stack-tile={t.key}
      data-flag={t.flag ?? ""}
      data-n={t.n}
      title={`${t.why.length ? t.why.join(" · ") : "nothing exploited and open"} · exploited in the last ${STACK_DAYS} days, red while still open`}
      aria-label={`${t.label}: ${t.n} exploited in ${STACK_DAYS} days${t.flag ? `, ${t.flag}` : ""}, open the list`}
      className="group block w-full min-w-0 border-l border-line-soft pl-2.5 text-left hover:border-accent sm:pl-3"
    >
      <span className={`block truncate text-[13px] font-semibold group-hover:text-accent ${t.flag ? "text-ink" : "text-soft"}`}>{t.label}</span>
      <Num value={String(t.n)} className="mt-1 block font-mono text-[24px] font-medium leading-[1.15] text-ink sm:text-[28px]" />
      <span className="mt-0.5 flex min-h-[18px] items-center gap-1.5 overflow-hidden whitespace-nowrap font-mono text-[11px] text-live sm:text-[12px]">
        {t.flag && (
          <>
            <Pulse />
            <span className="hidden truncate sm:inline">{t.flag}</span>
            <span className="truncate sm:hidden">{shortFlag(t.flag)}</span>
          </>
        )}
      </span>
    </button>
  );
}

/* ---------- the tile's list ---------- */

const OPEN_WORDS: Record<Exclude<StackItem["open"], null | "due">, { word: string; cls: string }> = {
  unpatched: { word: "no patch yet", cls: "text-live" },
  partial: { word: "partly patched", cls: "text-partial" },
  loss: { word: "confirmed loss", cls: "text-live" },
};

function ItemRow({ it }: { it: StackItem }) {
  const cls = "text-[13.5px] text-ink hover:text-accent";
  const cve = it.cves.length > 1 ? `${it.cves[0]} +${it.cves.length - 1}` : it.cves[0];
  return (
    <li data-stack-item={it.kind} className="grid grid-cols-[3rem_minmax(0,1fr)] gap-3 border-t border-line-soft py-2.5 first:border-t-0">
      <div className="pt-0.5">
        <ScoreOrDash score={it.cvss} />
      </div>
      <div className="min-w-0">
        {it.external ? (
          <a href={it.href} target="_blank" rel="noopener noreferrer" className={cls}>
            {it.name}
          </a>
        ) : (
          <Link href={it.href} className={cls}>
            {it.name}
          </Link>
        )}
        {cve && <span className="num ml-2 text-[12px] text-dim">{cve}</span>}
        <p className="num mt-0.5 text-[12px] text-dim">
          {it.kind === "kev" ? "listed by CISA" : "reported"} {dateLabel(it.date)}
          {it.due && (
            <>
              {" · "}
              <span className={it.open === "due" ? "text-accent" : ""}>due {dateLabel(it.due)}</span>
            </>
          )}
          {it.open && it.open !== "due" && <span className={`ml-2 ${OPEN_WORDS[it.open].cls}`}>{OPEN_WORDS[it.open].word}</span>}
        </p>
      </div>
    </li>
  );
}

/**
 * What a tile counts, in the shared drawer shell: KEV entries CISA listed in
 * the 90 days and our exploited records no entry stands for, open ones first.
 * The count line starts with plain digits and the rows are `ol > li`, the
 * contract scripts/check-home.mjs reads; the red line and the rows appear
 * together once the file is in.
 */
function StackDrawer({ cand, file, onClose }: { cand: StackCandidate | null; file: StackFile | null; onClose: () => void }) {
  const titleId = useId();
  if (!cand) return null;
  const items = file?.candidates.find((c) => c.key === cand.key)?.items ?? null;
  const kevN = items ? items.filter((x) => x.kind === "kev").length : 0;
  const external = cand.href.startsWith("http");
  return (
    <Drawer
      open
      onClose={onClose}
      titleId={titleId}
      kicker={`My stack · exploited in the last ${STACK_DAYS} days`}
      footerLink={{ href: cand.href, label: external ? "CISA’s catalog →" : "product page →", external }}
      closeLabel="Close the list"
    >
      <header className="space-y-1">
        <h2 id={titleId} className="text-[18px] font-semibold leading-tight tracking-tight text-ink">
          {cand.label}
        </h2>
        <p className="num text-[13px] text-dim">
          {String(cand.n)} exploited in {STACK_DAYS} days
          {items && (
            <>
              {" · "}
              {kevN} on CISA’s list · {items.length - kevN} in our records
            </>
          )}
        </p>
      </header>
      {!items ? (
        <p className="text-[13px] text-dim">Loading…</p>
      ) : (
        <>
          {cand.why.length > 0 && (
            <p className="flex items-center gap-2 font-mono text-[12px] text-live">
              <Pulse />
              <span>red: {cand.why.join(" · ")}</span>
            </p>
          )}
          {items.length === 0 ? (
            <p className="text-[13px] text-dim">Nothing exploited in the last {STACK_DAYS} days.</p>
          ) : (
            <ol className="border-y border-line-soft">
              {items.map((it, i) => (
                <ItemRow key={`${it.kind}-${it.cves[0] ?? it.href}-${i}`} it={it} />
              ))}
            </ol>
          )}
        </>
      )}
    </Drawer>
  );
}

/* ---------- choosing products ---------- */

function Chooser({ open, onClose, file, picks, isDefault, onChange, onReset }: { open: boolean; onClose: () => void; file: StackFile | null; picks: string[]; isDefault: boolean; onChange: (key: string, on: boolean) => void; onReset: () => void }) {
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
        <p className="text-[12px] leading-relaxed text-faint">
          {isDefault ? "Until you choose, the tiles are the most-exploited vendors and AI products." : "Your choice stays in this browser."} Red means exploited and still open: a CISA deadline ahead, no full patch, or confirmed loss. The share link carries the stack to any device or teammate.
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
  const [shown, setShown] = useState<StackCandidate | null>(null);
  const [copied, setCopied] = useState<"" | "copied" | "in the address bar">("");

  const choose = async () => {
    setOpen(true);
    await loadFile();
  };
  const show = async (t: StackCandidate) => {
    setShown(t);
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
    >
      <div className="overflow-hidden">
        <div data-stack={ready ? "ready" : "wait"} data-tiles={tiles.length} className="-ml-2.5 grid grid-cols-4 gap-y-3 sm:-ml-3 sm:gap-y-4 xl:grid-cols-8">
          {tiles.map((t) => (
            <Tile key={t.key} t={t} onOpen={() => show(t)} />
          ))}
        </div>
      </div>
      <StackDrawer cand={shown} file={file} onClose={() => setShown(null)} />
      <Chooser open={open} onClose={() => setOpen(false)} file={file} picks={picks} isDefault={isDefault} onChange={change} onReset={() => setPicks([])} />
    </Instrument>
  );
}
