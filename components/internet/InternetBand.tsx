"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { Globe, type GlobeControl } from "./Globe";
import { countryName, inSentence, onMap, plainName } from "./globe/geo";
import { buildTour, stopKey, type Stop } from "./tour";
import { useInternet, type InternetData, type InternetStatus, type InternetWindow } from "./useInternet";

/**
 * The hero's live band: the globe, and beside it one narrow caption that says
 * in words what the globe is showing. Everything is Cloudflare Radar's:
 *
 *   DDoS routes   origin is where the attacking IP addresses are, target the
 *                 billing location of the attacked site ("For the target
 *                 location of the attacks, Cloudflare uses the billing location
 *                 associated with the zone under attack",
 *                 developers.cloudflare.com/radar/investigate/application-layer-attacks);
 *                 the share is of the attacks its DDoS protection stopped
 *   exploits      an origin of the requests its WAF stopped and the managed-rule
 *                 categories they matched most (Radar ranks no WAF targets)
 *   hijacks       a high-confidence BGP hijack, linked to its Radar page
 *   outages       the newest outage Radar annotated in the past week, with its
 *                 cause and Radar's own post
 *
 * Radar data is CC BY-NC 4.0: the credit line under the caption names it,
 * links it, carries Radar's own timestamp and the licence, and the data never
 * enters the CC BY-SA dataset. Idle (no Worker, unreachable, an error) keeps
 * the globe still and says so in one line.
 */

export interface InternetBandProps {
  /** The Worker's /v1/internet URL; undefined renders the idle state. */
  apiUrl?: string;
  className?: string;
}

