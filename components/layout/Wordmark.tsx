import Link from "next/link";
import { SITE } from "@/lib/site";

export function RadarGlyph({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    >
      <circle cx="16" cy="16" r="13" opacity="0.35" />
      <circle cx="16" cy="16" r="7.5" opacity="0.6" />
      <path d="M16 16 L27 8.5" />
      <circle cx="16" cy="16" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="22.5" cy="20.5" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function Wordmark({ href = "/", className = "" }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap ${className}`} aria-label={`${SITE.name} home`}>
      <RadarGlyph className="text-accent" />
      <span className="wordmark">{SITE.wordmark}</span>
    </Link>
  );
}
