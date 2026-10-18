/** Incident ids and slugs. */

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

function hash4(s: string): string {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0).toString(36).slice(0, 4).padStart(4, "0");
}

export function uniqueSlug(title: string, taken: Set<string>, salt: string): string {
  const base = slugify(title) || "incident";
  if (!taken.has(base)) return base;
  let candidate = `${base.slice(0, 55).replace(/-+$/, "")}-${hash4(salt)}`;
  let n = 2;
  while (taken.has(candidate)) candidate = `${base.slice(0, 52).replace(/-+$/, "")}-${hash4(salt)}-${n++}`;
  return candidate;
}

const ID_RE = /^AIR-(\d{4})-(\d{4})$/;

/** Allocates the next AIR-YYYY-NNNN for `year`, given every id already in use. */
export function makeIdAllocator(existingIds: Iterable<string>) {
  const maxByYear = new Map<number, number>();
  for (const id of existingIds) {
    const m = id.match(ID_RE);
    if (!m) continue;
    const y = Number(m[1]);
    const n = Number(m[2]);
    if ((maxByYear.get(y) ?? 0) < n) maxByYear.set(y, n);
  }
  return (year: number): string => {
    const next = (maxByYear.get(year) ?? 0) + 1;
    maxByYear.set(year, next);
    return `AIR-${year}-${String(next).padStart(4, "0")}`;
  };
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(`${a.slice(0, 10)}T00:00:00Z`) - Date.parse(`${b.slice(0, 10)}T00:00:00Z`)) / 86400000;
}
