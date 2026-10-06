import type { Metadata } from "next";
import { pageMeta } from "@/content/meta";
import { guideBySlug } from "@/content/guides";
import { GuideShell } from "@/components/GuideShell";
import { PageCta } from "@/components/PageCta";
import { Reveal } from "@/components/Reveal";

const SLUG = "review-ai-agent-session-checklist";
const g = guideBySlug(SLUG);
export const metadata: Metadata = pageMeta(`/guides/${SLUG}/`, { title: `${g.title} · postrun`, description: g.summary });

const CHECKS: Array<{ title: string; why: string; look: string }> = [
  {
    title: "Destructive commands",
    why: "rm -rf, dropping tables, git reset --hard or git clean can remove work that isn't in the final diff, or that wasn't the agent's to remove.",
    look: "Every delete or reset, and the directory it ran in. Paths built from variables deserve a second look.",
  },
  {
    title: "Force pushes and history rewrites",
    why: "git push --force, a push with a + refspec, or a rebase of a shared branch can overwrite other people's commits.",
    look: "Which branch it pushed to, and whether anyone else works on it.",
  },
  {
    title: "Scripts from the internet",
    why: "curl ... | sh, bash <(curl ...) and similar run code nobody reviewed, with your permissions.",
    look: "The URL, whether you trust it, and what the script did.",
  },
  {
    title: "Secrets in output",
    why: "Commands like env, cat .env or a verbose test run can print keys into the session, and from there into logs, reports and screenshots.",
    look: "Which secret appeared and where. If it was real, rotate it.",
  },
  {
    title: "Secrets files",
    why: "Edits to .env files, credentials or key files change how your app authenticates, and are easy to miss in review.",
    look: "Whether the change was asked for, and that no real values were committed.",
  },
  {
    title: "Edits outside the project",
    why: "An agent that writes to your home folder, shell config or another repository changed more than the task.",
    look: "Every file path outside the workspace, and why it was touched.",
  },
  {
    title: "Failures that disappeared",
    why: "A test that failed and then passed might have been fixed, or skipped, loosened or deleted.",
    look: "What changed between the failing run and the passing one.",
  },
  {
    title: "Changes that were undone",
    why: "Edits made and later reverted don't show in the final diff, but they show what the agent tried and why.",
    look: "Files edited more than once, read in order.",
  },
];

export default function Guide() {
  return (
    <GuideShell slug={SLUG} lede="The diff tells you where the code ended up. These are the things to check about how it got there.">
      <Reveal className="prose-page">
        <p>
          Coding agents are fast and mostly right, which is exactly why their sessions don&rsquo;t get read. Reviewing the final diff catches bad code. It doesn&rsquo;t catch the
          command that deleted a folder outside the repo, the key printed into the log, or the failing test that got quietly skipped. Those live in the session, not in the
          diff.
        </p>
        <p>Run through these eight checks on any session that touched something that matters.</p>

        {CHECKS.map((c, i) => (
          <div key={c.title}>
            <h2>
              {i + 1}. {c.title}
            </h2>
            <p>
              <strong>Why it matters:</strong> {c.why}
            </p>
            <p>
              <strong>What to look at:</strong> {c.look}
            </p>
          </div>
        ))}

        <h2>Doing this without reading every line</h2>
        <p>
          Checking all of that by hand in a terminal log takes longer than the agent took to do the work. Postrun records each session on your machine and flags the first six
          checks automatically. It reads commands the way a shell does, so quoted text doesn&rsquo;t raise false alarms and tricks like <code>bash &lt;(curl ...)</code> or{" "}
          <code>git push +main</code> are still caught. Failures are marked in red on the session&rsquo;s strip; <code>f</code> jumps to the next one. The Changes tab shows every
          edit by file, including the ones that were undone.
        </p>
        <p>
          When you&rsquo;re done, mark the session <strong>Looks good</strong> or <strong>Needs follow-up</strong> and leave a note, so the next person knows it was checked. To show
          the session to a reviewer, see <a href="/guides/share-ai-coding-session-safely/">how to share it without leaking secrets</a>, or read how this fits{" "}
          <a href="/use-cases/review-before-merge/">reviewing an agent&rsquo;s work before you merge</a>.
        </p>
      </Reveal>
      <PageCta where="guide-checklist" title="Let the flags find the risky steps." />
    </GuideShell>
  );
}
