/**
 * CSV cells for the public export. Quotes per RFC 4180 and defuses
 * spreadsheet formula injection: a cell starting with =, +, -, @ or a tab or
 * carriage return would be executed as a formula by Excel and LibreOffice,
 * so it is prefixed with a single quote (the usual mitigation; the quote is
 * shown but nothing runs).
 */
export function csvCell(v: unknown): string {
  let s = Array.isArray(v) ? v.join("; ") : String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
