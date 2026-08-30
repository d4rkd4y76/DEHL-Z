/**
 * DEHLİZ branded auth mail — Cloudflare Worker
 * Secrets: RESEND_API_KEY, GOOGLE_SA_JSON
 * Optional binding: FIREBASE_WEB_API_KEY
 *
 * Deploy:
 *   npx wrangler secret put RESEND_API_KEY
 *   npx wrangler secret put GOOGLE_SA_JSON
 *   npx wrangler deploy
 */
const HERO = "https://www.dehliz.tv/mail/assets/dehliz-mail-hero.jpg";
const ACTION = "https://www.dehliz.tv/auth-action.html";
const VERIFY_TTL = 7 * 24 * 3600;
const RESET_TTL = 3 * 24 * 3600;
const PROJECT = "dehliz-a95cd";
const FROM = "DEHLİZ ekibi <noreply@dehliz.tv>";
const SITE = "dehliz.tv";

let cachedToken = { value: "", exp: 0 };

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

function toActionLink(token) {
  return ACTION + "?t=" + encodeURIComponent(token);
}

function b64urlDecode(s) {
  let t = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  return decodeURIComponent(escape(atob(t)));
}

function corsHeaders(origin) {
  const allow = origin || "*";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}

function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) }
  });
}

function pemToBuffer(pem) {
  const b64 = String(pem)
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function b64url(buf) {
  let s = btoa(String.fromCharCode(...new Uint8Array(buf)));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlStr(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function googleAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken.value && cachedToken.exp > now + 60) return cachedToken.value;
  const header = b64urlStr(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64urlStr(
    JSON.stringify({
      iss: sa.client_email,
      sub: sa.client_email,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
      scope:
        "https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/firebase https://www.googleapis.com/auth/cloud-platform"
    })
  );
  const unsigned = header + "." + claim;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToBuffer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned)
  );
  const assertion = unsigned + "." + b64url(sig);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:
      "grant_type=" +
      encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") +
      "&assertion=" +
      encodeURIComponent(assertion)
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("google_token");
  cachedToken = { value: data.access_token, exp: now + 3300 };
  return data.access_token;
}

async function lookupEmail(idToken, access) {
  const res = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + access,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ idToken })
  });
  const data = await res.json();
  const user = (data.users && data.users[0]) || null;
  return user && user.email ? String(user.email) : "";
}

async function linkHmacKey(sa) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode("dehliz-link-v1:" + sa.private_key)
  );
  return crypto.subtle.importKey("raw", digest, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify"
  ]);
}

async function signLink(sa, typ, email) {
  const now = Math.floor(Date.now() / 1000);
  const ttl = typ === "reset" ? RESET_TTL : VERIFY_TTL;
  const body = b64urlStr(
    JSON.stringify({
      v: 1,
      typ,
      em: String(email || "").trim().toLowerCase(),
      iat: now,
      exp: now + ttl
    })
  );
  const key = await linkHmacKey(sa);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return body + "." + b64url(sig);
}

async function readLink(sa, token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2) throw new Error("token");
  const key = await linkHmacKey(sa);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(parts[0]));
  if (b64url(sig) !== parts[1]) throw new Error("token");
  const payload = JSON.parse(b64urlDecode(parts[0]));
  const now = Math.floor(Date.now() / 1000);
  if (!payload || payload.exp < now) throw new Error("expired");
  if (payload.typ !== "verify" && payload.typ !== "reset") throw new Error("token");
  if (!payload.em) throw new Error("token");
  return payload;
}

async function uidByEmail(access, email) {
  const res = await fetch(
    "https://identitytoolkit.googleapis.com/v1/projects/" + PROJECT + "/accounts:lookup",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + access,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ email: [email] })
    }
  );
  const data = await res.json();
  const user = (data.users && data.users[0]) || null;
  return user && user.localId ? String(user.localId) : "";
}

async function adminUpdate(access, patch) {
  const res = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:update", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + access,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(patch)
  });
  if (!res.ok) throw new Error("update");
}

async function sendResend(apiKey, to, type, link) {
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
  if (!res.ok) throw new Error("resend");
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin) });
    }
    if (request.method === "GET") {
      return json({ ok: true, service: "dehliz-auth-mail" }, 200, origin);
    }
    if (request.method !== "POST") return json({ error: "method" }, 405, origin);
    let body;
    try {
      body = JSON.parse(await request.text());
    } catch (_) {
      return json({ error: "json" }, 400, origin);
    }
    const kind = body.type === "reset" ? "reset" : body.type === "consume" ? "consume" : "verify";
    if (!env.RESEND_API_KEY || !env.GOOGLE_SA_JSON) {
      return json({ error: "mail" }, 500, origin);
    }
    let sa;
    try {
      sa = JSON.parse(env.GOOGLE_SA_JSON);
    } catch (_) {
      return json({ error: "mail" }, 500, origin);
    }
    try {
      const access = await googleAccessToken(sa);
      if (kind === "consume") {
        let payload;
        try {
          payload = await readLink(sa, body.token);
        } catch (err) {
          const code = String(err && err.message) === "expired" ? "expired" : "token";
          return json({ error: code }, code === "expired" ? 410 : 400, origin);
        }
        const uid = await uidByEmail(access, payload.em);
        if (!uid) return json({ error: "token" }, 400, origin);
        if (payload.typ === "reset" && !body.password) {
          return json({ ok: true, needPassword: true, email: payload.em }, 200, origin);
        }
        if (payload.typ === "reset") {
          const password = String(body.password || "");
          if (password.length < 6 || !/(?=.*[A-Za-z])(?=.*\d)/.test(password)) {
            return json({ error: "password" }, 400, origin);
          }
          await adminUpdate(access, { localId: uid, password: password, emailVerified: true });
          return json({ ok: true, mode: "resetPassword", email: payload.em }, 200, origin);
        }
        await adminUpdate(access, { localId: uid, emailVerified: true });
        return json({ ok: true, mode: "verifyEmail", email: payload.em }, 200, origin);
      }
      let email = "";
      if (kind === "verify") {
        const auth = request.headers.get("Authorization") || "";
        const idToken = auth.startsWith("Bearer ") ? auth.slice(7) : String(body.idToken || "");
        email = await lookupEmail(idToken, access);
        if (!email) return json({ error: "auth" }, 401, origin);
        const token = await signLink(sa, "verify", email);
        await sendResend(env.RESEND_API_KEY, email, "verify", toActionLink(token));
        return json({ ok: true }, 200, origin);
      }
      email = String(body.email || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return json({ error: "email" }, 400, origin);
      }
      const uid = await uidByEmail(access, email);
      if (uid) {
        const token = await signLink(sa, "reset", email);
        await sendResend(env.RESEND_API_KEY, email, "reset", toActionLink(token));
      }
      return json({ ok: true }, 200, origin);
    } catch (err) {
      return json({ error: "send" }, 502, origin);
    }
  }
};
