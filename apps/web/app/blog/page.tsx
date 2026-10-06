import type { Metadata } from "next";
import { PageShell } from "@/components/PageShell";
import { Reveal } from "@/components/Reveal";
import { formatDate } from "@/content/format";
import { POSTS } from "@/content/posts";

export const metadata: Metadata = {
  title: "Blog · postrun",
  description: "Notes from building Postrun, the flight recorder for coding agents.",
};

export default function Blog() {
  return (
    <PageShell kicker="BLOG" title="Notes from building Postrun." lede="What we are building, why, and what we learn from people reviewing their agents' work.">
      <Reveal>
        <ul className="post-list">
          {POSTS.map((p) => (
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
