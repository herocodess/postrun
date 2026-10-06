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
      { href: "/terms/", label: "Terms" },
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
      <div className="wrap footer-note muted">No cookies. Visits are counted anonymously. [GITHUB OR CONTACT]</div>
    </footer>
  );
}
