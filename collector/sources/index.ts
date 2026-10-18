import type { SourceKind } from "../lib/config";
import { aiidAdapter } from "./aiid";
import { arxivAdapter } from "./arxiv";
import { atlasAdapter } from "./atlas";
import { avidAdapter } from "./avid";
import { gdeltAdapter } from "./gdelt";
import { ghsaAdapter } from "./ghsa";
import { hnAdapter } from "./hn";
import { kevAdapter } from "./kev";
import { msrcAdapter } from "./msrc";
import { nvdAdapter } from "./nvd";
import { rssAdapter } from "./rss";
import { sitemapAdapter } from "./sitemap";
import type { SourceAdapter } from "./types";

/** Registry of source adapters by kind. Kinds without an adapter are skipped with a warning. */
export const ADAPTERS: Partial<Record<SourceKind, SourceAdapter>> = {
  hn: hnAdapter,
  rss: rssAdapter,
  arxiv: arxivAdapter,
  msrc: msrcAdapter,
  sitemap: sitemapAdapter,
  gdelt: gdeltAdapter,
  nvd: nvdAdapter,
  ghsa: ghsaAdapter,
  kev: kevAdapter,
  atlas: atlasAdapter,
  avid: avidAdapter,
  aiid: aiidAdapter,
};
