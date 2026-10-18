"use client";

import { createShardStore } from "@/components/useShards";
import type { CompactRow } from "@/lib/rows";

/** Compact rows per year shard (public/data/rows/<year>.json), for the dashboard's report drawers. */
export const rowShards = createShardStore<CompactRow>((year) => `/data/rows/${year}.json`);
export const useRowShards = rowShards.useShards;
