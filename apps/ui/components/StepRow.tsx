"use client";

/**
 * One timeline step: the one-line summary, expandable to everything the step
 * recorded (command and output, the edit as a diff, message text, tool input
 * and output, errors and flags). Mirrors the exported report's step body, so
 * the review app shows at least as much as the file you share.
 *
 * Native <details>, so it works with the keyboard and screen readers. The body
 * renders only while open, which keeps long sessions fast, and very long
 * output is cut to the first OUTPUT_LIMIT characters until asked for.
 * A step can be linked to as #step-<seq>; that step opens and scrolls into view.
 *
 * The session view receives previews (long fields cut to 2 KB). When a cut
 * step is opened, the full step is fetched once and shown in its place.
 */

import { memo, useEffect, useRef, useState } from "react";
import type { Step } from "@postrun/core/schema";
import type { StepPreview, StepResponse } from "@postrun/core/server/api";
import { api } from "@/lib/api";
import { summarize } from "@/lib/summarize";

const OUTPUT_LIMIT = 100_000;

/** Memoized: a step whose object is unchanged after a live update is not re-rendered. */
export const StepRow = memo(function StepRow({ step, sessionId, fresh = false }: { step: StepPreview; sessionId: string; fresh?: boolean }) {
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState<{ step: Step } | { error: string } | undefined>(undefined);
  const cut = step.truncated !== undefined;

  // Fetch the full step the first time a cut step is opened. A live update that changes the step resets this.
  useEffect(() => setFull(undefined), [step]);
  useEffect(() => {
    if (!open || !cut || full) return;
    let cancelled = false;
    fetch(api.step(sessionId, step.id))
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return ((await res.json()) as StepResponse).step;
      })
      .then((s) => !cancelled && setFull({ step: s }))
      .catch((err: unknown) => !cancelled && setFull({ error: err instanceof Error ? err.message : String(err) }));
    return () => {
      cancelled = true;
    };
  }, [open, cut, full, sessionId, step.id]);
  const ref = useRef<HTMLDetailsElement>(null);
  const sum = summarize(step);
  const anchor = `step-${step.seq}`;

  useEffect(() => {
    if (window.location.hash === `#${anchor}` && ref.current) {
      ref.current.open = true;
      ref.current.scrollIntoView({ block: "center" });
    }
  }, [anchor]);

  let typeClass = "message";
  if (step.type === "command") typeClass = "command";
  else if (step.type === "edit") typeClass = "edit";
  else if (step.type === "read") typeClass = "read";

  let statusClass = "";
  let statusText = "ok";
  if (step.outcome === "failed") {
    statusClass = "fail";
    statusText = "failed";
    if (step.error) statusText += ` · ${step.error.type}`;
  } else if (sum.referenceOnly) {
    statusClass = "refonly";
    statusText = "reference-only";
  }

  return (
    <details ref={ref} id={anchor} className={`step-d${step.outcome === "failed" ? " failed" : ""}${fresh ? " arrived" : ""}`} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="step">
        <span className="st-caret" aria-hidden="true"></span>
        <span className="st-seq">{step.seq}</span>
        <span className={`st-type ${typeClass}`}>{step.type}</span>
        <span className="st-body">{sum.text}</span>
        {step.flags.length > 0 && <span className="st-flag" title={step.flags.map((f) => f.kind).join(", ")}></span>}
        <span className={`st-status ${statusClass}`}>{statusText}</span>
      </summary>
      {open && (
        <>
          <StepBody step={full && "step" in full ? full.step : step} />
          {cut && !full ? <p className="sb-loading">Loading the full output…</p> : null}
          {full && "error" in full ? <p className="sb-loading">Could not load the full step ({full.error}); showing the first 2 KB.</p> : null}
        </>
      )}
    </details>
  );
});

