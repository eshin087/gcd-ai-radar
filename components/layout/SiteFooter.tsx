import Link from "next/link";
import type { ReactNode } from "react";
import { SITE } from "@/lib/site";
import { RadarMark } from "./Wordmark";

/** One line of the small print: a mono label in a fixed column, then its text. */
function Line({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <p className={`flex gap-3 ${className}`}>
      <span className="w-[4.5rem] shrink-0 pt-[3px] font-mono text-[10px] uppercase leading-none tracking-[0.16em] text-faint">{label}</span>
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/**
 * Three lines on wide screens: the brand and the site links, then the small
 * print as a two-column grid of labelled lines (licences and the gcd family,
 * the required source credits and the NVD notice). The full attribution text
 * (every source's licence and credit) lives on the Sources page under
 * "Licences and credits".
 */
export function SiteFooter() {
  const [lead, ...rest] = SITE.wordmark.split(" ");
  return (
    <footer className="mt-16 border-t border-line">
      <div className="mx-auto max-w-7xl space-y-3 px-4 py-6 text-[12px] leading-relaxed text-dim">
        <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-2">
          <p className="flex items-center gap-2.5">
            <RadarMark size={18} />
            <span className="text-[13px] font-semibold text-ink">
              {lead} <span className="text-accent">{rest.join(" ")}</span>
            </span>
            <span className="text-faint">·</span>
            <span>made by {SITE.author}</span>
          </p>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-1 text-soft">
            <a className="hover:text-accent" href={SITE.github}>
              Code on GitHub
            </a>
            <Link className="hover:text-accent" href="/api">
              API &amp; embed
            </Link>
            <Link className="hover:text-accent" href="/methodology">
              Methodology
            </Link>
            <Link className="hover:text-accent" href="/sources">
              Sources
            </Link>
            <Link className="hover:text-accent" href="/about">
              About
            </Link>
          </nav>
        </div>
        <div className="grid gap-y-1.5 border-t border-line-soft pt-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-x-12">
          <Line label="Licences">
            Data <a className="link" href={SITE.dataLicense.url}>{SITE.dataLicense.name}</a> · Code <a className="link" href={SITE.codeLicense.url}>{SITE.codeLicense.name}</a> ·{" "}
            <Link className="link" href="/sources#licences">
              Licences &amp; credits
            </Link>
          </Line>
          <Line label="Family" className="order-last lg:order-none">
            {SITE.family.map((f, i) => (
              <span key={f.url}>
                {i > 0 && " · "}
                <a className="link" href={f.url}>
                  {f.name}
                </a>
              </span>
            ))}
          </Line>
          <Line label="Credits">
            Powered by{" "}
            <a className="link" href="https://www.gdeltproject.org/">
              GDELT
            </a>{" "}
            · Thank you to arXiv for use of its open access interoperability. · Breach data from{" "}
            <a className="link" href="https://haveibeenpwned.com">
              Have I Been Pwned
            </a>
          </Line>
          <Line label="Notice">This product uses the NVD API but is not endorsed or certified by the NVD.</Line>
        </div>
      </div>
    </footer>
  );
}
