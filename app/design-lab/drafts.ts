export const DRAFTS = [
  {
    slug: "scope",
    name: "Scope",
    palette: ["#04050a", "#ffb35c", "#3a97cf", "#e2e8f5"],
    rationale:
      "An instrument, not a page: the hero is a live radar scope where every blip is a real incident from the last 90 days, placed by category family and age, sized by coverage and lit by severity. The rest of the dashboard reads like the scope's readouts, with rolling numbers, braille sparklines and a scrolling contact ticker.",
  },
  {
    slug: "phosphor",
    name: "Phosphor",
    palette: ["#030a06", "#8dfdb0", "#43b966", "#ffb35c"],
    rationale:
      "A green CRT terminal in the gcdReplay lineage: a typed boot log, an ANSI block-font banner, the Codex dish rendered as live glyphs, and every chart drawn in block characters with a status line instead of tooltips. Fully keyboard driven (1-4 window, r real-world, d date basis), it trades polish for a feeling of operating the instrument.",
  },
  {
    slug: "observatory",
    name: "Observatory",
    palette: ["#05070d", "#ffd9a3", "#3a97cf", "#887ede"],
    rationale:
      "Cinematic and closest to gcdatlas: a full-screen ASCII rendering of the Codex dish array pulses radar rings while the headline decodes over it, and sections fade in on scroll inside glass panels. Categories become small multiples on a shared scale, which reads far better than one 14-color stack.",
  },
] as const;

export type DraftSlug = (typeof DRAFTS)[number]["slug"];
