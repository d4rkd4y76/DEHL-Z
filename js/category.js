(function () {
  const $ = (id) => document.getElementById(id);
  const state = {
    user: null,
    profile: null,
    isAdmin: false,
    myList: {},
    myListRef: null,
    categoryId: "",
    selectedDetailId: "",
    categories: {},
    content: {},
    settings: {}
  };
  const MY_LIST_TOGGLE_COOLDOWN_MS = 1200;
  const myListToggleLockById = Object.create(null);
  const myListToggleLastAtById = Object.create(null);
  const SPECIAL_CATEGORY_TITLES = {
    __my_list__: "LİSTENİZ",
    __latest__: "Son Yüklenenler",
    __most_watched__: "En Çok İzlenenler",
    __plus__: "+Plus"
  };

  function isPlusMember(profile) {
    if (!profile) return false;
    const v = profile.isPro;
    return v === true || v === 1 || v === "1" || String(v).toLowerCase() === "true";
  }

  function isProContent(item) {
    if (!item) return false;
    const v = item.isPro;
    return v === true || v === 1 || v === "1" || String(v).toLowerCase() === "true";
  }

  function canUseMyList() {
    return !!(state.user && (state.isAdmin || isPlusMember(state.profile)));
  }

  function showPlusFeatureNotice() {
    const old = document.getElementById("plusFeatureNotice");
    if (old && old.parentNode) old.parentNode.removeChild(old);
    const box = document.createElement("div");
    box.id = "plusFeatureNotice";
    box.className = "plus-feature-notice";
    box.innerHTML =
      '<div class="plus-feature-notice-title">+PLUS Özelliği</div><div class="plus-feature-notice-text">Bu özellik +PLUS üyeliklerinde açılmaktadır.</div>';
    document.body.appendChild(box);
    requestAnimationFrame(() => box.classList.add("show"));
    setTimeout(() => {
      box.classList.remove("show");
      setTimeout(() => {
        if (box.parentNode) box.parentNode.removeChild(box);
      }, 260);
    }, 2200);
  }

  function normalizeCategoryLabel(v) {
    return String(v || "")
      .trim()
      .toLocaleLowerCase("tr-TR")
      .replace(/\s+/g, " ")
      .replace(/\+/g, "plus");
  }

  function isLatestCategory(cid, name) {
    const id = normalizeCategoryLabel(cid).replace(/_/g, " ");
    const nm = normalizeCategoryLabel(name);
    return cid === "__latest__" || id === "son yuklenenler" || nm === "son yuklenenler";
  }

  function isMostWatchedCategory(cid, name) {
    const id = normalizeCategoryLabel(cid).replace(/_/g, " ");
    const nm = normalizeCategoryLabel(name);
    return cid === "__most_watched__" || id === "en cok izlenenler" || nm === "en cok izlenenler";
  }

  function isPlusCategory(cid, name) {
    const id = normalizeCategoryLabel(cid).replace(/_/g, " ");
    const nm = normalizeCategoryLabel(name);
    return cid === "__plus__" || id === "plus icerikler" || id === "plus" || nm === "plus icerikler" || nm === "plus";
  }

  function isArchiveCategory(cid, name) {
    const id = normalizeCategoryLabel(cid).replace(/_/g, " ");
    const nm = normalizeCategoryLabel(name);
    return id === "tum arsiv" || nm === "tum arsiv";
  }

  function query(name) {
    const u = new URL(window.location.href);
    return u.searchParams.get(name) || "";
  }

  function canPlay(item) {
    if (!item || !isProContent(item)) return true;
    if (state.isAdmin) return true;
    return isPlusMember(state.profile);
  }

  async function toggleMyList(id) {
    if (!canUseMyList() || !state.user || !id) return;
    const now = Date.now();
    if (myListToggleLockById[id]) return false;
    const lastAt = Number(myListToggleLastAtById[id] || 0);
    if (now - lastAt < MY_LIST_TOGGLE_COOLDOWN_MS) return false;

    myListToggleLockById[id] = true;
    try {
      await DataService.toggleMyListSecure(id);
      myListToggleLastAtById[id] = Date.now();
      return true;
    } finally {
      myListToggleLockById[id] = false;
    }
  }

  async function handleMyListToggle(id, btn) {
    if (btn) btn.disabled = true;
    try {
      await toggleMyList(id);
    } finally {
      if (btn && btn.isConnected) {
        setTimeout(() => {
          if (btn.isConnected) btn.disabled = false;
        }, 120);
      }
    }
  }

  function syncRenderedMyListButtons() {
    document.querySelectorAll(".card-list-btn[data-list-toggle]").forEach((btn) => {
      const id = String(btn.getAttribute("data-list-toggle") || "");
      if (!id) return;
      const listed = !!state.myList[id];
      btn.classList.toggle("is-added", listed);
      btn.textContent = listed ? "Listenden çıkar" : "Listene ekle";
    });
  }

  function updateDetailListButton(id) {
    const btn = $("dListToggle");
    if (!btn) return;
    if (!state.user) {
      btn.classList.add("hidden");
      return;
    }
    if (!canUseMyList()) {
      btn.classList.remove("hidden");
      btn.classList.add("is-locked");
      btn.classList.remove("is-added");
      btn.textContent = "Listene ekle";
      btn.onclick = function () {
        showPlusFeatureNotice();
      };
      return;
    }
    const listed = !!state.myList[id];
    btn.classList.remove("hidden");
    btn.classList.remove("is-locked");
    btn.classList.toggle("is-added", listed);
    btn.textContent = listed ? "Listenden çıkar" : "Listene ekle";
    btn.onclick = async function () {
      try {
        await handleMyListToggle(id, btn);
      } catch (e) {
        alert(dehlizUserError(e, "Liste işlemi başarısız."));
      }
    };
  }

  function sortedEpisodes(item) {
    return (Array.isArray(item && item.episodes) ? item.episodes : [])
      .slice()
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  }

  function formatDuration(item) {
    const direct = String((item && item.durationText) || "").trim();
    if (direct) return direct;
    const min = Number(item && item.durationMin);
    if (!Number.isFinite(min) || min <= 0) return "";
    const h = Math.floor(min / 60);
    const m = Math.floor(min % 60);
    if (h > 0) return h + "sa " + m + "dk";
    return m + "dk";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function openDetailReadOverlay(title, text) {
    const old = document.querySelector(".detail-read-overlay");
    if (old && old.parentNode) old.parentNode.removeChild(old);
    const overlay = document.createElement("div");
    overlay.className = "detail-read-overlay";
    overlay.innerHTML =
      '<div class="detail-read-dialog">' +
      '<div class="detail-read-head"><p class="detail-read-title">' +
      escapeHtml(title || "Açıklama") +
      '</p><button type="button" class="detail-read-close">Kapat</button></div>' +
      '<div class="detail-read-content">' +
      escapeHtml(text || "") +
      "</div></div>";
    const close = () => {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    };
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    overlay.querySelector(".detail-read-close").addEventListener("click", close);
    document.body.appendChild(overlay);
  }

  function renderDetailDescription(item, need) {
    const body = $("dBody");
    if (!body) return;
    const raw = String((item && item.description) || "").trim();
    const plusWarnText = need ? "Dikkat: Bu içerik +PLUS üyelik gerektirir. Abonelik sayfasına yönlenebilirsiniz." : "";
    const readText = (raw || "-") + (plusWarnText ? "\n\n" + plusWarnText : "");
    body.innerHTML =
      '<div class="detail-body-wrap">' +
      '<p class="detail-desc-text is-clamped">' +
      escapeHtml(raw || "-") +
      "</p>" +
      (need ? '<p class="detail-plus-warning"><strong>Dikkat:</strong> Bu içerik +PLUS üyelik gerektirir. Abonelik sayfasına yönlenebilirsiniz.</p>' : "") +
      '<button type="button" class="detail-read-more-btn hidden">Devamını oku</button>' +
      "</div>";
    const descEl = body.querySelector(".detail-desc-text");
    const moreBtn = body.querySelector(".detail-read-more-btn");
    if (!descEl || !moreBtn) return;
    const ensureOverflowState = () => {
      const hasOverflow = descEl.scrollHeight - descEl.clientHeight > 2;
      moreBtn.classList.toggle("hidden", !hasOverflow);
    };
    requestAnimationFrame(ensureOverflowState);
    window.addEventListener("resize", ensureOverflowState, { once: true });
    moreBtn.addEventListener("click", () => {
      openDetailReadOverlay(item && item.title ? item.title : "Açıklama", readText);
    });
  }

  function openDetail(item, id) {
    state.selectedDetailId = id;
    $("dTitle").textContent = item.title || "";
    const hero = $("dHero");
    if (hero) {
      const bg = item.backdropUrl || item.posterUrl || "";
      hero.style.backgroundImage = bg ? "url(" + JSON.stringify(bg).slice(1, -1) + ")" : "";
    }
    const dMeta = $("dMeta");
    if (dMeta) {
      const bits = [];
      if (item.year) bits.push('<span class="detail-chip">' + item.year + "</span>");
      if (item.maturity) bits.push('<span class="detail-chip">' + item.maturity + "</span>");
      const d = formatDuration(item);
      if (d) bits.push('<span class="detail-chip">' + d + "</span>");
      if (isProContent(item)) bits.push('<span class="detail-chip detail-chip-pro">+PLUS</span>');
      const epsCount = sortedEpisodes(item).length;
      if (epsCount > 1) bits.push('<span class="detail-chip detail-chip-episodes">' + epsCount + " Bölüm</span>");
      dMeta.innerHTML = bits.join("");
    }
    const need = isProContent(item) && !canPlay(item);
    renderDetailDescription(item, need);
    const eps = sortedEpisodes(item);
    $("detailModal").classList.add("open");
    updateDetailListButton(id);
    $("dPlay").onclick = function () {
      if (need) {
        window.location.href = "subscribe.html";
        return;
      }
      let url = "watch.html?id=" + encodeURIComponent(id);
      if (eps.length && eps[0].id) url += "&ep=" + encodeURIComponent(eps[0].id);
      window.location.href = url;
    };
  }

  function card(item, id) {
    const el = document.createElement("article");
    el.className = "card";
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    const duration = formatDuration(item);
    const episodeCount = Array.isArray(item && item.episodes) ? item.episodes.length : 0;
    el.innerHTML =
      '<div class="card-media' +
      (canUseMyList() ? " has-list-btn" : "") +
      '"><img class="card-poster" alt="" src="' +
      (item.posterUrl || "") +
      '" loading="lazy" />' +
      (canUseMyList()
        ? '<button type="button" class="card-list-btn' +
          (state.myList[id] ? " is-added" : "") +
          '" data-list-toggle="' +
          id +
          '">' +
          (state.myList[id] ? "Listenden çıkar" : "Listene ekle") +
          "</button>"
        : "") +
      (episodeCount > 1 ? '<span class="card-episodes-badge">' + episodeCount + " Bölüm</span>" : "") +
      "</div>" +
      '<div class="card-body"><div class="card-title"></div><div class="card-meta-row">' +
      (duration ? '<span class="card-duration">' + duration + "</span>" : "") +
      (isProContent(item) ? '<span class="card-pro">+PLUS</span>' : "") +
      "</div></div>";
    el.querySelector(".card-title").textContent = item.title || "Başlıksız";
    const listBtn = el.querySelector(".card-list-btn");
    if (listBtn) {
      listBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          await handleMyListToggle(id, listBtn);
        } catch (err) {
          alert(dehlizUserError(err, "Liste işlemi başarısız."));
        }
      });
    }
    el.addEventListener("click", () => openDetail(item, id));
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openDetail(item, id);
      }
    });
    return el;
  }

  function renderCategory() {
    const cid = state.categoryId;
    const cat = state.categories[cid];
    $("catTitle").textContent = SPECIAL_CATEGORY_TITLES[cid] || (cat && cat.name) || "Kategori";
    const all = Object.entries(state.content || {}).map(([id, v]) => ({ id, ...v }));
    let list = [];
    if (isMostWatchedCategory(cid, cat && cat.name)) {
      const ids = Array.isArray(state.settings.mostWatchedContentIds) ? state.settings.mostWatchedContentIds : [];
      list = ids
        .map((id) => {
          const v = state.content[id];
          return v ? { id, ...v } : null;
        })
        .filter(Boolean)
        .slice(0, 10);
    } else if (cid === "__my_list__") {
      if (!canUseMyList()) {
        list = [];
      } else {
        const ids = Object.keys(state.myList || {}).filter((k) => state.myList[k]);
        list = ids
          .map((id) => {
            const v = state.content[id];
            return v ? { id, ...v } : null;
          })
          .filter(Boolean);
      }
    } else if (isPlusCategory(cid, cat && cat.name)) {
      list = all.filter((x) => x.isPro === true).sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
    } else if (isLatestCategory(cid, cat && cat.name)) {
      list = all.sort((a, b) => {
        const tb = Number(b.createdAt || b.updatedAt || 0);
        const ta = Number(a.createdAt || a.updatedAt || 0);
        if (tb !== ta) return tb - ta;
        return String(b.id || "").localeCompare(String(a.id || ""), "tr");
      });
    } else if (isArchiveCategory(cid, cat && cat.name)) {
      list = all.sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
    } else {
      list = all
        .filter((x) => Array.isArray(x.categories) && x.categories.indexOf(cid) !== -1)
        .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
    }
    $("catMeta").textContent = list.length + " içerik bulundu";
    const grid = $("catGrid");
    grid.innerHTML = "";
    if (!list.length) {
      if (cid === "__my_list__" && !canUseMyList()) {
        grid.innerHTML = '<p style="color:#a1a1aa">Bu sayfa yalnızca +PLUS üyeler içindir.</p>';
      } else {
        grid.innerHTML = '<p style="color:#a1a1aa">Bu kategoride henüz içerik yok.</p>';
      }
      return;
    }
    list.forEach((it) => grid.appendChild(card(it, it.id)));
  }

  function updateAuthUi() {
    $("btnLogin").style.display = state.user ? "none" : "inline-block";
    $("btnLogout").style.display = state.user ? "inline-block" : "none";
    $("navUserBlock").classList.toggle("nav-user--hidden", !state.user);
    const mail = state.user && state.user.email ? state.user.email : "";
    $("userEmail").textContent = mail;
    $("userEmail").title = mail;
    $("proChip").style.display = isPlusMember(state.profile) ? "inline-flex" : "none";
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
        await dehlizAuth.signInWithEmailAndPassword(($("em").value || "").trim(), $("pw").value || "");
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
      state.user = user;
      if (user) {
        await DataService.ensureUserProfile(user);
        state.profile = await DataService.userOnce(user.uid);
        state.isAdmin = await DataService.isAdmin(user);
        if (state.myListRef) state.myListRef.off();
        state.myListRef = DataService.userListRef(user.uid);
        state.myListRef.on("value", (snap) => {
          state.myList = snap.val() || {};
          // Sadece "Listeniz" sayfasinda icerik listesi degistigi icin tam render gerekli.
          // Diger sayfalarda konum kaymasini engellemek icin buton durumlarini yerinde guncelle.
          if (state.categoryId === "__my_list__") renderCategory();
          else {
            syncRenderedMyListButtons();
            const detailOpen = $("detailModal") && $("detailModal").classList.contains("open");
            if (detailOpen && state.selectedDetailId) updateDetailListButton(state.selectedDetailId);
          }
        });
      } else {
        state.profile = null;
        state.isAdmin = false;
        state.myList = {};
        if (state.myListRef) {
          state.myListRef.off();
          state.myListRef = null;
        }
      }
      updateAuthUi();
      renderCategory();
    });
  }

  function wireModals() {
    document.querySelectorAll("[data-close]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-close");
        if (id) $(id).classList.remove("open");
      });
    });
    $("authModal").addEventListener("click", (e) => {
      if (e.target === $("authModal")) $("authModal").classList.remove("open");
    });
    $("detailModal").addEventListener("click", (e) => {
      if (e.target === $("detailModal")) $("detailModal").classList.remove("open");
    });
  }

  async function run() {
    state.categoryId = query("cid");
    state.settings = (await DataService.settingsOnce()) || {};
    state.categories = (await DataService.categoriesOnce()) || {};
    state.content = (await DataService.contentOnce()) || {};
    renderCategory();
  }

  document.addEventListener("DOMContentLoaded", async () => {
    wireModals();
    wireAuth();
    try {
      await run();
    } catch (e) {
      console.error(e);
      $("catMeta").textContent = "Kategori yüklenirken hata oluştu.";
    }
  });
})();
