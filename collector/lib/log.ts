/** Minimal structured logger. Debug lines appear with COLLECTOR_DEBUG=1 or --verbose. */

let verbose = process.env.COLLECTOR_DEBUG === "1";

export function setVerbose(v: boolean) {
  verbose = v;
}

function stamp(): string {
  return new Date().toISOString().slice(11, 19);
}

function fmt(data?: Record<string, unknown>): string {
  if (!data) return "";
  const parts = Object.entries(data)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
  return parts.length ? " " + parts.join(" ") : "";
}

export const log = {
  info(msg: string, data?: Record<string, unknown>) {
    console.log(`${stamp()} ${msg}${fmt(data)}`);
  },
  warn(msg: string, data?: Record<string, unknown>) {
    console.warn(`${stamp()} WARN ${msg}${fmt(data)}`);
  },
  error(msg: string, data?: Record<string, unknown>) {
    console.error(`${stamp()} ERROR ${msg}${fmt(data)}`);
  },
  debug(msg: string, data?: Record<string, unknown>) {
    if (verbose) console.log(`${stamp()} · ${msg}${fmt(data)}`);
  },
};

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
