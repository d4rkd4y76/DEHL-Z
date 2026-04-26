(function () {
  const $ = (id) => document.getElementById(id);

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

  async function register() {
    hideErr();
    $("regOk").classList.add("hidden");
    const name = sanitizeDisplayName($("regName").value);
    const email = $("regEmail").value.trim();
    const pw = $("regPw").value;
    const pw2 = $("regPw2").value;
    const secretQuestion = ($("regSecretQ").value || "").trim();
    const secretAnswer = ($("regSecretA").value || "").trim();

    if (name.length < 2) return showErr("Kullanıcı adı en az 2 karakter olmalıdır.");
    if (!email) return showErr("E-posta gerekli.");
    if (pw.length < 6) return showErr("Şifre en az 6 karakter olmalıdır.");
    if (pw !== pw2) return showErr("Şifreler eşleşmiyor.");
    if (!secretQuestion) return showErr("Lütfen bir gizli soru seçin.");
    if (secretAnswer.length < 2) return showErr("Gizli soru cevabı en az 2 karakter olmalıdır.");

    const btn = $("btnRegister");
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Oluşturuluyor…";
    try {
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
    $("btnRegister").addEventListener("click", register);
    $("btnToLogin").addEventListener("click", () => {
      window.location.href = "index.html";
    });
  });
})();
