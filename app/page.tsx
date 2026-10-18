import type { Metadata } from "next";
import { Dashboard } from "@/components/dashboard/Dashboard";
import { getDashboardData } from "@/lib/dashboard";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: { absolute: `${SITE.name} — ${SITE.tagline}` },
  description: SITE.description,
  openGraph: { images: ["/og/default.png"] },
};

// Headings that form on arrival (AsciiForm) start hidden from first paint so
// they never flash in full first; without JS the noscript rule shows them.
const SHOW_PENDING = ".ascii-form[data-pending] [data-c]{color:inherit!important}";

/** The dashboard lives outside the (site) group: it brings its own header inside the hero. */
export default async function Home() {
  const data = await getDashboardData();
  return (
    <>
      <noscript>
        <style>{SHOW_PENDING}</style>
      </noscript>
      <Dashboard data={data} />
    </>
  );
}
