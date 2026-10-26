import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { blockSpark } from "@/components/fx/text";
import { IncidentRow } from "@/components/incidents/IncidentRow";
import { isDisclosedIncident } from "@/lib/counting";
import { loadIncidents } from "@/lib/data";
import { monthLabel } from "@/lib/format";
import type { FullIncident } from "@/lib/lifecycle";
import { rowOf } from "@/lib/live";
import { explorerHref, isKevMarked, KEV_TAG, monthlyDisclosures, productBySlug, productIndex } from "@/lib/products";
import { toMonthKey } from "@/lib/stats";
import { REAL_WORLD_MIN_SEVERITY } from "@/lib/taxonomy";

export const dynamicParams = false;

const KEV_CATALOG_URL = "https://www.cisa.gov/known-exploited-vulnerabilities-catalog";
const SPARK_MONTHS = 24;

export async function generateStaticParams() {
  const { incidents } = await loadIncidents();
  return productIndex(incidents).map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const { incidents } = await loadIncidents();
  const p = productBySlug(incidents, slug);
  if (!p) return {};
  const description = `${p.label}: ${p.disclosed} disclosed CVEs, ${p.exploited} records with confirmed exploitation, ${p.kev} flagged as CISA KEV. Newest first, linked to the original advisories.`;
  return { title: `${p.label} · product watch`, description, openGraph: { title: p.label, description, images: ["/og/default.png"] } };
}

function Stat({ label, value, tone = "" }: { label: string; value: number; tone?: string }) {
  return (
    <div className="panel px-3 py-2.5">
      <div className="text-[12px] text-dim">{label}</div>
      <div className={`mt-1 text-[26px] font-semibold leading-none tracking-tight num ${tone || "text-ink"}`}>{value.toLocaleString("en-US")}</div>
    </div>
  );
}

/** One record as the shared row (components/incidents/IncidentRow.tsx); the lane column is left out, the page is about one product. */
function RecordRow({ i }: { i: FullIncident }) {
  return <IncidentRow row={rowOf(i)} variant="compact" showLane={false} />;
}

function Section({ id, title, count, children }: { id: string; title: string; count: number; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 space-y-2">
      <h2 className="label">
        {title} · <span className="num">{count.toLocaleString("en-US")}</span>
      </h2>
      {children}
    </section>
  );
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { incidents } = await loadIncidents();
  const p = productBySlug(incidents, slug);
  if (!p) notFound();

  const patchNow = p.items.filter((i) => i.severity >= REAL_WORLD_MIN_SEVERITY || isKevMarked(i));
  const patchIds = new Set(patchNow.map((i) => i.id));
  const disclosed = p.items.filter((i) => !patchIds.has(i.id) && isDisclosedIncident(i));
  const other = p.items.filter((i) => !patchIds.has(i.id) && !isDisclosedIncident(i));

  const now = toMonthKey(new Date());
  const series = monthlyDisclosures(p.items, now, SPARK_MONTHS);
  const inWindow = series.reduce((n, m) => n + m.count, 0);
  const busiest = series.reduce((a, b) => (b.count > a.count ? b : a), series[0]!);
  const otherNames = p.names.filter((n) => n !== p.label);

  return (
    <article className="max-w-4xl space-y-8">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 num text-[11px] text-dim">
          <Link href="/products" className="hover:text-ink">
            products
          </Link>
          <span className="text-faint">/</span>
          <span>{p.slug}</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight leading-tight break-words">{p.label}</h1>
        {otherNames.length > 0 && (
          <p className="text-[12.5px] text-dim break-words">
            Filed as: {otherNames.slice(0, 12).join(", ")}
            {otherNames.length > 12 ? `, and ${otherNames.length - 12} more` : ""}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Records" value={p.records} />
          <Stat label="Disclosed CVEs" value={p.disclosed} />
          <Stat label="Exploited (sev 3–4)" value={p.exploited} tone={p.exploited > 0 ? "text-sev-3" : ""} />
          <Stat label="CISA KEV flagged" value={p.kev} tone={p.kev > 0 ? "text-sev-3" : ""} />
        </div>
        <p className="text-[12.5px] text-dim">
          Newest record <span className="num">{p.latest}</span> · {p.cves.length.toLocaleString("en-US")} distinct CVE id{p.cves.length === 1 ? "" : "s"} ·{" "}
          <Link href={explorerHref(p.label)} className="link">
            open in the explorer
          </Link>{" "}
          <span className="text-faint">(the explorer matches the first product a record names, so it can list fewer)</span>
        </p>
      </header>

      <Section id="exploited" title="Exploited or KEV-listed" count={patchNow.length}>
        <p className="text-[12.5px] text-dim">
          Records at severity 3–4 (exploitation confirmed by CISA, the vendor or reporting) and records flagged as listed in{" "}
          <a href={KEV_CATALOG_URL} rel="noopener noreferrer" target="_blank" className="link">
            CISA KEV
          </a>
          . The KEV flag is the classifier&rsquo;s <span className="num">{KEV_TAG}</span> tag or a source on the KEV catalog; it is recorded when the
          collector sees the listing, so a missing flag does not mean a CVE is absent from the catalog.
        </p>
        {patchNow.length > 0 ? (
          <ol className="border-b border-line-soft">
            {patchNow.map((i) => (
              <RecordRow key={i.id} i={i} />
            ))}
          </ol>
        ) : (
          <p className="panel px-4 py-3 text-[13.5px] text-soft">No record for {p.label} has confirmed exploitation or a KEV flag.</p>
        )}
      </Section>

      <section className="space-y-2">
        <h2 className="label">Disclosures by month · last {SPARK_MONTHS} months</h2>
        <div className="panel px-4 py-3 space-y-1.5">
          <div
            role="img"
            aria-label={`${inWindow} disclosed CVEs in the last ${SPARK_MONTHS} months; busiest month ${monthLabel(busiest.month, true)} with ${busiest.count}`}
            className="overflow-hidden whitespace-nowrap font-mono text-[22px] leading-none tracking-[0.06em] text-soft"
          >
            {blockSpark(series.map((m) => m.count))}
          </div>
          <div className="flex justify-between gap-3 num text-[11px] text-faint">
            <span>{monthLabel(series[0]!.month)}</span>
            <span className="text-dim">
              {inWindow.toLocaleString("en-US")} disclosed
              {busiest.count > 0 ? ` · peak ${busiest.count} in ${monthLabel(busiest.month)}` : ""}
            </span>
            <span>{monthLabel(series[series.length - 1]!.month)}</span>
          </div>
        </div>
      </section>

      <Section id="disclosed" title="Disclosed CVEs, no confirmed exploitation" count={disclosed.length}>
        {disclosed.length > 0 ? (
          <ol className="border-b border-line-soft">
            {disclosed.map((i) => (
              <RecordRow key={i.id} i={i} />
            ))}
          </ol>
        ) : (
          <p className="text-[13.5px] text-dim">No disclosed CVEs without confirmed exploitation.</p>
        )}
      </Section>

      {other.length > 0 && (
        <Section id="other" title="Other incidents: research and unexploited reports" count={other.length}>
          <ol className="border-b border-line-soft">
            {other.map((i) => (
              <RecordRow key={i.id} i={i} />
            ))}
          </ol>
        </Section>
      )}

      <p className="text-[12px] text-faint">
        Fix status and fixed versions are recorded when a source states them (each record&rsquo;s page shows what is known); check the vendor&rsquo;s own
        advisory before acting.
      </p>
    </article>
  );
}
