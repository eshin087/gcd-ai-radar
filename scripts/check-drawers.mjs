#!/usr/bin/env node
/**
 * Clicks the dashboard's numbers in a real browser and checks that each one
 * opens a drawer listing exactly that many incidents. The unit test
 * (tests/aggregates.test.ts) proves the arithmetic; this proves the wiring:
 * aggregates in the page, year shards fetched on demand, the drawer's count.
 *
 * Zero dependencies: serves the static export itself and drives headless
 * Chrome or Edge over the DevTools protocol with Node's WebSocket.
 *
 *   npm run build
 *   node scripts/check-drawers.mjs                 # serves ./out on a free port, runs the checks
 *   node scripts/check-drawers.mjs --url https://gcd-ai-radar.vercel.app
 *   node scripts/check-drawers.mjs --serve --port 4173   # only serve ./out (for a manual look)
 *
 * Options: --dir <out dir>  --browser <chrome or edge executable>  --port <n>  --verbose
 */
import { spawn } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const verbose = Boolean(args.verbose);

const TYPES = { ".html": "text/html; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".xml": "application/xml", ".woff2": "font/woff2", ".ttf": "font/ttf", ".ico": "image/x-icon", ".csv": "text/csv" };

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[a.slice(2)] = next;
      i += 1;
    } else out[a.slice(2)] = true;
  }
  return out;
}

/** A static file server for a Next.js export: /incidents -> incidents.html, directories -> index.html. */
function serve(dir, port) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    let rel = decodeURIComponent(url.pathname);
    if (rel.includes("..")) return res.writeHead(400).end();
    const candidates = [rel, `${rel}.html`, path.posix.join(rel, "index.html")].map((p) => path.join(dir, p));
    for (const file of candidates) {
      let handle;
      try {
        handle = await fs.open(file);
        const stat = await handle.stat();
        if (!stat.isFile()) {
          await handle.close();
          continue;
        }
        res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "content-length": stat.size, "cache-control": "no-store" });
        return handle.createReadStream().pipe(res);
      } catch {
        await handle?.close().catch(() => undefined);
        // try the next candidate
      }
    }
    res.writeHead(404, { "content-type": "text/plain" }).end(`not found: ${rel}`);
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, port: server.address().port })));
}

function findBrowser() {
  if (args.browser) return args.browser;
  const env = process.env.CHROME_PATH || process.env.EDGE_PATH;
  if (env) return env;
  const local = process.env.LOCALAPPDATA ?? "";
  const candidates = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    `${local}/Google/Chrome/Application/chrome.exe`,
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
  ];
  const found = candidates.find((c) => c && existsSync(c));
  if (!found) throw new Error("no Chrome or Edge found; pass --browser <path> or set CHROME_PATH");
  return found;
}

/** Launches the browser headless with a fresh profile and returns a DevTools client bound to its first page. */
async function launch() {
  const exe = findBrowser();
  const profile = await fs.mkdtemp(path.join(tmpdir(), "radar-drawers-"));
  const proc = spawn(exe, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--window-size=1440,900", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = "";
    const t = setTimeout(() => reject(new Error(`browser did not announce DevTools: ${buf.slice(0, 300)}`)), 20000);
    proc.stderr.on("data", (d) => {
      buf += d.toString();
      const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (m) {
        clearTimeout(t);
        resolve(m[1]);
      }
    });
    proc.on("exit", (code) => reject(new Error(`browser exited with ${code}: ${buf.slice(0, 300)}`)));
  });
  const origin = wsUrl.replace(/^ws:\/\//, "http://").replace(/\/devtools\/.*$/, "");
  let targets = [];
  for (let i = 0; i < 20 && !targets.some((t) => t.type === "page"); i++) {
    targets = await fetch(`${origin}/json/list`).then((r) => r.json());
    if (!targets.some((t) => t.type === "page")) await sleep(100);
  }
  const page = targets.find((t) => t.type === "page");
  if (!page) throw new Error("no page target");
  const client = await connect(page.webSocketDebuggerUrl);
  const close = async () => {
    try {
      client.ws.close();
    } catch {
      // already closed
    }
    proc.kill();
    await sleep(200);
    await fs.rm(profile, { recursive: true, force: true }).catch(() => undefined);
  };
  return { client, close, exe };
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const waiting = new Map();
    const listeners = new Map();
    let id = 0;
    ws.addEventListener("open", () => resolve({ ws, send, on }));
    ws.addEventListener("error", (e) => reject(new Error(`websocket: ${e.message ?? e}`)));
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && waiting.has(msg.id)) {
        const { res, rej } = waiting.get(msg.id);
        waiting.delete(msg.id);
        if (msg.error) rej(new Error(`${msg.error.message} (${msg.error.code})`));
        else res(msg.result);
      } else if (msg.method) for (const cb of listeners.get(msg.method) ?? []) cb(msg.params);
    });
    function send(method, params = {}) {
      id += 1;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((res, rej) => waiting.set(id, { res, rej }));
    }
    function on(method, cb) {
      if (!listeners.has(method)) listeners.set(method, []);
      listeners.get(method).push(cb);
    }
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evaluate(client, expression) {
  const r = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`page script failed: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ""}`.slice(0, 500));
  return r.result.value;
}

