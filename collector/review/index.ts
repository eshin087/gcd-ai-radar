import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { IncidentSchema, type Incident } from "../../lib/schema";
import { CATEGORIES, CATEGORY_META, INCIDENT_TYPES, SEVERITY_META, TARGETS, TYPE_META, type Category, type Severity, type Target } from "../../lib/taxonomy";
import { commitAndPush } from "../git";
import { urlKey } from "../lib/canonical";
import { nowIso } from "../lib/ids";
import { loadState, saveState, type State } from "../lib/state";

/**
 * `npm run review`: walks data/review-queue.json in the terminal.
 *   a  approve (publish)      r  reject with a reason      e  edit a field
 *   s  skip for now           o  print source urls         q  save and quit
 */

const C = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  amber: (s: string) => `\x1b[33m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};

function card(i: Incident, index: number, total: number): string {
  const lines = [
    "",
    `${C.dim(`${index + 1}/${total}`)}  ${C.bold(i.id)}  ${C.dim(`confidence ${i.confidence}`)}`,
    C.bold(i.title),
    i.summary,
    "",
    `  type       ${C.cyan(TYPE_META[i.type].label)}`,
    `  categories ${i.categories.map((c) => CATEGORY_META[c].label).join(", ")}`,
    `  severity   ${i.severity} ${SEVERITY_META[i.severity].label}`,
    `  targets    ${i.targets.join(", ")}${i.products.length ? `  ·  products: ${i.products.join(", ")}` : ""}`,
    `  dates      incident ${i.incident_date} (${i.incident_date_precision}) · first reported ${i.first_reported}`,
    `  origin     ${i.origin}${i.tags.length ? `  ·  tags: ${i.tags.join(", ")}` : ""}`,
    `  sources    ${i.sources.map((s) => `${s.publisher} ${s.published_at}`).join(" · ")}`,
  ];
  return lines.join("\n");
}

const EDITABLE = ["title", "summary", "type", "categories", "severity", "targets", "products", "incident_date", "incident_date_precision", "tags"] as const;
type Editable = (typeof EDITABLE)[number];

function applyEdit(i: Incident, field: Editable, value: string): string | null {
  const list = () => value.split(",").map((s) => s.trim()).filter(Boolean);
  const draft: Incident = structuredClone(i);
  switch (field) {
    case "title":
    case "summary":
      draft[field] = value.trim();
      break;
    case "type":
      if (!(INCIDENT_TYPES as readonly string[]).includes(value.trim())) return `type must be one of ${INCIDENT_TYPES.join(", ")}`;
      draft.type = value.trim() as Incident["type"];
      break;
    case "categories": {
      const bad = list().filter((c) => !(CATEGORIES as readonly string[]).includes(c));
      if (bad.length) return `unknown categories: ${bad.join(", ")}`;
      draft.categories = list() as Category[];
      break;
    }
    case "severity": {
      const n = Number(value);
      if (![1, 2, 3, 4].includes(n)) return "severity must be 1-4";
      draft.severity = n as Severity;
      break;
    }
    case "targets": {
      const bad = list().filter((t) => !(TARGETS as readonly string[]).includes(t));
      if (bad.length) return `unknown targets: ${bad.join(", ")}`;
      draft.targets = list() as Target[];
      break;
    }
    case "products":
    case "tags":
      draft[field] = list();
      break;
    case "incident_date":
      draft.incident_date = value.trim();
      draft.incident_date_precision = value.trim().length === 10 ? "day" : value.trim().length === 7 ? "month" : "year";
      break;
    case "incident_date_precision":
      if (!["day", "month", "year"].includes(value.trim())) return "precision must be day, month or year";
      draft.incident_date_precision = value.trim() as Incident["incident_date_precision"];
      break;
  }
  const check = IncidentSchema.safeParse(draft);
  if (!check.success) return check.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ");
  Object.assign(i, draft);
  return null;
}

function approve(state: State, i: Incident) {
  const now = nowIso();
  i.status = "published";
  i.updated_at = now;
  state.incidents.push(i);
  for (const s of i.sources) state.seen[urlKey(s.url)] = { status: "published", id: i.id, at: now };
}

function reject(state: State, i: Incident, reason: string) {
  const now = nowIso();
  for (const s of i.sources) {
    const key = urlKey(s.url);
    state.rejected.push({ key, title: s.title, url: s.url, publisher: s.publisher, source_id: "review", reason, confidence: i.confidence, rejected_at: now });
    state.seen[key] = { status: "rejected", at: now };
  }
}

/**
 * Non-interactive decisions: `npm run review -- --approve=AIR-2025-0020,AIR-2025-0021 --reject=AIR-2026-0003 --reason="…"`.
 * Ids can also be given as a title fragment (case-insensitive) when unique.
 */
export async function runReviewBatch(opts: { approve: string[]; reject: string[]; reason?: string; commit: boolean }): Promise<void> {
  const state = await loadState();
  const resolve = (ref: string): Incident | undefined => {
    const byId = state.review.find((i) => i.id === ref);
    if (byId) return byId;
    const matches = state.review.filter((i) => i.title.toLowerCase().includes(ref.toLowerCase()));
    if (matches.length === 1) return matches[0];
    console.log(C.red(`  "${ref}": ${matches.length === 0 ? "not in the review queue" : "matches several queue items"}`));
    return undefined;
  };
  let approved = 0;
  let rejected = 0;
  for (const ref of opts.approve) {
    const item = resolve(ref);
    if (!item) continue;
    approve(state, item);
    state.review = state.review.filter((i) => i.id !== item.id);
    approved += 1;
    console.log(`${C.green("published")} ${item.id} ${item.title}`);
  }
  for (const ref of opts.reject) {
    const item = resolve(ref);
    if (!item) continue;
    reject(state, item, opts.reason || "out of scope (manual review)");
    state.review = state.review.filter((i) => i.id !== item.id);
    rejected += 1;
    console.log(`${C.red("rejected")} ${item.id} ${item.title}`);
  }
  const changed = await saveState(state);
  console.log(`approved ${approved} · rejected ${rejected} · ${state.review.length} left in the queue · saved ${changed.join(", ") || "nothing"}`);
  if (changed.length && opts.commit) await commitAndPush(`data: review (+${approved} published, ${rejected} rejected)`);
}

export async function runReview(): Promise<void> {
  const state = await loadState();
  const queue = [...state.review].sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (queue.length === 0) {
    console.log("review queue is empty");
    return;
  }
  const rl = createInterface({ input: stdin, output: stdout });
  const ask = (q: string) => rl.question(`${q} `);
  const remaining = new Set(queue.map((i) => i.id));
  let approved = 0;
  let rejected = 0;
  let edited = 0;

  try {
    for (let idx = 0; idx < queue.length; idx++) {
      const item = queue[idx]!;
      let done = false;
      while (!done) {
        console.log(card(item, idx, queue.length));
        const answer = (await ask(`\n  ${C.green("[a]")}pprove  ${C.red("[r]")}eject  ${C.amber("[e]")}dit  [s]kip  [o]pen urls  [q]uit ›`)).trim().toLowerCase();
        switch (answer) {
          case "a":
            approve(state, item);
            remaining.delete(item.id);
            approved += 1;
            done = true;
            break;
          case "r": {
            const reason = (await ask("  reason (blank = out of scope):")).trim() || "out of scope (manual review)";
            reject(state, item, reason);
            remaining.delete(item.id);
            rejected += 1;
            done = true;
            break;
          }
          case "e": {
            const field = (await ask(`  field (${EDITABLE.join(", ")}):`)).trim() as Editable;
            if (!EDITABLE.includes(field)) {
              console.log(C.red("  unknown field"));
              break;
            }
            const current = item[field];
            console.log(`  current: ${Array.isArray(current) ? current.join(", ") : String(current)}`);
            const value = await ask("  new value (comma-separated for lists):");
            const err = applyEdit(item, field, value);
            if (err) console.log(C.red(`  ${err}`));
            else {
              item.updated_at = nowIso();
              edited += 1;
            }
            break;
          }
          case "o":
            for (const s of item.sources) console.log(`  ${s.publisher.padEnd(24)} ${s.url}`);
            break;
          case "s":
            done = true;
            break;
          case "q":
            idx = queue.length;
            done = true;
            break;
          default:
            console.log(C.dim("  a / r / e / s / o / q"));
        }
      }
    }
  } finally {
    rl.close();
  }

  state.review = queue.filter((i) => remaining.has(i.id));
  const changed = await saveState(state);
  console.log(`\napproved ${approved} · rejected ${rejected} · edits ${edited} · ${state.review.length} left in the queue`);
  if (changed.length === 0) return;
  console.log(`saved ${changed.join(", ")}`);
  const rl2 = createInterface({ input: stdin, output: stdout });
  const commit = (await rl2.question("commit and push now? [y/N] ")).trim().toLowerCase() === "y";
  rl2.close();
  if (commit) await commitAndPush(`data: review (+${approved} published, ${rejected} rejected, ${edited} edits)`);
}
