import { fetchFeedItems, itemToCandidate, lookbackStart } from "./rss";
import type { Candidate, SourceAdapter } from "./types";

/**
 * Microsoft Security Update Guide RSS: thousands of one-line CVE items. Only
 * titles matching the source's title_filter (Copilot, AI, agents…) become
 * candidates; CVE ids let them merge with NVD/GHSA records later.
 */

const HINT =
  "Microsoft Security Update Guide entry (vendor CVE advisory). If the product is an AI feature (Copilot, Azure AI, agents): infra_vuln or data_leak, severity 2 unless Microsoft states exploitation (then 3).";

export const msrcAdapter: SourceAdapter = {
  kind: "msrc",
  async fetch(source, ctx) {
    const items = await fetchFeedItems(source, ctx);
    const since = lookbackStart(ctx, 14);
    const titleFilter = source.title_filter ? new RegExp(source.title_filter, "i") : null;
    const out: Candidate[] = [];
    for (const item of items) {
      if (item.date && item.date < since) continue;
      if (titleFilter && !titleFilter.test(item.title)) continue;
      const c = itemToCandidate(item, source, ctx, { publisher: "MSRC", extra: { classifier_hint: HINT } });
      if (c) out.push(c);
      if (ctx.limit && out.length >= ctx.limit) break;
    }
    return out;
  },
};
