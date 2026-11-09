"use client";

import Link from "next/link";
import { useState } from "react";

/**
 * The tag directory with a finder. The page renders every group and tag
 * server-side (this component takes plain data, so the HTML is final); as a
 * visitor types, tags whose names do not contain the text fade to a third,
 * the typed letters light up inside the names that do, and each group's
 * count turns into "matches of total". Escape clears the box.
 */

export interface DirectoryTag {
  slug: string;
  href: string;
  label: string;
  total: number;
  live: number;
}

export interface DirectoryGroup {
  key: string;
  label: string;
  lede: string;
  tags: DirectoryTag[];
}

/** Where `needle` sits in `label`, ignoring case; -1 when absent or the needle is empty. */
export function matchAt(label: string, needle: string): number {
  return needle ? label.toLowerCase().indexOf(needle) : -1;
}

function Name({ label, at, len }: { label: string; at: number; len: number }) {
  if (at < 0) return <>{label}</>;
  return (
    <>
      {label.slice(0, at)}
      <mark className="rounded-[1px] bg-transparent font-semibold text-accent">{label.slice(at, at + len)}</mark>
      {label.slice(at + len)}
    </>
  );
}

export function TagDirectory({ groups }: { groups: DirectoryGroup[] }) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const total = groups.reduce((n, g) => n + g.tags.length, 0);
  const matches = needle ? groups.reduce((n, g) => n + g.tags.filter((t) => matchAt(t.label, needle) >= 0).length, 0) : total;

  return (
    <div className="space-y-8">
      <label className="relative block w-full max-w-md">
        <span className="sr-only">Find a tag</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQuery("");
          }}
          placeholder="Type to find a tag…"
          autoComplete="off"
          spellCheck={false}
          data-tag-search
          className="w-full rounded-[var(--radius-panel)] border border-line bg-panel py-2 pl-3 pr-28 font-mono text-[13px] text-ink placeholder:text-faint focus:border-accent focus:outline-none"
        />
        <span aria-live="polite" data-tag-count={matches} className="num pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[12px] text-faint">
          {needle ? `${matches} of ${total}` : `${total} tags`}
        </span>
      </label>

      {groups.map((g) => {
        const hits = needle ? g.tags.filter((t) => matchAt(t.label, needle) >= 0).length : g.tags.length;
        return (
          <section key={g.key} id={g.key} data-group={g.key} data-matches={hits} className={`scroll-mt-20 transition-opacity duration-200 ${needle && hits === 0 ? "opacity-30" : ""}`}>
            <h2 className="flex items-baseline justify-between gap-3 border-t border-line pt-3 pb-2 font-mono text-[12px] uppercase tracking-[0.1em] text-dim">
              <span>
                {g.label} <span className="text-faint">· {g.lede}</span>
              </span>
              <span className="num text-faint">{needle ? `${hits}/${g.tags.length}` : g.tags.length}</span>
            </h2>
            <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-[14px]">
              {g.tags.map((t) => {
                const at = matchAt(t.label, needle);
                const miss = needle !== "" && at < 0;
                return (
                  <li key={t.slug} data-tag={t.slug} data-match={needle ? (miss ? "0" : "1") : undefined} className={`transition-opacity duration-200 ${miss ? "opacity-30" : ""}`}>
                    <Link href={t.href} className={`${needle ? "text-dim" : "text-soft"} hover:text-accent`}>
                      <Name label={t.label} at={at} len={needle.length} />
                    </Link>
                    <span className="num ml-1.5 text-[12px]">
                      {t.live > 0 && <span className="text-live">{t.live}/</span>}
                      <span className="text-faint">{t.total}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
