"use client";

import { useEffect, useRef } from "react";
import { BUILD_GLYPHS } from "@/components/fx/ascii";
import { useBuild } from "@/components/home/panel/useBuild";

/**
 * The panel's small live pieces. Each writes its own text into an element
 * React rendered once and never re-renders, so the server's markup stays the
 * no-JS fallback.
 */

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");

/** Time left until the end of a UTC due day, ticking each second: "2d 00:29:59 left"; empty until the browser runs it. */
export function Countdown({ due, className }: { due: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const end = Date.parse(`${due}T00:00:00Z`) + DAY_MS;
    const tick = () => {
      const el = ref.current;
      if (!el) return;
      const left = Math.max(0, end - Date.now());
      const d = Math.floor(left / DAY_MS);
      const h = Math.floor(left / 3_600_000) % 24;
      const m = Math.floor(left / 60_000) % 60;
      const s = Math.floor(left / 1000) % 60;
      el.textContent = left === 0 ? "past due" : `${d ? `${d}d ` : ""}${pad(h)}:${pad(m)}:${pad(s)} left`;
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [due]);
  return <span ref={ref} data-countdown={due} className={className} />;
}

function shortAge(iso: string, now: number): string {
  const mins = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  return mins < 1 ? "now" : mins < 60 ? `${mins} min` : mins < 2880 ? `${Math.round(mins / 60)} h` : `${Math.round(mins / 1440)} d`;
}

/** "6 min", "4 h", "3 d": rendered at build time, rewritten in the browser every half minute. */
export function ShortAgo({ iso, built, className }: { iso: string; built: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const tick = () => {
      if (ref.current) ref.current.textContent = shortAge(iso, Date.now());
    };
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, [iso]);
  return (
    <span ref={ref} className={className} title={`${iso.slice(0, 16).replace("T", " ")} UTC`} suppressHydrationWarning>
      {shortAge(iso, Date.parse(built))}
    </span>
  );
}

/** Text that types itself in once, two characters every 28 ms behind a block caret, when its instrument builds. */
export function TypeIn({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useBuild(ref, (instant) => {
    const el = ref.current;
    if (instant || !el) return;
    let i = 0;
    el.textContent = "";
    el.classList.add("typing");
    const id = window.setInterval(() => {
      i += 2;
      el.textContent = text.slice(0, i);
      if (i >= text.length) {
        window.clearInterval(id);
        el.classList.remove("typing");
      }
    }, 28);
  });
  return <span ref={ref}>{text}</span>;
}

/** Glyphs falling through a sieve stage as it builds; `drops` more on each `again` change (a live update). */
export function SieveRain({ drops, again = 0, color }: { drops: number; again?: number; color: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const rain = (n: number, spread: number) => {
    const el = ref.current;
    if (!el) return;
    const w = el.clientWidth;
    for (let k = 0; k < n; k++) {
      window.setTimeout(
        () => {
          const d = document.createElement("i");
          d.textContent = BUILD_GLYPHS[Math.floor(Math.random() * BUILD_GLYPHS.length)]!;
          d.style.left = `${6 + Math.random() * Math.max(10, w - 30)}px`;
          d.style.color = color;
          d.style.animationDuration = `${0.7 + Math.random() * 0.5}s`;
          el.appendChild(d);
          window.setTimeout(() => d.remove(), 1400);
        },
        80 + Math.random() * spread,
      );
    }
  };
  useBuild(ref, (instant) => {
    if (!instant) rain(drops, 1100);
  });
  const first = useRef(again);
  useEffect(() => {
    if (again !== first.current && document.documentElement.classList.contains("motion")) rain(7, 500);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new `again` is the only trigger
  }, [again]);
  return <div ref={ref} aria-hidden className="sieve-rain" />;
}
