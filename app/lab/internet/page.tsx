import type { Metadata } from "next";
import Link from "next/link";
import { InternetBand } from "@/components/internet/InternetBand";

export const metadata: Metadata = {
  title: "Internet band",
  robots: { index: false, follow: false },
};

/**
 * Unlisted preview of the home page's live internet band at the home page's
 * size (300 px at lg, globe 240 px on phones), before it is dropped into the
 * page. The Worker URL comes from NEXT_PUBLIC_INTERNET_API at build time; the
 * second band below is forced idle so both states can be judged side by side.
 * Not linked anywhere.
 */
export default function InternetLabPage() {
  const api = process.env.NEXT_PUBLIC_INTERNET_API;
  const lead = (
    <>
      <p className="label flex items-center gap-2">
        <span aria-hidden className="inline-block size-1.5 rounded-full bg-live" />
        live · last sweep 09:17 UTC
      </p>
      <h1 className="mt-3 text-[28px] leading-[1.1] font-semibold tracking-tight text-ink lg:text-[32px]">What is being exploited right now.</h1>
      <p className="mt-3 max-w-[40ch] text-[14px] leading-snug text-soft">Live security incidents counted once and linked to their reporting, beside the internet&rsquo;s last hour from Cloudflare Radar.</p>
      <p className="mt-3 flex gap-4 text-[13px]">
        <Link href="/live" className="link">
          Live board →
        </Link>
        <Link href="/incidents" className="link">
          Archive
        </Link>
      </p>
    </>
  );
  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <p className="label mb-6">
        Lab · internet band · Worker: <span className="normal-case text-soft">{api ?? "not configured (NEXT_PUBLIC_INTERNET_API)"}</span>
      </p>
      <InternetBand apiUrl={api} lead={lead} />
      <h2 className="label mt-12 mb-4 border-t border-line pt-4">Idle state (no Worker)</h2>
      <InternetBand lead={lead} />
    </main>
  );
}
