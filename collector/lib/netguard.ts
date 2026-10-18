import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Where the collector may connect. Every URL it fetches comes, directly or
 * through a feed, from the open web, so a crafted link could point the
 * runner at itself, at a private network or at a cloud metadata endpoint.
 * Only http(s) to a public address is allowed; the check runs before each
 * request and again on every redirect hop (collector/lib/http.ts).
 */

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedUrlError";
  }
}

/** Hostnames that never denote a public server. */
const BLOCKED_HOSTS = new Set(["localhost", "localhost.localdomain", "broadcasthost"]);
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa", ".in-addr.arpa", ".ip6.arpa"];

function v4Octets(ip: string): [number, number, number, number] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const n = parts.map(Number);
  if (n.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return null;
  return n as [number, number, number, number];
}

function isPublicV4(ip: string): boolean {
  const o = v4Octets(ip);
  if (!o) return false;
  const [a, b] = o;
  if (a === 0 || a === 10 || a === 127) return false; // this network, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a === 169 && b === 254) return false; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false; // private
  if (a === 192 && (b === 0 || b === 168)) return false; // IETF protocol assignments, TEST-NET-1, private
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return false; // benchmarking, TEST-NET-2
  if (a === 203 && b === 0) return false; // TEST-NET-3
  if (a >= 224) return false; // multicast and reserved
  return true;
}

/** Expands an IPv6 literal to eight 16-bit groups (an embedded IPv4 tail becomes two groups). */
function v6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  const tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const o = v4Octets(tail[1]!);
    if (!o) return null;
    s = s.slice(0, -tail[1]!.length) + ((o[0] << 8) | o[1]).toString(16) + ":" + ((o[2] << 8) | o[3]).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array<string>(fill).fill("0"), ...rest].map((g) => parseInt(g || "0", 16));
  if (groups.length !== 8 || groups.some((g) => Number.isNaN(g) || g < 0 || g > 0xffff)) return null;
  return groups;
}

function isPublicV6(ip: string): boolean {
  const g = v6Groups(ip);
  if (!g) return false;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [number, number, number, number, number, number, number, number];
  if (g.every((x) => x === 0)) return false; // ::
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 1) return false; // ::1
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    // IPv4-mapped: judge the embedded address
    return isPublicV4(`${g6 >> 8}.${g6 & 255}.${g7 >> 8}.${g7 & 255}`);
  }
  if (g0 === 0x64 && g1 === 0xff9b) return false; // NAT64 well-known prefix embeds an IPv4 address
  if ((g0 & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((g0 & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((g0 & 0xff00) === 0xff00) return false; // multicast
  if (g0 === 0x2001 && g1 === 0xdb8) return false; // documentation
  return true;
}

/** True for a globally routable unicast address; false for loopback, private, link-local, multicast and reserved ranges. */
export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isPublicV4(ip);
  if (kind === 6) return isPublicV6(ip);
  return false;
}

/** Scheme and hostname checks that need no network. Returns the IP literal when the host is one. Throws BlockedUrlError. */
export function checkUrl(raw: string): { url: URL; literal: string | null } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError(`not a URL: ${raw.slice(0, 120)}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new BlockedUrlError(`scheme not allowed: ${url.protocol}`);
  if (url.username || url.password) throw new BlockedUrlError(`credentials in URL: ${url.host}`);
  const host = url.hostname.toLowerCase();
  if (!host) throw new BlockedUrlError("empty host");
  const literal = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : isIP(host) ? host : null;
  if (literal !== null) {
    if (!isPublicAddress(literal)) throw new BlockedUrlError(`address not public: ${literal}`);
    return { url, literal };
  }
  if (BLOCKED_HOSTS.has(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s)) || !host.includes(".")) {
    throw new BlockedUrlError(`host not public: ${host}`);
  }
  return { url, literal: null };
}

/**
 * Full check: scheme, hostname, and every address the name resolves to must
 * be public. Resolution failures propagate as ordinary errors (the fetch
 * would fail the same way); blocked destinations throw BlockedUrlError.
 */
export async function assertFetchable(raw: string, resolve: (host: string) => Promise<string[]> = resolveAll): Promise<URL> {
  const { url, literal } = checkUrl(raw);
  if (literal !== null) return url;
  const addrs = await resolve(url.hostname);
  if (addrs.length === 0) throw new BlockedUrlError(`no address for ${url.hostname}`);
  const bad = addrs.find((a) => !isPublicAddress(a));
  if (bad) throw new BlockedUrlError(`${url.hostname} resolves to a non-public address (${bad})`);
  return url;
}

async function resolveAll(host: string): Promise<string[]> {
  const list = await lookup(host, { all: true, verbatim: true });
  return list.map((e) => e.address);
}
