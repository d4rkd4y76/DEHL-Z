/**
 * DEHLİZ branded auth mail helpers (Firebase Functions).
 * Env: RESEND_API_KEY, AUTH_MAIL_LINK_SECRET (optional strong random)
 */
const crypto = require("crypto");

const HERO = "https://www.dehliz.tv/mail/assets/dehliz-mail-hero.jpg";
const ACTION = "https://www.dehliz.tv/auth-action.html";
const VERIFY_TTL = 7 * 24 * 3600;
const RESET_TTL = 3 * 24 * 3600;
const FROM = "DEHLİZ ekibi <noreply@dehliz.tv>";
const SITE = "dehliz.tv";

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cardHtml(title, body, href, cta) {
  const safeHref = escapeHtml(href);
  return `<!DOCTYPE html><html lang="tr"><body style="margin:0;padding:0;background:#09090b;font-family:Segoe UI,Trebuchet MS,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#09090b;padding:28px 12px;"><tr><td align="center">
  <table role="presentation" width="440" cellpadding="0" cellspacing="0" style="max-width:440px;width:100%;background:#121214;border:1px solid #2a2a2e;border-radius:22px;overflow:hidden;">
  <tr><td><img src="${HERO}" alt="DEHLİZ" width="440" style="display:block;width:100%;height:auto;border:0;"/></td></tr>
  <tr><td style="padding:24px 24px 30px;text-align:center;color:#fafafa;">
  <p style="margin:0 0 8px;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#f87171;font-weight:800;">DEHLİZ</p>
  <h1 style="margin:0 0 10px;font-size:22px;color:#ffffff;font-weight:800;">${escapeHtml(title)}</h1>
  <p style="margin:0 0 20px;line-height:1.5;color:#d4d4d8;font-size:15px;">${escapeHtml(body)}</p>
  <a href="${safeHref}" style="display:inline-block;background:#dc2626;color:#ffffff;text-decoration:none;font-weight:800;font-size:16px;padding:13px 24px;border-radius:999px;">${escapeHtml(cta)}</a>
  <p style="margin:20px 0 0;font-size:12px;line-height:1.45;color:#71717a;">DEHLİZ ekibi · ${SITE}<br/>Türkiye’nin premium korku platformu</p>
  </td></tr></table></td></tr></table></body></html>`;
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function b64urlJson(obj) {
  return b64url(Buffer.from(JSON.stringify(obj), "utf8"));
}

function linkSecret() {
  const s = String(process.env.AUTH_MAIL_LINK_SECRET || process.env.RESEND_API_KEY || "dehliz-dev-link").trim();
  return crypto.createHash("sha256").update("dehliz-link-v1:" + s, "utf8").digest();
}

function signLink(typ, email) {
  const now = Math.floor(Date.now() / 1000);
  const ttl = typ === "reset" ? RESET_TTL : VERIFY_TTL;
  const body = b64urlJson({
    v: 1,
    typ,
    em: String(email || "").trim().toLowerCase(),
    iat: now,
    exp: now + ttl
  });
  const sig = crypto.createHmac("sha256", linkSecret()).update(body).digest();
  return body + "." + b64url(sig);
}

function readLink(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2) throw new Error("token");
  const expect = b64url(crypto.createHmac("sha256", linkSecret()).update(parts[0]).digest());
  if (expect !== parts[1]) throw new Error("token");
  const json = Buffer.from(parts[0].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  const payload = JSON.parse(json);
  const now = Math.floor(Date.now() / 1000);
  if (!payload || payload.exp < now) throw new Error("expired");
  if (payload.typ !== "verify" && payload.typ !== "reset") throw new Error("token");
  if (!payload.em) throw new Error("token");
  return payload;
}

function toActionLink(token) {
  return ACTION + "?t=" + encodeURIComponent(token);
}

async function sendResend(to, type, link) {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  if (!apiKey) throw new Error("resend_config");
  const verify = type === "verify";
  const subject = verify ? "DEHLİZ · hesabını onayla" : "DEHLİZ · şifreni sıfırla";
  const html = verify
    ? cardHtml(
        "Hesabını onayla",
        "DEHLİZ’e hoş geldin. Kırmızı düğmeye dokununca üyeliğin açılır. Bağlantı 7 gün geçerlidir. Bu e-postayı sen istemediysen yok say.",
        link,
        "Hesabımı onayla"
      )
    : cardHtml(
        "Şifreni yenile",
        "Şifre sıfırlama istedin. Kırmızı düğmeye dokununca yeni şifreni yazacaksın. Bağlantı 3 gün geçerlidir. Bu isteği sen yapmadıysan yok say.",
        link,
        "Yeni şifre yaz"
      );
  const text = verify
    ? "DEHLİZ hesabını onaylamak için: " + link + "\n\nDEHLİZ ekibi · " + SITE
    : "DEHLİZ şifreni yenilemek için: " + link + "\n\nDEHLİZ ekibi · " + SITE;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: FROM,
      to: [to],
      subject,
      html,
      text
    })
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    const err = new Error("resend");
    err.detail = errText;
    throw err;
  }
}

module.exports = {
  signLink,
  readLink,
  toActionLink,
  sendResend
};
