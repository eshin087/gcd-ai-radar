import type { ThreatIntel } from "@/lib/threatIntel";
import { projectPoint, type Cam, type GlyphController, type V3 } from "../engine";
import { threatFeed } from "../feed";
import { AMBER, attackStart, Bolts, CYAN, Flashes, KIT_GLSL, PointBuf, RED, setCam, swayCam, v3, WHITE, type Emit } from "./kit";

const FRAG =
  KIT_GLSL +
  `
uniform float uHot;
uniform float uPulse;
void main(){
  vec3 ro = uEye;
  vec3 rd = camRay(lookAt(ro, uTarget));
  vec3 col = starfield(.003)*.5;
  col += core(ro, rd, .42, uHot, uPulse);
  col += attacks(ro, rd) + flashes(ro, rd);
  outCol(col);
}
`;

const TOOLS = ["MCP server", "browser", "code runner", "email", "vector DB"];

interface Agent {
  p: V3;
  v: V3;
  /** 0 flock, 1 to a tool, 2 back to the core, 3 hijacked, 4 caging */
  mode: number;
  tool: number;
  /** caged around this agent */
  cage: number;
  until: number;
}

/**
 * Agent swarm, murmuration: agents flock around an orchestrator core like
 * starlings, and streams of them peel off to fetch from tools and bring the
 * result home (amber). Attacks come from the 90-day feed: at their type's
 * real harm rate one agent is hijacked (red), its nearest neighbours close a
 * cage around it and it is purged; otherwise a squad intercepts the attack
 * or the core's shield blocks it.
 */
