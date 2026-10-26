import path from "node:path";
import { describe, expect, it } from "vitest";
import { EMPTY_FILTERS, hasCategoricalFilter, matchesStandards } from "@/lib/explorer";
import { readIncidents } from "@/lib/shards";
import {
  ATLAS_IN_USE,
  ATLAS_TECHNIQUES,
  ATLAS_TECHNIQUE_IDS,
  CATEGORIES,
  INCIDENT_TYPES,
  OWASP_IN_USE,
  OWASP_LLM_IDS,
  OWASP_LLM_META,
  OWASP_NOT_DERIVED,
  STANDARDS_BY_CATEGORY,
  STANDARDS_BY_TYPE_CATEGORY,
  atlasFor,
  atlasUrl,
  isAtlasInUse,
  isOwaspInUse,
  owaspFor,
  owaspLabel,
  standardsRow,
  type Category,
  type IncidentType,
} from "@/lib/taxonomy";

/**
 * The standards mapping is a fixed table from type and categories to OWASP
 * LLM Top 10 entries and MITRE ATLAS techniques (lib/taxonomy.ts). These
 * tests pin the table's shape, that every id it uses is a real one with an
 * official link, and that the helpers return exactly what the table says.
 */

const OWASP_ID = /^LLM(0[1-9]|10)$/;
const ATLAS_ID = /^AML\.T\d{4}(\.\d{3})?$/;

describe("the OWASP and ATLAS vocabularies", () => {
  it("lists the ten 2025 OWASP entries with their official pages", () => {
    expect(OWASP_LLM_IDS).toHaveLength(10);
    for (const id of OWASP_LLM_IDS) {
      expect(id).toMatch(OWASP_ID);
      expect(OWASP_LLM_META[id].name.length).toBeGreaterThan(3);
      // OWASP's slugs: llm01-… for LLM01, llmNN2025-… for the rest
      expect(OWASP_LLM_META[id].url).toMatch(new RegExp(`^https://genai\\.owasp\\.org/llmrisk/${id.toLowerCase()}(2025)?-[a-z-]+/$`));
    }
    expect(owaspLabel("LLM06")).toBe("LLM06:2025");
    expect(OWASP_LLM_META.LLM01.name).toBe("Prompt Injection");
    expect(OWASP_LLM_META.LLM10.name).toBe("Unbounded Consumption");
  });

  it("uses well-formed ATLAS technique ids with names and links", () => {
    for (const id of ATLAS_TECHNIQUE_IDS) {
      expect(id).toMatch(ATLAS_ID);
      expect(ATLAS_TECHNIQUES[id].length).toBeGreaterThan(3);
      expect(atlasUrl(id)).toBe(`https://atlas.mitre.org/techniques/${id}`);
    }
    // sub-techniques carry their parent's name, as atlas.mitre.org titles them
    const subs = ATLAS_TECHNIQUE_IDS.filter((t) => /\.\d{3}$/.test(t));
    expect(subs.length).toBeGreaterThan(0);
    for (const id of subs) expect(ATLAS_TECHNIQUES[id]).toContain(": ");
    expect([...ATLAS_TECHNIQUE_IDS]).toEqual([...ATLAS_TECHNIQUE_IDS].sort());
  });
});

