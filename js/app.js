(function () {
  const $ = (id) => document.getElementById(id);

  let state = {
    settings: {},
    categories: {},
    content: {},
    contentList: [],
    heroItems: [],
    heroIndex: 0,
    heroTimer: null,
    user: null,
    profile: null,
    isAdmin: false,
    myList: {},
    selectedId: null,
    heroTouchStartX: null,
    heroTransitionTimer: null,
    myListRef: null
  };
  let rowsRenderQueued = false;
  let contentRefreshTimer = null;
  let catalogPollTimer = null;
  let liveCatalogAttached = false;
  let activeProfileTab = "account";
  const MY_LIST_TOGGLE_COOLDOWN_MS = 1200;
  const myListToggleLockById = Object.create(null);
  const myListToggleLastAtById = Object.create(null);

  function openProfileTab(tab) {
    activeProfileTab = tab === "subscription" ? "subscription" : "account";
    document.querySelectorAll("[data-profile-tab]").forEach((btn) => {
      const isActive = btn.getAttribute("data-profile-tab") === activeProfileTab;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    document.querySelectorAll("[data-profile-panel]").forEach((panel) => {
      const isActive = panel.getAttribute("data-profile-panel") === activeProfileTab;
      panel.classList.toggle("hidden", !isActive);
      panel.setAttribute("aria-hidden", isActive ? "false" : "true");
    });
    const saveBtn = $("btnSaveProfile");
    if (saveBtn) saveBtn.style.display = activeProfileTab === "account" ? "inline-block" : "none";
  }

  function openUiDialog(config) {
    const title = document.getElementById("uiDialogTitle");
    const message = document.getElementById("uiDialogMessage");
    const actions = document.getElementById("uiDialogActions");
    const backdrop = document.getElementById("uiDialogModal");
    const closeBtn = document.getElementById("uiDialogClose");
    if (!title || !message || !actions || !backdrop || !closeBtn) return Promise.resolve(false);

    title.textContent = (config && config.title) || "Bilgi";
    message.textContent = (config && config.message) || "";
    actions.innerHTML = "";

    const buttons = Array.isArray(config && config.buttons) && config.buttons.length ? config.buttons : [{ label: "Kapat", value: true }];
    return new Promise((resolve) => {
      const cleanup = () => {
        backdrop.classList.remove("open");
        backdrop.removeEventListener("click", onBackdropClick);
        closeBtn.removeEventListener("click", onClose);
      };
      const done = (value) => {
        cleanup();
        resolve(value);
      };
      const onBackdropClick = (e) => {
        if (e.target === backdrop) done(false);
      };
      const onClose = () => done(false);

      buttons.forEach((btnCfg, idx) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn " + (btnCfg.className || "btn-ghost");
        btn.textContent = btnCfg.label || "Tamam";
        btn.addEventListener("click", () => done(btnCfg.value));
        actions.appendChild(btn);
        if (idx === buttons.length - 1) setTimeout(() => btn.focus(), 0);
      });

      backdrop.addEventListener("click", onBackdropClick);
      closeBtn.addEventListener("click", onClose);
      backdrop.classList.add("open");
    });
  }

  function readRenewalAt(profile) {
    if (!profile) return 0;
    const sub = profile.subscription || {};
    const candidates = [
      sub.nextBillingAt,
      sub.renewAt,
      sub.renewalAt,
      sub.expiresAt,
      sub.plusUntil,
      profile.nextBillingAt,
      profile.renewAt,
      profile.expiresAt,
      profile.plusUntil
    ];
    for (let i = 0; i < candidates.length; i++) {
      const n = Number(candidates[i]);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return 0;
  }

  function renewalDaysText(ts) {
    if (!ts) return "Yenileme tarihi henüz tanımlı değil.";
    const now = Date.now();
    const diffMs = ts - now;
    const dayMs = 24 * 60 * 60 * 1000;
    const days = Math.ceil(Math.abs(diffMs) / dayMs);
    const date = new Date(ts).toLocaleDateString("tr-TR");
    if (diffMs >= 0) {
      return "Bir sonraki yenileme: " + date + " (" + days + " gün sonra).";
    }
    return "Yenileme tarihi geçmiş: " + date + " (" + days + " gün önce).";
  }

  function renderSubscriptionPanel() {
    const badge = $("subPlanBadge");
    const renew = $("subRenewText");
    const cancelBtn = $("btnCancelSubscription");
    if (!badge || !renew || !cancelBtn) return;
    const profile = state.profile || {};
    const isPlus = isPlusMember(profile);
    const sub = profile.subscription || {};
    const cancelPending = sub.cancelAtPeriodEnd === true || sub.status === "cancel_pending";

    badge.classList.remove("plus", "free");
    if (isPlus) {
      badge.textContent = "+PLUS AKTİF";
      badge.classList.add("plus");
    } else {
      badge.textContent = "ÜCRETSİZ PLAN";
      badge.classList.add("free");
    }

    const renewalAt = readRenewalAt(profile);
    let renewLine = renewalDaysText(renewalAt);
    if (cancelPending) renewLine += " İptal talebiniz alındı, dönem sonunda yenileme durdurulacak.";
    renew.textContent = renewLine;

    cancelBtn.disabled = !isPlus || cancelPending;
    cancelBtn.textContent = cancelPending ? "İptal talebi alındı" : "Aboneliği iptal et";
  }

  function clearProfileMessages() {
    $("profileErr").style.display = "none";
    $("profileOk").style.display = "none";
  }

  function clearRecoveryMessages() {
    $("recErr").style.display = "none";
    $("recOk").style.display = "none";
  }

  function recoveryEndpoint() {
    const base = (window.DEHLIZ_CONFIG && window.DEHLIZ_CONFIG.recoveryApiBase) || "";
    if (!base) return "";
    return base.replace(/\/$/, "") + "/accountRecovery";
  }

  async function recoveryApi(payload) {
    const endpoint = recoveryEndpoint();
    if (!endpoint) throw new Error("Kurtarma servisi yapılandırılmadı.");
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {})
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error((data && data.message) || "İşlem başarısız.");
    return data;
  }

  function hideLoading() {
    const loading = $("loading");
    if (!loading) return Promise.resolve();
    loading.classList.add("is-completing");
    return new Promise((resolve) => {
      setTimeout(() => {
        loading.classList.add("hidden");
        resolve();
      }, 980);
    });
  }

  function sortCategories(obj) {
    return Object.entries(obj || {}).sort((a, b) => {
      const oa = a[1].order != null ? a[1].order : 999;
      const ob = b[1].order != null ? b[1].order : 999;
      return oa - ob;
    });
  }

  function contentEntries() {
    return Object.entries(state.content || {});
  }

  function shuffleList(arr) {
    const out = (arr || []).slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = out[i];
      out[i] = out[j];
      out[j] = t;
    }
    return out;
  }

  const SPECIAL_CATEGORIES = [
    { id: "__my_list__", name: "LİSTENİZ" },
    { id: "__latest__", name: "Son Yüklenenler" },
    { id: "__most_watched__", name: "En Çok İzlenenler" },
    { id: "__plus__", name: "+Plus" }
  ];

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

  function showMyListNotice(added) {
    const old = document.getElementById("myListActionNotice");
    if (old && old.parentNode) old.parentNode.removeChild(old);
    const box = document.createElement("div");
    box.id = "myListActionNotice";
    box.className = "my-list-action-notice" + (added ? "" : " is-removed");
    box.innerHTML =
      '<div class="my-list-action-notice-title">' +
      (added ? "Listenize eklendi" : "Listenizden çıkarıldı") +
      '</div><div class="my-list-action-notice-text">' +
      (added
        ? "İçerik listenize başarıyla kaydedildi."
        : "İçerik listenizden kaldırıldı.") +
      "</div>";
    document.body.appendChild(box);
    requestAnimationFrame(() => box.classList.add("show"));
    setTimeout(() => {
      box.classList.remove("show");
      setTimeout(() => {
        if (box.parentNode) box.parentNode.removeChild(box);
      }, 260);
    }, 1900);
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
    return id === "son yuklenenler" || nm === "son yuklenenler";
  }

  function isMostWatchedCategory(cid, name) {
    const id = normalizeCategoryLabel(cid).replace(/_/g, " ");
    const nm = normalizeCategoryLabel(name);
    return id === "en cok izlenenler" || nm === "en cok izlenenler";
  }

  function isPlusCategory(cid, name) {
    const id = normalizeCategoryLabel(cid).replace(/_/g, " ");
    const nm = normalizeCategoryLabel(name);
    return id === "plus icerikler" || id === "plus" || nm === "plus icerikler" || nm === "plus";
  }

  function isArchiveCategory(cid, name) {
    const id = normalizeCategoryLabel(cid).replace(/_/g, " ");
    const nm = normalizeCategoryLabel(name);
    return id === "tum arsiv" || nm === "tum arsiv";
  }

  function mostWatchedItems() {
    const ids = Array.isArray(state.settings.mostWatchedContentIds) ? state.settings.mostWatchedContentIds : [];
    const list = [];
    ids.forEach((id) => {
      const item = state.content[id];
      if (item) list.push({ id, ...item });
    });
    return list.slice(0, 10);
  }

  function categoryItems(cid) {
    const all = contentEntries().map(([id, v]) => ({ id, ...v }));
    const cat = state.categories[cid] || {};
    const catName = cat.name || cid;
    if (cid === "__my_list__") {
      const ids = Object.keys(state.myList || {}).filter((k) => state.myList[k]);
      return ids.map((id) => state.content[id] && { id, ...state.content[id] }).filter(Boolean);
    }
    if (cid === "__most_watched__" || isMostWatchedCategory(cid, catName)) {
      return mostWatchedItems();
    }
    if (cid === "__plus__" || isPlusCategory(cid, catName)) {
      return shuffleList(all.filter((x) => x.isPro === true));
    }
    if (cid === "__latest__" || isLatestCategory(cid, catName)) {
      return all
        .sort((a, b) => {
          const tb = Number(b.createdAt || b.updatedAt || 0);
          const ta = Number(a.createdAt || a.updatedAt || 0);
          if (tb !== ta) return tb - ta;
          return String(b.id || "").localeCompare(String(a.id || ""), "tr");
        })
        .slice(0, 40);
    }
    if (isArchiveCategory(cid, catName)) return shuffleList(all);
    return shuffleList(all.filter((x) => Array.isArray(x.categories) && x.categories.indexOf(cid) !== -1));
  }

  function mergedCategories() {
    const normal = sortCategories(state.categories)
      .filter(([, cat]) => cat.visible !== false)
      .map(([id, cat]) => ({ id, name: cat.name || id }));
    const hasEquivalent = (spec) =>
      normal.some((c) => {
        if (spec.id === "__my_list__") {
          const id = normalizeCategoryLabel(c.id).replace(/_/g, " ");
          const nm = normalizeCategoryLabel(c.name);
          return id === "listeniz" || nm === "listeniz";
        }
        if (spec.id === "__latest__") return isLatestCategory(c.id, c.name);
        if (spec.id === "__most_watched__") return isMostWatchedCategory(c.id, c.name);
        if (spec.id === "__plus__") return isPlusCategory(c.id, c.name);
        return false;
      });
    const specials = SPECIAL_CATEGORIES.filter((c) => {
      if (hasEquivalent(c)) return false;
      if (c.id === "__my_list__") return canUseMyList();
      return categoryItems(c.id).length > 0;
    });
    const seen = new Set();
    return specials.concat(normal).filter((c) => {
      const key = normalizeCategoryLabel(c.name || c.id);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function categoryAnchorId(cid) {
    return "cat-row-" + String(cid || "").replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  function categoryPageHref(cid) {
    return "category.html?cid=" + encodeURIComponent(cid || "");
  }

  function searchPageHref(query) {
    return "search.html?q=" + encodeURIComponent(String(query || "").trim());
  }

  function normalizeSearchText(value) {
    return String(value || "")
      .trim()
      .toLocaleLowerCase("tr-TR")
      .replace(/\s+/g, " ");
  }

  function searchPool() {
    return Object.entries(state.content || {}).map(([id, value]) => ({ id, ...(value || {}) }));
  }

  function scoreSearchItem(item, query) {
    const q = normalizeSearchText(query);
    if (!q) return 0;
    const title = normalizeSearchText(item && item.title);
    const desc = normalizeSearchText(item && item.description);
    const cats = Array.isArray(item && item.categories) ? item.categories.map((x) => normalizeSearchText(x)).join(" ") : "";
    const hay = (title + " " + desc + " " + cats).trim();
    if (!hay) return 0;

    let score = 0;
    if (title === q) score += 220;
    if (title.startsWith(q)) score += 160;
    if (title.indexOf(q) !== -1) score += 110;
    if (desc.indexOf(q) !== -1) score += 45;
    if (cats.indexOf(q) !== -1) score += 30;
    const qWords = q.split(" ").filter(Boolean);
    qWords.forEach((w) => {
      if (title.indexOf(w) !== -1) score += 20;
      else if (hay.indexOf(w) !== -1) score += 8;
    });
    return score;
  }

  function searchItems(query, limit) {
    const q = normalizeSearchText(query);
    if (!q) return [];
    const ranked = searchPool()
      .map((item) => ({ item, score: scoreSearchItem(item, q) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return String(a.item.title || "").localeCompare(String(b.item.title || ""), "tr");
      })
      .map((x) => x.item);
    if (limit && limit > 0) return ranked.slice(0, limit);
    return ranked;
  }

  function buildSearchSuggestionCard(item) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "search-suggest-card";
    const poster = item.posterUrl || item.backdropUrl || "";
    const chips = [];
    if (item.year) chips.push('<span class="search-suggest-chip">' + String(item.year) + "</span>");
    if (item.maturity) chips.push('<span class="search-suggest-chip">' + escapeHtml(item.maturity) + "</span>");
    if (isProContent(item)) chips.push('<span class="search-suggest-chip plus">+PLUS</span>');
    btn.innerHTML =
      '<img class="search-suggest-poster" alt="" src="' +
      escapeHtml(poster) +
      '" loading="lazy" />' +
      '<div class="search-suggest-body">' +
      '<p class="search-suggest-title">' +
      escapeHtml(item.title || "Başlıksız") +
      "</p>" +
      '<div class="search-suggest-meta">' +
      chips.join("") +
      "</div></div>";
    btn.addEventListener("click", () => {
      closeSearchSuggest();
      openDetail(item, item.id);
    });
    return btn;
  }

  function closeSearchSuggest() {
    const wrap = $("navSearchSuggest");
    if (!wrap) return;
    wrap.classList.add("hidden");
    wrap.innerHTML = "";
  }

  function renderSearchSuggest(query) {
    const wrap = $("navSearchSuggest");
    if (!wrap) return;
    const q = String(query || "").trim();
    if (!q) {
      closeSearchSuggest();
      return;
    }
    const results = searchItems(q, 5);
    wrap.innerHTML = "";
    if (!results.length) {
      wrap.innerHTML = '<p class="search-suggest-empty">Eşleşme bulunamadı. Tüm sonuçlar için Ara düğmesini kullanın.</p>';
      wrap.classList.remove("hidden");
      return;
    }
    results.forEach((item) => wrap.appendChild(buildSearchSuggestionCard(item)));
    wrap.classList.remove("hidden");
  }

  function wireSearch() {
    const form = $("navSearchForm");
    const input = $("navSearchInput");
    const wrap = $("navSearchWrap");
    if (!form || !input || !wrap) return;

    input.addEventListener("input", () => {
      renderSearchSuggest(input.value);
    });
    input.addEventListener("focus", () => {
      if ((input.value || "").trim()) renderSearchSuggest(input.value);
    });
    document.addEventListener("click", (e) => {
      if (wrap.contains(e.target)) return;
      closeSearchSuggest();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeSearchSuggest();
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const q = (input.value || "").trim();
      if (!q) return;
      window.location.href = searchPageHref(q);
    });
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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

  function buildHeroList() {
    const ids = state.settings.heroContentIds;
    const list = [];
    if (Array.isArray(ids) && ids.length > 0) {
      ids.forEach((id) => {
        const item = state.content[id];
        if (item) list.push({ id, ...item });
      });
      return list;
    }
    const featured = contentEntries()
      .map(([id, v]) => ({ id, ...v }))
      .filter((x) => x.featured)
      .sort((a, b) => (a.featuredOrder || 0) - (b.featuredOrder || 0));
    return featured.length ? featured : contentEntries().map(([id, v]) => ({ id, ...v })).slice(0, 5);
  }

  function renderHeroDots() {
    const wrap = $("heroDots");
    wrap.innerHTML = "";
    state.heroItems.forEach((_, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = i === state.heroIndex ? "active" : "";
      b.setAttribute("aria-label", "Slayt " + (i + 1));
      b.addEventListener("click", () => {
        state.heroIndex = i;
        paintHero(true);
        restartHeroTimer();
      });
      wrap.appendChild(b);
    });
  }

  function paintHero(animate) {
    const applyContent = () => {
      const item = state.heroItems[state.heroIndex];
      const prev = $("heroPrev");
      const next = $("heroNext");
      if (!item) {
        $("heroTitle").textContent = state.settings.siteTitle || "DEHLİZ";
        $("heroMeta").innerHTML = "";
        $("heroDesc").textContent =
          state.settings.tagline || "Korkunun yeni adresi. Oturum aç, izlemeye başla.";
        $("heroBg").style.backgroundImage = "";
        $("heroDots").innerHTML = "";
        if (prev) prev.disabled = true;
        if (next) next.disabled = true;
        return;
      }
      $("heroTitle").textContent = item.title || "Başlıksız";
      $("heroMeta").innerHTML = "";
      const frag = document.createDocumentFragment();
      if (item.year) {
        const s = document.createElement("span");
        s.textContent = item.year;
        frag.appendChild(s);
      }
      if (item.maturity) {
        const s = document.createElement("span");
        s.textContent = item.maturity;
        frag.appendChild(s);
      }
      if (item.isPro) {
        const s = document.createElement("span");
        s.className = "pro-badge";
        s.textContent = "+PLUS";
        frag.appendChild(s);
      }
      $("heroMeta").appendChild(frag);
      $("heroDesc").textContent = item.description || "";
      const bg = item.backdropUrl || item.posterUrl || "";
      $("heroBg").style.backgroundImage = bg ? "url(" + JSON.stringify(bg).slice(1, -1) + ")" : "";
      const disabled = state.heroItems.length <= 1;
      if (prev) prev.disabled = disabled;
      if (next) next.disabled = disabled;
      renderHeroDots();
    };

    const heroBg = $("heroBg");
    const heroInner = document.querySelector(".hero-inner");
    if (!animate || !heroBg || !heroInner) {
      applyContent();
      return;
    }
    if (state.heroTransitionTimer) clearTimeout(state.heroTransitionTimer);
    heroBg.classList.add("is-transitioning");
    heroInner.classList.add("is-transitioning");
    state.heroTransitionTimer = setTimeout(() => {
      applyContent();
      requestAnimationFrame(() => {
        heroBg.classList.remove("is-transitioning");
        heroInner.classList.remove("is-transitioning");
      });
      state.heroTransitionTimer = null;
    }, 170);
  }

  function stepHero(dir) {
    const len = state.heroItems.length;
    if (len <= 1) return;
    state.heroIndex = (state.heroIndex + dir + len) % len;
    paintHero(true);
    restartHeroTimer();
  }

  function restartHeroTimer() {
    if (state.heroTimer) clearInterval(state.heroTimer);
    const ms = Number(state.settings.heroIntervalMs) || 8000;
    if (state.heroItems.length <= 1) return;
    state.heroTimer = setInterval(() => {
      state.heroIndex = (state.heroIndex + 1) % state.heroItems.length;
      paintHero(true);
    }, ms);
  }

  function canPlay(item) {
    if (!isProContent(item)) return true;
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
      const result = await DataService.toggleMyListSecure(id);
      myListToggleLastAtById[id] = Date.now();
      showMyListNotice(result && result.added === true);
      return true;
    } finally {
      myListToggleLockById[id] = false;
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
    if (state.selectedId && state.content[state.selectedId]) {
      updateDetailListButton(state.content[state.selectedId], state.selectedId);
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

  function updateDetailListButton(item, id) {
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
    btn.textContent = listed ? "Listenden çıkar" : "Listene ekle";
    btn.classList.toggle("is-added", listed);
    btn.onclick = async function () {
      try {
        await handleMyListToggle(id, btn);
      } catch (e) {
        alert(dehlizUserError(e, "Liste işlemi başarısız."));
      }
    };
  }

  function goWatch(id) {
    window.location.href = "watch.html?id=" + encodeURIComponent(id);
  }

  function goWatchEpisode(id, ep) {
    let url = "watch.html?id=" + encodeURIComponent(id);
    if (ep) url += "&ep=" + encodeURIComponent(ep);
    window.location.href = url;
  }

  function sortedEpisodes(item) {
    return (Array.isArray(item && item.episodes) ? item.episodes : [])
      .slice()
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
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
    state.selectedId = id;
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
    updateDetailListButton(item, id);
    $("dPlay").onclick = function () {
      if (need) {
        window.location.href = "subscribe.html";
        return;
      }
      if (eps.length && eps[0].id) goWatchEpisode(id, eps[0].id);
      else goWatch(id);
    };
  }

  function card(item, id, rowIndex, colIndex) {
    const el = document.createElement("article");
    el.className = "card";
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    el.dataset.row = String(rowIndex);
    el.dataset.col = String(colIndex);
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
    el.querySelector(".card-poster").onerror = function () {
      this.style.opacity = "0.35";
      this.removeAttribute("src");
    };
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

  function viewAllCard(cid, rowIndex, colIndex) {
    const el = document.createElement("article");
    el.className = "card card-view-all";
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    el.dataset.row = String(rowIndex);
    el.dataset.col = String(colIndex);
    el.innerHTML =
      '<div class="card-view-all-inner"><div class="card-view-all-title">Tümünü gör</div><div class="card-view-all-sub">Bu kategorideki tüm içerikleri aç</div></div>';
    const go = () => {
      window.location.href = categoryPageHref(cid);
    };
    el.addEventListener("click", go);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        go();
      }
    });
    return el;
  }

  function rowControls(row, leftBtn, rightBtn) {
    const step = Math.max(260, Math.floor(row.clientWidth * 0.82));
    const safeScrollBy = (delta) => {
      try {
        row.scrollBy({ left: delta, behavior: "smooth" });
      } catch (_e) {
        row.scrollLeft += delta;
      }
      // Bazi TV tarayicilarinda scrollBy sessizce etkisiz kalabiliyor.
      // Kisa gecikme sonra hala hareket yoksa manuel fallback uygula.
      const before = row.scrollLeft;
      setTimeout(() => {
        if (Math.abs(row.scrollLeft - before) < 2) row.scrollLeft += delta;
      }, 80);
    };
    leftBtn.addEventListener("click", () => safeScrollBy(-step));
    rightBtn.addEventListener("click", () => safeScrollBy(step));
    const update = () => {
      const overflow = row.scrollWidth - row.clientWidth;
      const max = overflow - 2;
      if (overflow <= 4) {
        leftBtn.disabled = true;
        rightBtn.disabled = true;
        return;
      }
      leftBtn.disabled = row.scrollLeft <= 2;
      rightBtn.disabled = row.scrollLeft >= max;
    };
    row.addEventListener("scroll", update, { passive: true });
    row.addEventListener(
      "wheel",
      (e) => {
        if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
        const max = Math.max(0, row.scrollWidth - row.clientWidth);
        if (max <= 0) return;
        const atStart = row.scrollLeft <= 1;
        const atEnd = row.scrollLeft >= max - 1;
        const movingRight = e.deltaY > 0;
        const movingLeft = e.deltaY < 0;

        // Yalnızca satır içinde gerçekten yatay ilerleme varsa tekeri yakala.
        // Kenara gelindiğinde olayı bırakıp sayfanın dikey scroll'una izin ver.
        if ((movingRight && atEnd) || (movingLeft && atStart)) return;

        row.scrollBy({ left: e.deltaY, behavior: "auto" });
        e.preventDefault();
      },
      { passive: false }
    );
    window.addEventListener("resize", update);
    row.addEventListener("mouseenter", update);
    row.addEventListener("mousemove", update);
    row.querySelectorAll("img").forEach((img) => {
      if (!img.complete) img.addEventListener("load", update, { once: true });
    });
    setTimeout(update, 120);
    setTimeout(update, 600);
    update();
    return update;
  }

  function openCategoriesMenu() {
    const menu = $("navCategoriesMenu");
    const btn = $("navCategoriesBtn");
    if (!menu || !btn) return;
    const nav = $("nav");
    if (nav) {
      const rect = nav.getBoundingClientRect();
      menu.style.top = Math.max(52, rect.bottom + 6) + "px";
    }
    btn.setAttribute("aria-expanded", "true");
    menu.classList.add("open");
  }

  function closeCategoriesMenu() {
    const menu = $("navCategoriesMenu");
    const btn = $("navCategoriesBtn");
    if (!menu || !btn) return;
    btn.setAttribute("aria-expanded", "false");
    menu.classList.remove("open");
  }

  function renderCategoriesMenu() {
    const menu = $("navCategoriesMenu");
    if (!menu) return;
    const cats = mergedCategories();
    if (!cats.length) {
      menu.innerHTML = '<p class="cat-menu-empty" style="margin:0;color:#a1a1aa">Henüz kategori yok.</p>';
      return;
    }
    menu.innerHTML = "";
    const grid = document.createElement("div");
    grid.className = "cat-menu-grid";
    cats.forEach((cat) => {
      const cid = cat.id;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "cat-menu-item";
      b.textContent = cat.name || cid;
      b.addEventListener("click", () => {
        closeCategoriesMenu();
        const el = document.getElementById(categoryAnchorId(cid));
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      grid.appendChild(b);
    });
    menu.appendChild(grid);
  }

  function wireRowProgress(row, fill) {
    const update = () => {
      const max = Math.max(1, row.scrollWidth - row.clientWidth);
      const p = Math.min(1, Math.max(0, row.scrollLeft / max));
      fill.style.width = (p * 100).toFixed(2) + "%";
    };
    row.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    update();
  }

  function tvKeyboardNavigation(row) {
    row.addEventListener("keydown", (e) => {
      const active = document.activeElement;
      if (!active || !active.classList.contains("card")) return;
      const cards = Array.from(row.querySelectorAll(".card"));
      const idx = cards.indexOf(active);
      if (idx < 0) return;
      if (e.key === "ArrowRight" && idx < cards.length - 1) {
        e.preventDefault();
        cards[idx + 1].focus();
        cards[idx + 1].scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      } else if (e.key === "ArrowLeft" && idx > 0) {
        e.preventDefault();
        cards[idx - 1].focus();
        cards[idx - 1].scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const dir = e.key === "ArrowDown" ? 1 : -1;
        const allRows = Array.from(document.querySelectorAll(".row-scroll"));
        const rowIdx = allRows.indexOf(row);
        const targetRow = allRows[rowIdx + dir];
        if (!targetRow) return;
        const targetCards = Array.from(targetRow.querySelectorAll(".card"));
        if (!targetCards.length) return;
        e.preventDefault();
        const target = targetCards[Math.min(idx, targetCards.length - 1)];
        target.focus();
        target.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      }
    });
  }

  function renderRows() {
    const main = $("rows");
    const rowScrollState = {};
    const prevRows = main.querySelectorAll(".row-block");
    prevRows.forEach((block) => {
      const row = block.querySelector(".row-scroll");
      if (!row || !block.id) return;
      rowScrollState[block.id] = row.scrollLeft;
    });
    const prevWindowY = window.scrollY || window.pageYOffset || 0;
    main.innerHTML = "";
    const cats = mergedCategories();
    cats.forEach((cat, rowIndex) => {
      const cid = cat.id;
      const block = document.createElement("section");
      block.className = "row-block";
      block.id = categoryAnchorId(cid);
      const h = document.createElement("h3");
      h.className = "row-title";
      h.textContent = cat.name || cid;
      const viewAll = document.createElement("a");
      viewAll.className = "row-view-all";
      viewAll.href = categoryPageHref(cid);
      viewAll.textContent = "Tümünü gör";
      viewAll.setAttribute("aria-label", (cat.name || "Kategori") + " kategorisindeki tüm içerikleri gör");
      const titleWrap = document.createElement("div");
      titleWrap.className = "row-title-wrap";
      titleWrap.appendChild(h);
      titleWrap.appendChild(viewAll);
      const nav = document.createElement("div");
      nav.className = "row-nav";
      const prev = document.createElement("button");
      prev.type = "button";
      prev.className = "row-arrow";
      prev.textContent = "‹";
      prev.setAttribute("aria-label", "Sola kaydır");
      const next = document.createElement("button");
      next.type = "button";
      next.className = "row-arrow";
      next.textContent = "›";
      next.setAttribute("aria-label", "Sağa kaydır");
      nav.appendChild(prev);
      nav.appendChild(next);
      const head = document.createElement("div");
      head.className = "row-head";
      head.appendChild(titleWrap);
      head.appendChild(nav);
      const row = document.createElement("div");
      row.className = "row-scroll";
      const progress = document.createElement("div");
      progress.className = "row-progress";
      const progressFill = document.createElement("div");
      progressFill.className = "row-progress-fill";
      progress.appendChild(progressFill);
      const items = categoryItems(cid);
      const limitedItems = items.slice(0, 15);
      limitedItems.forEach((it, colIndex) => row.appendChild(card(it, it.id, rowIndex, colIndex)));
      if (items.length > 15) row.appendChild(viewAllCard(cid, rowIndex, limitedItems.length));
      if (items.length) {
        const refreshRowControls = rowControls(row, prev, next);
        tvKeyboardNavigation(row);
        wireRowProgress(row, progressFill);
        block.addEventListener("mouseenter", () => {
          document.querySelectorAll(".row-block.is-active").forEach((el) => {
            if (el !== block) el.classList.remove("is-active");
          });
          block.classList.add("is-active");
          refreshRowControls();
        });
        block.appendChild(head);
        block.appendChild(row);
        block.appendChild(progress);
        main.appendChild(block);
      }
    });
    renderCategoriesMenu();
    requestAnimationFrame(() => {
      Object.entries(rowScrollState).forEach(([blockId, left]) => {
        const block = document.getElementById(blockId);
        const row = block && block.querySelector(".row-scroll");
        if (!row) return;
        row.scrollLeft = Number(left) || 0;
      });
      const currentY = window.scrollY || window.pageYOffset || 0;
      if (Math.abs(currentY - prevWindowY) > 2) window.scrollTo(0, prevWindowY);
    });
  }

  function queueRenderRows() {
    if (rowsRenderQueued) return;
    rowsRenderQueued = true;
    requestAnimationFrame(() => {
      rowsRenderQueued = false;
      renderRows();
    });
  }

  function refreshHeroAndRows() {
    state.heroItems = buildHeroList();
    if (state.heroIndex >= state.heroItems.length) state.heroIndex = 0;
    paintHero();
    restartHeroTimer();
    queueRenderRows();
  }

  function scheduleContentRefresh() {
    if (contentRefreshTimer) clearTimeout(contentRefreshTimer);
    contentRefreshTimer = setTimeout(() => {
      contentRefreshTimer = null;
      refreshHeroAndRows();
    }, 60);
  }

  async function refreshCatalogOnce() {
    const [settings, categories, content] = await Promise.all([
      DataService.settingsOnce(),
      DataService.categoriesOnce(),
      DataService.contentOnce()
    ]);
    state.settings = settings || {};
    state.categories = categories || {};
    state.content = content || {};
    refreshHeroAndRows();
  }

  function detachLiveCatalog() {
    if (!liveCatalogAttached) return;
    DataService.settingsRef().off();
    DataService.categoriesRef().off();
    DataService.contentRef().off();
    liveCatalogAttached = false;
  }

  function attachLiveCatalog() {
    if (liveCatalogAttached) return;
    DataService.settingsRef().on("value", (snap) => {
      state.settings = snap.val() || {};
      refreshHeroAndRows();
    });
    DataService.categoriesRef().on("child_added", (snap) => {
      state.categories[snap.key] = snap.val() || {};
      queueRenderRows();
    });
    DataService.categoriesRef().on("child_changed", (snap) => {
      state.categories[snap.key] = snap.val() || {};
      queueRenderRows();
    });
    DataService.categoriesRef().on("child_removed", (snap) => {
      delete state.categories[snap.key];
      queueRenderRows();
    });
    DataService.contentRef().on("child_added", (snap) => {
      state.content[snap.key] = snap.val() || {};
      scheduleContentRefresh();
    });
    DataService.contentRef().on("child_changed", (snap) => {
      state.content[snap.key] = snap.val() || {};
      scheduleContentRefresh();
    });
    DataService.contentRef().on("child_removed", (snap) => {
      delete state.content[snap.key];
      scheduleContentRefresh();
    });
    liveCatalogAttached = true;
  }

  function wireNavScroll() {
    const nav = $("nav");
    window.addEventListener("scroll", () => {
      if (window.scrollY > 40) nav.classList.add("scrolled");
      else nav.classList.remove("scrolled");
    });
  }

  function modals() {
    document.querySelectorAll("[data-close]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.getElementById(btn.getAttribute("data-close")).classList.remove("open");
      });
    });
    $("authModal").addEventListener("click", (e) => {
      if (e.target === $("authModal")) $("authModal").classList.remove("open");
    });
    $("detailModal").addEventListener("click", (e) => {
      if (e.target === $("detailModal")) $("detailModal").classList.remove("open");
    });
  }

  function wireCategoriesMenu() {
    const btn = $("navCategoriesBtn");
    const menu = $("navCategoriesMenu");
    if (!btn || !menu) return;
    btn.addEventListener("click", () => {
      if (menu.classList.contains("open")) closeCategoriesMenu();
      else openCategoriesMenu();
    });
    document.addEventListener("click", (e) => {
      if (e.target === btn || btn.contains(e.target) || menu.contains(e.target)) return;
      closeCategoriesMenu();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeCategoriesMenu();
    });
    window.addEventListener("resize", () => {
      if (menu.classList.contains("open")) openCategoriesMenu();
    });
  }

  function updateAuthUi() {
    const u = state.user;
    $("btnLogin").style.display = u ? "none" : "inline-block";
    $("btnLogout").style.display = u ? "inline-block" : "none";
    $("btnProfile").style.display = u ? "inline-block" : "none";
    const emailEl = $("userEmail");
    const mail = u && u.email ? u.email : "";
    if (emailEl) {
      emailEl.textContent = mail;
      emailEl.title = mail;
    }
    const pro = isPlusMember(state.profile);
    const proEl = $("proChip");
    if (proEl) proEl.style.display = "none";
    const profileBtn = $("btnProfile");
    if (profileBtn) profileBtn.classList.toggle("btn-profile-plus", pro);
    const userBlock = $("navUserBlock");
    if (userBlock) userBlock.classList.toggle("nav-user--hidden", !u);
    $("adminLink").style.display = state.isAdmin ? "inline" : "none";
  }

  async function refreshProfile() {
    if (!state.user) {
      state.profile = null;
      state.isAdmin = false;
      state.myList = {};
      if (state.myListRef) {
        state.myListRef.off();
        state.myListRef = null;
      }
      updateAuthUi();
      renderSubscriptionPanel();
      queueRenderRows();
      return;
    }
    state.profile = await DataService.userOnce(state.user.uid);
    state.isAdmin = await DataService.isAdmin(state.user);
    if (state.myListRef) state.myListRef.off();
    state.myListRef = DataService.userListRef(state.user.uid);
    state.myListRef.on("value", (snap) => {
      state.myList = snap.val() || {};
      // Liste toggle sonrasinda tum satirlari yeniden cizmek mobilde kayma yaratabildigi icin,
      // yalnizca gorunen buton metin/siniflarini guncelliyoruz.
      syncRenderedMyListButtons();
    });
    if (state.profile && state.profile.recovery && state.profile.recovery.mustChangePassword === true) {
      openProfileModal(true);
    }
    updateAuthUi();
    renderSubscriptionPanel();
    queueRenderRows();
  }

  function openProfileModal(forcePasswordChange) {
    clearProfileMessages();
    const user = state.user;
    if (!user) return;
    openProfileTab("account");
    $("pName").value = (state.profile && state.profile.displayName) || (user.email ? user.email.split("@")[0] : "");
    $("pEmail").value = user.email || "";
    $("pNewPw").value = "";
    $("pNewPw2").value = "";
    renderSubscriptionPanel();
    $("profileModal").classList.add("open");
    if (forcePasswordChange) {
      $("profileOk").textContent =
        "Güvenlik nedeniyle tek kullanımlık şifre verildi. Lütfen yeni bir şifre belirleyin.";
      $("profileOk").style.display = "block";
    }
  }

  async function saveProfile() {
    clearProfileMessages();
    const user = state.user;
    if (!user) return;
    const name = String(($("pName").value || "").trim()).slice(0, 32);
    const newPw = $("pNewPw").value || "";
    const newPw2 = $("pNewPw2").value || "";
    if (name.length < 2) {
      $("profileErr").textContent = "Kullanıcı adı en az 2 karakter olmalıdır.";
      $("profileErr").style.display = "block";
      return;
    }
    if (newPw || newPw2) {
      if (newPw.length < 6) {
        $("profileErr").textContent = "Yeni şifre en az 6 karakter olmalıdır.";
        $("profileErr").style.display = "block";
        return;
      }
      if (newPw !== newPw2) {
        $("profileErr").textContent = "Yeni şifreler eşleşmiyor.";
        $("profileErr").style.display = "block";
        return;
      }
    }
    const btn = $("btnSaveProfile");
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Kaydediliyor…";
    try {
      await DataService.updateDisplayName(user.uid, name);
      if (newPw) {
        await user.updatePassword(newPw);
        await DataService.userRef(user.uid).child("recovery").child("mustChangePassword").set(false);
      }
      state.profile = await DataService.userOnce(user.uid);
      updateAuthUi();
      $("profileOk").textContent = "Profil bilgileriniz güncellendi.";
      $("profileOk").style.display = "block";
    } catch (e) {
      $("profileErr").textContent = dehlizUserError(e, "Profil güncellenemedi.");
      $("profileErr").style.display = "block";
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  async function cancelSubscriptionFlow() {
    if (!state.user) return;
    if (!isPlusMember(state.profile)) {
      await openUiDialog({
        title: "Abonelik Bilgisi",
        message: "Aktif bir +PLUS üyelik bulunmuyor.",
        buttons: [{ label: "Tamam", value: true, className: "btn-primary" }]
      });
      return;
    }
    const confirmResult = await openUiDialog({
      title: "Abonelik İptali Onayı",
      message: "Aboneliğiniz dönem sonuna kadar aktif kalır ve sonrasında otomatik yenileme kapanır. İptal talebini göndermek istiyor musunuz?",
      buttons: [
        { label: "Vazgeç", value: false, className: "btn-ghost" },
        { label: "İptali Onayla", value: true, className: "btn-primary" }
      ]
    });
    if (!confirmResult) return;

    const now = Date.now();
    try {
      await DataService.userRef(state.user.uid)
        .child("subscription")
        .update({
          cancelAtPeriodEnd: true,
          cancelRequestedAt: now,
          status: "cancel_pending"
        });
      if (!state.profile) state.profile = {};
      state.profile.subscription = {
        ...(state.profile.subscription || {}),
        cancelAtPeriodEnd: true,
        cancelRequestedAt: now,
        status: "cancel_pending"
      };
      renderSubscriptionPanel();
      await openUiDialog({
        title: "Talebiniz Alındı",
        message: "Abonelik iptal talebiniz başarıyla kaydedildi. +PLUS erişiminiz mevcut dönem sonuna kadar devam edecektir.",
        buttons: [{ label: "Tamam", value: true, className: "btn-primary" }]
      });
    } catch (e) {
      await openUiDialog({
        title: "İşlem Başarısız",
        message: dehlizUserError(e, "Abonelik iptal talebi gönderilemedi. Lütfen tekrar deneyin."),
        buttons: [{ label: "Kapat", value: true, className: "btn-ghost" }]
      });
    }
  }

  function wireAuth() {
    $("btnLogin").addEventListener("click", () => {
      $("authErr").style.display = "none";
      $("authModal").classList.add("open");
    });
    $("btnLogout").addEventListener("click", () => dehlizSignOut());
    $("btnProfile").addEventListener("click", () => openProfileModal(false));
    $("btnSaveProfile").addEventListener("click", saveProfile);
    $("btnCancelSubscription").addEventListener("click", cancelSubscriptionFlow);
    document.querySelectorAll("[data-profile-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        openProfileTab(btn.getAttribute("data-profile-tab") || "account");
      });
    });
    $("doLogin").addEventListener("click", async () => {
      $("authErr").style.display = "none";
      const email = $("em").value.trim();
      const pw = $("pw").value;
      try {
        await dehlizAuth.signInWithEmailAndPassword(email, pw);
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
    $("btnForgotPw").addEventListener("click", async () => {
      clearRecoveryMessages();
      $("authErr").style.display = "none";
      $("recQuestion").value = "";
      $("recAnswer").value = "";
      $("recEmail").value = ($("em").value || "").trim();
      $("recoveryModal").classList.add("open");
    });
    $("btnRecRecover").addEventListener("click", async () => {
      clearRecoveryMessages();
      const email = ($("recEmail").value || "").trim();
      const question = ($("recQuestion").value || "").trim();
      const answer = ($("recAnswer").value || "").trim();
      if (!email) {
        $("recErr").textContent = "Lütfen e-posta adresinizi girin.";
        $("recErr").style.display = "block";
        return;
      }
      if (!question) {
        $("recErr").textContent = "Lütfen gizli soru seçin.";
        $("recErr").style.display = "block";
        return;
      }
      if (answer.length < 2) {
        $("recErr").textContent = "Lütfen gizli soru cevabını girin.";
        $("recErr").style.display = "block";
        return;
      }
      const btn = $("btnRecRecover");
      const old = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Kontrol ediliyor…";
      try {
        const out = await recoveryApi({ action: "recover", email, question, answer });
        $("recOk").textContent =
          "Tek kullanımlık şifreniz: " +
          out.tempPassword +
          " . Bu şifreyle giriş yapın ve Profil kısmından hemen yeni şifre belirleyin.";
        $("recOk").style.display = "block";
      } catch (e) {
        $("recErr").textContent = (e && e.message) || "Kurtarma işlemi başarısız.";
        $("recErr").style.display = "block";
      } finally {
        btn.disabled = false;
        btn.textContent = old;
      }
    });
    dehlizAuth.onAuthStateChanged(async (user) => {
      state.user = user;
      if (user) await DataService.ensureUserProfile(user);
      await refreshProfile();
    });
  }

  function wireHero() {
    $("heroPlay").addEventListener("click", () => {
      const item = state.heroItems[state.heroIndex];
      if (!item) return;
      const id = item.id;
      if (!canPlay(item)) {
        window.location.href = "subscribe.html";
        return;
      }
      goWatch(id);
    });
    $("heroInfo").addEventListener("click", () => {
      const item = state.heroItems[state.heroIndex];
      if (!item) return;
      openDetail(item, item.id);
    });
    $("heroPrev").addEventListener("click", () => stepHero(-1));
    $("heroNext").addEventListener("click", () => stepHero(1));

    document.addEventListener("keydown", (e) => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.key === "ArrowLeft") stepHero(-1);
      else if (e.key === "ArrowRight") stepHero(1);
    });

    const hero = $("hero");
    hero.addEventListener(
      "touchstart",
      (e) => {
        if (!e.touches || !e.touches[0]) return;
        state.heroTouchStartX = e.touches[0].clientX;
      },
      { passive: true }
    );
    hero.addEventListener(
      "touchend",
      (e) => {
        if (state.heroTouchStartX == null || !e.changedTouches || !e.changedTouches[0]) return;
        const dx = e.changedTouches[0].clientX - state.heroTouchStartX;
        state.heroTouchStartX = null;
        if (Math.abs(dx) < 40) return;
        if (dx < 0) stepHero(1);
        else stepHero(-1);
      },
      { passive: true }
    );
  }

  async function loadAll() {
    state.settings = (await DataService.settingsOnce()) || {};
    state.categories = await DataService.categoriesOnce();
    state.content = await DataService.contentOnce();
    state.heroItems = buildHeroList();
    state.heroIndex = 0;
    paintHero();
    restartHeroTimer();
    queueRenderRows();
  }

  function subscribeLive() {
    const POLL_MS = 90 * 1000;
    const applyMode = () => {
      if (state.isAdmin) {
        if (catalogPollTimer) {
          clearInterval(catalogPollTimer);
          catalogPollTimer = null;
        }
        attachLiveCatalog();
        return;
      }
      detachLiveCatalog();
      if (!catalogPollTimer) {
        catalogPollTimer = setInterval(() => {
          if (document.hidden) return;
          refreshCatalogOnce().catch(() => {});
        }, POLL_MS);
      }
    };

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) return;
      if (!state.isAdmin) refreshCatalogOnce().catch(() => {});
    });

    // Auth durumu degistikce admin/non-admin sync modunu yeniden ayarla.
    dehlizAuth.onAuthStateChanged(() => {
      setTimeout(applyMode, 0);
    });

    applyMode();
  }

  document.addEventListener("DOMContentLoaded", async () => {
    modals();
    wireCategoriesMenu();
    wireNavScroll();
    wireAuth();
    wireSearch();
    wireHero();
    try {
      await loadAll();
      subscribeLive();
    } catch (e) {
      console.error(e);
      alert("Veri yüklenemedi. Firebase kurallarını ve database URL'ini kontrol edin.");
    } finally {
      await hideLoading();
    }
  });
})();
