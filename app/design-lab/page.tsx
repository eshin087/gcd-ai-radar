import Link from "next/link";
import { Wordmark } from "@/components/layout/Wordmark";
import { loadIncidents } from "@/lib/data";
import { DRAFTS } from "./drafts";

export default async function DesignLabIndex() {
  const { incidents } = await loadIncidents();
  return (
    <div className="lab-root lab-amber">
      <div className="mx-auto max-w-3xl px-4 py-12 space-y-10">
        <header className="flex items-center justify-between">
          <Wordmark />
          <span className="label">design lab · {incidents.length.toLocaleString("en-US")} real incidents</span>
        </header>
        <div className="space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight">Three directions</h1>
          <p className="text-soft text-[15px] leading-relaxed">
            Each draft keeps the current structure (filters, trend, tiles, four breakdowns, click-through reports, latest incidents) on the real
            dataset, and changes the hero, motion, ASCII treatment and palette. Motion respects reduced-motion settings. Click any mark for the incidents
            behind it.
          </p>
        </div>
        <ol className="space-y-4">
          {DRAFTS.map((d, i) => (
            <li key={d.slug}>
              <Link href={`/design-lab/${d.slug}`} className="block glass p-5 hover:border-accent transition-colors">
                <div className="flex items-baseline justify-between gap-4">
                  <h2 className="text-xl font-medium">
                    <span className="num text-dim mr-3">{String(i + 1).padStart(2, "0")}</span>
                    {d.name}
                  </h2>
                  <span className="flex gap-1" aria-hidden>
                    {d.palette.map((c) => (
                      <span key={c} className="inline-block size-4 rounded-[2px] border border-line" style={{ background: c }} />
                    ))}
                  </span>
                </div>
                <p className="mt-3 text-[14px] text-soft leading-relaxed">{d.rationale}</p>
                <span className="label mt-3 inline-block text-accent">open draft →</span>
              </Link>
            </li>
          ))}
        </ol>
        <p className="text-[12px] text-faint">
          Hero art: two images generated with Codex for this project, converted to edge-aware glyph grids by scripts/ascii-art.ts and rendered live with
          WebGL. Chart colors pass the dataviz palette checks (lightness band, chroma, color-blind and normal-vision separation, contrast).
        </p>
      </div>
    </div>
  );
}
