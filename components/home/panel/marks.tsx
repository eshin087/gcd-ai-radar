import { CvssChip } from "@/components/ui/Badge";
import type { Severity } from "@/lib/taxonomy";

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

/** The track of a Vs bar, in cells of 7 px plus a 2 px gap. */
export const VS_CELLS = 24;

/**
 * This week's count as cells on a fixed track that spans `max`, against the
 * marks the week is judged by: a hairline where `typical` sits, a dim band
 * over the usual range and a faint hairline where busy starts (`p90`).
 * One cell at least for any count above zero, so a quiet week still shows.
 */
export function Vs({ n, max, typical, band, p90 }: { n: number; max: number; typical?: number | null; band?: [number, number] | null; p90?: number | null }) {
  const px = (v: number) => Math.round((Math.min(v, max) / max) * VS_CELLS) * 9;
  const lit = n > 0 ? Math.max(1, Math.round((Math.min(n, max) / max) * VS_CELLS)) : 0;
  return (
    <span aria-hidden className="vs" data-vs={lit} style={{ width: VS_CELLS * 9 - 2 }}>
      {band && <span className="band" style={{ left: px(band[0]), width: Math.max(2, px(band[1]) - px(band[0])) }} />}
      <Cells n={lit} />
      {typical !== null && typical !== undefined && <span className="tick" style={{ left: px(typical) }} />}
      {p90 !== null && p90 !== undefined && <span className="tick p90" style={{ left: px(p90) }} />}
    </span>
  );
}

/** Our severity as four bars: three lit for exploited, four in red for harm confirmed. */
export function SevMeter({ severity }: { severity: Severity }) {
  const word = severity >= 4 ? "harm confirmed" : severity === 3 ? "exploited" : severity === 2 ? "disclosed" : "research";
  return (
    <span className={`sev-meter ${severity >= 4 ? "s4" : ""}`} title={`Severity ${severity}: ${word}`} role="img" aria-label={`severity ${severity}, ${word}`}>
      {[1, 2, 3, 4].map((k) => (
        <i key={k} className={k <= severity ? "on" : ""} />
      ))}
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
