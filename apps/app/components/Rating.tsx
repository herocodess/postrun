"use client";

/** Five steps, like the logo's: pick how useful Postrun is. Keyboard: arrow keys move, the group is one tab stop. */

import { useRef, type KeyboardEvent } from "react";
import { RATING_LABELS } from "@/lib/rating";

export function Rating({ value, onChange, disabled }: { value: number | undefined; onChange: (n: number) => void; disabled?: boolean }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const key = (e: KeyboardEvent, i: number) => {
    const next = e.key === "ArrowRight" || e.key === "ArrowUp" ? i + 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? i - 1 : -1;
    if (next < 0 || next > 4) return;
    e.preventDefault();
    onChange(next + 1);
    refs.current[next]?.focus();
  };
  return (
    <div className="rating" role="radiogroup" aria-label="How useful is Postrun?">
      <div className="rating-steps">
        {RATING_LABELS.map((label, i) => {
          const n = i + 1;
          const on = value !== undefined && n <= value;
          return (
            <button
              key={label}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={value === n}
              aria-label={`${n}: ${label}`}
              tabIndex={value === n || (value === undefined && i === 0) ? 0 : -1}
              className={`rating-step${on ? " on" : ""}${value === n ? " picked" : ""}`}
              style={{ ["--i" as string]: i }}
              onClick={() => onChange(n)}
              onKeyDown={(e) => key(e, i)}
              disabled={disabled}
            >
              <span>{n}</span>
            </button>
          );
        })}
      </div>
      <div className="rating-label" aria-live="polite">
        {value ? RATING_LABELS[value - 1] : "Pick a number"}
      </div>
    </div>
  );
}
