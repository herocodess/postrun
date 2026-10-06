"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";

const LINKS = [
  { href: "/shares", label: "Share links" },
  { href: "/settings", label: "Settings" },
];

/** The two sections, with a pill that slides to the current one. */
export function NavLinks() {
  const path = usePathname();
  const active = Math.max(
    0,
    LINKS.findIndex((l) => path.startsWith(l.href)),
  );
  return (
    <nav className="acct-nav" aria-label="Account" style={{ ["--active" as string]: active }}>
      <span className="acct-nav-pill" aria-hidden="true"></span>
      {LINKS.map((l, i) => (
        <a key={l.href} href={l.href} className={i === active ? "on" : ""} aria-current={i === active ? "page" : undefined}>
          {l.label}
        </a>
      ))}
    </nav>
  );
}

export function Avatar({ name, email, image, size = 30 }: { name: string; email: string; image: string | null; size?: number }) {
  const letter = (name || email).trim().charAt(0).toUpperCase() || "?";
  return image ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="avatar" src={image} alt="" width={size} height={size} referrerPolicy="no-referrer" />
  ) : (
    <span className="avatar avatar-letter" style={{ width: size, height: size }} aria-hidden="true">
      {letter}
    </span>
  );
}

export function AccountMenu({ name, email, image, admin = false }: { name: string; email: string; image: string | null; admin?: boolean }) {
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  async function signOut() {
    setLeaving(true);
    await authClient.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="acct-menu" ref={ref}>
      <button type="button" className="acct-menu-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Avatar name={name} email={email} image={image} />
        <span className="acct-menu-name">{name || email}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="chev">
          <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div className="acct-menu-pop" role="menu">
          <div className="acct-menu-who">
            <div className="t-plain">{name || "Signed in"}</div>
            <div className="muted small">{email}</div>
          </div>
          <a role="menuitem" href="/settings">
            Settings
          </a>
          <a role="menuitem" href="/feedback">
            Send feedback
          </a>
          {admin && (
            <a role="menuitem" href="/admin">
              Admin: feedback
            </a>
          )}
          <a role="menuitem" href="https://docs.postrun.app" target="_blank" rel="noreferrer">
            Docs
          </a>
          <button type="button" role="menuitem" onClick={() => void signOut()} disabled={leaving}>
            {leaving ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}
