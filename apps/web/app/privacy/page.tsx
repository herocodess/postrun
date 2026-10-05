import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Privacy policy · postrun",
  description: "How Postrun handles your data: the app sends us nothing, and the website only keeps an email if you join the waitlist. No cookies.",
};

const TOC = [
  { id: "who", label: "Who we are" },
  { id: "app", label: "The Postrun app" },
  { id: "exports", label: "Reports you export" },
  { id: "website", label: "This website" },
  { id: "cookies", label: "Cookies" },
  { id: "sharing", label: "Who we share data with" },
  { id: "transfers", label: "International transfers" },
  { id: "retention", label: "How long we keep data" },
  { id: "rights", label: "Your rights" },
  { id: "children", label: "Children" },
  { id: "changes", label: "Changes to this policy" },
  { id: "contact", label: "Contact" },
];

export default function Privacy() {
  return (
    <LegalPage
      title="Privacy policy"
      updated="6 October 2026"
      toc={TOC}
      summary={
        <ul className="legal-points">
          <li>
            <b>The Postrun app sends us nothing.</b> It records your agent sessions on your own computer and never transmits them to us or anyone else.
          </li>
          <li>
            <b>Sessions leave your machine only when you export one.</b> You choose the file and who gets it.
          </li>
          <li>
            <b>This website keeps one thing:</b> your email address, if you join the waitlist.
          </li>
          <li>
            <b>No cookies, no analytics, no tracking</b> on this website.
          </li>
        </ul>
      }
    >
      <h2 id="who">Who we are</h2>
      <p>
        Postrun is made by [LEGAL ENTITY NAME], [REGISTERED ADDRESS] (&ldquo;Postrun&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;). For the waitlist described below, we are the
        controller of your personal data. You can reach us about anything in this policy at [PRIVACY EMAIL].
      </p>
      <p>
        This policy covers the Postrun software (&ldquo;the app&rdquo;) and this website, postrun.app. We wrote it to meet the UK GDPR, the EU GDPR and the Nigeria Data Protection
        Act 2023.
      </p>

      <h2 id="app">The Postrun app</h2>
      <p>
        The app records what AI coding agents do on your computer: your prompts, the agent&rsquo;s replies, the commands it runs and their output, the files it reads and edits, and
        related details such as timestamps, token counts and cost figures the agent reports.
      </p>
      <p>
        All of this stays on your computer. It is stored in the <code>~/.postrun</code> folder, with files readable only by your user account. The recorder and the review app
        listen on <code>127.0.0.1</code> only, so they cannot be reached from other machines. The app contains no telemetry, analytics or crash reporting, and does not contact our
        servers.
      </p>
      <p>
        Because we never receive this data, we don&rsquo;t process it and can&rsquo;t see, copy or delete it. You control it entirely: deleting the <code>~/.postrun</code> folder
        removes everything the app has stored.
      </p>
      <p>
        Sessions can contain personal data or confidential material that belongs to you, your employer or others (for example names in commit messages, or secrets a command
        printed). You are responsible for using the app in line with your employer&rsquo;s policies and the law that applies to that data.
      </p>

      <h2 id="exports">Reports you export</h2>
      <p>
        When you export a session, the app writes one HTML file on your computer. Before writing it, the app masks known secret formats, credential values and home folder paths,
        leaves out your machine name and local file locations, and shows you every value it masked. Redaction is automatic and helpful, but it can miss things, so please check a
        report before sharing it.
      </p>
      <p>
        You decide who receives an exported report. Once you send it, the recipient&rsquo;s use of it is governed by their own practices, not this policy. Exported reports contain
        no scripts or tracking and make no network requests when opened.
      </p>
      <p>We plan to offer hosted share links in future. Before that launches, we will update this policy to explain exactly what is uploaded, where, and for how long.</p>

      <h2 id="website">This website</h2>
      <p>
        <b>Waitlist.</b> If you join the waitlist, we collect your email address so we can tell you when Postrun is available for your agent. Our legal basis is your consent, which
        you can withdraw at any time by emailing [PRIVACY EMAIL] or using the unsubscribe link in any email we send. Waitlist sign-ups are handled by [WAITLIST PROVIDER] on our
        behalf.
      </p>
      <p>
        <b>Hosting logs.</b> The site is served by [HOSTING PROVIDER]. Like any web server, it processes technical data such as your IP address, browser type and the pages
        requested, so it can deliver the site and protect it against abuse. Our legal basis is our legitimate interest in running a secure website. We don&rsquo;t use these logs to
        identify you or build a profile of you.
      </p>
      <p>We don&rsquo;t use analytics, advertising, social media plugins or any third-party scripts on this site. Fonts are served from our own domain.</p>

      <h2 id="cookies">Cookies</h2>
      <p>
        This website doesn&rsquo;t set any cookies, and doesn&rsquo;t use local storage or similar technologies to store or read information on your device. That&rsquo;s why
        there&rsquo;s no cookie banner: there is nothing to consent to.
      </p>
      <p>
        If that ever changes, we&rsquo;ll update this section first and, where the law requires it, ask for your consent before setting anything that isn&rsquo;t strictly
        necessary.
      </p>

      <h2 id="sharing">Who we share data with</h2>
      <p>
        We don&rsquo;t sell personal data or share it for advertising. We only share it with the service providers named above, who process it on our instructions under data
        processing agreements, or where the law requires us to.
      </p>

      <h2 id="transfers">International transfers</h2>
      <p>
        Our providers may process data outside the UK, the EU or Nigeria. When they do, we rely on safeguards recognised by the relevant law, such as the UK International Data
        Transfer Agreement or Addendum, the EU Standard Contractual Clauses, or an adequacy decision.
      </p>

      <h2 id="retention">How long we keep data</h2>
      <p>
        We keep your waitlist email until you ask us to remove it or unsubscribe, or until we close the waitlist, whichever comes first. Hosting logs are kept for the period set
        by [HOSTING PROVIDER], [LOG RETENTION PERIOD].
      </p>

      <h2 id="rights">Your rights</h2>
      <p>
        Depending on where you live, you can ask to access, correct or delete your personal data, object to or restrict how we use it, receive a copy of it, and withdraw consent
        at any time. Email [PRIVACY EMAIL] and we&rsquo;ll respond within one month.
      </p>
      <p>
        You can also complain to a data protection authority: the Information Commissioner&rsquo;s Office (ico.org.uk) in the UK, the Nigeria Data Protection Commission
        (ndpc.gov.ng) in Nigeria, or the authority in your EU country. We&rsquo;d appreciate the chance to fix things first.
      </p>

      <h2 id="children">Children</h2>
      <p>Postrun is a tool for software developers and is not directed at children. We don&rsquo;t knowingly collect personal data from anyone under 16.</p>

      <h2 id="changes">Changes to this policy</h2>
      <p>
        We&rsquo;ll update this page when our practices change and change the date at the top. If a change is significant, such as introducing hosted share links, we&rsquo;ll tell
        waitlist members by email before it takes effect.
      </p>

      <h2 id="contact">Contact</h2>
      <p>[LEGAL ENTITY NAME], [REGISTERED ADDRESS]. Email: [PRIVACY EMAIL].</p>
    </LegalPage>
  );
}
