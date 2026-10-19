import type { AsciiScene, FieldBuffers, FieldPointer } from "../AsciiField";

/** Palette slots used by this scene: structure (blue-grey), lit (amber), hot (cream), faint, agent (cyan). */
export const SWARM_TONES = { structure: 0, lit: 1, hot: 2, faint: 3, agent: 4 } as const;

const TAU = Math.PI * 2;
const c = (s: string) => s.charCodeAt(0);
const G = {
  dot: c("."),
  mid: c("·"),
  dash: c("-"),
  pipe: c("|"),
  slash: c("/"),
  back: c("\\"),
  plus: c("+"),
  star: c("*"),
  at: c("@"),
  o: c("o"),
  lpar: c("("),
  rpar: c(")"),
  gt: c(">"),
  lt: c("<"),
  caret: c("^"),
  v: c("v"),
  tilde: c("~"),
  eq: c("="),
  colon: c(":"),
};

/** The tools the agents call, drawn as [name] boxes around the hub. */
const TOOL_NAMES = ["db", "web", "shell", "mail", "api", "vault", "mcp", "files", "cron", "git"];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Slope glyph for a direction in screen space (y down). */
function slopeGlyph(dx: number, dy: number): number {
  let a = Math.atan2(dy, dx);
  if (a < 0) a += Math.PI;
  if (a < Math.PI / 8 || a > (7 * Math.PI) / 8) return G.dash;
  if (a < (3 * Math.PI) / 8) return G.back;
  if (a < (5 * Math.PI) / 8) return G.pipe;
  return G.slash;
}

const IDLE = 0;
const SEEK = 1;
const WORK = 2;
const REPORT = 3;

interface Agent {
  x: number;
  y: number;
  vx: number;
  vy: number;
  state: number;
  /** tool index while seeking or working */
  target: number;
  /** when the current state ends (idle wait, work) */
  until: number;
  phase: number;
  /** time of the last beam pass, for the flash */
  pinged: number;
  born: number;
}

interface Tool {
  x: number;
  y: number;
  name: string;
  /** time of the last call */
  hot: number;
}

/** A glyph travelling from a to b; bouncing packets go there and back. */
interface Packet {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  t0: number;
  dur: number;
  glyph: number;
  tone: number;
  bounce: boolean;
}

interface Link {
  agent: number;
  tool: number;
  until: number;
}

interface Flash {
  x: number;
  y: number;
  t0: number;
}

/**
 * "Agent swarm": a radar at the hub, tools around it, and a swarm of agents
 * that wake, seek a tool, call it along a dotted line with a packet going
 * there and back, carry the result home to the hub and go idle again, some
 * of them respawning elsewhere. The beam lights every agent it passes; the
 * pointer gathers the agents near it and turns them hot.
 */
