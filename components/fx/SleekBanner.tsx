"use client";

import { useId } from "react";

/**
 * Three-row box-drawing letterforms. Each character is drawn by its arms
 * (up, down, left, right) as vector strokes, so joins always meet exactly
 * whatever font the visitor has, and corners are rounded like ╭╮╰╯.
 */
const FONT: Record<string, [string, string, string]> = {
  G: ["╭──", "│╶╮", "╰─╯"],
  C: ["╭──", "│  ", "╰──"],
  D: ["┌─╮", "│ │", "└─╯"],
  A: ["╭─╮", "├─┤", "╵ ╵"],
  I: ["╷", "│", "╵"],
  R: ["┌─╮", "├┬╯", "╵╰─"],
  " ": ["  ", "  ", "  "],
};

type Arms = { u?: 1; d?: 1; l?: 1; r?: 1; round?: 1 };
const ARMS: Record<string, Arms> = {
  "─": { l: 1, r: 1 },
  "│": { u: 1, d: 1 },
  "╭": { r: 1, d: 1, round: 1 },
  "╮": { l: 1, d: 1, round: 1 },
  "╰": { u: 1, r: 1, round: 1 },
  "╯": { u: 1, l: 1, round: 1 },
  "┌": { r: 1, d: 1 },
  "┐": { l: 1, d: 1 },
  "└": { u: 1, r: 1 },
  "┘": { u: 1, l: 1 },
  "├": { u: 1, d: 1, r: 1 },
  "┤": { u: 1, d: 1, l: 1 },
  "┬": { l: 1, r: 1, d: 1 },
  "┴": { l: 1, r: 1, u: 1 },
  "╴": { l: 1 },
  "╶": { r: 1 },
  "╵": { u: 1 },
  "╷": { d: 1 },
};

const CW = 18; // cell width
const CH = 26; // cell height
const GAP = 9; // between letters

function cellPath(ch: string, x: number, y: number): string {
  const a = ARMS[ch];
  if (!a) return "";
  const mx = x + CW / 2;
  const my = y + CH / 2;
  const ends = {
    u: [mx, y],
    d: [mx, y + CH],
    l: [x, my],
    r: [x + CW, my],
  } as const;
  const keys = (["u", "d", "l", "r"] as const).filter((k) => a[k]);
  if (a.round && keys.length === 2) {
    const [p, q] = keys.map((k) => ends[k]);
    return `M${p![0]},${p![1]}Q${mx},${my} ${q![0]},${q![1]}`;
  }
  return keys.map((k) => `M${mx},${my}L${ends[k][0]},${ends[k][1]}`).join("");
}

export function SleekBanner({ text, className = "", label }: { text: string; className?: string; label?: string }) {
  const uid = useId().replace(/:/g, "");
  const letters: { d: string; x: number }[] = [];
  let x = 0;
  for (const chr of text.toUpperCase()) {
    const rows = FONT[chr] ?? FONT[" "]!;
    const w = Math.max(...rows.map((r) => [...r].length));
    let d = "";
    rows.forEach((row, ri) => [...row].forEach((ch, ci) => (d += cellPath(ch, x + ci * CW, ri * CH))));
    if (d) letters.push({ d, x });
    x += w * CW + GAP;
  }
  const W = x - GAP;
  const H = CH * 3;
  const pad = 6;
  return (
    <svg viewBox={`${-pad} ${-pad} ${W + pad * 2} ${H + pad * 2}`} className={`sleek-banner block h-auto w-full ${className}`} role="img" aria-label={label ?? text}>
      <defs>
        <linearGradient id={`ink-${uid}`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={W} y2="0">
          <stop offset="0%" stopColor="#8dfdb0" />
          <stop offset="38%" stopColor="#5fd4e6" />
          <stop offset="62%" stopColor="#9a76d4" />
          <stop offset="100%" stopColor="#8dfdb0" />
        </linearGradient>
        <linearGradient id={`shine-${uid}`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={W * 0.25} y2="0">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="50%" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          <animateTransform attributeName="gradientTransform" type="translate" values={`${-W * 0.4} 0; ${W * 1.2} 0; ${W * 1.2} 0`} keyTimes="0; 0.35; 1" dur="7s" begin="1.6s" repeatCount="indefinite" />
        </linearGradient>
        <filter id={`glow-${uid}`} x="-10%" y="-30%" width="120%" height="160%">
          <feGaussianBlur stdDeviation="2.6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* chromatic split: faint violet and cyan ghosts */}
      <g aria-hidden fill="none" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" opacity={0.35}>
        <g transform="translate(1.6 0.6)" stroke="#9a76d4">
          {letters.map((l, i) => (
            <path key={i} d={l.d} className="sleek-draw" style={{ animationDelay: `${i * 85 + 60}ms` }} pathLength={1} />
          ))}
        </g>
        <g transform="translate(-1.4 -0.4)" stroke="#5fd4e6">
          {letters.map((l, i) => (
            <path key={i} d={l.d} className="sleek-draw" style={{ animationDelay: `${i * 85 + 30}ms` }} pathLength={1} />
          ))}
        </g>
      </g>
      <g fill="none" stroke={`url(#ink-${uid})`} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" filter={`url(#glow-${uid})`}>
        {letters.map((l, i) => (
          <path key={i} d={l.d} className="sleek-draw" style={{ animationDelay: `${i * 85}ms` }} pathLength={1} />
        ))}
      </g>
      <g aria-hidden fill="none" stroke={`url(#shine-${uid})`} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" className="sleek-shine">
        {letters.map((l, i) => (
          <path key={i} d={l.d} />
        ))}
      </g>
    </svg>
  );
}
