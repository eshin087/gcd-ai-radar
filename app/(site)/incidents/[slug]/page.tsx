import { isDisclosedIncident } from "@/lib/counting";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LatestList } from "@/components/incidents/LatestList";
import { CategoryBadge, SeverityBadge, TypeBadge } from "@/components/ui/Badge";
import { incidentBySlug, loadIncidents } from "@/lib/data";
import { approxDateLabel, dateLabel, timestampLabel } from "@/lib/format";
import { SITE } from "@/lib/site";
import { relatedIncidents } from "@/lib/slim";
import { CATEGORY_META, ORIGIN_META, SEVERITY_META, TARGET_META, TYPE_META } from "@/lib/taxonomy";

export const dynamicParams = false;

export async function generateStaticParams() {
  const { incidents } = await loadIncidents();
  return incidents.map((i) => ({ slug: i.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const { incidents } = await loadIncidents();
  const incident = incidentBySlug(incidents, slug);
  if (!incident) return {};
  return {
    title: incident.title,
    description: incident.summary,
    openGraph: { title: incident.title, description: incident.summary, type: "article", images: ["/og/default.png"] },
  };
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-3 py-2.5 border-t border-line-soft text-[14px]">
      <dt className="label pt-0.5">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

export default async function IncidentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { incidents } = await loadIncidents();
  const incident = incidentBySlug(incidents, slug);
  if (!incident) notFound();
  const related = relatedIncidents(incidents, incident);

  return (
    <article className="max-w-4xl space-y-8">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 num text-[11px] text-dim">
          <Link href="/incidents" className="hover:text-ink">
            incidents
          </Link>
          <span className="text-faint">/</span>
          <span>{incident.id}</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight leading-tight">{incident.title}</h1>
        <div className="flex flex-wrap gap-1.5">
          <TypeBadge type={incident.type} />
          <SeverityBadge severity={incident.severity} short={false} />
          {incident.categories.map((c) => (
            <CategoryBadge key={c} category={c} short={false} />
          ))}
        </div>
        <p className="text-[16px] text-soft leading-relaxed">{incident.summary}</p>
        {isDisclosedIncident(incident) && (
          <p className="panel px-4 py-3 text-[13.5px] text-soft">
            <span className="label mr-2">disclosed CVE</span>
            No confirmed exploitation, so this record is tracked as a disclosed vulnerability and not counted as an incident. It moves into the counts if CISA
            or the vendor confirms exploitation.{" "}
            <Link href="/methodology#cves" className="link">
              Why
            </Link>
          </p>
        )}
      </header>

      <section>
        <h2 className="label mb-1">Details</h2>
        <dl>
          <Row label="type">
            {TYPE_META[incident.type].label}
            <div className="text-[11.5px] text-dim">{TYPE_META[incident.type].definition}</div>
          </Row>
          <Row label="categories">
            <ul className="space-y-1">
              {incident.categories.map((c, i) => (
                <li key={c}>
                  {CATEGORY_META[c].label}
                  {i === 0 && incident.categories.length > 1 && <span className="label ml-2">primary</span>}
                  <div className="text-[11.5px] text-dim">{CATEGORY_META[c].definition}</div>
                </li>
              ))}
            </ul>
          </Row>
          <Row label="severity">
            <span className="num">{incident.severity}</span> · {SEVERITY_META[incident.severity].label}
            <div className="text-[11.5px] text-dim">{SEVERITY_META[incident.severity].definition}</div>
          </Row>
          <Row label="targets">{incident.targets.map((t) => TARGET_META[t].label).join(", ")}</Row>
          {incident.products.length > 0 && <Row label="products">{incident.products.join(", ")}</Row>}
          <Row label="incident date">
            <span className="num">{approxDateLabel(incident.incident_date, incident.incident_date_precision)}</span>
          </Row>
          <Row label="first reported">
            <span className="num">{dateLabel(incident.first_reported)}</span>
          </Row>
          <Row label="origin">
            {ORIGIN_META[incident.origin].label}
            {incident.origin === "seed_aiid" && <div className="text-[11.5px] text-dim">Derived from the AI Incident Database (CC BY-SA 4.0).</div>}
            {incident.origin === "seed_atlas" && <div className="text-[11.5px] text-dim">Derived from MITRE ATLAS (Apache 2.0, © MITRE).</div>}
            {(incident.origin === "seed_nvd" || incident.origin === "seed_ghsa") && (
              <div className="text-[11.5px] text-dim">Vulnerability record from NVD / the GitHub Advisory Database. This product uses the NVD API but is not endorsed or certified by the NVD.</div>
            )}
          </Row>
          <Row label="classifier confidence">
            <span className="num">{incident.confidence.toFixed(2)}</span>
            <span className="text-[11.5px] text-dim"> · published at or above 0.80; see the methodology</span>
          </Row>
          {incident.tags.length > 0 && (
            <Row label="tags">
              <span className="num text-[12px]">{incident.tags.join(" · ")}</span>
            </Row>
          )}
          <Row label="record">
            <span className="num text-[12px] text-dim">
              created {timestampLabel(incident.created_at)} · updated {timestampLabel(incident.updated_at)} ·{" "}
              <a className="link" href={`/data/incidents/${incident.slug}.json`}>
                json
              </a>
            </span>
          </Row>
        </dl>
      </section>

      <section>
        <h2 className="label mb-2">
          Sources · {incident.source_count}
        </h2>
        <ol className="divide-y divide-line-soft border-y border-line-soft">
          {incident.sources.map((s) => (
            <li key={s.url} className="py-2.5 grid gap-1 sm:grid-cols-[6.5rem_1fr] text-[14px]">
              <span className="num text-[11px] text-dim pt-0.5">{s.published_at}</span>
              <div className="min-w-0">
                <a href={s.url} rel="noopener noreferrer" target="_blank" className="text-ink hover:text-accent break-words">
                  {s.title}
                </a>
                <div className="text-[11.5px] text-dim">
                  {s.publisher} · <span className="num break-all">{s.url.replace(/^https?:\/\//, "").slice(0, 80)}</span>
                </div>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-[11.5px] text-faint">
          Titles and links belong to their publishers. The summary above is written by {SITE.name} in its own words; data is CC BY-SA 4.0.
        </p>
      </section>

      {related.length > 0 && (
        <section>
          <h2 className="label mb-2">Related incidents</h2>
          <LatestList incidents={related} variant="rows" />
        </section>
      )}
    </article>
  );
}
