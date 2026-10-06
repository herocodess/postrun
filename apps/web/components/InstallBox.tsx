"use client";

import { track } from "@vercel/analytics";
import { useState } from "react";

const CMD = "npm install -g postrun && postrun setup";

/** The two commands that install Postrun, with a copy button. */
export function InstallBox() {
  const [copied, setCopied] = useState(false);
  return (
    <div className="install-box">
      <code>
        <span className="install-prompt" aria-hidden="true">
          $
        </span>
        {CMD}
      </code>
      <button
        type="button"
        className={`btn btn-primary btn-sm${copied ? " is-done" : ""}`}
        onClick={() => {
          void navigator.clipboard?.writeText(CMD).then(
            () => {
              setCopied(true);
              track("Install command copied");
              window.setTimeout(() => setCopied(false), 1800);
            },
            () => undefined,
          );
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
