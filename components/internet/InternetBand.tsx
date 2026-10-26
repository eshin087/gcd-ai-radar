"use client";

import type { ReactNode } from "react";
import { Globe } from "./Globe";
import { useInternet, type InternetData, type InternetPoint } from "./useInternet";

/**
 * The home page's live internet band: the globe in the middle, the lead copy
 * (passed in) on the left, four plain-HTML readouts from Cloudflare Radar on
 * the right and the attribution line under them. 300 px tall at lg; on phones
 * it stacks with the globe at 240 px and the readouts in a 2 × 2 grid.
 *
 * States: "loading" shows the globe and empty readouts; "live" shows the
 * routes and readouts with Radar's own timestamp (never the clock); "idle"
 * (no Worker URL, unreachable, or an error) keeps the globe still and says so
 * in one line. The data is CC BY-NC 4.0 and never enters the dataset.
 */

export interface InternetBandProps {
  /** The Worker's /v1/internet URL; undefined renders the idle state. */
  apiUrl?: string;
  /** The left column at lg: live dot, h1, lede, links. */
  lead?: ReactNode;
  className?: string;
}

/** "hh:mm UTC" from an ISO timestamp. */
export function utcClock(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return `${new Date(ms).toISOString().slice(11, 16)} UTC`;
}

const pct = (n: number | null) => (n === null ? "–" : `${Math.round(n)} %`);

function Readout({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 border-t border-line-soft pt-1.5 ${className}`}>
      <div className="label">{label}</div>
      {children}
    </div>
  );
}

/** The 24-hour request series as one hairline, its last point marked. */
function Pulse({ points }: { points: InternetPoint[] }) {
  if (points.length < 2) return <div className="h-7 text-[12px] text-faint">no series</div>;
  const values = points.map((p) => p.value);
  const lo = Math.min(...values), hi = Math.max(...values);
  const span = hi - lo || 1;
  const n = points.length - 1;
  const path = points.map((p, i) => `${((i / n) * 100).toFixed(2)},${(22 - ((p.value - lo) / span) * 20).toFixed(2)}`).join(" ");
  const last = points[points.length - 1]!;
  const ly = 22 - ((last.value - lo) / span) * 20;
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="block h-7 w-full" aria-hidden>
      <line x1="0" y1="23.5" x2="100" y2="23.5" stroke="rgba(160,170,195,0.18)" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
      <polyline points={path} fill="none" stroke="var(--color-accent)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      <rect x="99" y={ly - 1.5} width="2" height="3" fill="var(--color-ink)" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Readouts({ data }: { data: InternetData }) {
  const points = data.traffic.points;
  const lastShare = [...points].reverse().find((p) => p.human !== null && p.bot !== null) ?? null;
  const routes = data.attacks.routes.slice(0, 3);
  const open = data.outages.filter((o) => o.until === null);
  const shown = (open.length ? open : data.outages).slice(0, 2);
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
      <Readout label="Traffic · 24 h">
        <Pulse points={points} />
        <p className="num mt-0.5 text-[12px] text-soft">
          human <span className="text-ink">{pct(lastShare?.human ?? null)}</span> · bot <span className="text-ink">{pct(lastShare?.bot ?? null)}</span>
        </p>
      </Readout>
      <Readout label={data.window === "1h" ? "Attacks · 1 h" : "Attacks · 24 h"}>
        {routes.length ? (
          <ol className="num text-[12px] leading-[18px]">
            {routes.map((r) => (
              <li key={`${r.origin}-${r.target}`} className="flex justify-between gap-2" title={`${r.origin_name} → ${r.target_name}`}>
                <span className="text-ink">
                  {r.origin} → {r.target}
                </span>
                <span className="text-dim">{r.share.toFixed(1)} %</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-[12px] text-faint">no routes reported</p>
        )}
      </Readout>
      <Readout label="Outages now">
        <p className="num text-[13px] leading-snug text-ink">
          {open.length}
          {open.length === 0 && data.outages.length > 0 && <span className="text-dim"> · {data.outages.length} in 24 h</span>}
        </p>
        <ul className="text-[12px] leading-[16px] text-soft">
          {shown.map((o) => (
            <li key={`${o.location}-${o.since}`} className="truncate" title={o.description}>
              {o.url ? (
                <a href={o.url} target="_blank" rel="noopener noreferrer" className="hover:text-accent hover:underline hover:underline-offset-4">
                  {o.location}
                </a>
              ) : (
                o.location
              )}
              {o.cause && <span className="text-dim"> · {o.cause}</span>}
              {o.until && <span className="text-faint"> · ended</span>}
            </li>
          ))}
        </ul>
      </Readout>
      <Readout label="Routing · 24 h">
        <p className="num text-[13px] leading-snug text-ink">
          {data.bgp.leaks} <span className="text-dim">route leaks</span>
        </p>
        <p className="num text-[13px] leading-snug text-ink">
          {data.bgp.hijacks} <span className="text-dim">hijacks</span>
        </p>
      </Readout>
    </div>
  );
}

export function InternetBand({ apiUrl, lead, className = "" }: InternetBandProps) {
  const { status, data } = useInternet(apiUrl);
  const routes = data?.attacks.routes ?? [];
  const clock = utcClock(data?.radar_updated ?? null);
  const live = status === "live" && !!data;
  return (
    <section
      aria-label="The internet now"
      className={`grid gap-x-6 gap-y-4 ${lead ? "lg:grid-cols-[minmax(0,1fr)_300px_minmax(0,1.1fr)]" : "lg:grid-cols-[300px_minmax(0,1fr)]"} lg:h-[300px] ${className}`}
    >
      {lead && <div className="min-w-0 lg:flex lg:flex-col lg:justify-center">{lead}</div>}
      <Globe routes={live ? routes : []} running={live} className="h-[240px] w-full lg:h-[300px]" />
      <div className="flex min-w-0 flex-col justify-between gap-3">
        {live && data ? (
          <Readouts data={data} />
        ) : (
          <p className="text-[12px] text-faint" aria-live="polite">
            {status === "loading" ? "Reading Cloudflare Radar…" : "Live internet readouts are unavailable: Cloudflare Radar is not reachable right now."}
          </p>
        )}
        <p className="num text-[12px] text-dim">
          {live && data ? (
            <>
              <span aria-hidden className={`mr-1.5 inline-block size-1.5 rounded-full align-middle ${data.stale ? "bg-partial" : "bg-patched"}`} />
              <a href={data.attribution.url} target="_blank" rel="noopener noreferrer" className="hover:text-accent hover:underline hover:underline-offset-4">
                {data.attribution.name}
              </a>
              {clock && <> · {clock}</>}
              {" · "}
              <a href={data.attribution.license_url} target="_blank" rel="noopener noreferrer" className="hover:text-accent hover:underline hover:underline-offset-4">
                {data.attribution.license}
              </a>
              {data.stale && <span className="text-partial"> · stale</span>}
            </>
          ) : (
            <>
              <span aria-hidden className="mr-1.5 inline-block size-1.5 rounded-full bg-closed align-middle" />
              <a href="https://radar.cloudflare.com/" target="_blank" rel="noopener noreferrer" className="hover:text-accent hover:underline hover:underline-offset-4">
                Cloudflare Radar
              </a>
              {" · "}
              {status === "loading" ? "loading" : "idle"} · CC BY-NC 4.0
            </>
          )}
        </p>
      </div>
    </section>
  );
}
