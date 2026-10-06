import type { Metadata } from "next";

/**
 * Per-page metadata. Next merges metadata shallowly, so without this every
 * page would inherit the home page's canonical URL, share title and og:url.
 * `path` is the page's own path with a trailing slash, e.g. "/security/".
 */
export function pageMeta(path: string, m: Metadata & { title: string; description: string }): Metadata {
  return {
    ...m,
    alternates: { canonical: path },
    openGraph: { title: m.title, description: m.description, url: path, siteName: "postrun", type: "website" },
    twitter: { card: "summary_large_image", title: m.title, description: m.description },
  };
}
