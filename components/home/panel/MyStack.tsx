"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { ScoreOrDash, Tag } from "@/components/home/panel/marks";
import { Num } from "@/components/home/panel/Num";
import { usePanelState } from "@/components/home/panel/PanelState";
import { Drawer } from "@/components/ui/Drawer";
import { dateLabel } from "@/lib/format";
import { STACK_DAYS, STACK_MAX, flagBadge, type FlagTone, type StackCandidate, type StackFile, type StackItem } from "@/lib/panel/picks";

/**
 * My stack (lib/panel/stack.ts) as one strip over the runway: a chip per
 * product with a status light, its name, its exploitation in the last 90
 * days and, only while something is exploited and still open, a word in the
 * light's colour: red "harm" or "no patch", amber "due 10 Nov"
 * (lib/panel/picks.ts flagBadge). A calm chip has a grey light and no word,
 * so the flagged ones stand out. A chip opens the list behind its number
 * (the candidate's `items`, fetched with /stats/stack.json on first use).
 * "edit" opens every candidate in a drawer, where "copy share link" puts the
 * picks in ?stack= so a bookmark or a teammate's link opens the same stack.
 * The strip's right end holds the sheet's "AI only" lens.
 */

const TONE_INK: Record<FlagTone, string> = { harm: "text-live", open: "text-live", due: "text-accent", partial: "text-partial" };
const TONE_LIGHT: Record<FlagTone, string> = {
  harm: "bg-live shadow-[0_0_8px_var(--color-live)]",
  open: "bg-live shadow-[0_0_8px_var(--color-live)]",
  due: "bg-accent shadow-[0_0_8px_var(--color-accent)]",
  partial: "bg-partial shadow-[0_0_8px_var(--color-partial)]",
};

function FlagBadge({ flag, title }: { flag: string; title?: string }) {
  const b = flagBadge(flag);
  return (
    <Tag tone={b.tone} title={title}>
      {b.word}
    </Tag>
  );
}

function Chip({ t, onOpen }: { t: StackCandidate; onOpen: () => void }) {
  const b = t.flag ? flagBadge(t.flag) : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      data-stack-tile={t.key}
      data-flag={t.flag ?? ""}
      data-n={t.n}
      title={`${t.why.length ? t.why.join(" · ") : "nothing exploited and open"} · exploited in the last ${STACK_DAYS} days, flagged while still open`}
      aria-label={`${t.label}: ${t.n} exploited in ${STACK_DAYS} days${t.flag ? `, ${t.flag}` : ""}, open the list`}
      className="group inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.02] px-2 text-[12.5px] hover:border-white/25"
    >
      <span aria-hidden className={`size-1.5 rounded-full ${b ? TONE_LIGHT[b.tone] : "bg-white/20"}`} />
      <span className={`font-medium group-hover:text-accent ${b ? "text-ink" : "text-soft"}`}>{t.label}</span>
      <Num value={String(t.n)} className="font-mono text-dim" />
      {b && (
        <span data-stack-badge={b.tone} className={`font-mono text-[11px] font-medium uppercase tracking-[0.04em] ${TONE_INK[b.tone]}`}>
          {b.word}
        </span>
      )}
    </button>
  );
}

/* ---------- the tile's list ---------- */

const OPEN_WORDS: Record<Exclude<StackItem["open"], null | "due">, { word: string; cls: string }> = {
  unpatched: { word: "no patch yet", cls: "text-live" },
  partial: { word: "partly patched", cls: "text-partial" },
  loss: { word: "harm confirmed", cls: "text-live" },
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
 * contract scripts/check-home.mjs reads; the line saying why the tile is
 * flagged and the rows appear together once the file is in.
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
          {cand.flag && (
            <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[12px] text-soft">
              <FlagBadge flag={cand.flag} />
              <span>{cand.why.join(" · ")}</span>
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

function Chooser({ open, onClose, file, picks, isDefault, copied, onShare, onChange, onReset }: { open: boolean; onClose: () => void; file: StackFile | null; picks: string[]; isDefault: boolean; copied: string; onShare: () => void; onChange: (key: string, on: boolean) => void; onReset: () => void }) {
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
          {isDefault ? "Until you choose, the strip shows the most-exploited vendors and AI products." : "Your choice stays in this browser."} A coloured word means exploited and still open: a CISA deadline ahead (due), no full patch, or harm confirmed (data, money or service lost). The share link carries the stack to any device or teammate.
        </p>
        <button type="button" onClick={onShare} aria-live="polite" className="font-mono text-[12px] text-accent hover:underline">
          {copied ? `link ${copied}` : "copy share link"}
        </button>
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
                        {c.flag && <FlagBadge flag={c.flag} title={c.why.join(" · ")} />}
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
  const { tiles, picks, isDefault, ready, file, loadFile, setPicks, aiOnly, setAiOnly } = usePanelState();
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
    <section id="stack" data-build data-instrument="stack" aria-label="My stack" className="flex min-w-0 scroll-mt-6 flex-wrap items-center gap-1.5">
      <h2 className="mr-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-dim">My stack</h2>
      <div data-stack={ready ? "ready" : "wait"} data-tiles={tiles.length} className="contents">
        {tiles.map((t) => (
          <Chip key={t.key} t={t} onOpen={() => show(t)} />
        ))}
      </div>
      <button type="button" onClick={choose} className="h-8 px-1.5 font-mono text-[12px] text-dim hover:text-accent">
        edit
      </button>
      <span role="group" aria-label="Show every record or only those with an AI role" className="ml-auto inline-flex font-mono text-[12px]">
        {([false, true] as const).map((on, i) => (
          <button key={String(on)} type="button" data-filter={on ? "ai" : "all"} aria-pressed={aiOnly === on} onClick={() => setAiOnly(on)} className={`h-8 px-2 uppercase tracking-[0.08em] hover:text-accent ${i ? "border-l border-line" : ""} ${aiOnly === on ? "text-accent" : "text-dim"}`}>
            {on ? "AI only" : "all"}
          </button>
        ))}
      </span>
      <StackDrawer cand={shown} file={file} onClose={() => setShown(null)} />
      <Chooser open={open} onClose={() => setOpen(false)} file={file} picks={picks} isDefault={isDefault} copied={copied} onShare={share} onChange={change} onReset={() => setPicks([])} />
    </section>
  );
}
