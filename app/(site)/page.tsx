import Link from "next/link";
import { loadIncidents } from "@/lib/data";
import { SITE } from "@/lib/site";

/**
 * Temporary placeholder. The real dashboard is built after a homepage layout
 * is picked from /design-options.
 */
export default async function Home() {
  const { incidents, isStub } = await loadIncidents();
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">{SITE.tagline}</h1>
      <p className="text-soft">{SITE.description}</p>
      <p className="num text-dim text-sm">
        {incidents.length} incidents loaded{isStub ? " (synthetic stub dataset)" : ""}.
      </p>
      <p>
        <Link href="/design-options" className="link">
          View the five homepage design options →
        </Link>
      </p>
    </div>
  );
}
