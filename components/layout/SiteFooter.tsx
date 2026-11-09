import Link from "next/link";
import { Fragment } from "react";
import { SITE } from "@/lib/site";

/**
 * Two quiet mono lines under every page: the site links with the gcd family
 * at the right, then the small print in one line (the licences and every
 * upstream source with its licence, each a link) and the NVD notice, which
 * NVD's terms ask for word for word. The full attribution text (arXiv's
 * acknowledgement sentence among it) lives on the Sources page under
 * "Licences and credits".
 */
const SOURCES: { name: string; note: string | null; url: string }[] = [
  { name: "NVD", note: "public domain", url: "https://nvd.nist.gov/" },
  { name: "CISA KEV", note: "CC0", url: "https://www.cisa.gov/known-exploited-vulnerabilities-catalog" },
  { name: "Have I Been Pwned", note: "CC BY 4.0", url: "https://haveibeenpwned.com" },
  { name: "EPSS", note: "by FIRST", url: "https://www.first.org/epss/" },
  { name: "GDELT", note: null, url: "https://www.gdeltproject.org/" },
  { name: "arXiv", note: null, url: "https://arxiv.org/" },
];

export function SiteFooter() {
  const dot = <span className="text-faint">·</span>;
  return (
    <footer className="mt-8 border-t border-line">
      <div className="mx-auto max-w-7xl space-y-2.5 px-4 py-5 font-mono text-[12px] leading-relaxed text-dim">
        <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-1.5">
          <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-1 text-soft">
            <a className="hover:text-accent" href={SITE.github}>
              Code on GitHub
            </a>
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
          <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <span className="text-[11px] uppercase tracking-[0.12em] text-faint">Family</span>
            {SITE.family.map((f) => (
              <a key={f.url} className="hover:text-accent" href={f.url} title={f.blurb}>
                {f.name}
              </a>
            ))}
          </p>
        </div>
        <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-faint">
          <span>
            data{" "}
            <a className="text-dim hover:text-accent" href={SITE.dataLicense.url}>
              {SITE.dataLicense.name}
            </a>
          </span>
          {dot}
          <span>
            code{" "}
            <a className="text-dim hover:text-accent" href={SITE.codeLicense.url}>
              {SITE.codeLicense.name}
            </a>
          </span>
          {SOURCES.map((s) => (
            <Fragment key={s.url}>
              {dot}
              <span>
                <a className="text-dim hover:text-accent" href={s.url}>
                  {s.name}
                </a>
                {s.note && ` ${s.note}`}
              </span>
            </Fragment>
          ))}
          {dot}
          <Link className="text-dim hover:text-accent" href="/sources#licences">
            licences &amp; credits →
          </Link>
        </p>
        <p className="text-faint">This product uses the NVD API but is not endorsed or certified by the NVD.</p>
      </div>
    </footer>
  );
}
