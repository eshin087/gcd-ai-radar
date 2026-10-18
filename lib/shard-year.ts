/**
 * The one rule both the collector and the browser need: a record's shard is
 * the year it was first reported. lib/shards.ts (node, file access) and the
 * client bundles (lib/aggregates.ts, the explorer) share it from here.
 */
export function shardYear(r: { first_reported: string }): number {
  return Number(r.first_reported.slice(0, 4));
}
