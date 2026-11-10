import type { ReactNode } from "react";
import { CvssChip } from "@/components/ui/Badge";
import { CVSS_BAND_META, cvssBand, cvssLabel } from "@/lib/cvss";
import { CVSS_COLORS } from "@/lib/palette";
import type { IncidentType } from "@/lib/taxonomy";

/**
 * The panel's ASCII marks, drawn as CSS blocks (globals.css): server-rendered
 * final, built in by PanelMotion. Kept apart from Instrument.tsx so the
 * client-side instruments do not pull the chip's taxonomy into the browser.
 */

/** A bar of `n` cells (7 by 12 px blocks, 2 px apart). */
export function Cells({ n }: { n: number }) {
  return (
    <span aria-hidden className="ascii-cells" data-cells={n}>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} />
      ))}
    </span>
  );
}

/** One 8 px square per item, wrapping: the first `bright` lit, the rest dim; or the first `red` in red and the rest lit. */
export function Units({ n, bright, red }: { n: number; bright?: number; red?: number }) {
  return (
    <span aria-hidden className="ascii-units" data-units={n}>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} className={red !== undefined ? (i < red ? "red" : "") : bright !== undefined && i >= bright ? "old" : ""} />
      ))}
    </span>
  );
}

/**
 * The day sheet's small tag: a word in a thin box, still, never a dot.
 * `stack` marks a row in the visitor's own stack and `ai` a record with an
 * AI role, on the runway and in its lists; the status tones (solid red for
 * harm confirmed, outlined red for no patch, amber for a deadline, `partial`
 * for a fix that covers some) label a product in My stack's drawers.
 */
export type TagTone = "harm" | "open" | "due" | "partial" | "ai" | "stack";
const TAG_TONE: Record<TagTone, string> = {
  harm: "border-live bg-live font-semibold text-ground",
  open: "border-live/55 font-medium text-live",
  due: "border-accent/55 font-medium text-accent",
  partial: "border-partial/55 font-medium text-partial",
  ai: "border-accent/50 font-medium text-accent",
  stack: "border-ink/35 font-medium text-ink",
};

export function Tag({ tone, title, children, ...rest }: { tone: TagTone; title?: string; children: ReactNode } & Record<`data-${string}`, string | undefined>) {
  return (
    <span {...rest} data-tag={tone} title={title} className={`inline-flex shrink-0 items-center rounded-[4px] border px-[5px] font-mono text-[10.5px] uppercase leading-[15px] tracking-[0.05em] whitespace-nowrap ${TAG_TONE[tone]}`}>
      {children}
    </span>
  );
}

/** The stack tag; which picks hold the row is in its hover note. It waits hidden while a visitor's own stack loads. */
export function StackTag({ labels, ready }: { labels: string[]; ready: boolean }) {
  return (
    <span data-stack={ready ? "ready" : "wait"} className="contents">
      {labels.length > 0 && (
        <Tag tone="stack" data-stack-mark={labels.join(",")} title={`In your stack: ${labels.join(", ")}`}>
          your stack
        </Tag>
      )}
    </span>
  );
}

/** The AI tag; which role AI played is in its hover note, and the "AI only" lens keeps both. */
export function AiTag({ type }: { type: IncidentType }) {
  if (type === "not_ai") return null;
  const on = type === "attack_on_ai";
  return (
    <Tag tone="ai" data-ai-mark={on ? "on" : "using"} title={on ? "Attack on AI: an AI model, agent or AI-powered product was the thing exploited" : "AI-enabled attack: attackers used AI as a meaningful part of the attack"}>
      AI
    </Tag>
  );
}

const SEV_OF_BAND = { critical: 4, high: 3, medium: 2, low: 1 } as const;

/** A CVSS score as a plain number in its band's colour, no box; nothing when there is no score. */
export function CvssNum({ score }: { score: number | null }) {
  if (score === null || Number.isNaN(score)) return null;
  const band = cvssBand(score);
  const meta = CVSS_BAND_META[band];
  return (
    <span data-cvss-band={band} title={`CVSS base score ${cvssLabel(score)}: ${meta.label.toLowerCase()} (${meta.range})`} className="num text-[12.5px]" style={{ color: `var(--color-sev-${SEV_OF_BAND[band]}, ${CVSS_COLORS[band]})` }}>
      {cvssLabel(score)}
    </span>
  );
}

/** The site's CVSS chip, or a faint outlined dash of the same size when there is no score. */
export function ScoreOrDash({ score }: { score: number | null }) {
  if (score !== null) return <CvssChip score={score} />;
  return (
    <span title="No CVSS score" className="num inline-flex min-w-[34px] items-center justify-center rounded-[3px] border border-line-soft px-1.5 py-[2px] text-[12px] leading-none text-faint">
      –
    </span>
  );
}
