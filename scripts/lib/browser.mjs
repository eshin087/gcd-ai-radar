/**
 * The browser harness the check scripts share: a static file server for the
 * export, headless Chrome or Edge over the DevTools protocol with Node's
 * WebSocket, and a few page helpers. Zero dependencies.
 */
import { spawn } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

const TYPES = { ".html": "text/html; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".xml": "application/xml", ".woff2": "font/woff2", ".ttf": "font/ttf", ".ico": "image/x-icon", ".csv": "text/csv" };

export function parseArgs(argv) {
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
export function serve(dir, port) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const rel = decodeURIComponent(url.pathname);
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
      }
    }
    res.writeHead(404, { "content-type": "text/plain" }).end(`not found: ${rel}`);
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, port: server.address().port })));
}

export function findBrowser(explicit) {
  if (explicit) return explicit;
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

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Launches the browser headless with a fresh profile and returns a DevTools client bound to its first page. */
export async function launch(explicitBrowser) {
  const exe = findBrowser(explicitBrowser);
  const profile = await fs.mkdtemp(path.join(tmpdir(), "radar-check-"));
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

export async function evaluate(client, expression) {
  const r = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`page script failed: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ""}`.slice(0, 500));
  return r.result.value;
}

/** Navigates and waits for the load event, then for `readyExpression` (a page expression) to be truthy, up to ten seconds. */
export async function navigate(client, url, readyExpression = "true") {
  const loaded = new Promise((resolve) => client.on("Page.loadEventFired", resolve));
  await client.send("Page.navigate", { url });
  await loaded;
  for (let i = 0; i < 100; i++) {
    if (await evaluate(client, `Boolean(${readyExpression})`)) break;
    await sleep(100);
  }
  await sleep(300);
}

/** Collects page exceptions and console.error calls for the run. */
export function collectErrors(client) {
  const errors = [];
  client.on("Runtime.exceptionThrown", (p) => errors.push(`exception: ${p.exceptionDetails.exception?.description ?? p.exceptionDetails.text}`.slice(0, 300)));
  client.on("Runtime.consoleAPICalled", (p) => {
    if (p.type === "error") errors.push(`console.error: ${p.args.map((a) => a.value ?? a.description).join(" ")}`.slice(0, 300));
  });
  return errors;
}

/** Serves ./out unless --url is given; returns the base URL and a closer. */
export async function openSite(args) {
  const dir = path.resolve(args.dir ?? "out");
  if (args.url) return { base: String(args.url).replace(/\/$/, ""), close: () => undefined };
  if (!existsSync(path.join(dir, "index.html"))) throw new Error(`${dir}/index.html not found; run "npm run build" first or pass --url`);
  const s = await serve(dir, Number(args.port ?? 0));
  return { base: `http://127.0.0.1:${s.port}`, close: () => s.server.close() };
}
