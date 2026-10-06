import type { Metadata } from "next";
import { pageMeta } from "@/content/meta";
import { PageCta } from "@/components/PageCta";
import { PageShell } from "@/components/PageShell";
import { Reveal } from "@/components/Reveal";
import { formatDate } from "@/content/format";
import { postBySlug } from "@/content/posts";

const post = postBySlug("introducing-postrun");

export const metadata: Metadata = pageMeta("/blog/introducing-postrun/", {
  title: `${post.title} · postrun`,
  description: post.summary,
  // Drafts stay out of search results until they are published.
  ...(post.draft ? { robots: { index: false, follow: true } } : {}),
});

export default function IntroducingPostrun() {
  return (
    <PageShell
      kicker="BLOG"
      title={post.title}
      meta={
        <>
          <span className="page-meta">
            <time dateTime={post.date} className="mono muted small">
              {formatDate(post.date)}
            </time>
            <span className="muted small">by [AUTHOR NAME]</span>
            {post.draft ? <span className="badge-draft">Draft</span> : null}
          </span>
          {post.draft ? (
            <p className="page-notice" role="note">
              Draft, not yet published. This post is for the founder to edit before launch. Items in [BRACKETS] still need filling in.
            </p>
          ) : null}
        </>
      }
    >
      <Reveal className="prose-page">
        <p>
          Coding agents are good now. Good enough that a lot of us hand them real work: a refactor, a failing test, a feature behind a flag. They run for minutes, sometimes much
          longer, and come back with a branch and a confident summary.
        </p>
        <p>Then someone has to review it. That is where it gets hard.</p>

        <h2>The problem with reviewing an agent&rsquo;s work</h2>
        <p>
          The diff shows you where the branch ended up. It doesn&rsquo;t show you how it got there: the commands the agent ran, the test that failed before it passed, the
          approach it tried and threw away, the file it read that you didn&rsquo;t expect it to touch, or the credentials a command printed halfway through.
        </p>
        <p>
          The chat that would tell you scrolls away. The agent&rsquo;s summary is the agent describing its own work. And if you need to show someone else what happened, a
          teammate, a reviewer, a client, your options are a screenshot, a hand-written recap, or a raw log full of your keys and home folder.
        </p>
        <p>[FOUNDER: a sentence or two on the moment this became a problem for you.]</p>

        <h2>What Postrun records</h2>
        <p>
          Postrun is a flight recorder for coding agents. While your agent works, it records the session on your machine: your prompts, the agent&rsquo;s replies, every tool
          call, every command with its output and exit code, and every file it reads or edits.
        </p>
        <p>You review it as one timeline of turns and steps, the same way whichever agent you used. For each session you can see:</p>
        <ul>
          <li>every step in order, live while the agent is still working;</li>
          <li>the files it created, edited or read;</li>
          <li>the commands it ran, with failures, error types and exit codes flagged;</li>
          <li>every edit as a diff, including the ones it later undid.</li>
        </ul>

        <h2>Local first, shared on purpose</h2>
        <p>
          Agent sessions hold everything: full prompts, tool output, and whatever a command printed, including things like the output of <code>env</code>. Streaming that to
          someone else&rsquo;s server by default would make a review tool a security liability. So Postrun doesn&rsquo;t.
        </p>
        <p>
          The recorder and the review app run on your computer and listen on <code>127.0.0.1</code> only. Sessions are stored in <code>~/.postrun</code>, readable only by your
          user account. The app has no telemetry and never phones home.
        </p>
        <p>
          When someone else needs to see a session, you export it. That gives you one HTML file that opens in any browser, with no account and no install. Before it is written,
          Postrun masks secrets, credentials and home folder paths, and shows you every value it masked so you can check them. The file runs no JavaScript and loads nothing
          from the internet. Redaction is a safety net, not a guarantee, so you still skim it before you send it, and you decide who gets it.
        </p>
        <p>
          You can open an <a href="/example-report.html">example report</a> to see exactly what an export looks like. The <a href="/security/">security page</a> has the
          details.
        </p>

        <h2>What works today</h2>
        <ul>
          <li>
            <b>Claude Code and Cline</b> are recorded today, into one shared format. Cursor and Codex are next.
          </li>
          <li>
            <b>Other agents</b> can push sessions through a small local ingest API that needs a token and validates every batch.
          </li>
          <li>
            <b>Live review</b> in the browser, on your machine.
          </li>
          <li>
            <b>Redacted HTML export</b> of a single session, with every mask listed.
          </li>
        </ul>
        <p>
          Hosted share links are planned, built on the same redacted file. There are no accounts and no background sync, and we are not building a cost dashboard. The
          session is the unit. The <a href="/changelog/">changelog</a> lists everything that has shipped so far.
        </p>

        <h2>Join early access</h2>
        <p>
          Postrun is in early access. Leave your email on the <a href="/#waitlist">waitlist</a> and we will send you the install when your agent is supported. Tell us which
          agent you use, and what you wish you could see after it finishes.
        </p>
        <p>[FOUNDER: sign-off and how to reach you.]</p>
      </Reveal>

      <PageCta where="blog-introducing" title="Know what your agents did." />
    </PageShell>
  );
}
