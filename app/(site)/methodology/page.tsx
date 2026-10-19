import type { Metadata } from "next";
import Link from "next/link";
import { CategoryBadge, SeverityBadge } from "@/components/ui/Badge";
import packages from "@/collector/config/packages.json";
import queries from "@/collector/config/queries.json";
import settings from "@/collector/config/settings.json";
import { SITE } from "@/lib/site";
import {
  ATLAS_RELEASE,
  ATLAS_TECHNIQUES,
  CATEGORIES,
  CATEGORY_META,
  OWASP_LLM_EDITION,
  OWASP_LLM_META,
  OWASP_NOT_DERIVED,
  REAL_WORLD_MIN_SEVERITY,
  SEVERITIES,
  SEVERITY_META,
  STANDARDS_BY_CATEGORY,
  STANDARDS_BY_TYPE_CATEGORY,
  TARGETS,
  TARGET_META,
  TYPE_META,
  atlasUrl,
  owaspLabel,
  type Category,
  type IncidentType,
  type StandardsRow,
} from "@/lib/taxonomy";

export const metadata: Metadata = {
  title: "Methodology",
  description: "What counts as an AI cybersecurity incident, what does not, how incidents are found, deduplicated and classified, and the known limits of the numbers.",
};

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="text-lg font-semibold tracking-tight pt-8 border-t border-line-soft scroll-mt-20">
      {children}
    </h2>
  );
}

/** One row of the standards table: the entries with links, or "none", then the reason. */
function StandardsCell({ row }: { row: StandardsRow }) {
  return (
    <dd className="text-[13px] space-y-1">
      <div>
        <span className="label mr-2">owasp</span>
        {row.owasp.length === 0 ? (
          <span className="text-dim">none</span>
        ) : (
          row.owasp.map((id, n) => (
            <span key={id}>
              {n > 0 && " · "}
              <a href={OWASP_LLM_META[id].url} className="link" rel="noopener noreferrer" target="_blank">
                <span className="num">{id}</span> {OWASP_LLM_META[id].name}
              </a>
            </span>
          ))
        )}
      </div>
      <div>
        <span className="label mr-2">atlas</span>
        {row.atlas.length === 0 ? (
          <span className="text-dim">none</span>
        ) : (
          row.atlas.map((id, n) => (
            <span key={id}>
              {n > 0 && " · "}
              <a href={atlasUrl(id)} className="link" rel="noopener noreferrer" target="_blank">
                <span className="num">{id}</span> {ATLAS_TECHNIQUES[id]}
              </a>
            </span>
          ))
        )}
      </div>
      <p className="text-[12.5px] text-dim">{row.why}</p>
    </dd>
  );
}

const TYPE_CATEGORY_ROWS = Object.entries(STANDARDS_BY_TYPE_CATEGORY).map(([key, row]) => {
  const [type, category] = key.split(":") as [IncidentType, Category];
  return { key, type, category, row: row! };
});

const SECTIONS = [
  ["scope", "What counts"],
  ["out-of-scope", "What does not count"],
  ["taxonomy", "Taxonomy"],
  ["standards", "Standards mapping"],
  ["pipeline", "How incidents are found and classified"],
  ["counting", "Counting rules"],
  ["cves", "Vulnerability records"],
  ["sources", "Sources we read, and sources we deliberately do not"],
  ["limits", "Limitations and biases"],
  ["changes", "Change log"],
] as const;