async function navigate(client, url) {
  const loaded = new Promise((resolve) => client.on("Page.loadEventFired", resolve));
  await client.send("Page.navigate", { url });
  await loaded;
  // hydration: wait for the hero number to be a button with a count
  for (let i = 0; i < 100; i++) {
    const ok = await evaluate(client, `!!document.querySelector('button[aria-label*="open the list"]')`);
    if (ok) break;
    await sleep(100);
  }
  await sleep(600);
  // the "more" fold (the flow, the bot traffic) is closed on load; open it so its numbers are probed too
  await evaluate(client, `document.querySelectorAll("details").forEach((d) => { d.open = true; })`);
  await sleep(300);
}

/** Runs in the page: clicks a number, waits for its drawer to settle, reads the drawer's count, closes it. */
const PROBE = `
async function probe(spec) {
  const el = document.querySelectorAll(spec.selector)[spec.index ?? 0];
  if (!el) return { error: "no element for " + spec.selector + (spec.index ? "[" + spec.index + "]" : "") };
  const label = el.getAttribute("aria-label") || el.textContent.trim();
  // the number shown: after the colon in an aria-label ("Trailing 12 months: 456, open the list"), else the first number, else the .num span
  const numText = spec.numFrom === "num" ? el.querySelector(".num")?.textContent : (label.match(/:\\s*(\\d[\\d,]*)/) || label.match(/(\\d[\\d,]*)/) || [])[1];
  const shown = numText == null ? null : Number(String(numText).replace(/,/g, ""));
  el.scrollIntoView({ block: "center" });
  // dispatched, not el.click(): the monthly columns are SVG rects with role=button.
  // clickAt places the click along the element's width (a sparkline picks its month by x).
  const box = el.getBoundingClientRect();
  const at = spec.clickAt == null ? {} : { clientX: box.left + Math.min(box.width - 1, box.width * spec.clickAt), clientY: box.top + box.height / 2 };
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...at }));
  const t0 = Date.now();
  let text = "";
  while (Date.now() - t0 < 10000) {
    const d = document.querySelector('[role="dialog"]');
    text = d?.querySelector("p.num")?.textContent ?? "";
    const m = text.match(/^(\\d+)\\s/);
    if (d && m) {
      const out = { label, shown, drawer: Number(m[1]), title: d.querySelector("h2")?.textContent, items: d.querySelectorAll("ol > li").length, scrollLocked: getComputedStyle(document.documentElement).overflow === "hidden" };
      return out;
    }
    if (text.startsWith("could not")) return { label, shown, error: text };
    await new Promise((r) => setTimeout(r, 40));
  }
  return { label, shown, error: "drawer did not settle: " + text };
}
`;

async function probe(client, spec) {
  const result = await evaluate(client, `${PROBE}; probe(${JSON.stringify(spec)})`);
  // close with Escape, the keyboard path, and confirm the page scrolls again
  await client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  for (let i = 0; i < 50; i++) {
    const closed = await evaluate(client, `!document.querySelector('[role="dialog"]') && getComputedStyle(document.documentElement).overflow !== "hidden"`);
    if (closed) return { ...result, closed: true };
    await sleep(40);
  }
  return { ...result, closed: false };
}

async function toggle(client, group, option) {
  // values travel URI-encoded: the encoding emits no quote, backslash or newline, so the literal below is always well formed
  const ok = await evaluate(
    client,
    `((group, option) => { const g = document.querySelector('[role="radiogroup"][aria-label="' + CSS.escape(group) + '"]'); const b = g && [...g.querySelectorAll('[role="radio"]')].find((x) => x.textContent.trim() === option); if (!b) return false; b.click(); return true; })(decodeURIComponent("${encodeURIComponent(group)}"), decodeURIComponent("${encodeURIComponent(option)}"))`,
  );
  if (!ok) throw new Error(`no toggle ${group} / ${option}`);
  await sleep(250);
}

