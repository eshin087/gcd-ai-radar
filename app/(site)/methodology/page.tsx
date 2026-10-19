import type { Metadata } from "next";
import Link from "next/link";
import { CategoryBadge, SeverityBadge } from "@/components/ui/Badge";
import packages from "@/collector/config/packages.json";
import queries from "@/collector/config/queries.json";
import settings from "@/collector/config/settings.json";
import { SITE } from "@/lib/site";
import { CATEGORIES, CATEGORY_META, REAL_WORLD_MIN_SEVERITY, SEVERITIES, SEVERITY_META, TARGETS, TARGET_META, TYPE_META } from "@/lib/taxonomy";

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

const SECTIONS = [
  ["scope", "What counts"],
  ["out-of-scope", "What does not count"],
  ["taxonomy", "Taxonomy"],
  ["pipeline", "How incidents are found and classified"],
  ["counting", "Counting rules"],
  ["cves", "Vulnerability records"],
  ["briefing", "The weekly briefing"],
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

      <H2 id="briefing">The weekly briefing</H2>
      <p>
        <Link href="/briefing" className="link">This week in AI security</Link> is written every Monday at 06:17 UTC for the ISO week (Monday to Sunday,
        UTC) that has just ended. It has two parts, made differently:
      </p>
      <ul className="list-disc pl-5 space-y-1">
        <li>
          <strong className="text-ink">The numbers and the list come from the data.</strong> A record belongs to the week of its first-reported date. The
          counts follow the rules above: disclosed CVEs are a separate line, never incidents. The comparison is with the week before, counted from the same
          records. The busiest family is the one with the most incidents by primary category, the top targets leave out &ldquo;not applicable&rdquo;, and the
          five most notable incidents are ranked by severity, then number of sources. Anyone can recompute all of it from the dataset.
        </li>
        <li>
          <strong className="text-ink">The narrative is written by a language model.</strong> The classifier model (Gemini, with Groq as fallback) is given
          only the week&rsquo;s counts and records (titles, summaries, severities, families and targets) and asked for 120 to 180 words that use nothing else.
          The reply is validated before it is kept: every count in it must be one of the week&rsquo;s numbers or appear in the records, and it may not call a
          count unchanged when it changed, contain links, or run too long or short. A reply that fails twice is discarded. If no model is available the
          briefing is published with the numbers and the list only, and says so.
        </li>
      </ul>
      <p>
        Limits: the checks catch wrong numbers, not every wrong word, so a narrative can still misstate what a record says; the incident pages and their sources
        are the reference. A briefing is a snapshot taken on Monday. Records first reported in that week but collected later are not added, so the dashboard,
        which recounts on every build, can show more for the same week. A week with few incidents is described from few records, and its comparison with the
        week before can swing widely.
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
        <li>2026-10-19 · weekly briefing added, &ldquo;This week in AI security&rdquo;: numbers from the data, narrative by a language model; backfilled for 2026-W35 to 2026-W42.</li>
      </ul>
    </div>
  );
}
