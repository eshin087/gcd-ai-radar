import Link from "next/link";
import { Wordmark } from "@/components/layout/Wordmark";
import { loadIncidents } from "@/lib/data";
import { OPTIONS } from "./options";

export const metadata = { title: "Design options", robots: { index: false } };

export default async function DesignOptionsIndex() {
  const { incidents } = await loadIncidents();
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-8">
      <header className="flex items-center justify-between">
        <Wordmark />
        <span className="label">design options · {incidents.length} stub incidents</span>
      </header>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Five homepage layouts</h1>
        <p className="mt-2 text-soft">
          Each option is a complete homepage built from the real chart components and the synthetic stub dataset.
          They differ in chart hierarchy, density, navigation placement, type scale and how the headline numbers are
          presented. Pick one, or name a mix.
        </p>
      </div>
      <ol className="space-y-4">
        {OPTIONS.map((o, i) => (
          <li key={o.slug} className="panel p-5">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-lg font-medium">
                <span className="num text-dim mr-2">{String(i + 1).padStart(2, "0")}</span>
                <Link href={`/design-options/${o.slug}`} className="hover:text-accent">
                  {o.name}
                </Link>
              </h2>
              <Link href={`/design-options/${o.slug}`} className="label hover:text-ink">
                open →
              </Link>
            </div>
            <p className="mt-2 text-[13px] text-soft leading-relaxed">{o.rationale}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
