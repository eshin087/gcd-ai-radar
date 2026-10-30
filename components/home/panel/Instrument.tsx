import type { ReactNode } from "react";

/**
 * The panel's one grammar. An instrument is a section with a hairline on top,
 * a mono label (and an optional sub-label) at the left, its source at the
 * right, the body, and at most one caption line. `data-build` lets
 * PanelMotion build it as it scrolls into view. Nothing on the panel sits
 * outside this frame.
 */
export function Instrument({ id, label, sub, source, full, caption, children }: { id: string; label: string; sub?: ReactNode; source: ReactNode; full?: boolean; caption?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} data-build data-instrument={id} className={`min-w-0 scroll-mt-6 border-t border-line pt-3 ${full ? "lg:col-span-2" : ""}`}>
      <header className="mb-3.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-mono text-[12px] font-medium uppercase tracking-[0.1em] text-dim">
          {label}
          {sub && <span className="ml-2.5 font-normal normal-case tracking-[0.02em] text-faint">{sub}</span>}
        </h2>
        <span className="font-mono text-[12px] text-faint [&_a]:text-accent [&_a:hover]:underline">{source}</span>
      </header>
      {children}
      {caption && <p className="mt-3 font-mono text-[12px] leading-[1.6] text-faint [&_b]:font-normal [&_b]:text-soft">{caption}</p>}
    </section>
  );
}

/** The red pulse: a one-character box whose glyph breathes · • ● • (globals.css .ascii-pulse). */
export function Pulse({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`ascii-pulse ${className}`} />;
}
