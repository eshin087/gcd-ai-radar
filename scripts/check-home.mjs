#!/usr/bin/env node
/**
 * Checks the home page and the web half of /trends in a real browser against
 * the files they were built from.
 *
 * The home page (the day sheet, lib/panel): the hero's three numbers equal
 * /stats/panel.json and /stats/home.json; My stack shows the default tiles
 * with red flags only where the rule put them, a tile opens the list it
 * counts, and a ?stack= link applies, stores and recomputes the picks and
 * the ledger's stack marks; the ledger shows this week's deadlines (with the time left),
 * the records without a full patch and the week's new records as
 * panel.json has them, marks the rows in the stack and the AI records, keeps
 * only the AI rows under "AI only", and its drawers list every deadline
 * ahead and every record without a patch; the week's six lines equal the
 * counters, draw as many cells as they say and open their lists; the hero's
 * exploited-this-week numeral is the KEV counter, draws, lists the week's
 * newest entries and opens the week's list; motion is off under reduced
 * motion; the HTML stays under its budget; nothing scrolls sideways on a
 * phone. These loads block the Worker, so the page reads as built; one more
 * load lets it through and expects either the live marker or the built
 * numbers.
 *
 * /trends: the counters, their drawers and the chart columns against
 * /stats/home.json, the radar scope's blips, and the three instruments that
 * moved there from the home page: attack types and the attack surface draw
 * one cell or square per count, the AI flow draws ceil(n / 2) ribbons per
 * role inside its box and the weak link one square per CVE with the
 * exploited ones red.
 *
 * Zero dependencies (scripts/lib/browser.mjs).
 *
 *   npm run build
 *   node scripts/check-home.mjs                 # serves ./out on a free port
 *   node scripts/check-home.mjs --url https://gcd-ai-radar.vercel.app
 *
 * Options: --dir <out dir>  --browser <chrome or edge>  --port <n>  --budget <KB, default 250>  --verbose
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { blockHosts, collectErrors, evaluate, launch, navigate, openSite, parseArgs, sleep } from "./lib/browser.mjs";

const args = parseArgs(process.argv.slice(2));
const verbose = Boolean(args.verbose);
const BUDGET_KB = Number(args.budget ?? 250);
const WORKER = "gcd-ai-radar-internet.eshin087.workers.dev";
const HOME_READY = `document.querySelector('[data-instrument="week"]') && document.querySelectorAll('[data-build][data-built]').length >= 5`;
/** The drawer lists' cap (lib/home.ts LIST_CAP). */
const LIST_CAP = 200;
const TRENDS_READY = `document.querySelectorAll('[data-counter]').length >= 6 && document.querySelector('[data-chart="kev-by-month"] rect') && document.querySelector('[data-instrument="ai"][data-built]')`;
/** The ledger's row caps (lib/panel/caps.ts). */
const LEDGER_ROWS = { due: 4, patch: 3, fresh: 3 };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (iso) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  if (verbose || !ok) console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
}

/**
 * Clicks an element, waits for the drawer's list, reads its count line, closes it. A ListDrawer
 * marks its state (components/ui/ListDrawer.tsx): `listed` is true once it shows rows or says it
 * has none, `error` holds a failed fetch's message.
 */
const OPEN_AND_READ = `async (sel, index) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const all = document.querySelectorAll(sel);
  const el = all[index < 0 ? all.length + index : index];
  if (!el) return { missing: true };
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  for (let i = 0; i < 60; i++) {
    const d = document.querySelector('[role="dialog"]');
    if (d && !d.querySelector("[data-loading]") && (d.querySelector("ol > li, [data-empty], [data-error]") || /^0\\s/.test(d.querySelector("p.num")?.textContent ?? ""))) break;
    await sleep(150);
  }
  const d = document.querySelector('[role="dialog"]');
  const head = d?.querySelector("p.num")?.textContent.trim() ?? "";
  const res = {
    label: el.getAttribute("aria-label"),
    head,
    count: Number((head.match(/^(\\d+)\\s/) || [])[1]),
    rows: d ? d.querySelectorAll("ol > li").length : 0,
    listed: Boolean(d?.querySelector("ol > li, [data-empty]")),
    error: d?.querySelector("[data-error]")?.textContent ?? null,
    locked: document.documentElement.style.overflow === "hidden",
  };
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  await sleep(250);
  res.closed = !document.querySelector('[role="dialog"]') && document.documentElement.style.overflow !== "hidden";
  return res;
}`;

