import type { Config, SourceConfig } from "../lib/config";
import { buildMatcher } from "../lib/text";
import type { Candidate } from "../sources/types";

/**
 * Cheap keyword gate before any LLM call. Press, vendor and social sources
 * must mention a security term or carry a CVE id; specialist AI-security
 * blogs and structured seeds bypass the gate. Negative terms drop anything.
 * Whether an AI term matched is recorded on every kept candidate as
 * `extra.ai_hint` for the classifier, which decides the AI role itself:
 * the general lanes carry incidents with no AI role.
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
    const withHint: Candidate = { ...c, extra: { ...c.extra, ai_hint: ai.test(text) } };
    if (tier === "specialist" || tier === "seed") {
      kept.push(withHint);
      continue;
    }
    if (sec.test(text) || c.cve_ids.length > 0) kept.push(withHint);
    else dropped.push({ candidate: c, reason: "no security term" });
  }
  return { kept, dropped };
}
