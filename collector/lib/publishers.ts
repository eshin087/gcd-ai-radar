import { hostOf } from "./canonical";

/** Maps a URL to a display publisher name using config/publishers.json, falling back to the host. */
export function publisherFor(url: string, publishers: Record<string, string>, fallback?: string): string {
  const host = hostOf(url);
  if (!host) return fallback ?? "Unknown";
  const parts = host.split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join(".");
    const name = publishers[candidate];
    if (name) return name;
  }
  return fallback ?? host;
}
