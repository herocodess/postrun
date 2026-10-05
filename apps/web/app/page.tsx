import { ExportDemo } from "@/components/ExportDemo";
import { LiveSession } from "@/components/LiveSession";
import { Mark } from "@/components/Logo";
import { Nav } from "@/components/Nav";
import { Reveal } from "@/components/Reveal";
import { Terminal, type TermLine } from "@/components/Terminal";
import { Waitlist } from "@/components/Waitlist";

const RECORD: TermLine[] = [
  { kind: "comment", text: "# install ships with early access" },
  { kind: "cmd", text: "postrun capture" },
  { kind: "out", text: "● recording claude-code, cline", tone: "ok", after: 300 },
  { kind: "out", text: "  telemetry  127.0.0.1:4318", tone: "muted" },
  { kind: "out", text: "  store      ~/.postrun  (0600)", tone: "muted", after: 900 },
  { kind: "out", text: "↳ 8f3c2a71  +24 steps · 1 failed", tone: "accent" },
];

const REVIEW: TermLine[] = [
  { kind: "cmd", text: "postrun sessions" },
  { kind: "out", text: "14:02  claude-code  24 steps · 1 failed", tone: "plain" },
  { kind: "out", text: "11:40  cline        61 steps", tone: "plain", after: 600 },
  { kind: "cmd", text: "postrun serve" },
  { kind: "out", text: "listening on http://127.0.0.1:1234/", tone: "ok" },
  { kind: "out", text: "127.0.0.1 only · updates live", tone: "muted" },
];

const SHARE: TermLine[] = [
  { kind: "cmd", text: "postrun export 8f3c2a71" },
  { kind: "out", text: "wrote postrun-claude-code-8f3c2a71.html", tone: "plain", after: 400 },
  { kind: "out", text: "masked 2 values, 19 home paths:", tone: "warn", after: 300 },
  { kind: "out", text: "  aws-access-key  step 4 · stdout", tone: "muted" },
  { kind: "out", text: "  credential      step 4 · stdout", tone: "muted" },
  { kind: "out", text: "no scripts · opens anywhere", tone: "ok" },
];

const FEATURES = [
  { mark: "●", title: "Live as it runs", body: "Watch steps land while the agent works. Close the tab, come back, and the session has caught up." },
  { mark: "◇", title: "Every agent, one schema", body: "Adapters turn each agent's own logs into the same steps, turns and sessions, so you review them the same way." },
  { mark: "±", title: "Edits as diffs", body: "See each edit the agent made, including the ones it later undid, not just the final state of the branch." },
  { mark: "!", title: "Failures up front", body: "Failed commands, error types and exit codes are flagged in the timeline and counted in the summary." },
  { mark: "{}", title: "Bring your own agent", body: "A small authenticated ingest API takes v1.2 events from any adapter, validated before anything is stored." },
  { mark: "~", title: "Redaction you can check", body: "Keys, tokens, passwords and home paths are masked on export, and each one is listed so you can review it." },
];

const SECURITY = [
  { k: "127.0.0.1", v: "The recorder and the review UI bind to loopback only and refuse other Host headers." },
  { k: "chmod 600", v: "Captures and the session store are owner-only on disk." },
  { k: "no telemetry", v: "Postrun never phones home. Nothing syncs in the background." },
  { k: "export only", v: "A session leaves your machine only when you export it, one at a time." },
  { k: "[REDACTED]", v: "Secrets and credentials are masked on export, and you review every mask." },
  { k: "CSP: none", v: "Reports run no scripts and load nothing, so a hostile agent output stays inert." },
];

