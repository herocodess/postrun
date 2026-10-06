import type { Metadata } from "next";
import { pageMeta } from "@/content/meta";
import { PageCta } from "@/components/PageCta";
import { PageShell } from "@/components/PageShell";
import { Reveal } from "@/components/Reveal";
import { RELEASES, type ChangeKind } from "@/content/changelog";
import { formatDate } from "@/content/format";

export const metadata: Metadata = pageMeta("/changelog/", {
  title: "Changelog · postrun",
  description: "What changed in Postrun, newest first: live capture for Claude Code and Cline, live session review, and redacted HTML export.",
});

const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const LABEL: Record<ChangeKind, string> = { new: "new", improved: "improved", fixed: "fixed", security: "security" };

export default function Changelog() {
  return (
    <PageShell
      crumbs={[["Changelog", "/changelog/"]]} kicker="CHANGELOG" title="What's new in Postrun." lede="Everything that has shipped, newest first. A version number marks what reached npm; update with npm install -g postrun@latest.">
      <div className="releases">
        {RELEASES.map((r) => (
          <Reveal key={`${r.date}-${r.title}`} className="release">
            <div className="release-date">
              <time dateTime={r.date}>{r.date}</time>
              <span className="muted small">{formatDate(r.date)}</span>
              {r.version ? <span className="release-version mono">v{r.version}</span> : null}
            </div>
            <div>
              <h2 id={r.version ? `v${r.version}` : slug(r.title)}>{r.title}</h2>
              {r.summary ? <p>{r.summary}</p> : null}
              <ul className="release-items">
                {r.items.map((it, i) => (
                  <li key={i}>
                    <span className={`tag tag-${it.kind}`}>{LABEL[it.kind]}</span>
                    <span>{it.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        ))}
      </div>
      <PageCta where="changelog" />
    </PageShell>
  );
}
