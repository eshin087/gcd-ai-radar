import type { ReactNode } from "react";

/**
 * The panel's one grammar. An instrument is a section with a label (and an
 * optional sub-label) at the left, its source at the right, the body, and at
 * most one caption line. Open, it sits under a hairline with a mono label
 * (My stack, the /trends instruments). Framed (`card`), it is a panel of its
 * own with a sans title: "lead" on the site's panel surface, the thing to
 * read first, "side" outlined beside it (Needs action and The week on the
 * home page); a framed panel is a flex column, so a body with `flex-1` fills
 * the height the grid gives it, and `legend` is one key line under the title
 * explaining the panel's marks and words. `data-build` lets PanelMotion build
 * it as it scrolls into view. Nothing on the panel sits outside this frame.
 */
export function Instrument({ id, label, sub, source, full, card, legend, caption, children }: { id: string; label: string; sub?: ReactNode; source: ReactNode; full?: boolean; card?: "lead" | "side"; legend?: ReactNode; caption?: ReactNode; children: ReactNode }) {
  const span = full ? "lg:col-span-2" : "";
  const captionEl = caption && <p className="mt-3 font-mono text-[12px] leading-[1.6] text-faint [&_b]:font-normal [&_b]:text-soft">{caption}</p>;
  const source_ = <span className="font-mono text-[12px] text-faint [&_a]:text-accent [&_a:hover]:underline">{source}</span>;
  if (card) {
    return (
      <section id={id} data-build data-instrument={id} data-card={card} className={`flex min-w-0 scroll-mt-6 flex-col px-3.5 py-4 sm:px-5 sm:py-5 ${card === "lead" ? "panel" : "rounded-[var(--radius-panel)] border border-line"} ${span}`}>
        <header className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="text-[17px] font-semibold leading-tight tracking-tight text-ink">
            {label}
            {sub && <span className="ml-2.5 text-[13px] font-normal tracking-normal text-dim">{sub}</span>}
          </h2>
          {source_}
        </header>
        {legend && <p className="-mt-2 mb-4 font-mono text-[11.5px] leading-[1.75] text-faint [&_b]:font-medium [&_b]:text-soft">{legend}</p>}
        {children}
        {captionEl}
      </section>
    );
  }
  return (
    <section id={id} data-build data-instrument={id} className={`min-w-0 scroll-mt-6 border-t border-line pt-3 ${span}`}>
      <header className="mb-3.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-mono text-[12px] font-medium uppercase tracking-[0.1em] text-dim">
          {label}
          {sub && <span className="ml-2.5 font-normal normal-case tracking-[0.02em] text-faint">{sub}</span>}
        </h2>
        {source_}
      </header>
      {children}
      {captionEl}
    </section>
  );
}

/** The red pulse: a one-character box whose glyph breathes · • ● • (globals.css .ascii-pulse). */
export function Pulse({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`ascii-pulse ${className}`} />;
}
