import type { Metadata } from "next";
import { Lab } from "@/components/lab/Lab";
import { getDashboardData } from "@/lib/dashboard";

export const metadata: Metadata = {
  title: "Design review",
  robots: { index: false, follow: false },
};

/** Unlisted review page: hero scenes, terminal styles and logos to choose from. Not linked anywhere. */
export default async function LabPage() {
  const data = await getDashboardData();
  return <Lab data={data} />;
}
