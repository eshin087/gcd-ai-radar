import type { Metadata } from "next";
import { Dashboard } from "@/components/dashboard/Dashboard";
import { getDashboardData } from "@/lib/dashboard";

export const metadata: Metadata = {
  title: "Trends",
  description: "AI security incidents charted over time: the trend, the families of attack, severity, targets, the products hit and the OWASP and MITRE ATLAS views. Every number opens its incidents.",
};

/** The chart dashboard over the AI records (lib/counting.ts aiLens); every count and bar opens its incidents in a drawer. */
export default async function TrendsPage() {
  const data = await getDashboardData();
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-[28px] font-semibold tracking-tight">Trends in AI security</h1>
        <p className="max-w-3xl text-[14px] leading-relaxed text-dim">
          The AI records charted over time: attacks on AI systems and AI-enabled attacks, counted once each and linked to their reporting. Disclosed CVEs with
          no confirmed exploitation are tracked apart. Every number and bar opens its incidents.
        </p>
      </header>
      <Dashboard data={data} />
    </div>
  );
}
