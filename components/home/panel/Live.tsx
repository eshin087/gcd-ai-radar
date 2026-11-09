"use client";

import { useEffect, useRef } from "react";
import { useBuild } from "@/components/home/panel/useBuild";
import { openFor, timeLeft } from "@/lib/panel/dates";

/**
 * The panel's small live pieces. Each writes its own text into an element
 * React rendered once and never re-renders, so the server's markup stays the
 * no-JS fallback.
 */

const DAY_MS = 86_400_000;

/**
 * Time left until the end of a UTC due day, in days, hours or minutes rather
 * than a ticking clock: "1 day left", "16 h left"; `fallback` (or nothing)
 * until the browser runs it, rewritten every half minute. With `start`,
 * until the day begins: "1 day to go", then "now".
 */
export function Countdown({ due, start = false, fallback, className }: { due: string; start?: boolean; fallback?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const end = Date.parse(`${due}T00:00:00Z`) + (start ? 0 : DAY_MS);
    const tick = () => {
      const el = ref.current;
      if (!el) return;
      const left = Math.max(0, end - Date.now());
      el.textContent = left === 0 ? (start ? "now" : "past due") : `${timeLeft(left)} ${start ? "to go" : "left"}`;
    };
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, [due, start]);
  return (
    <span ref={ref} data-countdown={due} className={className} suppressHydrationWarning>
      {fallback}
    </span>
  );
}

/** "open 3 days" since a first report: rendered at build time, rewritten in the browser every minute. */
export function OpenFor({ since, built, title, className }: { since: string; built: string; title?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const tick = () => {
      if (ref.current) ref.current.textContent = openFor(since, Date.now());
    };
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, [since]);
  return (
    <span ref={ref} data-open-for={since} title={title} className={className} suppressHydrationWarning>
      {openFor(since, Date.parse(built))}
    </span>
  );
}

function shortAge(iso: string, now: number): string {
  const mins = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  return mins < 1 ? "now" : mins < 60 ? `${mins} min` : mins < 2880 ? `${Math.round(mins / 60)} h` : `${Math.round(mins / 1440)} d`;
}

function ageLabel(iso: string, now: number, suffix: string): string {
  const t = shortAge(iso, now);
  return t === "now" ? t : t + suffix;
}

/** "6 min", "4 h", "3 d" (with `suffix`, "4 h ago"): rendered at build time, rewritten in the browser every half minute. */
export function ShortAgo({ iso, built, suffix = "", className }: { iso: string; built: string; suffix?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const tick = () => {
      if (ref.current) ref.current.textContent = ageLabel(iso, Date.now(), suffix);
    };
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, [iso, suffix]);
  return (
    <span ref={ref} className={className} title={`${iso.slice(0, 16).replace("T", " ")} UTC`} suppressHydrationWarning>
      {ageLabel(iso, Date.parse(built), suffix)}
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

