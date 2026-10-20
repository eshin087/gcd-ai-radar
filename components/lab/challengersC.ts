import { codeCanyon } from "@/components/fx/glyph/scenes/codeCanyon";
import { commandBridge } from "@/components/fx/glyph/scenes/commandBridge";
import { glyphGalaxy } from "@/components/fx/glyph/scenes/glyphGalaxy";
import { warTable } from "@/components/fx/glyph/scenes/holoWarTable";
import type { SceneEntry } from "./sceneEntry";

/** New banners (set C), round 6. */
export const CHALLENGERS_C: SceneEntry[] = [
  {
    id: "war-table",
    letter: "11",
    title: "Holographic war table",
    note: "A dark command room round a heavy table with an engraved, bevelled rim and eight projectors, slowly orbiting. Above the glass floats a hologram of the AI estate like a strategy map: the core's spire with its white-hot heart, and structures for MCP / tools, ChatGPT, Claude, Copilot, Gemini, the self-hosted LLM and the rest, joined by links with amber traffic, while cyan defender units patrol in file. Attacks arc in from the rim: a shield dome flares (blocked), a unit fires an interceptor that meets it mid-air, or at the real harm rate it lands and the structure turns red, glitches and spreads along its links until units converge and a scan restores it. In war a red V or pincer pours across the map against a defensive line as the camera leans in.",
    make: warTable,
    label: "A holographic war table: the AI estate projected over a command table, its defender units blocking, intercepting and repairing incoming attacks",
  },
  {
    id: "command-bridge",
    letter: "12",
    title: "Command bridge",
    note: "First person from a capital ship's bridge: dark struts and consoles with tiny readouts frame a viewport onto the company's AI station (a stacked core round a white-hot heart, a turning ring of model pods named ChatGPT, Claude, Copilot and the rest, docking arms for MCP / tools), guarded by escort orbits, picket lines and V wings of defender agents. Each attack flies in at the section its target names: the shield flares a patch of hexes, or a wing breaks formation and runs it down, or at the real harm rate it breaks through and the section burns red and vents until repair drones bring it back cyan. In war a hostile wedge, pincer or wall arrives and our wings meet it in a dogfight.",
    make: commandBridge,
    label: "The view from a command bridge over the AI station, its defender agent fleet blocking, intercepting and repairing incoming attacks",
  },
  {
    id: "glyph-galaxy",
    letter: "13",
    title: "Glyph galaxy",
    note: "A barred spiral galaxy of glyphs at a 3/4 tilt, turning slowly: the gold bulge is the core model cluster, the AI systems (ChatGPT, Copilot, Claude, MCP / tools and the rest) are bright star systems with orbiting agents strung along the arms, amber data flows along the arms and cyan defender comets patrol them. Attacks dive in from intergalactic space as red streaks: a shield flares (blocked) or defenders leave the arm and catch them (intercepted), and in war a red swarm like a rogue dwarf galaxy falls toward the disk into a ring of defenders. At the real harm rate one lands: the system and its stretch of arm turn red and flicker until defenders converge and heal it.",
    make: glyphGalaxy,
    label: "A spiral galaxy whose star systems are AI systems, with defender agents stopping incoming attacks",
  },
  {
    id: "code-canyon",
    letter: "14",
    title: "Code canyon flythrough",
    note: "A low flight down a winding canyon whose terraced walls are strata of source code (cyan keywords, amber strings, hex-dump data layers), warmed from below by a river of amber data traffic, with a V of defender agents flying escort and firewall gates spanning the canyon, each guarding a data-centre outcrop named for the system under attack. Attacks are red packets racing up the river or injected-code worms crawling down the strata: a gate flares and shatters most (blocked), escorts peel off and burst the rest (intercepted), and in war a red swarm floods down the canyon into a wall of reinforced escorts. At the real harm rate one reaches its system: the strata around it turn to glitching red code until a cyan rewrite runs down it line by line.",
    make: codeCanyon,
    label: "A flight down a canyon of code strata where escort agents and firewall gates stop injected attacks",
  },
];
