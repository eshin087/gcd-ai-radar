import type { Metadata } from "next";
import { TagDirectory, type DirectoryGroup } from "@/components/tags/TagDirectory";
import { loadIncidents } from "@/lib/data";
import { TAG_GROUPS, TAG_GROUP_META, buildTagIndex, tagHref } from "@/lib/tags";

export const metadata: Metadata = {
  title: "Tags",
  description: "Every tag with its own page: attack types, stacks and products, vendors, threat actors, sectors and catalogues. Live records in red.",
};

export default async function TagsPage() {
  const { incidents } = await loadIncidents();
  const index = buildTagIndex(incidents, new Date());
  const live = index.directory.reduce((n, t) => n + t.live, 0);
  const groups: DirectoryGroup[] = TAG_GROUPS.map((g) => ({
    key: g,
    label: TAG_GROUP_META[g].label,
    lede: TAG_GROUP_META[g].lede,
    tags: index.directory.filter((t) => t.group === g).map((t) => ({ slug: t.slug, href: tagHref(t.slug), label: t.label, total: t.total, live: t.live })),
  })).filter((g) => g.tags.length > 0);
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-[28px] font-semibold tracking-tight">Tags</h1>
        <p className="mt-1 max-w-3xl text-[14px] leading-relaxed text-dim">
          {index.directory.length.toLocaleString("en-US")} tags over {incidents.length.toLocaleString("en-US")} records, most records first. The red number is
          how many are live; each tag has its own page. Tags are written by the classifier and folded into one spelling each; a tag needs two records, or a
          live one, to be listed.
        </p>
      </header>
      <TagDirectory groups={groups} />
      <p className="text-[12px] text-faint">{live.toLocaleString("en-US")} live tag mentions across the directory.</p>
    </div>
  );
}
