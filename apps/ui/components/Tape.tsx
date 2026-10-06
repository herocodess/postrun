"use client";

/**
 * The session tape: every step of the session in order, the same strip as in
 * the session list but at full resolution. Hover a bar to see the step, click
 * to jump to it in the timeline. Very long sessions are grouped, a few steps
 * per bar, so the tape always fits.
 */

import { useMemo, useState, type MouseEvent } from "react";
import type { StepPreview } from "@postrun/core/server/api";
import { summarize } from "@/lib/summarize";

const MAX_BARS = 240;

interface Bar {
  first: StepPreview;
  count: number;
  kind: string;
  failed: boolean;
}

function kindOf(s: StepPreview): string {
  return s.type === "command" || s.type === "edit" || s.type === "read" || s.type === "message" ? s.type : "other";
}

export function Tape({ steps, onPick }: { steps: StepPreview[]; onPick: (seq: number) => void }) {
  const bars = useMemo<Bar[]>(() => {
    const per = Math.max(1, Math.ceil(steps.length / MAX_BARS));
    const out: Bar[] = [];
    for (let i = 0; i < steps.length; i += per) {
      const group = steps.slice(i, i + per);
      const counts = new Map<string, number>();
      for (const s of group) counts.set(kindOf(s), (counts.get(kindOf(s)) ?? 0) + 1);
      const kind = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
      out.push({ first: group[0]!, count: group.length, kind, failed: group.some((s) => s.outcome === "failed") });
    }
    return out;
  }, [steps]);
  const [hover, setHover] = useState<number | undefined>(undefined);

  if (bars.length === 0) return null;

  const at = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.min(bars.length - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * bars.length)));
  };
  const h = hover !== undefined ? bars[hover] : undefined;

  return (
    <div className="tape-wrap">
      <div
        className="tape"
        role="img"
        aria-label={`${steps.length} steps in order. Use the timeline below to open each one.`}
        onMouseMove={(e) => setHover(at(e))}
        onMouseLeave={() => setHover(undefined)}
        onClick={(e) => onPick(bars[at(e)]!.first.seq)}
      >
        {bars.map((b, i) => (
          <span key={i} className={`sb sb-${b.kind}${b.failed ? " sb-failed" : ""}${hover === i ? " hot" : ""}`} style={{ ["--i" as string]: i }}></span>
        ))}
        {h && hover !== undefined && (
          <span
            className="tape-tip"
            style={(() => {
              // Keep the tip inside the card near either end.
              const x = (hover + 0.5) / bars.length;
              return { left: `${x * 100}%`, transform: `translateX(${x < 0.15 ? -10 : x > 0.85 ? -90 : -50}%)` };
            })()}
          >
            <b>
              {h.count > 1 ? `Steps ${h.first.seq} to ${h.first.seq + h.count - 1}` : `Step ${h.first.seq}`}
            </b>
            <span>
              {h.first.type}
              {h.failed ? ", failed" : ""}
            </span>
            <span className="tape-tip-text">{summarize(h.first).text}</span>
          </span>
        )}
      </div>
      <div className="tape-scale">
        <span>start</span>
        <span>click a bar to jump to that step</span>
        <span>{steps.length} steps</span>
      </div>
    </div>
  );
}
