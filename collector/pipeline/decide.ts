import type { Status } from "../../lib/taxonomy";
import type { Settings } from "../lib/config";
import type { ClassificationItem } from "../llm/schemas";

/**
 * The publish decision. With threshold T (settings.confidence_threshold):
 *   in scope  & confidence ≥ T → published
 *   in scope  & confidence < T → review
 *   out       & confidence ≥ T → rejected (reason kept for auditing)
 *   out       & confidence < T → review (borderline scope)
 * Optionally every severity-4 claim goes to review first.
 */
export function decide(item: ClassificationItem, settings: Settings): { status: Status; reason: string } {
  const T = settings.confidence_threshold;
  if (item.in_scope) {
    if (item.confidence < T) return { status: "review", reason: `confidence ${item.confidence.toFixed(2)} below ${T}` };
    if (settings.review_severity_4 && item.severity === 4) return { status: "review", reason: "severity 4 requires review" };
    return { status: "published", reason: `confidence ${item.confidence.toFixed(2)}` };
  }
  if (item.confidence >= T) return { status: "rejected", reason: `out of scope: ${item.scope_reason}` };
  return { status: "review", reason: `borderline scope (${item.confidence.toFixed(2)}): ${item.scope_reason}` };
}
