import type { MetadataRoute } from "next";
import { USE_CASES } from "@/content/use-cases";
import { POSTS } from "@/content/posts";
import { GUIDES } from "@/content/guides";
import { RELEASES } from "@/content/changelog";

export const dynamic = "force-static";

const SITE = "https://postrun.app";

/** Every public page. Draft posts are left out until they are published. */
export default function sitemap(): MetadataRoute.Sitemap {
  const paths = [
    "/",
    "/demo/",
    "/claude-code/",
    "/cline/",
    "/guides/",
    ...GUIDES.map((g) => `/guides/${g.slug}/`),
    "/use-cases/",
    ...USE_CASES.map((u) => `/use-cases/${u.slug}/`),
    "/security/",
    "/changelog/",
    "/blog/",
    ...POSTS.filter((p) => !p.draft).map((p) => `/blog/${p.slug}/`),
    "/privacy/",
  ];
  // Last real content change: the newest release for product pages, the guide's own date for guides.
  const latest = RELEASES[0]?.date;
  const guideDate = new Map(GUIDES.map((g) => [`/guides/${g.slug}/`, g.modified ?? g.published]));
  return paths.map((p) => {
    const lastModified = guideDate.get(p) ?? latest;
    return { url: `${SITE}${p}`, ...(lastModified ? { lastModified } : {}), priority: p === "/" ? 1 : p.split("/").length > 3 ? 0.6 : 0.8 };
  });
}
