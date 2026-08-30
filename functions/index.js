const crypto = require("crypto");
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const authMailLib = require("./auth-mail");

if (!admin.apps.length) {
  admin.initializeApp();
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replace(/\s+/g, " ");
}

function sha256(value) {
  return crypto.createHash("sha256").update(normalizeText(value), "utf8").digest("hex");
}

function oneTimePassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$";
  let out = "";
  for (let i = 0; i < 12; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function utcDayKey(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

function cors(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
}

function normalizeContentId(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 120);
}

function minuteBucket(ts) {
  return Math.floor(Number(ts || 0) / 60000);
}

async function verifyRequestUser(req) {
  const authHeader = String(req.get("authorization") || req.get("Authorization") || "");
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1]) throw new Error("unauthorized");
  const decoded = await admin.auth().verifyIdToken(match[1]);
  if (!decoded || !decoded.uid) throw new Error("unauthorized");
  return decoded;
}

function readExpiryAt(profile) {
  const p = profile || {};
  const sub = p.subscription || {};
  const candidates = [sub.nextBillingAt, sub.renewAt, sub.expiresAt, sub.plusUntil, p.renewAt, p.expiresAt, p.plusUntil];
  for (let i = 0; i < candidates.length; i++) {
    const n = Number(candidates[i]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

exports.accountRecovery = onRequest({ region: "europe-west1" }, async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, message: "Yalnızca POST desteklenir." });
    return;
  }
  const action = String((req.body && req.body.action) || "");
  const email = String((req.body && req.body.email) || "").trim();
  if (!email) {
    res.status(400).json({ ok: false, message: "E-posta gerekli." });
    return;
  }

  try {
    const user = await admin.auth().getUserByEmail(email);
    const uid = user.uid;
    const recoverySnap = await admin.database().ref("users/" + uid + "/recovery").once("value");
    const recovery = recoverySnap.val() || {};

    if (action === "recover") {
      const answer = String((req.body && req.body.answer) || "");
      const question = String((req.body && req.body.question) || "").trim();
      if (!recovery.question || !recovery.answerHash) {
        res.status(404).json({ ok: false, message: "Bu hesap için gizli soru tanımlı değil." });
        return;
      }
      if (!question) {
        res.status(400).json({ ok: false, message: "Gizli soru gerekli." });
        return;
      }
      if (!answer) {
        res.status(400).json({ ok: false, message: "Gizli soru cevabı gerekli." });
        return;
      }
      if (question !== String(recovery.question || "")) {
        res.status(403).json({ ok: false, message: "Gizli soru doğrulanamadı." });
        return;
      }
      const incomingHash = sha256(answer);
      if (incomingHash !== String(recovery.answerHash || "")) {
        res.status(403).json({ ok: false, message: "Gizli soru cevabı hatalı." });
        return;
      }
      const now = Date.now();
      const today = utcDayKey(now);
      const savedDay = String(recovery.dailyIssueDate || "");
      const savedCount = Number(recovery.dailyIssueCount || 0);
      const todayCount = savedDay === today ? savedCount : 0;
      if (todayCount >= 2) {
        res
          .status(429)
          .json({ ok: false, message: "Bugün en fazla 2 kez tek kullanımlık şifre üretebilirsiniz. Lütfen yarın tekrar deneyin." });
        return;
      }
      const tempPassword = oneTimePassword();
      await admin.auth().updateUser(uid, { password: tempPassword });
      await admin
        .database()
        .ref("users/" + uid + "/recovery")
        .update({
          mustChangePassword: true,
          lastTempIssuedAt: Date.now(),
          dailyIssueDate: today,
          dailyIssueCount: todayCount + 1,
          updatedAt: Date.now()
        });
      res.json({ ok: true, tempPassword });
      return;
    }

    res.status(400).json({ ok: false, message: "Geçersiz işlem." });
  } catch (err) {
    const code = String((err && err.code) || "");
    if (code === "auth/user-not-found") {
      res.status(404).json({ ok: false, message: "Bu e-posta ile kayıtlı kullanıcı bulunamadı." });
      return;
    }
    res.status(500).json({ ok: false, message: "İşlem sırasında hata oluştu." });
  }
});

