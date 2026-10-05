"use client";

import { useEffect, useState } from "react";
import { runScript, sleep, useInView, useReducedMotion } from "./motion";
import { Scramble } from "./Scramble";

const FINDINGS = [
  { kind: "AWS key", where: "step 4 · command · stdout", name: "AWS_ACCESS_KEY_ID=", raw: "AKIAZ7Q4" + "EXAMPLEKEYXY", masked: "[REDACTED:aws-access-key]" },
  { kind: "credential", where: "step 4 · command · stdout", name: "AWS_SECRET_ACCESS_KEY=", raw: "wJalrXUtnFEMI/K7MDENG/bPx", masked: "[REDACTED:credential]" },
];

type Phase = "idle" | "scanning" | "found" | "writing" | "ready";

/** The export panel, played once on scroll: scan, list findings, mask them, write the file, offer the download. */
export function ExportDemo() {
  const [ref, inView] = useInView<HTMLDivElement>(0.4);
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<Phase>("idle");
  const [found, setFound] = useState(0);
  const [masked, setMasked] = useState(0);
  const [progress, setProgress] = useState(0);
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (!inView) return;
    if (reduced) {
      setPhase("ready");
      setFound(FINDINGS.length);
      setMasked(FINDINGS.length);
      setProgress(100);
      return;
    }
    return runScript(async (signal) => {
      setPhase("scanning");
      setFound(0);
      setMasked(0);
      setProgress(0);
      await sleep(1100, signal);
      setPhase("found");
      for (let i = 0; i < FINDINGS.length; i++) {
        setFound(i + 1);
        await sleep(700, signal);
        setMasked(i + 1);
        await sleep(1000, signal);
      }
      setPhase("writing");
      for (let p = 0; p <= 100; p += 4) {
        setProgress(p);
        await sleep(28, signal);
      }
      setPhase("ready");
    });
  }, [inView, reduced, run]);

  const summary =
    phase === "idle" || phase === "scanning"
      ? "Checking 24 steps for secrets, credentials and private paths…"
      : `${FINDINGS.length} values will be masked. Check each one below. 19 home paths will show as ~.`;

  return (
    <div ref={ref} className="export-card">
      <div className="export-head">
        <span className="export-title">Export report</span>
        <span className="muted small">one HTML file, no scripts, opens anywhere</span>
      </div>
      <p className={`export-summary${phase === "scanning" ? " scanning" : ""}`} aria-live="polite">
        {summary}
      </p>
      <div className="findings">
        {FINDINGS.map((f, i) => (
          <div key={f.kind} className={`finding${i < found ? " on" : ""}`}>
            <span className="t-warn f-kind">{f.kind}</span>
            <span className="muted f-where">{f.where}</span>
            <code className="f-ctx">
              {f.name}
              <Scramble className="sec" from={f.raw} to={f.masked} active={i < masked} duration={800} />
            </code>
          </div>
        ))}
      </div>
      <div className="export-actions">
        {phase === "ready" ? (
          <a className="btn btn-primary" href="/example-report.html" target="_blank" rel="noopener">
            Download report (32 KB)
          </a>
        ) : (
          <span className="btn btn-primary is-busy" aria-disabled="true">
            <span className="bar" style={{ width: `${progress}%` }}></span>
            <span className="bar-label">{phase === "writing" ? "Writing report…" : "Preparing…"}</span>
          </span>
        )}
        {phase === "ready" && !reduced ? (
          <button type="button" className="link-btn" onClick={() => setRun((r) => r + 1)}>
            Replay
          </button>
        ) : (
          <span className="muted small">Redaction is automatic, not a guarantee. Skim before you send.</span>
        )}
      </div>
    </div>
  );
}
