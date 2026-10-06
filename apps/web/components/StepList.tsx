import type { ReactNode } from "react";
import { Reveal } from "./Reveal";

/** Numbered steps drawn as a session timeline. Used by the use-case pages. */
export function StepList({ steps }: { steps: Array<{ title: string; body: ReactNode }> }) {
  return (
    <ol className="step-list">
      {steps.map((s, i) => (
        <li key={s.title}>
          <Reveal delay={60}>
            <span className="step-n">STEP {String(i + 1).padStart(2, "0")}</span>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
          </Reveal>
        </li>
      ))}
    </ol>
  );
}