/** Every kind of clickable number on the dashboard. The first number after a colon in the aria-label is what it shows. */
const PROBES = [
  { name: "hero total", selector: 'button[aria-label*="incidents in the"][aria-label*="open the list"]' },
  { name: "hero real-world", selector: 'button[aria-label$="real-world incidents"]' },
  { name: "hero disclosed", selector: 'button[aria-label$="disclosed vulnerabilities"]' },
  { name: "tile this month", selector: 'button[aria-label*=" so far:"]' },
  { name: "tile trailing 12", selector: 'button[aria-label^="Trailing 12 months:"]' },
  { name: "tile year to date", selector: 'button[aria-label^="Year to date:"]' },
  { name: "tile real-world in view", selector: 'button[aria-label^="Real-world in view:"]' },
  { name: "family infra", selector: 'button[aria-label^="Infrastructure vulnerabilities:"]' },
  { name: "family injection", selector: 'button[aria-label^="Prompt injection & jailbreaks:"]' },
  { name: "type attack on AI", selector: 'button[aria-label^="Attack on AI:"]' },
  { name: "type AI-enabled", selector: 'button[aria-label^="AI-enabled attack:"]' },
  { name: "target framework", selector: 'button[aria-label^="Framework / tooling:"]' },
  // section 02: a family's month, clicked at the right end of its sparkline (the newest month with a count)
  { name: "family sparkline month", selector: '[data-chart="family-rows"] svg[role="button"]:not([aria-label$=": 0 incidents"])', index: 0, clickAt: 1 },
  // the movers' dumbbells, only when the window has a window before it (not for "All")
  { name: "dumbbell before", selector: '[data-chart="dumbbell"] button[aria-label*=" months before:"]', index: 0, optional: true },
  { name: "dumbbell now", selector: '[data-chart="dumbbell"] button[aria-label$=" incidents"]:not([aria-label*=" months before:"])', index: 0, optional: true },
  // section 03: the radar's labels, the harm bars and the target bars
  { name: "radar label", selector: '[data-chart="radar"] button[aria-label$=" incidents"]', index: 0 },
  { name: "harm segment", selector: '[data-chart="harm-bars"] button[aria-label*=", severity "]', index: 0 },
  // not in the real-world-only view, which has no severity 1-2 incidents
  { name: "harm segment, not yet harmful", selector: '[data-chart="harm-bars"] button[aria-label*=", severity 1 "]', index: 0, optional: true },
  { name: "harm family total", selector: '[data-chart="harm-bars"] li button[aria-label$=" incidents"]:not([aria-label*=", severity "])', index: 1 },
  { name: "harm severity total", selector: '[data-chart="harm-bars"] button[aria-label^="Severity 3:"]' },
  { name: "target next row", selector: '[data-chart="target-bars"] li:nth-child(2) button[data-total]' },
  { name: "target top family", selector: '[data-chart="target-bars"] button[aria-label*=" on "]', index: 0 },
  { name: "target second family", selector: '[data-chart="target-bars"] li:nth-child(2) button[aria-label*=" on "]', index: 1, optional: true },
  { name: "target also hit", selector: '[data-chart="target-bars"] p button[data-total]', index: 0, optional: true },
  // section 05: attacked products (attacks and their CVEs) and the agentic watch
  { name: "stack attacks", selector: '[data-chart="stack"] button[aria-label$=" incidents"]', index: 0, optional: true },
  { name: "stack CVEs", selector: '[data-chart="stack"] button[aria-label$=" disclosed vulnerabilities"]', index: 0, optional: true },
  { name: "agentic all", selector: '[data-chart="agentic"] button[aria-label^="Incidents involving AI agents:"]', optional: true },
  { name: "agentic slice", selector: '[data-chart="agentic"] button[aria-label$=" incidents"]', index: 1, optional: true },
  { name: "agent tooling CVEs", selector: '[data-chart="agentic"] button[aria-label^="CVEs disclosed in agent tooling:"]' },
  // section 06: the standards
  { name: "owasp entry", selector: '[data-chart="owasp"] button[aria-label$=" incidents"]', index: 0, optional: true },
  { name: "owasp any", selector: 'button[aria-label^="Mapped to the OWASP list:"]' },
  { name: "atlas technique", selector: '[data-chart="atlas"] button[aria-label$=" incidents"]', index: 0, optional: true },
  { name: "tile disclosed in view", selector: 'button[aria-label^="Disclosed in view:"]' },
  { name: "tile busiest day", selector: 'button[aria-label^="Busiest day:"]' },
  { name: "product top bar", selector: 'section#disclosed button[aria-label$=", open the list"]:not([aria-label^="Disclosed in view"]):not([aria-label^="Busiest day"])' },
];

/** Monthly columns are many; probe the two newest with a count, in the trend chart and the disclosed chart. */
const COLUMN_PROBES = `
(() => {
  const pick = (root) => [...root.querySelectorAll('svg [role="button"][aria-label$=" incidents"]')].filter((b) => !/: 0 incidents$/.test(b.getAttribute("aria-label"))).slice(-2).map((b) => b.getAttribute("aria-label"));
  const trend = document.querySelector("section#trend");
  const disclosed = document.querySelector("section#disclosed");
  return { trend: trend ? pick(trend) : [], disclosed: disclosed ? pick(disclosed) : [] };
})()
`;

