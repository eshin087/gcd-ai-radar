import { createHash } from "node:crypto";

/**
 * URL canonicalization for deduplication. Two links to the same article must
 * produce the same key regardless of tracking parameters, AMP variants,
 * scheme, "www." or trailing slashes.
 */

const TRACKING_PARAMS = new Set([
  "fbclid", "gclid", "dclid", "msclkid", "yclid", "igshid", "mc_cid", "mc_eid", "_hsenc", "_hsmi",
  "hsctatracking", "oly_anon_id", "oly_enc_id", "vero_id", "ref", "ref_src", "ref_url", "source",
  "cmpid", "ncid", "ocid", "smid", "sr_share", "share", "via", "s", "spm", "trk", "trkinfo",
  "guccounter", "guce_referrer", "guce_referrer_sig", "mkt_tok", "rb_clickid", "cid",
]);

const AMP_HOST_PREFIXES = ["amp.", "amp-", "www-amp."];

export function canonicalUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  u.protocol = "https:";
  u.hash = "";
  u.username = "";
  u.password = "";
  let host = u.hostname.toLowerCase();
  if (host.startsWith("www.")) host = host.slice(4);
  for (const p of AMP_HOST_PREFIXES) if (host.startsWith(p)) host = host.slice(p.length);
  if (host.endsWith(".cdn.ampproject.org")) {
    // https://example-com.cdn.ampproject.org/c/s/example.com/path → example.com/path
    const m = u.pathname.match(/^\/[cv]\/s\/([^/]+)(\/.*)?$/);
    if (m) {
      host = m[1]!.toLowerCase();
      u.pathname = m[2] ?? "/";
    }
  }
  u.hostname = host;
  u.port = u.port === "443" ? "" : u.port;

  const params = new URLSearchParams();
  const keys = [...u.searchParams.keys()].sort();
  for (const k of keys) {
    const lk = k.toLowerCase();
    if (lk.startsWith("utm_") || TRACKING_PARAMS.has(lk)) continue;
    for (const v of u.searchParams.getAll(k)) params.append(k, v);
  }
  u.search = params.toString() ? `?${params.toString()}` : "";

  let p = u.pathname.replace(/\/{2,}/g, "/");
  p = p.replace(/\/(index\.html?|default\.aspx?)$/i, "/");
  p = p.replace(/\/amp\/?$/i, "/").replace(/\.amp$/i, "");
  p = p.replace(/\?amp=1$/, "");
  if (p.length > 1) p = p.replace(/\/+$/, "");
  u.pathname = p || "/";
  return u.toString();
}

export function urlKey(canonical: string): string {
  return createHash("sha1").update(canonical).digest("hex").slice(0, 16);
}

export function hostOf(url: string): string {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h.startsWith("www.") ? h.slice(4) : h;
  } catch {
    return "";
  }
}

/** Hosts that are link shorteners or wrappers; their targets should be resolved. */
export const SHORTENER_HOSTS = new Set([
  "t.co", "bit.ly", "buff.ly", "trib.al", "dlvr.it", "ift.tt", "tinyurl.com", "ow.ly", "goo.gl",
  "lnkd.in", "visitlink.me", "is.gd", "shorturl.at", "rb.gy", "cutt.ly", "t.ly", "zpr.io", "hubs.la", "hubs.ly",
]);

export function isShortener(url: string): boolean {
  return SHORTENER_HOSTS.has(hostOf(url));
}
