/**
 * How much of the ledger the home page shows (lib/panel/ledger.ts holds the
 * rules). The nearest deadline leads the runway card and the next three sit
 * in its list, so four deadline rows in all; the two lists beside it show
 * three rows each. The runway draws a bar for the first records without a
 * patch and labels the first deadline days. Kept apart so the browser's
 * components can import the caps without the dataset modules behind the
 * rules.
 */
export const LEDGER_DUE_ROWS = 4;
export const LEDGER_PATCH_ROWS = 3;
export const LEDGER_NEW_ROWS = 3;
export const RUNWAY_OPEN_BARS = 6;
export const RUNWAY_DUE_LABELS = 4;
