"use client";

/**
 * Delete one session, after an inline confirmation (no browser dialog). Says
 * exactly what goes (the session in Postrun's store and its raw capture files,
 * overwritten on disk) and what does not (the agent's own copy, which is the
 * agent's to delete). Not offered in the static demo.
 */

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ApiError, DeleteSessionResponse } from "@postrun/core/server/api";
import { api } from "@/lib/api";

type State = { kind: "confirm" } | { kind: "deleting" } | { kind: "error"; message: string };

export function DeletePanel({ sessionId, agent, steps, onClose }: { sessionId: string; agent: string; steps: number; onClose: () => void }) {
  const [state, setState] = useState<State>({ kind: "confirm" });
  const router = useRouter();
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus the safe choice first.
  useEffect(() => cancelRef.current?.focus(), []);

  const remove = async () => {
    setState({ kind: "deleting" });
    try {
      const res = await fetch(api.deleteSession(sessionId), { method: "DELETE" });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as Partial<ApiError>).error ?? `${res.status}`);
      (await res.json()) as DeleteSessionResponse;
      router.push("/");
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };

  const ownCopy =
    agent === "cline"
      ? "Cline keeps its own copy in ~/.cline/data/sessions. Delete the task in Cline too if you want it gone there."
      : "Claude Code keeps its own transcript under ~/.claude/projects. Delete it there too if you want it gone everywhere.";

  return (
    <section className="export-panel delete-panel" role="alertdialog" aria-labelledby="del-title" aria-describedby="del-desc">
      <div className="export-head">
        <h2 id="del-title">Delete this session?</h2>
        <span className="spacer"></span>
      </div>
      <p id="del-desc" className="export-summary warn">
        This removes all {steps} steps from Postrun on this computer, including its raw capture files, and overwrites them on disk. Postrun will not record it again. This
        cannot be undone.
      </p>
      <p className="muted">{ownCopy}</p>
      {state.kind === "error" && <p className="error">Could not delete the session: {state.message}</p>}
      <div className="export-actions">
        <button type="button" className="btn danger" onClick={remove} disabled={state.kind === "deleting"}>
          {state.kind === "deleting" ? "Deleting…" : "Delete session"}
        </button>
        <button type="button" className="btn ghost" ref={cancelRef} onClick={onClose} disabled={state.kind === "deleting"}>
          Cancel
        </button>
      </div>
    </section>
  );
}
