import Link from "next/link";
import { SITE } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="border-t border-line mt-16">
      <div className="mx-auto max-w-7xl px-4 py-8 grid gap-6 md:grid-cols-3 text-[12px] text-dim">
        <div className="space-y-2">
          <div className="label">made by GCD</div>
          <p>
            {SITE.name} is a non-commercial reference site. It stores titles, links and its own
            two-sentence summaries, never article text, and links to original reporting.
          </p>
          <p>
            <a className="link" href={SITE.github}>the code on GitHub</a> ·{" "}
            <Link className="link" href="/api">API, embed and citation</Link>
          </p>
        </div>
        <div className="space-y-2">
          <div className="label">licences</div>
          <p>
            data <a className="link" href={SITE.dataLicense.url}>{SITE.dataLicense.name}</a> · code{" "}
            <a className="link" href={SITE.codeLicense.url}>{SITE.codeLicense.name}</a>
          </p>
          <p>
            Includes data from the AI Incident Database (CC BY-SA 4.0), MITRE ATLAS (Apache 2.0), NVD,
            the GitHub Advisory Database (CC BY 4.0) and CISA KEV (CC0). This product uses the NVD API
            but is not endorsed or certified by the NVD.
          </p>
        </div>
        <div className="space-y-2">
          <div className="label">credits</div>
          <p>
            Powered by <a className="link" href="https://www.gdeltproject.org/">GDELT</a>. Search powered by{" "}
            <a className="link" href="https://hn.algolia.com/">Algolia</a>. Thank you to arXiv for use of its
            open access interoperability. Traffic signal:{" "}
            <a className="link" href="https://radar.cloudflare.com/">Cloudflare Radar</a> (CC BY-NC 4.0).
          </p>
          <p>
            family:{" "}
            {SITE.family.map((f, i) => (
              <span key={f.url}>
                {i > 0 && " · "}
                <a className="link" href={f.url}>{f.name}</a>
              </span>
            ))}
            {" · "}
            <Link className="link" href="/about">about</Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
