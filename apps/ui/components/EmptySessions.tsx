/**
 * First run: nothing recorded yet. A small animated recorder (a pulsing
 * record light and a playhead sweeping over empty step slots) and the two
 * things that usually explain an empty list. Motion stops for people who
 * prefer reduced motion.
 */

export function EmptySessions({ agent }: { agent?: string }) {
  return (
    <section className="empty" aria-labelledby="empty-title">
      <svg className="empty-art" viewBox="0 0 240 120" width="240" height="120" aria-hidden="true">
        <defs>
          <linearGradient id="empty-sweep" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0.22" />
          </linearGradient>
        </defs>
        {/* the track */}
        <rect x="20" y="24" width="200" height="72" rx="12" className="empty-track" />
        {/* record light */}
        <circle cx="40" cy="44" r="5" className="empty-rec" />
        <text x="52" y="48" className="empty-label">
          REC
        </text>
        {/* empty step slots, waiting to be filled */}
        {[0, 1, 2, 3, 4].map((i) => (
          <rect key={i} x={38 + i * 34} y="62" width="26" height="18" rx="4" className="empty-slot" style={{ animationDelay: `${i * 0.5}s` }} />
        ))}
        {/* the playhead, sweeping and finding nothing yet */}
        <g className="empty-head">
          <rect x="-28" y="56" width="28" height="30" fill="url(#empty-sweep)" />
          <rect x="-1" y="54" width="2" height="34" rx="1" className="empty-head-line" />
        </g>
      </svg>
      <h2 id="empty-title">{agent ? `No ${agent} sessions yet` : "Waiting for your first session"}</h2>
      <p className="empty-lede">
        Postrun is recording in the background. Start a Claude Code or Cline session and it shows up here at the end of its first turn, then updates as the agent works.
      </p>
      <ul className="empty-hints">
        <li>
          <b>Claude Code already open?</b> Quit it and start it again once. It reads its settings only when it starts.
        </li>
        <li>
          <b>Still nothing?</b> Run <code>postrun doctor</code> in a terminal.
        </li>
      </ul>
    </section>
  );
}
