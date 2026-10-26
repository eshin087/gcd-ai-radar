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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${plexMono.variable}`}>
      <body className="min-h-dvh flex flex-col">{children}</body>
    </html>
  );
}
