/**
 * The session strip: a session's steps in order, one bar per slice, coloured
 * by what the agent did (command, edit, read, message, other). A failed step
 * stands taller, in red. Short sessions fill only part of the track, so the
 * length of the bars is also the length of the session.
 */

import type { SessionSummary } from "@postrun/core/store";

export const STRIP_SLOTS = 64;

const KIND: Record<string, string> = { c: "command", e: "edit", r: "read", m: "message", o: "other" };

/** The summary's strip, or a stand-in built from its step counts when the server is older than the strip. */
export function stripOf(s: Pick<SessionSummary, "strip" | "step_counts" | "steps_total">): string {
  if (typeof s.strip === "string") return s.strip;
  const total = Math.max(1, s.steps_total);
  const slots = Math.min(STRIP_SLOTS, s.steps_total);
  let out = "";
  for (const [type, n] of Object.entries(s.step_counts)) {
    const ch = type === "command" ? "c" : type === "edit" ? "e" : type === "read" ? "r" : type === "message" ? "m" : "o";
    out += ch.repeat(Math.round((n / total) * slots));
  }
  return out.slice(0, STRIP_SLOTS);
}

export function Strip({ strip, size = "row", label }: { strip: string; size?: "row" | "card"; label?: string }) {
  const bars = [...strip].slice(0, STRIP_SLOTS);
  const failed = bars.filter((c) => c !== c.toLowerCase()).length;
  const title = label ?? (bars.length === 0 ? "No steps" : `${bars.length < STRIP_SLOTS ? bars.length : "Many"} steps in order${failed ? `, ${failed} with a failure` : ""}`);
  return (
    <span className={`strip strip-${size}`} role="img" aria-label={title} title={title}>
      {bars.map((c, i) => {
        const kind = KIND[c.toLowerCase()] ?? "other";
        return <span key={i} className={`sb sb-${kind}${c !== c.toLowerCase() ? " sb-failed" : ""}`} style={{ ["--i" as string]: i }}></span>;
      })}
    </span>
  );
}

/** What the colours mean, for the list header. */
export function StripLegend() {
  return (
    <span className="strip-legend" aria-label="Strip colours">
      {["command", "edit", "read", "message", "other"].map((k) => (
        <span key={k}>
          <i className={`sb sb-${k}`}></i>
          {k}
        </span>
      ))}
      <span>
        <i className="sb sb-failed"></i>failed
      </span>
    </span>
  );
}
