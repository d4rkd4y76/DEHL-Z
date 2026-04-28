(function () {
  const $ = (id) => document.getElementById(id);

  function val(id) {
    const el = $(id);
    return el ? el.value : "";
  }

  function chk(id) {
    const el = $(id);
    return !!(el && el.checked);
  }

  function isValidContentKey(id) {
    return typeof id === "string" && id.length > 0 && !/[.#$\[\]/]/.test(id);
  }

  function normalizeDurationInput(raw) {
    const v = String(raw || "").trim();
    if (!v) return "";
    if (/^\d{1,3}:\d{2}$/.test(v)) return v;
    if (/^\d+$/.test(v)) return String(Number(v)) + "dk";
    return "";
  }

  const state = {
    user: null,
    cats: {},
    content: {},
    users: {},
    commentBans: {},
    editingCatId: null,
    heroOrder: [],
    mostWatchedOrder: [],
    selectedUsers: {}
  };

  function show(id) {
    ["loginView", "deniedView", "appView"].forEach((v) => $(v).classList.add("hidden"));
    $(id).classList.remove("hidden");
  }

  function tab(name) {
    document.querySelectorAll(".admin-nav a").forEach((a) => {
      a.classList.toggle("active", a.getAttribute("data-tab") === name);
    });
    ["dash", "settings", "cats", "content", "users", "bans"].forEach((t) => {
      $("tab-" + t).classList.toggle("hidden", t !== name);
    });
    const titles = {
      dash: "Özet",
      settings: "Site & afiş",
      cats: "Kategoriler",
      content: "İçerik",
      users: "Kullanıcılar",
      bans: "Engellenenler"
    };
    $("panelTitle").textContent = titles[name] || "";
    if (name === "settings") {
      renderHeroPicker();
      renderMostWatchedPicker();
    }
  }

  function sanitizeId(raw) {
    if (!raw || !String(raw).trim()) return "";
    let s = String(raw)
      .trim()
      .toLocaleLowerCase("tr-TR")
      .replace(/\s+/g, "_");
    const repl = { ğ: "g", ü: "u", ş: "s", ı: "i", ö: "o", ç: "c" };
    for (const k of Object.keys(repl)) s = s.split(k).join(repl[k]);
    s = s.replace(/[^a-z0-9_]/g, "").replace(/_+/g, "_").replace(/^_|_$/g, "");
    return s;
  }

  function slugIdFromName(name) {
    return sanitizeId(name.replace(/\s+/g, "_"));
  }

  function uniqueSlugFromName(name) {
    let base = slugIdFromName(name);
    if (!base) base = "kategori";
    let id = base;
    let n = 2;
    while (state.cats[id]) id = base + "_" + n++;
    return id;
  }

  function updateCatSaveBtn() {
    $("btnSaveCat").textContent = state.editingCatId ? "Değişiklikleri kaydet" : "Kategori kaydet";
  }

  function resetCatForm() {
    state.editingCatId = null;
    $("c_id").readOnly = false;
    $("c_id").value = "";
    $("c_name").value = "";
    $("c_order").value = "0";
    $("c_visible").checked = true;
    updateCatSaveBtn();
  }

  function editCatCategory(id, v) {
    state.editingCatId = id;
    $("c_id").value = id;
    $("c_id").readOnly = true;
    $("c_name").value = (v && v.name) || "";
    $("c_order").value = v && v.order != null ? v.order : 0;
    $("c_visible").checked = v.visible !== false;
    updateCatSaveBtn();
    $("c_name").focus();
  }

  function getCheckedCategoryIds() {
    const wrap = $("e_cat_picker");
    if (!wrap) return [];
    try {
      return Array.from(wrap.querySelectorAll('input[type="checkbox"]:checked'))
        .map((i) => i.value)
        .filter(Boolean);
    } catch (e) {
      console.error(e);
      return [];
    }
  }

  function renderCategoryPicker(selectedIds) {
    const wrap = $("e_cat_picker");
    if (!wrap) return;
    const selected = new Set(selectedIds || []);
    wrap.innerHTML = "";
    const entries = Object.entries(state.cats)
      .filter(([cid, cv]) => {
        const id = String(cid || "").toLocaleLowerCase("tr-TR");
        const name = String((cv && cv.name) || "").toLocaleLowerCase("tr-TR");
        if (id === "__most_watched__") return false;
        if (id === "en_cok_izlenen" || id === "encokizlenen") return false;
        if (name.indexOf("en çok izlenen") !== -1 || name.indexOf("en cok izlenen") !== -1) return false;
        if (id === "__plus__" || id === "plus_icerikler" || id === "plusicerikler") return false;
        if (name.indexOf("+plus") !== -1 || name.indexOf("plus icerikler") !== -1) return false;
        if (id === "__archive__" || id === "tum_arsiv" || id === "tumarsiv") return false;
        if (name.indexOf("tüm arşiv") !== -1 || name.indexOf("tum arsiv") !== -1) return false;
        return true;
      })
      .sort((a, b) => (a[1].order || 0) - (b[1].order || 0));
    if (!entries.length) {
      const p = document.createElement("p");
      p.className = "cat-picker-empty";
      p.textContent = "Henüz kategori yok. “Kategoriler” sekmesinden oluşturun; sonra burada isimlerine tıklayarak seçin.";
      wrap.appendChild(p);
      return;
    }
    entries.forEach(([cid, cv]) => {
      const label = document.createElement("label");
      label.className = "cat-pick-item" + (selected.has(cid) ? " is-on" : "");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = cid;
      cb.checked = selected.has(cid);
      cb.addEventListener("change", () => {
        label.classList.toggle("is-on", cb.checked);
      });
      const nameSpan = document.createElement("span");
      nameSpan.textContent = cv.name || cid;
      const idSpan = document.createElement("span");
      idSpan.className = "cat-pick-id";
      idSpan.textContent = cid;
      label.appendChild(cb);
      label.appendChild(nameSpan);
      label.appendChild(idSpan);
      wrap.appendChild(label);
    });
  }

  function maybeRefreshCategoryPicker() {
    const ed = $("editor");
    if (!ed || ed.classList.contains("hidden")) return;
    renderCategoryPicker(getCheckedCategoryIds());
  }

  function maybeRefreshHeroPicker() {
    const tab = $("tab-settings");
    if (tab && !tab.classList.contains("hidden")) {
      renderHeroPicker();
      renderMostWatchedPicker();
    }
  }

  function heroMove(idx, dir) {
    const arr = state.heroOrder;
    const j = idx + dir;
    if (j < 0 || j >= arr.length) return;
    const t = arr[idx];
    arr[idx] = arr[j];
    arr[j] = t;
    renderHeroPicker();
  }

  function heroRemoveAt(idx) {
    state.heroOrder.splice(idx, 1);
    renderHeroPicker();
  }

  function heroAdd(id) {
    if (state.heroOrder.indexOf(id) !== -1) return;
    state.heroOrder.push(id);
    renderHeroPicker();
  }

  function mostMove(idx, dir) {
    const arr = state.mostWatchedOrder;
    const j = idx + dir;
    if (j < 0 || j >= arr.length) return;
    const t = arr[idx];
    arr[idx] = arr[j];
    arr[j] = t;
    renderMostWatchedPicker();
  }

  function mostRemoveAt(idx) {
    state.mostWatchedOrder.splice(idx, 1);
    renderMostWatchedPicker();
  }

  function mostAdd(id) {
    if (state.mostWatchedOrder.indexOf(id) !== -1) return;
    if (state.mostWatchedOrder.length >= 10) return alert("En Çok İzlenenler listesine en fazla 10 içerik ekleyebilirsiniz.");
    state.mostWatchedOrder.push(id);
    renderMostWatchedPicker();
  }

  function renderMostWatchedPicker() {
    const root = $("s_most_ui");
    if (!root) return;
    if (!Array.isArray(state.mostWatchedOrder)) state.mostWatchedOrder = [];
    root.innerHTML = "";

    const secOrder = document.createElement("div");
    secOrder.className = "hero-order-section";
    const t1 = document.createElement("div");
    t1.className = "hero-section-title";
    t1.textContent = "Sıralı liste (ana sayfada 2. satırda gösterilir)";
    secOrder.appendChild(t1);

    const list = document.createElement("ul");
    list.className = "hero-order-list";
    if (!state.mostWatchedOrder.length) {
      const li = document.createElement("li");
      li.className = "hero-order-empty";
      li.textContent = "Henüz seçim yok. Aşağıdaki listeden ekleyin (en fazla 10).";
      list.appendChild(li);
    } else {
      state.mostWatchedOrder.forEach((cid, idx) => {
        const item = state.content[cid];
        const li = document.createElement("li");
        li.className = "hero-order-item";
        const num = document.createElement("span");
        num.className = "hero-order-num";
        num.textContent = String(idx + 1);
        const text = document.createElement("div");
        text.className = "hero-order-text";
        const strong = document.createElement("strong");
        strong.textContent = item ? item.title || "Başlıksız" : "Silinmiş veya eksik içerik";
        const code = document.createElement("code");
        code.textContent = cid;
        text.appendChild(strong);
        text.appendChild(code);
        const actions = document.createElement("div");
        actions.className = "hero-order-actions";
        const bu = document.createElement("button");
        bu.type = "button";
        bu.className = "btn btn-ghost";
        bu.textContent = "↑";
        bu.disabled = idx === 0;
        bu.addEventListener("click", () => mostMove(idx, -1));
        const bd = document.createElement("button");
        bd.type = "button";
        bd.className = "btn btn-ghost";
        bd.textContent = "↓";
        bd.disabled = idx === state.mostWatchedOrder.length - 1;
        bd.addEventListener("click", () => mostMove(idx, 1));
        const br = document.createElement("button");
        br.type = "button";
        br.className = "btn btn-ghost";
        br.textContent = "×";
        br.addEventListener("click", () => mostRemoveAt(idx));
        actions.appendChild(bu);
        actions.appendChild(bd);
        actions.appendChild(br);
        li.appendChild(num);
        li.appendChild(text);
        li.appendChild(actions);
        list.appendChild(li);
      });
    }
    secOrder.appendChild(list);
    root.appendChild(secOrder);

    const secPool = document.createElement("div");
    secPool.className = "hero-pool-section";
    const t2 = document.createElement("div");
    t2.className = "hero-section-title";
    t2.textContent = "Tüm içerikler (işaretlediklerin En Çok İzlenenler listesine eklenir)";
    secPool.appendChild(t2);
    const pool = document.createElement("div");
    pool.className = "hero-pool-grid";
    const entries = Object.entries(state.content).sort((a, b) =>
      String((a[1].title || a[0]) || "").localeCompare(String((b[1].title || b[0]) || ""), "tr")
    );
    entries.forEach(([id, v]) => {
      const inList = state.mostWatchedOrder.indexOf(id) !== -1;
      const row = document.createElement("div");
      row.className = "hero-pool-row hero-pool-row-select" + (inList ? " is-selected" : "");
      const meta = document.createElement("div");
      meta.className = "hero-pool-meta";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "most-select-check";
      cb.checked = inList;
      cb.disabled = !inList && state.mostWatchedOrder.length >= 10;
      cb.addEventListener("change", () => {
        if (cb.checked) {
          mostAdd(id);
        } else {
          const idx = state.mostWatchedOrder.indexOf(id);
          if (idx >= 0) mostRemoveAt(idx);
        }
      });
      const strong = document.createElement("strong");
      strong.textContent = v.title || "Başlıksız";
      const span = document.createElement("span");
      span.textContent = id + (v.isPro ? " · +PLUS" : "");
      const left = document.createElement("div");
      left.className = "most-select-left";
      const textWrap = document.createElement("div");
      textWrap.className = "most-select-text";
      textWrap.appendChild(strong);
      textWrap.appendChild(span);
      left.appendChild(cb);
      left.appendChild(textWrap);
      meta.appendChild(left);
      const stateTag = document.createElement("span");
      stateTag.className = "most-select-tag" + (inList ? " is-on" : "");
      if (inList) stateTag.textContent = "#" + String(state.mostWatchedOrder.indexOf(id) + 1);
      else stateTag.textContent = "Seç";
      row.appendChild(meta);
      row.appendChild(stateTag);
      pool.appendChild(row);
    });
    if (!entries.length) {
      const p = document.createElement("p");
      p.className = "hero-pool-empty";
      p.textContent = "Henüz içerik yok.";
      pool.appendChild(p);
    }
    secPool.appendChild(pool);
    root.appendChild(secPool);
  }

  function renderHeroPicker() {
    const root = $("s_hero_ui");
    if (!root) return;
    if (!Array.isArray(state.heroOrder)) state.heroOrder = [];
    root.innerHTML = "";

    const secOrder = document.createElement("div");
    secOrder.className = "hero-order-section";
    const t1 = document.createElement("div");
    t1.className = "hero-section-title";
    t1.textContent = "Sıradaki slaytlar (yukarıdan aşağıya = dönüş sırası)";
    secOrder.appendChild(t1);

    const list = document.createElement("ul");
    list.className = "hero-order-list";
    if (!state.heroOrder.length) {
      const li = document.createElement("li");
      li.className = "hero-order-empty";
      li.textContent =
        "Henüz seçim yok. Aşağıdaki listeden “Ekle” ile ekleyin; boş bırakıp kaydederseniz sitede öne çıkanlar kullanılır.";
      list.appendChild(li);
    } else {
      state.heroOrder.forEach((cid, idx) => {
        const item = state.content[cid];
        const li = document.createElement("li");
        li.className = "hero-order-item";

        const num = document.createElement("span");
        num.className = "hero-order-num";
        num.textContent = String(idx + 1);

        const text = document.createElement("div");
        text.className = "hero-order-text";
        const strong = document.createElement("strong");
        strong.textContent = item ? item.title || "Başlıksız" : "Silinmiş veya eksik içerik";
        const code = document.createElement("code");
        code.textContent = cid;
        text.appendChild(strong);
        text.appendChild(code);

        const actions = document.createElement("div");
        actions.className = "hero-order-actions";
        const bu = document.createElement("button");
        bu.type = "button";
        bu.className = "btn btn-ghost";
        bu.textContent = "↑";
        bu.title = "Yukarı";
        bu.disabled = idx === 0;
        bu.addEventListener("click", () => heroMove(idx, -1));
        const bd = document.createElement("button");
        bd.type = "button";
        bd.className = "btn btn-ghost";
        bd.textContent = "↓";
        bd.title = "Aşağı";
        bd.disabled = idx === state.heroOrder.length - 1;
        bd.addEventListener("click", () => heroMove(idx, 1));
        const br = document.createElement("button");
        br.type = "button";
        br.className = "btn btn-ghost";
        br.textContent = "×";
        br.title = "Kaldır";
        br.addEventListener("click", () => heroRemoveAt(idx));
        actions.appendChild(bu);
        actions.appendChild(bd);
        actions.appendChild(br);

        li.appendChild(num);
        li.appendChild(text);
        li.appendChild(actions);
        list.appendChild(li);
      });
    }
    secOrder.appendChild(list);
    root.appendChild(secOrder);

    const secPool = document.createElement("div");
    secPool.className = "hero-pool-section";
    const t2 = document.createElement("div");
    t2.className = "hero-section-title";
    t2.textContent = "İçeriklerden ekle (hero’da olmayanlar)";
    secPool.appendChild(t2);

    const pool = document.createElement("div");
    pool.className = "hero-pool-grid";
    const entries = Object.entries(state.content).sort((a, b) =>
      String((a[1].title || a[0]) || "").localeCompare(String((b[1].title || b[0]) || ""), "tr")
    );
    const inHero = new Set(state.heroOrder);
    let poolCount = 0;
    entries.forEach(([id, v]) => {
      if (inHero.has(id)) return;
      poolCount++;
      const row = document.createElement("div");
      row.className = "hero-pool-row";
      const meta = document.createElement("div");
      meta.className = "hero-pool-meta";
      const strong = document.createElement("strong");
      strong.textContent = v.title || "Başlıksız";
      const span = document.createElement("span");
      span.textContent = id + (v.isPro ? " · +PLUS" : "");
      meta.appendChild(strong);
      meta.appendChild(span);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-primary";
      btn.style.padding = "0.3rem 0.65rem";
      btn.style.fontSize = "0.78rem";
      btn.textContent = "Ekle";
      btn.addEventListener("click", () => heroAdd(id));
      row.appendChild(meta);
      row.appendChild(btn);
      pool.appendChild(row);
    });
    if (!entries.length) {
      const p = document.createElement("p");
      p.className = "hero-pool-empty";
      p.textContent = "Henüz içerik yok. Önce “İçerik” sekmesinden video ekleyin.";
      pool.appendChild(p);
    } else if (!poolCount) {
      const p = document.createElement("p");
      p.className = "hero-pool-empty";
      p.textContent = "Tüm içerikler hero sırasında. Kaldırmak için yukarıdaki × kullanın.";
      pool.appendChild(p);
    }
    secPool.appendChild(pool);
    root.appendChild(secPool);
  }

  function renderDash() {
    const c = Object.keys(state.content).length;
    const cat = Object.keys(state.cats).length;
    const u = Object.keys(state.users).length;
    const b = Object.values(state.commentBans || {}).filter((x) => x && x.banned === true).length;
    $("dashStats").innerHTML =
      "<p><strong>İçerik:</strong> " +
      c +
      "</p><p><strong>Kategori:</strong> " +
      cat +
      "</p><p><strong>Kullanıcı:</strong> " +
      u +
      "</p><p><strong>Yorum engeli:</strong> " +
      b +
      "</p>";
  }

  function renderCats() {
    const body = $("catsBody");
    body.innerHTML = "";
    Object.entries(state.cats)
      .sort((a, b) => (a[1].order || 0) - (b[1].order || 0))
      .forEach(([id, v]) => {
        const tr = document.createElement("tr");
        tr.innerHTML =
          "<td><code>" +
          esc(id) +
          "</code></td><td>" +
          esc(v.name || "") +
          "</td><td>" +
          (v.order != null ? v.order : "") +
          "</td><td>" +
          (v.visible === false ? "Hayır" : "Evet") +
          '</td><td><div class="row-actions">' +
          '<button type="button" class="btn btn-ghost row-edit-cat" data-cat="' +
          esc(id) +
          '">Düzenle</button>' +
          '<button type="button" class="btn btn-ghost row-del" data-cat="' +
          esc(id) +
          '">Sil</button></div></td>';
        tr.querySelector(".row-edit-cat").addEventListener("click", () => {
          editCatCategory(id, v);
        });
        tr.querySelector(".row-del").addEventListener("click", async () => {
          if (!confirm("Kategori silinsin mi?")) return;
          await DataService.categoriesRef().child(id).remove();
        });
        body.appendChild(tr);
      });
  }

  function renderContent() {
    const body = $("contentBody");
    body.innerHTML = "";
    Object.entries(state.content).forEach(([id, v]) => {
      const tr = document.createElement("tr");
      const ok = v.bunnyLibraryId && v.bunnyVideoId;
      const episodeCount = Array.isArray(v.episodes) ? v.episodes.length : 0;
      tr.innerHTML =
        "<td><code style=\"font-size:0.75rem\">" +
        esc(id) +
        "</code></td><td>" +
        esc(v.title || "") +
        "</td><td>" +
        episodeCount +
        '</td><td><span class="badge ' +
        (v.isPro ? "badge-pro" : "badge-free") +
        '">' +
        (v.isPro ? "+PLUS" : "FREE") +
        "</span></td><td>" +
        (ok ? "Tamam" : "Eksik") +
        '</td><td><div class="row-actions">' +
        '<button type="button" class="btn btn-ghost btn-edit" data-id="' +
        esc(id) +
        '">Düzenle</button>' +
        '<button type="button" class="btn btn-ghost btn-del" data-id="' +
        esc(id) +
        '">Sil</button></div></td>';
      tr.querySelector(".btn-edit").addEventListener("click", () => openEditor(id, v));
      tr.querySelector(".btn-del").addEventListener("click", async () => {
        if (!confirm("Silinsin mi?")) return;
        await DataService.contentRef().child(id).remove();
      });
      body.appendChild(tr);
    });
  }

  function renderUsers() {
    const body = $("usersBody");
    body.innerHTML = "";
    const entries = Object.entries(state.users).sort((a, b) =>
      String((a[1].email || a[0]) || "").localeCompare(String((b[1].email || b[0]) || ""), "tr")
    );
    if (!entries.length) {
      body.innerHTML =
        '<tr><td colspan="7" style="color:#a1a1aa">Henüz kullanıcı yok. Kayıt ekranından veya ana sayfadan giriş yaptıkça burada listelenir.</td></tr>';
      $("usersInfo").textContent =
        "Liste boş: Kullanıcılar kayıt/giriş yaptıkça /users altında oluşur. Şu an görüntülenecek profil bulunamadı.";
      return;
    }
    const selectedCount = Object.keys(state.selectedUsers).filter((uid) => state.selectedUsers[uid]).length;
    $("usersInfo").textContent = entries.length + " kullanıcı listelendi. Seçili: " + selectedCount;
    entries.forEach(([uid, v]) => {
      const tr = document.createElement("tr");
      const pro = v.isPro === true;
      const sub = v.subscription || {};
      const expiryCandidates = [sub.expiresAt, sub.renewAt, v.expiresAt, v.plusUntil];
      let expiryAt = 0;
      for (let i = 0; i < expiryCandidates.length; i++) {
        const n = Number(expiryCandidates[i]);
        if (Number.isFinite(n) && n > 0) {
          expiryAt = n;
          break;
        }
      }
      const leftDays = expiryAt ? Math.ceil((expiryAt - Date.now()) / (24 * 60 * 60 * 1000)) : null;
      const leftText =
        leftDays == null
          ? "—"
          : leftDays >= 0
          ? leftDays + " gün (bitiş: " + new Date(expiryAt).toLocaleDateString("tr-TR") + ")"
          : "Süre doldu";
      tr.innerHTML =
        '<td><input type="checkbox" class="u-select" data-uid="' +
        esc(uid) +
        '"' +
        (state.selectedUsers[uid] ? " checked" : "") +
        ' /></td><td><code style="font-size:0.7rem">' +
        esc(uid) +
        "</code></td><td>" +
        esc(v.displayName || "—") +
        "</td><td>" +
        esc(v.email || "") +
        '</td><td><span class="badge ' +
        (pro ? "badge-pro" : "badge-free") +
        '">' +
        (pro ? "+PLUS" : "—") +
        "</span></td><td>" +
        leftText +
        "</td><td>" +
        '<button type="button" class="btn btn-ghost btn-toggle" data-uid="' +
        esc(uid) +
        '" data-pro="' +
        (pro ? "1" : "0") +
        '">' +
        (pro ? "Plus kapat" : "Plus aç") +
        "</button></td>";
      tr.querySelector(".u-select").addEventListener("change", (e) => {
        state.selectedUsers[uid] = !!e.target.checked;
        renderUsers();
      });
      tr.querySelector(".btn-toggle").addEventListener("click", async (e) => {
        const u = e.target.getAttribute("data-uid");
        const next = e.target.getAttribute("data-pro") !== "1";
        if (next) {
          await DataService.userRef(u).child("isPro").set(true);
        } else {
          await clearUserPlusState(u);
        }
      });
      body.appendChild(tr);
    });
  }

  function formatDate(ts) {
    if (!ts) return "—";
    const d = new Date(Number(ts));
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("tr-TR");
  }

  function renderBans() {
    const body = $("bansBody");
    if (!body) return;
    body.innerHTML = "";
    const entries = Object.entries(state.commentBans || {})
      .filter(([, v]) => v && v.banned === true)
      .sort((a, b) => Number((b[1] && b[1].bannedAt) || 0) - Number((a[1] && a[1].bannedAt) || 0));
    if (!entries.length) {
      body.innerHTML = '<tr><td colspan="6" style="color:#a1a1aa">Aktif yorum engeli bulunmuyor.</td></tr>';
      return;
    }
    entries.forEach(([uid, ban]) => {
      const user = state.users[uid] || {};
      const tr = document.createElement("tr");
      tr.innerHTML =
        "<td><code style=\"font-size:0.72rem\">" +
        esc(uid) +
        "</code></td><td>" +
        esc(user.displayName || "—") +
        "</td><td>" +
        esc(user.email || "") +
        '</td><td><span class="badge badge-ban">Engelli</span></td><td>' +
        esc(formatDate(ban.bannedAt)) +
        '</td><td><button type="button" class="btn btn-ghost btn-unban" data-uid="' +
        esc(uid) +
        '">Engeli kaldır</button></td>';
      tr.querySelector(".btn-unban").addEventListener("click", async () => {
        await DataService.commentBanRef(uid).remove();
      });
      body.appendChild(tr);
    });
  }

  function getSelectedUserIds() {
    return Object.keys(state.selectedUsers).filter((uid) => state.selectedUsers[uid] && state.users[uid]);
  }

  async function clearUserPlusState(uid) {
    await DataService.userRef(uid).update({
      isPro: false,
      plusUntil: null,
      expiresAt: null,
      renewAt: null,
      subscription: null
    });
  }

  async function setSelectedUsersPro(nextPro) {
    const ids = getSelectedUserIds();
    if (!ids.length) {
      $("usersInfo").textContent = "Önce en az bir kullanıcı seçin.";
      return;
    }
    if (nextPro) {
      await Promise.all(ids.map((uid) => DataService.userRef(uid).child("isPro").set(true)));
    } else {
      await Promise.all(ids.map((uid) => clearUserPlusState(uid)));
    }
    $("usersInfo").textContent = ids.length + " kullanıcı güncellendi: " + (nextPro ? "Plus açık" : "Plus kapalı");
  }

  async function assignSelectedUsersPlusDays(days) {
    const durationDays = Number(days || 0);
    if (!Number.isFinite(durationDays) || durationDays <= 0) return;
    const ids = getSelectedUserIds();
    if (!ids.length) {
      $("usersInfo").textContent = "Önce en az bir kullanıcı seçin.";
      return;
    }
    const now = Date.now();
    const durationMs = durationDays * 24 * 60 * 60 * 1000;
    await Promise.all(
      ids.map(async (uid) => {
        const snap = await DataService.userRef(uid).once("value");
        const profile = snap.val() || {};
        const sub = profile.subscription || {};
        const currentCandidates = [sub.expiresAt, sub.renewAt, profile.expiresAt, profile.plusUntil];
        let currentExpiry = 0;
        for (let i = 0; i < currentCandidates.length; i++) {
          const n = Number(currentCandidates[i]);
          if (Number.isFinite(n) && n > 0) {
            currentExpiry = n;
            break;
          }
        }
        const startAt = currentExpiry > now ? currentExpiry : now;
        const expiresAt = startAt + durationMs;
        await DataService.userRef(uid).update({
          isPro: true,
          plusUntil: expiresAt,
          subscription: {
            provider: "admin_manual",
            status: "active",
            plan: "manual_" + durationDays + "d",
            startedAt: startAt,
            expiresAt,
            renewAt: expiresAt,
            months: Math.max(1, Math.round(durationDays / 30)),
            updatedAt: Date.now()
          }
        });
      })
    );
    $("usersInfo").textContent = ids.length + " kullanıcıya +" + durationDays + " gün +PLUS süresi tanımlandı.";
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function episodeId() {
    return "ep_" + Math.random().toString(36).slice(2, 10);
  }

  function episodeSort(arr) {
    return (arr || []).slice().sort((a, b) => {
      const oa = Number(a.order || 0);
      const ob = Number(b.order || 0);
      if (oa !== ob) return oa - ob;
      return String(a.id || "").localeCompare(String(b.id || ""), "tr");
    });
  }

  function renderEpisodeEditor(list) {
    const wrap = $("e_episodes");
    if (!wrap) return;
    const arr = episodeSort(Array.isArray(list) ? list : []);
    wrap.innerHTML = "";
    if (!arr.length) {
      const p = document.createElement("p");
      p.className = "field-hint";
      p.style.margin = "0";
      p.textContent = "Henüz bölüm eklenmedi.";
      wrap.appendChild(p);
      return;
    }
    arr.forEach((ep, i) => {
      const item = document.createElement("div");
      item.className = "episode-item";
      item.dataset.epId = ep.id || episodeId();
      item.innerHTML =
        '<div class="episode-head"><span class="episode-title">Bölüm ' +
        String(i + 1) +
        '</span><button type="button" class="btn btn-ghost btn-ep-del">Sil</button></div>' +
        '<div class="grid-2"><div><label>Bölüm adı</label><input class="ep-title" value="' +
        esc(ep.title || "") +
        '" /></div><div><label>Sıra</label><input class="ep-order" type="number" value="' +
        String(Number(ep.order || i + 1)) +
        '" /></div></div>' +
        '<label>Açıklama</label><textarea class="ep-desc">' +
        esc(ep.description || "") +
        '</textarea><div class="grid-2"><div><label>Bunny Kütüphane ID</label><input class="ep-lib" value="' +
        esc(ep.bunnyLibraryId || "") +
        '" /></div><div><label>Bunny Video ID</label><input class="ep-vid" value="' +
        esc(ep.bunnyVideoId || "") +
        '" /></div></div>';
      item.querySelector(".btn-ep-del").addEventListener("click", () => {
        item.remove();
        if (!wrap.children.length) renderEpisodeEditor([]);
      });
      wrap.appendChild(item);
    });
  }

  function collectEpisodes() {
    const wrap = $("e_episodes");
    if (!wrap) return [];
    const items = Array.from(wrap.querySelectorAll(".episode-item"));
    return episodeSort(
      items
        .map((it, i) => ({
          id: it.dataset.epId || episodeId(),
          title: (it.querySelector(".ep-title")?.value || "").trim(),
          description: (it.querySelector(".ep-desc")?.value || "").trim(),
          bunnyLibraryId: (it.querySelector(".ep-lib")?.value || "").trim(),
          bunnyVideoId: (it.querySelector(".ep-vid")?.value || "").trim(),
          order: Number(it.querySelector(".ep-order")?.value) || i + 1
        }))
        .filter((x) => x.title || x.bunnyVideoId || x.bunnyLibraryId)
    );
  }

  function openEditor(id, v) {
    $("editor").classList.remove("hidden");
    $("editorTitle").textContent = id ? "İçerik düzenle" : "Yeni içerik";
    $("e_id").value = id || "";
    $("e_title").value = (v && v.title) || "";
    $("e_desc").value = (v && v.description) || "";
    $("e_poster").value = (v && v.posterUrl) || "";
    $("e_back").value = (v && v.backdropUrl) || "";
    $("e_year").value = (v && v.year) || "";
    $("e_mat").value = (v && v.maturity) || "";
    $("e_lib").value = (v && v.bunnyLibraryId) || "";
    $("e_vid").value = (v && v.bunnyVideoId) || "";
    $("e_dur").value = (v && v.durationText) || ((v && v.durationMin) != null ? String(v.durationMin) + "dk" : "");
    renderEpisodeEditor((v && v.episodes) || []);
    renderCategoryPicker((v && v.categories) || []);
    $("e_order").value = (v && v.order) != null ? v.order : 0;
    $("e_forder").value = (v && v.featuredOrder) != null ? v.featuredOrder : 0;
    $("e_feat").checked = !!(v && v.featured);
    $("e_pro").checked = !!(v && v.isPro);
  }

  function closeEditor() {
    $("editor").classList.add("hidden");
  }

  async function saveContent(ev) {
    if (ev && ev.preventDefault) ev.preventDefault();
    const btn = $("btnSaveContent");
    const prevText = btn ? btn.textContent : "";
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Kaydediliyor…";
    }
    try {
      let id = val("e_id").trim();
      if (!id) {
        const ref = DataService.contentRef().push();
        id = ref.key;
      }
      if (!id || !isValidContentKey(id)) {
        alert(
          "Geçersiz içerik anahtarı. Yol parçasında . # $ [ ] / kullanılamaz. Sorun sürerse içeriği silip yeniden oluşturun."
        );
        return;
      }
      const title = val("e_title").trim();
      if (!title) {
        alert("Başlık boş olamaz.");
        return;
      }
      const durationText = normalizeDurationInput(val("e_dur"));
      if (val("e_dur").trim() && !durationText) {
        alert("Süre formatı geçersiz. Örnek: 24:05 veya 125");
        return;
      }
      const payload = {
        title,
        description: val("e_desc").trim(),
        posterUrl: val("e_poster").trim(),
        backdropUrl: val("e_back").trim(),
        year: val("e_year").trim(),
        maturity: val("e_mat").trim(),
        bunnyLibraryId: val("e_lib").trim(),
        bunnyVideoId: val("e_vid").trim(),
        durationText,
        episodes: collectEpisodes(),
        categories: getCheckedCategoryIds(),
        order: Number(val("e_order")) || 0,
        featuredOrder: Number(val("e_forder")) || 0,
        featured: chk("e_feat"),
        isPro: chk("e_pro"),
        createdAt: Number((state.content[id] && state.content[id].createdAt) || Date.now()),
        updatedAt: Date.now()
      };
      await DataService.contentRef().child(id).set(payload);
      closeEditor();
    } catch (err) {
      console.error(err);
      const msg =
        (err && err.message) ||
        (err && err.code) ||
        "Kayıt başarısız. Tarayıcı konsolunu (F12) kontrol edin.";
      alert("İçerik kaydedilemedi:\n\n" + msg);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = prevText || "Kaydet";
      }
    }
  }

  function updateRuleStatus() {
    const el = $("s_rule_status");
    if (!el) return;
    const u = dehlizAuth.currentUser;
    const owner = val("s_owner").trim().toLowerCase();
    const mail = u && u.email ? u.email.trim().toLowerCase() : "";
    el.style.color = "";
    if (!u) {
      el.textContent = "";
      return;
    }
    if (!owner) {
      el.textContent =
        "Uyarı: ownerEmail boş — kurallar yazmayı reddeder. Aşağıya giriş yaptığınız e-postayı yazıp Kaydet’e basın (Firebase Console’dan da eklenebilir).";
      el.style.color = "#fca5a5";
      return;
    }
    if (mail && mail === owner) {
      el.textContent =
        "Kurallar: Giriş e-postanız ownerEmail ile eşleşiyor; içerik/kategori kaydı çalışmalı. Hâlâ PERMISSION_DENIED alıyorsanız bu kuralları Firebase’e yeniden yayınlayın.";
      el.style.color = "#86efac";
    } else {
      el.textContent =
        "Kurallar: Giriş e-postası (" +
        (u.email || "?") +
        ") ile ownerEmail (" +
        val("s_owner").trim() +
        ") eşleşmiyor — kayıt reddedilir. Düzeltip Kaydedin veya Console’da settings/ownerEmail güncelleyin.";
      el.style.color = "#fca5a5";
    }
  }

  async function loadSettingsForm() {
    const s = (await DataService.settingsOnce()) || {};
    $("s_owner").value = s.ownerEmail || "";
    $("s_title").value = s.siteTitle || "DEHLİZ";
    $("s_tagline").value = s.tagline || "";
    $("s_interval").value = s.heroIntervalMs || 8000;
    const raw = s.heroContentIds;
    state.heroOrder = Array.isArray(raw) ? raw.filter(Boolean) : [];
    const mw = s.mostWatchedContentIds;
    state.mostWatchedOrder = Array.isArray(mw) ? mw.filter(Boolean).slice(0, 10) : [];
    renderHeroPicker();
    renderMostWatchedPicker();
    updateRuleStatus();
  }

  async function saveSettings() {
    const heroContentIds = (state.heroOrder || []).filter((id) => state.content[id]);
    const mostWatchedContentIds = (state.mostWatchedOrder || []).filter((id) => state.content[id]).slice(0, 10);
    await DataService.settingsRef().update({
      ownerEmail: $("s_owner").value.trim() || "",
      siteTitle: $("s_title").value.trim() || "DEHLİZ",
      tagline: $("s_tagline").value.trim(),
      heroIntervalMs: Number($("s_interval").value) || 8000,
      heroContentIds: heroContentIds.length ? heroContentIds : [],
      mostWatchedContentIds: mostWatchedContentIds
    });
    state.heroOrder = heroContentIds.slice();
    state.mostWatchedOrder = mostWatchedContentIds.slice();
    renderHeroPicker();
    renderMostWatchedPicker();
    updateRuleStatus();
    alert("Kaydedildi.");
  }

  async function saveCat() {
    const name = $("c_name").value.trim();
    let id;
    if (state.editingCatId) {
      id = state.editingCatId;
      if (!name) return alert("Görünen isim gerekli.");
    } else {
      const manual = sanitizeId($("c_id").value);
      if (manual) {
        if (state.cats[manual]) return alert("Bu teknik ID zaten kullanılıyor. Farklı bir ID girin veya alanı boş bırakın.");
        id = manual;
      } else {
        if (!name) return alert("Kategori adı gerekli (teknik ID boşsa isimden otomatik oluşturulur).");
        id = uniqueSlugFromName(name);
      }
    }
    await DataService.categoriesRef().child(id).set({
      name: name || id,
      order: Number($("c_order").value) || 0,
      visible: $("c_visible").checked
    });
    resetCatForm();
  }

  function wire() {
    $("btnAdminLogin").addEventListener("click", async () => {
      $("loginMsg").classList.add("hidden");
      try {
        await dehlizAuth.signInWithEmailAndPassword($("lem").value.trim(), $("lpw").value);
      } catch (e) {
        $("loginMsg").textContent = e.message || "Giriş hatası";
        $("loginMsg").classList.remove("hidden");
      }
    });
    $("btnDeniedOut").addEventListener("click", () => dehlizSignOut());
    $("btnAppOut").addEventListener("click", () => dehlizSignOut());

    document.querySelectorAll(".admin-nav a").forEach((a) => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        tab(a.getAttribute("data-tab"));
      });
    });

    $("btnSaveSettings").addEventListener("click", () => saveSettings());
    $("s_owner").addEventListener("input", () => updateRuleStatus());
    $("btnHeroClear").addEventListener("click", () => {
      state.heroOrder = [];
      renderHeroPicker();
    });
    $("btnMostClear").addEventListener("click", () => {
      state.mostWatchedOrder = [];
      renderMostWatchedPicker();
    });
    $("btnSaveCat").addEventListener("click", () => saveCat());
    $("btnCatReset").addEventListener("click", () => resetCatForm());
    $("btnNewContent").addEventListener("click", () => openEditor("", null));
    $("btnSaveContent").addEventListener("click", (e) => saveContent(e));
    $("btnCancelContent").addEventListener("click", () => closeEditor());
    $("btnGrantPro").addEventListener("click", () => setSelectedUsersPro(true));
    $("btnRevokePro").addEventListener("click", () => setSelectedUsersPro(false));
    $("btnPlus3d").addEventListener("click", () => assignSelectedUsersPlusDays(3));
    $("btnPlus5d").addEventListener("click", () => assignSelectedUsersPlusDays(5));
    $("btnPlus10d").addEventListener("click", () => assignSelectedUsersPlusDays(10));
    $("btnPlus15d").addEventListener("click", () => assignSelectedUsersPlusDays(15));
    $("btnPlus30d").addEventListener("click", () => assignSelectedUsersPlusDays(30));
    $("btnSelectAllUsers").addEventListener("click", () => {
      Object.keys(state.users || {}).forEach((uid) => {
        state.selectedUsers[uid] = true;
      });
      renderUsers();
    });
    $("btnClearUsersSelection").addEventListener("click", () => {
      state.selectedUsers = {};
      renderUsers();
    });
    $("btnAddEpisode").addEventListener("click", () => {
      const current = collectEpisodes();
      current.push({
        id: episodeId(),
        title: "",
        description: "",
        bunnyLibraryId: "",
        bunnyVideoId: "",
        order: current.length + 1
      });
      renderEpisodeEditor(current);
    });

    dehlizAuth.onAuthStateChanged(async (user) => {
      state.user = user;
      if (!user) {
        show("loginView");
        return;
      }
      await DataService.ensureUserProfile(user);
      const admin = await DataService.isAdmin(user);
      if (!admin) {
        $("deniedUid").textContent = "UID: " + user.uid;
        show("deniedView");
        return;
      }
      show("appView");
      await loadSettingsForm();
      bindLive();
    });
  }

  function bindLive() {
    if (window.__dehlizAdminLive) return;
    window.__dehlizAdminLive = true;
    DataService.categoriesRef().on("value", (snap) => {
      state.cats = snap.val() || {};
      renderCats();
      maybeRefreshCategoryPicker();
      renderDash();
    });
    DataService.contentRef().on("value", (snap) => {
      state.content = snap.val() || {};
      renderContent();
      maybeRefreshHeroPicker();
      renderDash();
    });
    dehlizDb.ref("users").on(
      "value",
      (snap) => {
        state.users = snap.val() || {};
        Object.keys(state.selectedUsers).forEach((uid) => {
          if (!state.users[uid]) delete state.selectedUsers[uid];
        });
        renderUsers();
        renderBans();
        renderDash();
      },
      () => {
        $("usersInfo").textContent =
          "Kullanıcılar okunamadı (izin). Rules publish edildiğini ve owner/admin hesabıyla giriş yaptığınızı kontrol edin.";
      }
    );
    DataService.commentBansRef().on(
      "value",
      (snap) => {
        state.commentBans = snap.val() || {};
        renderBans();
        renderDash();
      },
      () => {
        const body = $("bansBody");
        if (body) {
          body.innerHTML =
            '<tr><td colspan="6" style="color:#a1a1aa">Engellenenler okunamadı. Rules publish edildiğini kontrol edin.</td></tr>';
        }
      }
    );
  }

  document.addEventListener("DOMContentLoaded", () => {
    wire();
    tab("dash");
  });
})();
