import type { SourceKind } from "../lib/config";
import { hnAdapter } from "./hn";
import type { SourceAdapter } from "./types";

/** Registry of source adapters by kind. Kinds without an adapter are skipped with a warning. */
export const ADAPTERS: Partial<Record<SourceKind, SourceAdapter>> = {
  hn: hnAdapter,
};
