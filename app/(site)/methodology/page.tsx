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
        Research papers and lab write-ups that demonstrate a working attack count (severity 1). Vulnerability records for AI frameworks, model
        servers, agent tooling and AI products count (severity 2, or 3 once exploitation is confirmed).
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
          <div key={c} className="grid grid-cols-[11rem_1fr] gap-3 py-2">
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
          <div key={s} className="grid grid-cols-[11rem_1fr] gap-3 py-2">
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
        <li>Monthly charts count each incident once, under its primary category.</li>
        <li>
          The default time axis is the <em>incident date</em> (when it happened, approximate dates allowed). A toggle switches to <em>first reported</em> (earliest
          source date). Incidents known only to the year are excluded from monthly series but counted in totals.
        </li>
        <li>The most recent two months are shaded as provisional: reporting lags events, so the latest bars will rise.</li>
        <li>&ldquo;This month&rdquo; compares the current month so far with the whole of last month; &ldquo;year to date&rdquo; compares the same calendar span of the previous year.</li>
        <li>The trend line is a least-squares fit over the visible window; the amber line is a three-month centred average.</li>
      </ul>

      <H2 id="cves">Vulnerability records</H2>
      <p>
        CVEs and advisories for an allow-list of LLM and agent-era tooling (inference servers such as vLLM and Ollama, app builders such as Open WebUI, Langflow
        and Flowise, frameworks such as LangChain, MCP SDKs, AI coding tools and AI products) are incidents too. They enter at severity 2 (disclosed
        vulnerability) under <em>infrastructure vulnerability</em>, and move to severity 3 when CISA lists them as exploited or a vendor confirms exploitation.
        They dominate raw volume, which is why every chart stacks severity and the real-world view exists. Classic deep-learning libraries (TensorFlow, Keras,
        PyTorch, ONNX) and generic automation tools (n8n) are deliberately excluded: their memory-safety and web CVEs are about the library, not about an AI
        system being attacked, and they would swamp the counts (TensorFlow alone had 277). The allow-list has {Object.values(packages.ghsa).flat().length}{" "}
        packages across {Object.keys(packages.ghsa).length} ecosystems plus {packages.nvd_keywords.length} NVD search terms; it lives in the repository at{" "}
        <span className="num text-[12px]">collector/config/packages.json</span>.
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
        <li><strong className="text-ink">Vulnerability volume.</strong> CVE records track disclosure activity in a chosen set of packages, not attacks; read them as attack surface, not as breaches.</li>
        <li><strong className="text-ink">Synthetic stub.</strong> While the collector has not yet published real incidents, the site shows a clearly labelled synthetic dataset so layouts can be judged. It is never mixed with real data.</li>
      </ul>

      <H2 id="changes">Change log</H2>
      <ul className="list-disc pl-5 space-y-1 num text-[12.5px]">
        <li>2026-10-18 · methodology published; collector sources and taxonomy frozen for v1.</li>
      </ul>
    </div>
  );
}