describe("the mapping table", () => {
  it("has a row for every category, and every id in it is a known one", () => {
    expect(Object.keys(STANDARDS_BY_CATEGORY).sort()).toEqual([...CATEGORIES].sort());
    const rows = [...Object.values(STANDARDS_BY_CATEGORY), ...Object.values(STANDARDS_BY_TYPE_CATEGORY)];
    for (const row of rows) {
      for (const id of row!.owasp) expect(OWASP_LLM_IDS).toContain(id);
      for (const id of row!.atlas) expect(ATLAS_TECHNIQUE_IDS).toContain(id);
      expect(new Set(row!.owasp).size).toBe(row!.owasp.length);
      expect(new Set(row!.atlas).size).toBe(row!.atlas.length);
      expect(row!.why.length).toBeGreaterThan(20);
    }
  });

  it("keys type-specific rows by a real type and category", () => {
    for (const key of Object.keys(STANDARDS_BY_TYPE_CATEGORY)) {
      const [type, category] = key.split(":");
      expect(INCIDENT_TYPES).toContain(type);
      expect(CATEGORIES).toContain(category);
    }
  });

  it("lists in ATLAS_TECHNIQUES only techniques some row uses", () => {
    expect(ATLAS_IN_USE).toEqual(ATLAS_TECHNIQUE_IDS);
  });

  it("maps the categories with no honest entry to nothing", () => {
    expect(STANDARDS_BY_CATEGORY.deepfake_fraud.owasp).toEqual([]);
    expect(STANDARDS_BY_CATEGORY.ai_assisted_intrusion).toMatchObject({ owasp: [], atlas: [] });
    expect(STANDARDS_BY_CATEGORY.other).toMatchObject({ owasp: [], atlas: [] });
    expect(STANDARDS_BY_CATEGORY.general).toMatchObject({ owasp: [], atlas: [] });
    expect(STANDARDS_BY_CATEGORY.infra_vuln.atlas).toEqual([]);
    expect(STANDARDS_BY_CATEGORY.data_poisoning.atlas).toEqual([]);
  });

  it("splits the OWASP list into produced and never-derived entries", () => {
    expect([...OWASP_IN_USE, ...OWASP_NOT_DERIVED].sort()).toEqual([...OWASP_LLM_IDS]);
    expect(OWASP_IN_USE).toEqual(["LLM01", "LLM02", "LLM03", "LLM04", "LLM06", "LLM10"]);
    expect(OWASP_NOT_DERIVED).toEqual(["LLM05", "LLM07", "LLM08", "LLM09"]);
    expect(isOwaspInUse("LLM01")).toBe(true);
    expect(isOwaspInUse("LLM05")).toBe(false);
    expect(isOwaspInUse("llm01")).toBe(false);
    expect(isAtlasInUse("AML.T0051")).toBe(true);
    expect(isAtlasInUse("AML.T0057")).toBe(false);
  });
});

describe("standardsRow, owaspFor and atlasFor", () => {
  it("return the category's row for every type, unless a type-specific row replaces it", () => {
    for (const type of INCIDENT_TYPES) {
      for (const category of CATEGORIES) {
        const override = STANDARDS_BY_TYPE_CATEGORY[`${type}:${category}`];
        const row = standardsRow(type, category);
        expect(row).toBe(override ?? STANDARDS_BY_CATEGORY[category]);
        expect(owaspFor({ type, categories: [category] })).toEqual(OWASP_LLM_IDS.filter((id) => row.owasp.includes(id)));
        expect(atlasFor({ type, categories: [category] })).toEqual(ATLAS_TECHNIQUE_IDS.filter((id) => row.atlas.includes(id)));
      }
    }
  });

  it("take the union over categories, without duplicates, in list order", () => {
    const i = { type: "attack_on_ai" as IncidentType, categories: ["agent_hijack", "prompt_injection", "jailbreak"] as Category[] };
    expect(owaspFor(i)).toEqual(["LLM01", "LLM06"]);
    expect(atlasFor(i)).toEqual(["AML.T0051", "AML.T0053", "AML.T0054"]);
    // order of categories does not change the answer
    expect(owaspFor({ ...i, categories: [...i.categories].reverse() })).toEqual(owaspFor(i));
    expect(atlasFor({ ...i, categories: [...i.categories].reverse() })).toEqual(atlasFor(i));
  });

  it("follow the documented rows", () => {
    const on = (...categories: Category[]) => ({ type: "attack_on_ai" as IncidentType, categories });
    const by = (...categories: Category[]) => ({ type: "ai_enabled_attack" as IncidentType, categories });
    expect(owaspFor(on("prompt_injection"))).toEqual(["LLM01"]);
    expect(atlasFor(on("prompt_injection"))).toEqual(["AML.T0051"]);
    expect(owaspFor(on("infra_vuln"))).toEqual(["LLM03"]);
    expect(atlasFor(on("infra_vuln"))).toEqual([]);
    expect(owaspFor(on("model_theft_extraction"))).toEqual(["LLM10"]);
    expect(atlasFor(on("model_theft_extraction"))).toEqual(["AML.T0048.004"]);
    expect(owaspFor(by("deepfake_fraud"))).toEqual([]);
    expect(atlasFor(by("deepfake_fraud"))).toEqual(["AML.T0073", "AML.T0088"]);
    expect(atlasFor(by("ai_phishing_social_engineering", "ai_generated_malware"))).toEqual(["AML.T0016.002", "AML.T0052"]);
    expect(owaspFor(by("ai_assisted_intrusion"))).toEqual([]);
    expect(atlasFor(by("ai_assisted_intrusion"))).toEqual([]);
    // the type changes what a supply-chain record is
    expect(owaspFor(on("supply_chain"))).toEqual(["LLM03"]);
    expect(atlasFor(on("supply_chain"))).toEqual(["AML.T0010"]);
    expect(owaspFor(by("supply_chain"))).toEqual([]);
    expect(atlasFor(by("supply_chain"))).toEqual([]);
    expect(owaspFor(by("supply_chain", "agent_hijack"))).toEqual(["LLM06"]);
  });
});

