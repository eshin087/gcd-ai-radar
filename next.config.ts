import type { NextConfig } from "next";

/**
 * Fully static export. The site reads /data/*.json at build time and ships
 * plain HTML/JS, so it can be hosted anywhere (Vercel today, GitHub Pages or
 * Cloudflare Pages if that ever changes) with zero runtime secrets.
 */
const nextConfig: NextConfig = {
  output: "export",
  reactStrictMode: true,
  images: { unoptimized: true },
  trailingSlash: false,
};

export default nextConfig;
