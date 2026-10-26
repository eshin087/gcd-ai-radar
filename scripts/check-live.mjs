#!/usr/bin/env node
/**
 * Checks the live page in a real browser: every counter equals live.json,
 * every lane tab lists as many rows as it says, the lanes sum to the live
 * counter, the AI-only switch keeps only AI rows, each counter link opens an
 * archive view with the same count, the first calendar day opens the records
 * reported that day, the live tags agree with the rows, and no page scrolls
 * sideways on a phone. Zero dependencies (scripts/lib/browser.mjs).
 *
 *   npm run build
 *   node scripts/check-live.mjs                 # serves ./out on a free port
 *   node scripts/check-live.mjs --url https://gcd-ai-radar.vercel.app
 *
 * Options: --dir <out dir>  --browser <chrome or edge executable>  --port <n>  --verbose
 */
import { collectErrors, evaluate, launch, navigate, openSite, parseArgs, sleep } from "./lib/browser.mjs";

const args = parseArgs(process.argv.slice(2));
const verbose = Boolean(args.verbose);
const LIVE_READY = `document.querySelector('[data-live-board][data-live-ready="1"]')`;
const ARCHIVE_READY = `(() => { const s = document.querySelector('[data-archive-status]'); return s && /\\d/.test(s.textContent) && !/loading/.test(s.textContent); })()`;

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  if (verbose || !ok) console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
}

async function toggleLane(client, key) {
  const ok = await evaluate(client, `(() => { const g = document.querySelector('[role="radiogroup"][aria-label="Lane"]'); const b = g && [...g.querySelectorAll('[role="radio"]')].find((x) => x.textContent.trim().toLowerCase().startsWith(${JSON.stringify(key)})); if (!b) return false; b.click(); return true; })()`);
  if (!ok) throw new Error(`no lane tab ${key}`);
  await sleep(250);
  // open every "show N more" so the rows can be counted
  for (let i = 0; i < 10; i++) {
    const more = await evaluate(client, `(() => { const b = [...document.querySelectorAll('[data-live-board] button')].find((x) => /^show \\d+ more$/.test(x.textContent.trim())); if (!b) return false; b.click(); return true; })()`);
    if (!more) break;
    await sleep(150);
  }
}

const ROWS = `[...document.querySelectorAll('[data-live-board] [data-row]')].map((r) => ({ lane: r.dataset.lane, state: r.dataset.state, ai: r.dataset.ai, tags: (r.dataset.tags || "").split(" ").filter(Boolean) }))`;

