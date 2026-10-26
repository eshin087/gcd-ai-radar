import type { Metadata } from "next";
import Link from "next/link";
import { loadIncidents } from "@/lib/data";
import { TAG_GROUPS, TAG_GROUP_META, buildTagIndex, tagHref } from "@/lib/tags";

export const metadata: Metadata = {
  title: "Tags",
  description: "Every tag with its own page and feeds: attack types, stacks and products, vendors, threat actors, sectors and catalogues. Live records in red.",
};

export default async function TagsPage() {
  const { incidents } = await loadIncidents();
  const index = buildTagIndex(incidents, new Date());
  const live = index.directory.reduce((n, t) => n + t.live, 0);
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-[28px] font-semibold tracking-tight">Tags</h1>
        <p className="mt-1 max-w-3xl text-[14px] leading-relaxed text-dim">
          {index.directory.length.toLocaleString("en-US")} tags over {incidents.length.toLocaleString("en-US")} records, most records first. The red number is
          how many are live; each tag has its own page, RSS and JSON feeds and an llms.txt. Tags are written by the classifier and folded into one spelling
          each; a tag needs two records, or a live one, to be listed.
        </p>
      </header>
      {TAG_GROUPS.map((g) => {
        const tags = index.directory.filter((t) => t.group === g);
        if (tags.length === 0) return null;
        const meta = TAG_GROUP_META[g];
        return (
          <section key={g} id={g} className="scroll-mt-20">
            <h2 className="flex items-baseline justify-between gap-3 border-t border-line pt-3 pb-2 font-mono text-[12px] uppercase tracking-[0.1em] text-dim">
              <span>
                {meta.label} <span className="text-faint">· {meta.lede}</span>
              </span>
              <span className="num text-faint">{tags.length}</span>
            </h2>
            <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-[14px]">
              {tags.map((t) => (
                <li key={t.slug}>
                  <Link href={tagHref(t.slug)} className="text-soft hover:text-accent">
                    {t.label}
                  </Link>
                  <span className="num ml-1.5 text-[12px]">
                    {t.live > 0 && <span className="text-live">{t.live}/</span>}
                    <span className="text-faint">{t.total}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <p className="text-[12px] text-faint">{live.toLocaleString("en-US")} live tag mentions across the directory.</p>
    </div>
  );
}
