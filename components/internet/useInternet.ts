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
  since: string;
  until: string | null;
  cause: string | null;
  description: string;
  url: string | null;
}

export interface InternetData {
  generated_at: string;
  radar_updated: string | null;
  window: "1h" | "1d";
  attacks: { routes: InternetRoute[]; top_targets: { country: string; name: string; share: number }[] };
  traffic: { points: InternetPoint[] };
  outages: InternetOutage[];
  bgp: { leaks: number; hijacks: number };
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

/** The payload with every field the band reads present, or null when the shape is off. */
export function readPayload(raw: unknown): InternetData | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const attacks = (r.attacks ?? {}) as Record<string, unknown>;
  const traffic = (r.traffic ?? {}) as Record<string, unknown>;
  const bgp = (r.bgp ?? {}) as Record<string, unknown>;
  const attribution = (r.attribution ?? {}) as Record<string, unknown>;
  if (typeof r.generated_at !== "string") return null;
  const routes = (isArray(attacks.routes) ? attacks.routes : []).filter(
    (x): x is InternetRoute => !!x && typeof x === "object" && typeof (x as InternetRoute).origin === "string" && typeof (x as InternetRoute).target === "string" && typeof (x as InternetRoute).share === "number",
  );
  const points = (isArray(traffic.points) ? traffic.points : []).filter((x): x is InternetPoint => !!x && typeof x === "object" && typeof (x as InternetPoint).t === "string" && typeof (x as InternetPoint).value === "number");
  const outages = (isArray(r.outages) ? r.outages : []).filter((x): x is InternetOutage => !!x && typeof x === "object" && typeof (x as InternetOutage).location === "string" && typeof (x as InternetOutage).since === "string");
  return {
    generated_at: r.generated_at,
    radar_updated: typeof r.radar_updated === "string" ? r.radar_updated : null,
    window: r.window === "1d" ? "1d" : "1h",
    attacks: { routes, top_targets: isArray(attacks.top_targets) ? (attacks.top_targets as InternetData["attacks"]["top_targets"]) : [] },
    traffic: { points },
    outages,
    bgp: { leaks: typeof bgp.leaks === "number" ? bgp.leaks : 0, hijacks: typeof bgp.hijacks === "number" ? bgp.hijacks : 0 },
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
