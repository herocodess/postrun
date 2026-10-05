/**
 * Session export: one redacted, self-contained HTML report per session.
 * See docs/decision-2026-10-positioning.md for why sharing works this way.
 */

import type { StoredSession } from "../store/index.js";
import { renderExportHtml } from "./html.js";
import { buildExport, type ExportDocument } from "./model.js";
import type { RedactionReport } from "../redact/redact.js";

export { buildExport, renderExportHtml };
export type { ExportDocument, RedactionReport };
export type { Finding, SecretKind } from "../redact/redact.js";

export interface SessionExport {
  html: string;
  redaction: RedactionReport;
  /** Suggested file name: postrun-<agent>-<date>-<short id>.html */
  filename: string;
}

export function exportSession(session: StoredSession, opts: { now?: Date } = {}): SessionExport {
  const { doc, redaction } = buildExport(session, opts);
  const day = doc.started_at.slice(0, 10);
  const shortId = doc.session_id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 8) || "session";
  return { html: renderExportHtml(doc, redaction), redaction, filename: `postrun-${doc.agent.kind.replace(/[^a-z0-9-]/gi, "")}-${day}-${shortId}.html` };
}
