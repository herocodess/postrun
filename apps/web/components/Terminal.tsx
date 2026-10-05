"use client";

import { useEffect, useState } from "react";
import { runScript, sleep, useInView, useReducedMotion } from "./motion";

export type Tone = "muted" | "ok" | "warn" | "bad" | "accent" | "plain";

export type TermLine =
  | { kind: "cmd"; text: string }
  /** `after`: pause before the next line, ms. */
  | { kind: "out"; text: string; tone?: Tone; after?: number }
  | { kind: "comment"; text: string };

/**
 * A terminal window that plays a script when it scrolls into view: commands
 * are typed with human-ish timing, output prints line by line, then it holds
 * and replays. The final state is rendered underneath, invisible, so the
 * window has its full height from the start and the page never jumps.
 */
export function Terminal({
  title = "zsh",
  lines,
  loop = true,
  hold = 4200,
  className = "",
}: {
  title?: string;
  lines: TermLine[];
  loop?: boolean;
  hold?: number;
  className?: string;
}) {
  const [ref, inView] = useInView<HTMLDivElement>(0.35);
  const reduced = useReducedMotion();
  const [count, setCount] = useState(0); // fully shown lines
  const [partial, setPartial] = useState<string | null>(null); // command being typed

  useEffect(() => {
    if (!inView) return;
    if (reduced) {
      setCount(lines.length);
      setPartial(null);
      return;
    }
    return runScript(async (signal) => {
      do {
        setCount(0);
        setPartial(null);
        await sleep(450, signal);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (line.kind === "cmd") {
            for (let c = 1; c <= line.text.length; c++) {
              setPartial(line.text.slice(0, c));
              const ch = line.text[c - 1];
              await sleep(ch === " " ? 70 : 28 + Math.random() * 46, signal);
            }
            await sleep(380, signal); // the beat before Enter
            setPartial(null);
            setCount(i + 1);
            await sleep(260, signal);
          } else {
            setCount(i + 1);
            await sleep(line.kind === "out" ? (line.after ?? 120) : 160, signal);
          }
        }
        await sleep(hold, signal);
      } while (loop);
    });
  }, [inView, reduced, lines, loop, hold]);

  const typingAt = partial !== null ? count : -1;

  return (
    <div ref={ref} className={`term ${className}`}>
      <div className="term-bar">
        <span className="dots" aria-hidden="true">
          <i></i>
          <i></i>
          <i></i>
        </span>
        <span className="term-title">{title}</span>
      </div>
      <div className="term-body">
        {/* Final state, invisible: reserves height. */}
        <pre className="term-ghost" aria-hidden="true">
          {lines.map((l, i) => (
            <Line key={i} line={l} />
          ))}
          <span className="tl">
            <span className="prompt">$ </span>
          </span>
        </pre>
        {/* Live layer, read as the full transcript by screen readers. */}
        <pre className="term-live" aria-label={lines.map((l) => (l.kind === "cmd" ? `$ ${l.text}` : l.text)).join("\n")}>
          {lines.slice(0, count).map((l, i) => (
            <Line key={i} line={l} />
          ))}
          {typingAt >= 0 && (
            <span className="tl">
              <span className="prompt">$ </span>
              {partial}
              <span className="caret" />
            </span>
          )}
          {typingAt < 0 && (
            <span className="tl">
              <span className="prompt">$ </span>
              <span className="caret blink" />
            </span>
          )}
        </pre>
      </div>
    </div>
  );
}

function Line({ line }: { line: TermLine }) {
  if (line.kind === "cmd") {
    return (
      <span className="tl">
        <span className="prompt">$ </span>
        {line.text}
        {"\n"}
      </span>
    );
  }
  if (line.kind === "comment") return <span className="tl t-muted">{line.text + "\n"}</span>;
  return <span className={`tl t-${line.tone ?? "plain"}`}>{line.text + "\n"}</span>;
}
