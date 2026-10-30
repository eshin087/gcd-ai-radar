import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import { siteUrl } from "@/lib/data";
import { SITE } from "@/lib/site";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: `${SITE.name} — ${SITE.tagline}`,
    template: `%s · ${SITE.name}`,
  },
  description: SITE.description,
  applicationName: SITE.name,
  openGraph: {
    type: "website",
    siteName: SITE.name,
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
    images: ["/og/default.png"],
  },
  twitter: { card: "summary_large_image" },
  icons: { icon: "/favicon.svg" },
  alternates: {
    types: {
      "application/rss+xml": [
        { url: "/feed.xml", title: `${SITE.name}: new incidents, all lanes` },
        { url: "/briefing.xml", title: `${SITE.name}: this week in AI security` },
      ],
      "application/feed+json": [{ url: "/feed.json", title: `${SITE.name}: new incidents, all lanes` }],
      "text/plain": [{ url: "/llms.txt", title: `${SITE.name} for AI agents` }],
    },
  },
};

/**
 * Runs before first paint. `motion` lets the home page's instruments build in
 * as they scroll into view (components/home/panel/PanelMotion.tsx); it stays
 * off under reduced motion and with ?final, and comes off after four seconds
 * if the page's script never started, so marks can never stay hidden.
 * `stack-custom` hides the numbers that depend on a returning visitor's own
 * stack until it has loaded, instead of flashing the default one.
 */
const BOOT = `(function(){try{var d=document.documentElement,q=location.search;if(!matchMedia("(prefers-reduced-motion: reduce)").matches&&!/[?&]final(=|&|$)/.test(q)){d.classList.add("motion")}var s=null;try{s=localStorage.getItem("gcd-radar:stack")}catch(e){}if(s||/[?&]stack=/.test(q)){d.classList.add("stack-custom")}setTimeout(function(){if(!window.__panelMotion){d.classList.remove("motion","stack-custom")}},4000)}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${plexMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT }} />
      </head>
      <body className="min-h-dvh flex flex-col">{children}</body>
    </html>
  );
}
