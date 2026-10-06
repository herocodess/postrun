import type { Metadata } from "next";
import { pageMeta } from "@/content/meta";
import { PageShell } from "@/components/PageShell";
import { Reveal } from "@/components/Reveal";
import { formatDate } from "@/content/format";
import { LISTED_POSTS } from "@/content/posts";

export const metadata: Metadata = pageMeta("/blog/", {
  title: "Blog · postrun",
  description: "Notes from building Postrun, the flight recorder for coding agents.",
});

export default function Blog() {
  return (
    <PageShell kicker="BLOG" title="Notes from building Postrun." lede="What we are building, why, and what we learn from people reviewing their agents' work.">
      <Reveal>
        {LISTED_POSTS.length === 0 ? <p className="muted">The first post arrives with the launch.</p> : null}
        <ul className="post-list">
          {LISTED_POSTS.map((p) => (
            <li key={p.slug}>
              <a href={`/blog/${p.slug}/`}>
                <span className="page-meta">
                  <time dateTime={p.date} className="mono muted small">
                    {formatDate(p.date)}
                  </time>
                  {p.draft ? <span className="badge-draft">Draft</span> : null}
                </span>
                <h2>{p.title}</h2>
                <p>{p.summary}</p>
              </a>
            </li>
          ))}
        </ul>
      </Reveal>
    </PageShell>
  );
}
