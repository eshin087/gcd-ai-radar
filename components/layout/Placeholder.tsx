import Link from "next/link";

/** Temporary page body used until the real pages are built after the design pick. */
export function Placeholder({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-soft">{blurb}</p>
      <p className="text-[12px] text-dim">
        This page is built after a homepage layout is chosen.{" "}
        <Link href="/design-options" className="link">
          Review the design options →
        </Link>
      </p>
    </div>
  );
}
