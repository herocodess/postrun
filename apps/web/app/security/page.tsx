import type { Metadata } from "next";
import { pageMeta } from "@/content/meta";
import { PageCta } from "@/components/PageCta";
import { PageShell } from "@/components/PageShell";
import { Reveal } from "@/components/Reveal";

export const metadata: Metadata = pageMeta("/security/", {
  title: "Security · postrun",
  description:
    "How Postrun keeps agent sessions on your machine: owner-only storage in ~/.postrun, loopback-only listeners, no telemetry, and redacted exports with every mask listed.",
});

const TOC = [
  { id: "who", label: "Who this is for" },
  { id: "records", label: "What Postrun records, and where" },
  { id: "network", label: "Network exposure" },
  { id: "telemetry", label: "No telemetry" },
  { id: "files", label: "Files it reads and changes" },
  { id: "export", label: "What export does" },
  { id: "limits", label: "Limits of redaction" },
  { id: "website", label: "This website" },
  { id: "report", label: "Reporting a vulnerability" },
];

const GLANCE = [
  { k: "~/.postrun", v: "Every session is stored on your machine, in folders set to 0700 and files set to 0600." },
  { k: "127.0.0.1", v: "Both listeners bind to loopback only and refuse requests with any other Host header." },
  { k: "no telemetry", v: "The app never contacts our servers. There is no analytics or crash reporting in it." },
  { k: "Bearer token", v: "The one write route, POST /api/ingest, needs a token stored in an owner-only file." },
  { k: "[REDACTED:kind]", v: "Exports mask secrets, credentials and home paths, and list every masked value." },
  { k: "default-src 'none'", v: "Exported reports contain no JavaScript, and their CSP blocks scripts and network requests." },
];

const SECRET_KINDS: Array<[string, string]> = [
  ["private-key", "PEM private key blocks (-----BEGIN ... PRIVATE KEY-----)"],
  ["aws-access-key", "AWS access key IDs starting AKIA or ASIA"],
  ["github-token", "GitHub tokens (ghp_, gho_, ghu_, ghs_, ghr_) and fine-grained github_pat_ tokens"],
  ["anthropic-key", "Anthropic API keys starting sk-ant-"],
  ["openai-key", "OpenAI keys starting sk-, sk-proj- or sk-svcacct-"],
  ["stripe-key", "Stripe secret and restricted keys (sk_live_, sk_test_, rk_live_, rk_test_)"],
  ["slack-token", "Slack tokens starting xoxa-, xoxb-, xoxp-, xoxo-, xoxs- or xoxr-"],
  ["google-api-key", "Google API keys starting AIza"],
  ["jwt", "JSON Web Tokens (three base64url parts starting eyJ)"],
  ["url-password", "Passwords in URLs, such as postgres://user:password@host"],
  ["auth-header", "Bearer, Basic and Token values in Authorization headers"],
  ["credential", "Any value assigned to a credential-named key (see below)"],
];

