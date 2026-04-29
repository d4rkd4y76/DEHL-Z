;(function () {
  const $ = (id) => document.getElementById(id);
  const cfg = (window.DEHLIZ_CONFIG && window.DEHLIZ_CONFIG.patreon) || {};
  const supportEmail = String(cfg.supportEmail || "destek.dehliz@gmail.com").trim();
  const subscribeUrl = String(cfg.subscribeUrl || "").trim();
  const manageUrl = String(cfg.manageUrl || "").trim();
  const LEGAL_POLICY_VERSION = "2026-04-29";
  let pendingAfterConsent = null;

  function normalizeBool(v) {
    return v === true || v === 1 || v === "1" || String(v).toLowerCase() === "true";
  }

  function readRenewalAt(profile) {
    if (!profile) return 0;
    const sub = profile.subscription || {};
    const candidates = [sub.renewAt, sub.nextBillingAt, sub.expiresAt, profile.renewAt, profile.plusUntil];
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

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function supportHtml() {
    return supportEmail
      ? '<p class="status-sub" style="margin-top:0.85rem">Destek: <a href="mailto:' +
          escapeHtml(supportEmail) +
          '">' +
          escapeHtml(supportEmail) +
          "</a></p>"
      : "";
  }

  async function saveConsent(user) {
    if (!user || !user.uid) return;
    await DataService.userRef(user.uid).child("legalConsents").update({
      patreonAccepted: true,
      patreonAcceptedAt: Date.now(),
      privacyVersion: LEGAL_POLICY_VERSION,
      refundVersion: LEGAL_POLICY_VERSION
    });
  }

  function renderStatus(user, profile) {
    const box = $("statusBox");
    if (!box) return;
    if (!user) {
      box.innerHTML =
        '<div class="status-card"><p class="status-title">Abonelik durumunu görmek için giriş yapın</p><p class="status-sub">Giriş yaptıktan sonra Patreon üyelik durumunuz burada görünür.</p><div class="status-actions"><button type="button" class="btn btn-primary" id="statusLoginBtn">Giriş yap</button></div>' +
        supportHtml() +
        "</div>";
      const b = $("statusLoginBtn");
      if (b) b.addEventListener("click", () => $("authModal").classList.add("open"));
      return;
    }

    const sub = (profile && profile.subscription) || {};
    const isPlus = normalizeBool(profile && profile.isPro);
    const renewAt = readRenewalAt(profile);
    const daysLeft = daysUntil(renewAt);
    const cancelPending = sub.cancelAtPeriodEnd === true || String(sub.status || "").toLowerCase() === "cancel_pending";

    let statusChip = '<span class="status-chip free">STANDART</span>';
    let text = "Patreon aboneliğiniz bulunmuyor.";
    if (isPlus && cancelPending) {
      statusChip = '<span class="status-chip pending">İPTAL EDİLDİ</span>';
      text =
        "Patreon aboneliğiniz iptal edildi. Dönem sonuna kadar +PLUS açık kalır." +
        (renewAt ? " Bitiş: " + fmtDate(renewAt) + (daysLeft != null ? " (" + daysLeft + " gün)" : "") : "");
    } else if (isPlus) {
      statusChip = '<span class="status-chip plus">+PLUS AKTİF</span>';
      text = "Patreon aboneliğiniz aktif." + (renewAt ? " Sonraki yenileme: " + fmtDate(renewAt) : "");
    }

    box.innerHTML =
      '<div class="status-card"><p class="status-title">Hesap: ' +
      escapeHtml(user.email || "-") +
      '</p><p class="status-sub">' +
      statusChip +
      '</p><p class="status-sub">' +
      escapeHtml(text) +
      "</p>" +
      (cancelPending ? '<p class="sub-note">Uyarı: Abonelik iptal edildiği için dönem sonunda +PLUS kapanacaktır.</p>' : "") +
      supportHtml() +
      "</div>";

    updateSubscribeButtonState(!!isPlus);
  }

  function updateSubscribeButtonState(isPlus) {
    const btn = $("startPatreonBtn");
    if (!btn) return;
    if (isPlus) {
      btn.disabled = true;
      btn.textContent = "Abonesiniz";
      btn.classList.add("is-disabled");
    } else {
      btn.disabled = false;
      btn.textContent = "Abone Ol";
      btn.classList.remove("is-disabled");
    }
  }

  function wirePatreonButton() {
    const btn = $("startPatreonBtn");
    if (!btn) return;
    btn.addEventListener("click", () => openConsentModal(openPatreonSubscribe));
  }

  function openConsentModal(action) {
    pendingAfterConsent = action;
    const checkbox = $("billingConsent");
    if (checkbox) checkbox.checked = false;
    const modal = $("consentModal");
    if (modal) modal.classList.add("open");
  }

  async function continueAfterConsent() {
    const checkbox = $("billingConsent");
    if (!checkbox || !checkbox.checked) {
      alert("Devam etmek için gizlilik ve iptal/iade metinlerini onaylamalısınız.");
      return;
    }
    const action = pendingAfterConsent;
    pendingAfterConsent = null;
    const modal = $("consentModal");
    if (modal) modal.classList.remove("open");
    if (typeof action === "function") await action();
  }

  async function openPatreonSubscribe() {
    const user = dehlizAuth.currentUser;
    if (!user || !user.uid) {
      $("authModal").classList.add("open");
      return;
    }
    if (!subscribeUrl) {
      alert("Patreon bağlantısı tanımlı değil. `js/config.js` dosyasında `patreon.subscribeUrl` alanını doldurun.");
      return;
    }
    await saveConsent(user);
    window.location.href = subscribeUrl;
  }

  function wireManageButton() {
    const btn = $("managePatreonBtn");
    if (!btn) return;
    btn.addEventListener("click", () => {
      window.open(manageUrl || "https://www.patreon.com/settings/memberships", "_blank", "noopener");
    });
  }

  function wireBenefitModal() {
    const openBtn = $("patreonAdvantageBtn");
    const modal = $("patreonBenefitModal");
    const startBtn = $("benefitModalStartBtn");
    if (openBtn && modal) {
      openBtn.addEventListener("click", () => modal.classList.add("open"));
      modal.addEventListener("click", (e) => {
        if (e.target === modal) modal.classList.remove("open");
      });
    }
    if (startBtn) {
      startBtn.addEventListener("click", async () => {
        if (modal) modal.classList.remove("open");
        openConsentModal(openPatreonSubscribe);
      });
    }
  }

  function wireCloseButtons() {
    document.querySelectorAll("[data-close]").forEach((el) => {
      el.addEventListener("click", () => {
        const targetId = el.getAttribute("data-close");
        const target = $(targetId);
        if (target) target.classList.remove("open");
      });
    });
    const consentContinueBtn = $("consentContinueBtn");
    if (consentContinueBtn) {
      consentContinueBtn.addEventListener("click", async () => {
        await continueAfterConsent();
      });
    }
  }

  function wireAuth() {
    $("btnLogin").addEventListener("click", () => $("authModal").classList.add("open"));
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
    wireCloseButtons();
    $("authModal").addEventListener("click", (e) => {
      if (e.target === $("authModal")) $("authModal").classList.remove("open");
    });
  }

  function bindState() {
    dehlizAuth.onAuthStateChanged(async (user) => {
      $("btnLogin").style.display = user ? "none" : "inline-block";
      $("btnLogout").style.display = user ? "inline-block" : "none";
      let profile = null;
      if (user) {
        await DataService.ensureUserProfile(user);
        profile = await DataService.userOnce(user.uid);
      }
      if (!user) updateSubscribeButtonState(false);
      renderStatus(user, profile);
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    wireAuth();
    wirePatreonButton();
    wireManageButton();
    wireBenefitModal();
    bindState();
  });
})();
