import type { Metadata } from "next";
import { PageShell } from "@/components/PageShell";
import { pageMeta } from "@/content/meta";
import { CONTACT_EMAIL } from "@/content/site";

export const metadata: Metadata = pageMeta("/privacy/", {
  title: "Privacy · postrun",
  description: "What Postrun collects: the app sends nothing anywhere, the website keeps your email only if you join the waitlist, and visits are counted without cookies.",
});

/**
 * A plain privacy note for a personal project: what is collected, by whom,
 * and how to have it removed. Section ids are linked from elsewhere
 * (#website, #cookies), so keep them stable.
 */
export default function Privacy() {
  return (
    <PageShell
      kicker="PRIVACY"
      title="What Postrun collects, in plain words."
      lede="Postrun is a personal project by Hero Momoh. The short version: the app sends nothing anywhere, and this website keeps your email only if you ask it to."
      meta={<p className="mono muted small">Last updated 6 October 2026</p>}
    >
      <div className="prose-page">
        <h2 id="app">The Postrun app</h2>
        <p>
          The app records what your coding agents do on your computer: prompts, replies, commands and their output, and the files they read and edit. All of it stays in the{" "}
          <code>~/.postrun</code> folder on your machine, readable only by your user account. The app listens on <code>127.0.0.1</code> only, answers only a browser you
          connected with <code>postrun open</code>, has no telemetry or crash reporting, and never sends your sessions to me or anyone else. Delete <code>~/.postrun</code> and
          everything it stored is gone.
        </p>
        <p>
          One optional exception: if you turn on <b>Check for new versions</b> in Settings (it is off until you do), the app asks the npm registry once a day for the latest
          Postrun version number. That request carries nothing about you or your sessions; npm sees your IP address, as with any download. Turn it off again in Settings.
        </p>

        <h2 id="exports">Reports you export</h2>
        <p>
          Exporting a session writes one HTML file on your computer, with known secrets, credentials and home folder paths masked and every mask listed for you to check. Redaction
          can miss things, so skim a report before you send it. Who receives it is up to you. The file has no scripts and makes no network requests when opened.
        </p>

        <h2 id="website">This website</h2>
        <p>
          <b>Waitlist.</b> If you join the waitlist, your email address is sent to Formspree, which forwards it to me. I use it only to tell you when Postrun is ready for your
          agent, and never share or sell it.
        </p>
        <p>
          <b>Visit counts.</b> The site is hosted on Vercel and uses Vercel Web Analytics to count visits, pages read and buttons clicked, in aggregate. It sets no cookies and I
          never see who you are or your IP address. Anything you type, like your email, is never sent to analytics.
        </p>
        <p>There are no ads, social media widgets or other third-party scripts, and fonts are served from this domain.</p>

        <h2 id="cookies">Cookies</h2>
        <p>
          This website sets no cookies and stores nothing in your browser, which is why there is no cookie banner. If that ever changes, this page will say so first.
        </p>

        <h2 id="contact">Removing your email, or any question</h2>
        <p>
          Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> and I&rsquo;ll delete your waitlist entry or answer your question.
        </p>
      </div>
    </PageShell>
  );
}
