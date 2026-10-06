/**
 * The shared report itself, shown inside /s/<id>. Each fetch counts one open.
 *
 * Reports are uploaded by people, so they are treated as untrusted HTML:
 * - `sandbox` (with nothing allowed) gives the page its own opaque origin: no
 *   scripts, no forms, no popups, and no access to this site's cookies or pages.
 * - The CSP also forbids every fetch, font and outside image, so nothing in a
 *   report can phone home. Postrun reports need none of it: they are plain HTML
 *   and CSS.
 * - Only this site may frame it, and it never goes into a cache.
 */

import { gunzipSync } from "node:zlib";
import { isShareId } from "@/lib/ids";
import { openReport } from "@/lib/shares";

export const dynamic = "force-dynamic";

const REPORT_CSP = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gz = isShareId(id) ? await openReport(id) : undefined;
  const headers: Record<string, string> = {
    "content-security-policy": REPORT_CSP,
    "x-content-type-options": "nosniff",
    "x-frame-options": "SAMEORIGIN",
    "referrer-policy": "no-referrer",
    "cross-origin-resource-policy": "same-origin",
    "cache-control": "private, no-store",
    "x-robots-tag": "noindex, nofollow",
  };
  if (!gz) {
    return new Response(
      `<!doctype html><meta charset="utf-8"><title>Not available</title><body style="font:15px system-ui;background:#08090c;color:#a3a9b7;padding:40px;text-align:center">This report is no longer available.</body>`,
      { status: 404, headers: { ...headers, "content-type": "text/html; charset=utf-8" } },
    );
  }
  const acceptsGzip = /\bgzip\b/.test(req.headers.get("accept-encoding") ?? "");
  // Every browser accepts gzip. A client that doesn't gets the plain file only while it fits in one response.
  let body: Buffer;
  try {
    body = acceptsGzip ? gz : gunzipSync(gz, { maxOutputLength: 4 * 1024 * 1024 });
  } catch {
    return new Response("This report is too large to send uncompressed.\n", { status: 406, headers: { ...headers, "content-type": "text/plain; charset=utf-8" } });
  }
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: { ...headers, "content-type": "text/html; charset=utf-8", ...(acceptsGzip ? { "content-encoding": "gzip" } : {}), vary: "accept-encoding" },
  });
}
