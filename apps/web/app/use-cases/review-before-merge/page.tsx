import type { Metadata } from "next";
import { PageCta } from "@/components/PageCta";
import { PageShell } from "@/components/PageShell";
import { Reveal } from "@/components/Reveal";
import { StepList } from "@/components/StepList";

export const metadata: Metadata = {
  title: "Review an agent's work before you merge · postrun",
  description:
    "The diff shows the end state. Postrun shows the whole agent session: every command, failure and edit, so you can review how the change was made before you merge it.",
};

const STEPS = [
  {
    title: "Record while the agent works",
    body: (
      <>
        Postrun captures Claude Code and Cline sessions on your own machine as they run. Prompts, replies, tool calls, command output and edits land in a private store in{" "}
        <code>~/.postrun</code>. You keep working the way you already do.
      </>
    ),
  },
  {
    title: "Open the session, not just the diff",
    body: "The review app lays the session out as one timeline of turns and steps. Above it: a summary of steps, files touched and commands run, a list of every file the agent created, edited or read, and a table of the commands it ran with their exit codes. If the agent is still working, the view updates live.",
  },
  {
    title: "Start with what failed",
    body: "Failed commands are flagged in the timeline with their error type and exit code, and counted in the summary. Expand one to read its output, then follow the next steps to see whether the agent fixed the problem or worked around it.",
  },
  {
    title: "Read the edits as diffs",
    body: "Every edit the agent made is shown as a diff in the order it happened, including edits it later undid. You see the approaches it tried, not only the one that survived into the branch.",
  },
  {
    title: "Send the report with the pull request",
    body: "When someone else is reviewing, export the session. Postrun masks secrets, credentials and home paths, lists every value it masked so you can check them, and writes one HTML file that opens in any browser with no account and no install.",
  },
];

export default function ReviewBeforeMerge() {
  return (
    <PageShell
      kicker="USE CASE · REVIEW"
      title="Review an agent's work before you merge."
      lede="A pull request shows where the branch ended up. Postrun shows how it got there, so you can review the work and not only the result."
    >
      <Reveal className="prose-page">
        <h2>The problem</h2>
        <p>
          When a coding agent opens a pull request, the diff is the end state. It doesn&rsquo;t show the commands the agent ran, the test that failed twice before it passed, the
          files it read and changed back, or the credentials a command printed on the way. The chat that would tell you scrolls away, and the agent&rsquo;s own summary is the
          agent describing itself.
        </p>
        <p>So the reviewer either trusts the summary or reconstructs the session by hand. Neither is a review.</p>
      </Reveal>

      <section className="page-section" aria-labelledby="how">
        <h2 id="how">How Postrun handles it</h2>
        <StepList steps={STEPS} />
      </section>

      <Reveal className="page-section prose-page">
        <h2>What a reviewer can check</h2>
        <ul>
          <li>Commands you didn&rsquo;t expect the agent to run, with their full output.</li>
          <li>Tests or builds that failed, and whether they were run again afterwards.</li>
          <li>Files touched outside the scope of the change.</li>
          <li>Edits that were made and then reverted, which the final diff hides.</li>
          <li>Secrets that appeared in output, which are masked and listed when you export.</li>
        </ul>
        <p>
          All of this stays on the machine that recorded it. Nothing leaves unless you export a session, one at a time. See <a href="/security/">security</a> for the details.
        </p>
      </Reveal>

      <PageCta where="use-case-review" title="Review the session, then merge." />
    </PageShell>
  );
}
