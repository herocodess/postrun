import { Reveal } from "./Reveal";
import { LOGIN_URL } from "@/content/site";

/** Closing call to action for content pages: get started, and the example report. */
export function PageCta({
  title = "See it on a real session.",
  body = "Postrun records Claude Code and Cline on your machine, free and open source. Open the example report to see exactly what an export looks like, or install it in a minute.",
  where,
}: {
  title?: string;
  body?: string;
  /** Where the CTA sits, for click counts (data-track-where). */
  where: string;
}) {
  return (
    <Reveal className="page-cta">
      <h2>{title}</h2>
      <p>{body}</p>
      <div className="cta-row">
        <a href={LOGIN_URL} className="btn btn-primary" data-track="Get started" data-track-where={where}>
          Get started
        </a>
        <a href="/example-report.html" target="_blank" rel="noopener" className="btn btn-ghost" data-track="Example report" data-track-where={where}>
          See an example report <span aria-hidden="true">→</span>
        </a>
      </div>
    </Reveal>
  );
}
