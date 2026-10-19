import Link from "next/link";
import { NAV } from "@/lib/site";
import { Wordmark } from "./Wordmark";

export function SiteHeader({ lastUpdated }: { lastUpdated?: string | null }) {
  return (
    <header className="border-b border-line sticky top-0 z-30 bg-ground/85 backdrop-blur">
      <div className="mx-auto max-w-7xl px-4 h-14 flex items-center justify-between gap-6">
        <Wordmark />
        <nav aria-label="Primary" className="hidden lg:flex items-center gap-4 xl:gap-5">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="label hover:text-ink transition-colors">
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="num text-[11px] text-dim hidden xl:block whitespace-nowrap">
          {lastUpdated ? (
            <>
              updated <time dateTime={lastUpdated}>{lastUpdated.slice(0, 16).replace("T", " ")}Z</time>
            </>
          ) : (
            <span className="text-faint">collector not yet run</span>
          )}
        </div>
      </div>
      <nav aria-label="Primary mobile" className="lg:hidden border-t border-line-soft overflow-x-auto">
        <div className="px-4 h-10 flex items-center gap-5 whitespace-nowrap">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="label hover:text-ink">
              {item.label}
            </Link>
          ))}
        </div>
      </nav>
    </header>
  );
}
