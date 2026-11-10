const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-31" -> "31 Oct": the panel's deadlines. No imports, so the browser can use it. */
export function shortDate(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** A span of time in the coarsest unit that still says something: "3 days", "1 day", "16 h", "32 min". Never a ticking clock. */
export function timeLeft(ms: number): string {
  const days = Math.floor(ms / DAY_MS);
  if (days >= 1) return `${days} ${days === 1 ? "day" : "days"}`;
  const hours = Math.floor(ms / HOUR_MS);
  if (hours >= 1) return `${hours} h`;
  return `${Math.max(1, Math.ceil(ms / 60_000))} min`;
}

/** How long a record has waited since its first report (a UTC date), in whole days: "open today", "open 1 day", "open 12 days". */
export function openFor(since: string, now: number): string {
  const days = Math.floor((now - Date.parse(`${since}T00:00:00Z`)) / DAY_MS);
  return days < 1 ? "open today" : `open ${days} ${days === 1 ? "day" : "days"}`;
}

/**
 * Time left as the two figures of the runway's large countdown: days and
 * hours from two days out ("2 d 21 h"), hours and minutes below that
 * ("21 h 32 m"). Whole minutes, so it changes once a minute, never by the
 * second.
 */
export function countdownParts(ms: number): { a: string; au: "d" | "h"; b: string; bu: "h" | "m" } {
  const mins = Math.max(0, Math.floor(ms / 60_000));
  if (mins >= 48 * 60) return { a: String(Math.floor(mins / 1440)), au: "d", b: String(Math.floor((mins % 1440) / 60)), bu: "h" };
  return { a: String(Math.floor(mins / 60)), au: "h", b: String(mins % 60).padStart(2, "0"), bu: "m" };
}