export function agentSwarm({ origin = [0.7, 0.5], seed = 11, period = 7, agents: wanted = 0 }: { origin?: [number, number]; seed?: number; period?: number; agents?: number } = {}): AsciiScene {
  let W = 0;
  let H = 0;
  let OX = 0;
  let OY = 0;
  let R = 0;
  let FAR = 0;
  let cw = 8;
  let ch = 14;
  let cols = 0;
  let rows = 0;
  let rnd = mulberry32(seed);
  let agents: Agent[] = [];
  let tools: Tool[] = [];
  let packets: Packet[] = [];
  let links: Link[] = [];
  let flashes: Flash[] = [];
  let theta = new Float32Array(0);
  let radius = new Float32Array(0);
  let ring = new Uint8Array(0);
  let dust = new Float32Array(0);
  let originCell = -1;
  let lastT = 0;
  let lastChat = 0;
  const omega = TAU / period;

  const cellAt = (x: number, y: number) => {
    const cx = Math.floor(x / cw);
    const cy = Math.floor(y / ch);
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return -1;
    return cy * cols + cx;
  };
  /** Writes a cell when it would be brighter than what is there. */
  const put = (b: FieldBuffers, i: number, L: number, T: number, Gl: number) => {
    if (i < 0 || i >= b.lum.length) return;
    if (L > b.lum[i]!) {
      b.lum[i] = Math.min(1, L);
      b.tone[i] = T;
      b.glyph[i] = Gl;
    }
  };
  /** Writes a run of glyphs starting at a point. */
  const putText = (b: FieldBuffers, x: number, y: number, text: string, L: number, T: number) => {
    const i0 = cellAt(x, y);
    if (i0 < 0) return;
    const cx = i0 % cols;
    for (let k = 0; k < text.length; k++) {
      if (cx + k >= cols) break;
      put(b, i0 + k, L, T, text.charCodeAt(k));
    }
  };
  const dotted = (b: FieldBuffers, x0: number, y0: number, x1: number, y1: number, L: number, T: number, Gl: number) => {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(d / (Math.min(cw, ch) * 0.9)));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      put(b, cellAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t), L, T, Gl || slopeGlyph(x1 - x0, y1 - y0));
    }
  };
  const since = (th: number, phi: number) => {
    let d = phi - th;
    d %= TAU;
    return d < 0 ? d + TAU : d;
  };
  /** Agents live to the right of the headline, inside the field. */
  const bounds = () => ({ x0: W * 0.3, x1: W * 0.97, y0: H * 0.05, y1: H * 0.95 });
  const spawn = (t: number, atEdge: boolean): Agent => {
    const bb = bounds();
    let x = bb.x0 + rnd() * (bb.x1 - bb.x0);
    let y = bb.y0 + rnd() * (bb.y1 - bb.y0);
    if (atEdge) {
      const side = rnd();
      if (side < 0.35) x = bb.x1;
      else if (side < 0.7) y = rnd() < 0.5 ? bb.y0 : bb.y1;
      else x = bb.x0;
    }
    return { x, y, vx: (rnd() - 0.5) * 20, vy: (rnd() - 0.5) * 20, state: IDLE, target: -1, until: t + 0.3 + rnd() * 2.5, phase: rnd() * TAU, pinged: -9, born: t };
  };

  return {
    resize(b: FieldBuffers, w: number, h: number) {
      W = w;
      H = h;
      OX = w * origin[0];
      OY = h * origin[1];
      R = Math.min(h * 0.92, w * 0.5);
      FAR = Math.max(Math.hypot(OX, OY), Math.hypot(w - OX, OY), Math.hypot(OX, h - OY), Math.hypot(w - OX, h - OY));
      cw = b.cw;
      ch = b.ch;
      cols = b.cols;
      rows = b.rows;
      rnd = mulberry32(seed);

      // tools: spread around the hub, apart from each other and off the headline on the left
      tools = [];
      const want = Math.min(TOOL_NAMES.length, Math.max(4, Math.round(w / 170)));
      for (let tries = 0; tries < 600 && tools.length < want; tries++) {
        const a = rnd() * TAU;
        const rr = R * (0.38 + 0.6 * rnd());
        const x = OX + Math.cos(a) * rr;
        const y = OY + Math.sin(a) * rr;
        if (x < w * 0.36 || x > w * 0.94 || y < h * 0.08 || y > h * 0.92) continue;
        if (tools.some((tl) => Math.hypot(tl.x - x, tl.y - y) < Math.max(76, R * 0.34))) continue;
        tools.push({ x, y, name: TOOL_NAMES[tools.length]!, hot: -9 });
      }
      const count = wanted || Math.max(12, Math.min(56, Math.round((w * h) / 15000)));
      agents = [];
      for (let i = 0; i < count; i++) agents.push(spawn(0, false));
      packets = [];
      links = [];
      flashes = [];

      // per-cell geometry for the dial: bearing, range, rings, dust
      const n = cols * rows;
      theta = new Float32Array(n);
      radius = new Float32Array(n);
      ring = new Uint8Array(n);
      dust = new Float32Array(n);
      const ringR = [R * 0.25, R * 0.5, R * 0.75, R];
      for (let i = 0; i < n; i++) {
        const cx = (i % cols) * cw + cw / 2 - OX;
        const cy = Math.floor(i / cols) * ch + ch / 2 - OY;
        theta[i] = Math.atan2(cy, cx);
        const r = Math.hypot(cx, cy);
        radius[i] = r;
        for (let k = 0; k < ringR.length; k++) if (Math.abs(r - ringR[k]!) < ch * 0.42) ring[i] = k + 1;
        if (rnd() < 0.04) dust[i] = 0.5 + rnd() * TAU;
      }
      originCell = cellAt(OX, OY);
      lastT = 0;
    },

    frame(b: FieldBuffers, t: number, ptr: FieldPointer) {
      const dt = Math.min(0.05, Math.max(0, t - lastT));
      lastT = t;
      const { lum, tone, glyph } = b;
      const n = lum.length;
      const phi = (t * omega) % TAU;
      const reveal = t < 1.5 ? FAR * (1 - Math.pow(1 - t / 1.5, 3)) : Infinity;

      // --- the dial: dust, range rings, the beam's wash and leading edge
      for (let i = 0; i < n; i++) {
        const r = radius[i]!;
        if (r > reveal) continue;
        let L = 0;
        let T: number = SWARM_TONES.faint;
        let Gl = 0;
        const d = since(theta[i]!, phi);
        const wash = d < 1.2 ? Math.exp(-d / 0.3) : 0;
        const dp = dust[i]!;
        if (dp) {
          L = 0.04 + 0.035 * Math.sin(t * 1.6 + dp);
          Gl = G.dot;
        }
        const rg = ring[i]!;
        if (rg) {
          L = Math.max(L, (rg === 4 ? 0.13 : 0.065) + 0.3 * wash);
          Gl = rg === 4 ? G.mid : G.dot;
          T = wash > 0.35 ? SWARM_TONES.lit : SWARM_TONES.faint;
        }
        if (wash > 0.06 && r < FAR) {
          const edge = d < 0.035;
          const wl = (edge ? 0.6 : 0.14 * wash) * (r < R ? 1 : 0.5);
          if (wl > L) {
            L = wl;
            Gl = edge ? slopeGlyph(Math.cos(theta[i]!), Math.sin(theta[i]!)) : 0;
            T = edge && r < R ? SWARM_TONES.hot : SWARM_TONES.lit;
          }
        }
        if (reveal !== Infinity && Math.abs(r - reveal) < ch * 0.6) {
          L = Math.max(L, 0.55);
          T = SWARM_TONES.lit;
          Gl = 0;
        }
        if (L > 0) {
          lum[i] = Math.min(1, L);
          tone[i] = T;
          glyph[i] = Gl;
        }
      }

      // --- simulate the swarm
      const bb = bounds();
      for (let ai = 0; ai < agents.length; ai++) {
        const a = agents[ai]!;
        // the pointer gathers the agents near it
        if (ptr.on) {
          const d = Math.hypot(ptr.x - a.x, ptr.y - a.y);
          if (d < 170 && d > 24) {
            a.vx += ((ptr.x - a.x) / d) * 110 * dt;
            a.vy += ((ptr.y - a.y) / d) * 110 * dt;
          }
        }
        // the beam pings every agent it passes
        const bearing = Math.atan2(a.y - OY, a.x - OX);
        if (since(bearing, phi) < 0.05 && t - a.pinged > 1) a.pinged = t;

        if (a.state === IDLE) {
          a.vx *= 0.985;
          a.vy *= 0.985;
          if (t > a.until && tools.length) {
            // pick one of the three nearest tools
            const near = tools.map((tl, i) => ({ i, d: Math.hypot(tl.x - a.x, tl.y - a.y) })).sort((p, q) => p.d - q.d);
            a.target = near[Math.min(near.length - 1, Math.floor(rnd() * 3))]!.i;
            a.state = SEEK;
          }
        } else if (a.state === SEEK) {
          const tl = tools[a.target]!;
          const d = Math.hypot(tl.x - a.x, tl.y - a.y) || 1;
          const sp = 44;
          a.vx += (((tl.x - a.x) / d) * sp - a.vx) * 2.2 * dt;
          a.vy += (((tl.y - a.y) / d) * sp - a.vy) * 2.2 * dt;
          if (d < 22) {
            a.state = WORK;
            a.until = t + 1.1 + rnd() * 1.6;
            tl.hot = t;
            links.push({ agent: ai, tool: a.target, until: a.until });
            packets.push({ ax: a.x, ay: a.y, bx: tl.x, by: tl.y, t0: t, dur: 0.55, glyph: G.star, tone: SWARM_TONES.hot, bounce: true });
          }
        } else if (a.state === WORK) {
          a.vx *= 0.85;
          a.vy *= 0.85;
          if (t > a.until) a.state = REPORT;
        } else {
          const d = Math.hypot(OX - a.x, OY - a.y) || 1;
          const sp = 62;
          a.vx += (((OX - a.x) / d) * sp - a.vx) * 2.4 * dt;
          a.vy += (((OY - a.y) / d) * sp - a.vy) * 2.4 * dt;
          if (d < 44) {
            packets.push({ ax: a.x, ay: a.y, bx: OX, by: OY, t0: t, dur: 0.35, glyph: G.star, tone: SWARM_TONES.hot, bounce: false });
            if (rnd() < 0.3) {
              // done: respawn somewhere else with a flash
              flashes.push({ x: a.x, y: a.y, t0: t });
              agents[ai] = spawn(t, true);
              flashes.push({ x: agents[ai]!.x, y: agents[ai]!.y, t0: t + 0.1 });
              continue;
            }
            a.state = IDLE;
            a.until = t + 0.8 + rnd() * 2.6;
            a.vx = -((OX - a.x) / d) * 26 + (rnd() - 0.5) * 12;
            a.vy = -((OY - a.y) / d) * 26 + (rnd() - 0.5) * 12;
          }
        }
        // speed cap and soft walls
        const v = Math.hypot(a.vx, a.vy);
        if (v > 90) {
          a.vx *= 90 / v;
          a.vy *= 90 / v;
        }
        if (a.x < bb.x0) a.vx += 40 * dt;
        if (a.x > bb.x1) a.vx -= 40 * dt;
        if (a.y < bb.y0) a.vy += 40 * dt;
        if (a.y > bb.y1) a.vy -= 40 * dt;
        a.x += a.vx * dt;
        a.y += a.vy * dt;
      }
      // now and then an idle agent messages a neighbour
      if (t - lastChat > 0.45 && agents.length > 1) {
        lastChat = t;
        const a = agents[Math.floor(rnd() * agents.length)]!;
        if (a.state === IDLE) {
          let best: Agent | null = null;
          let bd = 190;
          for (const o of agents) {
            if (o === a || o.state !== IDLE) continue;
            const d = Math.hypot(o.x - a.x, o.y - a.y);
            if (d > 40 && d < bd) {
              bd = d;
              best = o;
            }
          }
          if (best) packets.push({ ax: a.x, ay: a.y, bx: best.x, by: best.y, t0: t, dur: 0.5 + bd / 400, glyph: best.x >= a.x ? G.gt : G.lt, tone: SWARM_TONES.agent, bounce: false });
        }
      }
      links = links.filter((l) => l.until > t);
      packets = packets.filter((p) => t - p.t0 < p.dur * (p.bounce ? 2 : 1));
      flashes = flashes.filter((f) => t - f.t0 < 0.5 && t >= f.t0);

      // --- tools: [name] boxes, warm while being called
      for (const tl of tools) {
        const heat = Math.max(0, 1 - (t - tl.hot) / 1.4);
        const text = `[${tl.name}]`;
        putText(b, tl.x - (text.length * cw) / 2, tl.y, text, 0.42 + 0.58 * heat, heat > 0.3 ? SWARM_TONES.lit : SWARM_TONES.structure);
      }
      // --- calls in flight: dotted lines from agent to tool
      for (const l of links) {
        const a = agents[l.agent];
        const tl = tools[l.tool];
        if (!a || !tl || a.state !== WORK) continue;
        dotted(b, a.x, a.y, tl.x, tl.y, 0.3, SWARM_TONES.structure, G.mid);
      }
      // --- packets
      for (const p of packets) {
        let u = (t - p.t0) / p.dur;
        if (p.bounce) u = u <= 1 ? u : 2 - u;
        u = Math.max(0, Math.min(1, u));
        put(b, cellAt(p.ax + (p.bx - p.ax) * u, p.ay + (p.by - p.ay) * u), 1, p.tone, p.glyph);
      }
      // --- flashes: a spawn or a finish
      for (const f of flashes) {
        const k = (t - f.t0) / 0.5;
        const i = cellAt(f.x, f.y);
        put(b, i, 1 - k, SWARM_TONES.hot, k < 0.5 ? G.star : G.plus);
        if (k > 0.25) {
          put(b, i - 1, (1 - k) * 0.7, SWARM_TONES.lit, G.dash);
          put(b, i + 1, (1 - k) * 0.7, SWARM_TONES.lit, G.dash);
        }
      }
      // --- agents: ( core ) with the core telling the state
      for (const a of agents) {
        const i = cellAt(a.x, a.y);
        if (i < 0 || radius[i]! > reveal) continue;
        const pinged = Math.max(0, 1 - (t - a.pinged) / 0.9);
        let near = 0;
        if (ptr.on) {
          const d = Math.hypot(ptr.x - a.x, ptr.y - a.y);
          if (d < 170) near = 1 - d / 170;
        }
        const pulse = 0.5 + 0.5 * Math.sin(t * 6 + a.phase);
        let core = G.mid;
        if (a.state === SEEK) core = Math.abs(a.vx) > Math.abs(a.vy) ? (a.vx > 0 ? G.gt : G.lt) : a.vy > 0 ? G.v : G.caret;
        else if (a.state === WORK) core = pulse > 0.5 ? G.at : G.o;
        else if (a.state === REPORT) core = G.star;
        if (near > 0.45) core = G.at;
        const base = a.state === IDLE ? 0.5 : a.state === WORK ? 0.65 + 0.3 * pulse : 0.66;
        const speed = Math.hypot(a.vx, a.vy);
        if (speed > 18) {
          // a short trail behind a moving agent
          for (let k = 1; k <= 3; k++) {
            const bx = a.x - (a.vx / speed) * cw * (k + 0.8);
            const by = a.y - (a.vy / speed) * ch * (k + 0.8) * 0.9;
            put(b, cellAt(bx, by), 0.26 - k * 0.06, SWARM_TONES.faint, G.mid);
          }
        }
        const L = Math.min(1, base + 0.6 * pinged + 0.65 * near);
        const T: number = near > 0.2 || pinged > 0.6 ? SWARM_TONES.hot : pinged > 0 ? SWARM_TONES.lit : a.state === WORK ? SWARM_TONES.lit : SWARM_TONES.agent;
        put(b, i, L, T, core);
        const cx = i % cols;
        if (cx > 0) put(b, i - 1, L * 0.8, near > 0.2 ? SWARM_TONES.hot : SWARM_TONES.structure, near > 0.2 ? G.lt : G.lpar);
        if (cx < cols - 1) put(b, i + 1, L * 0.8, near > 0.2 ? SWARM_TONES.hot : SWARM_TONES.structure, near > 0.2 ? G.gt : G.rpar);
      }
      // --- the hub: a crosshair that blinks, and incoming reports light its arms
      if (originCell >= 0) {
        const blink = 0.7 + 0.3 * Math.sin(t * 5);
        lum[originCell] = blink;
        tone[originCell] = SWARM_TONES.hot;
        glyph[originCell] = G.plus;
        for (const [di, g] of [
          [-1, G.dash],
          [1, G.dash],
          [-cols, G.pipe],
          [cols, G.pipe],
        ] as const) {
          const k = originCell + di;
          if (k >= 0 && k < n) {
            lum[k] = Math.max(lum[k]!, 0.45);
            tone[k] = SWARM_TONES.lit;
            glyph[k] = g;
          }
        }
        for (const [di, g] of [
          [-2, G.lpar],
          [2, G.rpar],
        ] as const) {
          const k = originCell + di;
          if (k >= 0 && k < n && lum[k]! < 0.3) {
            lum[k] = 0.3;
            tone[k] = SWARM_TONES.structure;
            glyph[k] = g;
          }
        }
      }
    },
  };
}
