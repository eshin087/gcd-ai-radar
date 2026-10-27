import { CvssChip } from "@/components/ui/Badge";

/**
 * The home page's lists (new CVEs, KEV additions, the EPSS ten) show the same
 * CVSS chip as every incident row (components/ui/Badge.tsx CvssChip), so a
 * score reads the same everywhere on the site.
 */
export function ScoreChip({ score, version }: { score: number | null; version?: string | null }) {
  return <CvssChip score={score} version={version} />;
}
