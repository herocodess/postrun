import type { Metadata } from "next";
import { pageMeta } from "@/content/meta";
import { PageCta } from "@/components/PageCta";
import { PageFaq } from "@/components/PageFaq";
import { PageShell } from "@/components/PageShell";
import { Reveal } from "@/components/Reveal";
import { StepList } from "@/components/StepList";
import { SOFTWARE } from "@/content/seo";

const PATH = "/claude-code/";
const TITLE = "Claude Code session history, review and sharing · postrun";
const DESCRIPTION =
  "Record every Claude Code session on your own machine: every prompt, command, file read and edit, with failures, cost and tokens. Review it as one timeline, then share a redacted report.";

export const metadata: Metadata = pageMeta(PATH, { title: TITLE, description: DESCRIPTION });

const STEPS = [
  {
    title: "Install and run setup once",
    body: (
      <>
        <code>npm install -g postrun</code>, then <code>postrun setup</code>. Setup adds Postrun&rsquo;s hooks and a local telemetry endpoint to <code>~/.claude/settings.json</code>, backs
        the file up first, and starts a quiet background recorder. Restart any Claude Code session that was already open.
      </>
    ),
  },
  {
    title: "Use Claude Code the way you always do",
    body: "Nothing changes in your terminal. Claude Code sends its events to Postrun on 127.0.0.1 as it works: prompts, tool calls with full input and output, the final reply of each turn, cost and token counts. Nothing goes over the network.",
  },
  {
    title: "Open the session in the review app",
    body: "Every session becomes one timeline of turns and steps at http://127.0.0.1:1234, updating live while Claude works. A plain summary at the top says what changed, what failed and what looks risky.",
  },
  {
    title: "Review, sign off, share",
    body: "Read each command's output and each edit as a diff, mark the session Looks good or Needs follow-up, and copy a pull request summary. When someone else needs to see it, export a redacted report or create a share link.",
  },
];

const FAQ = [
  {
    q: "Where does Claude Code store its history?",
    a: "Claude Code keeps its own transcripts under `~/.claude/projects`, one file per session. They are written for Claude Code to resume a conversation, not for people to review, and they don't show cost, failures or a summary of what changed.\n\nPostrun records each session separately as it happens, into `~/.postrun` on your machine, and turns it into a timeline you can read, search, filter and share.",
  },
  {
    q: "Does Postrun change how Claude Code behaves?",
    a: "No. It adds six hooks (session start and end, each prompt, each tool result and failure, and the end of each turn) and points Claude Code's telemetry at a local receiver. The hooks only record; they never block or change a tool call. `postrun uninstall` takes all of it back out and leaves the rest of your settings as they were.",
  },
  {
    q: "Will it slow my machine down?",
    a: "It is built not to. Several agents running in parallel for twelve hours cost about 1% of one CPU core. Logs are read in small pieces, and raw capture files are cleaned up a day after a session goes quiet.",
  },
  {
    q: "I already send Claude Code telemetry to another tool. Does that still work?",
    a: "Yes. If your settings already send telemetry somewhere else, setup leaves it alone and Postrun records from hooks only. Every prompt, command, edit, read and final reply is still recorded; only cost and token counts are missing, and `postrun doctor` says so.",
  },
  {
    q: "Does it work with sessions recorded before I installed Postrun?",
    a: "Postrun records from the moment setup runs. Sessions from before that aren't imported. If the recorder was stopped while you worked, Claude Code sessions from that time are rebuilt from Postrun's hook log when it starts again, without cost and token counts.",
  },
];

export default function ClaudeCodePage() {
  return (
    <PageShell
      kicker="AGENTS · CLAUDE CODE"
      title="See everything Claude Code did."
      lede="Postrun records every Claude Code session on your own machine and turns it into a timeline you can review, sign off and share. Free and open source."
      crumbs={[["Claude Code", PATH]]}
      ld={[{ ...SOFTWARE, "@id": undefined, name: "Postrun for Claude Code", url: `https://postrun.app${PATH}` }]}
    >
      <Reveal className="prose-page">
        <h2>The terminal isn&rsquo;t a record</h2>
        <p>
          A long Claude Code session runs dozens of commands, reads and edits files across the project, fails a test, tries again and summarises itself at the end. The scrollback
          is the only record, and it&rsquo;s gone when the window closes. The summary is the agent describing its own work.
        </p>
        <p>
          Postrun keeps the whole session: every prompt you wrote, every tool call with its full input and output, every edit in the order it happened, which steps failed and
          why, the git branch and commits, and what the session cost. It stays on your machine in <code>~/.postrun</code>, readable only by you.
        </p>
      </Reveal>

      <section className="page-section" aria-labelledby="how">
        <h2 id="how">How it works</h2>
        <StepList steps={STEPS} />
      </section>

      <Reveal className="page-section prose-page">
        <h2>What you can see in a Claude Code session</h2>
        <ul>
          <li>Every Bash command with its output and exit code, and every failure with its error.</li>
          <li>Every Edit and Write as a diff, file by file, including edits Claude later undid.</li>
          <li>Every file Claude read, and any tool call it made beyond the built-in ones.</li>
          <li>Your prompts and Claude&rsquo;s final reply for each turn.</li>
          <li>Cost, API requests and tokens in and out, from Claude Code&rsquo;s own telemetry.</li>
          <li>Risk flags for <code>rm -rf</code>, force pushes, scripts piped to a shell, secrets printed in output, secrets files and edits outside the project.</li>
        </ul>
        <p>
          The exact settings setup writes, and how to undo them, are in the <a href="https://docs.postrun.app/capture/claude-code/">Claude Code docs</a>. For a walkthrough, read{" "}
          <a href="/guides/see-what-claude-code-did/">how to see exactly what Claude Code did in a session</a>.
        </p>
      </Reveal>

      <PageFaq items={FAQ} title="Claude Code questions" />

      <PageCta where="claude-code" title="Record your next Claude Code session." />
    </PageShell>
  );
}
