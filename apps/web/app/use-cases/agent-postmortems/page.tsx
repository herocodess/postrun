import type { Metadata } from "next";
import { pageMeta } from "@/content/meta";
import { PageCta } from "@/components/PageCta";
import { PageShell } from "@/components/PageShell";
import { Reveal } from "@/components/Reveal";
import { StepList } from "@/components/StepList";

export const metadata: Metadata = pageMeta("/use-cases/agent-postmortems/", {
  title: "Post-mortem when an agent breaks something · postrun",
  description:
    "When a coding agent deletes the wrong file or breaks the build, Postrun's recorded session shows every step in order: what it ran, what failed, and exactly what it changed.",
});

const STEPS = [
  {
    title: "The session is already on record",
    body: (
      <>
        While capture is running, Postrun records every Claude Code and Cline session on your machine, whether or not you expected to need it. The record is in{" "}
        <code>~/.postrun</code> before anyone asks what happened.
      </>
    ),
  },
  {
    title: "Find the session",
    body: "Sessions are listed newest first, with the agent, the step count and how many steps failed. Open the one that ran when things went wrong.",
  },
  {
    title: "Walk the timeline to the first failure",
    body: "Steps are in the order they happened, grouped into turns, so you can see which prompt led to which action. Failed commands and steps are flagged with their error type and exit code. The first red step is usually where the story starts.",
  },
  {
    title: "See exactly what changed",
    body: "Expand a command to read its full output. Read each edit as a diff, including ones the agent made and then undid. The files list shows everything the agent created, edited or read, which is your checklist for what to inspect or restore.",
  },
  {
    title: "Share the record with the team",
    body: "Export the session to one HTML file and attach it to the incident write-up. Secrets, credentials and home paths are masked first, and every masked value is listed for you to check. People reading it need no account and no install.",
  },
];

export default function AgentPostmortems() {
  return (
    <PageShell
      kicker="USE CASE · POST-MORTEMS"
      title="Post-mortem when an agent breaks something."
      lede="An agent deleted the wrong folder, ran a migration, or left the build red. Postrun has the whole session, step by step, so the write-up starts from facts."
    >
      <Reveal className="prose-page">
        <h2>The problem</h2>
        <p>
          When an agent breaks something, the first question is &ldquo;what exactly did it do?&rdquo; The chat has scrolled away or been cleared. Shell history mixes the agent&rsquo;s
          commands with yours. The final diff shows what changed in the repository, but not the commands it ran outside it, the output it acted on, or the order things happened
          in.
        </p>
        <p>Without that sequence, a post-mortem is guesswork, and the fix for next time is a guess too.</p>
      </Reveal>

      <section className="page-section" aria-labelledby="how">
        <h2 id="how">How Postrun handles it</h2>
        <StepList steps={STEPS} />
      </section>

      <Reveal className="page-section prose-page">
        <h2>What Postrun doesn&rsquo;t do</h2>
        <p>
          Postrun is a recorder, not a guard. It doesn&rsquo;t block commands, stop an agent or roll back changes. It records sessions only while capture is running, and only
          for supported agents: Claude Code and Cline today, with Cursor and Codex next. What it gives you is an exact, ordered account of what happened, so you can decide what to
          undo and what to change.
        </p>
        <p>
          Sessions stay on the machine that recorded them until you export one. See <a href="/security/">security</a> for how that is enforced.
        </p>
      </Reveal>

      <PageCta where="use-case-postmortem" title="Have the record before you need it." />
    </PageShell>
  );
}
