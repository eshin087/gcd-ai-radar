"use client";

import { useEffect, useState } from "react";

/**
 * The band's payload as the Worker (worker/src/assemble.ts) serves it. Kept in
 * step by hand: the Worker is a separate package, and the page must survive a
 * payload one version apart, so every read of it below is defensive.
 */
export interface InternetRoute {
  origin: string;
  origin_name: string;
  target: string;
  target_name: string;
  share: number;
}

export interface InternetPoint {
  t: string;
  value: number;
  human: number | null;
  bot: number | null;
}

export interface InternetOutage {
  location: string;
  /** Alpha-2 codes of the places affected (empty from a Worker before 2026-10-30). */
  codes: string[];
  /** "nationwide", "regional", "network", "platform" or null. */
  type: string | null;
  region: string | null;
  since: string;
  until: string | null;
  cause: string | null;
  description: string;
  url: string | null;
}

export type InternetWindow = "1h" | "1d";

/** A country the requests Cloudflare's WAF stopped come from, with the managed-rule categories that matched them. */
export interface InternetWafOrigin {
  country: string;
  name: string;
  share: number;
  rules: { name: string; share: number }[];
}

export interface InternetNetwork {
  asn: number;
  name: string | null;
  country: string | null;
}

/** A high-confidence BGP hijack: the hijacker announced address blocks that belong to the victims. */
export interface InternetHijack {
  id: number;
  url: string;
  confidence: number;
  start: string;
  end: string | null;
  hijacker: InternetNetwork;
  victims: InternetNetwork[];
  prefixes: string[];
  prefix_count: number;
}

export interface InternetData {
  generated_at: string;
  radar_updated: string | null;
  window: InternetWindow;
  attacks: {
    routes: InternetRoute[];
    top_targets: { country: string; name: string; share: number }[];
    /** DDoS protection's own top routes, shares of what it stopped. */
    ddos: { window: InternetWindow; routes: InternetRoute[] };
    waf: { window: InternetWindow; origins: InternetWafOrigin[] };
  };
  traffic: { points: InternetPoint[] };
  outages: InternetOutage[];
  bgp: { leaks: number; hijacks: number };
  hijacks: InternetHijack[];
  attribution: { name: string; url: string; license: string; license_url: string };
  stale: boolean;
}

export type InternetStatus = "loading" | "live" | "idle";

export interface InternetState {
  status: InternetStatus;
  data: InternetData | null;
}

const IDLE: InternetState = { status: "idle", data: null };

/** Milliseconds between fetches while the tab is visible; the Worker caches for the same five minutes. */
export const REFRESH_MS = 5 * 60 * 1000;

function isArray(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === "string" ? v : null);
const win = (v: unknown): InternetWindow => (v === "1d" ? "1d" : "1h");

function readRoutes(v: unknown): InternetRoute[] {
  return (isArray(v) ? v : []).filter(
    (x): x is InternetRoute => !!x && typeof x === "object" && typeof (x as InternetRoute).origin === "string" && typeof (x as InternetRoute).target === "string" && typeof (x as InternetRoute).share === "number",
  );
}

function readNetwork(v: unknown): InternetNetwork | null {
  const n = obj(v);
  return typeof n.asn === "number" ? { asn: n.asn, name: str(n.name), country: str(n.country) } : null;
}

