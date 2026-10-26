import type { Metadata } from "next";
import Link from "next/link";
import { RadarGlyph } from "@/components/layout/Wordmark";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "About",
  description: `${SITE.name} is made by GCD, part of the gcd family of projects alongside gcdatlas.com.`,
};

const CARDS = [
  { href: "/methodology", title: "Methodology", blurb: "What counts, the lanes and their live windows, the taxonomy, the counting rules, and where the numbers are weak." },
  { href: "/sources", title: "Sources", blurb: "Every feed, API and dataset the collector reads, with its licence, its terms and its schedule." },
  { href: "/sources#licences", title: "Licences and credits", blurb: "The data is CC BY-SA 4.0 and the code MIT; the upstream notices to keep when you redistribute." },
] as const;

export default function AboutPage() {
  return (
    <div className="max-w-2xl space-y-8 text-[15px] leading-relaxed text-soft">
      <header className="space-y-3">
        <div className="flex items-center gap-3">
          <RadarGlyph size={36} className="text-accent" />
          <h1 className="text-[28px] font-semibold tracking-tight text-ink">{SITE.wordmark}</h1>
        </div>
        <p className="text-lg text-ink">{SITE.tagline}.</p>
        <p>
          {SITE.name} records live security incidents across the web, in four lanes (patch now, breaches and attacks, supply chain, research), and keeps an AI
          lens on them: attacks on AI systems and AI-enabled attacks are marked, counted and charted on their own, so that anyone writing or speaking about the
          subject has a number they can cite, a definition they can quote and a source they can check. It is an observatory, not a security product: it does
          not detect or protect, and what it says to do is a pointer to the vendor&rsquo;s advisory, never a substitute for it.
        </p>
      </header>

      <ul className="grid gap-3 sm:grid-cols-3">
        {CARDS.map((c) => (
          <li key={c.href} className="rounded-[2px] border border-line p-4">
            <Link href={c.href} className="text-[15px] font-medium text-ink hover:text-accent">
              {c.title} →
            </Link>
            <p className="mt-1.5 text-[13px] leading-relaxed text-dim">{c.blurb}</p>
          </li>
        ))}
      </ul>

      <section className="space-y-2">
        <h2 className="label">How it runs</h2>
        <p>
          A collector runs on GitHub Actions on the schedule listed on the Sources page, reads feeds, official APIs and public data exports, deduplicates
          what it finds, classifies it with a language model and commits the result to a public repository. The site is rebuilt from that data. There is no
          database, no server and no recurring cost; everything is open at{" "}
          <a className="link" href={SITE.github}>
            github.com/eshin087/gcd-ai-radar
          </a>
          .
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
          . Cite the site as &ldquo;{SITE.name}&rdquo; with a link and the date you accessed it; the <Link href="/data" className="link">data page</Link> has
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
