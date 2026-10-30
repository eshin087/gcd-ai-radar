import { onMap, place } from "./globe/geo";
import type { InternetData, InternetHijack, InternetNetwork, InternetOutage, InternetRoute, InternetWafOrigin, InternetWindow } from "./useInternet";

/**
 * The stops the globe tours, from one Worker payload. Each is something
 * Cloudflare Radar reports, shown the way the data allows:
 *
 *   ddos    one of the top routes of the attacks Cloudflare's DDoS protection
 *           stopped (Radar ranks origin-target pairs for DDoS only)
 *   waf     a top origin of the requests its WAF stopped, with the managed
 *           rules they matched (an origin, no target: Radar has no WAF pairs)
 *   hijack  a high-confidence BGP hijack of the last 24 hours, with its page
 *   outage  the newest outage Radar annotated in the past week
 *   route   an attack route of no named kind, from a Worker older than the
 *           kinds; only when the payload has none of the above
 *
 * The order mixes them (flood, hijack, exploits, outage, flood) and fills
 * any missing stop with another DDoS route or WAF origin, up to TOUR. Every
 * stop has a place on the map, so the globe can draw each one.
 */

/** Stops the tour visits. */
export const TOUR = 5;

export type Stop =
  | { kind: "ddos" | "route"; window: InternetWindow; route: InternetRoute }
  | { kind: "waf"; window: InternetWindow; origin: InternetWafOrigin }
  | { kind: "hijack"; event: InternetHijack; victim: InternetNetwork & { country: string }; hijacker: InternetNetwork & { country: string } }
  | { kind: "outage"; event: InternetOutage; code: string };

/** A stable identity for a stop, so a data refresh keeps the one on screen. */
export function stopKey(s: Stop): string {
  switch (s.kind) {
    case "ddos":
    case "route":
      return `${s.kind}:${s.route.origin}>${s.route.target}`;
    case "waf":
      return `waf:${s.origin.country}`;
    case "hijack":
      return `hijack:${s.event.id}`;
    case "outage":
      return `outage:${s.event.since}:${s.code}`;
  }
}

const placed = (code: string | null): code is string => !!code && !!place(code);

/** The hijack's ends: its hijacker, and the first victim with a place, preferring one in another country. */
function hijackStop(event: InternetHijack): Stop | null {
  const h = event.hijacker;
  if (!placed(h.country)) return null;
  const victims = event.victims.filter((v): v is InternetNetwork & { country: string } => placed(v.country));
  const victim = victims.find((v) => v.country !== h.country) ?? victims[0];
  return victim ? { kind: "hijack", event, victim, hijacker: { ...h, country: h.country } } : null;
}

export function buildTour(d: InternetData): Stop[] {
  const ddos: Stop[] = d.attacks.ddos.routes.filter(onMap).map((route) => ({ kind: "ddos", window: d.attacks.ddos.window, route }));
  const waf: Stop[] = d.attacks.waf.origins.filter((o) => placed(o.country)).map((origin) => ({ kind: "waf", window: d.attacks.waf.window, origin }));
  if (!ddos.length && !waf.length) {
    // an older Worker: the plain routes, as before
    return d.attacks.routes
      .filter(onMap)
      .slice(0, TOUR)
      .map((route) => ({ kind: "route", window: d.window, route }));
  }
  const hijack = d.hijacks.map(hijackStop).find((s): s is Stop => !!s);
  const outage = d.outages
    .map((event): Stop | null => {
      const code = event.codes.find(placed);
      return code ? { kind: "outage", event, code } : null;
    })
    .find((s): s is Stop => !!s);

  const tour: Stop[] = [];
  const take = (s: Stop | undefined) => {
    if (s && tour.length < TOUR && !tour.some((t) => stopKey(t) === stopKey(s))) tour.push(s);
  };
  // after a country attacking itself, the next DDoS route crosses a border when one does
  const crossing = ddos.find((s) => s.kind === "ddos" && s.route.origin !== s.route.target && s !== ddos[0]);
  take(ddos[0]);
  take(hijack);
  take(waf[0]);
  take(outage);
  take(crossing ?? ddos[1]);
  // short of TOUR: more DDoS routes and WAF origins, alternately
  for (let i = 1; tour.length < TOUR && (i < ddos.length || i < waf.length); i++) {
    take(ddos[i]);
    take(waf[i]);
  }
  return tour;
}
