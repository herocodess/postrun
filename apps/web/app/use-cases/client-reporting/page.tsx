import type { Metadata } from "next";
import { pageMeta } from "@/content/meta";
import { PageCta } from "@/components/PageCta";
import { PageShell } from "@/components/PageShell";
import { Reveal } from "@/components/Reveal";
import { StepList } from "@/components/StepList";

export const metadata: Metadata = pageMeta("/use-cases/client-reporting/", {
  title: "Show a client what the agent did · postrun",
  description:
    "For agencies and freelancers who build with coding agents: send a client one redacted HTML report of the session instead of a hand-written summary or raw logs.",
});

const STEPS = [
  {
    title: "Record the work on your machine",
    body: (
      <>
        Run your Claude Code or Cline session as usual while Postrun records it. Everything stays in <code>~/.postrun</code> on your computer, readable only by your user
        account. Nothing is sent to us or to the client.
      </>
    ),
  },
  {
    title: "Review it yourself first",
    body: "Open the session in the review app. Check the timeline, the files the agent created, edited or read, the commands it ran with their exit codes, and the edits as diffs. You know what the report will say before anyone else reads it.",
  },
  {
    title: "Export one session",
    body: "Export writes one HTML file. Before it is written, Postrun masks known secret formats, credential values and home folder paths, and leaves out your machine name and local capture paths.",
  },
  {
    title: "Check every mask",
    body: "The export lists every value it masked, with where it was and the text around it, so you can confirm nothing slipped through. Redaction is a safety net, not a guarantee, so skim the report before you send it.",
  },
  {
    title: "Send the file",
    body: "Email it, attach it to an invoice or drop it into the client's chat. It opens in any browser with no account and no install. It runs no JavaScript and loads nothing from the internet, so it is safe for the client to open.",
  },
];

export default function ClientReporting() {
  return (
    <PageShell
      crumbs={[["Use cases", "/use-cases/"], ["Client reporting", "/use-cases/client-reporting/"]]}
      kicker="USE CASE · AGENCIES AND FREELANCERS"
      title="Show a client what the agent did."
      lede="When a client asks what they paid for, send them the session: every command, edit and failure, with your keys and paths masked."
    >
      <Reveal className="prose-page">
        <h2>The problem</h2>
        <p>
          More client work is done with coding agents, and clients reasonably ask what happened. A hand-written summary takes time and asks the client to take your word for it.
          Raw logs are unreadable, and they are full of things the client should never see: API keys, tokens, your home folder, other projects on your machine.
        </p>
        <p>What you want is a readable record of the session that you have checked, with the private parts taken out.</p>
      </Reveal>

      <section className="page-section" aria-labelledby="how">
        <h2 id="how">How Postrun handles it</h2>
        <StepList steps={STEPS} />
      </section>

      <Reveal className="page-section prose-page">
        <h2>Before you send it</h2>
        <ul>
          <li>
            <b>A report is the whole session.</b> It includes your prompts and the agent&rsquo;s replies, not only the result. Read it the way the client will.
          </li>
          <li>
            <b>Cost is included when the agent reported it.</b> If the session has cost figures, the report shows them. Decide whether that is something you want to share.
          </li>
          <li>
            <b>Redaction catches secrets, not business context.</b> It masks keys, tokens, passwords and paths. It doesn&rsquo;t know that a file name or a comment mentions
            another client.
          </li>
          <li>
            <b>One session per report.</b> A piece of work that spans several sessions becomes several files.
          </li>
        </ul>
        <p>
          Open the <a href="/example-report.html">example report</a> to see exactly what a client would receive.
        </p>
      </Reveal>

      <PageCta where="use-case-client" title="Give clients the record, not a recap." />
    </PageShell>
  );
}