exports.myListToggle = onRequest({ region: "europe-west1" }, async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, message: "Yalnızca POST desteklenir." });
    return;
  }

  try {
    const authUser = await verifyRequestUser(req);
    const uid = authUser.uid;
    const contentId = normalizeContentId(req.body && req.body.contentId);
    if (!contentId) {
      res.status(400).json({ ok: false, message: "Geçersiz içerik kimliği." });
      return;
    }

    const [profileSnap, adminSnap, ownerSnap] = await Promise.all([
      admin.database().ref("users/" + uid).once("value"),
      admin.database().ref("admins/" + uid).once("value"),
      admin.database().ref("settings/ownerEmail").once("value")
    ]);

    const profile = profileSnap.val() || {};
    const email = String(authUser.email || "").toLowerCase();
    const ownerEmail = String(ownerSnap.val() || "").toLowerCase();
    const isAdmin = adminSnap.val() === true || !!(email && ownerEmail && email === ownerEmail);
    const proFlag = profile.isPro === true || profile.isPro === 1 || profile.isPro === "1";
    const sub = profile.subscription || {};
    const expiryCandidates = [sub.nextBillingAt, sub.renewAt, sub.expiresAt, sub.plusUntil, profile.renewAt, profile.expiresAt, profile.plusUntil];
    let expiryAt = 0;
    for (let i = 0; i < expiryCandidates.length; i++) {
      const n = Number(expiryCandidates[i]);
      if (Number.isFinite(n) && n > 0) {
        expiryAt = n;
        break;
      }
    }
    const isProActive = proFlag && !(expiryAt && Date.now() > expiryAt);
    if (!isAdmin && !isProActive) {
      res.status(403).json({ ok: false, message: "Bu özellik +PLUS üyeliklerde açılır." });
      return;
    }

    const now = Date.now();
    const bucket = String(minuteBucket(now));
    const rateRef = admin.database().ref("rateLimits/myList/" + uid + "/" + bucket);
    const MAX_TOGGLES_PER_MINUTE = 30;

    const rateTx = await rateRef.transaction((cur) => {
      const oldCount = Number(cur && cur.count ? cur.count : 0);
      if (oldCount >= MAX_TOGGLES_PER_MINUTE) return;
      return { count: oldCount + 1, updatedAt: now };
    });
    if (!rateTx.committed) {
      res.status(429).json({ ok: false, message: "Çok hızlı işlem yapıldı. Lütfen birkaç saniye bekleyin." });
      return;
    }

    const myListRef = admin.database().ref("users/" + uid + "/myList/" + contentId);
    const currentSnap = await myListRef.once("value");
    const exists = currentSnap.val() === true;
    if (exists) await myListRef.remove();
    else await myListRef.set(true);

    res.json({
      ok: true,
      added: !exists,
      contentId
    });
  } catch (err) {
    const msg = String(err && err.message ? err.message : "");
    if (msg === "unauthorized") {
      res.status(401).json({ ok: false, message: "Yetkisiz istek." });
      return;
    }
    res.status(500).json({ ok: false, message: "İşlem sırasında hata oluştu." });
  }
});

exports.promoFreeMonth = onRequest({ region: "europe-west1" }, async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, message: "Yalnızca POST desteklenir." });
    return;
  }

  try {
    const authUser = await verifyRequestUser(req);
    const uid = authUser.uid;
    const promo = String((req.body && req.body.promo) || "").trim() || "launch_free_1m";
    if (promo !== "launch_free_1m") {
      res.status(400).json({ ok: false, message: "Geçersiz kampanya." });
      return;
    }

    const userRef = admin.database().ref("users/" + uid);
    const snap = await userRef.once("value");
    const profile = snap.val() || {};

    // 1 hesap 1 kez kuralı
    const alreadyUsed =
      !!(profile.promo && profile.promo.launchFreeMonthUsedAt) ||
      (profile.subscription && String(profile.subscription.provider || "").toLowerCase() === "promo_launch_free") ||
      (profile.subscription && String(profile.subscription.plan || "").toLowerCase() === "promo_1m_free");
    if (alreadyUsed) {
      res.status(409).json({ ok: false, message: "Bu ücretsiz açılış kampanyasını bu hesap daha önce kullandı." });
      return;
    }

    // Aktif +PLUS varken üstüne ekletmeyelim (kullanıcıya net kural)
    const proFlag = profile.isPro === true || profile.isPro === 1 || profile.isPro === "1";
    const expiryAt = readExpiryAt(profile);
    const isProActive = proFlag && !(expiryAt && Date.now() > expiryAt);
    if (isProActive) {
      res.status(409).json({ ok: false, message: "Hesabınızda zaten aktif +PLUS var. Ücretsiz kampanya yalnızca 1 kez kullanılabilir." });
      return;
    }

    const now = Date.now();
    const durationMs = 30 * 24 * 60 * 60 * 1000; // 1 ay ~ 30 gün
    const expiresAt = now + durationMs;

    await userRef.update({
      isPro: true,
      plusUntil: expiresAt,
      subscription: {
        provider: "promo_launch_free",
        status: "active",
        plan: "promo_1m_free",
        months: 1,
        startedAt: now,
        expiresAt,
        renewAt: expiresAt,
        lastPaymentAt: null,
        lastPaymentId: null,
        updatedAt: now
      },
      promo: {
        ...(profile.promo || {}),
        launchFreeMonthUsedAt: now
      }
    });

    res.status(200).json({ ok: true, uid, expiresAt });
  } catch (err) {
    const msg = String(err && err.message ? err.message : "");
    if (msg === "unauthorized") {
      res.status(401).json({ ok: false, message: "Yetkisiz istek." });
      return;
    }
    res.status(500).json({ ok: false, message: "Kampanya aktivasyonu başarısız." });
  }
});

