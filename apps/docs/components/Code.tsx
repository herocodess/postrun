"use client";

import { useRef, useState, type ReactNode } from "react";

/** Code block with a copy button. Wraps the <pre> MDX renders for fenced code. */
export function Pre({ children, ...rest }: { children?: ReactNode } & React.HTMLAttributes<HTMLPreElement>) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const text = ref.current?.innerText ?? "";
    try {
      await navigator.clipboard.writeText(text.replace(/\n$/, ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard can be blocked (insecure context); selecting the text still works.
    }
  };
  return (
    <div className="code">
      <pre ref={ref} {...rest}>
        {children}
      </pre>
      <button type="button" className="copy" onClick={copy} aria-label="Copy code">
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
