#!/usr/bin/env node
/**
 * Checks the home page and the web half of /trends in a real browser against
 * the files they were built from.
 *
 * The home page (the instrument panel, lib/panel): the verdict's numbers and
 * level equal /stats/panel.json and /stats/home.json; My stack shows the
 * default tiles with red flags only where the rule put them, and a ?stack=
 * link applies, stores and recomputes the picks; Act now and Latest show
 * their rows and the deadlines tick; attack types and the attack surface
 * draw one cell or square per count; the AI flow draws ceil(n / 2) ribbons
 * per role inside its box, and the weak link one square per CVE with the
 * exploited ones red; the sieve's stages match and open their lists; the
 * hero cluster beside the globe shows and draws the counters' numbers; motion
 * is off under reduced motion; the HTML stays under its budget; nothing
 * scrolls sideways on a phone. These loads block the Worker, so the page
 * reads as built; one more load lets it through and expects either the live
 * marker or the built numbers.
 *
 * /trends#web: the counters, their drawers and the chart columns against
 * /stats/home.json, and the radar scope's blips.
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
const HOME_READY = `document.querySelector('[data-instrument="sieve"]') && document.querySelectorAll('[data-build][data-built]').length >= 8`;
const TRENDS_READY = `document.querySelectorAll('[data-counter]').length >= 6 && document.querySelector('[data-chart="kev-by-month"] rect')`;

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

const num = (s) => Number(String(s ?? "").replace(/[^\d.-]/g, "") || NaN);

/** The KEV additions of the 7 days that belong to the picks, once each (lib/panel/picks.ts stackMatches). */
function stackMatches(file, picks) {
  const out = new Map();
  for (const k of picks) for (const m of file.candidates.find((c) => c.key === k)?.kev7 ?? []) if (!out.has(m.cve)) out.set(m.cve, m);
  return [...out.values()];
}

