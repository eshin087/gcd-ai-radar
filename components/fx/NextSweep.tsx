"use client";

import { useEffect, useRef } from "react";

/** The collector's cron slots: minute 17 of hours 0, 6, 12, 18 UTC. */
export function nextSweepAt(now: Date): Date {
  const d = new Date(now);
  d.setUTCSeconds(0, 0);
  for (let i = 0; i < 8; i++) {
    const slot = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), Math.floor(d.getUTCHours() / 6) * 6 + i * 6, 17));
    if (slot.getTime() > now.getTime()) return slot;
  }
  return new Date(now.getTime() + 6 * 3600 * 1000);
}

function hms(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/** Live countdown to the next scheduled sweep ("05:12:09"). Text is written by the effect, so SSR shows a dash. */
export function NextSweep({ className }: { className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const tick = () => {
      const now = new Date();
      el.textContent = hms(nextSweepAt(now).getTime() - now.getTime());
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span ref={ref} className={className} suppressHydrationWarning>
      --:--:--
    </span>
  );
}

/** The relative time lives in components/ui/Ago.tsx now; re-exported for the lab's terminal demos. */
export { Ago } from "@/components/ui/Ago";
