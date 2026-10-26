/**
 * A CVSS base score on a chip coloured by band: red 9.0 and up, orange 7.0
 * to 8.9, blue 4.0 to 6.9, grey below. Nothing when the score is unknown.
 */
export function cvssBand(score: number): "critical" | "high" | "medium" | "low" {
  return score >= 9 ? "critical" : score >= 7 ? "high" : score >= 4 ? "medium" : "low";
}

const BAND_COLOR: Record<ReturnType<typeof cvssBand>, string> = {
  critical: "var(--color-sev-4)",
  high: "var(--color-sev-3)",
  medium: "var(--color-sev-2)",
  low: "var(--color-sev-1)",
};

export function ScoreChip({ score, title }: { score: number | null; title?: string }) {
  if (score === null || score === undefined) return null;
  const color = BAND_COLOR[cvssBand(score)];
  return (
    <span
      title={title ?? `CVSS ${score.toFixed(1)}`}
      data-cvss={score.toFixed(1)}
      className="num inline-flex min-w-[2.6rem] items-center justify-center rounded-[2px] px-1.5 py-[1px] text-[12px] font-semibold text-ground"
      style={{ background: color }}
    >
      {score.toFixed(1)}
    </span>
  );
}
