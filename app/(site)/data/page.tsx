import { isDisclosedIncident } from "@/lib/counting";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import Link from "next/link";
import { loadIncidents, siteUrl } from "@/lib/data";
import { OG_IMAGES } from "@/lib/og-list";
import { SITE } from "@/lib/site";
import { ATLAS_RELEASE, OWASP_LLM_EDITION } from "@/lib/taxonomy";

export const metadata: Metadata = {
  title: "Data",
  description: "Download the full GCD AI RADAR dataset as JSON or CSV, subscribe to the RSS feed of new incidents, and reuse the chart images.",
};

async function sizeOf(rel: string): Promise<string | null> {
  try {
    const stat = await fs.stat(path.join(process.cwd(), "public", rel));
    const kb = stat.size / 1024;
    return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(kb))} KB`;
  } catch {
    return null;
  }
}

export default async function DataPage() {
  const { incidents } = await loadIncidents();
  const disclosed = incidents.filter(isDisclosedIncident).length;
  const base = siteUrl();
  const files = [
    { href: "/data/incidents.json", label: "incidents.json", blurb: "Every published record, incidents and disclosed CVEs, with all fields and every source." },
    { href: "/data/incidents.min.json", label: "incidents.min.json", blurb: "Compact records without the sources array, with a disclosed flag and the derived owasp_llm and atlas ids." },
    { href: "/data/incidents.csv", label: "incidents.csv", blurb: "One row per record for spreadsheets, with record_kind, owasp_llm and atlas columns; list fields are semicolon-separated." },
    { href: "/data/years/index.json", label: "years/<year>.json", blurb: "The full records of one year of first report, one file per year; index.json lists the years and their counts." },
    { href: "/data/meta.json", label: "meta.json", blurb: "Counts, last collector run, generation time, licence and the standards versions mapped to." },
    { href: "/feed.xml", label: "feed.xml", blurb: "RSS feed of the 50 most recently reported incidents." },
  ];
  const sized = await Promise.all(files.map(async (f) => ({ ...f, size: f.label.includes("<year>") ? null : await sizeOf(f.href) })));

  return (
    <div className="max-w-4xl space-y-8 text-[15px] leading-relaxed text-soft">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Data</h1>
        <p className="mt-1 text-[13px] text-dim">
          {incidents.length.toLocaleString("en-US")} published records: {(incidents.length - disclosed).toLocaleString("en-US")} incidents and{" "}
          {disclosed.toLocaleString("en-US")} disclosed CVEs with no confirmed exploitation, which are{" "}
          <a href="/methodology#cves" className="link">
            tracked separately
          </a>
          . Everything below is regenerated on every deploy from the JSON files in the repository.
        </p>
      </header>

      <section>
        <h2 className="label mb-2">Downloads</h2>
        <ul className="divide-y divide-line-soft border-y border-line-soft">
          {sized.map((f) => (
            <li key={f.href} className="py-2.5 grid gap-1 sm:grid-cols-[14rem_1fr_5rem] sm:items-baseline">
              <a href={f.href} className="num text-ink hover:text-accent">
                {f.label}
              </a>
              <span className="text-[12.5px] text-dim">{f.blurb}</span>
              <span className="num text-[11px] text-faint sm:text-right">{f.size ?? ""}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[12px] text-dim">
          The dataset is stored by year in the repository (<span className="num">data/incidents/&lt;year&gt;.json</span>), and the per-year downloads mirror those files. Per-incident JSON is at <span className="num">/data/incidents/&lt;slug&gt;.json</span>; the canonical URL of a record is{" "}
          <span className="num">{base}/incidents/&lt;slug&gt;</span>. Field definitions are on the{" "}
          <Link href="/methodology" className="link">methodology page</Link>; the schema is <span className="num">lib/schema.ts</span> in the repository.
        </p>
        <p className="mt-2 text-[12px] text-dim">
          <span className="num">owasp_llm</span> holds OWASP Top 10 for LLM Applications {OWASP_LLM_EDITION} ids (<span className="num">LLM01</span>…) and{" "}
          <span className="num">atlas</span> MITRE ATLAS technique ids (<span className="num">AML.T0051</span>…, release {ATLAS_RELEASE}). Both are derived from each
          record&rsquo;s type and categories by a fixed table, not classified per record, and either may be empty; the table and its limits are under{" "}
          <Link href="/methodology#standards" className="link">standards mapping</Link>. The full JSON files keep the stored record only; the same table in{" "}
          <span className="num">lib/taxonomy.ts</span> reproduces the two lists from it.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="label">Product pages</h2>
        <p className="text-[13px] text-dim">
          The <Link href="/products" className="link">product index</Link> lists every product family with records, and each product has its own page at{" "}
          <span className="num">{base}/products/&lt;slug&gt;</span> with its disclosed CVEs, confirmed exploitation and CISA KEV flags, newest first. Product
          names are grouped into families for display only (<span className="num">lib/products.ts</span>); the downloads keep each name as filed.
        </p>
      </section>

      <section>
        <h2 className="label mb-2">Chart images</h2>
        <p className="text-[12.5px] text-dim mb-3">1200×630 PNGs for posts and slides, regenerated with the data. Link back to the site when you use them.</p>
        <ul className="grid gap-6">
          {OG_IMAGES.map((img) => (
            <li key={img.file} className="panel p-2">
              <a href={`/og/${img.file}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/og/${img.file}`} alt={img.title} width={1200} height={630} className="w-full rounded-[2px]" />
              </a>
              <div className="mt-1.5 flex items-baseline justify-between gap-2">
                <span className="text-[14px] text-soft">{img.title}</span>
                <a href={`/og/${img.file}`} className="num text-[11px] text-dim hover:text-ink">
                  {img.file}
                </a>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="label">Licence and attribution</h2>
        <p>
          The dataset is{" "}
          <a className="link" href={SITE.dataLicense.url}>
            CC BY-SA 4.0
          </a>
          : reuse it, including commercially, with credit to &ldquo;{SITE.name}&rdquo; and a link, and keep derivative datasets under the same licence. Records
          carry their origin; when you redistribute the data, keep these upstream notices:
        </p>
        <ul className="list-disc pl-5 space-y-1 text-[13px]">
          <li>AI Incident Database (incidentdatabase.ai), CC BY-SA 4.0. McGregor, S. (2021) &ldquo;Preventing Repeated Real World AI Failures by Cataloging Incidents: The AI Incident Database.&rdquo;</li>
          <li>MITRE ATLAS (atlas.mitre.org), Apache 2.0. © 2021-2026 The MITRE Corporation. Case studies, and the technique ids and names in the standards mapping.</li>
          <li>
            OWASP Top 10 for LLM Applications {OWASP_LLM_EDITION} (genai.owasp.org), CC BY-SA 4.0. © OWASP Foundation. Entry ids and names in the standards mapping; the
            mapping itself is {SITE.name}&rsquo;s and is not endorsed by OWASP or MITRE.
          </li>
          <li>AVID, the AI Vulnerability Database (avidml.org), MIT.</li>
          <li>NVD: this product uses the NVD API but is not endorsed or certified by the NVD.</li>
          <li>GitHub Advisory Database (github.com/advisories), CC BY 4.0.</li>
          <li>CISA Known Exploited Vulnerabilities Catalog, CC0 1.0.</li>
          <li>arXiv: thank you to arXiv for use of its open access interoperability. Metadata CC0 1.0.</li>
          <li>Discovery powered by GDELT (gdeltproject.org) and Hacker News search by Algolia.</li>
          <li>Traffic signal: Cloudflare Radar (radar.cloudflare.com), CC BY-NC 4.0, sidebar only; not part of the dataset.</li>
        </ul>
        <p className="text-[12px] text-dim">
          Titles, links and dates of cited articles remain the property of their publishers. Summaries are written by {SITE.name} in its own words.
        </p>
      </section>
    </div>
  );
}
