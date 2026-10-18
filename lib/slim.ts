import type { Incident } from "./schema";
import type { Category, DatePrecision, IncidentType, Origin, Severity, Target } from "./taxonomy";

/** The compact record shipped to the client for the incidents explorer (no sources array). */
export interface SlimIncident {
  id: string;
  slug: string;
  title: string;
  summary: string;
  type: IncidentType;
  categories: Category[];
  severity: Severity;
  targets: Target[];
  products: string[];
  incident_date: string;
  incident_date_precision: DatePrecision;
  first_reported: string;
  source_count: number;
  publishers: string[];
  origin: Origin;
}

export function slim(i: Incident): SlimIncident {
  return {
    id: i.id,
    slug: i.slug,
    title: i.title,
    summary: i.summary,
    type: i.type,
    categories: i.categories,
    severity: i.severity,
    targets: i.targets,
    products: i.products,
    incident_date: i.incident_date,
    incident_date_precision: i.incident_date_precision,
    first_reported: i.first_reported,
    source_count: i.source_count,
    publishers: [...new Set(i.sources.map((s) => s.publisher))],
    origin: i.origin,
  };
}

/** Related incidents: shared categories and targets, same type, close in time. */
export function relatedIncidents(all: Incident[], incident: Incident, limit = 6): Incident[] {
  const date = Date.parse(`${incident.first_reported}T00:00:00Z`);
  return all
    .filter((o) => o.id !== incident.id)
    .map((o) => {
      let score = 0;
      for (const c of o.categories) if (incident.categories.includes(c)) score += 2;
      for (const t of o.targets) if (incident.targets.includes(t) && t !== "n/a") score += 1;
      if (o.type === incident.type) score += 0.5;
      const days = Math.abs(Date.parse(`${o.first_reported}T00:00:00Z`) - date) / 86400000;
      if (days <= 30) score += 1;
      else if (days <= 180) score += 0.5;
      for (const p of o.products) if (incident.products.includes(p)) score += 1.5;
      return { o, score };
    })
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score || b.o.first_reported.localeCompare(a.o.first_reported))
    .slice(0, limit)
    .map((x) => x.o);
}