function shopierSecretOk(req) {
  const expected = String(process.env.SHOPIER_WEBHOOK_SECRET || "").trim();
  if (!expected) return true;
  const incoming =
    String(req.get("x-shopier-secret") || "").trim() ||
    String((req.query && req.query.secret) || "").trim() ||
    String((req.body && req.body.secret) || "").trim();
  return incoming && incoming === expected;
}

function timingSafeStringEq(a, b) {
  const sa = String(a || "");
  const sb = String(b || "");
  if (!sa || !sb) return false;
  const ba = Buffer.from(sa, "utf8");
  const bb = Buffer.from(sb, "utf8");
  if (ba.length !== bb.length) return false;
  try {
    return crypto.timingSafeEqual(ba, bb);
  } catch (_e) {
    return false;
  }
}

function shopierHashOk(req) {
  const secret = String(process.env.SHOPIER_WEBHOOK_HASH_SECRET || "").trim();
  if (!secret) return true;

  const incomingHash =
    String(req.get("x-shopier-hash") || "").trim() ||
    String(req.get("x-shopier-signature") || "").trim() ||
    String((req.body && req.body.hash) || "").trim() ||
    String((req.body && req.body.signature) || "").trim();
  if (!incomingHash) return false;

  const raw = req.rawBody ? req.rawBody.toString("utf8") : JSON.stringify(req.body || {});
  const hmacSha256Hex = crypto.createHmac("sha256", secret).update(raw, "utf8").digest("hex");
  const hmacSha256Base64 = crypto.createHmac("sha256", secret).update(raw, "utf8").digest("base64");

  return timingSafeStringEq(incomingHash, hmacSha256Hex) || timingSafeStringEq(incomingHash, hmacSha256Base64);
}

function resolveShopierPlanMonths(planKey, rawMonths) {
  const n = Number(rawMonths || 0);
  if (Number.isFinite(n) && n > 0) return n;
  const p = String(planKey || "").toLowerCase();
  if (p === "plus_1m") return 1;
  if (p === "plus_2m") return 2;
  if (p === "plus_3m") return 3;
  return 1;
}

function shopierPaid(body) {
  const b = body || {};
  const values = [
    b.status,
    b.payment_status,
    b.paymentStatus,
    b.order_status,
    b.orderStatus,
    b.success,
    b.is_success,
    b.isSuccess,
    b.paid
  ]
    .map((x) => String(x || "").toLowerCase().trim())
    .filter(Boolean);
  return values.some((v) => ["paid", "success", "successful", "approved", "completed", "ok", "1", "true"].includes(v));
}

async function activateShopierMembership(uid, planKey, months, paymentId, rawData) {
  if (!uid) return;
  const now = Date.now();
  const durationMs = Math.max(1, Number(months || 1)) * 30 * 24 * 60 * 60 * 1000;
  const userRef = admin.database().ref("users/" + uid);
  const currentSnap = await userRef.once("value");
  const current = currentSnap.val() || {};
  const currentSub = current.subscription || {};
  const currentExpiryCandidates = [currentSub.expiresAt, currentSub.renewAt, current.expiresAt, current.plusUntil];
  let currentExpiry = 0;
  for (let i = 0; i < currentExpiryCandidates.length; i++) {
    const n = Number(currentExpiryCandidates[i]);
    if (Number.isFinite(n) && n > 0) {
      currentExpiry = n;
      break;
    }
  }
  const startAt = currentExpiry > now ? currentExpiry : now;
  const expiresAt = startAt + durationMs;
  await userRef.update({
    isPro: true,
    plusUntil: expiresAt,
    subscription: {
      provider: "shopier",
      status: "active",
      plan: String(planKey || "plus_1m"),
      months: Math.max(1, Number(months || 1)),
      startedAt: startAt,
      expiresAt,
      renewAt: expiresAt,
      lastPaymentAt: now,
      lastPaymentId: String(paymentId || ""),
      lastWebhookPayloadAt: now,
      updatedAt: now,
      raw: rawData || null
    }
  });
}

