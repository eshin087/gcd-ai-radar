import { getDashboardData } from "@/lib/dashboard";
import { ObservatoryDraft } from "./ObservatoryDraft";

export const metadata = { title: "Observatory · design lab" };

export default async function Page() {
  const data = await getDashboardData();
  return <ObservatoryDraft data={data} />;
}
