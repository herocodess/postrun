/**
 * FAQ copy. Every answer describes what Postrun does today; nothing here
 * promises a feature, platform, price or licence that hasn't been decided.
 * Shown on the home page and published as FAQPage structured data.
 */

export interface Faq {
  q: string;
  /** Plain text. Paragraphs split on blank lines. `code` spans are rendered as code. */
  a: string;
}

export const FAQS: Faq[] = [
  {
    q: "What does Postrun record?",
    a: "Everything a coding agent does in a session: your prompts, its replies, every command it runs with the output, every file it reads or edits, and which steps failed and why. Each session becomes one timeline of turns and steps you can review from start to finish.",
  },
  {
    q: "Does any of my code, prompts or output leave my machine?",
    a: "No. The recorder and the review app run on your computer and listen on `127.0.0.1` only. Sessions are stored in `~/.postrun`, readable only by your user account. Postrun has no telemetry and never phones home.\n\nA session leaves your machine only when you export it yourself, one session at a time.",
  },
  {
    q: "Which coding agents does it work with?",
    a: "Claude Code and Cline today, recorded into one shared format so you review them the same way. Cursor and Codex are next. Any other agent can send sessions through Postrun's local ingest API.",
  },
  {
    q: "How does sharing work?",
    a: "Export a session and you get a single HTML file: every command, edit and message, expandable, with failures and output. It has no JavaScript and loads nothing from the internet, so it's safe to open and works anywhere: email it, share it alongside a pull request, or drop it in a chat.\n\nHosted share links are planned, built on the same redacted file.",
  },
  {
    q: "What does redaction catch, and can I rely on it?",
    a: "Before anything is exported, Postrun masks known secret formats (private keys, AWS, GitHub, Anthropic, OpenAI, Stripe, Slack and Google keys, JWTs), passwords in URLs, Authorization headers, and values assigned to names like `API_KEY`, `token` or `password`. Home folder paths become `~`, and your machine name is left out.\n\nEvery masked value is listed for you to check before sending. Redaction is a safety net, not a guarantee, so skim the report before you share it.",
  },
  {
    q: "Is Postrun a cost or usage dashboard?",
    a: "No. It shows the cost and token counts your agent reports, but the point is review: what the agent did, what it touched, and what went wrong. The session is the unit, and everything else is a filter.",
  },
  {
    q: "Can I watch a session while the agent is still working?",
    a: "Yes. The review app updates live as steps are recorded, and catches up on its own if you close the tab and come back.",
  },
  {
    q: "Where is my data, and how do I delete it?",
    a: "Everything Postrun stores lives in `~/.postrun` on your computer. To remove one session, open it and press Delete: it is removed from the store along with its raw files, overwritten on disk, and never recorded again. To remove everything, delete the `~/.postrun` folder. Nothing is copied anywhere else, unless you choose to make a share link.",
  },
  {
    q: "How do I get it?",
    a: "Install it with `npm install -g postrun`, then run `postrun setup`. It needs Node 22.13 or newer on macOS or Linux, and it's free and open source under the MIT license. Using an agent Postrun doesn't support yet? Leave your email at the bottom of the home page and we'll tell you when it does.",
  },
];
