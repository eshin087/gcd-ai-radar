import type { Metadata } from "next";
import { HomePage } from "@/components/home/HomePage";
import { getHomeData } from "@/lib/home-data";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: { absolute: `${SITE.name} — ${SITE.tagline}` },
  description: SITE.description,
  openGraph: { images: ["/og/default.png"] },
};

export default async function Home() {
  const data = await getHomeData();
  return <HomePage data={data} />;
}
