/**
 * The five homepage layout candidates. Each route under /design-options is a
 * complete homepage built from the real chart components and the stub
 * dataset. Deleted once a layout is chosen and the real dashboard exists.
 */
export const OPTIONS = [
  {
    slug: "observatory",
    name: "Observatory",
    rationale:
      "Chart-first: one large monthly trend chart is the hero, with the headline numbers set as a quiet row beneath it and the secondary charts in a dense two-by-two grid. Reads like an instrument panel and puts the question 'is it rising?' on screen before anything else.",
  },
  {
    slug: "ledger",
    name: "Ledger",
    rationale:
      "Numbers-first: a left column of very large headline figures with deltas carries the page, charts stack in a narrower right column and the latest incidents become a tabular ledger. Favors people who come for a citable number and skim the charts second.",
  },
  {
    slug: "broadsheet",
    name: "Broadsheet",
    rationale:
      "Editorial: a large type scale, a lede paragraph that states the trend in words, and incidents presented as a dated front page with charts as inset figures. Built for linking from articles and talks, where context matters more than density.",
  },
  {
    slug: "console",
    name: "Console",
    rationale:
      "Operations console: small type, many tight panels, a status strip for navigation and the real-world-only toggle foregrounded, all monospace. Maximum information per pixel for returning analysts who already know the taxonomy.",
  },
  {
    slug: "signal",
    name: "Signal",
    rationale:
      "Minimal and airy: a single hero statistic with a full-width sparkline band, then each chart gets its own generous section down the page with a side rail for navigation. Slowest to scan, calmest to read, and the most mobile-friendly.",
  },
] as const;

export type OptionSlug = (typeof OPTIONS)[number]["slug"];
