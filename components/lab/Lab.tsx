"use client";

import { useState, type ReactNode } from "react";
import { useDashboardModel } from "@/components/dashboard/useDashboardModel";
import { FeedTerminal } from "@/components/fx/glyph/FeedTerminal";
import { GlyphField } from "@/components/fx/glyph/GlyphField";
import { agentConstellation } from "@/components/fx/glyph/scenes/agentConstellation";
import { neuralCore2 } from "@/components/fx/glyph/scenes/neuralCore2";
import { swarmHive } from "@/components/fx/glyph/scenes/swarmHive";
import { swarmMurmuration } from "@/components/fx/glyph/scenes/swarmMurmuration";
import { swarmWar } from "@/components/fx/glyph/scenes/swarmWar";
import { transformerFlight } from "@/components/fx/glyph/scenes/transformerFlight";
import type { LabData } from "@/lib/dashboard";
import type { ThreatIntel } from "@/lib/threatIntel";
import { CHALLENGERS_A } from "./challengersA";
import { CHALLENGERS_B } from "./challengersB";
import { CHALLENGERS_C } from "./challengersC";
import { HeaderMock, LogoBadge, LogoRadar, LogoTerminal } from "./LogoDemos";
import type { SceneEntry } from "./sceneEntry";
import { BlockTerminal, CrtTerminal, MacTerminal, type TermData } from "./TerminalDemos";
import "../fx/glyph/glyph.css";

type Make = SceneEntry["make"];

/** The hero scenes under review, in page order. */
const SCENES: SceneEntry[] = [
  {
    id: "swarm-war",
    letter: "★",
    title: "Agent swarm · war (round 7)",
    note: "On black now, every move a clear formation. In calm the swarm patrols in rings, cages, battalion squares and a squadron carousel round the armoured core. A blocked attack meets a defence plate that snaps into its path; an intercepted one is run down by a V of interceptors. About eleven seconds in (then once every war) three enemy armies tear out of three rifts in formation, a phalanx block, a hive ball and a chevron, about 350 agents, and the defence answers with four maneuvers at once: gear rings round the core, a honeycomb shield wall the phalanx breaks on, a pincer whose wings sweep round the hive and close a ring that crushes it, and a spearhead that punches through the chevron, U-turns and makes a second pass. When the real odds say breach, a handful slip through the gears and the breach shows its kind: an injection spirals in, a hijack turns some of our agents red until a repair cage purges them, a leak streams data out until a plate cuts it, anything else infects a patch of armour. Volume is dramatised; attack mix and breach odds are the last 90 days.",
    make: swarmWar,
    label: "An AI agent swarm defending its core in escalating attack waves, with a visible takeover and repair when a breach lands",
    cell: 4.5,
  },
];

