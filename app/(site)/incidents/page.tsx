import type { Metadata } from "next";
import { IncidentExplorer } from "@/components/incidents/IncidentExplorer";
import { isDisclosedIncident } from "@/lib/counting";
import { loadIncidents } from "@/lib/data";
import { explorerFacets } from "@/lib/explorer";

export const metadata: Metadata = {
  title: "Archive",
  description: "Every published record across the lanes: patch now, breaches and attacks, supply chain and research, filterable by lane, state, severity, year, tag and source.",
};

export default async function ArchivePage() {
  const { incidents } = await loadIncidents();
  const disclosed = incidents.filter(isDisclosedIncident).length;
  const facets = explorerFacets(incidents);
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">Archive</h1>
          <p className="mt-1 max-w-3xl text-[14px] leading-relaxed text-dim">
            Every published record across the lanes, live and closed: {(incidents.length - disclosed).toLocaleString("en-US")} incidents, plus{" "}
            {disclosed.toLocaleString("en-US")} disclosed CVEs with no confirmed exploitation under &ldquo;records&rdquo;. Filters live in the URL, so any
            view is a link.
          </p>
        </div>
        <a className="label hover:text-ink" href="/data/incidents.csv">
          download csv →
        </a>
      </header>
      <IncidentExplorer facets={facets} />
    </div>
  );
}
