/**
 * The sign-in email, sent through Resend from the verified postrun.app domain.
 * Without RESEND_API_KEY (on your own machine) the link is printed in the
 * terminal running `pnpm dev` instead, so sign-in can be tested offline.
 */

import { Resend } from "resend";
import { isProduction, optionalEnv } from "./env";

const FROM = () => optionalEnv("EMAIL_FROM") ?? "Postrun <login@postrun.app>";

export async function sendSignInEmail(to: string, url: string): Promise<void> {
  const key = optionalEnv("RESEND_API_KEY");
  if (!key) {
    if (isProduction()) throw new Error("RESEND_API_KEY is not set, so the sign-in email cannot be sent.");
    console.log(`\n[postrun] Sign-in link for ${to} (RESEND_API_KEY is not set, so it was not emailed):\n${url}\n`);
    return;
  }
  const { error } = await new Resend(key).emails.send({
    from: FROM(),
    to,
    subject: "Your Postrun sign-in link",
    html: signInHtml(url),
    text: signInText(url),
  });
  if (error) throw new Error(`Resend refused the sign-in email: ${error.message}`);
}

export function signInText(url: string): string {
  return [
    "Sign in to Postrun",
    "",
    "Open this link to sign in. It works once and expires in 10 minutes:",
    url,
    "",
    "If you didn't ask to sign in, ignore this email. Nobody can sign in without the link.",
  ].join("\n");
}

const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Table layout and inline styles: what email clients still render reliably. */
export function signInHtml(url: string): string {
  const u = attr(url);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>Sign in to Postrun</title></head>
<body style="margin:0;padding:0;background:#08090c;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#08090c;padding:40px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#0d0f14;border:1px solid #23262f;border-radius:14px;">
<tr><td style="padding:32px 32px 8px;font:700 18px -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#eceef3;letter-spacing:-0.02em;">
<span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:#ff6a1a;margin-right:8px;vertical-align:middle;"></span>postrun
</td></tr>
<tr><td style="padding:16px 32px 0;font:600 22px -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#eceef3;">Sign in to Postrun</td></tr>
<tr><td style="padding:10px 32px 0;font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#a3a9b7;">Click the button to sign in. The link works once and expires in 10 minutes.</td></tr>
<tr><td style="padding:24px 32px 8px;">
<a href="${u}" style="display:inline-block;background:#ece9e3;color:#0b0c0f;font:600 15px -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;text-decoration:none;padding:13px 22px;border-radius:10px;">Sign in to Postrun</a>
</td></tr>
<tr><td style="padding:16px 32px 0;font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#7d8496;">Or paste this address into your browser:<br><a href="${u}" style="color:#ffb38a;word-break:break-all;">${u}</a></td></tr>
<tr><td style="padding:24px 32px 32px;font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#7d8496;border-top:1px solid #1b1e26;">If you didn't ask to sign in, ignore this email. Nobody can sign in without the link.</td></tr>
</table>
</td></tr></table>
</body></html>`;
}
