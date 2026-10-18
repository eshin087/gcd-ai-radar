import { getDashboardData } from "@/lib/dashboard";
import { PhosphorDraft } from "./PhosphorDraft";

export const metadata = { title: "Phosphor · design lab" };

export default async function Page() {
  const data = await getDashboardData();
  return <PhosphorDraft data={data} />;
}
