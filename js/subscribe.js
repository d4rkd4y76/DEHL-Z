;(function () {
  const $ = (id) => document.getElementById(id);
  const cfg = (window.DEHLIZ_CONFIG && window.DEHLIZ_CONFIG.shopier) || {};
  const supportEmail = String(cfg.supportEmail || "destek.dehliz@gmail.com").trim();
  const LEGAL_POLICY_VERSION = "2026-04-27";
  const planMap = cfg.plans || {};
  let pendingPlanKey = "";
  let pendingPromoKey = "";

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

  function readStartAt(profile) {
    if (!profile) return 0;
    const sub = profile.subscription || {};
    const candidates = [sub.startedAt, sub.startAt, profile.plusStartedAt];
    for (let i = 0; i < candidates.length; i++) {
      const n = Number(candidates[i]);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return 0;
  }

  function fmtDate(ts) {
    if (!ts) return "-";
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return "-";
    return d.toLocaleDateString("tr-TR");
  }

  function supportLinksHtml() {
    const links = [];
    if (supportEmail) links.push('<a href="mailto:' + escapeAttr(supportEmail) + '">' + escape(supportEmail) + "</a>");
    if (!links.length) return "";
    return '<p class="sub-help">Destek: ' + links.join(" · ") + "</p>";
  }

  function selectedConsent() {
    const el = $("billingConsent");
    return !!(el && el.checked);
  }

  function assertConsent() {
    if (selectedConsent()) return true;
    alert("Devam etmek için Gizlilik Politikası ve İptal/İade Koşulları onayını vermelisiniz.");
    return false;
  }

  async function claimFreeLaunchPromo(user) {
    if (!user) throw new Error("Giriş yapmanız gerekiyor.");
    const idToken = await user.getIdToken();
    const base = (window.DEHLIZ_CONFIG && window.DEHLIZ_CONFIG.recoveryApiBase) || "";
    if (!base) throw new Error("API adresi yapılandırılmamış.");
    const endpoint = base.replace(/\/$/, "") + "/promoFreeMonth";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + idToken
      },
      body: JSON.stringify({ promo: "launch_free_1m" })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error((data && data.message) || "İşlem başarısız.");
    return data;
  }

  async function saveBillingConsent(user, planKey) {
    if (!user || !user.uid) return;
    await DataService.userRef(user.uid).child("legalConsents").update({
      shopierAccepted: true,
      shopierAcceptedAt: Date.now(),
      selectedPlan: planKey,
      privacyVersion: LEGAL_POLICY_VERSION,
      refundVersion: LEGAL_POLICY_VERSION
    });
  }

  function buildCheckoutUrl(base, user, planKey, planCfg) {
    try {
      const u = new URL(base);
      u.searchParams.set("uid", user.uid || "");
      u.searchParams.set("email", user.email || "");
      u.searchParams.set("plan", planKey);
      u.searchParams.set("months", String(Number(planCfg.months || 0)));
      u.searchParams.set("price", String(Number(planCfg.priceTl || 0)));
      u.searchParams.set("source", "dehliz_subscribe_page");
      return u.toString();
    } catch (_e) {
      return base;
    }
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
    $("purchaseConsentModal").addEventListener("click", (e) => {
      if (e.target === $("purchaseConsentModal")) $("purchaseConsentModal").classList.remove("open");
    });
  }

  function openPurchaseConsent(planKey) {
    pendingPlanKey = planKey;
    pendingPromoKey = "";
    const planCfg = planMap[planKey] || {};
    const label = String(planCfg.label || "Seçilen paket");
    const price = Number(planCfg.priceTl || 0);
    const months = Number(planCfg.months || 0);
    $("purchaseConsentPlan").textContent =
      "Seçilen paket: " + label + " - " + price + " TL (" + months + " ay)";
    $("billingConsent").checked = false;
    $("purchaseConsentModal").classList.add("open");
  }

  function openPromoConsent(promoKey) {
    pendingPlanKey = "";
    pendingPromoKey = String(promoKey || "");
    $("purchaseConsentPlan").textContent = "Açılışa özel kampanya: 1 ay ücretsiz +PLUS (0 TL)";
    $("billingConsent").checked = false;
    $("purchaseConsentModal").classList.add("open");
  }

  function renderStatus(user, profile) {
    const box = $("statusBox");
    if (!user) {
      box.innerHTML =
        '<div class="status-card">' +
        '<p class="status-title">Üyelik durumunu görmek için giriş yapın</p>' +
        '<p class="status-sub">Giriş yaptıktan sonra +PLUS durumunuz, kalan süreniz ve ödeme sonrası aktivasyon bilgileri burada görünür.</p>' +
        '<div class="status-actions"><button type="button" class="btn btn-primary" id="statusLoginBtn">Giriş yap</button></div>' +
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

    const renewAt = readRenewalAt(profile);
    const pro = normalizeBool(profile && profile.isPro) && !(renewAt && Date.now() > renewAt);
    const left = daysUntil(renewAt);

    // Açılış kampanyası CTA durumunu güncelle.
    (function updatePromoCta() {
      const btn = document.querySelector(".promo-free-btn");
      if (!btn) return;
      const usedOnce = !!(profile && profile.promo && profile.promo.launchFreeMonthUsedAt);
      if (pro) {
        btn.disabled = true;
        btn.classList.remove("btn-primary");
        btn.classList.add("btn-ghost");
        btn.textContent = "Zaten abonesiniz";
        return;
      }
      if (usedOnce) {
        btn.disabled = true;
        btn.classList.remove("btn-primary");
        btn.classList.add("btn-ghost");
        btn.textContent = "Kampanya kullanıldı";
        return;
      }
      btn.disabled = false;
      btn.classList.add("btn-primary");
      btn.classList.remove("btn-ghost");
      btn.textContent = "Ücretsiz +PLUS’u Aktifleştir";
    })();

    if (pro) {
      const startAt = readStartAt(profile);
      const renewText =
        renewAt && left != null
          ? "Başlangıç: " +
            (startAt ? fmtDate(startAt) : "-") +
            " • Bitiş: " +
            fmtDate(renewAt) +
            " • Kalan süre: " +
            (left >= 0 ? left + " gün" : "süresi doldu")
          : "Erişim bitiş tarihi kısa süre içinde profilinizde görüntülenecektir.";
      box.innerHTML =
        '<div class="status-card">' +
        '<p class="status-title">Hesap: ' +
        escape(user.email) +
        '</p><p class="status-sub"><span class="status-chip plus">+PLUS AKTİF</span></p>' +
        '<p class="status-sub">' +
        renewText +
        "</p>" +
        (left != null && left >= 0 && left <= 5
          ? '<p class="sub-note">Uyarı: +PLUS üyeliğinizin bitmesine ' +
            left +
            " gün kaldı. Kesinti yaşamamak için paketinizi yenileyebilirsiniz.</p>"
          : "") +
        '<ol class="sub-step-list"><li>+PLUS videoları sınırsız açabilirsiniz.</li><li>İçerikleri listenize ekleyip kişisel arşivinizi oluşturabilirsiniz.</li><li>Arka planda dinleme ayrıcalığınız aktif olur.</li><li>Sıfır reklam deneyimiyle içerikleri kesintisiz izlersiniz.</li></ol>' +
        '<p class="sub-help" style="margin:0.55rem 0 0">Sürenizi uzatmak için aşağıdaki Shopier paketlerinden birini tekrar satın alabilirsiniz.</p>' +
        supportLinksHtml() +
        "</div>";
      return;
    }

    box.innerHTML =
      '<div class="status-card">' +
      '<p class="status-title">Hesap: ' +
      escape(user.email) +
      '</p><p class="status-sub"><span class="status-chip free">STANDART ÜYELİK</span></p>' +
      '<p class="status-sub">Aşağıdaki Shopier paketlerinden birini seçip tek seferlik ödeme yaptığınızda +PLUS erişiminiz seçilen süre boyunca aktif edilir.</p>' +
      '<ol class="sub-step-list"><li>Paketi seçin.</li><li>Shopier ödeme adımını tamamlayın.</li><li>Ödeme onaylandığında hesap süreniz aktif edilir.</li></ol>' +
      supportLinksHtml() +
      "</div>";
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

  function wireShopierButtons() {
    document.querySelectorAll(".shopier-buy-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const user = dehlizAuth.currentUser;
        if (!user || !user.uid) {
          $("authErr").style.display = "none";
          $("authModal").classList.add("open");
          return;
        }
        const planKey = String(btn.getAttribute("data-plan") || "");
        // Şimdilik yalnızca açılış kampanyası aktif.
        if (planKey === "plus_2m" || planKey === "plus_3m") {
          alert("Bu paket şu an aktif değil. Açılışa özel 1 aylık ücretsiz +PLUS kampanyasını kullanabilirsiniz.");
          return;
        }
        if (!planMap[planKey]) {
          alert("Seçilen planın Shopier bağlantısı henüz tanımlı değil. Yönetici ayarlarını kontrol edin.");
          return;
        }
        openPurchaseConsent(planKey);
      });
    });

    document.querySelectorAll(".promo-free-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        const user = dehlizAuth.currentUser;
        if (!user || !user.uid) {
          $("authErr").style.display = "none";
          $("authModal").classList.add("open");
          return;
        }
        const promoKey = String(btn.getAttribute("data-promo") || "launch_free_1m");
        openPromoConsent(promoKey);
      });
    });

    $("purchaseConsentContinue").addEventListener("click", async () => {
      const user = dehlizAuth.currentUser;
      if (!user || !user.uid) {
        $("purchaseConsentModal").classList.remove("open");
        $("authErr").style.display = "none";
        $("authModal").classList.add("open");
        return;
      }
      if (!assertConsent()) return;
      const continueBtn = $("purchaseConsentContinue");
      continueBtn.disabled = true;
      const oldText = continueBtn.textContent;
      continueBtn.textContent = "İşleniyor…";
      try {
        // Öncelik: açılış kampanyası (ücretsiz).
        if (pendingPromoKey) {
          $("purchaseConsentModal").classList.remove("open");
          await saveBillingConsent(user, "promo:" + pendingPromoKey);
          await claimFreeLaunchPromo(user);
          const profile = await DataService.userOnce(user.uid);
          renderStatus(user, profile);
          alert("Tebrikler! +PLUS hesabınıza 1 ay ücretsiz tanımlandı.");
          pendingPromoKey = "";
          return;
        }

        // Shopier ödemeli akış (şimdilik sayfadan kaldırıldı ama kod kalsın).
        const planKey = pendingPlanKey;
        const planCfg = planMap[planKey] || null;
        const checkoutUrl = planCfg ? String(planCfg.checkoutUrl || "").trim() : "";
        if (!planCfg || !checkoutUrl) {
          alert("Seçilen planın Shopier bağlantısı henüz tanımlı değil. Yönetici ayarlarını kontrol edin.");
          return;
        }
        await saveBillingConsent(user, planKey);
        window.location.href = buildCheckoutUrl(checkoutUrl, user, planKey, planCfg);
      } finally {
        continueBtn.disabled = false;
        continueBtn.textContent = oldText;
      }
    });
  }

  function wirePlanCarousel() {
    const grid = $("planGrid");
    const prev = $("planPrevBtn");
    const next = $("planNextBtn");
    const hint = $("planCarouselHint");
    if (!grid || !prev || !next) return;

    const step = () => Math.max(240, Math.round(grid.clientWidth * 0.86));

    const update = () => {
      const max = Math.max(0, grid.scrollWidth - grid.clientWidth);
      const left = Math.max(0, Math.round(grid.scrollLeft));
      prev.disabled = left <= 4;
      next.disabled = left >= max - 4;
      if (hint) {
        if (max <= 6) hint.textContent = "Tüm paketler görünüyor.";
        else if (next.disabled) hint.textContent = "Tüm paketleri gördünüz.";
        else hint.textContent = "Sağa sola kaydırarak avantajlı paketleri gör.";
      }
    };

    prev.addEventListener("click", () => {
      grid.scrollBy({ left: -step(), behavior: "smooth" });
    });
    next.addEventListener("click", () => {
      grid.scrollBy({ left: step(), behavior: "smooth" });
    });
    grid.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    update();
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
    wireShopierButtons();
    wirePlanCarousel();
  });
})();
