import type { Metadata } from "next";
import { pageMeta } from "@/content/meta";
import { guideBySlug } from "@/content/guides";
import { GuideShell } from "@/components/GuideShell";
import { PageCta } from "@/components/PageCta";
import { Reveal } from "@/components/Reveal";

const SLUG = "share-ai-coding-session-safely";
const g = guideBySlug(SLUG);
export const metadata: Metadata = pageMeta(`/guides/${SLUG}/`, { title: `${g.title} · postrun`, description: g.summary });

export default function Guide() {
  return (
    <GuideShell slug={SLUG} lede="A coding agent's session is the best explanation of its work, and one of the leakiest documents you own. Here is how to share one safely.">
      <Reveal className="prose-page">
        <h2>Why sessions leak</h2>
        <p>Agents read config files, print environments and run commands that echo credentials. One ordinary session can contain:</p>
        <ul>
          <li>
            Cloud and API keys printed by a command like <code>env</code>, or read from a <code>.env</code> file.
          </li>
          <li>Tokens in Authorization headers, cookies, or URLs with a password in them.</li>
          <li>Private keys and certificates the agent opened.</li>
          <li>Your home folder path, user name and machine name.</li>
          <li>Email addresses from logs, fixtures or git history.</li>
        </ul>
        <p>
          Pasting a transcript, a screenshot or a terminal log into a pull request or a client email sends all of that with it. Searching the text by hand for secrets misses the
          ones you didn&rsquo;t think to look for.
        </p>

        <h2>The rule: redact first, check, then send</h2>
        <p>A safe way to share a session has three properties:</p>
        <ol>
          <li>
            <strong>Masking is automatic</strong>, not something you remember to do.
          </li>
          <li>
            <strong>You see what was masked</strong>, every value and where it was, before anything leaves your machine.
          </li>
          <li>
            <strong>The shared copy can&rsquo;t do anything</strong>: no scripts, no requests to the internet, nothing that runs when someone opens it.
          </li>
        </ol>

        <h2>How Postrun does it</h2>
        <p>Every export and every share link goes through the same redaction. It masks:</p>
        <ul>
          <li>Private keys (including cut-off and PGP keys) and JWTs.</li>
          <li>AWS, GitHub, GitLab, Anthropic, OpenAI, Stripe, Slack, Discord, Google, npm, Hugging Face and SendGrid tokens.</li>
          <li>
            Passwords in URLs, Authorization headers and cookies, <code>curl -u</code> and <code>--password</code> flags.
          </li>
          <li>
            Values assigned to names like <code>API_KEY</code>, <code>token</code> or <code>password</code>, quoted or not.
          </li>
          <li>Long random-looking values and email addresses.</li>
        </ul>
        <p>
          Home folder paths become <code>~</code>. Your machine name, Postrun&rsquo;s capture paths and your own review notes are left out entirely. Each masked value shows as{" "}
          <code>[REDACTED:kind]</code>, so a reader can still follow what happened.
        </p>

        <h3>Check before you send</h3>
        <p>
          In the review app, click <strong>Export report</strong> or <strong>Share</strong> on a session. Before anything is written or uploaded, Postrun lists each masked value
          with the step and field it came from. In the terminal, <code>postrun export &lt;id&gt;</code> prints the same list. Redaction is automatic, not a guarantee: skim the
          report before it goes.
        </p>

        <h2>File or link?</h2>
        <h3>A file, when you want nothing hosted</h3>
        <p>
          The export is one HTML file with no JavaScript that loads nothing from the internet. Attach it to a pull request, email it, or drop it in a chat. It opens in any browser
          with no account and no install. Once sent, it&rsquo;s out of your hands.
        </p>
        <h3>A link, when you want control</h3>
        <p>
          A share link uploads the same redacted report, and nothing else, to app.postrun.app. The link is unlisted and lasts 1, 7, 30 or 90 days. You can see how often it was
          opened, and turning it off deletes the report from the server at once. Shared reports open in a sandbox with no scripts, forms or network access, and are never cached
          or indexed by search engines. Share links need a free account; recording never does.
        </p>
        <pre>
          <code>{`postrun login                      # once, connects this computer
postrun share <id> --expires 7     # prints the masked values, then the link`}</code>
        </pre>

        <h2>A short checklist</h2>
        <ul>
          <li>Send a report of the session, never a raw transcript, log or screenshot.</li>
          <li>Read the list of masked values. Anything surprising there is also worth rotating.</li>
          <li>Skim the report once as the reader will see it.</li>
          <li>Prefer a link that expires for anything sensitive, and turn it off when it has done its job.</li>
          <li>
            If a secret did appear in a session, rotate it. Masking protects the report, not the key itself. The{" "}
            <a href="/guides/review-ai-agent-session-checklist/">agent review checklist</a> covers what else to look for.
          </li>
        </ul>
      </Reveal>
      <PageCta where="guide-share" title="Share sessions without the secrets." />
    </GuideShell>
  );
}