export default function Home() {
  return (
    <>
      <Nav />
      <main id="top">
        {/* HERO */}
        <section className="hero">
          <div className="hero-grid" aria-hidden="true"></div>
          <div className="hero-scan" aria-hidden="true"></div>
          <div className="wrap hero-copy">
            <Reveal>
              <span className="eyebrow">
                <span className="led-ok"></span>Records Claude Code and Cline today. Cursor and Codex next.
              </span>
            </Reveal>
            <Reveal delay={80}>
              <h1>The flight recorder for coding agents.</h1>
            </Reveal>
            <Reveal delay={160}>
              <p className="lede">
                Postrun records every command, edit and file your agents touch, on your own machine. Review the whole session, then share a redacted report when someone else needs
                to see it.
              </p>
            </Reveal>
            <Reveal delay={240} className="cta-row">
              <a href="#waitlist" className="btn btn-primary btn-lg">
                Get early access
              </a>
              <a href="/example-report.html" target="_blank" rel="noopener" className="btn btn-ghost btn-lg">
                See an example report <span aria-hidden="true">→</span>
              </a>
            </Reveal>
            <Reveal delay={300}>
              <p className="mono muted small">Local by default. Nothing leaves your machine unless you export it.</p>
            </Reveal>
          </div>
          <div className="wrap-wide hero-shot">
            <div className="hero-glow" aria-hidden="true"></div>
            <Reveal delay={200}>
              <LiveSession />
            </Reveal>
            <p className="caption">An example Claude Code session streaming in. The agent printed AWS credentials; Postrun masks them before anything is shared.</p>
          </div>
        </section>

        {/* AGENTS */}
        <section aria-label="Supported agents" className="agents">
          <div className="wrap agents-row mono">
            <span className="lbl">ONE TIMELINE FOR</span>
            <span className="on">Claude Code</span>
            <span className="on">Cline</span>
            <span>
              Cursor <em>soon</em>
            </span>
            <span>
              Codex <em>soon</em>
            </span>
            <span>
              Your adapter <em>via ingest API</em>
            </span>
          </div>
        </section>

        {/* PROBLEM */}
        <section className="section">
          <div className="wrap split">
            <Reveal className="split-a">
              <h2>
                Your agent finished.
                <br />
                <span className="dim">What did it actually do?</span>
              </h2>
            </Reveal>
            <Reveal delay={120} className="split-b">
              <p className="body-lg">
                The chat scrolls away. The diff shows the end state, not the three approaches it tried, the test it broke, or the credentials it printed on the way. Postrun keeps
                the full record: every step, in order, with its output.
              </p>
            </Reveal>
          </div>
        </section>

        {/* HOW */}
        <section id="how" className="section section-tight">
          <div className="wrap">
            <div className="how">
              {[
                { n: "01 · RECORD", h: "Capture on your machine", p: "Hooks and local telemetry feed a recorder bound to 127.0.0.1. Prompts, tool calls, output and edits land in a private store in your home folder.", t: RECORD, title: "capture" },
                { n: "02 · REVIEW", h: "Read the whole session", p: "One timeline across agents: every turn and step, the files it touched, the commands it ran, what failed and why. It updates live while the agent works.", t: REVIEW, title: "review" },
                { n: "03 · SHARE", h: "Send a report, not your logs", p: "Export one session as a single HTML file. Secrets, credentials and home paths are masked first, and you see every masked value before you send it.", t: SHARE, title: "export" },
              ].map((c, i) => (
                <Reveal key={c.n} delay={i * 120} className="how-card">
                  <span className="kicker">{c.n}</span>
                  <h3>{c.h}</h3>
                  <p>{c.p}</p>
                  <Terminal title={c.title} lines={c.t} />
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* FEATURES */}
        <section className="section">
          <div className="wrap">
            <Reveal className="section-head">
              <span className="kicker muted">BUILT FOR REVIEW, NOT DASHBOARDS</span>
              <h2>The session is the unit. Everything else is a filter.</h2>
            </Reveal>
            <div className="features">
              {FEATURES.map((f, i) => (
                <Reveal key={f.title} delay={(i % 3) * 90} className="feature">
                  <span className="f-mark mono">{f.mark}</span>
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* SHARE */}
        <section id="share" className="section band">
          <div className="wrap share">
            <Reveal className="share-copy">
              <span className="kicker muted">SHARE ON PURPOSE</span>
              <h2>Show your reviewer exactly what the agent did.</h2>
              <p className="body-lg">
                Before a merge, when a teammate inherits the branch, or when a client asks what they paid for: export the session as one file that opens in any browser.
              </p>
              <ul className="checks">
                <li>One self-contained HTML file. No account, no server, no install for the reader.</li>
                <li>No JavaScript and no outside requests, so it is safe to open from anyone.</li>
                <li>Every command, edit and message, expandable, with failures and output.</li>
                <li>Hosted share links next, built on the same file.</li>
              </ul>
            </Reveal>
            <Reveal delay={150} className="share-demo">
              <ExportDemo />
            </Reveal>
          </div>
        </section>

        {/* SECURITY */}
        <section id="security" className="section">
          <div className="wrap">
            <div className="split split-end">
              <Reveal className="split-a">
                <span className="kicker muted">LOCAL BY DEFAULT</span>
                <h2>Your sessions hold your secrets. They stay with you.</h2>
              </Reveal>
              <Reveal delay={120} className="split-b">
                <p className="body-lg">
                  Agent sessions contain full prompts, tool output and anything a command printed. Postrun is built so none of it leaves your machine by accident.
                </p>
              </Reveal>
            </div>
            <Reveal className="sec-grid">
              {SECURITY.map((s) => (
                <div key={s.k} className="sec-cell">
                  <code>{s.k}</code>
                  <span>{s.v}</span>
                </div>
              ))}
            </Reveal>
          </div>
        </section>

        {/* CTA */}
        <section id="waitlist" className="section cta">
          <div className="wrap">
            <Reveal className="cta-card">
              <div className="cta-glow" aria-hidden="true"></div>
              <Mark size={56} animated title="postrun" />
              <h2>Know what your agents did.</h2>
              <p className="body-lg">Postrun is in early access. Leave your email and we will send you the install when your agent is supported.</p>
              <Waitlist />
              <span className="mono muted small">Works with Claude Code and Cline. Tell us which agent you use.</span>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap footer-row">
          <span className="footer-brand">
            <Mark size={20} /> postrun
          </span>
          <span className="muted">The flight recorder for coding agents.</span>
          <span className="grow"></span>
          <a href="#how">How it works</a>
          <a href="#security">Security</a>
          <a href="/example-report.html" target="_blank" rel="noopener">
            Example report
          </a>
          <span className="muted">[GITHUB OR CONTACT]</span>
        </div>
      </footer>
    </>
  );
}