/** The previous rounds, kept for comparison behind a fold. */
const EARLIER_ROUNDS: SceneEntry[] = [
  {
    id: "swarm-murmuration",
    letter: "1",
    title: "Agent swarm · murmuration",
    note: "Hundreds of agents flock round an orchestrator core like starlings; streams peel off to fetch from tools and bring results home in amber. A hijacked agent turns red, its neighbours close a cage round it and it is purged; otherwise a squad intercepts the attack or the core's shield blocks it.",
    make: swarmMurmuration,
    label: "A swarm of AI agents flocking round an orchestrator, containing hijacked agents",
  },
  {
    id: "swarm-hive",
    letter: "2",
    title: "Agent swarm · hive at work",
    note: "Agents run ordered lanes between the orchestrator and six tools, out in cyan and home in amber with the result. Most attacks are filtered at the tool; at the real harm rate a tool is hijacked, red runs home along its lane and a quarantine gate seals it.",
    make: swarmHive,
    label: "A hive of AI agents shuttling between an orchestrator and its tools",
  },
  {
    id: "neural-core-2",
    letter: "4",
    title: "Neural core 2.0",
    note: "The one you liked, evolved: a brain-shaped lattice (two hemispheres and a fissure) with signals racing through its tunnels, fed by token streams spiralling in. Attacks arrive as injected tokens: the shield catches most, and at the real harm rate one gets through and spreads red until a cyan sweep cleans it.",
    make: neuralCore2,
    label: "An AI brain-shaped lattice fed by token streams, catching injected tokens",
  },
  {
    id: "constellation",
    letter: "5",
    title: "Agent constellation",
    note: "An orchestrator and eight named agents (planner, researcher, browser, MCP tools, coder, executor, memory, critic) passing messages along glowing links. A hijacked agent turns red, sends red messages, and the orchestrator cuts its links until it is restored.",
    make: agentConstellation,
    label: "A constellation of named AI agents passing messages, isolating a hijacked agent",
  },
  {
    id: "transformer",
    letter: "6",
    title: "Transformer in flight",
    note: "Rows of tokens rise through six attention layers with attention beams arcing between them. Attacks ride in as an injected token: the amber guard layer flags and ejects most of them, and at the real harm rate one slips through and lights the output red.",
    make: transformerFlight,
    label: "Tokens rising through transformer attention layers, an injected token filtered out",
  },
];

const isCircuit = (s: SceneEntry) => s.id === "circuit-world";
/** This round: the two the owner is taking forward. */
const MAIN: SceneEntry[] = [...SCENES, ...CHALLENGERS_B.filter(isCircuit)];
const EARLIER: SceneEntry[] = [...CHALLENGERS_C, ...CHALLENGERS_A, ...CHALLENGERS_B.filter((s) => !isCircuit(s)), ...EARLIER_ROUNDS];

function Option({ id, letter, title, note, children }: { id: string; letter: string; title: string; note: string; children: ReactNode }) {
  return (
    <section id={id} className="space-y-3">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-[13px] text-accent">{letter}</span>
        <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
      </div>
      <p className="max-w-3xl text-[14px] leading-relaxed text-soft">{note}</p>
      {children}
    </section>
  );
}

/** Earlier rounds' scenes, mounted only when opened (each scene holds a WebGL context). */
function EarlierRound({ intel }: { intel: ThreatIntel }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="space-y-6 rounded-lg border border-line p-5">
      <button type="button" onClick={() => setOpen((o) => !o)} className="label hover:text-accent">
        {open ? "▾" : "▸"} Earlier rounds · {EARLIER.length} scenes ({EARLIER.map((s) => s.title.toLowerCase()).join(", ")})
      </button>
      {open &&
        EARLIER.map((sc) => (
          <Option key={sc.id} id={sc.id} letter={sc.letter} title={sc.title} note={sc.note}>
            <SceneDemo intel={intel} make={sc.make} label={sc.label} cell={sc.cell} />
          </Option>
        ))}
    </section>
  );
}

/** The hero as it will sit in the site: scene on the right, headline top left, the feed terminal bottom left. */
function SceneDemo({ intel, make, label, cell }: { intel: ThreatIntel; make: Make; label: string; cell?: number }) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-line bg-[#05070d] lg:h-[660px]">
      {/* a band above the text on phones, behind it on wide screens */}
      <div aria-hidden className="hero-field relative h-72 lg:absolute lg:inset-0 lg:h-auto">
        <GlyphField scene={() => make({ intel })} label={label} cell={cell} className="h-full w-full" />
      </div>
      <div className="relative z-10 flex flex-col gap-8 px-5 pb-6 lg:h-full lg:justify-between lg:px-8 lg:py-10">
        <div className="max-w-xl space-y-4">
          <h1 className="text-4xl font-semibold leading-[1.06] tracking-tight sm:text-5xl lg:text-[52px]">Threat intelligence for the AI era.</h1>
          <p className="text-[15px] leading-relaxed text-soft">
            The live, source-verified record of attacks on and with AI, from prompt injection and agent hijacking to model theft and deepfake fraud. Every incident counted once, so security teams can see what is hitting now and what is rising next.
          </p>
        </div>
        <FeedTerminal intel={intel} className="w-full max-w-[560px]" />
      </div>
    </div>
  );
}

