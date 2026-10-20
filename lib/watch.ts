import type { Category, IncidentType } from "./taxonomy";

/**
 * Definitions behind the dashboard's "Is my stack hit?" and "Agentic AI
 * watch" panels. Both read only structured fields (type, categories, the
 * product families of lib/products.ts), never titles or free-text tags, so
 * the same record always lands in the same rows, and the build-time tallies
 * (lib/aggregates.ts) and the drawers (lib/selection.ts) share one rule.
 */

type Row = { type: IncidentType; categories: readonly Category[]; products?: readonly string[] };

/**
 * The products an incident counts against on "Is my stack hit?": the families
 * it names when the attack was on an AI system. When AI is the weapon
 * (ai_enabled_attack), a named product is the attacker's tool or the channel
 * a scam ran on (a chatbot that wrote the malware, the social network a
 * deepfake ran on), not a system of the victim's that was hit.
 */
export function stackProducts(r: Row): readonly string[] {
  return r.type === "attack_on_ai" ? (r.products ?? []) : [];
}

/** Product families that are agent tooling: MCP servers and SDKs, coding and computer-use agents, agent platforms. */
export const AGENT_TOOLING: readonly string[] = [
  "MCP servers & tools",
  "MCP SDKs",
  "FastMCP",
  "Claude Code + SDKs",
  "Claude Code UI",
  "OpenAI Codex",
  "GitHub Copilot",
  "Copilot Studio",
  "Windsurf",
  "Amazon Bedrock AgentCore",
  "Browser Use",
  "Agno",
  "OpenClaw",
  "ClawdBot",
];
const MCP_FAMILIES = new Set(["MCP servers & tools", "MCP SDKs", "FastMCP"]);
const TOOLING = new Set(AGENT_TOOLING);

/** True for a disclosed vulnerability whose product (its first, as the disclosed breakdown files it) is agent tooling. */
export function isAgentTooling(product: string): boolean {
  return TOOLING.has(product);
}

/**
 * Agentic incidents are those classified agent_hijack in any position: an AI
 * agent or its tools were turned against their user or operator (a hijacked
 * or misbehaving agent, a poisoned tool or skill, an agent run by an
 * attacker). The slices say how; one incident can be in several.
 */
export const AGENTIC_SLICES = ["all", "injection", "supply", "leak", "mcp", "attacker"] as const;
export type AgenticSlice = (typeof AGENTIC_SLICES)[number];

export const AGENTIC_META: Record<AgenticSlice, { label: string; title: string }> = {
  all: { label: "Incidents involving AI agents", title: "Every incident classified as agent hijacking, in any position" },
  injection: { label: "Steered by prompt injection", title: "Agent incidents also classified as prompt injection or jailbreak" },
  supply: { label: "Poisoned tools, skills or packages", title: "Agent incidents also classified as supply chain or data poisoning" },
  leak: { label: "Data or credentials taken", title: "Agent incidents also classified as data leak or model theft" },
  mcp: { label: "Through an MCP server or SDK", title: "Agent incidents that name an MCP server, SDK or FastMCP" },
  attacker: { label: "Agents run by attackers", title: "Agent incidents where AI was the weapon (AI-enabled attacks)" },
};

export function isAgentic(r: Pick<Row, "categories">): boolean {
  return r.categories.includes("agent_hijack");
}

/** The slices an agentic incident belongs to ("all" first); none for any other incident. */
export function agenticSlices(r: Row): AgenticSlice[] {
  if (!isAgentic(r)) return [];
  const has = (...cs: Category[]) => cs.some((c) => r.categories.includes(c));
  const out: AgenticSlice[] = ["all"];
  if (has("prompt_injection", "jailbreak")) out.push("injection");
  if (has("supply_chain", "data_poisoning")) out.push("supply");
  if (has("data_leak", "model_theft_extraction")) out.push("leak");
  if ((r.products ?? []).some((p) => MCP_FAMILIES.has(p))) out.push("mcp");
  if (r.type === "ai_enabled_attack") out.push("attacker");
  return out;
}
