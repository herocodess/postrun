/**
 * Step previews for the review app. A long session holds megabytes of command
 * output, file contents and messages; the app needs a line or two of each to
 * show the timeline, and loads one step in full when it is opened. Long text
 * fields are cut to PREVIEW_CHARS and the full lengths listed in `truncated`.
 * Commands and paths are kept (up to a much larger limit), because the report
 * and the timeline row are built from them.
 */

import type { Step } from "../schema/index.js";
import type { StepPreview } from "./api.js";

export const PREVIEW_CHARS = 2048;
const COMMAND_CHARS = 8192;

const TEXT_FIELDS = ["stdout", "stderr", "text", "old_string", "new_string"] as const;

export function previewStep(step: Step): StepPreview {
  const payload: Record<string, unknown> = { ...(step.payload as unknown as Record<string, unknown>) };
  const truncated: Record<string, number> = {};
  for (const f of TEXT_FIELDS) {
    const v = payload[f];
    if (typeof v === "string" && v.length > PREVIEW_CHARS) {
      payload[f] = v.slice(0, PREVIEW_CHARS);
      truncated[f] = v.length;
    }
  }
  const cmd = payload["command"];
  if (typeof cmd === "string" && cmd.length > COMMAND_CHARS) {
    payload["command"] = cmd.slice(0, COMMAND_CHARS);
    truncated["command"] = cmd.length;
  }
  // The structured patch duplicates old/new strings; the app never shows it.
  if (payload["structured_patch"] !== undefined) {
    truncated["structured_patch"] = JSON.stringify(payload["structured_patch"]).length;
    delete payload["structured_patch"];
  }
  if (step.type === "other") {
    const raw = JSON.stringify(payload["raw"] ?? {});
    if (raw.length > PREVIEW_CHARS) {
      payload["raw"] = {};
      truncated["raw"] = raw.length;
    }
  }
  const out = { ...step, payload } as StepPreview;
  if (Object.keys(truncated).length > 0) out.truncated = truncated;
  return out;
}
