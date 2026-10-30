/** The globe's looks, for the component and for the lab page that compares them (a server component, so no renderer here). */
export type GlobeLook = "signal" | "daylight" | "ascii" | "sweep";

export const GLOBE_LOOKS: readonly { id: GlobeLook; name: string; note: string }[] = [
  { id: "signal", name: "Signal", note: "Fine dots shaded by depth, the far side showing faintly through the sphere. Each route draws in like a comet and rings where it lands." },
  { id: "daylight", name: "Daylight", note: "Day and night as they are right now: land lit where the Sun is up, dim where it is night, the terminator dotted." },
  { id: "ascii", name: "ASCII", note: "The Earth in mono glyphs, shaded by the real Sun, with the routes drawn in line characters to match the cluster beside it." },
  { id: "sweep", name: "Sweep", note: "A radar sweep circles the globe and lights the land behind it, over a faint 30° grid." },
];
