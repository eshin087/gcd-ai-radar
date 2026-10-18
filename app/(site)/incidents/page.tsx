import type { Metadata } from "next";
import { IncidentExplorer } from "@/components/incidents/IncidentExplorer";
import { isDisclosedIncident } from "@/lib/counting";
import { loadIncidents } from "@/lib/data";

export const metadata: Metadata = {
  title: "Incidents",
  description: "Every published AI cybersecurity incident, filterable by type, category, severity, target, year and source.",
};

export default async function IncidentsPage() {
  const { incidents } = await loadIncidents();
  const disclosed = incidents.filter(isDisclosedIncident).length;
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Incidents</h1>
          <p className="mt-1 text-[13px] text-dim">
            {(incidents.length - disclosed).toLocaleString("en-US")} incidents, plus {disclosed.toLocaleString("en-US")} disclosed CVEs with no confirmed
            exploitation under &ldquo;records&rdquo;. Filters are mirrored in the URL, so any view can be shared.
          </p>
        </div>
        <a className="label hover:text-ink" href="/data/incidents.csv">
          download csv →
        </a>
      </header>
      <IncidentExplorer />
    </div>
  );
}
