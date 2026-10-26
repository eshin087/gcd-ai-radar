import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyBrief } from "@/components/incidents/CopyBrief";
import { IncidentRow } from "@/components/incidents/IncidentRow";
import { AiChip, CategoryBadge, LaneBadge, PatchBadge, SeverityBadge, StateDot } from "@/components/ui/Badge";
import { buildBrief } from "@/lib/brief";
import { ADVISORY_PUBLISHERS, VULN_DB_PUBLISHERS, isDisclosedIncident } from "@/lib/counting";
import { incidentBySlug, loadIncidents, siteUrl } from "@/lib/data";
import { approxDateLabel, dateLabel, timestampLabel } from "@/lib/format";
import { timelineOf } from "@/lib/lifecycle";
import { rowOf } from "@/lib/live";
import { SITE } from "@/lib/site";
import { relatedIncidents } from "@/lib/slim";
import { normalizeTag, tagHref } from "@/lib/tags";
import {
  ATLAS_RELEASE,
  ATLAS_TECHNIQUES,
  LANE_META,
  ORIGIN_META,
  OWASP_LLM_EDITION,
  OWASP_LLM_META,
  SEVERITY_META,
  TARGET_META,
  TYPE_META,
  atlasFor,
  atlasUrl,
  owaspFor,
  owaspLabel,
} from "@/lib/taxonomy";

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

const RESEARCH_PUBLISHERS: ReadonlySet<string> = new Set(["arXiv", "MITRE ATLAS", "AVID", "AI Incident Database"]);

function sourceKind(publisher: string): "advisories" | "research" | "news" {
  if (VULN_DB_PUBLISHERS.has(publisher) || ADVISORY_PUBLISHERS.has(publisher)) return "advisories";
  if (RESEARCH_PUBLISHERS.has(publisher)) return "research";
  return "news";
}

const KIND_LABEL = { advisories: "Advisories and databases", research: "Research and catalogues", news: "News and write-ups" } as const;

function Box({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[2px] border border-line px-3 py-2.5">
      <div className="label mb-1.5">{label}</div>
      <div className="font-mono text-[13px] leading-relaxed text-ink">{children}</div>
    </div>
  );
}

