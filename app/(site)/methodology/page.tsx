import type { Metadata } from "next";
import Link from "next/link";
import { CategoryBadge, SeverityBadge } from "@/components/ui/Badge";
import packages from "@/collector/config/packages.json";
import queries from "@/collector/config/queries.json";
import settings from "@/collector/config/settings.json";
import { RuleText } from "@/components/ui/RuleText";
import { COUNTING_RULES, DISCLOSED_RULE } from "@/lib/counting-rules";
import { CURATION_RULES } from "@/lib/curation-rules";
import { LANE_RULES, LIFECYCLE_RULES } from "@/lib/lifecycle";
import { SITE } from "@/lib/site";
import { ALIASES, DROPPED, TAG_GROUPS, TAG_GROUP_META } from "@/lib/tags";
import {
  ATLAS_RELEASE,
  ATLAS_TECHNIQUES,
  CATEGORIES,
  CATEGORY_META,
  INCIDENT_TYPES,
  LANES,
  LANE_META,
  OWASP_LLM_EDITION,
  PATCH_META,
  PATCH_STATUSES,
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
  description: "What counts as an incident, the lanes and their live windows, the AI lens, how records are found, deduplicated and classified, and the known limits of the numbers.",
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
  ["lanes", "Lanes and lifecycle"],
  ["tags", "Tags"],
  ["taxonomy", "Taxonomy"],
  ["standards", "Standards mapping"],
  ["pipeline", "How incidents are found and classified"],
  ["counting", "Counting rules"],
  ["cves", "AI vulnerability records"],
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
          {SITE.name} is an observatory, not a security product. It records live security incidents across the web in four lanes, keeps an AI lens on
          them, counts each once and links to the original reporting. This page is what makes the numbers citable: it says exactly what is counted, how,
          and where the counts are weak.
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
      <p>
        A record is one real-world event or flaw: a bug in software people run, something that happened to a named organisation or service, a malicious
        artefact with reach, or a research finding. It lands in one of four lanes:
      </p>
      <ul className="list-disc pl-5 space-y-1">
        {LANES.map((l) => (
          <li key={l}>
            <strong className="text-ink">{LANE_META[l].label}</strong>: {LANE_META[l].definition}
          </li>
        ))}
      </ul>
      <p>
        Every record also carries an <strong className="text-ink">AI role</strong>, and the AI counts on the site (the Trends charts, the weekly briefing,
        summary.json, the embed card and the chart images) cover the first two roles only:
      </p>
      <ul className="list-disc pl-5 space-y-1">
        {INCIDENT_TYPES.map((t) => (
          <li key={t}>
            <strong className="text-ink">{TYPE_META[t].label}</strong>: {TYPE_META[t].definition}
          </li>
        ))}
      </ul>
      <p>
        A record with no AI role is published only when it clears the curation bar, so the live lanes stay readable: it names what was affected, says what
        happened, and is one of the kinds below. AI records keep the inclusion rule above and use the bar as guidance.
      </p>
      <ol className="list-decimal pl-5 space-y-1">
        {CURATION_RULES.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ol>
      <p>
        Research papers and lab write-ups that demonstrate a working attack count (severity 1, the Research lane). CVEs and advisories for AI frameworks,
        model servers, agent tooling and AI products count once exploitation is confirmed (severity 3 or 4). Until then they are{" "}
        <a href="#cves" className="link">
          disclosed vulnerabilities
        </a>
        : kept, shown and downloadable as their own series, but not counted as incidents.
      </p>

      <H2 id="out-of-scope">What does not count</H2>
      <ul className="list-disc pl-5 space-y-1">
        <li>AI harms with no security angle: bias and discrimination, hallucination lawsuits, autonomous-vehicle crashes, job displacement, copyright suits.</li>
        <li>Product launches and vendor feature announcements, including launches of security products.</li>
        <li>Policy, regulation and standards news, surveys and &ldquo;report finds&rdquo; pieces, opinion, explainers and weekly roundups, unless they describe a specific incident.</li>
        <li>Papers that only propose defences or benchmarks.</li>
        <li>A follow-up report on an event already on record: it becomes a timeline entry on that record, never a new one.</li>
      </ul>

      <H2 id="lanes">Lanes and lifecycle</H2>
      <p>
        A record is <strong className="text-ink">live</strong> or <strong className="text-ink">closed</strong>, judged at every build from the record&rsquo;s latest
        dated activity (a timeline entry, a source, or the first report; never an edit). The windows, in days:
      </p>
      <dl className="divide-y divide-line-soft">
        {LANES.map((l) => {
          const r = LIFECYCLE_RULES[l];
          const text =
            "from_first_report_days" in r
              ? `live for ${r.from_first_report_days} days after the first report; updates do not extend it.`
              : "unpatched_days" in r
                ? `live for ${r.any_update_days} days after the latest activity, or ${r.unpatched_days} days while the fix status is "no patch yet" or "partly patched" ("fix status unknown" does not extend it).`
                : `live for ${r.any_update_days} days after the latest activity; a new report reopens it.`;
          return (
            <div key={l} className="grid gap-2 py-2.5 sm:grid-cols-[11rem_1fr] sm:gap-4">
              <dt className="text-[13px] text-ink">{LANE_META[l].label}</dt>
              <dd className="text-[13px]">{text}</dd>
            </div>
          );
        })}
      </dl>
      <p>
        A disclosed vulnerability is always closed. A record the collector closed stays closed; a new report about it reopens it with a timeline entry. The fix
        status of a patch or supply-chain record is one of:
      </p>
      <dl className="divide-y divide-line-soft">
        {PATCH_STATUSES.map((s) => (
          <div key={s} className="grid gap-2 py-2.5 sm:grid-cols-[11rem_1fr] sm:gap-4">
            <dt className="num text-[13px] text-ink">
              {PATCH_META[s].glyph} {PATCH_META[s].label}
            </dt>
            <dd className="text-[13px]">{PATCH_META[s].definition}</dd>
          </div>
        ))}
      </dl>
      <p>
        Records that predate the lanes were placed by fixed rules, in order; a record classified since then carries the lane the classifier gave it:
      </p>
      <ol className="list-decimal pl-5 space-y-1 text-[13px]">
        {LANE_RULES.map((r) => (
          <li key={r.id}>{r.text}</li>
        ))}
      </ol>
      <p className="text-[13px]">
        Every record&rsquo;s timeline starts with its reports, one entry per source; the collector appends an entry when a later report changes something.
        The newest entries across the site are in <span className="num text-[12px]">/changes.json</span>.
      </p>

      <H2 id="tags">Tags</H2>
      <p>
        The classifier writes short free-text tags; the site folds them into one spelling each (underscores, spaces and dots become dashes, {Object.keys(ALIASES).length}{" "}
        aliases such as &ldquo;denial-of-service&rdquo; → &ldquo;dos&rdquo; are merged, CVE ids and tags that only echo a category are left out) and files each
        under a group: {TAG_GROUPS.map((g) => TAG_GROUP_META[g].label.toLowerCase()).join(", ")}. A tag with two records, or one live record, gets a page, an
        RSS feed and an llms.txt. {DROPPED.size} tags are dropped as echoes or outcomes; the lists live in the repository at{" "}
        <span className="num text-[12px]">lib/tags.ts</span>.
      </p>

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
          <strong className="text-ink">Fetch.</strong> On its schedule (the Sources page lists it per source) a collector reads RSS and Atom feeds, official APIs and public data exports: security press,
          vendor and research blogs, Hacker News (via Algolia), GDELT, arXiv cs.CR, NVD, the GitHub Advisory Database, CISA KEV, MITRE ATLAS and the AI
          Incident Database. Query-driven sources run a maintained list of {queries.queries.length} search phrases.
        </li>
        <li>
          <strong className="text-ink">Pre-filter.</strong> Press and vendor items must mention a security term (or carry a CVE id) before any model sees them; an
          AI term only marks the item for the AI role. Specialist AI-security blogs and structured databases skip this gate.
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
        {COUNTING_RULES.map((r) => (
          <li key={r.id}>
            <RuleText text={r.text} />
          </li>
        ))}
      </ul>

      <H2 id="cves">AI vulnerability records</H2>
      <p>
        The collector reads CVEs and advisories for an allow-list of LLM and agent-era tooling from NVD, the GitHub Advisory Database and Microsoft&rsquo;s
        Security Update Guide: inference servers such as vLLM and Ollama, app builders such as Open WebUI, Langflow and Flowise, frameworks such as LangChain,
        MCP SDKs, AI coding tools and AI products. They are classified like everything else, under <em>infrastructure vulnerability</em>.
      </p>
      <p>
        A record with no confirmed exploitation is a <strong className="text-ink">disclosed vulnerability</strong>. It keeps severity 2 and its own page, appears
        on Trends as a separate monthly series and in the Archive under &ldquo;records&rdquo;, but it is not counted as an incident. Vendors
        and CVE numbering authorities file advisories in batches, as many as 30 for one product on one day, and more than 99% of these records never see a
        confirmed attack: counting them made the incident trend a measure of CVE issuance. A CVE becomes an incident, at severity 3, when CISA lists it as
        exploited or the vendor confirms exploitation.
      </p>
      <p>
        The exact rule: {DISCLOSED_RULE.charAt(0).toLowerCase() + DISCLOSED_RULE.slice(1)} Downloads keep every record; the CSV carries a <span className="num text-[12px]">record_kind</span> column and the compact JSON a{" "}
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
        UTC) that has just ended, over the AI records only (attacks on AI and AI-enabled attacks; the general lanes are not in it). It has two parts, made differently:
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
        are the reference. A briefing is a snapshot taken on Monday. Records first reported in that week but collected later are not added, so the Trends page,
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
        <li>
          2026-10-18 · records mapped to the OWASP Top 10 for LLM Applications ({OWASP_LLM_EDITION}) and MITRE ATLAS techniques (release {ATLAS_RELEASE}), derived
          from categories; explorer filters and CSV columns added.
        </li>
        <li>2026-10-18 · product watch pages: every product family with records gets a page listing its disclosed CVEs, confirmed exploitation and CISA KEV flags (the classifier&rsquo;s cisa-kev tag). No counting rule changed.</li>
        <li>2026-10-19 · weekly briefing added, &ldquo;This week in AI security&rdquo;: numbers from the data, narrative by a language model; backfilled for 2026-W35 to 2026-W42.</li>
        <li>
          2026-10-26 · site renamed GCD RADAR and widened to live security incidents across the web: four lanes (patch now, breaches & attacks, supply chain,
          research) with a live or closed state, a fix status and a timeline per record; a third AI role, &ldquo;no AI role&rdquo;; the live feed as the home page;
          the chart dashboard at /trends; a tag directory; feed.json, changes.json, llms.txt, per-lane and per-tag feeds and a Markdown brief per record. Every AI
          count (Trends, summary.json, the embed card, the briefing, the chart images) counts AI records only, so no existing number changed meaning.
        </li>
      </ul>
    </div>
  );
}