export default function MethodologyPage() {
  const threshold = settings.confidence_threshold;
  return (
    <div className="max-w-3xl text-[15px] leading-relaxed text-soft space-y-5">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Methodology</h1>
        <p>
          {SITE.name} is an observatory, not a security product. It records, counts, categorizes and charts AI cybersecurity incidents and links to
          the original reporting. This page is what makes the numbers citable: it says exactly what is counted, how, and where the counts are
          weak.
        </p>
        <nav aria-label="Sections" className="flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
          {SECTIONS.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="link">
              {label}
            </a>
          ))}
        </nav>
      </header>

      <H2 id="scope">What counts</H2>
      <p>An incident is in scope when it is one of two things, and the charts always keep them distinguishable:</p>
      <ul className="list-disc pl-5 space-y-1">
        <li>
          <strong className="text-ink">{TYPE_META.attack_on_ai.label}</strong>: {TYPE_META.attack_on_ai.definition}
        </li>
        <li>
          <strong className="text-ink">{TYPE_META.ai_enabled_attack.label}</strong>: {TYPE_META.ai_enabled_attack.definition}
        </li>
      </ul>
      <p>
        Research papers and lab write-ups that demonstrate a working attack count (severity 1). CVEs and advisories for AI frameworks, model servers,
        agent tooling and AI products count once exploitation is confirmed (severity 3 or 4). Until then they are{" "}
        <a href="#cves" className="link">
          disclosed vulnerabilities
        </a>
        : kept, shown and downloadable as their own series, but not counted as incidents.
      </p>

      <H2 id="out-of-scope">What does not count</H2>
      <ul className="list-disc pl-5 space-y-1">
        <li>AI harms with no security angle: bias and discrimination, hallucination lawsuits, autonomous-vehicle crashes, job displacement, copyright suits.</li>
        <li>Product launches and vendor feature announcements, including launches of AI security products.</li>
        <li>Policy, regulation and standards news, surveys and &ldquo;report finds&rdquo; pieces, opinion and explainers, unless they describe a specific incident.</li>
        <li>Papers that only propose defences or benchmarks.</li>
        <li>Cybersecurity incidents in which AI plays no meaningful role.</li>
      </ul>

      <H2 id="taxonomy">Taxonomy</H2>
      <p>An incident has exactly one type, one to four categories (the first is primary), exactly one severity, and one or more targets.</p>
      <h3 className="text-[13px] font-medium text-ink mt-4">Categories</h3>
      <dl className="divide-y divide-line-soft">
        {CATEGORIES.map((c) => (
          <div key={c} className="grid gap-2 py-2.5 sm:grid-cols-[max-content_1fr] sm:gap-4">
            <dt>
              <CategoryBadge category={c} short={false} />
            </dt>
            <dd className="text-[13px]">{CATEGORY_META[c].definition}</dd>
          </div>
        ))}
      </dl>
      <h3 className="text-[13px] font-medium text-ink mt-4">Severity</h3>
      <dl className="divide-y divide-line-soft">
        {SEVERITIES.map((s) => (
          <div key={s} className="grid gap-2 py-2.5 sm:grid-cols-[max-content_1fr] sm:gap-4">
            <dt>
              <SeverityBadge severity={s} short={false} />
            </dt>
            <dd className="text-[13px]">{SEVERITY_META[s].definition}</dd>
          </div>
        ))}
      </dl>
      <p>
        Severity {REAL_WORLD_MIN_SEVERITY} and above is what the site calls <em>real-world</em>. The dashboard&rsquo;s &ldquo;real-world only&rdquo; view
        excludes research findings and unexploited vulnerabilities.
      </p>
      <h3 className="text-[13px] font-medium text-ink mt-4">Targets</h3>
      <p className="text-[13px]">
        Targets are normalised to a short controlled list; a free-text product field sits alongside.{" "}
        {TARGETS.map((t) => TARGET_META[t].label).join(" · ")}.
      </p>

      <H2 id="standards">Standards mapping</H2>
      <p>
        Every record is also expressed in two public frameworks, so security teams can filter and cite in the vocabulary they already use: the{" "}
        <a href="https://genai.owasp.org/llm-top-10/" className="link" rel="noopener noreferrer" target="_blank">
          OWASP Top 10 for LLM Applications
        </a>{" "}
        ({OWASP_LLM_EDITION} edition) and{" "}
        <a href="https://atlas.mitre.org/" className="link" rel="noopener noreferrer" target="_blank">
          MITRE ATLAS
        </a>{" "}
        techniques (data release {ATLAS_RELEASE}). OWASP names the weakness in an LLM application; ATLAS names what the adversary did.
      </p>
      <p>
        The mapping is <strong className="text-ink">derived from the categories</strong>, not classified per record. Each category, and where the type changes its
        meaning a type and category pair, maps to fixed entries in the table below. A record carries the union over its categories. The same type and categories
        always give the same entries, and changing the table re-maps every record at the next build without re-classifying anything.
      </p>
      <p>
        The rule for a row: an entry is listed only when the category, as defined above, falls within what the entry itself describes. A category that
        straddles several entries, or fits none, maps to nothing rather than to a stretch. A record with no entry is not evidence that no entry applies; it means
        the category alone cannot say which.
      </p>
      <h3 className="text-[13px] font-medium text-ink mt-4">By category</h3>
      <dl className="divide-y divide-line-soft">
        {CATEGORIES.map((c) => (
          <div key={c} className="grid gap-2 py-3 sm:grid-cols-[11rem_1fr] sm:gap-3">
            <dt>
              <CategoryBadge category={c} short={false} />
            </dt>
            <StandardsCell row={STANDARDS_BY_CATEGORY[c]} />
          </div>
        ))}
      </dl>
      <h3 className="text-[13px] font-medium text-ink mt-4">Where the type changes the answer</h3>
      <dl className="divide-y divide-line-soft">
        {TYPE_CATEGORY_ROWS.map(({ key, type, category, row }) => (
          <div key={key} className="grid gap-2 py-3 sm:grid-cols-[11rem_1fr] sm:gap-3">
            <dt className="text-[13px] text-ink">
              {TYPE_META[type].label} + {CATEGORY_META[category].label.toLowerCase()}
            </dt>
            <StandardsCell row={row} />
          </div>
        ))}
      </dl>
      <h3 className="text-[13px] font-medium text-ink mt-4">OWASP entries never derived</h3>
      <p className="text-[13px]">
        No category isolates{" "}
        {OWASP_NOT_DERIVED.map((id, n) => (
          <span key={id}>
            {n > 0 && (n === OWASP_NOT_DERIVED.length - 1 ? " or " : ", ")}
            <a href={OWASP_LLM_META[id].url} className="link" rel="noopener noreferrer" target="_blank">
              <span className="num">{owaspLabel(id)}</span> {OWASP_LLM_META[id].name}
            </a>
          </span>
        ))}
        , so no record is tagged with them, though some records involve them: a system prompt exposed in a data leak, or a package name an LLM hallucinated. The
        explorer&rsquo;s OWASP filter lists only the entries the table can produce.
      </p>
      <h3 className="text-[13px] font-medium text-ink mt-4">Limits</h3>
      <ul className="list-disc pl-5 space-y-1 text-[13px]">
        <li>The mapping inherits every classification error: a record in the wrong category gets the wrong entries.</li>
        <li>
          Counting by OWASP entry or ATLAS technique is counting by category in another vocabulary. The numbers are no more precise than the categories.
        </li>
        <li>
          LLM03 Supply Chain includes every infrastructure vulnerability, following OWASP&rsquo;s own first example. Most disclosed CVEs therefore carry LLM03;
          they stay out of incident counts as described under{" "}
          <a href="#cves" className="link">
            vulnerability records
          </a>
          .
        </li>
        <li>New OWASP editions and ATLAS releases are checked when they appear; a change to the table is recorded in the change log below.</li>
      </ul>
      <p className="text-[12.5px] text-dim">
        OWASP Top 10 for LLM Applications © OWASP Foundation, CC BY-SA 4.0. MITRE ATLAS © 2021-2026 The MITRE Corporation, Apache 2.0. Entry ids and names are
        used to reference them; the mapping is {SITE.name}&rsquo;s own and is not endorsed by OWASP or MITRE.
      </p>

      <H2 id="pipeline">How incidents are found and classified</H2>
      <ol className="list-decimal pl-5 space-y-2">
        <li>
          <strong className="text-ink">Fetch.</strong> Every six hours a collector reads RSS and Atom feeds, official APIs and public data exports: security press,
          vendor and research blogs, Hacker News (via Algolia), GDELT, arXiv cs.CR, NVD, the GitHub Advisory Database, CISA KEV, MITRE ATLAS and the AI
          Incident Database. Query-driven sources run a maintained list of {queries.queries.length} search phrases.
        </li>
        <li>
          <strong className="text-ink">Pre-filter.</strong> Press and vendor items must mention both an AI term and a security term before any model sees them;
          specialist AI-security blogs and structured databases skip this gate.
        </li>
        <li>
          <strong className="text-ink">Deduplicate.</strong> Links are canonicalised (tracking parameters, AMP variants and the like removed). A link already seen is
          skipped. A shared CVE id merges records. Titles are compared against recent incidents (token overlap plus edit distance): near-identical headlines merge
          automatically, reworded ones are put to a language model with the question &ldquo;same incident?&rdquo;, and records that carry different CVE ids never merge.
          Candidates in the same run are grouped the same way.
        </li>
        <li>
          <strong className="text-ink">Classify.</strong> A language model (Gemini, with Groq as fallback) reads the title, the feed description or page summary and any
          vulnerability metadata, and returns a strict JSON record: in scope or not, type, categories, severity, targets, products, incident date, a two-sentence
          summary in its own words, tags and a confidence score. The response is validated against the schema; invalid responses are retried once, then queued.
        </li>
        <li>
          <strong className="text-ink">Decide.</strong> In scope with confidence ≥ {threshold}: published. In scope below {threshold}: held for human review. Out of scope with
          confidence ≥ {threshold}: rejected, with the reason logged for auditing. Out of scope below {threshold}: held for review. Nothing is published unclassified; if
          every model is unavailable, candidates wait for the next run.
        </li>
      </ol>
      <p>
        Only titles, links, dates and the site&rsquo;s own summaries are stored. Article text is never kept. Page fetches for metadata respect robots.txt.
      </p>

      <H2 id="counting">Counting rules</H2>
      <ul className="list-disc pl-5 space-y-1">
        <li>One real-world event is one incident, however many articles cover it. Each article becomes a source on that incident.</li>
        <li>
          Disclosed vulnerabilities, CVEs and advisories with no confirmed exploitation, are never part of an incident count, chart, tile or the RSS feed. The
          dashboard shows them as a separate monthly series.
        </li>
        <li>Monthly charts count each incident once, under its primary category.</li>
        <li>
          The default time axis is the <em>incident date</em> (when it happened, approximate dates allowed). A toggle switches to <em>first reported</em> (earliest
          source date). Incidents known only to the year are excluded from monthly series but counted in totals.
        </li>
        <li>The most recent two months are marked provisional: reporting lags events, so the latest bars will rise.</li>
        <li>&ldquo;This month&rdquo; compares the current month so far with the whole of last month; &ldquo;year to date&rdquo; compares the same calendar span of the previous year.</li>
        <li>The trend line is a least-squares fit over the visible window; the amber line is a three-month centred average.</li>
      </ul>

      <H2 id="cves">Vulnerability records</H2>
      <p>
        The collector reads CVEs and advisories for an allow-list of LLM and agent-era tooling from NVD, the GitHub Advisory Database and Microsoft&rsquo;s
        Security Update Guide: inference servers such as vLLM and Ollama, app builders such as Open WebUI, Langflow and Flowise, frameworks such as LangChain,
        MCP SDKs, AI coding tools and AI products. They are classified like everything else, under <em>infrastructure vulnerability</em>.
      </p>
      <p>
        A record with no confirmed exploitation is a <strong className="text-ink">disclosed vulnerability</strong>. It keeps severity 2 and its own page, appears
        on the dashboard as a separate monthly series and in the incidents explorer under &ldquo;records&rdquo;, but it is not counted as an incident. Vendors
        and CVE numbering authorities file advisories in batches, as many as 30 for one product on one day, and more than 99% of these records never see a
        confirmed attack: counting them made the incident trend a measure of CVE issuance. A CVE becomes an incident, at severity 3, when CISA lists it as
        exploited or the vendor confirms exploitation.
      </p>
      <p>
        The exact rule: a record is a disclosed vulnerability when its severity is below 3 and it either comes from the NVD or GitHub advisory backfills or
        every one of its sources is a vulnerability database. Anything reported by the press or by researchers counts as an incident. Downloads keep every
        record; the CSV carries a <span className="num text-[12px]">record_kind</span> column and the compact JSON a{" "}
        <span className="num text-[12px]">disclosed</span> flag.
      </p>
      <p>
        Classic deep-learning libraries (TensorFlow, Keras,
        PyTorch, ONNX) and generic automation tools (n8n) are deliberately excluded: their memory-safety and web CVEs are about the library, not about an AI
        system being attacked, and they would swamp the disclosed series (TensorFlow alone had 299). The allow-list has {Object.values(packages.ghsa).flat().length}{" "}
        packages across {Object.keys(packages.ghsa).length} ecosystems plus {packages.nvd_keywords.length} NVD search terms; it lives in the repository at{" "}
        <span className="num text-[12px]">collector/config/packages.json</span>.
        Pre-LLM ML platforms (MLflow, NVIDIA Triton Inference Server, Ray), classic cloud ML services (Azure AI Search, Face and Language, Vertex AI
        Workbench) and general apps whose CVE only touches an AI or MCP feature are excluded for the same reason.
      </p>

      <H2 id="sources">Sources we read, and sources we deliberately do not</H2>
      <p>
        The <Link href="/sources" className="link">Sources page</Link> lists every feed, API and dataset with its licence and live health. Some well-known outlets are
        not polled: Google News RSS (robots.txt disallows it and the feed licence allows personal readers only), The Register (robots.txt denies all crawlers not
        explicitly allowed) and Condé Nast titles such as Wired and Ars Technica (their terms forbid automated access and storage). Their articles still appear as
        sources when another source surfaces them.
      </p>

      <H2 id="limits">Limitations and biases</H2>
      <ul className="list-disc pl-5 space-y-1">
        <li><strong className="text-ink">English-language press.</strong> Every feed is English; incidents covered only in other languages are missed.</li>
        <li><strong className="text-ink">Reporting lag.</strong> Incidents are often reported weeks after they happen; recent months undercount.</li>
        <li><strong className="text-ink">Researcher-heavy early years.</strong> Before 2023 most records come from research write-ups and case studies, not news.</li>
        <li><strong className="text-ink">Classification error.</strong> A language model assigns type, categories and severity. Spot checks and the review queue catch some mistakes, not all; confidence is shown on every record.</li>
        <li><strong className="text-ink">Source coverage.</strong> Counts rise when sources are added. Changes are listed below.</li>
        <li><strong className="text-ink">Vulnerability volume.</strong> Disclosed vulnerabilities track disclosure activity in a chosen set of packages, not attacks. They are shown as attack surface, apart from the incident counts.</li>
      </ul>

      <H2 id="changes">Change log</H2>
      <ul className="list-disc pl-5 space-y-1 num text-[12.5px]">
        <li>2026-10-18 · methodology published; collector sources and taxonomy frozen for v1.</li>
        <li>2026-10-18 · GitHub advisories and NVD backfilled from 2016.</li>
        <li>2026-10-18 · CVE allow-list narrowed to LLM and agent-era tooling; 522 records for dropped packages retired (TensorFlow 299, n8n 135, Keras 22, others 66).</li>
        <li>2026-10-18 · dashboard redesigned; every count opens its incidents, and category colours follow the seven families.</li>
        <li>2026-10-18 · CVE merging fixed: a record now joins the incident about its own CVE, not one that merely cites it; 6 misplaced sources moved, 2 duplicate pairs merged, 1 lost CVE restored.</li>
        <li>2026-10-18 · CVE allow-list narrowed again after an audit of the NVD backfill; 171 records retired (MLflow 80, NVIDIA Triton 65, Ray 10, generic apps and classic cloud ML services 16).</li>
        <li>2026-10-18 · CVEs and advisories with no confirmed exploitation leave the incident counts and become a separate series, &ldquo;disclosed vulnerabilities&rdquo;.</li>
        <li>2026-10-18 · site renamed GCD AI RADAR; dashboard charts redrawn as a family stream, slope, radar, severity heatmap, target bubbles, flow, calendar and running total. No counting rule changed.</li>
        <li>
          2026-10-18 · records mapped to the OWASP Top 10 for LLM Applications ({OWASP_LLM_EDITION}) and MITRE ATLAS techniques (release {ATLAS_RELEASE}), derived
          from categories; explorer filters and CSV columns added.
        </li>
        <li>2026-10-18 · product watch pages: every product family with records gets a page listing its disclosed CVEs, confirmed exploitation and CISA KEV flags (the classifier&rsquo;s cisa-kev tag). No counting rule changed.</li>
      </ul>
    </div>
  );
}
