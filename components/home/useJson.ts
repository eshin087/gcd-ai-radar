"use client";

import { useEffect, useState } from "react";

/**
 * A small JSON fetch with a module-level cache: the drawer lists under
 * /stats are fetched when first opened and kept for the life of the page.
 * A cached URL is answered during render; only a fetch's outcome sets state.
 */
const cache = new Map<string, unknown>();
const pending = new Map<string, Promise<unknown>>();

export interface JsonState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

interface Outcome<T> {
  url: string;
  data: T | null;
  error: string | null;
}

function load(url: string): Promise<unknown> {
  let p = pending.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: unknown) => {
        cache.set(url, j);
        pending.delete(url);
        return j;
      })
      .catch((e: Error) => {
        pending.delete(url);
        throw e;
      });
    pending.set(url, p);
  }
  return p;
}

export function useJson<T>(url: string | null): JsonState<T> {
  const [outcome, setOutcome] = useState<Outcome<T>>({ url: "", data: null, error: null });
  const cached = url && cache.has(url) ? (cache.get(url) as T) : null;

  useEffect(() => {
    if (!url || cache.has(url)) return;
    let cancelled = false;
    load(url).then(
      (j) => {
        if (!cancelled) setOutcome({ url, data: j as T, error: null });
      },
      (e: Error) => {
        if (!cancelled) setOutcome({ url, data: null, error: e.message });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!url) return { data: null, error: null, loading: false };
  if (cached) return { data: cached, error: null, loading: false };
  if (outcome.url === url) return { data: outcome.data, error: outcome.error, loading: false };
  return { data: null, error: null, loading: true };
}
