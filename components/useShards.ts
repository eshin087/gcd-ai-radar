"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * Year shards under public/data, fetched when a view needs them and kept for
 * the life of the page. One store per kind of shard (compact rows for the
 * dashboard's drawers, slim records for the explorer); each year is fetched
 * once however many views ask for it.
 */

export interface ShardsState<T> {
  /** Rows of every requested year, or null while any of them is still loading. */
  rows: T[] | null;
  /** Rows of the requested years that have arrived so far, in the order asked. */
  partial: T[];
  /** Years asked for and not yet here. */
  missing: number[];
  error: string | null;
}

export function createShardStore<T>(urlFor: (year: number) => string) {
  const loaded = new Map<number, T[]>();
  const pending = new Map<number, Promise<T[]>>();

  function fetchShard(year: number): Promise<T[]> {
    const have = loaded.get(year);
    if (have) return Promise.resolve(have);
    let p = pending.get(year);
    if (!p) {
      p = fetch(urlFor(year))
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((rows: T[]) => {
          loaded.set(year, rows);
          pending.delete(year);
          return rows;
        })
        .catch((e: Error) => {
          pending.delete(year);
          throw e;
        });
      pending.set(year, p);
    }
    return p;
  }

  /** The rows of the given shard years, loading what is missing. */
  function useShards(years: readonly number[]): ShardsState<T> {
    const key = years.join(",");
    const [version, setVersion] = useState(0);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
      const missing = years.filter((y) => !loaded.has(y));
      if (missing.length === 0) return;
      let cancelled = false;
      setError(null);
      // Each shard bumps the version as it lands, so a long list fills in year by year.
      for (const y of missing) {
        fetchShard(y)
          .then(() => {
            if (!cancelled) setVersion((v) => v + 1);
          })
          .catch((e: Error) => {
            if (!cancelled) setError(e.message);
          });
      }
      return () => {
        cancelled = true;
      };
      // `key` stands for the years list; a new array with the same years must not refetch.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);

    return useMemo(() => {
      const missing = years.filter((y) => !loaded.has(y));
      const partial = years.filter((y) => loaded.has(y)).flatMap((y) => loaded.get(y)!);
      return { rows: missing.length ? null : partial, partial, missing, error };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, version, error]);
  }

  return { useShards, fetchShard, has: (year: number) => loaded.has(year) };
}
