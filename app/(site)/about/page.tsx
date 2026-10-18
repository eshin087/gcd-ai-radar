import type { Metadata } from "next";
import Link from "next/link";
import { RadarGlyph } from "@/components/layout/Wordmark";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "About",
  description: `${SITE.name} is made by GCD, part of the gcd family of projects alongside gcdatlas.com.`,
};

export default function AboutPage() {
  return (
    <div className="max-w-2xl space-y-8 text-[15px] leading-relaxed text-soft">
      <header className="space-y-3">
        <div className="flex items-center gap-3">
          <RadarGlyph size={36} className="text-accent" />
          <h1 className="font-display text-[28px] tracking-[0.08em] text-ink">{SITE.wordmark}</h1>
        </div>
        <p className="text-ink text-lg">{SITE.tagline}.</p>
        <p>
          {SITE.name} records, counts, categorizes and charts AI cybersecurity incidents so that anyone writing or speaking about the subject has a
          number they can cite, a definition they can quote and a source they can check. It is an observatory, not a security product: it does not
          detect, protect or advise.
        </p>
      </header>

      <section className="space-y-2">
        <h2 className="label">How it runs</h2>
        <p>
          A collector runs every six hours on GitHub Actions, reads feeds, official APIs and public data exports, deduplicates what it finds, classifies
          it with a language model and commits the result to a public repository. The site is rebuilt from that data. There is no database, no server
          and no recurring cost; everything is open at{" "}
          <a className="link" href={SITE.github}>
            github.com/eshin087/gcd-ai-radar
          </a>
          . The <Link href="/methodology" className="link">methodology</Link> says what counts and where the numbers are weak.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="label">The gcd family</h2>
        <ul className="space-y-1.5">
          {SITE.family.map((f) => (
            <li key={f.url}>
              <a className="link" href={f.url}>
                {f.name}
              </a>
              <span className="text-dim"> · {f.blurb}</span>
            </li>
          ))}
          <li>
            <a className="link" href="https://github.com/eshin087">
              github.com/eshin087
            </a>
            <span className="text-dim"> · everything else</span>
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="label">Licences and reuse</h2>
        <p>
          The dataset is{" "}
          <a className="link" href={SITE.dataLicense.url}>
            {SITE.dataLicense.name}
          </a>{" "}
          (it incorporates AI Incident Database metadata under the same licence) and the code is{" "}
          <a className="link" href={SITE.codeLicense.url}>
            {SITE.codeLicense.name}
          </a>
          . Cite the site as &ldquo;gcd AI Radar&rdquo; with a link and the date you accessed it; the <Link href="/data" className="link">data page</Link> has
          downloads and the full attribution block for upstream sources.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="label">Publishers and takedowns</h2>
        <p>
          The site stores a headline, a link and a date for each article it cites, plus a two-sentence summary written in its own words. It never
          stores article text, and it reads feeds and APIs the way they are offered. If you publish one of the sources listed here and would like a title
          or link removed, open an issue on the repository or contact the maintainer through GitHub; it will be removed.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="label">Privacy</h2>
        <p>No cookies, no trackers, no accounts. Vercel&rsquo;s privacy-friendly analytics may count page views; browser Do Not Track and Global Privacy Control are honoured.</p>
      </section>
    </div>
  );
}
