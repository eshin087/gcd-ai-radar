import type { Metadata } from "next";
import { DashboardBody } from "@/components/dashboard/DashboardBody";
import { getDashboardData } from "@/lib/dashboard";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: { absolute: `${SITE.name} — ${SITE.tagline}` },
  description: SITE.description,
  openGraph: { images: ["/og/default.png"] },
};

export default async function Home() {
  const data = await getDashboardData();
  return (
    <>
      <h1 className="sr-only">{SITE.tagline}</h1>
      <DashboardBody data={data} />
    </>
  );
}
