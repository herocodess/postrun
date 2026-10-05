/**
 * One-line summary per step for the timeline row.
 * Reference-only content (v1.2 content_status) is reported as such, never
 * rendered as a blank cell. The pointer (output_ref / text_ref) is surfaced.
 */

import type { Step } from "@postrun/core/schema";

const SNIPPET = 140;

export interface Summary {
  text: string;
  referenceOnly: boolean;
  ref?: string;
}

export function snippet(s: string, max = SNIPPET): string {
  const firstLine = s.split("\n")[0] ?? "";
  const cut = firstLine.length > max ? firstLine.slice(0, max) + "…" : firstLine;
  return firstLine.length < s.length && cut === firstLine ? cut + " …" : cut;
}

export function summarize(step: Step): Summary {
  const referenceOnly = step.content_status === "reference_only";
  switch (step.type) {
    case "command": {
      const p = step.payload;
      const ref = p.output_ref ? { ref: p.output_ref } : {};
      if (p.command === undefined || p.command === "") {
        return { text: "content not inline (no hook record for this tool call)", referenceOnly: true, ...ref };
      }
      return { text: snippet(p.command) + (referenceOnly ? " (output not inline)" : ""), referenceOnly, ...ref };
    }
    case "edit": {
      const p = step.payload;
      const label = (p.is_full_write ? "write " : "edit ") + (p.path || "(path unknown)");
      const inline = p.old_string !== undefined || p.new_string !== undefined;
      return inline && !referenceOnly ? { text: label, referenceOnly: false } : { text: `${label}: content not inline`, referenceOnly: true };
    }
    case "read": {
      const p = step.payload;
      return { text: (p.path || "(path unknown)") + (p.range ? ` [${p.range[0]}-${p.range[1]}]` : ""), referenceOnly };
    }
    case "message": {
      const p = step.payload;
      const ref = p.text_ref ? { ref: p.text_ref } : {};
      if (p.text === undefined) {
        return { text: `${p.role}: content not inline`, referenceOnly: true, ...ref };
      }
      return { text: `${p.role}: ${snippet(p.text)}`, referenceOnly, ...ref };
    }
    case "other":
      return { text: step.payload.tool_name + (referenceOnly ? " (content not inline)" : ""), referenceOnly };
  }
}