async function openAndRead(client, selector, index = 0) {
  return evaluate(client, `(${OPEN_AND_READ})(${JSON.stringify(selector)}, ${index})`);
}

const num = (s) => Number(String(s ?? "").replace(/[^\d.-]/g, "") || NaN);

/** The KEV additions of the 7 days that belong to the picks, once each (lib/panel/picks.ts stackMatches). */
function stackMatches(file, picks) {
  const out = new Map();
  for (const k of picks) for (const m of file.candidates.find((c) => c.key === k)?.kev7 ?? []) if (!out.has(m.cve)) out.set(m.cve, m);
  return [...out.values()];
}

/** The picks' items by CVE id and link, and the picks a row belongs to (lib/panel/picks.ts stackHits, rowStack). */
function stackHits(file, picks) {
  const hits = { cves: new Map(), hrefs: new Map() };
  const add = (m, key, label) => {
    const labels = m.get(key) ?? [];
    if (!labels.includes(label)) labels.push(label);
    m.set(key, labels);
  };
  for (const k of picks) {
    const c = file.candidates.find((x) => x.key === k);
    for (const it of c?.items ?? []) {
      for (const cve of it.cves) add(hits.cves, cve, c.label);
      add(hits.hrefs, it.href, c.label);
    }
  }
  return hits;
}
function rowStack(hits, row) {
  const out = [];
  for (const cve of row.cves ?? []) for (const l of hits.cves.get(cve) ?? []) if (!out.includes(l)) out.push(l);
  if (row.href) for (const l of hits.hrefs.get(row.href) ?? []) if (!out.includes(l)) out.push(l);
  return out;
}

/** The ledger rows the page shows, in order, with where each links (lib/panel/ledger.ts, lib/panel/caps.ts). */
function ledgerRows(ledger) {
  return [
    ...ledger.due.slice(0, LEDGER_ROWS.due).map((r) => ({ ...r, href: r.href })),
    ...ledger.patch.filter((r) => !r.onDeadlineRow).slice(0, LEDGER_ROWS.patch).map((r) => ({ ...r, href: `/incidents/${r.slug}` })),
    ...ledger.fresh.slice(0, LEDGER_ROWS.fresh).map((r) => ({ ...r, href: `/incidents/${r.slug}` })),
  ];
}

/** What the page shows of the ledger: every row of every group, in order, with its marks and clock. */
const READ_LEDGER = `(() => [...document.querySelectorAll('[data-ledger] [data-row]')].map((el) => ({
  kind: el.dataset.row, ai: el.dataset.ai, hidden: el.hidden, href: el.querySelector('a')?.getAttribute('href') ?? null,
  clock: el.querySelector('[data-countdown]')?.textContent ?? null, stack: el.querySelector('[data-stack-mark]')?.dataset.stackMark ?? "",
  aiMark: el.querySelector('[data-ai-mark]')?.dataset.aiMark ?? null, ready: el.querySelector('[data-stack]')?.dataset.stack ?? null,
})))()`;