function readHijack(v: unknown): InternetHijack | null {
  const h = obj(v);
  const hijacker = readNetwork(h.hijacker);
  if (typeof h.id !== "number" || typeof h.url !== "string" || !/^https:\/\//.test(h.url) || typeof h.confidence !== "number" || typeof h.start !== "string" || !hijacker) return null;
  const prefixes = (isArray(h.prefixes) ? h.prefixes : []).filter((p): p is string => typeof p === "string");
  return {
    id: h.id,
    url: h.url,
    confidence: h.confidence,
    start: h.start,
    end: str(h.end),
    hijacker,
    victims: (isArray(h.victims) ? h.victims : []).map(readNetwork).filter((n): n is InternetNetwork => !!n),
    prefixes,
    prefix_count: typeof h.prefix_count === "number" ? h.prefix_count : prefixes.length,
  };
}

function readOutage(v: unknown): InternetOutage | null {
  const o = obj(v);
  if (typeof o.location !== "string" || typeof o.since !== "string") return null;
  return {
    location: o.location,
    codes: (isArray(o.codes) ? o.codes : []).filter((c): c is string => typeof c === "string"),
    type: str(o.type),
    region: str(o.region),
    since: o.since,
    until: str(o.until),
    cause: str(o.cause),
    description: str(o.description) ?? o.location,
    url: typeof o.url === "string" && /^https?:\/\//.test(o.url) ? o.url : null,
  };
}

function readWafOrigin(v: unknown): InternetWafOrigin | null {
  const o = obj(v);
  if (typeof o.country !== "string" || typeof o.share !== "number") return null;
  const rules = (isArray(o.rules) ? o.rules : []).map(obj).filter((r) => typeof r.name === "string" && typeof r.share === "number") as unknown as InternetWafOrigin["rules"];
  return { country: o.country, name: str(o.name) ?? o.country, share: o.share, rules };
}

/** The payload with every field the band reads present, or null when the shape is off. A payload from an older Worker reads with the newer parts empty. */
export function readPayload(raw: unknown): InternetData | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const attacks = obj(r.attacks);
  const traffic = obj(r.traffic);
  const bgp = obj(r.bgp);
  const attribution = obj(r.attribution);
  const ddos = obj(attacks.ddos), waf = obj(attacks.waf);
  if (typeof r.generated_at !== "string") return null;
  const points = (isArray(traffic.points) ? traffic.points : []).filter((x): x is InternetPoint => !!x && typeof x === "object" && typeof (x as InternetPoint).t === "string" && typeof (x as InternetPoint).value === "number");
  return {
    generated_at: r.generated_at,
    radar_updated: typeof r.radar_updated === "string" ? r.radar_updated : null,
    window: win(r.window),
    attacks: {
      routes: readRoutes(attacks.routes),
      top_targets: isArray(attacks.top_targets) ? (attacks.top_targets as InternetData["attacks"]["top_targets"]) : [],
      ddos: { window: win(ddos.window), routes: readRoutes(ddos.routes) },
      waf: { window: win(waf.window), origins: (isArray(waf.origins) ? waf.origins : []).map(readWafOrigin).filter((o): o is InternetWafOrigin => !!o) },
    },
    traffic: { points },
    outages: (isArray(r.outages) ? r.outages : []).map(readOutage).filter((o): o is InternetOutage => !!o),
    bgp: { leaks: typeof bgp.leaks === "number" ? bgp.leaks : 0, hijacks: typeof bgp.hijacks === "number" ? bgp.hijacks : 0 },
    hijacks: (isArray(r.hijacks) ? r.hijacks : []).map(readHijack).filter((h): h is InternetHijack => !!h),
    attribution: {
      name: typeof attribution.name === "string" ? attribution.name : "Cloudflare Radar",
      url: typeof attribution.url === "string" ? attribution.url : "https://radar.cloudflare.com/",
      license: typeof attribution.license === "string" ? attribution.license : "CC BY-NC 4.0",
      license_url: typeof attribution.license_url === "string" ? attribution.license_url : "https://creativecommons.org/licenses/by-nc/4.0/",
    },
    stale: r.stale === true,
  };
}

/**
 * Fetches the Worker's /v1/internet every five minutes while the tab is
 * visible. "loading" until the first answer, "live" with a payload (possibly
 * marked stale by the Worker), "idle" when the Worker is unreachable, answers
 * with an error, or no URL is configured. A payload already shown is kept
 * through a later failure, so a blip never blanks the band.
 */
export function useInternet(url: string | undefined): InternetState {
  const [state, setState] = useState<InternetState>({ status: "loading", data: null });

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    let controller: AbortController | null = null;
    let lastAt = 0;
    let timer: ReturnType<typeof setInterval> | null = null;

    const load = async () => {
      if (document.visibilityState !== "visible") return;
      controller?.abort();
      controller = new AbortController();
      lastAt = Date.now();
      try {
        const res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = readPayload(await res.json());
        if (!data) throw new Error("unexpected payload");
        if (!cancelled) setState({ status: "live", data });
      } catch (e) {
        if (cancelled || (e instanceof DOMException && e.name === "AbortError")) return;
        setState((s) => (s.data ? { status: "live", data: { ...s.data, stale: true } } : { status: "idle", data: null }));
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastAt >= REFRESH_MS) void load();
    };

    void load();
    timer = setInterval(() => void load(), REFRESH_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      controller?.abort();
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [url]);

  return url ? state : IDLE;
}
