import type { Metadata } from "next";
import { query } from "@/lib/db";
import { relative, shortDate } from "@/lib/format";
import { requireViewer } from "@/lib/session";
import { listTokens } from "@/lib/shares";
import { Avatar } from "@/components/AccountNav";
import { AddComputer, DeleteAccount, RemoveComputer } from "@/components/SettingsActions";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function Settings() {
  const v = await requireViewer("/settings");
  const [tokens, providers] = await Promise.all([
    listTokens(v.id),
    query<{ providerId: string }>(`SELECT DISTINCT "providerId" FROM account WHERE "userId" = $1`, [v.id]),
  ]);
  const github = providers.some((p) => p.providerId === "github");
  const now = new Date();

  return (
    <div className="page">
      <div className="page-head rise">
        <div>
          <h1>Settings</h1>
          <p className="page-sub">Your account, and the computers that can share as you.</p>
        </div>
      </div>

      <section className="card rise" style={{ ["--d" as string]: 1 }} aria-labelledby="acct-h">
        <h2 id="acct-h">Account</h2>
        <div className="row">
          <Avatar name={v.name} email={v.email} image={v.image ?? null} size={44} />
          <div className="row-text">
            <div className="t-plain">{v.name || v.email}</div>
            {v.name && <div className="muted small">{v.email}</div>}
          </div>
        </div>
        <div className="row">
          <div className="row-text">
            <div className="row-title">How you sign in</div>
            <div className="muted small">
              Email link to {v.email}
              {github ? ", or GitHub" : ". Sign in with GitHub once, using the same email address, to add it."}
            </div>
          </div>
          <div className="pills">
            <span className="pill pill-on">Email link</span>
            <span className={`pill${github ? " pill-on" : ""}`}>GitHub</span>
          </div>
        </div>
      </section>

      <section className="card rise" style={{ ["--d" as string]: 2 }} aria-labelledby="comp-h">
        <h2 id="comp-h">Computers</h2>
        <p className="card-sub">
          Computers where you ran <code>postrun login</code>. Each can upload share links as you, and nothing else: it can&apos;t read your other links or change your account.
        </p>
        {tokens.length === 0 ? (
          <p className="muted small none">
            None yet. Run <code>postrun login</code> on your computer to connect it.
          </p>
        ) : (
          <ul className="computers">
            {tokens.map((t, i) => (
              <li key={t.id} style={{ ["--i" as string]: i }}>
                <span className="comp-icon" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                    <rect x="2.5" y="3.5" width="15" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M7 16.5h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </span>
                <div className="row-text">
                  <div className="t-plain">{t.name}</div>
                  <div className="muted small mono">
                    {t.prefix}… · added {shortDate(t.created_at)} · {t.last_used_at ? `last used ${relative(t.last_used_at, now)}` : "not used yet"}
                  </div>
                </div>
                <RemoveComputer id={t.id} name={t.name} />
              </li>
            ))}
          </ul>
        )}
        <AddComputer />
      </section>

      <section className="card card-danger rise" style={{ ["--d" as string]: 3 }} aria-labelledby="del-h">
        <h2 id="del-h">Delete account</h2>
        <div className="row">
          <div className="row-text">
            <div className="muted small">
              Deletes your account, every share link (the reports go at once) and every computer&apos;s sign-in. Sessions on your machine are not touched: they never left it.
            </div>
          </div>
          <DeleteAccount email={v.email} />
        </div>
      </section>
    </div>
  );
}
