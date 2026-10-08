import nodemailer from "nodemailer";
import { config } from "../config.js";
import { escHtml } from "../security.js";

let transport;
function getTransport() {
  if (transport) return transport;
  const m = config.mail;
  transport = m.host
    ? nodemailer.createTransport({
        host: m.host, port: m.port, secure: m.secure,
        auth: m.user ? { user: m.user, pass: m.pass } : undefined,
      })
    : null;
  if (!transport && config.isProd) console.warn("[mail] SMTP_HOST not set: e-mails will only be logged, not sent.");
  return transport;
}

/** Fire-and-forget safe: never throws into request handlers. */
export async function sendMail({ to, subject, html, text }) {
  if (!to) return;
  const t = getTransport();
  if (!t) {
    // Development fallback: show what would have been sent (links included) in the server console.
    if (!config.isProd) console.log(`[mail:dev] to=${to} subject="${subject}"\n${text || ""}`);
    return;
  }
  try {
    await t.sendMail({ from: config.mail.from, to, subject, html, text });
  } catch (e) {
    console.error("[mail] failed:", e.message);
  }
}

/** Brand-styled wrapper used by every e-mail. `body` must already be HTML-escaped. */
export function layout(title, body) {
  return `<!doctype html><html><body style="margin:0;background:#0e1d17;font-family:Helvetica,Arial,sans-serif;color:#c9a66e">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#183028;border:1px solid #3a4a3f">
<tr><td style="padding:28px 32px;border-bottom:1px solid #3a4a3f;font-size:13px;letter-spacing:.2em;text-transform:uppercase">Fatima Alfahad Jewelry</td></tr>
<tr><td style="padding:32px"><h1 style="margin:0 0 18px;font-weight:300;font-size:26px;color:#f2d48e">${escHtml(title)}</h1>${body}</td></tr>
</table></td></tr></table></body></html>`;
}
export const p = (s) => `<p style="margin:0 0 14px;line-height:1.7;font-size:15px;color:#c9a66e">${s}</p>`;
