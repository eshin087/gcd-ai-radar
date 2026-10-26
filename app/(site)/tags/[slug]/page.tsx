import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IncidentRow } from "@/components/incidents/IncidentRow";
import { loadIncidents } from "@/lib/data";
import { monthLabel } from "@/lib/format";
import { daysBetween } from "@/lib/lifecycle";
import { rowOf } from "@/lib/live";
import { TAG_GROUP_META, buildTagIndex, type TagEntry } from "@/lib/tags";

export const dynamicParams = false;

/** Rows shown on the page; the rest is one click away in the archive. */
const MAX_ROWS = 200;

function tagIndexNow(incidents: Awaited<ReturnType<typeof loadIncidents>>["incidents"]) {
  return buildTagIndex(incidents, new Date());
}

export async function generateStaticParams() {
  const { incidents } = await loadIncidents();
  const slugs = tagIndexNow(incidents).directory.map((t) => ({ slug: t.slug }));
  // a static export needs at least one param; the placeholder page is a 404
  return slugs.length ? slugs : [{ slug: "none" }];
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const { incidents } = await loadIncidents();
  const t = tagIndexNow(incidents).bySlug.get(slug);
  if (!t) return {};
  const description = `${t.total} records tagged ${t.label}, ${t.live} live. ${TAG_GROUP_META[t.group].label}; with its own RSS and JSON feeds.`;
  return { title: `${t.label} · tag`, description, openGraph: { title: `${t.label} · tag`, description, images: ["/og/default.png"] } };
}

function Bars({ tag, months }: { tag: TagEntry; months: string[] }) {
  const max = Math.max(1, ...tag.months);
  return (
    <div role="img" aria-label={`Records per month over the last twelve months: ${tag.months.join(", ")}`} className="flex h-12 items-end gap-1">
      {tag.months.map((n, i) => (
        <div key={months[i]} title={`${monthLabel(months[i]!, true)}: ${n}`} className="flex-1 rounded-[1px] bg-accent/70" style={{ height: `${Math.max(n > 0 ? 8 : 2, (n / max) * 100)}%`, opacity: n > 0 ? 1 : 0.25 }} />
      ))}
    </div>
  );
}

export default async function TagPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { incidents } = await loadIncidents();
  const index = tagIndexNow(incidents);
  const tag = index.bySlug.get(slug);
  if (!tag) notFound();
  const byId = new Map(incidents.map((i) => [i.id, i]));
  const rows = tag.ids.map((id) => byId.get(id)!).filter(Boolean);
  const live = rows.filter((i) => i.state === "live");
  const closed = rows.filter((i) => i.state !== "live");
  const today = new Date().toISOString().slice(0, 10);
  const since = tag.latest ? daysBetween(tag.latest, today) : null;
  const meta = TAG_GROUP_META[tag.group];
  const feeds = [
    [`/tags/${tag.slug}/feed.xml`, "RSS"],
    [`/tags/${tag.slug}.json`, "JSON"],
    [`/tags/${tag.slug}/llms.txt`, "llms.txt"],
  ];

  return (
    <article className="space-y-8">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[12px] text-dim">
          <Link href="/tags" className="hover:text-ink">
            tags
          </Link>
          <span className="text-faint">/</span>
          <Link href={`/tags#${tag.group}`} className="hover:text-ink">
            {meta.label}
          </Link>
        </div>
        <h1 className="text-[28px] font-semibold tracking-tight">{tag.label}</h1>
        <p className="font-mono text-[13px] text-dim">
          <span className="text-live">{tag.live}</span> live · <span className="text-ink">{tag.total}</span> on record ·{" "}
          {since === null ? "no dated record" : since === 0 ? "last incident today" : `last incident ${since} day${since === 1 ? "" : "s"} ago`}
        </p>
        <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div className="max-w-md">
            <Bars tag={tag} months={index.months} />
            <div className="mt-1 flex justify-between font-mono text-[12px] text-faint">
              <span>{monthLabel(index.months[0]!)}</span>
              <span>records per month, by first report</span>
              <span>{monthLabel(index.months[index.months.length - 1]!)}</span>
            </div>
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[12px]">
            {feeds.map(([href, label]) => (
              <li key={href}>
                <a href={href} className="link">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </header>

      {live.length > 0 && (
        <section>
          <h2 className="flex items-baseline justify-between gap-3 border-t border-line pt-3 pb-1 font-mono text-[12px] uppercase tracking-[0.1em] text-dim">
            <span>Live</span>
            <span className="num text-faint">{live.length}</span>
          </h2>
          <ol className="border-b border-line-soft">
            {live.slice(0, MAX_ROWS).map((i) => (
              <IncidentRow key={i.id} row={rowOf(i)} variant="full" />
            ))}
          </ol>
        </section>
      )}

      <section>
        <h2 className="flex items-baseline justify-between gap-3 border-t border-line pt-3 pb-1 font-mono text-[12px] uppercase tracking-[0.1em] text-dim">
          <span>{live.length > 0 ? "Earlier" : "Records"}</span>
          <span className="num text-faint">{closed.length}</span>
        </h2>
        {closed.length > 0 ? (
          <ol className="border-b border-line-soft">
            {closed.slice(0, Math.max(0, MAX_ROWS - live.length)).map((i) => (
              <IncidentRow key={i.id} row={rowOf(i)} variant="compact" />
            ))}
          </ol>
        ) : (
          <p className="py-3 text-[13px] text-dim">Nothing closed yet.</p>
        )}
        {rows.length > MAX_ROWS && (
          <p className="mt-3 text-[13px] text-dim">
            {rows.length - MAX_ROWS} more in the{" "}
            <Link href={`/incidents?tag=${tag.slug}&kind=all`} className="link">
              archive
            </Link>
            .
          </p>
        )}
      </section>
    </article>
  );
}
