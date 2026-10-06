"use client";

/**
 * Settings for this computer: recording, agents, notifications and updates,
 * appearance, storage, and the checks `postrun doctor` runs. Changes go to the
 * background process (PUT /api/settings and friends) and apply at once.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AppSettings, AppStatus, DoctorCheck, DoctorResponse, SetupResponse } from "@postrun/core/server/api";
import { api, apiFetch, DEMO } from "@/lib/api";
import { ago, megabytes, useStatus } from "@/lib/status";
import { applyTheme, readTheme, type Theme } from "@/lib/theme";
import { useSidebar } from "@/lib/sidebar";
import { UsageCard } from "@/components/UsageCard";

async function send<T>(url: string, method: "PUT" | "POST", body: unknown): Promise<T> {
  const res = await apiFetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `${res.status}`);
  return data;
}

function Switch({ on, label, onChange, disabled }: { on: boolean; label: string; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch${on ? " on" : ""}`} onClick={() => onChange(!on)} disabled={disabled}>
      <span></span>
    </button>
  );
}

function Row({ title, note, children, tone }: { title: ReactNode; note?: ReactNode; children?: ReactNode; tone?: "danger" }) {
  return (
    <div className="set-row">
      <div className="set-text">
        <div className={`set-title${tone === "danger" ? " danger" : ""}`}>{title}</div>
        {note ? <div className="set-note">{note}</div> : null}
      </div>
      {children ? <div className="set-control">{children}</div> : null}
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="set-card" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>{title}</h2>
      {children}
    </section>
  );
}

export function Settings() {
  const { state, set, refresh } = useStatus();
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | undefined>(undefined);
  const [checks, setChecks] = useState<DoctorCheck[] | undefined>(undefined);
  const [theme, setTheme] = useState<Theme>("system");
  const [sidebar, setSidebar] = useSidebar();
  const [confirming, setConfirming] = useState(false);
  const deleteButton = useRef<HTMLButtonElement>(null);
  // Closing the confirmation (Cancel, Escape, or done) puts focus back on the button that opened it.
  const closeConfirm = () => {
    setConfirming(false);
    setTyped("");
    requestAnimationFrame(() => deleteButton.current?.focus());
  };
  const [typed, setTyped] = useState("");

  useEffect(() => setTheme(readTheme()), []);

  const status: AppStatus | undefined = state.kind === "ready" ? state.status : undefined;
  const live = !DEMO && state.kind === "ready";
  const run = async (what: string, fn: () => Promise<string | void>) => {
    setBusy(what);
    setMessage(undefined);
    try {
      const text = await fn();
      if (text) setMessage({ tone: "ok", text });
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(undefined);
    }
  };
  const change = (patch: Partial<AppSettings>, done?: string) =>
    run("settings", async () => {
      set(await send<AppStatus>(api.settings(), "PUT", patch));
      return done;
    });

  const pickTheme = (t: Theme) => {
    setTheme(t);
    applyTheme(t);
  };

  return (
    <>
      <header className="page-head enter">
        <div>
          <h1>Settings</h1>
          <p className="page-sub">Everything here applies to this computer only.</p>
        </div>
      </header>

      {DEMO ? (
        <p className="notice">This is the demo, so settings are shown but not saved.</p>
      ) : state.kind === "unavailable" ? (
        <p className="notice">This review app is running without the background process, so settings cannot change here. Start Postrun with postrun start to use them.</p>
      ) : state.kind === "offline" ? (
        <p className="notice danger">Postrun is not running. Start it with postrun start in a terminal.</p>
      ) : null}
      {message ? (
        <p className={`notice ${message.tone === "error" ? "danger" : "ok"}`} role="status">
          {message.text}
        </p>
      ) : null}

      <div className="set-layout">
        <nav className="set-nav" aria-label="Settings sections">
          {[
            ["recording", "Recording"],
            ["agents", "Agents"],
            ["alerts", "Notifications"],
            ["appearance", "Appearance"],
            ["storage", "Storage"],
            ["usage", "Your usage"],
            ["account", "Account"],
            ["about", "About"],
          ].map(([id, label]) => (
            <a key={id} href={`#${id}`}>
              {label}
            </a>
          ))}
        </nav>

        <div className="set-cards">
          <Section id="recording" title="Recording">
            <Row
              title={status?.recording.paused ? "Recording is paused" : "Recording"}
              note={
                status?.recording.paused
                  ? "Claude Code sessions are not recorded while paused. Cline keeps its own history, which Postrun reads when you resume. Restarting Postrun also resumes."
                  : status
                    ? `Since ${new Date(status.recording.since).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}. ${status.recording.last_activity ? `Last activity ${ago(status.recording.last_activity)}` : "Nothing recorded yet"}.`
                    : "Postrun records in the background."
              }
            >
              <button
                type="button"
                className="btn"
                disabled={!live || busy !== undefined}
                onClick={() =>
                  run("pause", async () => {
                    set(await send<AppStatus>(api.recording(), "POST", { paused: !status?.recording.paused }));
                  })
                }
              >
                {status?.recording.paused ? "Resume recording" : "Pause recording"}
              </button>
            </Row>
            <Row
              title="Start when I log in"
              note={status && !status.autostart.supported ? `Not available here: ${status.autostart.reason ?? "unsupported system"}.` : "Postrun starts in the background after a restart, so no session is missed."}
            >
              <Switch
                label="Start when I log in"
                on={status?.settings.autostart ?? false}
                disabled={!live || !status?.autostart.supported || busy !== undefined}
                onChange={(v) => void change({ autostart: v })}
              />
            </Row>
          </Section>

          <Section id="agents" title="Agents">
            <Row
              title={
                <>
                  <span className="agent-dot cc" aria-hidden="true"></span> Claude Code{" "}
                  <span className={`state ${status?.agents.claude_code.configured ? "ok" : "warn"}`}>
                    {!status ? "" : !status.agents.claude_code.found ? "Not found" : status.agents.claude_code.configured ? "Set up" : "Needs setup"}
                  </span>
                </>
              }
              note={
                status?.agents.claude_code.found
                  ? status.agents.claude_code.mode === "telemetry"
                    ? "Hooks and telemetry in ~/.claude/settings.json. Cost and token counts are recorded."
                    : "Recording from hooks only, because your Claude Code telemetry already goes elsewhere. Cost and token counts are not recorded."
                  : "Install Claude Code, then run setup again."
              }
            >
              <button
                type="button"
                className="btn"
                disabled={!live || busy !== undefined}
                onClick={() =>
                  run("setup", async () => {
                    const r = await send<SetupResponse>(api.setup(), "POST", {});
                    refresh();
                    return r.summary;
                  })
                }
              >
                Run setup again
              </button>
            </Row>
            <Row
              title={
                <>
                  <span className="agent-dot cline" aria-hidden="true"></span> Cline <span className={`state ${status?.agents.cline.found ? "ok" : "muted"}`}>{status ? (status.agents.cline.found ? "Found" : "Not found") : ""}</span>
                </>
              }
              note={status?.agents.cline.found ? "Read from ~/.cline/data/sessions. Nothing to set up." : "If you install Cline, its sessions are recorded automatically."}
            />
            <Row title="Other agents" note="Cursor and Codex are next. Any other agent can send sessions through the ingest API.">
              <a href="https://docs.postrun.app/capture/other-agents/" target="_blank" rel="noopener" className="link">
                Ingest API docs
              </a>
            </Row>
          </Section>

          <Section id="alerts" title="Notifications and updates">
            <Row title="Tell me when a session keeps failing" note="A desktop notification when a running session fails three steps in a row. Once per streak.">
              <Switch label="Failure notifications" on={status?.settings.notify_failures ?? false} disabled={!live || busy !== undefined} onChange={(v) => void change({ notify_failures: v })} />
            </Row>
            <Row
              title="Check for new versions"
              note="Once a day, asks npm for the latest Postrun version. It is the only time Postrun contacts the internet, and only when this is on."
            >
              <Switch label="Check for new versions" on={status?.settings.update_check ?? false} disabled={!live || busy !== undefined} onChange={(v) => void change({ update_check: v })} />
            </Row>
          </Section>

          <Section id="appearance" title="Appearance">
            <Row title="Theme" note="Remembered in this browser.">
              <div className="seg" role="group" aria-label="Theme">
                {(["system", "dark", "light"] as const).map((t) => (
                  <button key={t} type="button" className={theme === t ? "on" : ""} aria-pressed={theme === t} onClick={() => pickTheme(t)}>
                    {t === "system" ? "System" : t === "dark" ? "Dark" : "Light"}
                  </button>
                ))}
              </div>
            </Row>
            <Row title="Sidebar" note="Collapsed shows icons only, with names on hover. You can also use the button at the bottom of the sidebar, or press [ anywhere.">
              <div className="seg" role="group" aria-label="Sidebar">
                {(["expanded", "collapsed"] as const).map((m) => (
                  <button key={m} type="button" className={sidebar === m ? "on" : ""} aria-pressed={sidebar === m} onClick={() => setSidebar(m)}>
                    {m === "expanded" ? "Expanded" : "Collapsed"}
                  </button>
                ))}
              </div>
            </Row>
          </Section>

          <Section id="storage" title="Storage">
            <div className="set-row column">
              <div className="storage-line">
                <span>
                  Stored in <span className="mono">{status?.storage.home ?? "~/.postrun"}</span>, readable only by you
                </span>
                <span className="mono">{status ? megabytes(status.storage.total_bytes) : ""}</span>
              </div>
              {status ? (
                <>
                  <div className="storage-bar" aria-hidden="true">
                    <span className="s" style={{ flexGrow: status.storage.store_bytes }}></span>
                    <span className="r" style={{ flexGrow: status.storage.raw_bytes }}></span>
                    <span className="o" style={{ flexGrow: Math.max(0, status.storage.total_bytes - status.storage.store_bytes - status.storage.raw_bytes) }}></span>
                  </div>
                  <div className="storage-legend">
                    <span>
                      <i className="s"></i>
                      {status.storage.sessions} sessions, {megabytes(status.storage.store_bytes)}
                    </span>
                    <span>
                      <i className="r"></i>Raw logs, {megabytes(status.storage.raw_bytes)}
                    </span>
                  </div>
                </>
              ) : null}
            </div>
            <Row title="Keep raw logs for" note="Sessions stay complete either way. Raw logs are only needed to rebuild a session.">
              <label className="select">
                <span className="sr-only">Keep raw logs for</span>
                <select
                  value={status?.settings.raw_log_hours ?? 24}
                  disabled={!live || busy !== undefined}
                  onChange={(e) => void change({ raw_log_hours: Number(e.target.value) }, "Saved. Raw logs follow the new setting from now on.")}
                >
                  <option value={24}>24 hours</option>
                  <option value={168}>7 days</option>
                  <option value={720}>30 days</option>
                  <option value={0}>Always</option>
                </select>
              </label>
            </Row>
            <Row title="Back up your sessions" note="One file with every session, to keep or to move to another computer. It is not redacted: keep it private.">
              {live ? (
                <a className="btn" href={api.backup()} download>
                  Save backup
                </a>
              ) : (
                <button type="button" className="btn" disabled>
                  Save backup
                </button>
              )}
            </Row>
            <Row
              tone="danger"
              title="Delete everything Postrun recorded"
              note={`Removes ${status ? `all ${status.storage.sessions} sessions` : "every session"} and their raw logs from this computer, overwritten on disk. New sessions are still recorded. This cannot be undone.`}
            >
              {!confirming ? (
                <button ref={deleteButton} type="button" className="btn danger" disabled={!live || busy !== undefined} onClick={() => setConfirming(true)}>
                  Delete all data
                </button>
              ) : null}
            </Row>
            {confirming ? (
              <div
                className="confirm-delete"
                role="alertdialog"
                aria-labelledby="del-all-h"
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    closeConfirm();
                  }
                }}
              >
                <p id="del-all-h">
                  Type <b>delete everything</b> to confirm.
                </p>
                <input value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Type delete everything to confirm" autoFocus />
                <div className="row-actions">
                  <button
                    type="button"
                    className="btn danger"
                    disabled={typed.trim().toLowerCase() !== "delete everything" || busy !== undefined}
                    onClick={() =>
                      run("delete", async () => {
                        const r = await send<{ deleted: number }>(api.deleteAll(), "POST", { confirm: "delete everything" });
                        closeConfirm();
                        refresh();
                        return `Deleted ${r.deleted} session${r.deleted === 1 ? "" : "s"}. Postrun keeps recording new ones.`;
                      })
                    }
                  >
                    Delete everything
                  </button>
                  <button type="button" className="btn ghost" onClick={closeConfirm}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
          </Section>

          <UsageCard />

          <Section id="account" title="Account">
            <Row title="Not signed in" note="Recording and review never need an account. Accounts arrive with sharing: a link to one session, for someone you choose." />
          </Section>

          <Section id="about" title="About">
            <Row
              title={
                <>
                  Postrun <span className="mono">{status?.version ?? ""}</span>
                </>
              }
              note={
                status?.update?.newer ? (
                  <span className="update-note">
                    Version {status.update.latest} is available. Update with <span className="mono">npm install -g postrun@latest</span>, then <span className="mono">postrun setup</span>.
                  </span>
                ) : checks ? (
                  checks.some((c) => c.level === "fail") ? (
                    "Some checks failed: see below."
                  ) : (
                    "Everything looks good."
                  )
                ) : (
                  "Run the same checks as postrun doctor."
                )
              }
            >
              <button
                type="button"
                className="btn"
                disabled={!live || busy !== undefined}
                onClick={() =>
                  run("doctor", async () => {
                    const r = await apiFetch(api.doctor());
                    setChecks(((await r.json()) as DoctorResponse).checks);
                  })
                }
              >
                {busy === "doctor" ? "Checking…" : "Run checks"}
              </button>
              <a href="https://postrun.app/changelog/" target="_blank" rel="noopener" className="link">
                Changelog
              </a>
            </Row>
            {checks ? (
              <ul className="checks">
                {checks.map((c, i) => (
                  <li key={i} className={`check-${c.level}`} style={{ ["--i" as string]: i }}>
                    <span className="check-level">{c.level === "ok" ? "OK" : c.level === "fail" ? "Problem" : c.level === "warn" ? "Warning" : "Note"}</span>
                    <span>
                      {c.title}
                      {c.detail ? <span className="check-detail">{c.detail}</span> : null}
                      {c.fix && c.level !== "ok" ? <span className="check-fix">Fix: {c.fix}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </Section>
        </div>
      </div>
    </>
  );
}
