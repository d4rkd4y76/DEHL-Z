(function () {
  const cfg = window.DEHLIZ_CONFIG;
  if (!cfg || !cfg.firebase) {
    console.error("DEHLIZ_CONFIG eksik");
    return;
  }

  if (!firebase.apps.length) {
    firebase.initializeApp(cfg.firebase);
  }

  window.dehlizDb = firebase.database();
  window.dehlizAuth = firebase.auth();

  window.bunnyEmbedUrl = function (libraryId, videoId) {
    const base = (cfg.bunnyEmbedBase || "https://player.mediadelivery.net/embed").replace(/\/$/, "");
    const params = new URLSearchParams({
      autoplay: "false",
      muted: "false",
      preload: "false"
    });
    return base + "/" + encodeURIComponent(libraryId) + "/" + encodeURIComponent(videoId) + "?" + params.toString();
  };

  window.dehlizSignOut = function () {
    return dehlizAuth.signOut();
  };

  window.dehlizNormalizeText = function (value) {
    return String(value || "")
      .trim()
      .toLocaleLowerCase("tr-TR")
      .replace(/\s+/g, " ");
  };

  window.dehlizSha256 = async function (value) {
    const normalized = window.dehlizNormalizeText(value);
    const bytes = new TextEncoder().encode(normalized);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const arr = Array.from(new Uint8Array(digest));
    return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
  };

  window.dehlizUserError = function (error, fallbackText) {
    const fallback = fallbackText || "Bir hata oluştu. Lütfen tekrar deneyin.";
    if (!error) return fallback;
    const code = String(error.code || "").toLowerCase();
    const msg = String(error.message || "").toLowerCase();
    const byCode = {
      "auth/email-already-in-use": "Bu e-posta adresiyle zaten bir hesap var.",
      "auth/invalid-email": "Geçersiz e-posta adresi.",
      "auth/user-not-found": "Bu e-posta ile kayıtlı kullanıcı bulunamadı.",
      "auth/wrong-password": "Şifre hatalı.",
      "auth/invalid-credential": "E-posta veya şifre hatalı.",
      "auth/too-many-requests": "Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar deneyin.",
      "auth/network-request-failed": "Ağ bağlantısı hatası. İnternetinizi kontrol edin.",
      "auth/weak-password": "Şifre çok zayıf. Daha güçlü bir şifre seçin.",
      "auth/missing-email": "Lütfen e-posta adresinizi girin.",
      "auth/user-disabled": "Bu hesap devre dışı bırakılmış.",
      "auth/requires-recent-login": "Bu işlem için yeniden giriş yapmanız gerekiyor.",
      "permission_denied": "Bu işlem için yetkiniz yok."
    };
    if (byCode[code]) return byCode[code];
    if (msg.indexOf("permission_denied") !== -1 || msg.indexOf("permission denied") !== -1) {
      return "Bu işlem için yetkiniz yok.";
    }
    return fallback;
  };
})();
