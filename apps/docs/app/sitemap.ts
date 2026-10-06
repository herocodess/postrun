import type { MetadataRoute } from "next";
import { ALL_PAGES, DOCS } from "@/lib/nav";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return ALL_PAGES.map((p) => ({ url: `${DOCS}${p.href}` }));
}
