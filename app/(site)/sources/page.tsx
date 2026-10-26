import { promises as fs } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import Link from "next/link";
import { marked } from "marked";

// docs/sources.md is repository content, but raw HTML in it is still not rendered: text and links only.
marked.use({ renderer: { html: () => "" } });
import sourcesConfig from "@/collector/config/sources.json";
import { loadRuns } from "@/lib/data";
import { timestampLabel } from "@/lib/format";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Sources",
  description: "Every feed, API and dataset the collector reads, with access method, licence, attribution requirement and live health.",
};

interface Health {
  id: string;
  name: string;
  enabled: boolean;
  lastSuccess: string | null;
  lastItems: number | null;
  lastError: string | null;
  lastErrorAt: string | null;
}

async function sourceHealth(): Promise<Health[]> {
  const runs = await loadRuns();
  const map = new Map<string, Health>();
  for (const s of sourcesConfig.sources) map.set(s.id, { id: s.id, name: s.name, enabled: s.enabled, lastSuccess: null, lastItems: null, lastError: null, lastErrorAt: null });
  for (const run of [...runs].sort((a, b) => a.started_at.localeCompare(b.started_at))) {
    for (const sr of run.sources) {
      const h = map.get(sr.id);
      if (!h) continue;
      if (sr.ok) {
        h.lastSuccess = run.finished_at;
        h.lastItems = sr.items;
      } else {
        h.lastError = sr.error ?? `HTTP ${sr.status ?? "?"}`;
        h.lastErrorAt = run.finished_at;
      }
    }
  }
  return [...map.values()];
}

export default async function SourcesPage() {
  const md = await fs.readFile(path.join(process.cwd(), "docs", "sources.md"), "utf8");
  const html = await marked.parse(md.replace(/^# Sources\s*\n/, ""));
  const health = await sourceHealth();
  const hasRuns = health.some((h) => h.lastSuccess || h.lastError);

  return (
    <div className="max-w-4xl space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Sources</h1>
        <p className="mt-1 text-[13px] text-dim">What the collector reads, under which terms, and how each source is doing.</p>
      </header>

      <section>
        <h2 className="label mb-2">Live health</h2>
        {hasRuns ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="label text-left">
                  <th className="py-2 pr-4 font-normal">source</th>
                  <th className="py-2 pr-4 font-normal">last success</th>
                  <th className="py-2 pr-4 font-normal text-right">items</th>
                  <th className="py-2 font-normal">last error</th>
                </tr>
              </thead>
              <tbody>
                {health.map((h) => (
                  <tr key={h.id} className="border-t border-line-soft">
                    <td className="py-1.5 pr-4 text-soft">
                      {h.name}
                      {!h.enabled && <span className="label ml-2 text-faint">off</span>}
                    </td>
                    <td className="num py-1.5 pr-4 text-dim whitespace-nowrap">{h.lastSuccess ? timestampLabel(h.lastSuccess) : "—"}</td>
                    <td className="num py-1.5 pr-4 text-right text-dim">{h.lastItems ?? "—"}</td>
                    <td className="py-1.5 text-dim">
                      {h.lastError && (!h.lastSuccess || (h.lastErrorAt && h.lastErrorAt > h.lastSuccess)) ? (
                        <span className="text-sev-3">
                          {h.lastError.slice(0, 90)}
                          {h.lastErrorAt && <span className="num text-faint"> · {h.lastErrorAt.slice(0, 10)}</span>}
                        </span>
                      ) : (
                        <span className="text-faint">ok</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[13px] text-dim">The collector has not run yet. Per-source status appears here after the first run.</p>
        )}
      </section>

      {/* the full attribution text, moved here from the footer, which links to this anchor */}
      <section id="licences" className="panel scroll-mt-24 space-y-3 p-5 text-[13.5px] leading-relaxed text-soft">
        <h2 className="text-[1.05rem] font-semibold tracking-tight text-ink">Licences and credits</h2>
        <p>
          {SITE.name} is a non-commercial reference site. It stores titles, links and its own two-sentence summaries, never article text, and links to original reporting.
        </p>
        <p>
          data <a className="link" href={SITE.dataLicense.url}>{SITE.dataLicense.name}</a> · code <a className="link" href={SITE.codeLicense.url}>{SITE.codeLicense.name}</a>
        </p>
        <p>
          Includes data from the AI Incident Database (CC BY-SA 4.0), MITRE ATLAS (Apache 2.0), NVD, the GitHub Advisory Database (CC BY 4.0) and CISA KEV (CC0). This product uses the NVD API but is not endorsed or certified by the NVD.
        </p>
        <p>
          Incidents are mapped to the OWASP Top 10 for LLM Applications (CC BY-SA 4.0, © OWASP Foundation) and MITRE ATLAS techniques (Apache 2.0, © MITRE); the{" "}
          <Link className="link" href="/methodology#standards">
            mapping
          </Link>{" "}
          is not endorsed by either.
        </p>
        <p>
          Powered by <a className="link" href="https://www.gdeltproject.org/">GDELT</a>. Search powered by <a className="link" href="https://hn.algolia.com/">Algolia</a>. Thank you to arXiv for use of its open access interoperability. Traffic signal:{" "}
          <a className="link" href="https://radar.cloudflare.com/">Cloudflare Radar</a> (CC BY-NC 4.0).
        </p>
      </section>

      <section className="prose-sources" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
