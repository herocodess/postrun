import type { Metadata } from "next";
import { pageMeta } from "@/content/meta";
import { PageCta } from "@/components/PageCta";
import { PageShell } from "@/components/PageShell";
import { Reveal } from "@/components/Reveal";
import { GUIDES } from "@/content/guides";

export const metadata: Metadata = pageMeta("/guides/", {
  title: "Guides: reviewing and sharing AI coding agent sessions · postrun",
  description: "Practical guides to seeing what coding agents like Claude Code and Cline actually did, reviewing their work before you trust it, and sharing sessions without leaking secrets.",
});

export default function Guides() {
  return (
    <PageShell
      kicker="GUIDES"
      title="Know what your agents did."
      lede="Practical guides to recording, reviewing and sharing coding agent sessions."
      crumbs={[["Guides", "/guides/"]]}
      ld={[
        {
          "@type": "ItemList",
          itemListElement: GUIDES.map((g, i) => ({ "@type": "ListItem", position: i + 1, url: `https://postrun.app/guides/${g.slug}/`, name: g.title })),
        },
      ]}
    >
      <Reveal className="page-section">
        <ul className="post-list">
          {GUIDES.map((g) => (
            <li key={g.slug}>
              <a href={`/guides/${g.slug}/`} className="post-card">
                <h2>{g.title}</h2>
                <p>{g.summary}</p>
              </a>
            </li>
          ))}
        </ul>
      </Reveal>
      <PageCta where="guides" />
    </PageShell>
  );
}