export function swarmMurmuration({ intel, emit }: { intel: ThreatIntel; emit?: Emit }): GlyphController {
  const feed = threatFeed(intel, 31);
  const rnd = feed.rnd;
  const bolts = new Bolts();
  const flashes = new Flashes();
  let agents: Agent[] = [];
  const pts = new PointBuf(900);
  const tools: V3[] = TOOLS.map((_, i) => {
    const a = (i / TOOLS.length) * Math.PI * 2 + 0.4;
    return [Math.cos(a) * 2.35, (i % 2 ? 0.55 : -0.45) * 0.9, Math.sin(a) * 2.35];
  });
  let cam: Cam = swayCam(0, [0, 0, 0], 5.2, 1.3);
  let nextTask = 1.5;
  let nextAttack = 2;
  let hot = -9;
  let pulse = -9;
  let target: { bolt: ReturnType<Bolts["add"]>; agent: number; squad: number[] } | null = null;
  let ready = false;

  const spawn = (n: number) => {
    agents = [];
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 0.9 + rnd() * 0.9;
      agents.push({ p: [Math.cos(a) * r, (rnd() - 0.5) * 0.9, Math.sin(a) * r], v: [-Math.sin(a) * 0.5, 0, Math.cos(a) * 0.5], mode: 0, tool: -1, cage: -1, until: 0 });
    }
  };
  const nearest = (p: V3, k: number, skip = -1, modes = [0]) =>
    agents
      .map((a, i) => ({ i, d: v3.len(v3.sub(a.p, p)) }))
      .filter((x) => x.i !== skip && modes.includes(agents[x.i]!.mode))
      .sort((a, b) => a.d - b.d)
      .slice(0, k)
      .map((x) => x.i);
  const steer = (a: Agent, to: V3, speed: number, k: number, dt: number) => {
    const d = v3.sub(to, a.p);
    const want = v3.mul(v3.norm(d), speed);
    a.v = v3.add(a.v, v3.mul(v3.sub(want, a.v), Math.min(1, k * dt)));
  };

  return {
    frag: FRAG,
    fovY: 38,
    shift: 0.42,
    frame(f, set) {
      const t = f.t;
      const dt = Math.min(0.05, f.dt || 1 / 60);
      if (!ready) {
        spawn(f.narrow ? 170 : 380);
        ready = true;
      }
      cam = swayCam(t, [0, 0, 0], 5.2, 1.3, 0.25, 0.18, 0.04);
      // the attractor drifts round the core, so the flock wheels and folds
      const att: V3 = [Math.cos(t * 0.23) * 1.35, Math.sin(t * 0.31) * 0.45, Math.sin(t * 0.23 + 0.6) * 1.35];

      // a stream of agents peels off to a tool
      if (t > nextTask) {
        const ti = Math.floor(rnd() * tools.length);
        for (const i of nearest(tools[ti]!, 16)) {
          const a = agents[i]!;
          a.mode = 1;
          a.tool = ti;
        }
        nextTask = t + 2.2 + rnd() * 1.6;
      }
      // an attack from the feed
      if (t > nextAttack && !target) {
        const ev = feed.next();
        const s = attackStart(rnd, cam, 6.5);
        const victim = nearest(v3.mul(v3.norm(s), 1.2), 1)[0] ?? 0;
        const e = ev.fate === "blocked" ? v3.mul(v3.norm(s), 0.55) : agents[victim]!.p;
        const bolt = bolts.add(ev, s, e, t, 1.8 + rnd() * 0.4);
        target = { bolt, agent: victim, squad: [] };
        emit?.(ev, false);
        nextAttack = t + 5.5 + rnd() * 2.5;
      }
      if (target) {
        const { bolt } = target;
        const ev = bolt.ev;
        const u = bolts.u(bolt, t);
        if (ev.fate !== "blocked" && bolt.hit < 0) bolt.e = agents[target.agent]!.p.slice() as V3;
        if (ev.fate === "intercepted" && u > 0.35 && target.squad.length === 0) {
          target.squad = nearest(bolts.head(bolt, t), 9);
          for (const i of target.squad) agents[i]!.mode = 4;
        }
        if (ev.fate === "intercepted" && target.squad.length) {
          const head = bolts.head(bolt, t);
          for (const i of target.squad) steer(agents[i]!, head, 2.4, 6, dt);
          const close = target.squad.some((i) => v3.len(v3.sub(agents[i]!.p, head)) < 0.12);
          if (close || u >= 1) {
            flashes.add(head, t, [0.6, 0.9, 1], 0.24);
            for (const i of target.squad) agents[i]!.mode = 0;
            bolt.done = true;
            emit?.(ev, true, "INTERCEPTED");
            target = null;
          }
        } else if (u >= 1 && bolt.hit < 0) {
          bolt.hit = t;
          if (ev.fate === "blocked") {
            flashes.add(bolt.e, t, [0.4, 0.85, 1], 0.5);
            pulse = t;
            bolt.done = true;
            emit?.(ev, true, "BLOCKED");
            target = null;
          } else {
            // hijacked: the agent turns, its neighbours close a cage
            const a = agents[target.agent]!;
            a.mode = 3;
            a.until = t + 3.2;
            flashes.add(a.p, t, [1, 0.3, 0.2], 0.18);
            bolt.done = true;
            target.squad = nearest(a.p, 12, target.agent);
            for (const i of target.squad) {
              agents[i]!.mode = 4;
              agents[i]!.cage = target.agent;
            }
            hot = t;
            emit?.(ev, false, undefined);
          }
        }
        if (target && bolt.hit > 0 && t > agents[target.agent]!.until) {
          const a = agents[target.agent]!;
          flashes.add(a.p, t, [1, 0.45, 0.3], 0.35);
          a.mode = 0;
          a.p = [0, 0, 0];
          a.v = [(rnd() - 0.5) * 0.6, 0.4, (rnd() - 0.5) * 0.6];
          for (const i of target.squad) {
            agents[i]!.mode = 0;
            agents[i]!.cage = -1;
          }
          emit?.(bolt.ev, true, "HIJACKED · PURGED");
          target = null;
        }
      }

      // flocking: separation, alignment, cohesion, plus the attractor and a swirl round the core
      const n = agents.length;
      for (let i = 0; i < n; i++) {
        const a = agents[i]!;
        if (a.mode === 1) {
          steer(a, tools[a.tool]!, 1.5, 3, dt);
          if (v3.len(v3.sub(a.p, tools[a.tool]!)) < 0.18) a.mode = 2;
        } else if (a.mode === 2) {
          steer(a, [0, 0, 0], 1.4, 3, dt);
          if (v3.len(a.p) < 0.6) {
            a.mode = 0;
            pulse = t;
          }
        } else if (a.mode === 3) {
          // the hijacked agent jitters inside its cage
          a.v = v3.add(v3.mul(a.v, 0.85), [(rnd() - 0.5) * 0.6, (rnd() - 0.5) * 0.6, (rnd() - 0.5) * 0.6]);
        } else if (a.mode === 4 && a.cage >= 0) {
          const c = agents[a.cage]!.p;
          const off = v3.norm(v3.sub(a.p, c));
          steer(a, v3.add(c, v3.mul(off, 0.2)), 1.6, 8, dt);
        } else if (a.mode === 0) {
          let sep: V3 = [0, 0, 0];
          let ali: V3 = [0, 0, 0];
          let coh: V3 = [0, 0, 0];
          let cn = 0;
          for (let j = 0; j < n; j++) {
            if (j === i) continue;
            const b = agents[j]!;
            const dx = b.p[0] - a.p[0];
            const dy = b.p[1] - a.p[1];
            const dz = b.p[2] - a.p[2];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 > 0.12) continue;
            if (d2 < 0.012) sep = v3.sub(sep, [dx / (d2 + 1e-3), dy / (d2 + 1e-3), dz / (d2 + 1e-3)]);
            ali = v3.add(ali, b.v);
            coh = v3.add(coh, b.p);
            cn++;
          }
          let acc: V3 = v3.mul(sep, 0.004);
          if (cn) {
            acc = v3.add(acc, v3.mul(v3.sub(v3.mul(ali, 1 / cn), a.v), 1.2));
            acc = v3.add(acc, v3.mul(v3.sub(v3.mul(coh, 1 / cn), a.p), 0.9));
          }
          acc = v3.add(acc, v3.mul(v3.sub(att, a.p), 0.55));
          acc = v3.add(acc, v3.mul([-a.p[2], 0, a.p[0]], 0.35));
          const r = v3.len(a.p);
          if (r < 0.75) acc = v3.add(acc, v3.mul(v3.norm(a.p), (0.75 - r) * 6));
          if (r > 2.1) acc = v3.add(acc, v3.mul(v3.norm(a.p), -(r - 2.1) * 2));
          a.v = v3.add(a.v, v3.mul(acc, dt));
        }
        const sp = v3.len(a.v);
        const max = a.mode === 0 ? 0.95 : 2.4;
        if (sp > max) a.v = v3.mul(a.v, max / sp);
        if (a.mode === 0 && sp < 0.35) a.v = v3.mul(v3.norm(a.v), 0.35);
        a.p = v3.add(a.p, v3.mul(a.v, dt));
      }

      pts.reset();
      for (const a of agents) {
        const col = a.mode === 3 ? RED : a.mode === 2 ? AMBER : a.mode === 4 ? WHITE : CYAN;
        const k = a.mode === 3 ? 5 + Math.sin(t * 20) * 1.5 : a.mode === 2 ? 3 : a.mode === 4 ? 2.6 : 1.9;
        pts.add(a.p, 0.045, col, k);
      }
      tools.forEach((p) => pts.add(p, 0.07, WHITE, 1.4));
      setCam(set, cam);
      set.f("uHot", Math.max(0, 1 - (t - hot) / 1.2));
      set.f("uPulse", Math.max(0, 1 - (t - pulse) / 0.6));
      bolts.pack(t, set);
      flashes.pack(t, set);
      set.points(pts.data, pts.n, cam);
    },
    labels(f) {
      if (f.narrow) return [];
      return tools
        .map((p, i) => {
          const s = projectPoint(p, cam, f);
          return s ? { text: `[ ${TOOLS[i]} ]`, x: s.x, y: s.y + 10, tone: "dim", anchor: "middle" as const } : null;
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
    },
  };
}
