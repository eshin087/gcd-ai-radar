import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { lastUpdated } from "@/lib/data";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const updated = await lastUpdated();
  return (
    <>
      <SiteHeader lastUpdated={updated} />
      <main className="flex-1 mx-auto w-full max-w-7xl px-4 py-8">{children}</main>
      <SiteFooter />
    </>
  );
}
