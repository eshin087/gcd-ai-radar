import { getDashboardData } from "@/lib/dashboard";
import { ScopeDraft } from "./ScopeDraft";

export const metadata = { title: "Scope · design lab" };

export default async function Page() {
  const data = await getDashboardData();
  return <ScopeDraft data={data} />;
}
