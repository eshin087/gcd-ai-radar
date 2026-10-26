import type { Metadata } from "next";
import { EmbedCard } from "@/components/embed/EmbedCard";
import { lastUpdated, loadIncidents, siteUrl } from "@/lib/data";
import { SITE } from "@/lib/site";
import { buildSummary } from "@/lib/summary";
import "./embed.css";

/**
 * /embed: a compact card other sites put in an iframe (snippet on /api).
 * Outside the (site) group, so no header or footer. vercel.json lets this
 * one path be framed by any site; every other path refuses framing.
 */

export const metadata: Metadata = {
  title: "Embed",
  description: `AI security incidents (the AI lens) in the last 12 months, from ${SITE.name}. A card for other sites to embed.`,
  robots: { index: false, follow: true },
};

/**
 * Reads ?theme=dark|light, ?window=12m|24m and ?compact=1 and writes them on
 * the wrapper before the card paints. Anything else falls back to the
 * defaults (dark, 12m, full); the values are compared, never inserted.
 */
const OPTIONS_SCRIPT = `(function(){try{var q=new URLSearchParams(location.search),e=document.currentScript.parentElement;e.setAttribute("data-theme",q.get("theme")==="light"?"light":"dark");e.setAttribute("data-window",q.get("window")==="24m"?"24m":"12m");e.setAttribute("data-compact",q.get("compact")==="1"?"1":"0")}catch(_){}})();`;

export default async function EmbedPage() {
  const [{ incidents }, updated] = await Promise.all([loadIncidents(), lastUpdated()]);
  const summary = buildSummary(incidents, { now: new Date(), site: siteUrl(), lastUpdated: updated });
  return (
    // The script changes these attributes before hydration; React must leave them as they are.
    <div className="embed" data-theme="dark" data-window="12m" data-compact="0" suppressHydrationWarning>
      <script dangerouslySetInnerHTML={{ __html: OPTIONS_SCRIPT }} />
      <EmbedCard initial={summary} />
    </div>
  );
}
