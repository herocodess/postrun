/**
 * The sign-in email, sent through Resend from the verified postrun.app domain.
 * Without RESEND_API_KEY (on your own machine) the link is printed in the
 * terminal running `pnpm dev` instead, so sign-in can be tested offline.
 *
 * The layout follows what mail clients reliably render: tables, inline styles,
 * a 480px column, a button that also works in Outlook, the logo attached inline
 * (no remote images to block), a hidden preview line, and a plain-text part.
 * It says when and from what device the link was asked for, so a person who
 * didn't ask can tell at a glance.
 */

import { randomUUID } from "node:crypto";
import { Resend } from "resend";
import { EMAIL_LOGO_PNG_BASE64 } from "./email-logo";
import { isProduction, optionalEnv } from "./env";

const FROM = () => optionalEnv("EMAIL_FROM") ?? "Postrun <login@postrun.app>";

/** Where and when the link was asked for, shown in the email. Everything is optional. */
export interface RequestDetails {
  at: Date;
  device?: string;
  location?: string;
}

export async function sendSignInEmail(to: string, url: string, details: RequestDetails = { at: new Date() }): Promise<void> {
  const key = optionalEnv("RESEND_API_KEY");
  if (!key) {
    if (isProduction()) throw new Error("RESEND_API_KEY is not set, so the sign-in email cannot be sent.");
    console.log(`\n[postrun] Sign-in link for ${to} (RESEND_API_KEY is not set, so it was not emailed):\n${url}\n`);
    return;
  }
  const { error } = await new Resend(key).emails.send({
    from: FROM(),
    to,
    subject: "Sign in to Postrun",
    html: signInHtml(url, to, details),
    text: signInText(url, to, details),
    attachments: [{ filename: "postrun.png", content: Buffer.from(EMAIL_LOGO_PNG_BASE64, "base64"), contentId: "postrun-logo" }],
    // A unique id stops Gmail from folding repeated sign-in emails into one thread.
    headers: { "X-Entity-Ref-ID": randomUUID() },
  });
  if (error) throw new Error(`Resend refused the sign-in email: ${error.message}`);
}

/** "Chrome on macOS" from a User-Agent header. Rough on purpose: it is a hint for a person, not a fingerprint. */
export function describeDevice(ua: string | null | undefined): string | undefined {
  if (!ua) return undefined;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : undefined;
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : undefined;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os;
}

/** City and country from the headers Vercel adds to every request. Undefined anywhere else. */
export function describeLocation(h: Headers): string | undefined {
  const dec = (v: string | null) => {
    try {
      return v ? decodeURIComponent(v) : undefined;
    } catch {
      return undefined;
    }
  };
  const city = dec(h.get("x-vercel-ip-city"));
  const country = h.get("x-vercel-ip-country") ?? undefined;
  let countryName = country;
  if (country) {
    try {
      countryName = new Intl.DisplayNames(["en"], { type: "region" }).of(country) ?? country;
    } catch {
      // keep the code
    }
  }
  return [city, countryName].filter(Boolean).join(", ") || undefined;
}

const when = (d: Date) =>
  `${d.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`;

