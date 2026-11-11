import { urlKey } from "../collector/lib/canonical";
import { nowIso } from "../collector/lib/ids";
import { loadState, saveState, type State } from "../collector/lib/state";
import { cleanProducts } from "../collector/lib/text";
import type { Incident } from "../lib/schema";

/**
 * One-off repair, 2026-11-11 (`npx tsx scripts/repair-data-quality.ts [--write]`).
 * Safe to run again: every step looks for its record first.
 *
 *  1. Product lists lose descriptions ("assistant interface", "dark web leak
 *     site"): collector/lib/text.ts cleanProducts, the rule new records now pass.
 *  2. AIR-2026-1835 (The Record) is the same leak as AIR-2026-1834
 *     (SecurityWeek): its source and timeline entry move to 1834, which takes
 *     the wider title, summary and severity 4.
 *  3. AIR-2026-1833 is a police action against a scam network, a follow-up by
 *     the curation rules, published before decide() checked headlines.
 *  4. The review queue held nine out-of-scope items with no AI role; the bar
 *     decides those now, so they are rejected with the classifier's own reason.
 */

const write = process.argv.includes("--write");
const now = nowIso();

function rejectRecord(state: State, i: Incident, reason: string) {
  for (const s of i.sources) {
    const key = urlKey(s.url);
    state.rejected.push({ key, title: s.title, url: s.url, publisher: s.publisher, source_id: "review", reason, confidence: i.confidence, rejected_at: now });
    state.seen[key] = { status: "rejected", at: now };
  }
}

async function main() {
  const state = await loadState();
  const log: string[] = [];

  // 1. products
  let cleaned = 0;
  for (const i of [...state.incidents, ...state.review]) {
    const next = cleanProducts(i.products);
    if (next.length !== i.products.length || next.some((p, k) => p !== i.products[k])) {
      log.push(`products ${i.id}: [${i.products.join(", ")}] -> [${next.join(", ")}]`);
      i.products = next;
      cleaned += 1;
    }
  }

  // 2. the duplicate pair
  const keep = state.incidents.find((i) => i.id === "AIR-2026-1834");
  const dup = state.incidents.find((i) => i.id === "AIR-2026-1835");
  if (keep && dup) {
    for (const s of dup.sources) {
      if (!keep.sources.some((x) => x.url === s.url)) keep.sources.push(s);
      state.seen[urlKey(s.url)] = { status: "published", id: keep.id, at: now };
    }
    keep.source_count = keep.sources.length;
    keep.title = dup.title;
    keep.summary = "Pro-Russian hackers published personal data of Italian Foreign Minister Antonio Tajani and other senior European officials on the dark web, and offered cryptocurrency bounties for more. Prime Minister Giorgia Meloni blamed pro-Russian hackers for the leak.";
    keep.severity = 4;
    keep.severity_note = dup.severity_note;
    keep.confidence = Math.max(keep.confidence, dup.confidence);
    keep.tags = [...new Set([...keep.tags, ...dup.tags])].slice(0, 6);
    keep.timeline = [...(keep.timeline ?? []), { date: "2026-11-09", title: "The group is reported to target other senior European officials and to offer cryptocurrency rewards for personal information", source_url: dup.sources[0]!.url, added_at: now }];
    keep.updated_at = now;
    state.incidents = state.incidents.filter((i) => i !== dup);
    log.push(`merged ${dup.id} into ${keep.id}`);
  }

  // 3. the police action
  const police = state.incidents.find((i) => i.id === "AIR-2026-1833");
  if (police) {
    rejectRecord(state, police, "law-enforcement follow-up: arrests after a fraud, not a new incident (repair 2026-11-11)");
    state.incidents = state.incidents.filter((i) => i !== police);
    log.push(`rejected ${police.id} ${police.title}`);
  }

  // 4. the queue
  const queued = state.review.filter((i) => i.type === "not_ai" && i.severity === 1);
  for (const i of queued) {
    rejectRecord(state, i, `out of scope, no AI role: ${i.severity_note || "not a specific incident"} (repair 2026-11-11)`);
    log.push(`rejected from the queue ${i.id} ${i.title}`);
  }
  state.review = state.review.filter((i) => !queued.includes(i));

  console.log(log.join("\n"));
  console.log(`\n${cleaned} product lists cleaned · ${state.incidents.length} published · ${state.review.length} in the queue`);
  if (!write) return console.log("dry run; pass --write to save");
  console.log(`saved ${(await saveState(state)).join(", ")}`);
}

void main();
