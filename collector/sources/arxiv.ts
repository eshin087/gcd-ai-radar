import { buildMatcher } from "../lib/text";
import { fetchFeedItems, itemToCandidate, lookbackStart } from "./rss";
import type { Candidate, SourceAdapter } from "./types";

/**
 * arXiv cs.CR via the official RSS feed (daily, weekdays, abstract included).
 * Terms of use: at most one request every three seconds, link to the abstract
 * page, never store PDFs. Metadata including abstracts is CC0. Attribution
 * line on the site: "Thank you to arXiv for use of its open access
 * interoperability."
 *
 * Only new and cross-listed announcements are considered (replacements are
 * skipped), and only papers whose title or abstract mentions an AI term; the
 * classifier is told these are research papers (severity 1 by default).
 */

const HINT =
  "arXiv preprint (research paper). Severity 1 unless the paper documents confirmed real-world exploitation. In scope only if it demonstrates an attack, vulnerability or abuse of AI systems, or AI used offensively; defence-only or benchmark papers are out of scope.";

function announceType(raw: Record<string, unknown>): string {
  const v = raw["arxiv:announce_type"];
  return typeof v === "string" ? v : "";
}

export const arxivAdapter: SourceAdapter = {
  kind: "arxiv",
  async fetch(source, ctx) {
    const items = await fetchFeedItems(source, ctx);
    const since = lookbackStart(ctx, 3);
    const ai = buildMatcher(ctx.config.keywords.ai_terms);
    const out: Candidate[] = [];
    for (const item of items) {
      const type = announceType(item.raw);
      if (type && type.startsWith("replace")) continue;
      if (item.date && item.date < since) continue;
      if (!ai.test(`${item.title}\n${item.summary}`)) continue;
      const c = itemToCandidate(item, source, ctx, { publisher: "arXiv", extra: { classifier_hint: HINT, announce_type: type } });
      if (c) {
        // The RSS description starts with "arXiv:ID Announce Type: new Abstract: ..." — keep the abstract part.
        c.hint = c.hint.replace(/^arXiv:\S+\s+Announce Type:\s*\S+\s+Abstract:\s*/i, "");
        out.push(c);
      }
      if (ctx.limit && out.length >= ctx.limit) break;
    }
    return out;
  },
};
