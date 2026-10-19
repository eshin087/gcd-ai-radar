import type { Metadata } from "next";
import Link from "next/link";
import { ProductTable, type ProductRow } from "@/components/products/ProductTable";
import { loadIncidents } from "@/lib/data";
import { productIndex } from "@/lib/products";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Products",
  description: "Every AI product and framework with records: disclosed CVEs, confirmed exploitation and CISA KEV flags, one page per product.",
};

export default async function ProductsPage() {
  const { incidents } = await loadIncidents();
  const index = productIndex(incidents);
  const rows: ProductRow[] = index.map(({ label, slug, records, incidents, disclosed, exploited, kev, bySeverity, latest }) => ({
    label,
    slug,
    records,
    incidents,
    disclosed,
    exploited,
    kev,
    bySeverity,
    latest,
  }));
  const exploited = index.filter((p) => p.exploited > 0).length;

  return (
    <div className="max-w-5xl space-y-6">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Products</h1>
        <p className="max-w-3xl text-[14.5px] leading-relaxed text-soft">
          A product page gathers every record that names one AI product or framework: CVEs disclosed against it, incidents in which it was exploited, and
          anything flagged as listed in CISA&rsquo;s Known Exploited Vulnerabilities catalog, newest first. It is a watch list for deciding what to look at,
          not patch advice: {SITE.name} does not track versions or fixes, and every record links to the advisory or report it came from, so check the
          vendor&rsquo;s advisory for what to upgrade. Names are grouped into families (&ldquo;Langflow OSS&rdquo; is Langflow); a record that names two
          products appears on both pages.
        </p>
        <p className="text-[12.5px] text-dim">
          {index.length.toLocaleString("en-US")} product families, {exploited.toLocaleString("en-US")} with confirmed exploitation (severity 3–4).{" "}
          <Link href="/methodology#cves" className="link">
            How disclosed CVEs are counted
          </Link>
        </p>
      </header>
      <ProductTable products={rows} />
    </div>
  );
}
