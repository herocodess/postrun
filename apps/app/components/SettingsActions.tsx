"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { makeToken, signOutComputer } from "@/app/(account)/actions";
import { authClient } from "@/lib/auth-client";

export function RemoveComputer({ id, name }: { id: string; name: string }) {
  const [ask, setAsk] = useState(false);
  const [pending, start] = useTransition();
  if (!ask)
    return (
      <button type="button" className="btn btn-sm btn-quiet" onClick={() => setAsk(true)}>
        Sign out
      </button>
    );
  return (
    <div className="share-actions confirm" role="group" aria-label={`Sign out ${name}?`}>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAsk(false)} disabled={pending}>
        Cancel
      </button>
      <button type="button" className="btn btn-sm btn-danger" disabled={pending} onClick={() => start(() => signOutComputer(id))}>
        {pending ? "…" : "Sign out"}
      </button>
    </div>
  );
}

/**
 * For a computer without a browser (a server over SSH, say): make a token here,
 * then run `postrun login --with-token` there and paste it. The token is shown once.
 */
export function AddComputer() {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string>();
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("name") ?? "");
    start(async () => {
      const r = await makeToken(name);
      setError(r.error);
      setToken(r.token);
    });
  }

  if (token) {
    return (
      <div className="token-once">
        <p className="small">
          On that computer, run <code>postrun login --with-token</code> and paste this token when it asks. It&apos;s shown <strong className="t-plain">only once</strong>; keep it
          out of chats, screenshots and command lines.
        </p>
        <code className="cmd cmd-wrap">{token}</code>
        <div className="token-once-actions">
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() =>
              void navigator.clipboard.writeText(token).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1800);
              })
            }
          >
            {copied ? "Copied" : "Copy token"}
          </button>
          <button type="button" className="btn btn-sm btn-quiet" onClick={() => (setToken(undefined), setOpen(false))}>
            Done
          </button>
        </div>
      </div>
    );
  }

  if (!open)
    return (
      <button type="button" className="link-btn add-comp" onClick={() => setOpen(true)}>
        Connect a computer without a browser
      </button>
    );

  return (
    <form className="add-form" onSubmit={submit}>
      <label htmlFor="comp-name">Name it, so you can tell it apart later</label>
      <div className="add-form-row">
        <input id="comp-name" name="name" maxLength={60} placeholder="Build server" required autoFocus />
        <button type="submit" className="btn btn-sm btn-primary" disabled={pending}>
          {pending ? "Making…" : "Make a token"}
        </button>
        <button type="button" className="btn btn-sm btn-quiet" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {error && (
        <p className="form-err" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export function DeleteAccount({ email }: { email: string }) {
  const [ask, setAsk] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const router = useRouter();

  function remove() {
    start(async () => {
      const r = await authClient.deleteUser({ callbackURL: "/login" });
      if (r.error) {
        setError(r.error.code === "SESSION_EXPIRED" ? "For safety, sign out and sign in again, then delete within a day." : (r.error.message ?? "That didn't work. Try again."));
        return;
      }
      router.replace("/login");
      router.refresh();
    });
  }

  if (!ask)
    return (
      <button type="button" className="btn btn-sm btn-danger-ghost" onClick={() => setAsk(true)}>
        Delete account
      </button>
    );
  return (
    <div className="del-confirm">
      <label htmlFor="del-email" className="small">
        Type <strong className="t-plain">{email}</strong> to confirm
      </label>
      <input id="del-email" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
      <div className="token-once-actions">
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => (setAsk(false), setTyped(""))} disabled={pending}>
          Cancel
        </button>
        <button type="button" className="btn btn-sm btn-danger" disabled={pending || typed.trim().toLowerCase() !== email.toLowerCase()} onClick={remove}>
          {pending ? "Deleting…" : "Delete everything"}
        </button>
      </div>
      {error && (
        <p className="form-err" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
