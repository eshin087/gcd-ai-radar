/** Site-wide constants. Branding follows the gcd family conventions. */

/** The Cloudflare Worker behind the hero globe (worker/). Its origin is in vercel.json's connect-src. */
export const INTERNET_API = "https://gcd-ai-radar-internet.eshin087.workers.dev/v1/internet";

export const SITE = {
  name: "GCD RADAR",
  wordmark: "GCD RADAR",
  tagline: "Live security incidents, with an AI lens",
  description:
    "GCD RADAR tracks live security incidents across the web, with an AI lens: what happened, whether there is a fix, and what to do. Every record is counted once and linked to its reporting.",
  github: "https://github.com/eshin087/gcd-ai-radar",
  author: "GCD",
  family: [
    { name: "gcdatlas", url: "https://gcdatlas.com", blurb: "the real universe, drawn in ASCII" },
    { name: "gcdTracker", url: "https://gcdtracker.vercel.app", blurb: "AI traffic and agent activity" },
    { name: "gcdSignal", url: "https://gcdsignal.vercel.app", blurb: "a local-first AI news reader" },
  ],
  dataLicense: { name: "CC BY-SA 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/" },
  codeLicense: { name: "MIT", url: "https://github.com/eshin087/gcd-ai-radar/blob/main/LICENSE" },
  /** The globe's data: INTERNET_API, or NEXT_PUBLIC_INTERNET_API for local work against `wrangler dev`. */
  internetApi: process.env.NEXT_PUBLIC_INTERNET_API || INTERNET_API,
} as const;

export const NAV = [
  { href: "/live", label: "Live" },
  { href: "/incidents", label: "Archive" },
  { href: "/trends", label: "Trends" },
  { href: "/tags", label: "Tags" },
  { href: "/briefing", label: "Briefing" },
  { href: "/data", label: "Data & API" },
  { href: "/about", label: "About" },
] as const;

/** Default chart window in months; the toggle offers these choices plus the full range. */
export const DEFAULT_WINDOW_MONTHS = 24;
export const WINDOW_CHOICES = [12, 24, 36] as const;