export default function Security() {
  return (
    <PageShell
      kicker="SECURITY"
      title="Your sessions hold your secrets. Here is how Postrun keeps them."
      lede="Agent sessions contain full prompts, tool output and anything a command printed. Postrun records them on your own machine and shares nothing unless you export a session yourself."
    >
      <Reveal className="sec-grid">
        {GLANCE.map((s) => (
          <div key={s.k} className="sec-cell">
            <code>{s.k}</code>
            <span>{s.v}</span>
          </div>
        ))}
      </Reveal>

      <div className="legal-grid page-section">
        <nav className="legal-toc" aria-label="On this page">
          <span className="kicker muted">ON THIS PAGE</span>
          <ol>
            {TOC.map((t) => (
              <li key={t.id}>
                <a href={`#${t.id}`}>{t.label}</a>
              </li>
            ))}
          </ol>
        </nav>

        <article className="prose-page">
          <h2 id="who">Who this is for</h2>
          <p>
            <b>Engineers</b> deciding whether to run a recorder next to their agent. <b>Security teams</b> reviewing what it stores, what it listens on and what it can send.{" "}
            <b>Procurement and compliance</b> checking where data lives before approving a tool. This page describes what the software does today. The technical security model,
            with more detail, is in the docs at <a href="https://docs.postrun.app/security/">docs.postrun.app/security</a>.
          </p>

          <h2 id="records">What Postrun records, and where</h2>
          <p>
            Postrun records what a supported coding agent (Claude Code and Cline today) does in a session: your prompts, the agent&rsquo;s replies, every tool call with its input
            and output, the commands it runs and what they printed, the files it reads and edits, and timestamps, token counts and cost figures the agent reports.
          </p>
          <p>
            All of it is stored on your computer under <code>~/.postrun</code>: raw capture files, the SQLite session store and its write-ahead log, and the ingest token.
            Everything Postrun creates there is owner-only, with directories set to <code>0700</code> and files to <code>0600</code>. Older files with wider permissions are
            tightened when Postrun opens them. The capture hook sets <code>umask 077</code> for the same reason.
          </p>
          <p>
            The local store is <b>not</b> redacted. It holds whatever the session contained, including the output of commands such as <code>env</code>. Treat{" "}
            <code>~/.postrun</code> as sensitive. Deleting the folder removes everything Postrun has stored. There is no account and no copy anywhere else.
          </p>

          <h2 id="network">Network exposure</h2>
          <p>Postrun runs two local listeners: the review app and API server, and a telemetry receiver that Claude Code reports to.</p>
          <ul>
            <li>
              Both bind to <code>127.0.0.1</code> only, so they cannot be reached from other machines on your network.
            </li>
            <li>
              Both refuse any request whose <code>Host</code> header is not <code>127.0.0.1</code>, <code>localhost</code> or <code>[::1]</code>. This stops DNS rebinding,
              where a web page points its own domain at 127.0.0.1 to read a local API from your browser.
            </li>
            <li>No CORS headers are ever sent, so other websites cannot read responses from the API.</li>
            <li>
              The API has one write route, <code>POST /api/ingest</code>, for adapters that push sessions. It requires a bearer token stored in{" "}
              <code>~/.postrun/ingest-token</code> (mode <code>0600</code>), which a cross-site browser request cannot send. Bodies are capped at 8 MB before and after gzip,
              and every batch is validated against the session schema before anything is written.
            </li>
            <li>The telemetry receiver caps each request at 32 MB before and after gzip.</li>
            <li>
              Responses carry <code>X-Content-Type-Options: nosniff</code>, <code>Referrer-Policy: no-referrer</code> and <code>Cache-Control: no-store</code>. Internal error
              details are logged locally and never returned in a response.
            </li>
          </ul>

          <h2 id="telemetry">No telemetry</h2>
          <p>
            The Postrun app contains no telemetry, analytics or crash reporting, and does not contact our servers. Nothing syncs in the background. A session leaves your machine
            only when you export it, one session at a time, and you decide where the file goes.
          </p>

          <h2 id="files">Files it reads and changes</h2>
          <p>
            Postrun reads the agents&rsquo; own files (Cline&rsquo;s session folder under <code>~/.cline</code>, and the events Claude Code&rsquo;s hooks write) but never writes
            to them. The only file it edits outside <code>~/.postrun</code> is <code>~/.claude/settings.json</code>, so that Claude Code sends telemetry to the local receiver
            and runs the capture hook. The original is backed up once to <code>~/.claude/settings.json.postrun-backup</code>, the change is merged in place with every other
            setting kept, and the write is atomic. Postrun does not ask Claude Code to write raw API request bodies to disk.
          </p>

          <h2 id="export">What export does</h2>
          <p>
            Export turns one session into one HTML file you can share. Redaction is part of every export, not an option. Before the file is written, Postrun masks values and
            replaces each with <code>[REDACTED:kind]</code>. The kinds are:
          </p>
          <ul>
            {SECRET_KINDS.map(([k, v]) => (
              <li key={k}>
                <code>{k}</code>: {v}
              </li>
            ))}
          </ul>
          <h3>The credential-name rule</h3>
          <p>
            A value is masked as <code>credential</code> when it is assigned to a name that looks like a credential, in forms such as <code>NAME=value</code>,{" "}
            <code>&quot;name&quot;: &quot;value&quot;</code> or <code>name: value</code>. A name counts when a whole segment of it, split on <code>_</code>, <code>.</code> or{" "}
            <code>-</code>, is a credential word such as <code>secret</code>, <code>token</code>, <code>password</code>, <code>pwd</code>, <code>passphrase</code>,{" "}
            <code>api_key</code>, <code>private_key</code>, <code>access_key</code>, <code>auth</code>, <code>credentials</code>, <code>client_secret</code> or{" "}
            <code>webhook_secret</code>; or when a camelCase name ends in one, such as <code>apiKey</code>, <code>accessToken</code> or <code>dbPassword</code>. Whole segments
            keep names like <code>author</code> or <code>tokenizer</code> from matching. The value must be at least 6 characters, and obvious non-secrets such as{" "}
            <code>true</code>, placeholders, and references like <code>${"{"}VAR{"}"}</code> or <code>process.env.X</code> are left alone.
          </p>
          <h3>Paths, machine details and notes</h3>
          <p>
            Home folder paths (<code>/Users/name</code>, <code>/home/name</code>, <code>C:\Users\name</code>) become <code>~</code>. The export also leaves out the machine name
            the session was captured on, the local paths of capture files, the owner ID, and any private review note stored with the session.
          </p>
          <h3>You see every mask</h3>
          <p>
            The exporter lists every masked value with its kind, where it was (for example, step 4, command output) and the text around it, so you can check it before sending.
            Home paths are counted rather than listed.
          </p>
          <h3>The report itself</h3>
          <p>
            The exported file contains no JavaScript: steps expand with plain HTML. Every captured string is escaped, and the file carries a Content-Security-Policy of{" "}
            <code>default-src &apos;none&apos;</code> that blocks scripts, frames, forms and network requests. It uses system fonts and inline styles, so it loads nothing from
            the internet. Even agent output crafted to look like HTML cannot run in the reader&rsquo;s browser.
          </p>

          <h2 id="limits">Limits of redaction</h2>
          <p>Redaction is a safety net, not a guarantee. Skim every report before you share it. In particular, it will not catch:</p>
          <ul>
            <li>Secrets in formats it doesn&rsquo;t know, assigned to names that don&rsquo;t look like credentials.</li>
            <li>Credential values shorter than 6 characters, or split across lines.</li>
            <li>Personal data, customer data, proprietary code or business details. It masks secrets, not meaning.</li>
            <li>Usernames in paths outside the standard home folder locations.</li>
          </ul>
          <p>Once you send a report, what happens to it is up to the person who receives it.</p>

          <h2 id="website">This website</h2>
          <p>
            postrun.app sets no cookies and uses no local storage. Visits and button clicks are counted with Vercel Web Analytics, which is cookieless and shows us only aggregate
            numbers. If you join the waitlist, we keep your email address. Fonts are served from our own domain and there are no advertising or third-party scripts. The full
            details are in the <a href="/privacy/#website">privacy policy</a>.
          </p>

          <h2 id="report">Reporting a vulnerability</h2>
          <p>
            If you find a security issue in Postrun or this website, email <b>[SECURITY EMAIL]</b>. Please include steps to reproduce, the version or commit you tested, and the
            impact you see, and give us a chance to fix it before you disclose it publicly. We will acknowledge your report within [RESPONSE TIME].
          </p>
          <p>
            Our contact details are also published at <a href="/.well-known/security.txt">/.well-known/security.txt</a>.
          </p>
        </article>
      </div>

      <PageCta where="security" title="Local by default. Shared on purpose." />
    </PageShell>
  );
}
