"use client";

import { useEffect, useState } from "react";
import { runScript, sleep, useInView, useReducedMotion } from "./motion";
import { Scramble } from "./Scramble";

type StepType = "message" | "read" | "command" | "edit";
interface DemoStep {
  seq: number;
  type: StepType;
  text: string;
  /** Seconds into the session, for the clock. */
  t: number;
  path?: string;
  failed?: boolean;
  secret?: boolean;
  out?: string;
}

/** The example session from the docs: Claude Code adding retry with backoff to an S3 uploader. */
const STEPS: DemoStep[] = [
  { seq: 0, type: "message", t: 0, text: "user: Uploads to S3 fail intermittently in prod with 503 SlowDown. Add retry with backoff…" },
  { seq: 1, type: "read", t: 4, path: "uploader.ts", text: "~/code/acme-api/src/storage/uploader.ts" },
  { seq: 3, type: "command", t: 9, text: 'grep -rn "putObject" src' },
  { seq: 4, type: "command", t: 13, text: "env | grep -i aws", secret: true, out: "2 masked" },
  { seq: 6, type: "edit", t: 25, path: "retry.ts", text: "write ~/code/acme-api/src/storage/retry.ts" },
  { seq: 7, type: "edit", t: 31, path: "uploader.ts", text: "edit ~/code/acme-api/src/storage/uploader.ts" },
  { seq: 10, type: "command", t: 52, text: "pnpm vitest run src/storage", failed: true, out: "failed · exit 1" },
  { seq: 11, type: "message", t: 60, text: "assistant: The retry test times out because the backoff really sleeps. Using fake timers." },
  { seq: 12, type: "edit", t: 66, path: "uploader.test.ts", text: "edit ~/code/acme-api/src/storage/uploader.test.ts" },
  { seq: 14, type: "command", t: 88, text: "pnpm vitest run src/storage", out: "ok · 9 passed" },
];
const END_T = 172;

const KEY_ID = "AKIAZ7Q4" + "EXAMPLEKEYXY";
const KEY_SECRET = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";

export function LiveSession() {
  const [ref, inView] = useInView<HTMLDivElement>(0.3);
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(0);
  const [masking, setMasking] = useState(false);
  const [ended, setEnded] = useState(false);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (!inView) return;
    if (reduced) {
      setShown(STEPS.length);
      setMasking(true);
      setEnded(true);
      return;
    }
    return runScript(async (signal) => {
      for (;;) {
        setShown(0);
        setMasking(false);
        setEnded(false);
        setFading(false);
        await sleep(700, signal);
        for (let i = 0; i < STEPS.length; i++) {
          setShown(i + 1);
          if (STEPS[i]!.secret) {
            await sleep(1300, signal); // let the raw keys register
            setMasking(true);
            await sleep(1400, signal);
          } else {
            await sleep(STEPS[i]!.failed ? 1300 : 700 + Math.random() * 450, signal);
          }
        }
        await sleep(500, signal);
        setEnded(true);
        await sleep(6000, signal);
        setFading(true);
        await sleep(450, signal);
      }
    });
  }, [inView, reduced]);

  const visible = STEPS.slice(0, shown);
  const last = visible[visible.length - 1];
  const files = new Set(visible.filter((s) => s.path).map((s) => s.path)).size;
  const commands = visible.filter((s) => s.type === "command").length;
  const failed = visible.filter((s) => s.failed).length;
  const clock = ended ? fmtDuration(END_T) : fmtClock(last?.t ?? 0);
  const secretIndex = STEPS.findIndex((s) => s.secret);

  return (
    <div ref={ref} className="app-window" data-fading={fading || undefined}>
      <div className="app-bar">
        <span className="dots" aria-hidden="true">
          <i></i>
          <i></i>
          <i></i>
        </span>
        <span className="mono muted small">127.0.0.1:1234/session</span>
        <span className="grow"></span>
        <span className={`pill-live ${ended ? "is-ended" : "is-live"}`} role="status">
          <span className="led"></span>
          {ended ? "session ended" : "live"}
        </span>
      </div>

      <div className="app-head">
        <div className="app-title">
          <span className="badge-cc">claude-code</span>
          <span className="app-prompt">Add retry with exponential backoff to the S3 uploader, cap it at 5 attempts</span>
          <span className="btn-mini">Export report</span>
        </div>
        <div className="stats">
          <Stat k="steps" v={last ? String(last.seq + 1) : "0"} />
          <Stat k="files touched" v={String(files)} />
          <Stat k="commands" v={String(commands)} />
          <Stat k="failed" v={String(failed)} bad={failed > 0} />
          <Stat k={ended ? "duration" : "elapsed"} v={clock} />
        </div>
      </div>

      <div className="tl-wrap">
        <div className="turn-head">
          <span className="turn-chip">turn 0</span>
          <span className="turn-label">Uploads to S3 fail intermittently in prod with 503 SlowDown…</span>
          <span className="turn-meta">
            {visible.length} steps{failed > 0 && <span className="bad"> · {failed} failed</span>}
          </span>
        </div>
        <div className="stack">
          {/* Final state, invisible: keeps the window at full height while steps stream in. */}
          <div className="stack-ghost" aria-hidden="true">
            {STEPS.map((s, i) => (
              <Row key={s.seq} s={s} expanded={i === secretIndex} masking />
            ))}
          </div>
          <div className="stack-live">
            {visible.map((s, i) => (
              <Row key={s.seq} s={s} enter expanded={i === secretIndex} masking={masking} />
            ))}
          </div>
        </div>
      </div>
      <p className="sr-only">
        An example Claude Code session streaming into postrun, step by step: a failed test that the agent then fixed, and AWS credentials the agent printed, masked as
        [REDACTED].
      </p>
    </div>
  );
}

function Stat({ k, v, bad }: { k: string; v: string; bad?: boolean }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className={`v${bad ? " bad" : ""}`}>{v}</div>
    </div>
  );
}

function Row({ s, enter, expanded, masking }: { s: DemoStep; enter?: boolean; expanded?: boolean; masking: boolean }) {
  const tone = s.failed ? "bad" : s.secret ? (masking ? "warn" : "plain") : "ok";
  const out = s.secret ? (masking ? "● 2 masked · ok" : "ok") : (s.out ?? "ok");
  return (
    <>
      <div className={`step-row${s.failed ? " is-failed" : ""}${enter ? " enter" : ""}`}>
        <span className="seq">{s.seq}</span>
        <span className={`chip chip-${s.type}`}>{s.type}</span>
        <span className="step-text">{s.text}</span>
        <span className={`step-out t-${tone}`}>{out}</span>
      </div>
      {expanded && (
        <div className={`step-detail${enter ? " enter" : ""}`}>
          <div className="detail-label">STDOUT · STEP {s.seq}</div>
          <pre className="detail-pre">
            AWS_REGION=eu-west-2{"\n"}AWS_ACCESS_KEY_ID=
            <Scramble className="sec" from={KEY_ID} to="[REDACTED:aws-access-key]" active={masking} />
            {"\n"}AWS_SECRET_ACCESS_KEY=
            <Scramble className="sec" from={KEY_SECRET} to="[REDACTED:credential]" active={masking} duration={1100} />
          </pre>
          <div className={`detail-note${masking ? " on" : ""}`}>
            <span className="dot-warn"></span>
            <span>
              <span className="t-warn">secret in output</span> · 2 values masked before anything is shared
            </span>
          </div>
        </div>
      )}
    </>
  );
}

function fmtClock(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}
function fmtDuration(sec: number): string {
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}