async function findUidByEmail(email) {
  const e = String(email || "").trim();
  if (!e) return "";
  try {
    const u = await admin.auth().getUserByEmail(e);
    return u && u.uid ? String(u.uid) : "";
  } catch (_e) {
    return "";
  }
}

exports.shopierWebhook = onRequest({ region: "europe-west1" }, async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method === "GET") {
    res.status(200).send("ok");
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, message: "Yalnızca POST desteklenir." });
    return;
  }
  if (!shopierSecretOk(req)) {
    res.status(401).json({ ok: false, message: "Webhook gizli anahtarı doğrulanamadı." });
    return;
  }
  if (!shopierHashOk(req)) {
    res.status(401).json({ ok: false, message: "Webhook hash doğrulaması başarısız." });
    return;
  }

  try {
    const body = req.body || {};
    if (!shopierPaid(body)) {
      res.status(200).json({ ok: true, ignored: "payment_not_completed" });
      return;
    }

    const planKey = String(body.plan || body.planKey || body.package || body.product || "plus_1m").trim();
    const months = resolveShopierPlanMonths(planKey, body.months || body.durationMonths);
    const paymentId = String(body.payment_id || body.paymentId || body.order_id || body.orderId || "").trim();
    let uid = String(body.uid || body.user_uid || body.firebase_uid || "").trim();
    if (!uid) {
      const email = String(body.email || body.buyer_email || body.customer_email || "").trim();
      uid = await findUidByEmail(email);
    }
    if (!uid) {
      res.status(400).json({ ok: false, message: "Kullanıcı kimliği çözümlenemedi." });
      return;
    }

    await activateShopierMembership(uid, planKey, months, paymentId, {
      provider: "shopier",
      orderId: paymentId || null
    });

    res.status(200).json({ ok: true, uid, planKey, months });
  } catch (_e) {
    res.status(500).json({ ok: false, message: "Shopier webhook işlenemedi." });
  }
});

exports.authMail = onRequest({ region: "europe-west1" }, async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method === "GET") {
    res.status(200).json({ ok: true, service: "dehliz-auth-mail" });
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "method" });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body || "{}");
    } catch (_e) {
      res.status(400).json({ error: "json" });
      return;
    }
  }
  body = body || {};
  const kind = body.type === "reset" ? "reset" : body.type === "consume" ? "consume" : "verify";

  try {
    if (kind === "consume") {
      let payload;
      try {
        payload = authMailLib.readLink(body.token);
      } catch (err) {
        const code = String(err && err.message) === "expired" ? "expired" : "token";
        res.status(code === "expired" ? 410 : 400).json({ error: code });
        return;
      }
      const uid = await findUidByEmail(payload.em);
      if (!uid) {
        res.status(400).json({ error: "token" });
        return;
      }
      if (payload.typ === "reset" && !body.password) {
        res.status(200).json({ ok: true, needPassword: true, email: payload.em });
        return;
      }
      if (payload.typ === "reset") {
        const password = String(body.password || "");
        if (password.length < 6 || !/(?=.*[A-Za-z])(?=.*\d)/.test(password)) {
          res.status(400).json({ error: "password" });
          return;
        }
        await admin.auth().updateUser(uid, { password, emailVerified: true });
        res.status(200).json({ ok: true, mode: "resetPassword", email: payload.em });
        return;
      }
      await admin.auth().updateUser(uid, { emailVerified: true });
      res.status(200).json({ ok: true, mode: "verifyEmail", email: payload.em });
      return;
    }

    if (kind === "verify") {
      const authHeader = String(req.get("authorization") || req.get("Authorization") || "");
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      const idToken = (match && match[1]) || String(body.idToken || "");
      if (!idToken) {
        res.status(401).json({ error: "auth" });
        return;
      }
      const decoded = await admin.auth().verifyIdToken(idToken);
      const email = String((decoded && decoded.email) || "").trim().toLowerCase();
      if (!email) {
        res.status(401).json({ error: "auth" });
        return;
      }
      const token = authMailLib.signLink("verify", email);
      await authMailLib.sendResend(email, "verify", authMailLib.toActionLink(token));
      res.status(200).json({ ok: true });
      return;
    }

    const email = String(body.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: "email" });
      return;
    }
    const uid = await findUidByEmail(email);
    if (uid) {
      const token = authMailLib.signLink("reset", email);
      await authMailLib.sendResend(email, "reset", authMailLib.toActionLink(token));
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    const msg = String((err && err.message) || "");
    if (msg === "resend_config" || msg === "resend") {
      res.status(500).json({ error: "mail" });
      return;
    }
    res.status(502).json({ error: "send" });
  }
});