function StepBody({ step }: { step: Step }) {
  const when = new Date(step.at);
  const meta = [
    Number.isNaN(when.getTime()) ? step.at : when.toLocaleString(),
    // "unknown" means the permission decision was not recorded (no OTel data); say nothing rather than "unknown".
    step.decision !== "n/a" && step.decision !== "unknown" ? step.decision : "",
    step.channels.length ? `via ${step.channels.join(", ")}` : "",
  ].filter(Boolean);
  return (
    <div className="step-body">
      <div className="sb-meta mono">{meta.join(" · ")}</div>
      <Content step={step} />
      {step.error && (
        <div className="sb-error">
          <b>{step.error.type}</b> <span>{step.error.message}</span>
        </div>
      )}
      {step.flags.length > 0 && (
        <ul className="sb-flags">
          {step.flags.map((f, i) => (
            <li key={i} className={`sev-${f.severity}`}>
              <b>{f.kind.replace(/_/g, " ")}</b> {f.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Content({ step }: { step: Step }) {
  switch (step.type) {
    case "command": {
      const p = step.payload;
      return (
        <>
          {p.command ? (
            <pre className="sb-code sb-cmd">
              <span className="sb-prompt">$ </span>
              {p.command}
            </pre>
          ) : null}
          {(p.cwd || p.exit_code !== undefined) && (
            <div className="sb-kv">
              {p.cwd && (
                <span>
                  cwd <span className="mono">{p.cwd}</span>
                </span>
              )}
              {p.exit_code !== undefined && (
                <span>
                  exit <span className={`mono${p.exit_code !== 0 ? " bad" : ""}`}>{p.exit_code}</span>
                </span>
              )}
            </div>
          )}
          {p.stdout ? <Output label="stdout" text={p.stdout} /> : null}
          {p.stderr ? <Output label="stderr" text={p.stderr} kind="stderr" /> : null}
          {!p.command && !p.stdout && !p.stderr ? <NotInline what="This command" source={p.output_ref} /> : null}
          {p.command && !p.stdout && !p.stderr && p.output_ref ? <NotInline what="The output" source={p.output_ref} /> : null}
          {p.command && !p.stdout && !p.stderr && !p.output_ref && step.content_status === "inline" ? <p className="sb-empty">No output.</p> : null}
        </>
      );
    }
    case "edit": {
      const p = step.payload;
      return (
        <>
          <div className="sb-kv">
            <span>
              {p.is_full_write ? "wrote" : "edited"} <span className="mono">{p.path}</span>
            </span>
          </div>
          {p.old_string === undefined && p.new_string === undefined ? <NotInline what="The change" /> : <Diff oldText={p.old_string ?? ""} newText={p.new_string ?? ""} />}
        </>
      );
    }
    case "read": {
      const p = step.payload;
      return (
        <div className="sb-kv">
          <span>
            read <span className="mono">{p.path}</span>
            {p.range ? (
              <>
                {" "}
                lines{" "}
                <span className="mono">
                  {p.range[0]} to {p.range[1]}
                </span>
              </>
            ) : null}
          </span>
        </div>
      );
    }
    case "message": {
      const p = step.payload;
      if (p.text === undefined) return <NotInline what="This message" source={p.text_ref} />;
      return <Output label={p.role} text={p.text} kind="message" />;
    }
    case "other": {
      const p = step.payload;
      const raw = Object.keys(p.raw).length ? JSON.stringify(p.raw, null, 2) : "";
      return (
        <>
          <div className="sb-kv">
            <span>
              tool <span className="mono">{p.tool_name}</span>
            </span>
          </div>
          {raw ? <Output label="recorded data" text={raw} /> : null}
        </>
      );
    }
  }
}

/** Long text in a scrolling block, cut to OUTPUT_LIMIT characters until the reader asks for all of it. */
function Output({ label, text, kind }: { label: string; text: string; kind?: "stderr" | "message" }) {
  const [all, setAll] = useState(false);
  const cut = !all && text.length > OUTPUT_LIMIT;
  const shown = cut ? text.slice(0, OUTPUT_LIMIT) : text;
  return (
    <>
      <div className="sb-label">{label}</div>
      {/* tabIndex: long output scrolls inside its box, so keyboard users need to be able to focus it. */}
      {kind === "message" ? (
        <div className="sb-msg" tabIndex={0}>
          {shown}
        </div>
      ) : (
        <pre className={`sb-code sb-scroll${kind === "stderr" ? " sb-stderr" : ""}`} tabIndex={0}>
          {shown}
        </pre>
      )}
      {cut && (
        <button type="button" className="sb-more" onClick={() => setAll(true)}>
          Show all {Math.round(text.length / 1024)} KB
        </button>
      )}
    </>
  );
}

function Diff({ oldText, newText }: { oldText: string; newText: string }) {
  const del = oldText ? oldText.split("\n") : [];
  const add = newText ? newText.split("\n") : [];
  return (
    <pre className="sb-code sb-scroll sb-diff" tabIndex={0} aria-label={`${del.length} lines removed, ${add.length} lines added`}>
      {del.map((l, i) => (
        <span key={`d${i}`} className="del">
          - {l}
          {"\n"}
        </span>
      ))}
      {add.map((l, i) => (
        <span key={`a${i}`} className="add">
          + {l}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}

function NotInline({ what, source }: { what: string; source?: string | undefined }) {
  return (
    <p className="sb-empty">
      {what} was not captured inline.
      {source ? (
        <>
          {" "}
          Source: <span className="mono">{source}</span>
        </>
      ) : null}
    </p>
  );
}
