import Link from "next/link";
import { SITE } from "@/lib/site";

/** The sweep's trail behind the beam, in angular bands that fade out (no gradient, so no SVG ids to collide). */
const TRAIL = [
  { d: "M16 16 L30 16 A14 14 0 0 0 29.32 11.67 Z", o: 0.48 },
  { d: "M16 16 L29.32 11.67 A14 14 0 0 0 26.72 7 Z", o: 0.3 },
  { d: "M16 16 L26.72 7 A14 14 0 0 0 21.92 3.31 Z", o: 0.16 },
  { d: "M16 16 L21.92 3.31 A14 14 0 0 0 14.78 2.05 Z", o: 0.07 },
];

/**
 * The radar mark: two range rings, a beam with its fading trail and a red
 * contact. `live` turns the beam clockwise and lights the contact as the beam
 * crosses it (globals.css, .brand-*); under reduced motion it holds the
 * static pose that public/favicon.svg draws.
 */
export function RadarMark({ size = 26, live = false, className }: { size?: number; live?: boolean; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className={`shrink-0 ${className ?? ""}`}>
      <circle cx="16" cy="16" r="14" fill="none" stroke="#ffb35c" strokeOpacity=".38" strokeWidth="1.6" />
      <circle cx="16" cy="16" r="8.5" fill="none" stroke="#ffb35c" strokeOpacity=".58" strokeWidth="1.6" />
      <g transform="rotate(-40 16 16)">
        <g className={live ? "brand-sweep" : undefined}>
          {TRAIL.map((t) => (
            <path key={t.d} d={t.d} fill="#ffb35c" fillOpacity={t.o} />
          ))}
          <path d="M16 16 L30 16" stroke="#ffd6a3" strokeWidth="1.8" strokeLinecap="round" />
        </g>
      </g>
      <circle cx="16" cy="16" r="2" fill="#ffd6a3" />
      {live && <circle cx="22.5" cy="21" r="1.6" fill="none" stroke="#ff6b5e" strokeWidth="0.8" className="brand-ping" />}
      <circle cx="22.5" cy="21" r="1.7" fill="#ff6b5e" className={live ? "brand-blip" : undefined} />
    </svg>
  );
}

/** The static mark at a small size (about page, embed card). */
export function RadarGlyph({ size = 18, className }: { size?: number; className?: string }) {
  return <RadarMark size={size} className={className} />;
}

/** The logo: the turning radar mark beside "GCD" in ink and "AI RADAR" in the accent, in the site sans. */
export function Wordmark({ href = "/", className = "" }: { href?: string; className?: string }) {
  const [lead, ...rest] = SITE.wordmark.split(" ");
  return (
    <Link href={href} className={`inline-flex shrink-0 items-center gap-2.5 whitespace-nowrap ${className}`} aria-label={`${SITE.name} home`}>
      <RadarMark live />
      <span className="font-sans text-[17px] font-semibold tracking-[-0.01em] text-ink">
        {lead} <span className="text-accent">{rest.join(" ")}</span>
      </span>
    </Link>
  );
}
