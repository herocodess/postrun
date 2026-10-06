import type { ReactNode } from "react";
import { PageShell } from "./PageShell";
import { formatDate } from "@/content/format";
import { article } from "@/content/seo";
import { guideBySlug } from "@/content/guides";

/** Layout for a guide: kicker, title, date and author, article and breadcrumb structured data. */
export function GuideShell({ slug, lede, children }: { slug: string; lede: ReactNode; children: ReactNode }) {
  const g = guideBySlug(slug);
  const path = `/guides/${slug}/`;
  return (
    <PageShell
      kicker="GUIDE"
      title={g.title}
      lede={lede}
      crumbs={[
        ["Guides", "/guides/"],
        [g.short, path],
      ]}
      ld={[article({ path, title: g.title, description: g.summary, published: g.published, ...(g.modified ? { modified: g.modified } : {}) })]}
      meta={
        <span className="page-meta">
          <time dateTime={g.modified ?? g.published} className="mono muted small">
            {formatDate(g.modified ?? g.published)}
          </time>
          <span className="muted small">by Hero Momoh</span>
        </span>
      }
    >
      {children}
    </PageShell>
  );
}
