#!/usr/bin/env node
/**
 * Checks the home page in a real browser against the file it was built
 * from: every counter equals /stats/home.json, every counter and chart
 * column opens a list whose count line starts with the same number, the hero
 * cluster beside the radar shows and draws the same numbers, the two
 * news columns show their rows, the radar scope fetches the blips its caption
 * counts, the HTML stays under its size budget, and nothing scrolls sideways
 * on a phone. Zero dependencies (scripts/lib/browser.mjs).
 *
 *   npm run build
 *   node scripts/check-home.mjs                 # serves ./out on a free port
 *   node scripts/check-home.mjs --url https://gcd-ai-radar.vercel.app
 *
 * Options: --dir <out dir>  --browser <chrome or edge>  --port <n>  --budget <KB, default 250>  --verbose
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { collectErrors, evaluate, launch, navigate, openSite, parseArgs, sleep } from "./lib/browser.mjs";

const args = parseArgs(process.argv.slice(2));
const verbose = Boolean(args.verbose);
const BUDGET_KB = Number(args.budget ?? 250);
const READY = `document.querySelectorAll('[data-counter]').length >= 6 && document.querySelector('[data-chart="kev-by-month"] rect')`;

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  if (verbose || !ok) console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
}

/** Clicks an element, waits for the drawer's list, reads its count line, closes it. */
const OPEN_AND_READ = `async (sel, index) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const all = document.querySelectorAll(sel);
  const el = all[index < 0 ? all.length + index : index];
  if (!el) return { missing: true };
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  for (let i = 0; i < 60; i++) {
    const d = document.querySelector('[role="dialog"]');
    if (d && (d.querySelector("ol > li") || d.querySelector(".text-live") || /^0\\s/.test(d.querySelector("p.num")?.textContent ?? ""))) break;
    await sleep(150);
  }
  const d = document.querySelector('[role="dialog"]');
  const head = d?.querySelector("p.num")?.textContent.trim() ?? "";
  const res = { label: el.getAttribute("aria-label"), head, count: Number((head.match(/^(\\d+)\\s/) || [])[1]), rows: d ? d.querySelectorAll("ol > li").length : 0, locked: document.documentElement.style.overflow === "hidden" };
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  await sleep(250);
  res.closed = !document.querySelector('[role="dialog"]') && document.documentElement.style.overflow !== "hidden";
  return res;
}`;

async function openAndRead(client, selector, index = 0) {
  return evaluate(client, `(${OPEN_AND_READ})(${JSON.stringify(selector)}, ${index})`);
}

