/**
 * `wrangler types` writes worker-configuration.d.ts from wrangler.jsonc (the
 * CACHE namespace) and from .dev.vars when present. The Radar token is a
 * deployed secret (`wrangler secret put CLOUDFLARE_RADAR_TOKEN`) that no
 * checked-in file carries, so its name is merged into Env here.
 */
declare global {
  interface Env {
    CLOUDFLARE_RADAR_TOKEN?: string;
  }
}

export {};