export function signInText(url: string, to: string, d: RequestDetails = { at: new Date() }): string {
  return [
    "Sign in to Postrun",
    "",
    `Use this link to sign in as ${to}. It expires in 10 minutes and works once:`,
    "",
    url,
    "",
    "Request details",
    `  Requested: ${when(d.at)}`,
    ...(d.device ? [`  Device:    ${d.device}`] : []),
    ...(d.location ? [`  Location:  ${d.location}`] : []),
    "",
    "Didn't ask for this? You can ignore this email. Someone may have typed your address by mistake, and nobody can sign in without the link.",
    "",
    "Postrun, the flight recorder for coding agents",
    "https://postrun.app",
  ].join("\n");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

export function signInHtml(url: string, to: string, d: RequestDetails = { at: new Date() }): string {
  const u = esc(url);
  const rows: Array<[string, string]> = [["Requested", when(d.at)]];
  if (d.device) rows.push(["Device", d.device]);
  if (d.location) rows.push(["Location", d.location]);
  const detailRows = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:3px 0;width:92px;font:13px/20px ${FONT};color:#6b6f76;vertical-align:top;" class="muted">${k}</td><td style="padding:3px 0;font:13px/20px ${FONT};color:#1f2328;" class="text">${esc(v)}</td></tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="x-ua-compatible" content="ie=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>Sign in to Postrun</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
  body { margin:0; padding:0; width:100% !important; -webkit-text-size-adjust:100%; }
  a { color:#c2410c; }
  @media (max-width:520px) {
    .card { padding:28px 22px !important; }
    .h1 { font-size:21px !important; line-height:28px !important; }
  }
  @media (prefers-color-scheme: dark) {
    .bg { background:#0b0c0f !important; }
    .card { background:#14161b !important; border-color:#262a33 !important; }
    .text, .h1, .brand { color:#eceef3 !important; }
    .muted { color:#9aa0ad !important; }
    .rule { border-color:#262a33 !important; }
    .box { background:#0f1115 !important; border-color:#262a33 !important; }
    .btn-cell { background:#ece9e3 !important; }
    .btn-link { color:#0b0c0f !important; }
    .url { color:#ffb38a !important; }
  }
</style>
</head>
<body class="bg" style="margin:0;padding:0;background:#f4f4f2;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:#f4f4f2;">Your link to sign in to Postrun. It expires in 10 minutes.&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<table role="presentation" class="bg" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f2;">
<tr><td align="center" style="padding:40px 16px 32px;">
  <!--[if mso]><table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">

    <tr><td style="padding:0 4px 24px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="vertical-align:middle;"><img src="cid:postrun-logo" width="32" height="32" alt="" style="display:block;border:0;border-radius:8px;"></td>
        <td class="brand" style="vertical-align:middle;padding-left:10px;font:700 18px/32px ${FONT};letter-spacing:-0.3px;color:#111317;">postrun</td>
      </tr></table>
    </td></tr>

    <tr><td class="card" style="background:#ffffff;border:1px solid #e4e4e0;border-radius:12px;padding:36px 36px 32px;">
      <h1 class="h1" style="margin:0 0 12px;font:600 22px/30px ${FONT};letter-spacing:-0.3px;color:#111317;">Sign in to Postrun</h1>
      <p class="text" style="margin:0 0 28px;font:15px/24px ${FONT};color:#3d4148;">Click the button below to sign in as <strong style="color:#111317;" class="text">${esc(to)}</strong>. This link expires in 10 minutes and can only be used once.</p>

      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td class="btn-cell" style="border-radius:8px;background:#111317;">
        <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${u}" style="height:44px;v-text-anchor:middle;width:220px;" arcsize="18%" stroke="f" fillcolor="#111317"><w:anchorlock/><center style="color:#ffffff;font-family:Segoe UI,Arial,sans-serif;font-size:15px;font-weight:600;">Sign in to Postrun</center></v:roundrect><![endif]-->
        <!--[if !mso]><!--><a class="btn-link" href="${u}" target="_blank" style="display:inline-block;padding:12px 24px;font:600 15px/20px ${FONT};color:#ffffff;text-decoration:none;border-radius:8px;">Sign in to Postrun</a><!--<![endif]-->
      </td></tr></table>

      <p class="muted" style="margin:28px 0 6px;font:13px/20px ${FONT};color:#6b6f76;">Or copy and paste this link into your browser:</p>
      <p style="margin:0;font:12px/18px ${MONO};word-break:break-all;"><a class="url" href="${u}" target="_blank" style="color:#c2410c;text-decoration:none;">${u}</a></p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;">
        <tr><td class="box" style="background:#f8f8f6;border:1px solid #ecece8;border-radius:8px;padding:14px 16px;">
          <p class="text" style="margin:0 0 6px;font:600 13px/20px ${FONT};color:#1f2328;">Request details</p>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">${detailRows}</table>
        </td></tr>
      </table>

      <p class="muted rule" style="margin:24px 0 0;padding-top:20px;border-top:1px solid #ecece8;font:13px/20px ${FONT};color:#6b6f76;">
        Didn't ask for this? You can safely ignore this email. Someone may have typed your address by mistake, and nobody can sign in without this link.
      </p>
    </td></tr>

    <tr><td align="center" style="padding:24px 16px 0;">
      <p class="muted" style="margin:0 0 6px;font:12px/18px ${FONT};color:#8a8f98;">Postrun, the flight recorder for coding agents</p>
      <p class="muted" style="margin:0;font:12px/18px ${FONT};color:#8a8f98;">
        <a href="https://postrun.app" target="_blank" style="color:#8a8f98;text-decoration:underline;">postrun.app</a>
        &nbsp;·&nbsp;
        <a href="https://docs.postrun.app" target="_blank" style="color:#8a8f98;text-decoration:underline;">Docs</a>
        &nbsp;·&nbsp;
        <a href="https://postrun.app/privacy/" target="_blank" style="color:#8a8f98;text-decoration:underline;">Privacy</a>
      </p>
      <p class="muted" style="margin:10px 0 0;font:11px/16px ${FONT};color:#a0a4ab;">You received this because a sign-in was requested for this address at app.postrun.app.</p>
    </td></tr>

  </table>
  <!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

/** What a feedback alert needs to show. */
export interface FeedbackAlert {
  id: string;
  rating: number | null;
  message: string | null;
  email: string | null;
  account_email: string | null;
  source: string;
  version: string | null;
  platform: string | null;
  usage: string | null;
}

const SOURCE_LABEL: Record<string, string> = { "review-app": "the review app", cli: "postrun feedback", app: "app.postrun.app" };

/** One email to the admins for each piece of feedback. Replying goes to the person, when they left an address. */
export async function sendFeedbackAlert(to: string[], f: FeedbackAlert, adminUrl: string): Promise<void> {
  const key = optionalEnv("RESEND_API_KEY");
  if (!key || to.length === 0) {
    if (!isProduction()) console.log(`\n[postrun] Feedback ${f.id}: ${f.rating ?? "-"}/5 ${f.message ?? ""}\n`);
    return;
  }
  const from = f.email ?? f.account_email;
  const stars = f.rating ? `${"★".repeat(f.rating)}${"☆".repeat(5 - f.rating)} (${f.rating}/5)` : "No rating";
  const meta = [`From ${SOURCE_LABEL[f.source] ?? f.source}`, f.version ? `Postrun ${f.version}` : "", f.platform ?? "", from ?? "No email left"].filter(Boolean).join(" · ");
  const subject = `Postrun feedback: ${f.rating ? `${f.rating}/5` : "no rating"}${f.message ? `, "${f.message.slice(0, 60)}${f.message.length > 60 ? "…" : ""}"` : ""}`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f2;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f2;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
<tr><td style="padding:0 4px 18px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="vertical-align:middle;"><img src="cid:postrun-logo" width="28" height="28" alt="" style="display:block;border:0;border-radius:7px;"></td>
<td style="vertical-align:middle;padding-left:10px;font:700 16px/28px ${FONT};color:#111317;">postrun <span style="font-weight:500;color:#6b6f76;">feedback</span></td>
</tr></table></td></tr>
<tr><td style="background:#ffffff;border:1px solid #e4e4e0;border-radius:12px;padding:28px;">
<p style="margin:0 0 6px;font:600 20px/28px ${FONT};color:#c2410c;letter-spacing:1px;">${esc(stars)}</p>
<p style="margin:0 0 18px;font:13px/20px ${FONT};color:#6b6f76;">${esc(meta)}</p>
${f.message ? `<p style="margin:0 0 18px;padding:14px 16px;background:#f8f8f6;border:1px solid #ecece8;border-radius:8px;font:15px/24px ${FONT};color:#1f2328;white-space:pre-wrap;">${esc(f.message)}</p>` : ""}
${f.usage ? `<p style="margin:0 0 6px;font:600 13px/20px ${FONT};color:#1f2328;">Usage summary they attached</p><pre style="margin:0 0 18px;padding:12px 14px;background:#f8f8f6;border:1px solid #ecece8;border-radius:8px;font:12px/18px ${MONO};color:#3d4148;white-space:pre-wrap;">${esc(f.usage)}</pre>` : ""}
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-radius:8px;background:#111317;"><a href="${esc(adminUrl)}" style="display:inline-block;padding:10px 18px;font:600 14px/20px ${FONT};color:#ffffff;text-decoration:none;">Open in admin</a></td></tr></table>
${from ? `<p style="margin:16px 0 0;font:13px/20px ${FONT};color:#6b6f76;">Reply to this email to answer ${esc(from)}.</p>` : ""}
</td></tr></table></td></tr></table></body></html>`;
  const text = [stars, meta, "", f.message ?? "(no message)", ...(f.usage ? ["", "Usage summary:", f.usage] : []), "", `Admin: ${adminUrl}`].join("\n");
  const { error } = await new Resend(key).emails.send({
    from: optionalEnv("EMAIL_FROM")?.replace(/<[^>]+>/, "<feedback@postrun.app>") ?? "Postrun <feedback@postrun.app>",
    to,
    subject,
    html,
    text,
    ...(from ? { replyTo: from } : {}),
    attachments: [{ filename: "postrun.png", content: Buffer.from(EMAIL_LOGO_PNG_BASE64, "base64"), contentId: "postrun-logo" }],
    headers: { "X-Entity-Ref-ID": randomUUID() },
  });
  if (error) throw new Error(`Resend refused the feedback alert: ${error.message}`);
}