async function checkHome(client, base, dir, home, panel, stackFile) {
  await blockHosts(client, [WORKER]);
  await client.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await navigate(client, `${base}/?final`, HOME_READY);

  if (!args.url) {
    const html = await readFile(path.join(dir, "index.html"));
    check(`index.html under ${BUDGET_KB} KB`, html.length <= BUDGET_KB * 1024, `${Math.round(html.length / 1024)} KB`);
  }

  // the verdict
  const v = await evaluate(client, `(() => { const p = document.querySelector('[data-verdict]'); return p && { level: Number(p.dataset.level), cves: p.dataset.cves === "" ? null : Number(p.dataset.cves), kev: Number(p.dataset.kev), stack: Number(p.dataset.stackMatch), noPatch: Number(p.dataset.noPatch), text: p.textContent }; })()`);
  check("verdict shows", Boolean(v), v?.text.slice(0, 80));
  check("verdict level", v?.level === panel.verdict.level, `page ${v?.level}, panel.json ${panel.verdict.level}`);
  check("verdict CVEs are the 24 h counter", v?.cves === home.counters.cves_24h, `page ${v?.cves}, home.json ${home.counters.cves_24h}`);
  check("verdict KEV is the 7-day counter", v?.kev === (home.counters.kev_7d ?? 0), `page ${v?.kev}, home.json ${home.counters.kev_7d}`);
  check("verdict no-patch count", v?.noPatch === panel.verdict.noFullPatch, `page ${v?.noPatch}, panel.json ${panel.verdict.noFullPatch}`);
  check("verdict stack count", v?.stack === panel.verdict.inStack, `page ${v?.stack}, panel.json ${panel.verdict.inStack}`);
  check("verdict reads its numbers", v?.text.includes(`${home.counters.cves_24h?.toLocaleString("en-US")} new CVEs`) && v?.text.includes(`AI in ${panel.verdict.aiWeek} of this week`), v?.text.slice(0, 160));

  // My stack: the default tiles, red only where the rule says
  const tiles = await evaluate(client, `[...document.querySelectorAll('[data-stack-tile]')].map((t) => ({ key: t.dataset.stackTile, n: Number(t.dataset.n), flag: t.dataset.flag, shown: t.querySelector('[data-num]')?.textContent, red: Boolean(t.querySelector('.ascii-pulse')) }))`);
  check("stack shows the default tiles", tiles.map((t) => t.key).join(",") === panel.stack.default.join(","), tiles.map((t) => t.key).join(","));
  for (const t of panel.stack.tiles) {
    const p = tiles.find((x) => x.key === t.key);
    check(`stack tile ${t.key}`, p && p.n === t.n && num(p.shown) === t.n && p.flag === (t.flag ?? "") && p.red === Boolean(t.flag), `page n ${p?.n} shown ${p?.shown} flag "${p?.flag}", panel.json n ${t.n} flag "${t.flag ?? ""}"`);
  }

  // Act now and Latest
  const act = await evaluate(client, `[...document.querySelectorAll('[data-act-row]')].map((r) => ({ kind: r.dataset.actRow, name: r.querySelector('a')?.textContent, clock: r.querySelector('[data-countdown]')?.textContent ?? null }))`);
  check("act now rows", act.length === panel.act.rows.length && act.length <= 6 && act.every((r, i) => r.name === panel.act.rows[i].name), act.map((r) => r.name).join(" | "));
  if (act.some((r) => r.kind === "kev")) {
    const first = act.find((r) => r.kind === "kev").clock;
    await sleep(1200);
    const second = await evaluate(client, `document.querySelector('[data-countdown]')?.textContent`);
    check("act now deadlines tick", /left$|^past due$/.test(first ?? "") && first !== second, `${first} → ${second}`);
  }
  const latest = await evaluate(client, `[...document.querySelectorAll('[data-latest] > li')].map((l) => l.querySelector('a')?.getAttribute('href'))`);
  check("latest rows", latest.length === panel.latest.length && latest.every((h, i) => h === `/incidents/${panel.latest[i].slug}`), `${latest.length} rows, panel.json ${panel.latest.length}`);

  // attack types and the attack surface
  const types = await evaluate(client, `[...document.querySelectorAll('[data-type]')].map((r) => ({ key: r.dataset.type, n: Number(r.dataset.n), ai: Number(r.dataset.ai), cells: r.querySelectorAll('.ascii-cells > i').length }))`);
  check("attack types", types.length === panel.types.length && types.every((t, i) => t.key === panel.types[i].key && t.n === panel.types[i].n && t.ai === panel.types[i].ai && t.cells >= 1 && t.cells <= 26), types.map((t) => `${t.key} ${t.n}/${t.ai}`).join(", "));
  const surface = await evaluate(client, `[...document.querySelectorAll('[data-tech]')].map((r) => ({ label: r.dataset.tech, n: Number(r.dataset.n), squares: r.querySelectorAll('.ascii-units > i').length, bright: r.querySelectorAll('.ascii-units > i:not(.old)').length }))`);
  check(
    "attack surface: one square per KEV entry, bright for the last 30 days",
    surface.length === panel.surface.length && surface.every((s, i) => s.label === panel.surface[i].label && s.squares === panel.surface[i].n && s.bright === panel.surface[i].recent),
    surface.map((s) => `${s.label} ${s.squares}/${s.bright}`).join(", "),
  );

  // the AI flow
  const flow = await evaluate(client, `(() => {
    const nodes = [...document.querySelectorAll('[data-node]')].map((n) => ({ cls: n.dataset.node, n: Number(n.dataset.n) }));
    const svg = document.querySelector('.flow-ribbons');
    const box = svg?.getBoundingClientRect();
    const paths = [...(svg?.querySelectorAll('path') ?? [])].map((p) => ({ cls: p.getAttribute('class'), ys: (p.getAttribute('d').match(/-?\\d+(?:\\.\\d+)?/g) || []).map(Number).filter((_, i) => i % 2 === 1) }));
    const vb = (svg?.getAttribute('viewBox') || '0 0 0 0').split(' ').map(Number);
    return { nodes, paths: paths.map((p) => p.cls), inside: paths.every((p) => p.ys.every((y) => y >= 0 && y <= vb[3])), h: Math.round(box?.height ?? 0) };
  })()`);
  const want = { t: panel.ai.target.n, w: panel.ai.weapon.n, z: panel.ai.none };
  check("AI flow nodes", flow.nodes.length === 3 && flow.nodes.every((n) => n.n === want[n.cls]), JSON.stringify(flow.nodes));
  for (const k of ["t", "w", "z"]) check(`AI flow ribbons ${k}`, flow.paths.filter((c) => c === k).length === Math.max(1, Math.ceil(want[k] / 2)), `${flow.paths.filter((c) => c === k).length} paths for ${want[k]} incidents`);
  check("AI flow ribbons stay in their box", flow.inside && flow.h > 100, `height ${flow.h}`);
  const weak = await evaluate(client, `(() => { const u = document.querySelectorAll('[data-weak] .ascii-units > i'); return { n: u.length, red: [...u].filter((i) => i.classList.contains('red')).length }; })()`);
  check("weak link: a square per CVE, the exploited ones red", weak.n === panel.ai.weak.cves && weak.red === panel.ai.weak.exploited, `${weak.n} squares, ${weak.red} red; panel.json ${panel.ai.weak.cves}/${panel.ai.weak.exploited}`);

  // the sieve
  const sieve = await evaluate(client, `Object.fromEntries([...document.querySelectorAll('[data-stage]')].map((s) => [s.dataset.stage, s.querySelector('[data-num]')?.textContent ?? '']))`);
  check("sieve published", num(sieve.published) === home.counters.cves_7d, `${sieve.published} vs ${home.counters.cves_7d}`);
  check("sieve critical", num(sieve.critical) === home.counters.critical_7d, `${sieve.critical} vs ${home.counters.critical_7d}`);
  check("sieve known exploited", num(sieve["known-exploited"]) === home.counters.kev_7d, `${sieve["known-exploited"]} vs ${home.counters.kev_7d}`);
  check("sieve in your stack is the verdict's", num(sieve["in-your-stack"]) === panel.verdict.inStack && v?.stack === panel.verdict.inStack, `${sieve["in-your-stack"]} vs ${panel.verdict.inStack}`);
  if (home.counters.cves_7d !== null) {
    const r = await openAndRead(client, '[data-stage="published"] button');
    check("sieve published opens its list", r.count === home.counters.cves_7d && r.rows > 0 && r.closed, `count line "${r.head?.slice(0, 40)}", ${r.rows} rows`);
  }
  if (home.counters.kev_7d) {
    const r = await openAndRead(client, '[data-stage="known-exploited"] button');
    check("sieve known exploited opens its list", r.count === home.counters.kev_7d && r.rows === home.counters.kev_7d && r.closed, `count line "${r.head?.slice(0, 40)}", ${r.rows} rows`);
  }

  // the footer
  const foot = await evaluate(client, `[...document.querySelectorAll('[data-panel-foot] a')].map((a) => a.getAttribute('href'))`);
  check("footer links", ["/feed.xml", "/feed.json", "/changes.json", "/llms.txt", "/live.json", "/stats/home.json", "/data", "/live"].every((h) => foot.includes(h)), `${foot.length} links`);

  // the hero cluster beside the globe: the counters' numbers, drawn
  const cl = await evaluate(client, `Object.fromEntries([...document.querySelectorAll('[data-tile][data-value]')].map((e) => [e.dataset.tile, { value: e.dataset.value === "" ? null : Number(e.dataset.value), w: e.getBoundingClientRect().width }]))`);
  check("hero cluster shows four tiles", ["due", "open", "cves", "breached"].every((k) => cl[k]?.w > 100), JSON.stringify(Object.fromEntries(Object.entries(cl).map(([k, t]) => [k, Math.round(t.w)]))));
  check("cluster New CVEs is the 24 h counter", cl.cves?.value === home.counters.cves_24h, `tile ${cl.cves?.value}, home.json ${home.counters.cves_24h}`);
  check("cluster Breached is the accounts counter", cl.breached?.value === home.counters.breached_accounts_month, `tile ${cl.breached?.value}, home.json ${home.counters.breached_accounts_month}`);
  await sleep(2500);
  const inked = await evaluate(client, `(() => {
    const c = document.querySelector('[data-tile="due"]')?.parentElement?.parentElement?.querySelector("canvas");
    if (!c || !c.width) return 0;
    const px = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i] > 40) n++;
    return n;
  })()`);
  check("hero cluster draws", inked > 2000, `${inked} inked pixels`);
  if (home.counters.breaches_month !== null) {
    const r = await openAndRead(client, `[data-tile="breached"]`);
    check("cluster Breached opens the month's breaches", r.count === home.counters.breaches_month && r.closed, `count line "${r.head?.slice(0, 50)}", expected ${home.counters.breaches_month}`);
  }

  // a shared stack link applies, stores and recomputes
  const picks = stackFile.candidates.filter((c) => c.kev7.length).slice(0, 1).concat(stackFile.candidates.filter((c) => !c.kev7.length).slice(0, 1)).map((c) => c.key);
  await navigate(client, `${base}/?final&stack=${picks.join(",")},not-a-product`, `${HOME_READY} && document.querySelector('[data-tiles][data-stack="ready"]')`);
  const shared = await evaluate(client, `({ tiles: [...document.querySelectorAll('[data-stack-tile]')].map((t) => t.dataset.stackTile), stored: localStorage.getItem("gcd-radar:stack"), verdict: Number(document.querySelector('[data-verdict]').dataset.stackMatch), sieve: document.querySelector('[data-stage="in-your-stack"] [data-num]')?.textContent, hidden: document.documentElement.classList.contains("stack-custom") })`);
  const expectMatch = stackMatches(stackFile, picks).length;
  check("?stack= applies the picks", shared.tiles.join(",") === picks.join(","), `${shared.tiles.join(",")} for ${picks.join(",")}`);
  check("?stack= stores the picks", shared.stored === picks.join(","), String(shared.stored));
  check("a shared stack recomputes the verdict and the sieve", shared.verdict === expectMatch && num(shared.sieve) === expectMatch && !shared.hidden, `verdict ${shared.verdict}, sieve ${shared.sieve}, expected ${expectMatch}`);
  await navigate(client, `${base}/?final`, `${HOME_READY} && document.querySelector('[data-tiles][data-stack="ready"]')`);
  const kept = await evaluate(client, `[...document.querySelectorAll('[data-stack-tile]')].map((t) => t.dataset.stackTile).join(",")`);
  check("the stored stack comes back without the link", kept === picks.join(","), kept);
  await evaluate(client, `localStorage.removeItem("gcd-radar:stack")`);

  // motion: on by default, off under reduced motion
  await navigate(client, `${base}/`, `document.querySelector('[data-verdict][data-built]')`);
  const on = await evaluate(client, `({ motion: document.documentElement.classList.contains("motion"), waiting: document.querySelectorAll('[data-build]:not([data-built])').length })`);
  check("motion is on by default and builds on scroll", on.motion && on.waiting > 0, JSON.stringify(on));
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
  const live = await evaluate(client, `({ marker: document.querySelector('[data-stage="published"]')?.textContent.includes("NVD · live"), cves: Number(document.querySelector('[data-verdict]').dataset.cves) })`);
  check("live layer: the live marker or the built numbers", live.marker ? live.cves > 0 : live.cves === home.counters.cves_24h, JSON.stringify(live));
  await blockHosts(client, [WORKER]);
}

