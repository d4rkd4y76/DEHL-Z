(function () {
  const $ = (id) => document.getElementById(id);
  const LEGAL_POLICY_VERSION = "2026-04-26";
  const REGISTER_DRAFT_KEY = "dehliz.registerDraft.v1";
  const DRAFT_FIELDS = ["regName", "regEmail", "regPw", "regPw2", "regSecretQ", "regSecretA", "regLegalConsent"];

  function q(name) {
    const u = new URL(window.location.href);
    return u.searchParams.get(name) || "";
  }

  function showErr(msg) {
    const el = $("regErr");
    el.textContent = msg;
    el.classList.remove("hidden");
  }

  function hideErr() {
    $("regErr").classList.add("hidden");
  }

  function showOk(msg) {
    const el = $("regOk");
    el.textContent = msg;
    el.classList.remove("hidden");
  }

  function sanitizeDisplayName(s) {
    return String(s || "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 32);
  }

  function saveDraft() {
    const draft = {
      regName: $("regName").value || "",
      regEmail: $("regEmail").value || "",
      regPw: $("regPw").value || "",
      regPw2: $("regPw2").value || "",
      regSecretQ: $("regSecretQ").value || "",
      regSecretA: $("regSecretA").value || "",
      regLegalConsent: !!$("regLegalConsent").checked
    };
    sessionStorage.setItem(REGISTER_DRAFT_KEY, JSON.stringify(draft));
  }

  function restoreDraft() {
    let parsed;
    try {
      parsed = JSON.parse(sessionStorage.getItem(REGISTER_DRAFT_KEY) || "{}");
    } catch (_e) {
      parsed = {};
    }
    if (!parsed || typeof parsed !== "object") return;
    if (parsed.regName) $("regName").value = parsed.regName;
    if (parsed.regEmail && !$("regEmail").value) $("regEmail").value = parsed.regEmail;
    if (parsed.regPw) $("regPw").value = parsed.regPw;
    if (parsed.regPw2) $("regPw2").value = parsed.regPw2;
    if (parsed.regSecretQ) $("regSecretQ").value = parsed.regSecretQ;
    if (parsed.regSecretA) $("regSecretA").value = parsed.regSecretA;
    if (typeof parsed.regLegalConsent === "boolean") $("regLegalConsent").checked = parsed.regLegalConsent;
  }

  function clearDraft() {
    sessionStorage.removeItem(REGISTER_DRAFT_KEY);
  }

  async function register() {
    hideErr();
    $("regOk").classList.add("hidden");
    const name = sanitizeDisplayName($("regName").value);
    const email = $("regEmail").value.trim();
    const pw = $("regPw").value;
    const pw2 = $("regPw2").value;
    const secretQuestion = ($("regSecretQ").value || "").trim();
    const secretAnswer = ($("regSecretA").value || "").trim();
    const legalConsent = !!($("regLegalConsent") && $("regLegalConsent").checked);

    if (name.length < 2) return showErr("Kullanıcı adı en az 2 karakter olmalıdır.");
    if (!email) return showErr("E-posta gerekli.");
    if (pw.length < 6) return showErr("Şifre en az 6 karakter olmalıdır.");
    if (pw !== pw2) return showErr("Şifreler eşleşmiyor.");
    if (!secretQuestion) return showErr("Lütfen bir gizli soru seçin.");
    if (secretAnswer.length < 2) return showErr("Gizli soru cevabı en az 2 karakter olmalıdır.");
    if (!legalConsent) return showErr("Devam etmek için Gizlilik Politikası ve İptal/İade Koşulları onayını vermelisiniz.");

    const btn = $("btnRegister");
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Oluşturuluyor…";
    try {
      saveDraft();
      const cred = await dehlizAuth.createUserWithEmailAndPassword(email, pw);
      await DataService.ensureUserProfile(cred.user, name);
      await DataService.updateDisplayName(cred.user.uid, name);
      const answerHash = await dehlizSha256(secretAnswer);
      await DataService.userRef(cred.user.uid).child("recovery").set({
        question: secretQuestion,
        answerHash,
        mustChangePassword: false,
        updatedAt: Date.now()
      });
      await DataService.userRef(cred.user.uid).child("legalConsents").update({
        registrationAccepted: true,
        registrationAcceptedAt: Date.now(),
        privacyVersion: LEGAL_POLICY_VERSION,
        refundVersion: LEGAL_POLICY_VERSION
      });
      clearDraft();
      showOk("Kayıt tamamlandı. Ana sayfaya yönlendiriliyorsunuz…");
      setTimeout(() => {
        window.location.href = "index.html";
      }, 900);
    } catch (e) {
      showErr(dehlizUserError(e, "Kayıt sırasında hata oluştu."));
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("regEmail").value = q("email");
    restoreDraft();
    DRAFT_FIELDS.forEach((id) => {
      const el = $(id);
      if (!el) return;
      const eventName = el.type === "checkbox" || el.tagName === "SELECT" ? "change" : "input";
      el.addEventListener(eventName, saveDraft);
    });
    if ($("privacyLink")) $("privacyLink").addEventListener("click", saveDraft);
    if ($("refundLink")) $("refundLink").addEventListener("click", saveDraft);
    $("btnRegister").addEventListener("click", register);
    $("btnToLogin").addEventListener("click", () => {
      clearDraft();
      const email = encodeURIComponent(($("regEmail").value || "").trim());
      window.location.href = "index.html?auth=login&email=" + email;
    });
  });
})();
