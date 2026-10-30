"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { STACK_FILE, STACK_STORAGE_KEY, parsePicks, stackMatches, type StackCandidate, type StackFile, type StackMatch } from "@/lib/panel/picks";
import { SITE } from "@/lib/site";

/**
 * What the panel's instruments share in the browser: the visitor's stack and
 * the live NVD counts.
 *
 * The stack: the build's default until the visitor chooses. A ?stack=key,key
 * URL applies and stores its picks; otherwise localStorage holds them. Picks
 * other than the default need every candidate, fetched once from
 * /stats/stack.json. Until that settles, html.stack-custom (app/layout.tsx)
 * hides the numbers that depend on it; a failed fetch falls back to the
 * default.
 *
 * The pulse: the Worker's /v1/pulse, fetched on load and every ten minutes
 * while the page is visible; used only when it is newer than the build's NVD
 * file. Until the Worker answers, the page keeps the build's numbers.
 */

export interface Pulse {
  fetched_at: string;
  day: number;
  week: number;
  stale: boolean;
}

interface PanelStateValue {
  picks: string[];
  isDefault: boolean;
  tiles: StackCandidate[];
  matches: StackMatch[];
  ready: boolean;
  file: StackFile | null;
  loadFile: () => Promise<StackFile | null>;
  setPicks: (picks: string[]) => void;
  pulse: Pulse | null;
}

const Ctx = createContext<PanelStateValue | null>(null);

export function usePanelState(): PanelStateValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePanelState outside PanelState");
  return v;
}

const PULSE_EVERY_MS = 10 * 60_000;

let fileRequest: Promise<StackFile | null> | null = null;
function fetchStackFile(): Promise<StackFile | null> {
  fileRequest ??= fetch(STACK_FILE)
    .then((r) => (r.ok ? (r.json() as Promise<StackFile>) : null))
    .catch(() => null);
  return fileRequest;
}

function readStored(): string | null {
  try {
    return localStorage.getItem(STACK_STORAGE_KEY);
  } catch {
    return null;
  }
}

function store(picks: string[] | null) {
  try {
    if (picks) localStorage.setItem(STACK_STORAGE_KEY, picks.join(","));
    else localStorage.removeItem(STACK_STORAGE_KEY);
  } catch {
    // private windows and blocked storage: the picks live for this visit only
  }
}

export function PanelState({ defaults, defaultMatches, nvdFetched, children }: { defaults: StackCandidate[]; defaultMatches: StackMatch[]; nvdFetched: string | null; children: ReactNode }) {
  const defaultKeys = useMemo(() => defaults.map((t) => t.key), [defaults]);
  const [picks, setPicksState] = useState<string[]>(defaultKeys);
  const [file, setFile] = useState<StackFile | null>(null);
  const [ready, setReady] = useState(false);
  const [pulse, setPulse] = useState<Pulse | null>(null);

  // the visitor's own picks, from the URL or storage
  useEffect(() => {
    const fromUrl = new URLSearchParams(location.search).get("stack");
    const raw = fromUrl ?? readStored();
    // nothing stored: the default stack is already on the page, and html.stack-custom was never set
    if (!raw) return;
    let live = true;
    fetchStackFile().then((f) => {
      if (!live) return;
      if (f) {
        const parsed = parsePicks(raw, new Set(f.candidates.map((c) => c.key)));
        setFile(f);
        if (parsed.length) {
          setPicksState(parsed);
          if (fromUrl) store(parsed);
        }
      }
      setReady(true);
      document.documentElement.classList.remove("stack-custom");
    });
    return () => {
      live = false;
    };
  }, []);

  // the live NVD counts
  useEffect(() => {
    if (!SITE.pulseApi) return;
    let stopped = false;
    const built = nvdFetched ? Date.parse(nvdFetched) : 0;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await fetch(SITE.pulseApi, { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as { fetched_at?: string; nvd?: { day?: number; week?: number }; stale?: boolean };
        const t = Date.parse(j.fetched_at ?? "");
        if (stopped || !Number.isFinite(t) || t <= built || !Number.isInteger(j.nvd?.day) || !Number.isInteger(j.nvd?.week)) return;
        setPulse({ fetched_at: j.fetched_at!, day: j.nvd!.day!, week: j.nvd!.week!, stale: Boolean(j.stale) });
      } catch {
        // the Worker is optional: the page keeps the build's numbers
      }
    };
    const first = window.setTimeout(load, 1500);
    const every = window.setInterval(load, PULSE_EVERY_MS);
    const onShow = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      stopped = true;
      window.clearTimeout(first);
      window.clearInterval(every);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [nvdFetched]);

  const loadFile = useCallback(async () => {
    const f = file ?? (await fetchStackFile());
    if (f && !file) setFile(f);
    return f;
  }, [file]);

  const setPicks = useCallback(
    (next: string[]) => {
      const same = next.length === defaultKeys.length && next.every((k, i) => k === defaultKeys[i]);
      setPicksState(next.length ? next : defaultKeys);
      store(same || next.length === 0 ? null : next);
    },
    [defaultKeys],
  );

  const isDefault = picks.length === defaultKeys.length && picks.every((k, i) => k === defaultKeys[i]);
  const value = useMemo<PanelStateValue>(() => {
    const source = file?.candidates ?? defaults;
    const tiles = isDefault ? defaults : picks.map((k) => source.find((c) => c.key === k)).filter((c): c is StackCandidate => Boolean(c));
    const matches = isDefault || !file ? defaultMatches : stackMatches(file, picks);
    return { picks, isDefault, tiles, matches, ready, file, loadFile, setPicks, pulse };
  }, [picks, isDefault, file, defaults, defaultMatches, ready, loadFile, setPicks, pulse]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
