import type { NextConfig } from "next";

/**
 * postrun.app is fully static: `next build` writes plain HTML, CSS and JS to
 * apps/web/out, which any static host (Vercel, Netlify, Cloudflare Pages, S3)
 * can serve. No server, no API routes.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
