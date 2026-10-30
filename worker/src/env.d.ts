/**
 * `wrangler types` writes worker-configuration.d.ts from wrangler.jsonc (the
 * CACHE namespace) and from .dev.vars when present. The Radar token and the
 * collector dispatch token are deployed secrets (`wrangler secret put
 * CLOUDFLARE_RADAR_TOKEN`, `wrangler secret put GITHUB_DISPATCH_TOKEN`) that
 * no checked-in file carries, so their names are merged into Env here.
 */
declare global {
  interface Env {
    CLOUDFLARE_RADAR_TOKEN?: string;
    GITHUB_DISPATCH_TOKEN?: string;
  }
}

export {};
