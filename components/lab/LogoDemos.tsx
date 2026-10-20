"use client";

import { useId, type ReactNode } from "react";

/** A: a radar mark whose sweep turns, beside a clean sans wordmark. */
export function LogoRadar({ size = 26, iconOnly = false }: { size?: number; iconOnly?: boolean }) {
  const id = useId();
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0">
        <defs>
          <linearGradient id={`${id}-sweep`} x1="16" y1="16" x2="30" y2="6" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#ffb35c" stopOpacity=".9" />
            <stop offset="1" stopColor="#ffb35c" stopOpacity="0" />
          </linearGradient>
        </defs>
        <circle cx="16" cy="16" r="14" fill="none" stroke="#ffb35c" strokeOpacity=".35" strokeWidth="1.6" />
        <circle cx="16" cy="16" r="8.5" fill="none" stroke="#ffb35c" strokeOpacity=".55" strokeWidth="1.6" />
        <g className="logo-sweep" style={{ transformOrigin: "16px 16px" }}>
          <path d="M16 16 L30 16 A14 14 0 0 0 25.9 6.1 Z" fill={`url(#${id}-sweep)`} />
          <path d="M16 16 L30 16" stroke="#ffd6a3" strokeWidth="1.8" strokeLinecap="round" />
        </g>
        <circle cx="16" cy="16" r="2" fill="#ffd6a3" />
        <circle cx="22.5" cy="21" r="1.6" fill="#ff6b5e" className="logo-blip" />
      </svg>
      {!iconOnly && (
        <span className="font-sans text-[17px] font-semibold tracking-[-0.01em] text-ink">
          GCD <span className="text-accent">AI RADAR</span>
        </span>
      )}
    </span>
  );
}

/** B: the wordmark as a terminal line, with a live pulse and a blinking cursor. */
export function LogoTerminal() {
  return (
    <span className="inline-flex items-center gap-2 font-mono text-[14.5px] font-semibold tracking-[0.06em]">
      <span className="relative inline-flex h-2.5 w-2.5">
        <span className="absolute inset-0 animate-ping rounded-full bg-[#5fd38d] opacity-60" />
        <span className="relative h-2.5 w-2.5 rounded-full bg-[#5fd38d]" />
      </span>
      <span className="text-dim">~/</span>
      <span className="text-ink">GCD</span>
      <span className="text-accent">AI&nbsp;RADAR</span>
      <span className="cursor-block cursor-blink" />
    </span>
  );
}

/** C: a monogram badge (a G drawn as a radar arc) and a light, spaced wordmark. */
export function LogoBadge({ size = 30, iconOnly = false }: { size?: number; iconOnly?: boolean }) {
  const id = useId();
  return (
    <span className="inline-flex items-center gap-3">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0">
        <defs>
          <linearGradient id={`${id}-edge`} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#ffb35c" />
            <stop offset="1" stopColor="#7fdcff" />
          </linearGradient>
        </defs>
        <rect x="1" y="1" width="30" height="30" rx="8" fill="#0d1220" stroke={`url(#${id}-edge)`} strokeWidth="1.5" />
        <path d="M22.5 11.2 A8 8 0 1 0 24 17.5 L17 17.5" fill="none" stroke="#e8edf8" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="22.4" cy="11.3" r="1.7" fill="#ffb35c" className="logo-blip" />
      </svg>
      {!iconOnly && (
        <span className="font-sans text-[13px] font-light tracking-[0.32em] text-soft">
          GCD <span className="font-medium text-ink">AI RADAR</span>
        </span>
      )}
    </span>
  );
}

const NAV = ["Dashboard", "Incidents", "Briefing", "Products", "Methodology", "Data"];

/** The logo in a header bar, plus small sizes. */
export function HeaderMock({ logo, small }: { logo: ReactNode; small?: ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex h-16 items-center justify-between gap-6 rounded-lg border border-line bg-[#05070d] px-5">
        {logo}
        <nav className="hidden gap-6 md:flex">
          {NAV.map((n) => (
            <span key={n} className="label">
              {n}
            </span>
          ))}
        </nav>
      </div>
      {small && <div className="flex items-center gap-5 px-1 text-[12px] text-dim">{small}</div>}
    </div>
  );
}