async function runChecks(client, base) {
  const results = [];
  const errors = [];
  client.on("Runtime.exceptionThrown", (p) => errors.push(`exception: ${p.exceptionDetails.exception?.description ?? p.exceptionDetails.text}`.slice(0, 300)));
  client.on("Runtime.consoleAPICalled", (p) => {
    if (p.type === "error") errors.push(`console.error: ${p.args.map((a) => a.value ?? a.description).join(" ")}`.slice(0, 300));
  });
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  const views = [
    { name: "default (all incidents, incident date, 24m)", setup: async () => {} },
    { name: "window All", setup: async () => toggle(client, "Window", "All") },
    { name: "window 12m, first reported", setup: async () => { await toggle(client, "Window", "12m"); await toggle(client, "Date basis", "First reported"); } },
    { name: "real-world only, 36m", setup: async () => { await toggle(client, "Incident set", "Real-world only"); await toggle(client, "Window", "36m"); } },
  ];

  for (const view of views) {
    await navigate(client, `${base}/`);
    await view.setup();
    const columns = await evaluate(client, COLUMN_PROBES);
    // the calendar view of the trend panel: the first day with a count (only days with a count are buttons)
    await toggle(client, "Trend view", "Calendar");
    const hasDay = await evaluate(client, `Boolean(document.querySelector('section#trend rect[role="button"]'))`);
    if (hasDay) {
      const r = await probe(client, { selector: 'section#trend rect[role="button"]', index: 0 });
      const ok = !r.error && r.shown !== null && r.shown === r.drawer && r.closed;
      results.push({ view: view.name, name: "calendar day", ok, ...r });
      if (verbose || !ok) console.log(`${ok ? "ok  " : "FAIL"} ${view.name} · calendar day: ${r.error ?? `shows ${r.shown}, drawer ${r.drawer}, closed ${r.closed}`}`);
    }
    await toggle(client, "Trend view", "Per month");
    const probes = [
      ...PROBES,
      ...columns.trend.map((label) => ({ name: `column ${label.split(":")[0]}`, selector: `section#trend [aria-label="${label}"]` })),
      ...columns.disclosed.map((label) => ({ name: `disclosed column ${label.split(":")[0]}`, selector: `section#disclosed [aria-label="${label}"]` })),
    ];
    for (const p of probes) {
      const r = await probe(client, { selector: p.selector, index: p.index, numFrom: p.numFrom, clickAt: p.clickAt });
      if (p.optional && r.error?.startsWith("no element")) continue;
      const ok = !r.error && r.shown !== null && r.shown === r.drawer && r.closed;
      results.push({ view: view.name, name: p.name, ok, ...r });
      if (verbose || !ok) console.log(`${ok ? "ok  " : "FAIL"} ${view.name} · ${p.name}: ${r.error ?? `shows ${r.shown}, drawer ${r.drawer} (${r.items} listed${r.items < r.drawer ? ", paged" : ""}), closed ${r.closed}`}`);
    }
  }
  return { results, errors };
}

async function main() {
  const dir = path.resolve(args.dir ?? "out");
  if (args.serve) {
    const { port } = await serve(dir, Number(args.port ?? 4173));
    console.log(`serving ${dir} at http://127.0.0.1:${port}/ (Ctrl+C to stop)`);
    return;
  }
  let base = args.url;
  let server = null;
  if (!base) {
    if (!existsSync(path.join(dir, "index.html"))) throw new Error(`${dir}/index.html not found; run "npm run build" first or pass --url`);
    const s = await serve(dir, Number(args.port ?? 0));
    server = s.server;
    base = `http://127.0.0.1:${s.port}`;
  }
  const t0 = Date.now();
  const { client, close, exe } = await launch();
  try {
    const { results, errors } = await runChecks(client, base.replace(/\/$/, ""));
    const failed = results.filter((r) => !r.ok);
    const byView = new Map();
    for (const r of results) byView.set(r.view, (byView.get(r.view) ?? 0) + 1);
    console.log(`\n${results.length - failed.length}/${results.length} numbers open a drawer with the same count (${[...byView].map(([v, n]) => `${v}: ${n}`).join("; ")}) in ${((Date.now() - t0) / 1000).toFixed(1)} s · ${path.basename(exe)} · ${base}`);
    if (errors.length) console.log(`page errors (${errors.length}):\n  ${[...new Set(errors)].slice(0, 10).join("\n  ")}`);
    if (failed.length || errors.length) process.exitCode = 1;
  } finally {
    await close();
    server?.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
