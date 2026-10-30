import { isDisclosedIncident } from "../counting";
import { addDays, type FullIncident } from "../lifecycle";
import { explorerHref, productFamily } from "../products";
import type { KevStatEntry } from "../stats-schema";
import { techOf } from "./technology";
import { kevName, recordCves, recordText, shortDate, slugKey } from "./util";
import type { StackCandidate, StackFile } from "./picks";

export { STACK_FILE, STACK_MAX, STACK_STORAGE_KEY, parsePicks, stackMatches, type StackCandidate, type StackFile, type StackMatch } from "./picks";

/**
 * My stack: products a visitor watches, each a tile with one number, the
 * exploitation in the last 90 days, and a red flag only while something is
 * exploited and still open.
 *
 * Candidates: every vendor with an entry in CISA's Known Exploited
 * Vulnerabilities catalog in the 90 days, the vendors in VENDOR_ALIASES, and
 * the AI product families (lib/products.ts productFamily) named by exploited
 * attacks on AI or by AI-stack KEV entries in the 90 days.
 *
 * Membership: a KEV entry belongs to a vendor when its vendor is that name or
 * the vendor's alias pattern matches its vendor and product; to an AI family
 * when its product is in the family. A record belongs to a vendor when the
 * pattern matches its title, products or tags; to an AI family when one of
 * its products is in the family.
 *
 * The number: KEV entries in the 90 days plus our exploited records (severity
 * 3 or more, no disclosed CVEs) first reported in the 90 days, counted once
 * per CVE id; a record with no CVE id counts once.
 *
 * Red: a KEV deadline on or after today ("due 31 Oct"), else a live patch-lane
 * record of severity 3 or more with no patch yet or a partial one ("no patch
 * yet", "partly patched"), else a live record of severity 4 ("confirmed
 * loss"). Nothing else colours a tile.
 *
 * The default stack, until a visitor chooses: the five vendors with the most
 * KEV entries in the 90 days and the three AI families with the highest
 * number, at least two. Picks live in the browser (localStorage
 * STACK_STORAGE_KEY, lib/panel/picks.ts) and travel in a URL as ?stack=key,key.
 */

export const STACK_DAYS = 90;
export const STACK_DEFAULT_VENDORS = 5;
export const STACK_DEFAULT_AI = 3;
export const STACK_AI_MIN = 2;

/** Products filed under a vendor's own name in news but not in KEV's vendor column. */
export const VENDOR_ALIASES: Record<string, RegExp> = {
  Microsoft: /microsoft|windows|sharepoint|exchange|outlook|azure|entra|defender|\bteams\b/,
  Google: /google|chrome|chromium|android|pixel/,
  Apple: /\bapple\b|\bios\b|macos|safari|webkit|coregraphics/,
  Citrix: /citrix|netscaler/,
  Fortinet: /fortinet|forti(gate|os|web|manager|analyzer|sandbox|client|proxy|switch|siem|ndr|mail)/,
  "Palo Alto Networks": /palo alto|pan-os|globalprotect/,
  Oracle: /oracle|peoplesoft|e-business/,
  Adobe: /adobe|magento/,
  Cisco: /cisco/,
  Linux: /\blinux\b/,
  Ivanti: /ivanti/,
  SonicWall: /sonicwall/,
};

