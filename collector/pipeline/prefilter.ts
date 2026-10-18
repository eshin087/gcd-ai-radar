import type { Config, SourceConfig } from "../lib/config";
import { buildMatcher } from "../lib/text";
import type { Candidate } from "../sources/types";

/**
 * Cheap keyword gate before any LLM call. Press, vendor and social sources
 * must mention both an AI term and a security term; specialist AI-security
 * blogs and structured seeds bypass the gate. Negative terms drop anything.
 */

export interface PrefilterDrop {
  candidate: Candidate;
  reason: string;
}

export interface PrefilterOutcome {
  kept: Candidate[];
  dropped: PrefilterDrop[];
}

export function prefilter(candidates: Candidate[], config: Config, sourcesById: Map<string, SourceConfig>): PrefilterOutcome {
  const ai = buildMatcher(config.keywords.ai_terms);
  const sec = buildMatcher(config.keywords.security_terms);
  const neg = buildMatcher(config.keywords.negative_terms);
  const kept: Candidate[] = [];
  const dropped: PrefilterDrop[] = [];
  for (const c of candidates) {
    const text = `${c.title}\n${c.hint}`;
    const tier = sourcesById.get(c.source_id)?.tier ?? "press";
    if (neg.test(text)) {
      dropped.push({ candidate: c, reason: "negative term" });
      continue;
    }
    if (tier === "specialist" || tier === "seed") {
      kept.push(c);
      continue;
    }
    const hasAi = ai.test(text);
    const hasSec = sec.test(text) || c.cve_ids.length > 0;
    if (hasAi && hasSec) kept.push(c);
    else dropped.push({ candidate: c, reason: !hasAi && !hasSec ? "no AI or security term" : !hasAi ? "no AI term" : "no security term" });
  }
  return { kept, dropped };
}
