import type { Metadata } from "next";
import { LivePage } from "@/components/live/LivePage";
import { getLiveData } from "@/lib/live-data";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: { absolute: `${SITE.name} — ${SITE.tagline}` },
  description: SITE.description,
  openGraph: { images: ["/og/default.png"] },
};

export default async function Home() {
  const data = await getLiveData();
  return <LivePage data={data} />;
}
