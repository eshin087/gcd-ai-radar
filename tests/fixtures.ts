import type { FullIncident } from "@/lib/lifecycle";
import type { Incident } from "@/lib/schema";
import { LIFECYCLE_KEYS } from "@/lib/lifecycle";

/**
 * Record fixtures for tests: `incident()` is a complete record (every
 * lifecycle key present, as the site renders them), `legacyIncident()` the
 * shape of a record that predates lanes (no lifecycle keys, as nine shards
 * still hold them), `disclosedCve()` an unexploited NVD record. Each call
 * gets its own id and slug; `source_count` follows `sources`.
 */

let seq = 0;

export function incident(overrides: Partial<FullIncident> = {}): FullIncident {
  seq += 1;
  const first = overrides.first_reported ?? overrides.incident_date?.slice(0, 10) ?? "2026-10-10";
  const stamp = `${first.length === 10 ? first : "2026-10-10"}T06:00:00.000Z`;
  const url = `https://example.org/report-${seq}`;
  const base: FullIncident = {
    id: `AIR-2026-${String(9000 + seq).padStart(4, "0")}`,
    slug: `fixture-incident-${seq}`,
    title: `Fixture incident ${seq} with a title long enough`,
    summary: "Attacker text in a shared document steered the assistant into exfiltrating data. The vendor patched the flow after disclosure.",
    type: "attack_on_ai",
    categories: ["prompt_injection"],
    severity: 3,
    targets: ["enterprise_deployment"],
    products: ["Example Assistant"],
    incident_date: first,
    incident_date_precision: "day",
    first_reported: first,
    sources: [{ url, publisher: "Example News", title: `Report on fixture ${seq}`, published_at: first }],
    source_count: 1,
    confidence: 0.9,
    status: "published",
    origin: "news",
    tags: ["prompt-injection"],
    created_at: stamp,
    updated_at: stamp,
    lane: "patch",
    state: "live",
    closed_at: null,
    patch_status: "unknown",
    cve_ids: [],
    affected: [],
    fixed_in: [],
    timeline: [{ date: first, title: `Report on fixture ${seq}`, source_url: url, added_at: stamp }],
    action: "",
    severity_note: "",
    cvss: null,
  };
  const merged = { ...base, ...overrides };
  if (overrides.sources && overrides.source_count === undefined) merged.source_count = overrides.sources.length;
  return merged;
}

/** A record as the pre-lane shards hold it: no lifecycle keys at all. */
export function legacyIncident(overrides: Partial<Incident> = {}): Incident {
  const full: Record<string, unknown> = { ...incident(overrides as Partial<FullIncident>) };
  for (const k of LIFECYCLE_KEYS) delete full[k];
  return { ...(full as Incident), ...overrides };
}

/** An unexploited NVD record: a disclosed vulnerability, never an incident, always closed. */
export function disclosedCve(overrides: Partial<FullIncident> = {}): FullIncident {
  const first = overrides.first_reported ?? "2026-10-05";
  const id = overrides.cve_ids?.[0] ?? "CVE-2026-1234";
  return incident({
    severity: 2,
    origin: "seed_nvd",
    categories: ["infra_vuln"],
    targets: ["framework_or_tooling"],
    products: ["Langflow"],
    first_reported: first,
    incident_date: first,
    sources: [{ url: `https://nvd.nist.gov/vuln/detail/${id}`, publisher: "NVD", title: `${id}: a flaw`, published_at: first }],
    tags: [id],
    cve_ids: [id],
    lane: "patch",
    state: "closed",
    closed_at: first,
    patch_status: "unknown",
    timeline: [{ date: first, title: `${id}: a flaw`, source_url: `https://nvd.nist.gov/vuln/detail/${id}`, added_at: `${first}T06:00:00.000Z` }],
    ...overrides,
  });
}