async function checkHome(client, base, dir, home, panel, stackFile) {
  await blockHosts(client, [WORKER]);
  await client.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await navigate(client, `${base}/?final`, HOME_READY);

  if (!args.url) {
    const html = await readFile(path.join(dir, "index.html"));
    check(`index.html under ${BUDGET_KB} KB`, html.length <= BUDGET_KB * 1024, `${Math.round(html.length / 1024)} KB`);
  }

  // the verdict
  const v = await evaluate(client, `(() => { const p = document.querySelector('[data-verdict]'); return p && { cves: p.dataset.cves === "" ? null : Number(p.dataset.cves), stack: Number(p.dataset.stackMatch), noPatch: Number(p.dataset.noPatch), text: p.textContent }; })()`);
  check("verdict shows", Boolean(v), v?.text.slice(0, 80));
  check("verdict CVEs are the 24 h counter", v?.cves === home.counters.cves_24h, `page ${v?.cves}, home.json ${home.counters.cves_24h}`);
  check("verdict no-patch count", v?.noPatch === panel.verdict.noFullPatch, `page ${v?.noPatch}, panel.json ${panel.verdict.noFullPatch}`);
  check("verdict stack count", v?.stack === panel.verdict.inStack, `page ${v?.stack}, panel.json ${panel.verdict.inStack}`);
  check("verdict reads its numbers", v?.text.includes(`${home.counters.cves_24h?.toLocaleString("en-US")}new CVEs in 24 h`) && v?.text.includes(`${panel.verdict.noFullPatch.toLocaleString("en-US")}exploited, no full patch`) && v?.text.includes("hit your stack this week"), v?.text.slice(0, 160));

  // My stack: the default tiles, red only where the rule says
  const tiles = await evaluate(client, `[...document.querySelectorAll('[data-stack-tile]')].map((t) => ({ key: t.dataset.stackTile, n: Number(t.dataset.n), flag: t.dataset.flag, shown: t.querySelector('[data-num]')?.textContent, red: Boolean(t.querySelector('.ascii-pulse')) }))`);
  check("stack shows the default tiles", tiles.map((t) => t.key).join(",") === panel.stack.default.join(","), tiles.map((t) => t.key).join(","));
  for (const t of panel.stack.tiles) {
    const p = tiles.find((x) => x.key === t.key);
    check(`stack tile ${t.key}`, p && p.n === t.n && num(p.shown) === t.n && p.flag === (t.flag ?? "") && p.red === Boolean(t.flag), `page n ${p?.n} shown ${p?.shown} flag "${p?.flag}", panel.json n ${t.n} flag "${t.flag ?? ""}"`);
  }

  // a tile opens the list it counts, with as many rows as its number
  {
    const t = panel.stack.tiles[0];
    const r = await openAndRead(client, "[data-stack-tile]", 0);
    check("a stack tile opens its list", r.count === t.n && r.rows === t.n && r.closed, `count line "${r.head?.slice(0, 48)}", ${r.rows} rows, tile n ${t.n}`);
  }

  // the ledger: this week's deadlines, the records without a full patch, the week's new records, as panel.json has them
  const L = panel.ledger;
  const want = ledgerRows(L);
  const led = await evaluate(client, READ_LEDGER);
  check("ledger rows are panel.json's, in order", led.length === want.length && led.every((r, i) => r.kind === want[i].kind && r.href === want[i].href), `${led.length} rows: ${led.map((r) => `${r.kind} ${r.href}`).join(" | ")}`);
  check("ledger heads carry the counts", await evaluate(client, `(() => { const t = (g) => document.querySelector('[data-ledger] [data-group="' + g + '"]')?.textContent.replace(/\\s+/g, ' ') ?? ''; return t('due').includes(${JSON.stringify(String(L.due.length))}) && t('patch').includes(${JSON.stringify(String(L.noFullPatch))}) && t('new').includes(${JSON.stringify(String(L.freshTotal))}) && t('new').includes(${JSON.stringify(String(L.freshLoss))}); })()`));
  if (led.some((r) => r.kind === "due")) {
    const clock = led.find((r) => r.kind === "due").clock;
    check("ledger deadlines say the time left, in days or hours", /^(\d+ (days?|h|min) left|past due)$/.test(clock ?? ""), clock);
  }
  const marks = led.map((r, i) => ({ page: r.stack, want: (want[i]?.stack ?? []).join(","), ai: r.aiMark, type: want[i]?.type ?? "not_ai", kind: r.kind }));
  check("ledger marks the rows in the default stack", marks.every((m) => m.page === m.want), marks.filter((m) => m.page !== m.want).map((m) => `page "${m.page}" vs panel.json "${m.want}"`).join("; ") || `${marks.filter((m) => m.want).length} marked`);
  check("ledger marks the AI records", marks.every((m) => (m.kind === "due" ? m.ai === null : (m.ai !== null) === (m.type !== "not_ai"))), marks.map((m) => `${m.kind}:${m.ai ?? "-"}/${m.type}`).join(" "));
  {
    const r = await openAndRead(client, '[data-ledger] [data-group="patch"] button');
    check("ledger: all without a full patch opens every record", r.count === L.noFullPatch && r.rows === L.patch.length && r.closed, `count line "${r.head?.slice(0, 48)}", ${r.rows} rows, panel.json ${L.patch.length}`);
  }
  if (L.later.length) {
    const r = await openAndRead(client, '[data-ledger] [data-group="due"] button');
    const all = L.due.length + L.later.length;
    check("ledger: later deadlines open every deadline ahead", r.count === all && r.rows === all && r.closed, `count line "${r.head?.slice(0, 48)}", ${r.rows} rows, panel.json ${all}`);
  }
  await evaluate(client, `document.querySelector('[data-filter="ai"]').click()`);
  await sleep(900);
  const aiOnly = await evaluate(client, `({ shown: [...document.querySelectorAll('[data-ledger] [data-row]')].filter((r) => !r.hidden).map((r) => r.dataset.ai), notes: document.querySelectorAll('[data-ledger] [data-note]').length, head: document.querySelector('[data-ledger] [data-group="new"]')?.textContent.replace(/\\s+/g, ' ') ?? '' })`);
  check("AI only keeps the AI rows and counts them", aiOnly.shown.every((a) => a === "1") && aiOnly.head.includes(String(L.freshAi)) && aiOnly.notes >= 1, JSON.stringify(aiOnly));
  await evaluate(client, `document.querySelector('[data-filter="all"]').click()`);
  await sleep(900);
  const back = await evaluate(client, `[...document.querySelectorAll('[data-ledger] [data-row]')].filter((r) => !r.hidden).length`);
  check("all brings every row back", back === want.length, `${back} rows`);

  // the week: six lines equal the counters, their bars draw as many cells as they say, their lists open
  const W = panel.week;
  const wk = await evaluate(client, `Object.fromEntries([...document.querySelectorAll('[data-week] [data-line]')].map((l) => [l.dataset.line, { value: l.querySelector('[data-num]')?.textContent ?? '', level: l.querySelector('[data-level]')?.dataset.level ?? null, cells: l.querySelectorAll('.ascii-cells > i').length, vs: l.querySelector('[data-vs]')?.dataset.vs ?? null, text: l.textContent.replace(/\\s+/g, ' ') }]))`);
  check("week: six lines", Object.keys(wk).join(",") === "patch-tuesday,published,critical,exploited,breaches,ai", Object.keys(wk).join(","));
  check("week published is the 7-day counter", num(wk.published?.value) === home.counters.cves_7d, `${wk.published?.value} vs ${home.counters.cves_7d}`);
  check("week critical is the 7-day counter", num(wk.critical?.value) === home.counters.critical_7d, `${wk.critical?.value} vs ${home.counters.critical_7d}`);
  check("week exploited is the 7-day KEV counter", num(wk.exploited?.value) === home.counters.kev_7d, `${wk.exploited?.value} vs ${home.counters.kev_7d}`);
  check("week breaches is the month's counter", num(wk.breaches?.value) === home.counters.breaches_month, `${wk.breaches?.value} vs ${home.counters.breaches_month}`);
  check("week AI is the roles' sum", num(wk.ai?.value) === W.ai.onAi + W.ai.usingAi && wk.ai?.text.includes(`of ${W.ai.total} incidents`), `${wk.ai?.value} vs ${W.ai.onAi + W.ai.usingAi}`);
  check("week level words are panel.json's", wk.published?.level === String(W.published.level) && wk.exploited?.level === String(W.exploited.level), `published ${wk.published?.level}/${W.published.level}, exploited ${wk.exploited?.level}/${W.exploited.level}`);
  check("week bars draw as many cells as they say", ["published", "critical", "exploited", "breaches"].every((k) => wk[k] && (wk[k].vs === null || Number(wk[k].vs) === wk[k].cells)), ["published", "critical", "exploited", "breaches"].map((k) => `${k} ${wk[k]?.vs}/${wk[k]?.cells}`).join(", "));
  check("week patch tuesday is the next second Tuesday", wk["patch-tuesday"]?.text.includes(shortDate(W.patchTuesday)) && /today|tomorrow|in \d+ days/.test(wk["patch-tuesday"]?.text ?? ""), wk["patch-tuesday"]?.text.slice(0, 80));
  if (home.counters.cves_7d !== null) {
    const r = await openAndRead(client, '[data-week] [data-line="published"] button');
    check("week published opens its list", r.count === home.counters.cves_7d && r.rows > 0 && r.closed, `count line "${r.head?.slice(0, 40)}", ${r.rows} rows`);
  }
  if (home.counters.kev_7d) {
    const r = await openAndRead(client, '[data-week] [data-line="exploited"] button');
    check("week exploited opens its list", r.count === home.counters.kev_7d && r.rows === home.counters.kev_7d && r.closed, `count line "${r.head?.slice(0, 40)}", ${r.rows} rows`);
  }
  if (home.counters.breaches_month !== null) {
    const r = await openAndRead(client, '[data-week] [data-line="breaches"] button');
    check("week breaches opens the month's list", r.count === home.counters.breaches_month && r.listed && !r.error && r.rows === Math.min(home.counters.breaches_month, LIST_CAP) && r.closed, `count line "${r.head?.slice(0, 40)}", ${r.rows} rows${r.error ? `, error "${r.error}"` : ""}`);
  }

  // the footer
  const foot = await evaluate(client, `[...document.querySelectorAll('[data-panel-foot] a')].map((a) => a.getAttribute('href'))`);
  check("footer links lead to the live board and the briefing, never to the data files", foot.includes("/live") && foot.some((h) => h.startsWith("/briefing/")) && !foot.some((h) => /^\/(data|api|embed|stats|feed|llms|live\.json|changes)/.test(h)), `${foot.length} links: ${foot.join(" ")}`);

  // the hero's middle: this week's KEV additions as a dot-matrix numeral, the newest three under it
  const ex = await evaluate(client, `(() => { const e = document.querySelector('[data-exploited]'); return e && { value: e.dataset.value === "" ? null : Number(e.dataset.value), rows: [...e.querySelectorAll('[data-kev-row]')].map((r) => r.dataset.kevRow), w: e.getBoundingClientRect().width }; })()`);
  check("hero exploited is the 7-day KEV counter", ex?.value === home.counters.kev_7d && ex.w > 200, `page ${ex?.value} (${Math.round(ex?.w ?? 0)} px), home.json ${home.counters.kev_7d}`);
  const newest = panel.sieve.exploitedEntries.slice(0, 3).map((e) => e.cve);
  check("hero exploited lists the week's newest three", ex?.rows.join(",") === newest.join(","), `page ${ex?.rows.join(",")}, panel.json ${newest.join(",")}`);
  await sleep(1500);
  const inked = await evaluate(client, `(() => {
    const c = document.querySelector('[data-exploited] canvas');
    if (!c || !c.width) return 0;
    const px = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i] > 200) n++;
    return n;
  })()`);
  check("hero exploited numeral draws", home.counters.kev_7d === null || inked > 400, `${inked} inked pixels`);
  if (home.counters.kev_7d) {
    const r = await openAndRead(client, "[data-exploited] button");
    check("hero exploited opens the week's list", r.count === home.counters.kev_7d && r.listed && r.rows === Math.min(home.counters.kev_7d, LIST_CAP) && r.closed, `count line "${r.head?.slice(0, 50)}", ${r.rows} rows, expected ${home.counters.kev_7d}`);
  }

  // a shared stack link applies, stores and recomputes: the verdict and the ledger's marks
  const rowKeys = new Set(want.flatMap((r) => [...r.cves, r.href]));
  const covering = stackFile.candidates.find((c) => !panel.stack.default.includes(c.key) && (c.items ?? []).some((it) => rowKeys.has(it.href) || it.cves.some((cve) => rowKeys.has(cve))));
  const picks = [...new Set([...(covering ? [covering.key] : []), ...stackFile.candidates.filter((c) => c.kev7.length).slice(0, 1).map((c) => c.key), ...stackFile.candidates.filter((c) => !c.kev7.length).slice(0, 1).map((c) => c.key)])];
  await navigate(client, `${base}/?final&stack=${picks.join(",")},not-a-product`, `${HOME_READY} && document.querySelector('[data-tiles][data-stack="ready"]')`);
  const shared = await evaluate(client, `({ tiles: [...document.querySelectorAll('[data-stack-tile]')].map((t) => t.dataset.stackTile), stored: localStorage.getItem("gcd-radar:stack"), verdict: Number(document.querySelector('[data-verdict]').dataset.stackMatch), hidden: document.documentElement.classList.contains("stack-custom"), ledger: ${READ_LEDGER} })`);
  const expectMatch = stackMatches(stackFile, picks).length;
  check("?stack= applies the picks", shared.tiles.join(",") === picks.join(","), `${shared.tiles.join(",")} for ${picks.join(",")}`);
  check("?stack= stores the picks", shared.stored === picks.join(","), String(shared.stored));
  check("a shared stack recomputes the verdict", shared.verdict === expectMatch && !shared.hidden, `verdict ${shared.verdict}, expected ${expectMatch}`);
  const hits = stackHits(stackFile, picks);
  const wantMarks = want.map((r) => rowStack(hits, { cves: r.cves, href: r.href }).join(","));
  check("a shared stack recomputes the ledger's marks", shared.ledger.length === want.length && shared.ledger.every((r, i) => r.stack === wantMarks[i] && r.ready === "ready"), `page ${shared.ledger.map((r) => r.stack || "-").join("|")}, expected ${wantMarks.map((m) => m || "-").join("|")}${covering ? ` (${covering.key} covers a row)` : " (no candidate covers a shown row)"}`);
  await navigate(client, `${base}/?final`, `${HOME_READY} && document.querySelector('[data-tiles][data-stack="ready"]')`);
  const kept = await evaluate(client, `[...document.querySelectorAll('[data-stack-tile]')].map((t) => t.dataset.stackTile).join(",")`);
  check("the stored stack comes back without the link", kept === picks.join(","), kept);
  await evaluate(client, `localStorage.removeItem("gcd-radar:stack")`);

  // motion: on by default, each instrument building as it scrolls into view (a short viewport keeps the lower ones waiting), off under reduced motion
  await client.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 520, deviceScaleFactor: 1, mobile: false });
  await navigate(client, `${base}/`, `document.querySelector('[data-verdict][data-built]')`);
  const on = await evaluate(client, `({ motion: document.documentElement.classList.contains("motion"), waiting: document.querySelectorAll('[data-build]:not([data-built])').length })`);
  await evaluate(client, `window.scrollTo(0, document.body.scrollHeight)`);
  await sleep(600);
  const scrolled = await evaluate(client, `document.querySelectorAll('[data-build]:not([data-built])').length`);
  check("motion is on by default and builds on scroll", on.motion && on.waiting > 0 && scrolled === 0, `${JSON.stringify(on)}, after scrolling ${scrolled} waiting`);
  await client.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await client.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await navigate(client, `${base}/`, HOME_READY);
  const off = await evaluate(client, `({ motion: document.documentElement.classList.contains("motion"), waiting: document.querySelectorAll('[data-build]:not([data-built])').length, building: document.querySelectorAll('.ascii-cells > i.b, .ascii-units > i.b').length, hidden: document.querySelectorAll('[data-num="wait"]').length })`);
  check("reduced motion: everything final at once", !off.motion && off.waiting === 0 && off.building === 0, JSON.stringify(off));
  await client.send("Emulation.setEmulatedMedia", { features: [] });

  // phones
  await client.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  await navigate(client, `${base}/?final`, HOME_READY);
  await sleep(500);
  const w = await evaluate(client, `({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth })`);
  check("no sideways scroll on / at 375px", w.scroll <= w.inner, `scrollWidth ${w.scroll}, innerWidth ${w.inner}`);

  // the live layer, let through: the live marker, or the built numbers when the Worker has no pulse yet
  await blockHosts(client, []);
  await client.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await navigate(client, `${base}/?final`, HOME_READY);
  await sleep(3500);
  const live = await evaluate(client, `({ marker: document.querySelector('[data-week] [data-line="published"]')?.textContent.includes("· live"), cves: Number(document.querySelector('[data-verdict]').dataset.cves) })`);
  check("live layer: the live marker or the built numbers", live.marker ? live.cves > 0 : live.cves === home.counters.cves_24h, JSON.stringify(live));
  await blockHosts(client, [WORKER]);
}

