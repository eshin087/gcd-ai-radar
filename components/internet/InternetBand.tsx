"use client";

import { useMemo, useRef, useState } from "react";
import { Globe, TOUR, type GlobeControl, type GlobeLook } from "./Globe";
import { inSentence, onMap, plainName } from "./globe/geo";
import { useInternet, type InternetData, type InternetRoute, type InternetStatus } from "./useInternet";

/**
 * The hero's live band: the globe, and beside it one narrow caption that says
 * in words which route the globe is showing. The routes are Cloudflare
 * Radar's top layer 7 attack pairs for the last hour: the origin is where the
 * attacking IP addresses are, the target is the billing location of the
 * attacked site ("For the target location of the attacks, Cloudflare uses the
 * billing location associated with the zone under attack",
 * developers.cloudflare.com/radar/investigate/application-layer-attacks), and
 * the share is of all the layer 7 attacks Cloudflare mitigated in the window.
 *
 * Radar data is CC BY-NC 4.0: the credit line under the caption names it,
 * links it, carries Radar's own timestamp and the licence, and the data never
 * enters the CC BY-SA dataset. Idle (no Worker, unreachable, an error) keeps
 * the globe still and says so in one line.
 */

export interface InternetBandProps {
  /** The Worker's /v1/internet URL; undefined renders the idle state. */
  apiUrl?: string;
  look?: GlobeLook;
  className?: string;
}

/** "hh:mm UTC" from an ISO timestamp. */
export function utcClock(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return `${new Date(ms).toISOString().slice(11, 16)} UTC`;
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

function Caption({ status, data, tour, focus, onPick }: { status: InternetStatus; data: InternetData | null; tour: InternetRoute[]; focus: number; onPick: (i: number) => void }) {
  const r = tour[focus];
  if (!data || status !== "live" || !r) {
    return (
      <div className="flex min-w-0 flex-col justify-center gap-2">
        <p className="label">Web attacks</p>
        <p className="text-[13px] leading-snug text-soft" aria-live="polite">
          {status === "loading" ? "Reading Cloudflare Radar…" : "Live attack routes are unavailable right now."}
        </p>
        <Credit data={null} />
      </div>
    );
  }
  const from = plainName(r.origin_name), to = plainName(r.target_name);
  const fromIn = inSentence(r.origin_name), toIn = inSentence(r.target_name);
  const self = r.origin === r.target;
  return (
    <div className="flex min-w-0 flex-col justify-center gap-3">
      <p className="label">{data.window === "1h" ? "Last hour" : "Last 24 hours"}</p>
      <div aria-live="polite" key={`${r.origin}>${r.target}`} className="caption-in">
        <p className="text-[16px] font-semibold leading-snug text-ink">
          {self ? (
            <>Within {fromIn}</>
          ) : (
            <>
              {from} <span className="text-accent">→</span> {to}
            </>
          )}
        </p>
        <p className="num mt-2 text-[28px] leading-none text-ink">
          {r.share.toFixed(1)}
          <span className="text-[14px] text-dim"> %</span>
        </p>
        <p className="mt-1.5 text-[12px] leading-snug text-soft">of the web attacks Cloudflare stopped</p>
        <p className="mt-2 text-[12px] leading-snug text-faint">{self ? `From IPs in ${fromIn} to sites billed there.` : `From IPs in ${fromIn} to sites billed in ${toIn}.`}</p>
      </div>
      {tour.length > 1 && (
        <div className="flex items-center">
          {tour.map((t, i) => (
            <button
              key={`${t.origin}>${t.target}`}
              type="button"
              onClick={() => onPick(i)}
              aria-label={`Show route ${i + 1} of ${tour.length}: ${plainName(t.origin_name)} to ${plainName(t.target_name)}, ${t.share.toFixed(1)} %`}
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

export function InternetBand({ apiUrl, look = "signal", className = "" }: InternetBandProps) {
  const { status, data } = useInternet(apiUrl);
  const live = status === "live" && !!data;
  const routes = useMemo(() => (live && data ? data.attacks.routes.filter(onMap) : []), [live, data]);
  const tour = routes.slice(0, TOUR);
  const [focus, setFocus] = useState(0);
  const control = useRef<GlobeControl>(null);
  const shown = Math.min(focus, Math.max(0, tour.length - 1));
  return (
    <section
      aria-label="Web attacks in the last hour"
      className={`grid gap-x-5 gap-y-3 lg:h-[300px] lg:grid-cols-[minmax(0,1fr)_164px] xl:grid-cols-[minmax(0,1fr)_180px] xl:gap-x-6 ${className}`}
    >
      <Globe routes={routes} running={live} look={look} onFocus={setFocus} controlRef={control} className="h-[260px] w-full lg:h-full" />
      <Caption status={status} data={data} tour={tour} focus={shown} onPick={(i) => control.current?.focus(i)} />
    </section>
  );
}
