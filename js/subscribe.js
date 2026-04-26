(function () {
  const $ = (id) => document.getElementById(id);
  const cfg = (window.DEHLIZ_CONFIG && window.DEHLIZ_CONFIG.paddle) || {};
  const plusPriceTl = Number(cfg.plusMonthlyPriceTl || 120);
  const paddleClientToken = String(cfg.clientToken || "").trim();
  const paddlePriceIdMonthly = String(cfg.priceIdMonthly || "").trim();
  const paddleSellerName = String(cfg.sellerName || "DEHLİZ").trim();
  const supportEmail = String(cfg.supportEmail || "").trim();
  const LEGAL_POLICY_VERSION = "2026-04-26";
  let paddleReady = false;

  function normalizeBool(v) {
    return v === true || v === 1 || v === "1" || String(v).toLowerCase() === "true";
  }

  function readRenewalAt(profile) {
    if (!profile) return 0;
    const sub = profile.subscription || {};
    const candidates = [sub.renewAt, sub.nextBillingAt, sub.expiresAt, sub.plusUntil, profile.renewAt, profile.plusUntil];
    for (let i = 0; i < candidates.length; i++) {
      const n = Number(candidates[i]);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return 0;
  }

  function daysUntil(ts) {
    if (!ts) return null;
    return Math.ceil((ts - Date.now()) / (24 * 60 * 60 * 1000));
  }

  function fmtDate(ts) {
    if (!ts) return "-";
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return "-";
    return d.toLocaleDateString("tr-TR");
  }

  function statusActionsHtml(opts) {
    const out = [];
    if (opts.showLogin) out.push('<button type="button" class="btn btn-primary" id="statusLoginBtn">Giriş yap</button>');
    if (opts.showSubscribe) out.push('<button type="button" class="btn btn-primary" id="startPaddleCheckoutBtn">+PLUS\'a abone ol</button>');
    if (opts.showRenew) out.push('<button type="button" class="btn btn-primary" id="renewPaddleCheckoutBtn">Aboneliği yenile</button>');
    if (opts.requireConsent) {
      out.push(
        '<label class="sub-consent" for="billingConsent">' +
          '<input id="billingConsent" type="checkbox" />' +
          '<span><a href="privacy.html" target="_blank" rel="noopener">Gizlilik Politikası</a> ve <a href="refund-policy.html" target="_blank" rel="noopener">İptal/İade Koşulları</a> metinlerini okudum, kabul ediyorum.</span>' +
        "</label>"
      );
    }
    if (opts.showManage) out.push('<p class="sub-help" style="margin:0.55rem 0 0">Plan değişikliği ve iptal işlemleri için destek ekibiyle iletişime geçebilirsiniz.</p>');
    if (!out.length) return "";
    return '<div class="status-actions">' + out.join("") + "</div>";
  }

  function supportLinksHtml() {
    const links = [];
    if (supportEmail) links.push('<a href="mailto:' + escapeAttr(supportEmail) + '">' + escape(supportEmail) + "</a>");
    if (!links.length) return "";
    return '<p class="sub-help">Destek: ' + links.join(" · ") + "</p>";
  }

  function initPaddle() {
    if (paddleReady) return true;
    if (!window.Paddle || !paddleClientToken) return false;
    try {
      window.Paddle.Initialize({
        token: paddleClientToken,
        checkout: {
          locale: "tr"
        }
      });
      paddleReady = true;
      return true;
    } catch (_e) {
      paddleReady = false;
      return false;
    }
  }

  async function openPaddleCheckout(user) {
    if (!user || !user.uid) {
      alert("Abonelik başlatmak için önce giriş yapın.");
      return;
    }
    if (!paddlePriceIdMonthly) {
      alert("Paddle fiyat planı henüz tanımlı değil. Yönetici ayarlarını kontrol edin.");
      return;
    }
    if (!initPaddle()) {
      alert("Ödeme ekranı başlatılamadı. Lütfen daha sonra tekrar deneyin.");
      return;
    }
    window.Paddle.Checkout.open({
      items: [{ priceId: paddlePriceIdMonthly, quantity: 1 }],
      customData: {
        firebaseUid: user.uid,
        source: "dehliz_subscribe_page",
        plan: "plus_monthly"
      },
      customer: {
        email: user.email || undefined
      }
    });
  }

  function modals() {
    document.querySelectorAll("[data-close]").forEach((btn) => {
      btn.addEventListener("click", () => {
        $(btn.getAttribute("data-close")).classList.remove("open");
      });
    });
    $("authModal").addEventListener("click", (e) => {
      if (e.target === $("authModal")) $("authModal").classList.remove("open");
    });
  }

  function renderStatus(user, profile) {
    const box = $("statusBox");
    const priceEl = $("plusPriceText");
    if (priceEl) priceEl.textContent = plusPriceTl + " ₺";
    if (!user) {
      box.innerHTML =
        '<div class="status-card">' +
        '<p class="status-title">Abonelik durumunu görmek için giriş yapın</p>' +
        '<p class="status-sub">Giriş yaptıktan sonra +PLUS durumunuz, yenileme tarihiniz ve abonelik işlemleriniz burada görünecek.</p>' +
        statusActionsHtml({ showLogin: true }) +
        supportLinksHtml() +
        "</div>";
      const loginBtn = $("statusLoginBtn");
      if (loginBtn) {
        loginBtn.addEventListener("click", () => {
          $("authErr").style.display = "none";
          $("authModal").classList.add("open");
        });
      }
      return;
    }
    const sub = (profile && profile.subscription) || {};
    const pro = normalizeBool(profile && profile.isPro);
    const renewAt = readRenewalAt(profile);
    const left = daysUntil(renewAt);
    const status = String(sub.status || "").toLowerCase();

    if (pro) {
      const renewText =
        renewAt && left != null
          ? "Bir sonraki yenileme: " + fmtDate(renewAt) + " (" + (left >= 0 ? left + " gün kaldı" : "süresi doldu") + ")"
          : "Yenileme tarihi kısa süre içinde abonelik bilgilerinizde görüntülenecektir.";
      box.innerHTML =
        '<div class="status-card">' +
        '<p class="status-title">Hesap: ' +
        escape(user.email) +
        '</p><p class="status-sub"><span class="status-chip plus">+PLUS AKTİF</span></p>' +
        '<p class="status-sub">' +
        renewText +
        "</p>" +
        '<ol class="sub-step-list"><li>+PLUS videoları sınırsız açabilirsiniz.</li><li>İçerikleri listenize ekleyip kişisel arşivinizi oluşturabilirsiniz.</li><li>Arka planda dinleme ayrıcalığınız aktif olur.</li></ol>' +
        statusActionsHtml({ showRenew: true, showManage: true, requireConsent: true }) +
        supportLinksHtml() +
        "</div>";
      wireCheckoutButtons(user);
      return;
    }

    box.innerHTML =
      '<div class="status-card">' +
      '<p class="status-title">Hesap: ' +
      escape(user.email) +
      '</p><p class="status-sub"><span class="status-chip free">STANDART ÜYELİK</span>' +
      (status === "past_due" ? ' <span class="status-chip pending">ÖDEME BAŞARISIZ</span>' : "") +
      "</p>" +
      '<p class="status-sub">+PLUS\'a geçmek için tek adım yeterli. Ödemeyi tamamladığınız anda ayrıcalıklarınız otomatik açılır.</p>' +
      '<ol class="sub-step-list"><li>"+PLUS\'a abone ol" butonuna tıklayın.</li><li>Ödeme ekranında kart bilgilerinizi girip işlemi tamamlayın.</li><li>İşlem onaylandıktan sonra +PLUS videoları, liste ve arka plan dinleme özellikleri açılır.</li></ol>' +
      statusActionsHtml({ showSubscribe: true, showManage: true, requireConsent: true }) +
      (!paddleClientToken || !paddlePriceIdMonthly
        ? '<p class="sub-note">Abonelik sistemi kısa süre içinde aktif ediliyor. Lütfen biraz sonra tekrar deneyin.</p>'
        : "") +
      supportLinksHtml() +
      "</div>";
    wireCheckoutButtons(user);
  }

  function escape(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(s) {
    return escape(s).replace(/'/g, "&#39;");
  }

  function wireCheckoutButtons(user) {
    const readBillingConsent = () => {
      const el = $("billingConsent");
      return !!(el && el.checked);
    };
    const ensureBillingConsent = () => {
      if (readBillingConsent()) return true;
      alert("Devam etmek için Gizlilik Politikası ve İptal/İade Koşulları onayını vermelisiniz.");
      return false;
    };
    const saveBillingConsent = async () => {
      if (!user || !user.uid) return;
      await DataService.userRef(user.uid).child("legalConsents").update({
        subscriptionAccepted: true,
        subscriptionAcceptedAt: Date.now(),
        privacyVersion: LEGAL_POLICY_VERSION,
        refundVersion: LEGAL_POLICY_VERSION
      });
    };
    const subscribeBtn = $("startPaddleCheckoutBtn");
    if (subscribeBtn) {
      subscribeBtn.addEventListener("click", async () => {
        if (!ensureBillingConsent()) return;
        await saveBillingConsent();
        await openPaddleCheckout(user);
      });
    }
    const renewBtn = $("renewPaddleCheckoutBtn");
    if (renewBtn) {
      renewBtn.addEventListener("click", async () => {
        if (!ensureBillingConsent()) return;
        await saveBillingConsent();
        await openPaddleCheckout(user);
      });
    }
  }

  function wireAuth() {
    $("btnLogin").addEventListener("click", () => {
      $("authErr").style.display = "none";
      $("authModal").classList.add("open");
    });
    $("btnLogout").addEventListener("click", () => dehlizSignOut());
    $("doLogin").addEventListener("click", async () => {
      $("authErr").style.display = "none";
      try {
        await dehlizAuth.signInWithEmailAndPassword($("em").value.trim(), $("pw").value);
        $("authModal").classList.remove("open");
      } catch (e) {
        $("authErr").textContent = dehlizUserError(e, "Giriş başarısız.");
        $("authErr").style.display = "block";
      }
    });
    $("doRegister").addEventListener("click", () => {
      const email = encodeURIComponent(($("em").value || "").trim());
      window.location.href = "register.html?email=" + email;
    });

    dehlizAuth.onAuthStateChanged(async (user) => {
      $("btnLogin").style.display = user ? "none" : "inline-block";
      $("btnLogout").style.display = user ? "inline-block" : "none";
      let profile = null;
      if (user) {
        await DataService.ensureUserProfile(user);
        profile = await DataService.userOnce(user.uid);
      }
      renderStatus(user, profile);
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    modals();
    wireAuth();
  });
})();
