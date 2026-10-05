"use client";

import { useEffect, useState } from "react";
import { runScript, sleep, useReducedMotion } from "./motion";

const GLYPHS = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&*+=/<>";

/**
 * Shows `from`, then, once `active`, scrambles character by character into
 * `to`, left to right. Used to show a secret being masked.
 */
export function Scramble({ from, to, active, duration = 900, className }: { from: string; to: string; active: boolean; duration?: number; className?: string }) {
  const reduced = useReducedMotion();
  const [text, setText] = useState(from);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!active) {
      setText(from);
      setDone(false);
      return;
    }
    if (reduced) {
      setText(to);
      setDone(true);
      return;
    }
    return runScript(async (signal) => {
      const frames = 22;
      const len = Math.max(from.length, to.length);
      for (let f = 1; f <= frames; f++) {
        const settled = Math.floor((f / frames) * len);
        let out = "";
        for (let i = 0; i < len; i++) {
          if (i < settled) out += to[i] ?? "";
          else if (i < to.length || i < from.length) out += GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        }
        setText(out.slice(0, f === frames ? to.length : len));
        await sleep(duration / frames, signal);
      }
      setText(to);
      setDone(true);
    });
  }, [active, from, to, duration, reduced]);

  return (
    <span className={`${className ?? ""} ${done ? "masked" : active ? "masking" : "secret"}`} aria-label={done ? to : undefined}>
      {text}
    </span>
  );
}