function escapeRx(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface Member {
  kev: (e: KevStatEntry) => boolean;
  record: (i: FullIncident) => boolean;
}

function vendorMember(label: string): Member {
  const rx = VENDOR_ALIASES[label] ?? new RegExp(`(^|[^a-z0-9])${escapeRx(label.toLowerCase())}($|[^a-z0-9])`);
  return {
    kev: (e) => e.vendor.trim() === label || rx.test(`${e.vendor} ${e.product}`.toLowerCase()),
    record: (i) => rx.test(recordText(i)),
  };
}

function familyMember(family: string): Member {
  return {
    kev: (e) => productFamily(e.product) === family,
    record: (i) => i.products.some((p) => productFamily(p) === family),
  };
}

export function buildStack(incidents: readonly FullIncident[], kev: readonly KevStatEntry[], today: string, nowIso: string): StackFile {
  const from = addDays(today, -STACK_DAYS);
  const weekFrom = addDays(today, -7);
  const kev90 = kev.filter((e) => e.added > from && e.added <= today);
  const kev7 = kev.filter((e) => e.added > weekFrom && e.added <= today);
  const ahead = kev.filter((e) => e.due !== null && e.due >= today);
  const exploited90 = incidents.filter((i) => i.severity >= 3 && !isDisclosedIncident(i) && i.first_reported > from && i.first_reported <= today);
  const live = incidents.filter((i) => i.state === "live" && i.severity >= 3);

  // the candidates
  const vendorKevCount = new Map<string, number>();
  for (const e of kev90) vendorKevCount.set(e.vendor.trim(), (vendorKevCount.get(e.vendor.trim()) ?? 0) + 1);
  const vendors = new Set<string>([...vendorKevCount.keys(), ...Object.keys(VENDOR_ALIASES)].filter(Boolean));
  const families = new Set<string>();
  for (const i of exploited90) if (i.type === "attack_on_ai") for (const p of i.products.slice(0, 3)) families.add(productFamily(p));
  for (const e of kev90) if (techOf(e) === "AI stack") families.add(productFamily(e.product));

  const byKey = new Map<string, { label: string; kind: "vendor" | "ai"; member: Member }>();
  for (const v of vendors) byKey.set(slugKey(v), { label: v, kind: "vendor", member: vendorMember(v) });
  for (const f of families) {
    const key = slugKey(f);
    if (!key) continue;
    const had = byKey.get(key);
    if (had) had.kind = "ai";
    else byKey.set(key, { label: f, kind: "ai", member: familyMember(f) });
  }

  const candidates: StackCandidate[] = [];
  for (const [key, { label, kind, member }] of byKey) {
    if (!key) continue;
    const mine = kev90.filter(member.kev);
    const seen = new Set(mine.map((e) => e.cve));
    let n = mine.length;
    for (const i of exploited90.filter(member.record)) {
      const ids = recordCves(i);
      if (ids.length === 0 || ids.some((c) => !seen.has(c))) n += 1;
      for (const c of ids) seen.add(c);
    }
    const why: string[] = [];
    let flag: string | null = null;
    const due = ahead.filter(member.kev).map((e) => e.due!).sort()[0];
    if (due) {
      flag = `due ${shortDate(due)}`;
      why.push(`CISA deadline ${due}`);
    }
    const open = live.filter((i) => member.record(i) && ((i.lane === "patch" && (i.patch_status === "unpatched" || i.patch_status === "partial")) || i.severity >= 4));
    const openWord = open.some((i) => i.severity >= 4) ? "confirmed loss" : open.some((i) => i.patch_status === "unpatched") ? "no patch yet" : open.length ? "partly patched" : null;
    if (openWord) {
      flag ??= openWord;
      why.push(openWord);
    }
    candidates.push({
      key,
      label,
      kind,
      n,
      flag,
      why,
      kev7: kev7.filter(member.kev).map((e) => ({ name: kevName(e.vendor, e.product), cve: e.cve, due: e.due })),
      href: explorerHref(label),
    });
  }
  candidates.sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));

  const vendorRank = [...candidates].filter((c) => c.kind === "vendor").sort((a, b) => (vendorKevCount.get(b.label) ?? 0) - (vendorKevCount.get(a.label) ?? 0) || b.n - a.n || a.label.localeCompare(b.label));
  const picks = vendorRank.slice(0, STACK_DEFAULT_VENDORS).map((c) => c.key);
  for (const c of candidates) {
    if (picks.length >= STACK_DEFAULT_VENDORS + STACK_DEFAULT_AI) break;
    if (c.kind === "ai" && c.n >= STACK_AI_MIN && !picks.includes(c.key)) picks.push(c.key);
  }
  return { generated_at: nowIso, default: picks, candidates };
}
