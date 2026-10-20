import { circuitWorld } from "@/components/fx/glyph/scenes/circuitWorld";
import { dataCentreCity } from "@/components/fx/glyph/scenes/dataCentreCity";
import type { SceneEntry } from "./sceneEntry";

/** Challenger banners (set B), shown on the review page after the main candidates. */
export const CHALLENGERS_B: SceneEntry[] = [
  {
    id: "circuit-world",
    letter: "9",
    title: "Circuit world",
    note: "One continuous journey over a living chip package: the whole die with its gold bond wires and HBM towers, down low over a violet NPU city, into the sea of gates where the metal stack peels back window by window to the transistors, out past ice-blue SRAM terraces, copper coils and an emerald-shielded identity enclave, and through the gap between two HBM stacks. Clock edges and power waves sweep the die and busy blocks glow warm. Attacks slide down a bond wire as red fault packets and run the lanes to the block their type goes for: cyan defenders catch some, a guard ring flares and stops others, and at the real harm rate one gets in, turning the block red row by row until a crew scrubs it clean. In war a flood pours down the east wires onto a firewall line of defenders.",
    make: circuitWorld,
    label: "A camera journey over a chip package of AI system districts where defender agents catch red fault packets and scrub infected blocks clean",
  },
  {
    id: "data-centre-city",
    letter: "10",
    title: "Data-centre city",
    note: "An orbit over a night city of server towers, their floors lit as rows of racks, patrol drones weaving between them and a radar pulse running along the streets from the SOC tower. Attacks fall from the sky as red streaks onto the tower their type goes for: a drone shield dome stops some, drones meet others in the air, in war a red drone swarm sweeps in from the horizon for a dogfight, and at the real harm rate a tower goes red floor by floor until a ring of drones climbs it and rebuilds it.",
    make: dataCentreCity,
    label: "A city of server towers where drones shield, intercept and rebuild against attacks falling from the sky",
  },
];
