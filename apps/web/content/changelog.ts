/**
 * Changelog, newest first. Built from the repository's git history and
 * grouped by day; each entry says what a user can now do, not the commit
 * message. Releases are labelled by date: there are no version numbers yet.
 *
 * Only add things that actually shipped. Internal moves with no visible
 * change (for example relocating a package) are left out.
 */

export type ChangeKind = "new" | "improved" | "fixed" | "security";

export interface Release {
  /** ISO date, YYYY-MM-DD. */
  date: string;
  title: string;
  summary?: string;
  items: Array<{ kind: ChangeKind; text: string }>;
}

export const RELEASES: Release[] = [
  {
    date: "2026-10-06",
    title: "Review, not just replay",
    summary: "The review app becomes a place to sign off on agent work: a dashboard, projects, your verdict on each session, what changed file by file, and what looks risky.",
    items: [
      { kind: "new", text: "A dashboard: sessions, steps, failures and what you have not reviewed yet, steps per day, what is running now, and the most edited files." },
      { kind: "new", text: "Mark a session Looks good or Needs follow-up, with a note. Filter the list by review, and review several sessions at once." },
      { kind: "new", text: "Copy as PR summary: Markdown for a pull request description, with the changes, commands, commits and anything worth checking." },
      { kind: "new", text: "A Changes tab with every edit file by file, as diffs, and a plain summary of what happened at the top of each session." },
      { kind: "new", text: "Risk flags for rm -rf, force pushes, scripts piped to a shell, secrets printed in output, secrets files, and edits outside the project." },
      { kind: "new", text: "Search finds text inside sessions too: commands, output, edits and messages, with the matching line shown." },
      { kind: "new", text: "Projects: each folder your agents worked in, with its sessions, failure rate and most changed files." },
      { kind: "new", text: "The git branch and the commits an agent made, on every session." },
      { kind: "new", text: "Keyboard review: j and k through steps, f to the next failure, a and n to review, c to copy, ? for the rest." },
      { kind: "new", text: "Settings: pause recording, start at login, a light theme, storage and backups, delete everything, and the doctor checks, all from the app." },
      { kind: "new", text: "Optional, off by default: a desktop notification when a session keeps failing, and a daily check for a newer Postrun." },
      { kind: "new", text: "Export several sessions at once as a zip of redacted reports." },
    ],
  },
  {
    date: "2026-10-06",
    title: "A review app that moves",
    summary: "The session list and session view are redesigned around the strip: the shape of what an agent did, at a glance.",
    items: [
      { kind: "new", text: "Every session has a strip: its steps in order, coloured by kind, with failures standing out in red. On a session page, the tape shows every step; click a bar to jump to it." },
      { kind: "new", text: "Search, date ranges, size and failure filters, and a list or grid view. Empty sessions are tucked away until you ask for them." },
      { kind: "improved", text: "Long histories load 50 sessions at a time as you scroll, and the filtering runs in the store, so the list stays quick with thousands of sessions." },
      { kind: "improved", text: "Sessions group by day, new sessions slide in live, numbers tick when they change, steps unfold smoothly, and loading shows the page's shape instead of a spinner." },
    ],
  },
  {
    date: "2026-10-06",
    title: "Postrun 0.1: one command to install",
    summary: "Postrun is now an installable command for early access: npm install -g postrun, then postrun setup.",
    items: [
      { kind: "new", text: "postrun setup sets up Claude Code, finds Cline, starts recording in the background and opens the review app. It can start Postrun at login on macOS and Linux." },
      { kind: "new", text: "postrun doctor checks everything that could stop a session being recorded, and gives one fix for each problem." },
      { kind: "new", text: "postrun uninstall takes Postrun back out of Claude Code, leaving your own settings exactly as they were, and asks before deleting any data." },
      { kind: "improved", text: "Recording and the review app now run as one quiet background process, so there is nothing to keep open in a terminal." },
      { kind: "improved", text: "If you already send Claude Code telemetry somewhere else, Postrun leaves it alone and records from hooks only. If a port is taken, setup picks a free one." },
      { kind: "improved", text: "No native dependencies: Postrun uses the SQLite built into Node 22.13 and later, so installing never needs a compiler." },
    ],
  },
  {
    date: "2026-10-06",
    title: "Delete a session",
    summary: "Remove one session from Postrun for good, without deleting everything else.",
    items: [
      { kind: "new", text: "A Delete button on every session, with a confirmation that says exactly what goes and what stays. Also available as postrun delete." },
      { kind: "security", text: "Deleted sessions are overwritten on disk, not just unlinked, and their raw capture files are removed. Postrun will not record a deleted session again, even if the agent keeps going." },
    ],
  },
  {
    date: "2026-10-06",
    title: "Light on a long day",
    summary: "Postrun now stays in the background on a very heavy day: several agents in parallel for twelve hours cost about 1% of one CPU core.",
    items: [
      { kind: "fixed", text: "Recording no longer stops once Claude Code's log grows past 512 MB. Logs are read in small pieces and never whole." },
      { kind: "improved", text: "Each session is recorded in its own folder, and each agent turn reads only what that turn added, so a turn costs about the same at hour twelve as at minute one, however much history you have." },
      { kind: "improved", text: "Raw log files are removed 24 hours after a session goes quiet; everything you review and export stays in the store. Edits no longer keep a full copy of the file." },
      { kind: "improved", text: "The review app opens long sessions quickly and downloads only what changed on each live update. Full output loads when you open a step, and the timeline shows recent turns first." },
      { kind: "improved", text: "Very long Cline sessions are refreshed less often while busy, so they never slow your machine down." },
    ],
  },
  {
    date: "2026-10-06",
    title: "Every step, opened up",
    summary: "The review app now shows everything a step recorded, and no Claude Code session is lost when the recorder was not running.",
    items: [
      { kind: "new", text: "Click any step in the timeline to open it: the command with its output, the edit as a diff, the full prompt or reply, and any error. Expand or collapse a whole session at once, and link straight to a step." },
      { kind: "fixed", text: "Claude Code sessions recorded while the recorder was stopped are no longer lost. They are rebuilt from Claude Code's own hook log, with every prompt, command, edit and reply. Only cost and token counts are missing, and the app says so." },
      { kind: "improved", text: "When the recorder starts, it catches up on every session it missed, including ones that never ended cleanly." },
    ],
  },
  {
    date: "2026-10-06",
    title: "postrun.app goes up",
    summary: "The website you are reading, with a live demo of a recorded session and a real exported report.",
    items: [
      { kind: "new", text: "postrun.app, with an animated example session, the three steps of record, review and share, and an early access waitlist." },
      { kind: "new", text: "An example exported report you can open in your browser, the same file Postrun writes on export." },
      { kind: "new", text: "FAQ and a plain-language privacy page. The site sets no cookies." },
      { kind: "new", text: "Cookieless visit and click counts with Vercel Web Analytics, described on the privacy page." },
      { kind: "improved", text: "A translucent header that folds into a pill as you scroll, and layouts for foldable and dual-screen devices." },
    ],
  },
  {
    date: "2026-10-05",
    title: "Share a session, watch it live",
    summary: "The first piece of sharing on purpose, plus a review app that updates while the agent works.",
    items: [
      {
        kind: "new",
        text: "Export a session as one self-contained HTML report, from the command line or the Export button on the session page. It has no JavaScript, makes no outside requests, and opens in any browser.",
      },
      {
        kind: "new",
        text: "Redaction on every export: private keys, AWS, GitHub, Anthropic, OpenAI, Stripe, Slack and Google keys, JWTs, passwords in URLs, Authorization headers and credential-named values are masked, and home folder paths become ~. Every masked value is listed for you to check before sending.",
      },
      { kind: "new", text: "The export panel in the review app shows what will be masked before the file downloads." },
      { kind: "new", text: "Live session view: open sessions update as steps are recorded, and catch up on their own after the server restarts or the tab reconnects." },
      { kind: "new", text: "The status pill in the review app shows the real connection state: live, connecting or server offline." },
      {
        kind: "new",
        text: "An ingest API for your own adapters: push sessions to POST /api/ingest with a local bearer token. Every batch is validated against the v1.2 schema before anything is stored.",
      },
      {
        kind: "improved",
        text: "Starting capture now configures Claude Code for you if needed. Your settings file is backed up once, merged in place, and running it again changes nothing.",
      },
      { kind: "improved", text: "A refreshed review app: session list, session report and top bar." },
      {
        kind: "security",
        text: "The recorder and the API refuse requests whose Host header is not a loopback name, which blocks DNS rebinding. No CORS headers are sent.",
      },
      { kind: "security", text: "Everything Postrun writes under ~/.postrun is owner-only: folders 0700, files 0600. Older, wider files are tightened when opened." },
      { kind: "security", text: "Size limits on incoming data, and internal error details are never sent back in responses." },
      { kind: "fixed", text: "The last batch of telemetry is no longer lost when capture stops." },
    ],
  },
  {
    date: "2026-09-08",
    title: "Live capture for Claude Code and Cline",
    summary: "Postrun starts recording sessions as they happen, on your own machine.",
    items: [
      { kind: "new", text: "A local telemetry receiver on 127.0.0.1 and a hook script record Claude Code sessions while they run." },
      { kind: "new", text: "Cline sessions are picked up from Cline's own session folder." },
      { kind: "new", text: "One capture command runs the receiver and both watchers, or ingests whatever is already on disk and exits." },
      { kind: "improved", text: "Capture files that hold several Claude Code sessions are split into separate sessions, with the working folder and agent version shown." },
    ],
  },
];