export function Lab({ data }: { data: LabData }) {
  const m = useDashboardModel(data);
  const term: TermData = {
    command: `radar status --set ${m.basis} --by incident-date --window ${m.win}`,
    count: m.count,
    window: m.windowLabel,
    real: m.realInWindow,
    sources: m.sourcesInWindow,
    disclosed: m.disclosedCount,
    share: m.count ? m.realInWindow / m.count : 0,
    lastUpdated: data.lastUpdated,
    latest: data.intel.latest,
  };
  return (
    <main className="mx-auto w-full max-w-7xl space-y-16 px-4 py-12">
      <header className="space-y-2">
        <div className="label text-accent">Design review · not public</div>
        <h1 className="text-3xl font-semibold tracking-tight">Pick a hero scene, a terminal style and a logo</h1>
      </header>
      <div className="space-y-10">
        <h2 className="divider">
          <span className="text-accent">01</span> Hero scene
        </h2>
        {MAIN.map((sc) => (
          <Option key={sc.id} id={sc.id} letter={sc.letter} title={sc.title} note={sc.note}>
            <SceneDemo intel={data.intel} make={sc.make} label={sc.label} cell={sc.cell} />
          </Option>
        ))}
        <EarlierRound intel={data.intel} />
      </div>
      <div className="space-y-10">
        <h2 className="divider">
          <span className="text-accent">02</span> Terminal panel
        </h2>
        <p className="max-w-3xl text-[14px] text-soft">You picked B; the hero&apos;s threat feed above now wears it in ice-cyan phosphor. Real numbers from the default view; each plays when it scrolls into view, replay is top right.</p>
        <div className="grid gap-10 lg:grid-cols-2">
          <Option id="term-mac" letter="A" title="Modern macOS terminal" note="A real window: traffic lights, a typed command, spinners turning into checkmarks, counting numbers, a blinking block cursor.">
            <MacTerminal d={term} />
          </Option>
          <Option id="term-crt" letter="B" title="Retro CRT phosphor" note="Amber phosphor glow, scanlines and a slight flicker, a short boot sequence before the readout.">
            <CrtTerminal d={term} />
          </Option>
          <Option id="term-blocks" letter="C" title="Warp-style command blocks" note="Each command and its output in its own block with status chips and timing, and a second command listing the latest real-world incidents.">
            <BlockTerminal d={term} />
          </Option>
        </div>
      </div>
      <div className="space-y-10">
        <h2 className="divider">
          <span className="text-accent">03</span> Logo
        </h2>
        <Option id="logo-radar" letter="A" title="Radar mark + clean wordmark" note="A minimal radar icon with a slowly turning sweep and a blip, beside GCD AI RADAR in the site's sans.">
          <HeaderMock logo={<LogoRadar />} small={<><span>icon sizes:</span><LogoRadar size={48} iconOnly /><LogoRadar size={32} iconOnly /><LogoRadar size={16} iconOnly /></>} />
        </Option>
        <Option id="logo-terminal" letter="B" title="Terminal wordmark" note="The name as a terminal line in the mono font, with a live pulse and a blinking cursor, matching the terminal panel.">
          <HeaderMock logo={<LogoTerminal />} />
        </Option>
        <Option id="logo-badge" letter="C" title="Monogram badge" note="A rounded badge with a G drawn as a radar arc and a blip, and a light, widely spaced wordmark. More app-like.">
          <HeaderMock logo={<LogoBadge />} small={<><span>icon sizes:</span><LogoBadge size={48} iconOnly /><LogoBadge size={32} iconOnly /><LogoBadge size={16} iconOnly /></>} />
        </Option>
      </div>
    </main>
  );
}
