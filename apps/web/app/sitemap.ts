import type { MetadataRoute } from "next";
import { USE_CASES } from "@/content/use-cases";
import { POSTS } from "@/content/posts";

export const dynamic = "force-static";

const SITE = "https://postrun.app";

/** Every public page. Draft posts are left out until they are published. */
export default function sitemap(): MetadataRoute.Sitemap {
  const paths = [
    "/",
    "/demo/",
    "/use-cases/",
    ...USE_CASES.map((u) => `/use-cases/${u.slug}/`),
    "/security/",
    "/changelog/",
    "/blog/",
    ...POSTS.filter((p) => !p.draft).map((p) => `/blog/${p.slug}/`),
    "/privacy/",
    "/terms/",
  ];
  return paths.map((p) => ({ url: `${SITE}${p}` }));
}
