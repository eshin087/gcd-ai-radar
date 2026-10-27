import type { Metadata } from "next";
import { LivePage } from "@/components/live/LivePage";
import { getLiveData } from "@/lib/live-data";

export const metadata: Metadata = {
  title: "Live board",
  description: "Every live security incident in the four lanes: patch now, breaches and attacks, supply chain, research. Lane tabs, an AI-only switch, search, the twelve-month calendar and the live tags.",
};

export default async function Live() {
  const data = await getLiveData();
  return <LivePage data={data} variant="board" />;
}
