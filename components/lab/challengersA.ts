import { firewallTunnel } from "@/components/fx/glyph/scenes/firewallTunnel";
import { packetOcean } from "@/components/fx/glyph/scenes/packetOcean";
import type { SceneEntry } from "./sceneEntry";

/** Challenger banners (set A), shown on the review page after the main candidates. */
export const CHALLENGERS_A: SceneEntry[] = [
  {
    id: "firewall-tunnel",
    letter: "7",
    title: "Firewall tunnel",
    note: "A first-person flight down an endless tunnel of firewall gates: red packets streak up from the dark, an iris snaps shut on most (blocked at gate n), wall drones zap the rest, and in war a swarm pours in against a drone formation. At the real harm rate a packet gets through: the near tunnel floods red and glitches until the drones reseal it gate by gate.",
    make: firewallTunnel,
    label: "A flight down a tunnel of firewall gates closing on incoming attack packets",
  },
  {
    id: "packet-ocean",
    letter: "8",
    title: "Packet ocean",
    note: "A night sea of glyphs with amber traffic riding the swell, a radar tower pulsing rings of light over the water and a line of buoys strung with light. Attacks are red whirlpools and squalls: most are held at the buoy line or broken up by a patrol boat, a storm front rolls in during war, and at the real harm rate a surge hits the tower, which turns red and glitches until it is cleaned and its light returns.",
    make: packetOcean,
    label: "A night sea where storms of attacks break on a line of defence buoys before a radar lighthouse",
  },
];
