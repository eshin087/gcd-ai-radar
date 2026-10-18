import Link from "next/link";
import { OPTIONS, type OptionSlug } from "./options";

/** Floating pill to flip between the five candidates while reviewing. */
export function OptionSwitcher({ current }: { current: OptionSlug }) {
  const idx = OPTIONS.findIndex((o) => o.slug === current);
  const prev = OPTIONS[(idx - 1 + OPTIONS.length) % OPTIONS.length]!;
  const next = OPTIONS[(idx + 1) % OPTIONS.length]!;
  const option = OPTIONS[idx]!;
  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-1 rounded-[4px] border border-line bg-panel-2/95 px-2 py-1.5 font-mono text-[10.5px] shadow-2xl backdrop-blur">
      <Link href={`/design-options/${prev.slug}`} className="px-1.5 text-dim hover:text-ink" aria-label={`Previous: ${prev.name}`}>
        ←
      </Link>
      <Link href="/design-options" className="px-1.5 uppercase tracking-[0.12em] text-soft hover:text-accent">
        {String(idx + 1).padStart(2, "0")}/{String(OPTIONS.length).padStart(2, "0")} · {option.name}
      </Link>
      <Link href={`/design-options/${next.slug}`} className="px-1.5 text-dim hover:text-ink" aria-label={`Next: ${next.name}`}>
        →
      </Link>
    </div>
  );
}

export function OptionNote({ current }: { current: OptionSlug }) {
  const option = OPTIONS.find((o) => o.slug === current)!;
  return (
    <aside className="border-y border-line-soft bg-panel/40 px-4 py-2 text-[11px] text-dim">
      <span className="label text-accent">design option · {option.name}</span>
      <span className="ml-3">{option.rationale}</span>
    </aside>
  );
}
