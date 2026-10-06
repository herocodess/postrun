import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Mark, Wordmark } from "@postrun/brand/logo";
import { createCliCode, isChallenge, ShareError, tokenName } from "@/lib/shares";
import { requireViewer } from "@/lib/session";

export const metadata: Metadata = { title: "Connect this computer" };
export const dynamic = "force-dynamic";

/**
 * `postrun login` opens this page. Approving hands a one-time code back to the
 * `postrun login` waiting on 127.0.0.1:<port>, which swaps it for a token at
 * /api/cli/token by proving it started the login (PKCE, as OAuth apps do). The
 * token itself never passes through the browser.
 */

interface Ask {
  port: number;
  state: string;
  challenge: string;
  name: string;
}

function readAsk(q: Record<string, string | string[] | undefined>): Ask | undefined {
  const port = Number(q["port"]);
  const state = typeof q["state"] === "string" ? q["state"] : "";
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return undefined;
  const challenge = typeof q["challenge"] === "string" ? q["challenge"] : "";
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(state) || !isChallenge(challenge)) return undefined;
  return { port, state, challenge, name: tokenName(typeof q["name"] === "string" ? q["name"] : "") };
}

const callback = (a: Pick<Ask, "port" | "state">, extra: Record<string, string>) => `http://127.0.0.1:${a.port}/callback?${new URLSearchParams({ state: a.state, ...extra })}`;

async function approve(form: FormData) {
  "use server";
  const a = readAsk(Object.fromEntries(form) as Record<string, string>);
  if (!a) redirect("/cli");
  const v = await requireViewer("/shares");
  let code: string;
  try {
    code = await createCliCode(v.id, a.name, a.challenge);
  } catch (e) {
    if (e instanceof ShareError) redirect(callback(a, { error: e.code }));
    throw e;
  }
  redirect(callback(a, { code }));
}

async function deny(form: FormData) {
  "use server";
  const a = readAsk(Object.fromEntries(form) as Record<string, string>);
  if (!a) redirect("/cli");
  redirect(callback(a, { error: "denied" }));
}

export default async function Cli({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const ask = readAsk(q);
  const here = ask ? `/cli?${new URLSearchParams({ port: String(ask.port), state: ask.state, challenge: ask.challenge, name: ask.name })}` : "/cli";
  const v = await requireViewer(here);

  return (
    <div className="auth">
      <header className="auth-top">
        <a href="/shares" className="brand" aria-label="Postrun">
          <Wordmark />
        </a>
      </header>
      <main className="auth-main">
        {!ask ? (
          <section className="auth-card">
            <Mark size={36} />
            <h1>Nothing to connect</h1>
            <p className="auth-sub">
              This page opens when you run <code>postrun login</code> in a terminal. Run it there to connect a computer.
            </p>
            <a className="btn btn-ghost" href="/shares">
              Go to your share links
            </a>
          </section>
        ) : (
          <section className="auth-card cli-card" aria-labelledby="cli-h">
            <div className="cli-link" aria-hidden="true">
              <span className="cli-node">
                <svg width="22" height="22" viewBox="0 0 20 20" fill="none">
                  <rect x="2.5" y="3.5" width="15" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M7 16.5h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </span>
              <span className="cli-wire">
                <span></span>
              </span>
              <span className="cli-node cli-node-p">
                <Mark size={24} />
              </span>
            </div>
            <h1 id="cli-h">Connect {ask.name}?</h1>
            <p className="auth-sub">
              <code>postrun</code> on this computer will be able to upload share links as <strong className="t-plain">{v.email}</strong>. It can&apos;t see your other links or change your account, and you can sign it out in Settings at any time.
            </p>
            <form action={approve}>
              <input type="hidden" name="port" value={ask.port} />
              <input type="hidden" name="state" value={ask.state} />
              <input type="hidden" name="challenge" value={ask.challenge} />
              <input type="hidden" name="name" value={ask.name} />
              <button type="submit" className="btn btn-primary cli-approve">
                Connect
              </button>
            </form>
            <form action={deny}>
              <input type="hidden" name="port" value={ask.port} />
              <input type="hidden" name="state" value={ask.state} />
              <input type="hidden" name="challenge" value={ask.challenge} />
              <input type="hidden" name="name" value={ask.name} />
              <button type="submit" className="link-btn cli-deny">
                Cancel
              </button>
            </form>
            <p className="auth-hint cli-warn">Only connect if you just ran postrun login yourself.</p>
          </section>
        )}
      </main>
    </div>
  );
}
