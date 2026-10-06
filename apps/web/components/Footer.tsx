import { GITHUB_URL } from "@/content/site";
import { Mark } from "./Logo";

type FooterLink = { href: string; label: string; external?: boolean; track?: string };

const COLUMNS: Array<{ title: string; links: FooterLink[] }> = [
  {
    title: "Product",
    links: [
      { href: "/#how", label: "How it works" },
      { href: "/demo/", label: "Try the demo" },
      { href: "/example-report.html", label: "Example report", external: true, track: "Example report" },
      { href: "https://docs.postrun.app/", label: "Docs" },
      { href: "/changelog/", label: "Changelog" },
    ],
  },
  {
    title: "Agents",
    links: [
      { href: "/claude-code/", label: "Claude Code" },
      { href: "/cline/", label: "Cline" },
      { href: "https://docs.postrun.app/capture/other-agents/", label: "Other agents" },
    ],
  },
  {
    title: "Guides",
    links: [
      { href: "/guides/see-what-claude-code-did/", label: "See what Claude Code did" },
      { href: "/guides/share-ai-coding-session-safely/", label: "Share a session safely" },
      { href: "/guides/review-ai-agent-session-checklist/", label: "Agent review checklist" },
      { href: "/guides/", label: "All guides" },
    ],
  },
  {
    title: "Use cases",
    links: [
      { href: "/use-cases/review-before-merge/", label: "Review before merge" },
      { href: "/use-cases/client-reporting/", label: "Client reporting" },
      { href: "/use-cases/agent-postmortems/", label: "Agent post-mortems" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/blog/", label: "Blog" },
      { href: "/security/", label: "Security" },
      { href: "/privacy/", label: "Privacy" },
      { href: "/privacy/#cookies", label: "Cookies" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap footer-grid">
        <div className="footer-about">
          <a href="/" className="footer-brand" aria-label="postrun home">
            <Mark size={20} /> postrun
          </a>
          <span className="muted">The flight recorder for coding agents.</span>
        </div>
        <nav aria-label="Footer" className="footer-cols">
          {COLUMNS.map((col) => (
            <div key={col.title} className="footer-col">
              <h2 className="footer-h">{col.title}</h2>
              <ul>
                {col.links.map((l) => (
                  <li key={l.href}>
                    <a
                      href={l.href}
                      {...(l.track ? { "data-track": l.track, "data-track-where": "footer" } : {})}
                      {...(l.external ? { target: "_blank", rel: "noopener" } : {})}
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <div className="wrap footer-note muted">
        <span>Open source under the MIT license. No cookies; visits are counted anonymously.</span>
        <a href={GITHUB_URL} className="footer-gh" target="_blank" rel="noopener" data-track="GitHub" data-track-where="footer">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
          GitHub
        </a>
      </div>
    </footer>
  );
}
