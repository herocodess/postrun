import type { Metadata } from "next";
import { pageMeta } from "@/content/meta";
import { guideBySlug } from "@/content/guides";
import { GuideShell } from "@/components/GuideShell";
import { PageCta } from "@/components/PageCta";
import { Reveal } from "@/components/Reveal";

const SLUG = "see-what-claude-code-did";
const g = guideBySlug(SLUG);
export const metadata: Metadata = pageMeta(`/guides/${SLUG}/`, { title: `${g.title} · postrun`, description: g.summary });

export default function Guide() {
  return (
    <GuideShell slug={SLUG} lede="The terminal shows Claude Code working. It doesn't leave you a record you can check afterwards. Here is how to get one.">
      <Reveal className="prose-page">
        <h2>What you actually want to know</h2>
        <p>After a long Claude Code session, the questions are usually the same:</p>
        <ul>
          <li>Which commands did it run, and what did they print?</li>
          <li>Which files did it read, create and change, and what exactly changed in each?</li>
          <li>What failed, and did it fix the problem or work around it?</li>
          <li>Did it do anything risky: delete files, force push, run a script from the internet, print a secret?</li>
          <li>What did it cost?</li>
        </ul>
        <p>You can answer some of these by hand. Doing it for every session is where it falls apart.</p>

        <h2>The options you already have</h2>
        <h3>Scroll back in the terminal</h3>
        <p>
          Fine for a short session you just watched. Long sessions collapse tool output, scrollback has a limit, and once the window is closed it&rsquo;s gone. You also can&rsquo;t
          search across sessions or hand the scrollback to someone else.
        </p>
        <h3>Read the git diff</h3>
        <p>
          <code>git diff</code> shows where the code ended up. It doesn&rsquo;t show the commands that ran, the test that failed twice before it passed, files the agent changed
          and changed back, or anything outside the repository.
        </p>
        <h3>Read Claude Code&rsquo;s own transcript</h3>
        <p>
          Claude Code keeps a transcript for each session under <code>~/.claude/projects</code> so it can resume conversations. It is a line-per-event log written for the tool,
          not for a person: useful for digging, slow for reviewing, and it doesn&rsquo;t summarise failures, flag risks or show cost per session.
        </p>

        <h2>Record the session as it happens</h2>
        <p>
          Claude Code has two ways to tell other tools what it&rsquo;s doing: <strong>hooks</strong>, small commands it runs at events like each prompt and each tool result, and{" "}
          <strong>OpenTelemetry</strong>, which reports events, cost and token counts. Together they cover everything: full tool input and output from hooks, ordering, cost and
          tokens from telemetry.
        </p>
        <p>Postrun turns both on for you and keeps everything on your machine:</p>
        <pre>
          <code>{`npm install -g postrun
postrun setup`}</code>
        </pre>
        <p>
          Setup backs up <code>~/.claude/settings.json</code>, adds six hooks and points telemetry at a receiver on <code>127.0.0.1</code>, then starts a background recorder.
          Restart any Claude Code session that was already open; Claude Code reads its settings at launch. From then on every session is recorded.{" "}
          <code>postrun uninstall</code> takes it all back out.
        </p>

        <h2>Read the session</h2>
        <p>
          Run <code>postrun open</code>. Each session is one timeline, newest first, with a strip that shows its steps in order: commands, edits, reads and messages in different
          colours, failures in red. Open one and you get:
        </p>
        <ul>
          <li>
            <strong>A plain summary</strong>: how many files changed, which command failed, whether the last one passed, and what was flagged.
          </li>
          <li>
            <strong>The timeline</strong>: every prompt, command, read, edit and reply. Click a step to see its full output or diff. Press <code>f</code> to jump to the next
            failure.
          </li>
          <li>
            <strong>Changes</strong>: every edit grouped by file as diffs, with lines added and removed.
          </li>
          <li>
            <strong>Files and commands</strong>: every file touched, every command run with its exit code.
          </li>
          <li>
            <strong>Risk flags</strong>: destructive commands, force pushes, scripts piped to a shell, secrets in output, secrets files, edits outside the project.
          </li>
        </ul>
        <p>
          Search finds text inside sessions too, so &ldquo;which session ran the migration?&rdquo; takes seconds. The same session list also holds your Cline tasks, if you use
          both.
        </p>

        <h2>From the terminal</h2>
        <pre>
          <code>{`postrun sessions          # recent sessions with steps, failures and cost
postrun export <id>       # a redacted HTML report of one session
postrun share <id>        # the same report as a link that expires`}</code>
        </pre>

        <h2>Then decide</h2>
        <p>
          Mark the session <strong>Looks good</strong> or <strong>Needs follow-up</strong> with a note, and copy a pull request summary with the changes, commands and anything
          worth checking. If someone else needs to see it, read <a href="/guides/share-ai-coding-session-safely/">how to share a session without leaking secrets</a>.
        </p>
      </Reveal>
      <PageCta where="guide-cc" title="Record your next session." />
    </GuideShell>
  );
}