async function run(client, base, dir) {
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const home = await fetch(`${base}/stats/home.json`).then((r) => r.json());
  await navigate(client, `${base}/`, READY);

  // the HTML budget, read from the export when serving ./out
  if (!args.url) {
    const html = await readFile(path.join(dir, "index.html"));
    check(`index.html under ${BUDGET_KB} KB`, html.length <= BUDGET_KB * 1024, `${Math.round(html.length / 1024)} KB`);
  }

  // counters against home.json
  const counters = await evaluate(client, `Object.fromEntries([...document.querySelectorAll('[data-counter]')].map((e) => [e.dataset.counter, e.dataset.value === "" ? null : Number(e.dataset.value)]))`);
  for (const key of ["cves_24h", "cves_7d", "critical_7d", "kev_7d", "breached_accounts_month", "live"]) {
    check(`counter ${key}`, counters[key] === home.counters[key], `page ${counters[key]}, home.json ${home.counters[key]}`);
  }

  // each counter's drawer opens with the same count (the accounts counter opens the month's breaches)
  const expectations = { cves_24h: home.counters.cves_24h, cves_7d: home.counters.cves_7d, critical_7d: home.counters.critical_7d, kev_7d: home.counters.kev_7d, breached_accounts_month: home.counters.breaches_month };
  for (const [key, expected] of Object.entries(expectations)) {
    if (expected === null) continue;
    const r = await openAndRead(client, `button[data-counter="${key}"]`);
    check(`counter ${key} opens its list`, r.count === expected && r.rows > 0 && r.locked && r.closed, `count line "${r.head?.slice(0, 50)}", ${r.rows} rows, expected ${expected}`);
  }
  const day = await openAndRead(client, `button[data-counter="cves_24h"]`);
  check("the 24-hour list is complete", day.rows === home.counters.cves_24h, `${day.rows} rows, counter ${home.counters.cves_24h}`);

  // the hero cluster: four tiles beside the radar, the counters' numbers, drawn, opening the counters' drawers
  const tiles = await evaluate(client, `Object.fromEntries([...document.querySelectorAll('[data-tile]')].map((e) => [e.dataset.tile, { value: e.dataset.value === "" ? null : Number(e.dataset.value), w: e.getBoundingClientRect().width }]))`);
  check("hero cluster shows four tiles", ["due", "open", "cves", "breached"].every((k) => tiles[k]?.w > 100), JSON.stringify(Object.fromEntries(Object.entries(tiles).map(([k, t]) => [k, Math.round(t.w)]))));
  check("cluster New CVEs is the 24 h counter", tiles.cves?.value === home.counters.cves_24h, `tile ${tiles.cves?.value}, home.json ${home.counters.cves_24h}`);
  check("cluster Breached is the accounts counter", tiles.breached?.value === home.counters.breached_accounts_month, `tile ${tiles.breached?.value}, home.json ${home.counters.breached_accounts_month}`);
  await sleep(2500); // the build-in
  const inked = await evaluate(client, `(() => {
    const c = document.querySelector('[data-tile="due"]')?.parentElement?.parentElement?.querySelector("canvas");
    if (!c || !c.width) return 0;
    const px = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i] > 40) n++;
    return n;
  })()`);
  check("hero cluster draws", inked > 2000, `${inked} inked pixels`);
  const due = await evaluate(client, `(() => { const a = document.querySelector('[data-tile="due"]'); return { href: a?.getAttribute("href"), n: Number(a?.dataset.value || 0) }; })()`);
  check("cluster Due links its first deadline at NVD", home.counters.kev_next_due ? /^https:\/\/nvd\.nist\.gov\/vuln\/detail\/CVE-\d{4}-\d+$/.test(due.href ?? "") && due.n > 0 : due.n === 0, `${due.href}, ${due.n} open deadlines, next due ${home.counters.kev_next_due}`);
  if (home.counters.breaches_month !== null) {
    const r = await openAndRead(client, `[data-tile="breached"]`);
    check("cluster Breached opens the month's breaches", r.count === home.counters.breaches_month && r.closed, `count line "${r.head?.slice(0, 50)}", expected ${home.counters.breaches_month}`);
  }

  // chart columns open their month with the same count
  const kevLast = home.series.kev_by_month[home.series.kev_by_month.length - 1];
  const kev = await openAndRead(client, `[data-chart="kev-by-month"] rect[role="button"]`, -1);
  check(`KEV column ${kevLast.month} opens its additions`, kev.count === kevLast.total && kev.rows === Math.min(kevLast.total, 200), `${kev.label} → "${kev.head?.slice(0, 40)}", ${kev.rows} rows`);
  const brPrev = home.series.breaches_by_month[home.series.breaches_by_month.length - 2];
  const br = await openAndRead(client, `[data-chart="breaches-by-month"] rect[role="button"]`, -2);
  check(`breach column ${brPrev.month} opens its breaches`, br.count === brPrev.accounts && br.rows === brPrev.breaches, `${br.label} → "${br.head?.slice(0, 40)}", ${br.rows} rows`);

  // every chart with columns labels them with plain numbers
  const charts = await evaluate(client, `[...document.querySelectorAll('[data-chart]')].map((c) => ({ name: c.dataset.chart, buttons: [...c.querySelectorAll('rect[role="button"]')].map((b) => b.getAttribute('aria-label')) }))`);
  for (const c of charts.filter((x) => x.buttons.length)) check(`chart ${c.name} labels`, c.buttons.every((l) => /^.+: \d+ \S/.test(l)), `${c.buttons.length} columns`);
  check("CVEs per year reaches back to 1999", charts.find((c) => c.name === "cves-by-year")?.buttons[0]?.startsWith("1999:") ?? false);

  // the news columns
  const cols = await evaluate(client, `[...document.querySelectorAll('[data-home-column]')].map((c) => ({ lane: c.dataset.homeColumn, rows: c.querySelectorAll('[data-row]').length, lanes: [...c.querySelectorAll('[data-row]')].map((r) => r.dataset.lane) }))`);
  for (const c of cols) check(`column ${c.lane}`, c.rows > 0 && c.rows <= 5 && c.lanes.every((l) => l === c.lane), `${c.rows} rows`);
  check("two news columns", cols.length === 2);

  // the radar scope: the page carries its frame, the blips come from /stats/scope.json
  const scope = await fetch(`${base}/stats/scope.json`).then((r) => (r.ok ? r.json() : { total: null, blips: [] }));
  const fig = await evaluate(client, `(() => {
    const cap = [...document.querySelectorAll("figcaption")].find((f) => f.textContent.startsWith("Radar scope of the"));
    return { total: Number((cap?.textContent.match(/of the (\\d+) incidents/) || [])[1]), fetched: performance.getEntriesByType("resource").some((e) => new URL(e.name).pathname === "/stats/scope.json") };
  })()`);
  check("radar scope fetches the blips its caption counts", fig.fetched && fig.total === scope.total && (scope.blips.length > 0 || scope.total === 0) && scope.blips.length <= scope.total, `caption ${fig.total}, scope.json ${scope.total} incidents and ${scope.blips.length} blips, fetched ${fig.fetched}`);

  // phones: nothing scrolls sideways
  await client.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  await navigate(client, `${base}/`, READY);
  await sleep(500);
  const w = await evaluate(client, `({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth })`);
  check("no sideways scroll on / at 375px", w.scroll <= w.inner, `scrollWidth ${w.scroll}, innerWidth ${w.inner}`);
}

async function main() {
  const t0 = Date.now();
  const site = await openSite(args);
  const dir = path.resolve(args.dir ?? "out");
  const { client, close, exe } = await launch(args.browser);
  const errors = collectErrors(client);
  try {
    await run(client, site.base, dir);
    const failed = checks.filter((c) => !c.ok);
    console.log(`\n${checks.length - failed.length}/${checks.length} home-page checks pass in ${((Date.now() - t0) / 1000).toFixed(1)} s · ${exe.split(/[\\/]/).pop()} · ${site.base}`);
    if (errors.length) console.log(`page errors (${errors.length}):\n  ${[...new Set(errors)].slice(0, 10).join("\n  ")}`);
    if (failed.length || errors.length) process.exitCode = 1;
  } finally {
    await close();
    site.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