async function checkTrends(client, base, home, panel) {
  await client.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await navigate(client, `${base}/trends?final`, TRENDS_READY);

  // the three instruments that moved from the home page: attack types, the attack surface, the AI flow
  const types = await evaluate(client, `[...document.querySelectorAll('[data-type]')].map((r) => ({ key: r.dataset.type, n: Number(r.dataset.n), ai: Number(r.dataset.ai), cells: r.querySelectorAll('.ascii-cells > i').length }))`);
  check("attack types", types.length === panel.types.length && types.every((t, i) => t.key === panel.types[i].key && t.n === panel.types[i].n && t.ai === panel.types[i].ai && t.cells >= 1 && t.cells <= 26), types.map((t) => `${t.key} ${t.n}/${t.ai}`).join(", "));
  const surface = await evaluate(client, `[...document.querySelectorAll('[data-tech]')].map((r) => ({ label: r.dataset.tech, n: Number(r.dataset.n), squares: r.querySelectorAll('.ascii-units > i').length, bright: r.querySelectorAll('.ascii-units > i:not(.old)').length }))`);
  check(
    "attack surface: one square per KEV entry, bright for the last 30 days",
    surface.length === panel.surface.length && surface.every((s, i) => s.label === panel.surface[i].label && s.squares === panel.surface[i].n && s.bright === panel.surface[i].recent),
    surface.map((s) => `${s.label} ${s.squares}/${s.bright}`).join(", "),
  );
  const flow = await evaluate(client, `(() => {
    const nodes = [...document.querySelectorAll('[data-node]')].map((n) => ({ cls: n.dataset.node, n: Number(n.dataset.n) }));
    const svg = document.querySelector('.flow-ribbons');
    const box = svg?.getBoundingClientRect();
    const paths = [...(svg?.querySelectorAll('path') ?? [])].map((p) => ({ cls: p.getAttribute('class'), ys: (p.getAttribute('d').match(/-?\\d+(?:\\.\\d+)?/g) || []).map(Number).filter((_, i) => i % 2 === 1) }));
    const vb = (svg?.getAttribute('viewBox') || '0 0 0 0').split(' ').map(Number);
    return { nodes, paths: paths.map((p) => p.cls), inside: paths.every((p) => p.ys.every((y) => y >= 0 && y <= vb[3])), h: Math.round(box?.height ?? 0) };
  })()`);
  const roles = { t: panel.ai.target.n, w: panel.ai.weapon.n, z: panel.ai.none };
  check("AI flow nodes", flow.nodes.length === 3 && flow.nodes.every((n) => n.n === roles[n.cls]), JSON.stringify(flow.nodes));
  for (const k of ["t", "w", "z"]) check(`AI flow ribbons ${k}`, flow.paths.filter((c) => c === k).length === Math.max(1, Math.ceil(roles[k] / 2)), `${flow.paths.filter((c) => c === k).length} paths for ${roles[k]} incidents`);
  check("AI flow ribbons stay in their box", flow.inside && flow.h > 100, `height ${flow.h}`);
  const weak = await evaluate(client, `(() => { const u = document.querySelectorAll('[data-weak] .ascii-units > i'); return { n: u.length, red: [...u].filter((i) => i.classList.contains('red')).length }; })()`);
  check("weak link: a square per CVE, the exploited ones red", weak.n === panel.ai.weak.cves && weak.red === panel.ai.weak.exploited, `${weak.n} squares, ${weak.red} red; panel.json ${panel.ai.weak.cves}/${panel.ai.weak.exploited}`);

  const counters = await evaluate(client, `Object.fromEntries([...document.querySelectorAll('[data-counter]')].map((e) => [e.dataset.counter, e.dataset.value === "" ? null : Number(e.dataset.value)]))`);
  for (const key of ["cves_24h", "cves_7d", "critical_7d", "kev_7d", "breached_accounts_month", "live"]) {
    check(`trends counter ${key}`, counters[key] === home.counters[key], `page ${counters[key]}, home.json ${home.counters[key]}`);
  }
  // every counter's drawer lists what it counts: as many rows, or the first LIST_CAP where the list is capped; a zero lists none
  const expectations = {
    cves_24h: [home.counters.cves_24h, Infinity],
    cves_7d: [home.counters.cves_7d, LIST_CAP],
    critical_7d: [home.counters.critical_7d, LIST_CAP],
    kev_7d: [home.counters.kev_7d, Infinity],
    breached_accounts_month: [home.counters.breaches_month, LIST_CAP],
  };
  for (const [key, [expected, cap]] of Object.entries(expectations)) {
    if (expected === null) continue;
    const r = await openAndRead(client, `button[data-counter="${key}"]`);
    const rows = Math.min(expected, cap);
    check(`trends counter ${key} opens its list`, r.count === expected && r.listed && !r.error && r.rows === rows && r.locked && r.closed, `count line "${r.head?.slice(0, 50)}", ${r.rows} rows, expected ${expected} and ${rows} rows${r.error ? `, error "${r.error}"` : ""}`);
  }
  const day = await openAndRead(client, `button[data-counter="cves_24h"]`);
  check("the 24-hour list is complete", day.rows === home.counters.cves_24h, `${day.rows} rows, counter ${home.counters.cves_24h}`);

  const kevLast = home.series.kev_by_month[home.series.kev_by_month.length - 1];
  const kev = await openAndRead(client, `[data-chart="kev-by-month"] rect[role="button"]`, -1);
  check(`KEV column ${kevLast.month} opens its additions`, kev.count === kevLast.total && kev.rows === Math.min(kevLast.total, LIST_CAP), `${kev.label} → "${kev.head?.slice(0, 40)}", ${kev.rows} rows`);
  const brPrev = home.series.breaches_by_month[home.series.breaches_by_month.length - 2];
  const br = await openAndRead(client, `[data-chart="breaches-by-month"] rect[role="button"]`, -2);
  check(`breach column ${brPrev.month} opens its breaches`, br.count === brPrev.accounts && br.rows === brPrev.breaches, `${br.label} → "${br.head?.slice(0, 40)}", ${br.rows} rows`);

  const charts = await evaluate(client, `[...document.querySelectorAll('#web [data-chart]')].map((c) => ({ name: c.dataset.chart, buttons: [...c.querySelectorAll('rect[role="button"]')].map((b) => b.getAttribute('aria-label')) }))`);
  for (const c of charts.filter((x) => x.buttons.length)) check(`chart ${c.name} labels`, c.buttons.every((l) => /^.+: \d+ \S/.test(l)), `${c.buttons.length} columns`);
  check("CVEs per year reaches back to 1999", charts.find((c) => c.name === "cves-by-year")?.buttons[0]?.startsWith("1999:") ?? false);
  check("the exploitation lag chart is on /trends", charts.some((c) => c.name === "kev-lag-by-year"), charts.map((c) => c.name).join(", "));

  const scope = await fetch(`${base}/stats/scope.json`).then((r) => (r.ok ? r.json() : { total: null, blips: [] }));
  await sleep(1500);
  const fig = await evaluate(client, `(() => {
    const cap = [...document.querySelectorAll("figcaption")].find((f) => f.textContent.startsWith("Radar scope of the"));
    return { total: Number((cap?.textContent.match(/of the (\\d+) incidents/) || [])[1]), fetched: performance.getEntriesByType("resource").some((e) => new URL(e.name).pathname === "/stats/scope.json") };
  })()`);
  check("radar scope fetches the blips its caption counts", fig.fetched && fig.total === scope.total && (scope.blips.length > 0 || scope.total === 0) && scope.blips.length <= scope.total, `caption ${fig.total}, scope.json ${scope.total} incidents and ${scope.blips.length} blips, fetched ${fig.fetched}`);
}

async function main() {
  const t0 = Date.now();
  const site = await openSite(args);
  const dir = path.resolve(args.dir ?? "out");
  const { client, close, exe } = await launch(args.browser);
  const errors = collectErrors(client);
  try {
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    const [home, panel, stackFile] = await Promise.all(["/stats/home.json", "/stats/panel.json", "/stats/stack.json"].map((f) => fetch(`${site.base}${f}`).then((r) => r.json())));
    await checkHome(client, site.base, dir, home, panel, stackFile);
    await checkTrends(client, site.base, home, panel);
    const failed = checks.filter((c) => !c.ok);
    console.log(`\n${checks.length - failed.length}/${checks.length} home-page checks pass in ${((Date.now() - t0) / 1000).toFixed(1)} s · ${exe.split(/[\\/]/).pop()} · ${site.base}`);
    // a blocked Worker request is the check's own doing, not a page error
    const real = errors.filter((e) => !/ERR_BLOCKED_BY_CLIENT|Failed to fetch|NetworkError/.test(e));
    if (real.length) console.log(`page errors (${real.length}):\n  ${[...new Set(real)].slice(0, 10).join("\n  ")}`);
    if (failed.length || real.length) process.exitCode = 1;
  } finally {
    await close();
    site.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
