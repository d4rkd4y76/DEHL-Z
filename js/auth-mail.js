/**
 * DEHLİZ — kayıt e-posta onayı ve şifre sıfırlama (Türkçe markalı mail).
 */
(function (global) {
  "use strict";

  var ACTION_URL = "https://www.dehliz.tv/auth-action.html";
  var DEFAULT_MAIL_API = "https://europe-west1-dehliz-a95cd.cloudfunctions.net/authMail";

  function mailApi() {
    try {
      var cfg = global.DEHLIZ_CONFIG || {};
      if (cfg.mailApiBase) return String(cfg.mailApiBase).replace(/\/$/, "");
    } catch (_) {}
    return DEFAULT_MAIL_API;
  }

  function getAuth() {
    try {
      if (global.dehlizAuth) return global.dehlizAuth;
      if (global.firebase && global.firebase.auth) return global.firebase.auth();
    } catch (_) {}
    return null;
  }

  function applyTurkish() {
    var a = getAuth();
    if (!a) return;
    try {
      a.languageCode = "tr";
    } catch (_) {}
  }

  function turkishAuthError(err) {
    var code = (err && (err.code || err.message)) || "";
    var map = {
      "auth/email-already-in-use": "Bu e-posta daha önce kullanılmış. Giriş yap veya Şifremi unuttum’a bas.",
      "auth/invalid-email": "E-posta adresini eksiksiz yaz.",
      "auth/weak-password": "Şifrede hem harf hem sayı olsun. En az 6 karakter yaz.",
      "auth/operation-not-allowed": "Kayıt şu an kapalı. Biraz sonra tekrar dene.",
      "auth/too-many-requests": "Çok denedin. Biraz bekle, sonra tekrar dene.",
      "auth/network-request-failed": "Mail şu an gidemedi. Biraz sonra tekrar dene.",
      "auth/user-not-found": "Bu e-posta ile hesap yok.",
      "auth/invalid-credential": "E-posta veya şifre hatalı.",
      "auth/wrong-password": "E-posta veya şifre hatalı.",
      "auth/user-disabled": "Bu hesap kapalı.",
      "auth/expired-action-code": "Bu mail eskimiş. Girişte yeni bir mail iste.",
      "auth/invalid-action-code": "Bu mail artık işe yaramıyor. Girişte yeni bir mail iste.",
      "auth/missing-email": "E-posta adresini yaz.",
      "auth/unauthorized-continue-uri": "Mail şu an gidemedi. Biraz sonra tekrar dene."
    };
    if (map[code]) return map[code];
    var msg = String((err && err.message) || code || "").trim();
    if (/failed to fetch|networkerror|load failed/i.test(msg) || code === "TypeError") {
      return "Mail şu an gidemedi. Biraz sonra tekrar dene.";
    }
    if (msg && msg.indexOf("auth/") === 0) return "Şimdi olmadı. Biraz sonra tekrar dene.";
    return msg && !/auth\/|failed to fetch/i.test(msg) && msg.length < 80
      ? msg
      : "Şimdi olmadı. Biraz sonra tekrar dene.";
  }

  function postMail(payload, idToken) {
    var body = payload || {};
    var headers = { "Content-Type": "application/json" };
    if (idToken) headers.Authorization = "Bearer " + idToken;
    return fetch(mailApi(), {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      headers: headers,
      body: JSON.stringify(body)
    }).then(function (res) {
      return res
        .json()
        .catch(function () {
          return {};
        })
        .then(function (data) {
          if (data && data.ok) return data;
          var errCode = data && data.error;
          if (errCode === "expired") throw new Error("auth/expired-action-code");
          if (errCode === "token" || errCode === "password") throw new Error("auth/invalid-action-code");
          throw new Error("auth/network-request-failed");
        });
    });
  }

  function sendVerification(user) {
    applyTurkish();
    if (!user || typeof user.getIdToken !== "function") {
      return Promise.reject(new Error("auth/operation-not-allowed"));
    }
    return user.getIdToken().then(function (token) {
      return postMail({ type: "verify" }, token);
    });
  }

  function sendPasswordReset(email) {
    applyTurkish();
    return postMail({ type: "reset", email: String(email || "").trim() });
  }

  function consumeLink(token, password) {
    var payload = { type: "consume", token: String(token || "") };
    if (password) payload.password = String(password);
    return postMail(payload);
  }

  function markEmailVerified(email, uid) {
    try {
      var db = global.dehlizDb;
      if (!db || !uid) return Promise.resolve();
      return db.ref("users/" + uid).update({
        emailVerified: true,
        emailVerifiedAt: Date.now(),
        email: String(email || "").trim().toLowerCase() || null
      });
    } catch (_) {
      return Promise.resolve();
    }
  }

  global.DehlizAuthMail = {
    ACTION_URL: ACTION_URL,
    applyTurkish: applyTurkish,
    turkishAuthError: turkishAuthError,
    sendVerification: sendVerification,
    sendPasswordReset: sendPasswordReset,
    consumeLink: consumeLink,
    markEmailVerified: markEmailVerified
  };
})(window);
