/** Site-wide constants. Branding follows the gcd family conventions. */

export const SITE = {
  name: "GCD AI RADAR",
  wordmark: "GCD AI RADAR",
  tagline: "An observatory of AI cybersecurity incidents",
  description:
    "GCD AI RADAR records, counts and charts AI cybersecurity incidents: attacks on AI systems and AI-enabled attacks, deduplicated and linked to original reporting.",
  github: "https://github.com/eshin087/gcd-ai-radar",
  author: "GCD",
  family: [
    { name: "gcdatlas", url: "https://gcdatlas.com", blurb: "the real universe, drawn in ASCII" },
    { name: "gcdTracker", url: "https://gcdtracker.vercel.app", blurb: "AI traffic and agent activity" },
    { name: "gcdSignal", url: "https://gcdsignal.vercel.app", blurb: "a local-first AI news reader" },
  ],
  dataLicense: { name: "CC BY-SA 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/" },
  codeLicense: { name: "MIT", url: "https://github.com/eshin087/gcd-ai-radar/blob/main/LICENSE" },
} as const;

export const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/incidents", label: "Incidents" },
  { href: "/products", label: "Products" },
  { href: "/methodology", label: "Methodology" },
  { href: "/sources", label: "Sources" },
  { href: "/data", label: "Data" },
  { href: "/about", label: "About" },
] as const;

/** Default chart window in months; the toggle offers these choices plus the full range. */
export const DEFAULT_WINDOW_MONTHS = 24;
export const WINDOW_CHOICES = [12, 24, 36] as const;
