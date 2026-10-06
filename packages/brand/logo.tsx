/**
 * The postrun mark, "Step playback": a stem cut into four steps beside a play
 * triangle. Replay the session, step by step. At 16px the gaps close and it
 * reads as a plain stem and play button, so it degrades cleanly.
 *
 * `animated` plays the steps top to bottom like a playhead (on hover in the
 * nav, on load in the hero badge). Motion is CSS only and stops under
 * prefers-reduced-motion.
 */

const STEPS = [10, 21.5, 33, 44.5];

export function Mark({
  size = 24,
  fg = "currentColor",
  accent = "var(--accent)",
  animated = false,
  title,
}: {
  size?: number;
  fg?: string;
  accent?: string;
  animated?: boolean;
  title?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={animated ? "mark mark-animated" : "mark"}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {STEPS.map((y, i) => (
        <rect key={y} className="mark-step" style={{ animationDelay: `${i * 120}ms` }} x="13" y={y} width="11" height="9.5" rx="3" fill={fg} />
      ))}
      <path
        className="mark-play"
        d="M29 13c0-2.3 2.5-3.7 4.4-2.5l16.4 10.3c1.8 1.1 1.8 3.8 0 4.9L33.4 36c-1.9 1.2-4.4-.2-4.4-2.5Z"
        fill={accent}
      />
    </svg>
  );
}

export function Wordmark({ size = 18 }: { size?: number }) {
  return (
    <span className="wordmark" style={{ fontSize: size }}>
      <Mark size={Math.round(size * 1.35)} animated />
      <span>postrun</span>
    </span>
  );
}

/**
 * The loader: the mark playing on a loop, steps lighting top to bottom like a
 * playhead, then the play triangle nudging forward. Used instead of a generic
 * spinner everywhere Postrun waits. Styles in loader.css. Under reduced motion
 * it breathes gently instead.
 *
 * `label` is read to screen readers; `inline` sits beside text (in a button).
 */
export function Loader({ size = 28, label = "Loading", inline = false, fg = "currentColor" }: { size?: number; label?: string; inline?: boolean; fg?: string }) {
  return (
    <span className={inline ? "pr-loader pr-loader-inline" : "pr-loader"} role="status" aria-live="polite">
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
        {STEPS.map((y, i) => (
          <rect key={y} className="pr-loader-step" style={{ animationDelay: `${i * 140}ms` }} x="13" y={y} width="11" height="9.5" rx="3" fill={fg} />
        ))}
        <path className="pr-loader-play" d="M29 13c0-2.3 2.5-3.7 4.4-2.5l16.4 10.3c1.8 1.1 1.8 3.8 0 4.9L33.4 36c-1.9 1.2-4.4-.2-4.4-2.5Z" fill="var(--accent, #ff6a1a)" />
      </svg>
      <span className="pr-loader-label">{label}</span>
    </span>
  );
}

/**
 * Whether this browser is signed in at app.postrun.app. app.postrun.app sets a
 * "postrun_signed_in" marker on the whole postrun.app domain (it holds nothing
 * secret; the session itself stays on app.postrun.app), so the website and docs
 * can say Dashboard instead of Log in. Read after mount: the sites are static.
 */
export function signedInHere(): boolean {
  if (typeof document === "undefined") return false;
  return /(?:^|;\s*)postrun_signed_in=1(?:;|$)/.test(document.cookie);
}
