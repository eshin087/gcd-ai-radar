import type { ThreatIntel } from "@/lib/threatIntel";
import { projectPoint, type Cam, type GlyphController, type V3 } from "../engine";
import { threatFeed } from "../feed";
import { AMBER, attackStart, Bolts, CYAN, Flashes, KIT_GLSL, PointBuf, RED, setCam, swayCam, v3, type Emit } from "./kit";

const FRAG =
  KIT_GLSL +
  `
uniform vec4 uNode[9];
uniform vec4 uNodeC[9];
uniform vec4 uEA[16];
uniform vec4 uEB[16];

void main(){
  vec3 ro = uEye;
  vec3 rd = camRay(lookAt(ro, uTarget));
  vec3 col = starfield(.003)*.45;
  // the links: thin lines with a soft glow; red when they carry a hijack, dashed and fading when cut
  for(int i = 0; i < 16; i++){
    vec4 a = uEA[i];
    vec4 b = uEB[i];
    if(b.w <= 0.) continue;
    float s;
    float d2 = segDist2(ro, rd, a.xyz, b.xyz, s);
    vec3 c = a.w > 1.5 ? vec3(1., .3, .2) : a.w > .5 ? vec3(1., .3, .2) : vec3(.3, .7, 1.);
    float dash = a.w > 1.5 ? step(.5, fract(s*14. - uTime*2.)) : 1.;
    col += c*(exp(-d2/.00018)*.9 + exp(-d2/.004)*.12)*b.w*dash;
  }
  // the agents: glassy orbs with a bright heart
  for(int i = 0; i < 9; i++){
    vec4 n = uNode[i];
    vec3 c = uNodeC[i].rgb;
    float k = uNodeC[i].a;
    col += c*pointGlow(ro, rd, n.xyz, n.w*.45)*1.6*k + c*pointGlow(ro, rd, n.xyz, n.w*1.8)*.12*k;
    vec2 h = sphIsect(ro, rd, n.xyz, n.w);
    if(h.x > 0.){
      vec3 nn = normalize(ro + rd*h.x - n.xyz);
      float fr = pow(1. - abs(dot(nn, rd)), 2.);
      col += c*fr*1.2*k;
    }
  }
  col += attacks(ro, rd) + flashes(ro, rd);
  outCol(col);
}
`;

const NAMES = ["orchestrator", "planner", "researcher", "browser", "MCP tools", "coder", "executor", "memory", "critic"];
/** where each agent sits, before the constellation turns */
const HOME: V3[] = [
  [0, 0, 0],
  [0.1, 1.05, 0.25],
  [-1.25, 0.55, -0.35],
  [-1.75, -0.35, 0.35],
  [-0.85, -1.0, -0.25],
  [1.3, 0.6, 0.2],
  [1.7, -0.4, -0.35],
  [0.55, -1.05, 0.55],
  [0.4, 0.1, -1.35],
];
const EDGES: [number, number][] = [
  [0, 1],
  [0, 2],
  [0, 3],
  [0, 4],
  [0, 5],
  [0, 6],
  [0, 7],
  [0, 8],
  [1, 5],
  [1, 2],
  [2, 3],
  [3, 4],
  [5, 6],
  [8, 5],
  [7, 1],
  [6, 4],
];

/**
 * Agent constellation: an orchestrator and eight named agents passing
 * messages along glowing links, the whole graph slowly turning. Attacks from
 * the 90-day feed hit an agent: its shield turns most away, and at the type's
 * real harm rate the agent is hijacked, sends red messages, and the
 * orchestrator cuts its links until it is restored.
 */
