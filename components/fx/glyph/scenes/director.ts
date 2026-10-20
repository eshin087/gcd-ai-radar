import type { ThreatIntel } from "@/lib/threatIntel";
import { threatFeed, type FeedEvent } from "../feed";

export type Phase = "calm" | "probe" | "skirmish" | "war" | "aftermath";

/** What the director wants on screen this frame. */
export interface Wave {
  /** single attacks starting now (one feed event each) */
  attacks: FeedEvent[];
  /** an enemy agent swarm starting now: one feed event for the whole swarm, and how many agents it brings */
  swarm: { ev: FeedEvent; size: number } | null;
}

/** Seconds into the cycle where each phase starts (scaled by the cycle length). */
const PLAN: [Phase, number][] = [
  ["calm", 0],
  ["probe", 0.14],
  ["skirmish", 0.3],
  ["war", 0.55],
  ["aftermath", 0.82],
];
/** mean seconds between bursts, and how many attacks a burst holds (min, max) */
const RATE: Record<Phase, { gap: number; burst: [number, number] }> = {
  calm: { gap: 4.5, burst: [1, 1] },
  probe: { gap: 2.6, burst: [1, 2] },
  skirmish: { gap: 1.8, burst: [1, 3] },
  war: { gap: 1.1, burst: [2, 4] },
  aftermath: { gap: 3.5, burst: [1, 1] },
};

/**
 * Paces a scene's attacks in escalating waves: calm, probes, skirmishes, an
 * all-out war that brings an enemy agent swarm, then an aftermath, on a cycle
 * of 40 to 55 seconds that never repeats exactly. Every attack is one event
 * from the 90-day feed, so its type, target and breach chance stay real; the
 * volume is a dramatisation and the scenes say so.
 */
export class WaveDirector {
  readonly rnd: () => number;
  private feed: ReturnType<typeof threatFeed>;
  private cycleAt = 0;
  private cycleLen = 46;
  private next = 1.2;
  private swarmSent = false;

  constructor(intel: ThreatIntel, seed: number) {
    this.feed = threatFeed(intel, seed);
    this.rnd = this.feed.rnd;
  }

  /** draw one more event from the feed, outside the wave plan (a scene's own follow-up) */
  event() {
    return this.feed.next();
  }

  phase(t: number): Phase {
    const u = (t - this.cycleAt) / this.cycleLen;
    let p: Phase = "calm";
    for (const [name, at] of PLAN) if (u >= at) p = name;
    return p;
  }

  /** 0 calm .. 1 all-out war, for HUDs and intensity */
  level(t: number): number {
    return { calm: 0.1, probe: 0.35, skirmish: 0.6, war: 1, aftermath: 0.3 }[this.phase(t)];
  }

  tick(t: number): Wave {
    if (t - this.cycleAt > this.cycleLen) {
      this.cycleAt = t;
      this.cycleLen = 40 + this.rnd() * 15;
      this.swarmSent = false;
    }
    const ph = this.phase(t);
    const wave: Wave = { attacks: [], swarm: null };
    if (ph === "war" && !this.swarmSent) {
      this.swarmSent = true;
      wave.swarm = { ev: this.feed.next(), size: 60 + Math.floor(this.rnd() * 60) };
    }
    if (t >= this.next) {
      const r = RATE[ph];
      const n = r.burst[0] + Math.floor(this.rnd() * (r.burst[1] - r.burst[0] + 1));
      for (let i = 0; i < n; i++) wave.attacks.push(this.feed.next());
      this.next = t + r.gap * (0.6 + this.rnd() * 0.8);
    }
    return wave;
  }
}

export const PHASE_LABEL: Record<Phase, string> = {
  calm: "THREAT LEVEL 1 · CALM",
  probe: "THREAT LEVEL 2 · PROBES",
  skirmish: "THREAT LEVEL 3 · SKIRMISH",
  war: "THREAT LEVEL 5 · ALL-OUT",
  aftermath: "THREAT LEVEL 2 · AFTERMATH",
};
