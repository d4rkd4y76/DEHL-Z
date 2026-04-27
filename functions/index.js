const crypto = require("crypto");
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

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
    const isPro = profile.isPro === true || profile.isPro === 1 || profile.isPro === "1";
    if (!isAdmin && !isPro) {
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

function parsePaddleSignature(headerValue) {
  const raw = String(headerValue || "");
  const parts = raw.split(";").map((x) => x.trim());
  const out = {};
  parts.forEach((p) => {
    const idx = p.indexOf("=");
    if (idx <= 0) return;
    const k = p.slice(0, idx).trim();
    const v = p.slice(idx + 1).trim();
    out[k] = v;
  });
  return out;
}

function verifyPaddleWebhook(req) {
  const secret = String(process.env.PADDLE_WEBHOOK_SECRET || "").trim();
  if (!secret) throw new Error("missing_webhook_secret");
  const sig = parsePaddleSignature(req.get("Paddle-Signature"));
  if (!sig.ts || !sig.h1) return false;
  const raw = req.rawBody ? req.rawBody.toString("utf8") : JSON.stringify(req.body || {});
  const signedPayload = sig.ts + ":" + raw;
  const hash = crypto.createHmac("sha256", secret).update(signedPayload, "utf8").digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(String(sig.h1), "hex"));
  } catch (_e) {
    return false;
  }
}

function parseMillisFromDateString(value) {
  const s = String(value || "").trim();
  if (!s) return 0;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : 0;
}

function shopierSecretOk(req) {
  const expected = String(process.env.SHOPIER_WEBHOOK_SECRET || "").trim();
  if (!expected) return true;
  const incoming =
    String(req.get("x-shopier-secret") || "").trim() ||
    String((req.query && req.query.secret) || "").trim() ||
    String((req.body && req.body.secret) || "").trim();
  return incoming && incoming === expected;
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

function readPaddleUid(eventData) {
  const data = eventData || {};
  const direct = data.custom_data && data.custom_data.firebaseUid;
  if (direct) return String(direct);
  const passthrough = data.passthrough;
  if (passthrough) {
    try {
      const parsed = typeof passthrough === "string" ? JSON.parse(passthrough) : passthrough;
      if (parsed && parsed.firebaseUid) return String(parsed.firebaseUid);
    } catch (_e) {}
  }
  return "";
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

async function applyPaddleSubscriptionState(uid, payload) {
  if (!uid) return;
  const now = Date.now();
  const sub = payload || {};
  const nextAt =
    parseMillisFromDateString(sub.next_billed_at) ||
    parseMillisFromDateString(sub.current_billing_period && sub.current_billing_period.ends_at) ||
    parseMillisFromDateString(sub.billing_cycle && sub.billing_cycle.next_billed_at) ||
    0;
  const status = String(sub.status || "").toLowerCase();
  const isActive = ["active", "trialing", "past_due"].includes(status);
  await admin
    .database()
    .ref("users/" + uid)
    .update({
      isPro: isActive,
      subscription: {
        provider: "paddle",
        status: status || "unknown",
        subscriptionId: String(sub.id || ""),
        renewAt: nextAt || null,
        cancelAtPeriodEnd: sub.scheduled_change ? sub.scheduled_change.action === "cancel" : false,
        updatedAt: now
      }
    });
}

exports.paddleWebhook = onRequest({ region: "europe-west1" }, async (req, res) => {
  if (req.method === "GET") {
    res.status(200).send("ok");
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, message: "Yalnızca POST desteklenir." });
    return;
  }
  if (!verifyPaddleWebhook(req)) {
    res.status(401).json({ ok: false, message: "İmza doğrulanamadı." });
    return;
  }
  try {
    const body = req.body || {};
    const eventType = String(body.event_type || body.eventType || "");
    const data = body.data || {};
    let uid = readPaddleUid(data);
    if (!uid) {
      uid = await findUidByEmail(data.customer_email || (data.customer && data.customer.email) || "");
    }

    if (eventType === "transaction.completed") {
      const nextAt =
        parseMillisFromDateString(data.billing_cycle && data.billing_cycle.next_billed_at) ||
        parseMillisFromDateString(data.subscription && data.subscription.next_billed_at) ||
        0;
      if (uid) {
        await admin
          .database()
          .ref("users/" + uid)
          .update({
            isPro: true,
            subscription: {
              provider: "paddle",
              status: "active",
              renewAt: nextAt || null,
              lastTransactionId: String(data.id || ""),
              updatedAt: Date.now()
            }
          });
      }
    } else if (
      eventType === "subscription.created" ||
      eventType === "subscription.updated" ||
      eventType === "subscription.activated" ||
      eventType === "subscription.past_due" ||
      eventType === "subscription.canceled"
    ) {
      await applyPaddleSubscriptionState(uid, data);
    }

    res.status(200).json({ ok: true });
  } catch (_err) {
    res.status(500).json({ ok: false, message: "Webhook işlenemedi." });
  }
});

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
