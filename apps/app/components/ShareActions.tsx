"use client";

import { useState, useTransition } from "react";
import { Loader } from "@postrun/brand/logo";
import { removeShare, turnOffShare } from "@/app/(account)/actions";

/** Copy, open, turn off, delete. Turning off and deleting ask once, inline, rather than in a browser dialog. */
export function ShareActions({ id, url, live, title }: { id: string; url: string; live: boolean; title: string }) {
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<"off" | "delete" | null>(null);
  const [pending, start] = useTransition();

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("Copy this link", url);
    }
  }

  if (confirm) {
    const off = confirm === "off";
    return (
      <div className="share-actions confirm" role="group" aria-label={off ? `Turn off ${title}?` : `Delete ${title}?`}>
        <span className="confirm-q">{off ? "Turn off this link?" : "Remove from the list?"}</span>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirm(null)} disabled={pending}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-sm btn-danger"
          disabled={pending}
          onClick={() => start(async () => (off ? turnOffShare(id) : removeShare(id)).then(() => setConfirm(null)))}
        >
          {pending ? <Loader size={15} inline label={off ? "Turning off" : "Removing"} fg="#fff" /> : off ? "Turn off" : "Remove"}
        </button>
      </div>
    );
  }

  return (
    <div className="share-actions">
      {live ? (
        <>
          <button type="button" className={`btn btn-sm btn-ghost copy${copied ? " is-done" : ""}`} onClick={() => void copy()} aria-live="polite">
            <span className="copy-a">Copy link</span>
            <span className="copy-b" aria-hidden={!copied}>
              Copied
            </span>
          </button>
          <button type="button" className="btn btn-sm btn-quiet" onClick={() => setConfirm("off")}>
            Turn off
          </button>
        </>
      ) : (
        <button type="button" className="btn btn-sm btn-quiet" onClick={() => setConfirm("delete")}>
          Remove
        </button>
      )}
    </div>
  );
}