function Row({ label, title, children }: { label: string; title?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-t border-line-soft py-2.5 text-[14px] sm:grid-cols-[10rem_1fr] sm:gap-3">
      <dt className="label pt-0.5" title={title}>
        {label}
      </dt>
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
  const owasp = owaspFor(incident);
  const atlas = atlasFor(incident);
  const disclosed = isDisclosedIncident(incident);
  const timeline = timelineOf(incident);
  const brief = buildBrief(incident, siteUrl());
  const lane = LANE_META[incident.lane];
  const live = incident.state === "live";
  const showPatch = incident.lane === "patch" || incident.lane === "supply_chain";
  const sources = (["advisories", "news", "research"] as const)
    .map((kind) => ({ kind, items: incident.sources.filter((s) => sourceKind(s.publisher) === kind) }))
    .filter((g) => g.items.length > 0);
  const tags = [...new Set(incident.tags.map((t) => [t, normalizeTag(t)] as const).filter(([, s]) => s).map(([t, s]) => `${t}\u0000${s}`))].map((x) => x.split("\u0000") as [string, string]);
  const cves = incident.cve_ids;

  return (
    <article className="max-w-4xl space-y-8">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[12px] text-dim">
          <Link href={live ? `/?lane=${incident.lane}` : "/incidents"} className="hover:text-ink">
            {live ? "live" : "archive"}
          </Link>
          <span className="text-faint">/</span>
          <Link href={lane.href} className="hover:text-ink">
            {lane.label}
          </Link>
          <span className="text-faint">/</span>
          <span>{incident.id}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 font-mono text-[12px] uppercase tracking-[0.08em] text-dim">
            <StateDot state={incident.state} />
            {live ? "live" : `closed${incident.closed_at ? ` ${dateLabel(incident.closed_at)}` : ""}`}
          </span>
          <LaneBadge lane={incident.lane} />
          <SeverityBadge severity={incident.severity} short={false} />
          {showPatch && <PatchBadge status={incident.patch_status} />}
          <AiChip type={incident.type} />
        </div>
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight sm:text-[32px]">{incident.title}</h1>
        {incident.products.length > 0 && <p className="font-mono text-[13px] text-dim">{incident.products.join(", ")}</p>}
        <p className="text-[16px] leading-relaxed text-soft">{incident.summary}</p>
        {incident.severity_note && (
          <p className="text-[13.5px] text-dim">
            <span className="label mr-2">why this severity</span>
            {incident.severity_note}
          </p>
        )}
        {disclosed && (
          <p className="rounded-[2px] border border-line px-4 py-3 text-[13.5px] text-soft">
            <span className="label mr-2">disclosed CVE</span>
            No confirmed exploitation, so this record is tracked as a disclosed vulnerability and not counted as an incident. It moves into the counts if CISA
            or the vendor confirms exploitation.{" "}
            <Link href="/methodology#cves" className="link">
              Why
            </Link>
          </p>
        )}
      </header>

      {incident.action && (
        <section className="border-l-2 border-accent pl-4">
          <h2 className="label mb-1">What to do</h2>
          <p className="text-[15px] leading-relaxed text-ink">{incident.action}</p>
        </section>
      )}

      {(incident.affected.length > 0 || incident.fixed_in.length > 0 || cves.length > 0) && (
        <section className="grid gap-3 sm:grid-cols-3">
          {incident.affected.length > 0 && (
            <Box label="affected">
              {incident.affected.map((a) => (
                <div key={a}>{a}</div>
              ))}
            </Box>
          )}
          {incident.fixed_in.length > 0 && (
            <Box label="fixed in">
              {incident.fixed_in.map((f) => (
                <div key={f}>{f}</div>
              ))}
            </Box>
          )}
          {cves.length > 0 && (
            <Box label="cve ids">
              {cves.map((id) => (
                <div key={id} className="flex flex-wrap gap-x-2">
                  <a href={`https://nvd.nist.gov/vuln/detail/${id}`} rel="noopener noreferrer" target="_blank" className="link">
                    {id}
                  </a>
                  <Link href={`/incidents?q=${id}&kind=all`} className="text-[12px] text-faint hover:text-ink">
                    other records
                  </Link>
                </div>
              ))}
              {incident.cvss !== null && <div className="mt-1 text-dim">CVSS {incident.cvss}</div>}
            </Box>
          )}
        </section>
      )}

      <section>
        <h2 className="label mb-2">
          Timeline · <span className="num">{timeline.length}</span>
        </h2>
        <ol className="border-l border-line pl-4">
          {timeline.map((t, n) => (
            <li key={`${t.date}-${n}`} className="relative py-2 text-[14px]">
              <span aria-hidden className="absolute -left-[21px] top-[15px] size-2 rounded-full border border-line bg-ground" />
              <span className="num mr-3 text-[12px] text-dim">{dateLabel(t.date)}</span>
              {t.source_url ? (
                <a href={t.source_url} rel="noopener noreferrer" target="_blank" className="text-ink hover:text-accent">
                  {t.title}
                </a>
              ) : (
                <span className="text-ink">{t.title}</span>
              )}
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2 className="label mb-2">
          Sources · <span className="num">{incident.source_count}</span>
        </h2>
        <div className="space-y-4">
          {sources.map((g) => (
            <div key={g.kind}>
              <h3 className="mb-1 font-mono text-[12px] text-faint">{KIND_LABEL[g.kind]}</h3>
              <ol className="border-y border-line-soft">
                {g.items.map((s) => (
                  <li key={s.url} className="grid gap-1 border-t border-line-soft py-2.5 text-[14px] first:border-t-0 sm:grid-cols-[6.5rem_1fr]">
                    <span className="num pt-0.5 text-[12px] text-dim">{s.published_at}</span>
                    <div className="min-w-0">
                      <a href={s.url} rel="noopener noreferrer" target="_blank" className="break-words text-ink hover:text-accent">
                        {s.title}
                      </a>
                      <div className="text-[12px] text-dim">
                        {s.publisher} · <span className="num break-all">{s.url.replace(/^https?:\/\//, "").slice(0, 80)}</span>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-faint">
          Titles and links belong to their publishers. The summary above is written by {SITE.name} in its own words; data is CC BY-SA 4.0.
        </p>
      </section>

      <section>
        <h2 className="label mb-1">Classification</h2>
        <dl>
          <Row label="lane" title={lane.definition}>
            <Link href={lane.href} className="link">
              {lane.label}
            </Link>
          </Row>
          <Row label="AI role" title={TYPE_META[incident.type].definition}>
            {TYPE_META[incident.type].label}
          </Row>
          <Row label="categories">
            <span className="flex flex-wrap gap-1.5">
              {incident.categories.map((c) => (
                <CategoryBadge key={c} category={c} short={false} />
              ))}
            </span>
          </Row>
          <Row label="severity" title={SEVERITY_META[incident.severity].definition}>
            <span className="num">{incident.severity}</span> · {SEVERITY_META[incident.severity].label}
          </Row>
          {showPatch && (
            <Row label="fix status">
              <PatchBadge status={incident.patch_status} />
            </Row>
          )}
          <Row label="targets">{incident.targets.map((t) => TARGET_META[t].label).join(", ")}</Row>
          <Row label="owasp llm top 10" title={`Derived from the categories, ${OWASP_LLM_EDITION} edition`}>
            {owasp.length > 0 ? (
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                {owasp.map((id) => (
                  <a key={id} href={OWASP_LLM_META[id].url} rel="noopener noreferrer" target="_blank" className="link">
                    <span className="num">{owaspLabel(id)}</span> {OWASP_LLM_META[id].name}
                  </a>
                ))}
              </span>
            ) : (
              <span className="text-dim">no entry for these categories</span>
            )}
          </Row>
          <Row label="mitre atlas" title={`Derived from the categories, release ${ATLAS_RELEASE}`}>
            {atlas.length > 0 ? (
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                {atlas.map((id) => (
                  <a key={id} href={atlasUrl(id)} rel="noopener noreferrer" target="_blank" className="link">
                    <span className="num">{id}</span> {ATLAS_TECHNIQUES[id]}
                  </a>
                ))}
              </span>
            ) : (
              <span className="text-dim">no technique for these categories</span>
            )}
          </Row>
          {tags.length > 0 && (
            <Row label="tags">
              <span className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[12.5px]">
                {tags.map(([raw, s]) => (
                  <Link key={s} href={tagHref(s)} className="link">
                    {raw.replace(/_/g, "-")}
                  </Link>
                ))}
              </span>
            </Row>
          )}
          <Row label="dates">
            <span className="num">happened {approxDateLabel(incident.incident_date, incident.incident_date_precision)}</span> ·{" "}
            <span className="num">first reported {dateLabel(incident.first_reported)}</span>
          </Row>
          <Row label="origin">
            {ORIGIN_META[incident.origin].label}
            {incident.origin === "seed_aiid" && <div className="text-[12px] text-dim">Derived from the AI Incident Database (CC BY-SA 4.0).</div>}
            {incident.origin === "seed_atlas" && <div className="text-[12px] text-dim">Derived from MITRE ATLAS (Apache 2.0, © MITRE).</div>}
            {(incident.origin === "seed_nvd" || incident.origin === "seed_ghsa") && (
              <div className="text-[12px] text-dim">Vulnerability record from NVD / the GitHub Advisory Database. This product uses the NVD API but is not endorsed or certified by the NVD.</div>
            )}
          </Row>
          <Row label="record">
            <span className="num text-[12px] text-dim">
              confidence {incident.confidence.toFixed(2)} · created {timestampLabel(incident.created_at)} · updated {timestampLabel(incident.updated_at)}
            </span>
          </Row>
        </dl>
        <p className="mt-2 text-[12px] text-faint">
          Lane, AI role, categories and severity come from the classifier; the OWASP and ATLAS rows are derived from the categories.{" "}
          <Link href="/methodology" className="link">
            How these are assigned
          </Link>
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="label">For machines</h2>
        <p className="font-mono text-[12.5px] text-dim">
          <a className="link" href={`/data/incidents/${incident.slug}.json`}>
            this record as JSON
          </a>
          {" · "}
          <a className="link" href="/changes.json">
            changes.json
          </a>
          {tags[0] && (
            <>
              {" · "}
              <a className="link" href={`/tags/${tags[0][1]}/feed.xml`}>
                RSS for {tags[0][1]}
              </a>
            </>
          )}
        </p>
        <CopyBrief brief={brief} />
      </section>

      {related.length > 0 && (
        <section>
          <h2 className="label mb-2">Related</h2>
          <ol className="border-b border-line-soft">
            {related.map((r) => (
              <IncidentRow key={r.id} row={rowOf(r)} variant="compact" />
            ))}
          </ol>
        </section>
      )}
    </article>
  );
}