/** "hh:mm UTC" from an ISO timestamp. */
export function utcClock(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return `${new Date(ms).toISOString().slice(11, 16)} UTC`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 27, 06:30" in UTC, or null. */
function utcDay(iso: string | null): string | null {
  const ms = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.toISOString().slice(11, 16)}`;
}

/** When an outage ran: "Oct 27, 06:30–12:00 UTC", across days "Oct 23, 21:45 – Oct 25, 04:30 UTC", open "since Oct 27, 06:30 UTC". */
export function utcSpan(since: string, until: string | null): string {
  const a = utcDay(since) ?? since;
  const b = utcDay(until);
  if (!b) return `since ${a} UTC`;
  return a.slice(0, a.indexOf(",")) === b.slice(0, b.indexOf(",")) ? `${a}–${b.slice(b.indexOf(",") + 2)} UTC` : `${a} – ${b} UTC`;
}

/** Radar's managed-rule categories as words in a sentence. */
const RULES: Record<string, string> = {
  SQLi: "SQL injection",
  XSS: "cross-site scripting",
  "HTTP Anomaly": "HTTP anomalies",
  "Vulnerability scanner": "vulnerability scanners",
};
export const ruleName = (name: string) =>
  RULES[name] ??
  name
    .split(" ")
    .map((w) => (/^[A-Z0-9]{2,5}$/.test(w) ? w : w.toLowerCase()))
    .join(" ");

const sentenceCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const windowWords = (w: InternetWindow) => (w === "1h" ? "last hour" : "last 24 hours");
const LEARN = {
  ddos: "https://www.cloudflare.com/learning/ddos/what-is-a-ddos-attack/",
  waf: "https://www.cloudflare.com/learning/ddos/glossary/web-application-firewall-waf/",
};
const OUTAGE_CENTER = "https://radar.cloudflare.com/outage-center";

/** What the caption shows for one stop. */
interface Card {
  kicker: string;
  title: ReactNode;
  figure: ReactNode;
  note: ReactNode;
  detail: ReactNode;
  link: { href: string; text: string } | null;
  /** The progress dot's name for screen readers. */
  short: string;
}

const network = (n: { asn: number; name: string | null }) => `AS${n.asn}${n.name ? ` ${n.name}` : ""}`;

function card(s: Stop): Card {
  switch (s.kind) {
    case "ddos":
    case "route": {
      const r = s.route;
      const self = r.origin === r.target;
      const from = plainName(r.origin_name), to = plainName(r.target_name);
      const fromIn = inSentence(r.origin_name), toIn = inSentence(r.target_name);
      return {
        kicker: s.kind === "ddos" ? `DDoS flood · ${windowWords(s.window)}` : sentenceCase(windowWords(s.window)),
        title: self ? <>Within {fromIn}</> : <>{from} <span className="text-accent">→</span> {to}</>,
        figure: <Share value={r.share} />,
        note: s.kind === "ddos" ? "of the DDoS attacks Cloudflare stopped" : "of the web attacks Cloudflare stopped",
        detail: self ? `From IPs in ${fromIn} to sites billed there.` : `From IPs in ${fromIn} to sites billed in ${toIn}.`,
        link: s.kind === "ddos" ? { href: LEARN.ddos, text: "What a DDoS attack is" } : null,
        short: `${s.kind === "ddos" ? "DDoS flood" : "Attacks"}, ${self ? `within ${fromIn}` : `${from} to ${to}`}, ${r.share.toFixed(1)} %`,
      };
    }
    case "waf": {
      const o = s.origin;
      const rules = o.rules.slice(0, 2).map((r) => `${ruleName(r.name)} ${Math.round(r.share)} %`);
      return {
        kicker: `Web exploits · ${windowWords(s.window)}`,
        title: <>From {inSentence(o.name)}</>,
        figure: <Share value={o.share} />,
        note: "of the requests Cloudflare's firewall (WAF) stopped",
        detail: rules.length ? `Its rules caught mostly ${rules.join(" and ")}.` : `Sent from IPs in ${inSentence(o.name)}.`,
        link: { href: LEARN.waf, text: "What a WAF stops" },
        short: `Web exploits from ${inSentence(o.name)}, ${o.share.toFixed(1)} %`,
      };
    }
    case "hijack": {
      const e = s.event;
      const by = plainName(countryName(s.hijacker.country)), of = plainName(countryName(s.victim.country));
      const self = s.hijacker.country === s.victim.country;
      const more = e.victims.length - 1;
      const n = e.prefix_count;
      return {
        kicker: "Route hijack · last 24 hours",
        title: self ? <>Within {inSentence(countryName(s.victim.country))}</> : <>{by} <span className="text-accent">→</span> {of}</>,
        figure: (
          <>
            {n.toLocaleString("en-US")}
            <span className="text-[14px] text-dim"> address {n === 1 ? "block" : "blocks"}</span>
          </>
        ),
        note: (
          <span className="block truncate" title={network(e.hijacker)}>
            announced by {network(e.hijacker)}
          </span>
        ),
        detail: `${n === 1 ? "It belongs" : "They belong"} to AS${s.victim.asn}${more > 0 ? ` and ${more} more ${more === 1 ? "network" : "networks"}` : ""}. Detected with high confidence${utcDay(e.start) ? `, first seen ${utcDay(e.start)} UTC` : ""}.`,
        link: { href: e.url, text: "See it on Cloudflare Radar" },
        short: `Route hijack, ${self ? `within ${of}` : `${by} to ${of}`}, ${n} address ${n === 1 ? "block" : "blocks"}`,
      };
    }
    case "outage": {
      const e = s.event;
      const where = e.location === "Unknown location" ? plainName(countryName(s.code)) : e.location;
      const fromX = !!e.url && /^https:\/\/(x|twitter)\.com\//.test(e.url);
      return {
        kicker: e.until ? "Outage · past week" : "Outage · ongoing",
        title: where,
        figure: <span className="text-[20px] leading-tight">{e.cause ? sentenceCase(e.cause) : "Cause unknown"}</span>,
        note: `${e.type ? `${sentenceCase(e.type)} · ` : ""}${utcSpan(e.since, e.until)}`,
        detail: <span className="line-clamp-3">{e.description}</span>,
        link: e.url ? { href: e.url, text: fromX ? "Radar's post on X" : "Source" } : { href: OUTAGE_CENTER, text: "Cloudflare Radar outage center" },
        short: `Outage, ${where}${e.cause ? `, ${e.cause}` : ""}`,
      };
    }
  }
}

function Share({ value }: { value: number }) {
  return (
    <>
      {value.toFixed(1)}
      <span className="text-[14px] text-dim"> %</span>
    </>
  );
}

function Credit({ data }: { data: InternetData | null }) {
  const clock = utcClock(data?.radar_updated ?? null);
  const link = "hover:text-accent hover:underline hover:underline-offset-4";
  return (
    <p className="num text-[12px] leading-snug text-faint">
      <a href={data?.attribution.url ?? "https://radar.cloudflare.com/"} target="_blank" rel="noopener noreferrer" className={link}>
        Cloudflare Radar
      </a>
      <br />
      {clock && <>{clock} · </>}
      {data?.stale && <span className="text-partial">stale · </span>}
      <a href={data?.attribution.license_url ?? "https://creativecommons.org/licenses/by-nc/4.0/"} target="_blank" rel="noopener noreferrer" className={link}>
        {data?.attribution.license ?? "CC BY-NC 4.0"}
      </a>
    </p>
  );
}

function Caption({ status, data, tour, focus, onPick }: { status: InternetStatus; data: InternetData | null; tour: Stop[]; focus: number; onPick: (i: number) => void }) {
  const s = tour[focus];
  if (!data || status !== "live" || !s) {
    return (
      <div className="flex min-w-0 flex-col justify-center gap-2">
        <p className="label">Internet now</p>
        <p className="text-[13px] leading-snug text-soft" aria-live="polite">
          {status === "loading" ? "Reading Cloudflare Radar…" : "Live data from Cloudflare Radar is unavailable right now."}
        </p>
        <Credit data={null} />
      </div>
    );
  }
  const c = card(s);
  const cards = tour.map(card);
  return (
    <div className="flex min-w-0 flex-col justify-center gap-3">
      <p className="label">{c.kicker}</p>
      <div aria-live="polite" key={stopKey(s)} className="caption-in">
        <p className="text-[16px] font-semibold leading-snug text-ink">{c.title}</p>
        <p className="num mt-2 text-[28px] leading-none text-ink">{c.figure}</p>
        <p className="mt-1.5 text-[12px] leading-snug text-soft">{c.note}</p>
        <p className="mt-2 text-[12px] leading-snug text-faint">{c.detail}</p>
        {c.link && (
          <a href={c.link.href} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-block text-[12px] leading-snug text-soft hover:text-accent hover:underline hover:underline-offset-4">
            {c.link.text} <span aria-hidden>→</span>
          </a>
        )}
      </div>
      {tour.length > 1 && (
        <div className="flex items-center">
          {tour.map((t, i) => (
            <button
              key={stopKey(t)}
              type="button"
              onClick={() => onPick(i)}
              aria-label={`Show ${i + 1} of ${tour.length}: ${cards[i]!.short}`}
              aria-current={i === focus ? "true" : undefined}
              className="group flex h-6 items-center px-[3px] first:pl-0"
            >
              <span className={`block h-[5px] rounded-full transition-[width,background-color] duration-300 ${i === focus ? "w-5 bg-accent" : "w-[5px] bg-faint group-hover:bg-dim"}`} />
            </button>
          ))}
          <span className="num ml-2 text-[12px] text-faint">
            {focus + 1} / {tour.length}
          </span>
        </div>
      )}
      <Credit data={data} />
    </div>
  );
}

export function InternetBand({ apiUrl, className = "" }: InternetBandProps) {
  const { status, data } = useInternet(apiUrl);
  const live = status === "live" && !!data;
  const tour = useMemo(() => (live && data ? buildTour(data) : []), [live, data]);
  // the hairlines behind the tour: DDoS protection's routes, or the plain routes from an older Worker
  const context = useMemo(() => (live && data ? (data.attacks.ddos.routes.length ? data.attacks.ddos.routes : data.attacks.routes).filter(onMap) : []), [live, data]);
  const [focus, setFocus] = useState(0);
  const control = useRef<GlobeControl>(null);
  const shown = Math.min(focus, Math.max(0, tour.length - 1));
  return (
    <section
      aria-label="Live internet events from Cloudflare Radar"
      className={`grid gap-x-5 gap-y-3 lg:h-[300px] lg:grid-cols-[minmax(0,1fr)_164px] xl:grid-cols-[minmax(0,1fr)_180px] xl:gap-x-6 ${className}`}
    >
      <Globe stops={tour} context={context} running={live} onFocus={setFocus} controlRef={control} className="h-[260px] w-full lg:h-full" />
      <Caption status={status} data={data} tour={tour} focus={shown} onPick={(i) => control.current?.focus(i)} />
    </section>
  );
}