describe("explorer filters", () => {
  const record = { type: "attack_on_ai" as IncidentType, categories: ["data_leak", "prompt_injection"] as Category[] };

  it("match on the derived ids", () => {
    expect(matchesStandards(record, { owasp: "", atlas: "" })).toBe(true);
    expect(matchesStandards(record, { owasp: "LLM01", atlas: "" })).toBe(true);
    expect(matchesStandards(record, { owasp: "LLM02", atlas: "AML.T0051" })).toBe(true);
    expect(matchesStandards(record, { owasp: "LLM06", atlas: "" })).toBe(false);
    expect(matchesStandards(record, { owasp: "", atlas: "AML.T0054" })).toBe(false);
  });

  it("need every year shard, like the other categorical filters", () => {
    expect(hasCategoricalFilter({ ...EMPTY_FILTERS, owasp: "LLM01" })).toBe(true);
    expect(hasCategoricalFilter({ ...EMPTY_FILTERS, atlas: "AML.T0051" })).toBe(true);
    expect(hasCategoricalFilter(EMPTY_FILTERS)).toBe(false);
  });
});

describe("on the live dataset", () => {
  it("every published record maps to known ids, and filtering by an id finds exactly its records", async () => {
    const { incidents } = await readIncidents(path.join(process.cwd(), "data"));
    const published = incidents.filter((i) => i.status === "published");
    expect(published.length).toBeGreaterThan(0);
    for (const i of published) {
      for (const id of owaspFor(i)) expect(OWASP_IN_USE).toContain(id);
      for (const id of atlasFor(i)) expect(ATLAS_IN_USE).toContain(id);
    }
    for (const id of OWASP_IN_USE) {
      const viaFilter = published.filter((i) => matchesStandards(i, { owasp: id, atlas: "" })).length;
      const viaTable = published.filter((i) => i.categories.some((c) => standardsRow(i.type, c).owasp.includes(id))).length;
      expect(viaFilter).toBe(viaTable);
    }
    for (const id of ATLAS_IN_USE) {
      const viaFilter = published.filter((i) => matchesStandards(i, { owasp: "", atlas: id })).length;
      const viaTable = published.filter((i) => i.categories.some((c) => standardsRow(i.type, c).atlas.includes(id))).length;
      expect(viaFilter).toBe(viaTable);
    }
  });
});
