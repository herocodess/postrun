import type { ReactNode } from "react";

/** Highlighted aside. `note` for context, `tip` for a shortcut, `warn` for something that can bite. */
export function Callout({ type = "note", title, children }: { type?: "note" | "tip" | "warn"; title?: string; children: ReactNode }) {
  const label = title ?? (type === "warn" ? "Careful" : type === "tip" ? "Tip" : "Note");
  return (
    <div className={`callout callout-${type}`} role="note">
      <span className="callout-title">{label}</span>
      <div className="callout-body">{children}</div>
    </div>
  );
}