async function run(client, base) {
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const live = await fetch(`${base}/live.json`).then((r) => r.json());
  await navigate(client, `${base}/`, LIVE_READY);

  // counters against live.json
  const counters = await evaluate(client, `Object.fromEntries([...document.querySelectorAll('[data-counter]')].map((e) => [e.dataset.counter, Number(e.dataset.value)]))`);
  for (const [key, expected] of [["live", live.counters.live], ["critical", live.counters.critical], ["unpatched", live.counters.unpatched], ["quiet", live.counters.quiet.days], ["ai", live.counters.ai]]) {
    check(`counter ${key}`, counters[key] === expected, `page ${counters[key]}, live.json ${expected}`);
  }

  // every lane tab lists what it says; the action lanes sum to the live counter
  const byKey = Object.fromEntries(live.boards.map((b) => [b.key, b]));
  const label = { patch: "patch now", breach: "breaches", supply_chain: "supply chain", all: "all", research: "research" };
  let actionSum = 0;
  for (const key of ["patch", "breach", "supply_chain", "all", "research"]) {
    await toggleLane(client, label[key]);
    const rows = await evaluate(client, ROWS);
    const tab = await evaluate(client, `Number((document.querySelector('[role="radiogroup"][aria-label="Lane"] [aria-checked="true"]')?.textContent.match(/(\\d+)\\s*$/) || [])[1])`);
    check(`lane ${key} rows`, rows.length === byKey[key].count && tab === byKey[key].count, `${rows.length} rows, tab ${tab}, live.json ${byKey[key].count}`);
    check(`lane ${key} every row live and in its lane`, rows.every((r) => r.state === "live" && (key === "all" ? ["patch", "breach", "supply_chain"].includes(r.lane) : r.lane === key)));
    if (key !== "all" && key !== "research") actionSum += rows.length;
  }
  check("action lanes sum to the live counter", actionSum === live.counters.live, `${actionSum} vs ${live.counters.live}`);

  // AI only, on the All tab
  await toggleLane(client, "all");
  await evaluate(client, `document.querySelector('[data-live-board] button[aria-pressed]').click()`);
  await sleep(250);
  const aiRows = await evaluate(client, ROWS);
  check("AI only keeps only AI rows", aiRows.every((r) => r.ai === "1") && aiRows.length === live.counters.ai, `${aiRows.length} rows, counter ${live.counters.ai}`);
  await evaluate(client, `document.querySelector('[data-live-board] button[aria-pressed]').click()`);
  await sleep(200);

  // live tags agree with the rows across the four lanes
  const allRows = [];
  for (const key of ["patch", "breach", "supply_chain", "research"]) {
    await toggleLane(client, label[key]);
    allRows.push(...(await evaluate(client, ROWS)));
  }
  for (const t of live.top_tags.slice(0, 5)) {
    const n = allRows.filter((r) => r.tags.includes(t.slug)).length;
    check(`live tag ${t.slug}`, n === t.live, `${n} rows, live.json ${t.live}`);
  }

  // each counter link opens an archive view with the same count
  const links = await evaluate(client, `[...document.querySelectorAll('a[data-counter]')].map((a) => [a.dataset.counter, a.getAttribute('href'), Number(a.dataset.value)])`);
  for (const [key, href, value] of links) {
    await navigate(client, `${base}${href}`, ARCHIVE_READY);
    const status = await evaluate(client, `document.querySelector('[data-archive-status]')?.textContent || ""`);
    const n = Number((status.match(/^([\d,]+)/) || [])[1]?.replace(/,/g, ""));
    check(`counter ${key} opens ${href}`, n === value, `archive "${status.trim()}", counter ${value}`);
  }

  // the first calendar day with a report opens the records first reported that day
  await navigate(client, `${base}/`, LIVE_READY);
  const day = await evaluate(client, `(() => { const r = document.querySelector('rect[role="button"]'); if (!r) return null; const m = r.getAttribute("aria-label").match(/^(.*?): (\\d+) reported/); return m ? { label: m[1], reported: Number(m[2]) } : null; })()`);
  if (day) {
    await evaluate(client, `document.querySelector('rect[role="button"]').dispatchEvent(new MouseEvent("click", { bubbles: true }))`);
    for (let i = 0; i < 100 && !(await evaluate(client, `location.pathname === "/incidents" && ${ARCHIVE_READY}`)); i++) await sleep(100);
    const status = await evaluate(client, `document.querySelector('[data-archive-status]')?.textContent || ""`);
    const n = Number((status.match(/^([\d,]+)/) || [])[1]?.replace(/,/g, ""));
    check(`calendar day ${day.label} opens its records`, n === day.reported, `archive "${status.trim()}", cell ${day.reported}`);
  } else check("calendar has a clickable day", false, "no rect[role=button]");

  // phones: nothing scrolls sideways
  await client.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  const firstTag = live.top_tags[0]?.slug ?? "rce";
  const firstRow = allRows.length ? await (async () => {
    await navigate(client, `${base}/`, LIVE_READY);
    return evaluate(client, `document.querySelector('[data-live-board] [data-row] a')?.getAttribute('href')`);
  })() : null;
  for (const p of ["/", "/incidents", "/tags", `/tags/${firstTag}`, firstRow, "/trends", "/about"].filter(Boolean)) {
    await navigate(client, `${base}${p}`);
    await sleep(400);
    const w = await evaluate(client, `({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth })`);
    check(`no sideways scroll on ${p} at 375px`, w.scroll <= w.inner, `scrollWidth ${w.scroll}, innerWidth ${w.inner}`);
  }
}

async function main() {
  const t0 = Date.now();
  const site = await openSite(args);
  const { client, close, exe } = await launch(args.browser);
  const errors = collectErrors(client);
  try {
    await run(client, site.base);
    const failed = checks.filter((c) => !c.ok);
    console.log(`\n${checks.length - failed.length}/${checks.length} live-page checks pass in ${((Date.now() - t0) / 1000).toFixed(1)} s · ${exe.split(/[\\/]/).pop()} · ${site.base}`);
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
