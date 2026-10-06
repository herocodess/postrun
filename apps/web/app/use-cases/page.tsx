import type { Metadata } from "next";
import { PageCta } from "@/components/PageCta";
import { PageShell } from "@/components/PageShell";
import { Reveal } from "@/components/Reveal";
import { USE_CASES } from "@/content/use-cases";

export const metadata: Metadata = {
  title: "Use cases · postrun",
  description: "How teams use Postrun: review an agent's work before merging, show a client what the agent did, and run a post-mortem when an agent breaks something.",
};

export default function UseCases() {
  return (
    <PageShell
      kicker="USE CASES"
      title="When someone needs to know what the agent did."
      lede="Postrun records Claude Code and Cline sessions on your machine. These are the moments where that record earns its place."
    >
      <div className="card-grid">
        {USE_CASES.map((u, i) => (
          <Reveal key={u.slug} delay={i * 90}>
            <a href={`/use-cases/${u.slug}/`} className="link-card" data-track={`Use case: ${u.title}`} data-track-where="use-cases">
              <span className="kicker muted">{u.kicker}</span>
              <h2>{u.title}</h2>
              <p>{u.summary}</p>
              <span className="more">
                Read more <span aria-hidden="true">→</span>
              </span>
            </a>
          </Reveal>
        ))}
      </div>
      <PageCta where="use-cases" />
    </PageShell>
  );
}
