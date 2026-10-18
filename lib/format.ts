const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2024-03" -> "Mar 24"; with `long` -> "March 2024". */
export function monthLabel(key: string, long = false): string {
  const [y, m] = key.split("-");
  const idx = Number(m) - 1;
  const name = MONTHS[idx] ?? m ?? "";
  if (long) return `${new Date(Date.UTC(Number(y), idx, 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" })} ${y}`;
  return `${name} ${String(y).slice(2)}`;
}

/** "2024-03-05" -> "5 Mar 2024"; "2024-03" -> "Mar 2024"; "2024" -> "2024". */
export function dateLabel(date: string): string {
  if (date.length === 4) return date;
  const [y, m, d] = date.split("-");
  const name = MONTHS[Number(m) - 1] ?? "";
  if (!d) return `${name} ${y}`;
  return `${Number(d)} ${name} ${y}`;
}

export function approxDateLabel(date: string, precision: "day" | "month" | "year"): string {
  const label = dateLabel(date);
  return precision === "day" ? label : `${label} (approx.)`;
}

export function formatInt(n: number): string {
  return n.toLocaleString("en-US");
}

/** +12%, −8%, 0%, or "new" when the baseline was zero. */
export function formatPct(pct: number | null, digits = 0): string {
  if (pct === null) return "new";
  const rounded = Number(pct.toFixed(digits));
  if (rounded === 0) return "0%";
  const sign = rounded > 0 ? "+" : "−";
  return `${sign}${Math.abs(rounded).toFixed(digits)}%`;
}

export function deltaTone(pct: number | null): "up" | "down" | "flat" {
  if (pct === null) return "up";
  if (Math.round(pct) === 0) return "flat";
  return pct > 0 ? "up" : "down";
}

export function timestampLabel(iso: string): string {
  return iso.slice(0, 16).replace("T", " ") + "Z";
}
