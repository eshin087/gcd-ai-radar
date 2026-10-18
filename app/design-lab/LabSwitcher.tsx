import Link from "next/link";
import { DRAFTS, type DraftSlug } from "./drafts";

/** Floating pill to flip between drafts while reviewing. */
export function LabSwitcher({ current }: { current: DraftSlug }) {
  const idx = DRAFTS.findIndex((d) => d.slug === current);
  const prev = DRAFTS[(idx - 1 + DRAFTS.length) % DRAFTS.length]!;
  const next = DRAFTS[(idx + 1) % DRAFTS.length]!;
  return (
    <div className="fixed bottom-4 right-4 z-[80] flex items-center gap-1 rounded-[4px] border border-line bg-panel-2/95 px-2 py-1.5 font-mono text-[11px] shadow-2xl backdrop-blur">
      <Link href={`/design-lab/${prev.slug}`} className="px-1.5 text-dim hover:text-ink" aria-label={`Previous draft: ${prev.name}`}>
        ←
      </Link>
      <Link href="/design-lab" className="px-1.5 uppercase tracking-[0.12em] text-soft hover:text-accent">
        draft {idx + 1}/{DRAFTS.length} · {DRAFTS[idx]!.name}
      </Link>
      <Link href={`/design-lab/${next.slug}`} className="px-1.5 text-dim hover:text-ink" aria-label={`Next draft: ${next.name}`}>
        →
      </Link>
    </div>
  );
}
