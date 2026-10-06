import type { Metadata } from "next";
import { pageMeta } from "@/content/meta";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = pageMeta("/terms/", {
  title: "Terms · postrun",
  description: "The terms for using postrun.app and Postrun during early access.",
});

const TOC = [
  { id: "agreement", label: "These terms" },
  { id: "early-access", label: "Early access" },
  { id: "your-data", label: "Your data and your responsibilities" },
  { id: "sharing", label: "Sharing reports" },
  { id: "acceptable-use", label: "Acceptable use" },
  { id: "ip", label: "Ownership and licence" },
  { id: "warranty", label: "No warranty" },
  { id: "liability", label: "Limitation of liability" },
  { id: "ending", label: "Ending these terms" },
  { id: "law", label: "Governing law" },
  { id: "changes", label: "Changes" },
  { id: "contact", label: "Contact" },
];

export default function Terms() {
  return (
    <LegalPage
      title="Terms"
      updated="6 October 2026"
      toc={TOC}
      summary={
        <ul className="legal-points">
          <li>
            <b>Postrun is in early access.</b> It works, but it will change, and it comes without guarantees.
          </li>
          <li>
            <b>Your sessions are yours.</b> They stay on your computer, and you&rsquo;re responsible for what you record and what you share.
          </li>
          <li>
            <b>Check reports before you send them.</b> Redaction helps but can miss things.
          </li>
        </ul>
      }
    >
      <h2 id="agreement">These terms</h2>
      <p>
        These terms apply to your use of postrun.app (&ldquo;the website&rdquo;) and the Postrun software (&ldquo;the app&rdquo;), provided by [LEGAL ENTITY NAME] (&ldquo;we&rdquo;,
        &ldquo;us&rdquo;). By using either, you agree to them. If you use Postrun for your employer, you confirm you&rsquo;re allowed to accept these terms on its behalf. Our{" "}
        <a href="/privacy/">privacy policy</a> explains how we handle personal data.
      </p>

      <h2 id="early-access">Early access</h2>
      <p>
        Postrun is offered as an early-access release. Features may change, break or be removed, and we may stop offering the app or any part of it. During early access the app
        is provided free of charge unless we tell you otherwise in advance.
      </p>

      <h2 id="your-data">Your data and your responsibilities</h2>
      <p>
        The app records sessions on your own computer and does not send them to us (see the <a href="/privacy/#app">privacy policy</a>). You own your session data, and you&rsquo;re
        responsible for it, including:
      </p>
      <ul>
        <li>making sure you&rsquo;re allowed to record the code, data and systems your agents work on, under your employer&rsquo;s policies and any agreements you&rsquo;re bound by;</li>
        <li>keeping your computer, and the <code>~/.postrun</code> folder, secure;</li>
        <li>keeping backups of anything you can&rsquo;t afford to lose.</li>
      </ul>

      <h2 id="sharing">Sharing reports</h2>
      <p>
        When you export a session, the app tries to mask secrets, credentials and home folder paths, and lists everything it masked. Redaction is automatic and may not catch every
        sensitive value. You&rsquo;re responsible for reviewing a report before sharing it, and for who you share it with.
      </p>

      <h2 id="acceptable-use">Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>use Postrun to record people, systems or data without the right to do so;</li>
        <li>use Postrun, or reports it produces, to break the law or anyone&rsquo;s rights;</li>
        <li>attack, overload or interfere with the website or any service we run.</li>
      </ul>

      <h2 id="ip">Ownership and licence</h2>
      <p>
        We own the website and the Postrun name, logo and app, except for any open-source components, which remain under their own licences. Your use of the app is governed by
        [SOFTWARE LICENCE]. Nothing in these terms gives us any rights in your session data or exported reports.
      </p>

      <h2 id="warranty">No warranty</h2>
      <p>
        The website and the app are provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. To the fullest extent the law allows, we make no warranties of any kind, including
        that they will be error-free, uninterrupted, or that redaction will catch every sensitive value.
      </p>

      <h2 id="liability">Limitation of liability</h2>
      <p>
        To the fullest extent the law allows, we are not liable for any indirect or consequential loss, or for loss of data, profits or business, arising from your use of the
        website or the app. Our total liability to you for anything relating to them is limited to [LIABILITY CAP].
      </p>
      <p>
        Nothing in these terms limits liability that cannot be limited by law, such as liability for death or personal injury caused by negligence, or for fraud, and nothing
        affects your statutory rights as a consumer.
      </p>

      <h2 id="ending">Ending these terms</h2>
      <p>
        You can stop using Postrun at any time; deleting the app and the <code>~/.postrun</code> folder removes everything it stored. We may end your access to early-access
        releases if you break these terms.
      </p>

      <h2 id="law">Governing law</h2>
      <p>These terms are governed by the laws of [GOVERNING LAW], and the courts of [JURISDICTION] have jurisdiction over any dispute.</p>

      <h2 id="changes">Changes</h2>
      <p>
        We may update these terms as Postrun develops, for example when hosted share links or paid plans launch. We&rsquo;ll change the date at the top, and tell waitlist members
        about significant changes before they take effect.
      </p>

      <h2 id="contact">Contact</h2>
      <p>[LEGAL ENTITY NAME], [REGISTERED ADDRESS]. Email: [CONTACT EMAIL].</p>
    </LegalPage>
  );
}
