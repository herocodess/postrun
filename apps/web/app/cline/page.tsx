import type { Metadata } from "next";
import { pageMeta } from "@/content/meta";
import { PageCta } from "@/components/PageCta";
import { PageFaq } from "@/components/PageFaq";
import { PageShell } from "@/components/PageShell";
import { Reveal } from "@/components/Reveal";
import { StepList } from "@/components/StepList";

const PATH = "/cline/";
const TITLE = "Cline task history, review and sharing · postrun";
const DESCRIPTION =
  "Turn every Cline task into a reviewable timeline: commands with output, file edits as diffs, reads, failures and cost. Recorded on your machine, with nothing to configure. Share a redacted report.";

export const metadata: Metadata = pageMeta(PATH, { title: TITLE, description: DESCRIPTION });

const STEPS = [
  {
    title: "Install Postrun",
    body: (
      <>
        <code>npm install -g postrun</code>, then <code>postrun setup</code>. Setup finds Cline on its own. There is nothing to add to Cline and nothing in its settings changes.
      </>
    ),
  },
  {
    title: "Work in Cline as usual",
    body: "Postrun reads Cline's own session store as each task runs, read only. It picks up new tasks and catches up on tasks that changed while it wasn't running.",
  },
  {
    title: "Review the task as a timeline",
    body: "Open http://127.0.0.1:1234: every message, command, file read and edit in order, with plan and act turns marked, failures in red, and a summary of what changed at the top.",
  },
  {
    title: "Share what you need to",
    body: "Export a redacted HTML report or create a share link. Keys, tokens, passwords and home paths are masked, and you see every masked value before anything leaves.",
  },
];

const FAQ = [
  {
    q: "Where does Cline keep its task history?",
    a: "Current versions of Cline keep each task under `~/.cline/data/sessions`, with the conversation and its metadata in JSON files. Postrun reads that store, read only. The older VS Code storage format isn't read.",
  },
  {
    q: "Do I need to change any Cline settings?",
    a: "No. Postrun never writes Cline's files. If Cline is installed when you run `postrun setup`, it says so; if you install Cline later, its tasks are recorded automatically.",
  },
  {
    q: "Can I review Cline and Claude Code sessions together?",
    a: "Yes. Both are recorded into the same format, so they share one session list, one dashboard and the same review tools. Filter by agent when you want only one.",
  },
  {
    q: "What about approvals?",
    a: "Cline doesn't record a decision for each tool call, so Postrun works it out from your auto-approval settings: categories you auto-approved show as automatic, the rest as accepted by you. The docs mark this as an approximation.",
  },
];

export default function ClinePage() {
  return (
    <PageShell
      kicker="AGENTS · CLINE"
      title="Every Cline task, as a timeline you can review."
      lede="Postrun records Cline tasks on your machine, with nothing to configure, and turns each one into a session you can review, sign off and share."
      crumbs={[["Cline", PATH]]}
    >
      <Reveal className="prose-page">
        <h2>Tasks pile up. Context doesn&rsquo;t.</h2>
        <p>
          Cline does a lot inside one task: plans, runs commands, reads and edits files, retries. Going back to check what happened means scrolling a long chat panel, and
          showing someone else means screenshots.
        </p>
        <p>
          Postrun reads each task as it runs and lays it out as turns and steps: every command with its output and exit code, every edit as a diff, every file read, and the
          steps that failed. Long tasks are refreshed at a pace that keeps the cost under about 1% of a CPU core, so a busy session never slows you down.
        </p>
      </Reveal>

      <section className="page-section" aria-labelledby="how">
        <h2 id="how">How it works</h2>
        <StepList steps={STEPS} />
      </section>

      <Reveal className="page-section prose-page">
        <h2>What you get for each task</h2>
        <ul>
          <li>Commands with their output and exit code, including commands left running in the background.</li>
          <li>Edits as diffs; new files marked as created.</li>
          <li>File reads, codebase searches and web fetches.</li>
          <li>Plan and act turns, your messages and Cline&rsquo;s replies.</li>
          <li>Cost and tokens as Cline reports them, and risk flags across the whole task.</li>
        </ul>
        <p>
          The full mapping from Cline&rsquo;s store to Postrun&rsquo;s timeline is in the <a href="https://docs.postrun.app/capture/cline/">Cline docs</a>.
        </p>
      </Reveal>

      <PageFaq items={FAQ} title="Cline questions" />

      <PageCta where="cline" title="Review your next Cline task properly." />
    </PageShell>
  );
}
