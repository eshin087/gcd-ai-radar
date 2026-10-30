import type { Status } from "../../lib/taxonomy";
import type { Settings } from "../lib/config";
import type { ClassificationItem } from "../llm/schemas";

/**
 * The publish decision. With threshold T (settings.confidence_threshold):
 *   out       & confidence ≥ T → rejected (reason kept for auditing)
 *   out       & confidence < T → review (borderline scope)
 *   in scope, no AI role, below the curation bar → rejected (the bar decides
 *                                                    publication for not_ai items;
 *                                                    for AI items it is advice)
 *   in scope  & confidence < T → review
 *   in scope  & severity 4     → review when settings say so (every record,
 *                                or records with no AI role; both off in
 *                                settings.json)
 *   in scope  & confidence ≥ T → published
 */
export function decide(item: ClassificationItem, settings: Settings): { status: Status; reason: string } {
  const T = settings.confidence_threshold;
  if (!item.in_scope) {
    if (item.confidence >= T) return { status: "rejected", reason: `out of scope: ${item.scope_reason}` };
    return { status: "review", reason: `borderline scope (${item.confidence.toFixed(2)}): ${item.scope_reason}` };
  }
  if (item.type === "not_ai" && !item.newsworthy) {
    return { status: "rejected", reason: `below the curation bar: ${item.newsworthy_reason || item.scope_reason}` };
  }
  if (item.confidence < T) return { status: "review", reason: `confidence ${item.confidence.toFixed(2)} below ${T}` };
  if (item.severity === 4 && (settings.review_severity_4 || (item.type === "not_ai" && settings.review_not_ai_severity_4))) {
    return { status: "review", reason: "severity 4 requires review" };
  }
  return { status: "published", reason: `confidence ${item.confidence.toFixed(2)}` };
}
