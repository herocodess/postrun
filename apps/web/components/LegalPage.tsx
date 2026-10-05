import type { ReactNode } from "react";
import { Footer } from "./Footer";
import { Nav } from "./Nav";

/** Shared layout for /privacy and /terms: readable measure, contents list, draft notice. */
export function LegalPage({
  title,
  updated,
  summary,
  toc,
  children,
}: {
  title: string;
  updated: string;
  summary: ReactNode;
  toc: Array<{ id: string; label: string }>;
  children: ReactNode;
}) {
  return (
    <>
      <Nav />
      <main id="top" className="legal">
        <div className="wrap legal-wrap">
          <header className="legal-head">
            <span className="kicker muted">LEGAL</span>
            <h1>{title}</h1>
            <p className="mono muted small">Last updated {updated}</p>
            <p className="legal-draft" role="note">
              Draft for early access. Items in [BRACKETS] still need filling in, and this page should be reviewed by a lawyer before launch.
            </p>
          </header>
          <div className="legal-summary">{summary}</div>
          <div className="legal-grid">
            <nav className="legal-toc" aria-label="On this page">
              <span className="kicker muted">ON THIS PAGE</span>
              <ol>
                {toc.map((t) => (
                  <li key={t.id}>
                    <a href={`#${t.id}`}>{t.label}</a>
                  </li>
                ))}
              </ol>
            </nav>
            <article className="legal-body">{children}</article>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