export function agentConstellation({ intel, emit }: { intel: ThreatIntel; emit?: Emit }): GlyphController {
  const feed = threatFeed(intel, 71);
  const rnd = feed.rnd;
  const bolts = new Bolts();
  const flashes = new Flashes();
  const pts = new PointBuf(300);
  const pos: V3[] = HOME.map((p) => p.slice() as V3);
  const nodeU = new Float32Array(36);
  const nodeC = new Float32Array(36);
  const ea = new Float32Array(64);
  const eb = new Float32Array(64);
  let msgs: { e: number; fwd: boolean; t0: number; dur: number; red: boolean }[] = [];
  let nextMsg = 0;
  let next = 2.5;
  let cam: Cam = swayCam(0, [0, 0, 0], 5.6, 0.9);
  /** the agent under attack and when it was hijacked */
  let attack: { bolt: ReturnType<Bolts["add"]>; node: number; hit: number } | null = null;
  const nodeHot = new Float32Array(9).fill(-9);

  return {
    frag: FRAG,
    fovY: 38,
    shift: 0.42,
    frame(f, set) {
      const t = f.t;
      cam = swayCam(t, [0, 0, 0], 5.6, 0.9, 0.2, 0.12, 0.04);
      const spin = t * 0.07;
      const c = Math.cos(spin);
      const s = Math.sin(spin);
      HOME.forEach((h, i) => {
        const bob = i ? Math.sin(t * 0.8 + i) * 0.04 : 0;
        pos[i] = [c * h[0] - s * h[2], h[1] + bob, s * h[0] + c * h[2]];
      });
      const hijacked = attack && attack.hit > 0 ? attack.node : -1;
      const cut = hijacked >= 0 && t - attack!.hit > 1.2;

      if (t > next && !attack) {
        const ev = feed.next();
        const node = 1 + Math.floor(rnd() * 8);
        attack = { bolt: bolts.add(ev, attackStart(rnd, cam, 6.4), pos[node]!, t, 1.8 + rnd() * 0.4), node, hit: -1 };
        emit?.(ev, false);
        next = t + 6 + rnd() * 2.5;
      }
      if (attack) {
        const { bolt, node } = attack;
        if (attack.hit < 0) {
          bolt.e = pos[node]!;
          if (bolts.u(bolt, t) >= 1) {
            bolt.done = true;
            nodeHot[node] = t;
            if (bolt.ev.fate === "breach") {
              attack.hit = t;
              flashes.add(pos[node]!, t, [1, 0.3, 0.2], 0.3);
            } else {
              flashes.add(pos[node]!, t, [0.45, 0.85, 1], 0.32);
              emit?.(bolt.ev, true, bolt.ev.fate === "intercepted" ? "INTERCEPTED" : "BLOCKED");
              attack = null;
            }
          }
        } else if (t - attack.hit > 4.8) {
          flashes.add(pos[node]!, t, [0.45, 0.9, 1], 0.4);
          emit?.(bolt.ev, true, "HIJACKED · ISOLATED");
          attack = null;
        }
      }

      // messages: requests out, answers back, none across a cut link
      if (t > nextMsg) {
        const e = Math.floor(rnd() * EDGES.length);
        const [a, b] = EDGES[e]!;
        const touches = hijacked >= 0 && (a === hijacked || b === hijacked);
        if (!(touches && cut)) {
          const fwd = rnd() < 0.5;
          msgs.push({ e, fwd, t0: t, dur: 0.9 + rnd() * 0.6, red: touches && (fwd ? a : b) === hijacked });
        }
        nextMsg = t + 0.07 + rnd() * 0.1;
      }
      msgs = msgs.filter((m) => t - m.t0 < m.dur);

      pts.reset();
      for (const m of msgs) {
        const [a, b] = EDGES[m.e]!;
        const u = (t - m.t0) / m.dur;
        const from = m.fwd ? pos[a]! : pos[b]!;
        const to = m.fwd ? pos[b]! : pos[a]!;
        pts.add(v3.mix(from, to, u), 0.035, m.red ? RED : m.fwd ? CYAN : AMBER, m.red ? 3.4 : 2.4);
      }
      // a ring of light round the orchestrator
      for (let k = 0; k < 18; k++) {
        const a = (k / 18) * Math.PI * 2 + t * 0.8;
        pts.add([Math.cos(a) * 0.36, Math.sin(a * 2) * 0.03, Math.sin(a) * 0.36], 0.018, AMBER, 1.1);
      }
      for (let i = 0; i < 9; i++) {
        const h = Math.max(0, 1 - (t - nodeHot[i]!) / 1);
        const bad = i === hijacked;
        const col = bad ? RED : i === 0 ? ([1, 0.78, 0.5] as V3) : CYAN;
        nodeU.set([...pos[i]!, i === 0 ? 0.24 : 0.12], i * 4);
        nodeC.set([...col, (bad ? 1.6 + 0.6 * Math.sin(t * 14) : 1) + h], i * 4);
      }
      EDGES.forEach(([a, b], i) => {
        const touches = hijacked >= 0 && (a === hijacked || b === hijacked);
        const state = touches ? (cut ? 2 : 1) : 0;
        const fade = touches && cut ? Math.max(0.15, 1 - (t - attack!.hit - 1.2) / 2) : 1;
        ea.set([...pos[a]!, state], i * 4);
        eb.set([...pos[b]!, (a === 0 ? 0.55 : 0.4) * fade], i * 4);
      });
      setCam(set, cam);
      set.v4v("uNode", nodeU);
      set.v4v("uNodeC", nodeC);
      set.v4v("uEA", ea);
      set.v4v("uEB", eb);
      bolts.pack(t, set);
      flashes.pack(t, set);
      set.points(pts.data, pts.n, cam);
    },
    labels(f) {
      if (f.narrow) return [];
      return pos
        .map((p, i) => {
          const s = projectPoint(p, cam, f);
          const bad = attack && attack.hit > 0 && attack.node === i;
          return s ? { text: i === 0 ? "orchestrator" : NAMES[i]!, x: s.x, y: s.y + (i === 0 ? 26 : 14), tone: bad ? "hot" : i === 0 ? "accent" : "dim", anchor: "middle" as const } : null;
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
    },
  };
}