async function checkTrends(client, base, home) {
  await client.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await navigate(client, `${base}/trends`, TRENDS_READY);

  const counters = await evaluate(client, `Object.fromEntries([...document.querySelectorAll('[data-counter]')].map((e) => [e.dataset.counter, e.dataset.value === "" ? null : Number(e.dataset.value)]))`);
  for (const key of ["cves_24h", "cves_7d", "critical_7d", "kev_7d", "breached_accounts_month", "live"]) {
    check(`trends counter ${key}`, counters[key] === home.counters[key], `page ${counters[key]}, home.json ${home.counters[key]}`);
  }
  const expectations = { cves_24h: home.counters.cves_24h, cves_7d: home.counters.cves_7d, critical_7d: home.counters.critical_7d, kev_7d: home.counters.kev_7d, breached_accounts_month: home.counters.breaches_month };
  for (const [key, expected] of Object.entries(expectations)) {
    if (expected === null) continue;
    const r = await openAndRead(client, `button[data-counter="${key}"]`);
    check(`trends counter ${key} opens its list`, r.count === expected && r.rows > 0 && r.locked && r.closed, `count line "${r.head?.slice(0, 50)}", ${r.rows} rows, expected ${expected}`);
  }
  const day = await openAndRead(client, `button[data-counter="cves_24h"]`);
  check("the 24-hour list is complete", day.rows === home.counters.cves_24h, `${day.rows} rows, counter ${home.counters.cves_24h}`);

  const kevLast = home.series.kev_by_month[home.series.kev_by_month.length - 1];
  const kev = await openAndRead(client, `[data-chart="kev-by-month"] rect[role="button"]`, -1);
  check(`KEV column ${kevLast.month} opens its additions`, kev.count === kevLast.total && kev.rows === Math.min(kevLast.total, 200), `${kev.label} → "${kev.head?.slice(0, 40)}", ${kev.rows} rows`);
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
    await checkTrends(client, site.base, home);
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
