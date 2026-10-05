import type { NextConfig } from "next";

/**
 * postrun.app is fully static: `next build` writes plain HTML, CSS and JS to
 * apps/web/out, which any static host (Vercel, Netlify, Cloudflare Pages, S3)
 * can serve. No server, no API routes.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "export",
  // Emit privacy/index.html rather than privacy.html so /privacy works on any static host.
  trailingSlash: true,
  images: { unoptimized: true },
  // Vercel sets VERCEL=1 during its builds. Analytics loads only there, so local
  // and non-Vercel builds ship with no tracking script at all.
  env: { POSTRUN_ANALYTICS: process.env["VERCEL"] ? "1" : "" },
};

export default nextConfig;
