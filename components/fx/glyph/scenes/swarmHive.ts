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
  vec3 col = starfield(.003)*.45;
  // a faint floor disc under the hive
  if(rd.y < 0.){
    vec3 p = ro + rd*(-(ro.y + .55)/rd.y);
    float r = length(p.xz);
    float rings = pow(abs(sin(r*6.)), 40.)*smoothstep(3.2, 1., r);
    col += vec3(.15, .35, .8)*rings*.25;
  }
  col += core(ro, rd, .38, uHot, uPulse);
  col += attacks(ro, rd) + flashes(ro, rd);
  outCol(col);
}
`;

const TOOLS = ["MCP server", "browser", "code runner", "email", "vector DB", "files"];
const PER_LANE = 14;
const SPEED = 0.13;

interface Lane {
  a: V3;
  c: V3;
  b: V3;
}

/**
 * Agent swarm, hive at work: agents run ordered lanes between the
 * orchestrator and six tools, out in cyan and home in amber with the result.
 * Attacks from the 90-day feed land on a tool: most are filtered there, but
 * at the type's real harm rate the tool is hijacked, red runs back along its
 * lane, and a quarantine gate seals the lane until it is clean.
 */
export function swarmHive({ intel, emit }: { intel: ThreatIntel; emit?: Emit }): GlyphController {
  const feed = threatFeed(intel, 41);
  const rnd = feed.rnd;
  const bolts = new Bolts();
  const flashes = new Flashes();
  const pts = new PointBuf(1400);
  const tools: V3[] = TOOLS.map((_, i) => {
    const a = (i / TOOLS.length) * Math.PI * 2 + 0.3;
    return [Math.cos(a) * 2.3, 0.1 * Math.sin(a * 3), Math.sin(a) * 1.75];
  });
  const lanes = tools.map((tp) => {
    const dir = v3.norm(tp);
    const side = v3.norm([-dir[2], 0, dir[0]]);
    const a = v3.mul(dir, 0.46);
    const mid = v3.mix(a, tp, 0.5);
    const out: Lane = { a, c: v3.add(mid, v3.add([0, 0.42, 0], v3.mul(side, 0.18))), b: tp };
    const home: Lane = { a: tp, c: v3.add(mid, v3.add([0, -0.3, 0], v3.mul(side, -0.18))), b: a };
    return { out, home };
  });
  const at = (l: Lane, u: number): V3 => {
    const w = 1 - u;
    return [w * w * l.a[0] + 2 * w * u * l.c[0] + u * u * l.b[0], w * w * l.a[1] + 2 * w * u * l.c[1] + u * u * l.b[1], w * w * l.a[2] + 2 * w * u * l.c[2] + u * u * l.b[2]];
  };
  let cam: Cam = swayCam(0, [0, -0.1, 0], 5, 2.5);
  let next = 2.5;
  let pulse = -9;
  /** the lane under attack: when it was hit, and when it was sealed */
  let attack: { bolt: ReturnType<Bolts["add"]>; tool: number; hit: number } | null = null;
  const toolHot = new Float32Array(TOOLS.length).fill(-9);

  return {
    frag: FRAG,
    fovY: 38,
    shift: 0.42,
    frame(f, set) {
      const t = f.t;
      cam = swayCam(t, [0, -0.1, 0], 5, 2.5, 0.2, 0.16, 0.04);
      if (t > next && !attack) {
        const ev = feed.next();
        const tool = Math.floor(rnd() * tools.length);
        const s = attackStart(rnd, cam, 6.2);
        const bolt = bolts.add(ev, s, tools[tool]!, t, 1.8 + rnd() * 0.5);
        attack = { bolt, tool, hit: -1 };
        emit?.(ev, false);
        next = t + 5.5 + rnd() * 2.5;
      }
      if (attack) {
        const { bolt, tool } = attack;
        if (attack.hit < 0 && bolts.u(bolt, t) >= 1) {
          attack.hit = t;
          bolt.done = true;
          toolHot[tool] = t;
          if (bolt.ev.fate === "breach") {
            flashes.add(tools[tool]!, t, [1, 0.3, 0.2], 0.3);
          } else {
            flashes.add(tools[tool]!, t, [0.45, 0.85, 1], 0.35);
            emit?.(bolt.ev, true, bolt.ev.fate === "intercepted" ? "INTERCEPTED" : "FILTERED");
            attack = null;
          }
        } else if (attack.hit > 0 && t - attack.hit > 4.2) {
          flashes.add(v3.mul(v3.norm(tools[tool]!), 0.75), t, [0.45, 0.85, 1], 0.3);
          emit?.(bolt.ev, true, "HIJACKED · LANE SEALED");
          attack = null;
        }
      }

      pts.reset();
      const sinceHit = attack && attack.hit > 0 ? t - attack.hit : -1;
      lanes.forEach((l, li) => {
        const infected = attack?.tool === li && sinceHit >= 0;
        // red runs home along the lane from the tool; the gate near the core stops it
        const front = infected ? Math.max(0.16, 1 - sinceHit / 2) : 2;
        const sealed = infected && sinceHit > 1.2;
        for (let k = 0; k < 26; k++) {
          const u = k / 25;
          pts.add(at(l.out, u), 0.018, CYAN, 0.28);
          pts.add(at(l.home, u), 0.018, infected && 1 - u >= front ? RED : AMBER, infected && 1 - u >= front ? 0.5 : 0.22);
        }
        for (let j = 0; j < PER_LANE; j++) {
          const u = (t * SPEED + j / PER_LANE + li * 0.137) % 1;
          if (!(sealed && u < 0.1)) pts.add(at(l.out, u), 0.042, CYAN, 1.9);
          const back = 1 - u;
          const red = infected && back >= front;
          // sealed: red agents stop at the gate and burn out there
          if (sealed && red && back < 0.18) continue;
          pts.add(at(l.home, u), 0.042, red ? RED : AMBER, red ? 3.4 + Math.sin(t * 18 + j) : 2.2);
        }
        if (sealed) {
          const g = at(l.home, 0.86);
          const dir = v3.norm(v3.sub(at(l.home, 0.9), at(l.home, 0.82)));
          const s1 = v3.norm([-dir[2], 0, dir[0]]);
          for (let k = 0; k < 14; k++) {
            const a = (k / 14) * Math.PI * 2 + t * 2;
            pts.add(v3.add(g, v3.add(v3.mul(s1, Math.cos(a) * 0.16), [0, Math.sin(a) * 0.16, 0])), 0.022, WHITE, 1.8);
          }
        }
      });
      tools.forEach((tp, i) => {
        const h = Math.max(0, 1 - (t - toolHot[i]!) / 1.2);
        const bad = attack?.tool === i && sinceHit >= 0;
        pts.add(tp, 0.1, bad ? RED : WHITE, 1.6 + 2 * h);
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + t * 0.6;
          pts.add(v3.add(tp, [Math.cos(a) * 0.17, Math.sin(a) * 0.05, Math.sin(a) * 0.17]), 0.02, bad ? RED : CYAN, 1.2);
        }
      });
      // a returning agent pulses the core
      if (Math.floor(t * SPEED * PER_LANE) !== Math.floor((t - f.dt) * SPEED * PER_LANE)) pulse = t;
      setCam(set, cam);
      set.f("uHot", 0);
      set.f("uPulse", Math.max(0, 1 - (t - pulse) / 0.4) * 0.5);
      bolts.pack(t, set);
      flashes.pack(t, set);
      set.points(pts.data, pts.n, cam);
    },
    labels(f) {
      if (f.narrow) return [];
      return tools
        .map((p, i) => {
          const s = projectPoint(p, cam, f);
          return s ? { text: `[ ${TOOLS[i]} ]`, x: s.x, y: s.y + 12, tone: attack?.tool === i && attack.hit > 0 ? "hot" : "dim", anchor: "middle" as const } : null;
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
    },
  };
}
