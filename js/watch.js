(function () {
  function qs(name) {
    const u = new URL(window.location.href);
    return u.searchParams.get(name);
  }

  const id = qs("id");
  const selectedEpId = qs("ep");
  const meta = document.getElementById("meta");
  const player = document.getElementById("player");
  const lock = document.getElementById("lock");
  const episodesPanel = document.getElementById("episodesPanel");
  const episodesList = document.getElementById("episodesList");
  const commentAuthBox = document.getElementById("commentAuthBox");
  const commentWriteBox = document.getElementById("commentWriteBox");
  const commentsList = document.getElementById("commentsList");
  const commentAs = document.getElementById("commentAs");
  const cAuthErr = document.getElementById("cAuthErr");
  const commentInput = document.getElementById("commentInput");
  const commentLimit = document.getElementById("commentLimit");
  const commentsPanel = document.getElementById("commentsPanel");

  let currentUser = null;
  let currentProfile = null;
  let currentIsAdmin = false;
  let currentUserCommentBanned = false;
  let backgroundBlockedSrc = "";
  let backgroundRestrictionNotified = false;
  let currentItemForPlayback = null;
  let currentSourceForPlayback = null;
  let currentMyList = {};
  let myListRef = null;
  let cachedItem = null;
  let contentNodeRef = null;
  let commentsQueryRef = null;
  let commentsPageSize = 25;
  let commentsLoadMoreBtn = null;
  let authResolved = false;
  const myListToggleLockById = Object.create(null);

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

  function canBackgroundPlay() {
    if (currentIsAdmin) return true;
    return isPlusMember(currentProfile);
  }

  function sendPlayerCommand(cmd) {
    if (!player || !player.contentWindow) return;
    const commandPayloads = [];
    if (cmd === "play") {
      commandPayloads.push(
        { method: "play" },
        { type: "play" },
        { action: "play" },
        { event: "command", func: "play", args: [] },
        { event: "command", func: "playVideo", args: [] }
      );
    } else if (cmd === "pause") {
      commandPayloads.push(
        { method: "pause" },
        { type: "pause" },
        { action: "pause" },
        { event: "command", func: "pause", args: [] },
        { event: "command", func: "pauseVideo", args: [] }
      );
    }
    commandPayloads.forEach((payload) => {
      try {
        player.contentWindow.postMessage(payload, "*");
      } catch (_e) {}
      try {
        player.contentWindow.postMessage(JSON.stringify(payload), "*");
      } catch (_e) {}
    });
  }

  function applyBackgroundRestriction() {
    if (!player) return;
    if (!backgroundBlockedSrc) backgroundBlockedSrc = player.getAttribute("src") || "";
    try {
      sendPlayerCommand("pause");
      player.setAttribute("src", "about:blank");
      player.removeAttribute("src");
    } catch (_e) {}
    // Non-plus kullanıcıda kilit ekranı medya kartını da söndür.
    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = "none";
      } catch (_e) {}
    }
  }

  function showBackgroundRestrictionNotice() {
    if (backgroundRestrictionNotified) return;
    backgroundRestrictionNotified = true;
    const box = document.createElement("div");
    box.textContent = "Arka planda oynatma yalnızca +PLUS üyeliğe özeldir.";
    box.className = "bg-play-notice";
    document.body.appendChild(box);
    setTimeout(() => {
      box.style.transition = "opacity 220ms ease";
      box.style.opacity = "0";
      setTimeout(() => {
        if (box.parentNode) box.parentNode.removeChild(box);
      }, 240);
    }, 2200);
  }

  function buildArtworkList(url) {
    const clean = String(url || "").trim();
    if (!clean) return [];
    const lower = clean.toLowerCase();
    let type = "";
    if (lower.indexOf(".png") !== -1) type = "image/png";
    else if (lower.indexOf(".webp") !== -1) type = "image/webp";
    else if (lower.indexOf(".jpg") !== -1 || lower.indexOf(".jpeg") !== -1) type = "image/jpeg";
    const base = [
      { src: clean, sizes: "96x96" },
      { src: clean, sizes: "192x192" },
      { src: clean, sizes: "512x512" }
    ];
    return type ? base.map((x) => ({ ...x, type })) : base;
  }

  function releaseBackgroundRestriction() {
    if (!player) return;
    if (!backgroundBlockedSrc) return;
    const restore = backgroundBlockedSrc;
    backgroundBlockedSrc = "";
    if (!player.getAttribute("src")) player.setAttribute("src", restore);
  }

  function setMediaSessionMetadata() {
    if (!("mediaSession" in navigator)) return;
    const canShow = canBackgroundPlay();
    if (!canShow || !currentItemForPlayback) {
      try {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = "none";
      } catch (_e) {}
      return;
    }
    const item = currentItemForPlayback || {};
    const src = currentSourceForPlayback || item || {};
    const title = (src.title || item.title || "DEHLİZ").trim();
    const art = src.posterUrl || item.posterUrl || src.backdropUrl || item.backdropUrl || "";
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title,
        artist: "DEHLİZ",
        album: "Korku Sineması",
        artwork: buildArtworkList(art)
      });
      navigator.mediaSession.playbackState = "playing";
      navigator.mediaSession.setActionHandler("play", () => {
        sendPlayerCommand("play");
        navigator.mediaSession.playbackState = "playing";
      });
      navigator.mediaSession.setActionHandler("pause", () => {
        sendPlayerCommand("pause");
        navigator.mediaSession.playbackState = "paused";
      });
      navigator.mediaSession.setActionHandler("seekbackward", null);
      navigator.mediaSession.setActionHandler("seekforward", null);
      navigator.mediaSession.setActionHandler("previoustrack", null);
      navigator.mediaSession.setActionHandler("nexttrack", null);
    } catch (_e) {}
  }

  async function toggleMyListForCurrentItem() {
    if (!id || !currentUser || !currentUser.uid) return false;
    if (myListToggleLockById[id]) return false;

    myListToggleLockById[id] = true;
    try {
      const wasListed = !!currentMyList[id];
      const optimisticAdded = !wasListed;
      if (optimisticAdded) currentMyList[id] = true;
      else delete currentMyList[id];
      if (currentItemForPlayback) renderMeta(currentItemForPlayback);

      const result = await DataService.toggleMyListSecure(id);
      const serverAdded = !!(result && result.added === true);
      if (serverAdded !== optimisticAdded) {
        if (serverAdded) currentMyList[id] = true;
        else delete currentMyList[id];
        if (currentItemForPlayback) renderMeta(currentItemForPlayback);
      }
      return true;
    } catch (err) {
      const currentlyListed = !!currentMyList[id];
      if (currentlyListed) delete currentMyList[id];
      else currentMyList[id] = true;
      if (currentItemForPlayback) renderMeta(currentItemForPlayback);
      throw err;
    } finally {
      myListToggleLockById[id] = false;
    }
  }

  function renderMeta(item) {
    const canList = !!(currentUser && (currentIsAdmin || isPlusMember(currentProfile)));
    const listed = !!currentMyList[id];
    meta.innerHTML =
      "<h1>" +
      escapeHtml(item.title || "") +
      "</h1>" +
      '<p class="sub">' +
      [item.year, item.maturity, isProContent(item) ? "+PLUS" : "Herkese açık"].filter(Boolean).join(" · ") +
      "</p>" +
      '<p class="desc">' +
      escapeHtml(item.description || "") +
      "</p>" +
      (canList
        ? '<button type="button" class="watch-list-btn' +
          (listed ? " is-added" : "") +
          '" id="watchListBtn">' +
          (listed ? "Listenden çıkar" : "Listene ekle") +
          "</button>"
        : "");
    const listBtn = document.getElementById("watchListBtn");
    if (listBtn) {
      listBtn.addEventListener("click", async () => {
        listBtn.disabled = true;
        try {
          await toggleMyListForCurrentItem();
        } catch (e) {
          alert("Liste işlemi başarısız: " + dehlizUserError(e, "Lütfen tekrar deneyin."));
        } finally {
          if (listBtn.isConnected) listBtn.disabled = false;
        }
      });
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function sortedEpisodes(item) {
    return (Array.isArray(item && item.episodes) ? item.episodes : [])
      .slice()
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  }


  function sortedComments(obj) {
    return Object.entries(obj || {})
      .map(([commentId, value]) => ({ commentId, ...(value || {}) }))
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  }

  function formatDate(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("tr-TR");
  }

  function displayNameForUser(user, profile) {
    return (profile && profile.displayName) || (user && user.email ? user.email.split("@")[0] : "Kullanici");
  }

  function isCurrentUserLoggedIn() {
    return !!(currentUser && currentUser.uid);
  }

  function canInteractWithComments() {
    if (isCurrentUserLoggedIn()) return true;
    commentAuthBox.classList.remove("hidden");
    commentWriteBox.classList.add("hidden");
    return false;
  }

  function likesCount(comment) {
    return Object.keys((comment && comment.likes) || {}).length;
  }

  function hasCurrentUserLiked(comment) {
    return !!(comment && comment.likes && currentUser && currentUser.uid && comment.likes[currentUser.uid] === true);
  }

  async function toggleCommentLike(comment) {
    if (!canInteractWithComments()) return;
    if (!id || !comment || !comment.commentId) return;
    const ref = DataService.commentsRef(id).child(comment.commentId).child("likes").child(currentUser.uid);
    const liked = hasCurrentUserLiked(comment);
    if (liked) await ref.remove();
    else await ref.set(true);
  }

  async function toggleAdminHeart(comment) {
    if (!currentIsAdmin) return;
    if (!id || !comment || !comment.commentId) return;
    const base = DataService.commentsRef(id).child(comment.commentId);
    if (comment.adminHearted === true) {
      await Promise.all([
        base.child("adminHearted").remove(),
        base.child("adminHeartAt").remove(),
        base.child("adminHeartBy").remove()
      ]);
      return;
    }
    await Promise.all([
      base.child("adminHearted").set(true),
      base.child("adminHeartAt").set(Date.now()),
      base.child("adminHeartBy").set(currentUser.uid)
    ]);
  }

  async function sendReply(comment, input, btn) {
    if (!canInteractWithComments()) return;
    if (currentUserCommentBanned) {
      alert("Yorum yazma yetkiniz kaldırıldı.");
      return;
    }
    if (!id || !comment || !comment.commentId) return;
    const text = String((input && input.value) || "").trim();
    if (!text) return;
    const payload = {
      uid: currentUser.uid,
      displayName: String(displayNameForUser(currentUser, currentProfile)).slice(0, 32),
      text: text.slice(0, 400),
      createdAt: Date.now(),
      isPro: !!(currentProfile && currentProfile.isPro === true),
      isAdmin: !!currentIsAdmin
    };
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Gönderiliyor…";
    try {
      await DataService.commentsRef(id).child(comment.commentId).child("replies").push(payload);
      input.value = "";
    } catch (e) {
      alert("Yanıt gönderilemedi: " + dehlizUserError(e, "Lütfen tekrar deneyin."));
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  async function deleteComment(commentId) {
    if (!currentIsAdmin || !id || !commentId) return;
    await DataService.commentsRef(id).child(commentId).remove();
  }

  async function deleteReply(commentId, replyId) {
    if (!currentIsAdmin || !id || !commentId || !replyId) return;
    await DataService.commentsRef(id).child(commentId).child("replies").child(replyId).remove();
  }

  async function banUserFromComments(uid) {
    if (!currentIsAdmin || !uid) return;
    await DataService.commentBanRef(uid).set({
      banned: true,
      bannedAt: Date.now(),
      bannedBy: currentUser ? currentUser.uid : null
    });
  }

  function renderUserTagHtml(entry) {
    const name = escapeHtml(entry.displayName || "Kullanici");
    if (entry.isAdmin) {
      return (
        '<span class="comment-admin-badge" aria-label="DEHLİZ yönetici">' +
        '<img class="comment-admin-logo" src="https://dehliz.b-cdn.net/videolarda%20giri%C5%9F%20logo.png" alt="DEHLİZ logo" loading="lazy" />' +
        '<span class="comment-admin-text">DEHLİZ</span>' +
        "</span>"
      );
    }
    return '<span class="comment-name">' + name + "</span>";
  }

  function selectEpisode(item) {
    const eps = sortedEpisodes(item);
    if (!eps.length) return null;
    const fromQuery = eps.find((x) => x.id === selectedEpId);
    return fromQuery || eps[0] || null;
  }

  function renderEpisodeList(item) {
    const eps = sortedEpisodes(item);
    if (!eps.length) {
      episodesPanel.style.display = "none";
      return null;
    }
    episodesPanel.style.display = "block";
    const current = selectEpisode(item);
    episodesList.innerHTML = "";
    eps.forEach((ep, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "episode-btn" + (current && current.id === ep.id ? " active" : "");
      btn.innerHTML =
        "<strong>Bölüm " +
        String(idx + 1) +
        ": " +
        escapeHtml(ep.title || "Başlıksız") +
        "</strong><span>" +
        escapeHtml(ep.description || "") +
        "</span>";
      btn.addEventListener("click", () => {
        const u = new URL(window.location.href);
        u.searchParams.set("ep", ep.id);
        window.location.href = u.toString();
      });
      episodesList.appendChild(btn);
    });
    return current;
  }

  async function getItem() {
    if (cachedItem) return cachedItem;
    if (!id) return null;
    const snap = await dehlizDb.ref("content/" + id).once("value");
    if (!snap.exists()) return null;
    cachedItem = snap.val();
    return cachedItem;
  }

  function bindContentLive() {
    if (!id) return;
    if (contentNodeRef) contentNodeRef.off();
    contentNodeRef = dehlizDb.ref("content/" + id);
    contentNodeRef.on("value", (snap) => {
      if (!snap.exists()) return;
      cachedItem = snap.val();
      run();
    });
  }

  async function run() {
    if (!id) {
      meta.innerHTML = "<p>Geçersiz bağlantı.</p>";
      return;
    }
    const item = await getItem();
    if (!item) {
      meta.innerHTML = "<p>İçerik bulunamadı.</p>";
      return;
    }
    renderMeta(item);
    const currentEpisode = renderEpisodeList(item);

    const plusRequired = isProContent(item);
    const allowed = !plusRequired || currentIsAdmin || isPlusMember(currentProfile);
    // Auth/profil yuklenmeden erken redirect olursa +PLUS kullanici da yanlislikla abonelik sayfasina gidebilir.
    if (plusRequired && !allowed && !authResolved) return;
    if (!allowed) {
      try {
        player.setAttribute("src", "about:blank");
      } catch (_e) {}
      lock.style.display = "flex";
      player.removeAttribute("src");
      window.location.replace("subscribe.html");
      return;
    }

    const source = currentEpisode || item;
    currentItemForPlayback = item;
    currentSourceForPlayback = source;
    const lib = source.bunnyLibraryId;
    const vid = source.bunnyVideoId;
    if (!lib || !vid) {
      lock.style.display = "flex";
      lock.querySelector("h1").textContent = "Video yapılandırılmamış";
      lock.querySelector("p").textContent =
        currentEpisode
          ? "Bu bölüm için Bunny Kütüphane ID ve Video ID girilmelidir."
          : "Yönetim panelinden Bunny Kütüphane ID ve Video ID girilmelidir.";
      player.removeAttribute("src");
      return;
    }

    player.src = bunnyEmbedUrl(lib, vid);
    setMediaSessionMetadata();
  }

  function renderCommentList(raw) {
    const list = sortedComments(raw);
    commentsList.innerHTML = "";
    if (!list.length) {
      commentsList.innerHTML =
        '<div class="comment-item"><div class="comment-text">Henüz yorum yok. İlk yorumu sen yaz.</div></div>';
      return;
    }
    list.forEach((c) => {
      const card = document.createElement("article");
      card.className = "comment-item";
      const txt = escapeHtml(c.text || "");
      const authorBlock = renderUserTagHtml(c);
      const likedByMe = hasCurrentUserLiked(c);
      const likeTotal = likesCount(c);
      const replies = Object.entries(c.replies || {})
        .map(([replyId, reply]) => ({ replyId, ...(reply || {}) }))
        .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
      const adminHeartBadge =
        c.adminHearted === true
          ? '<span class="comment-admin-heart" aria-label="Admin beğeni sayısı">' +
            '<span class="comment-admin-heart-icon">❤</span>' +
            '<span class="comment-admin-heart-count">DEHLİZ KALBİ</span></span>'
          : "";
      const likeLabel = likedByMe ? "Beğeniyi geri çek" : "Beğen";
      const adminHeartAction =
        currentIsAdmin
          ? '<button type="button" class="comment-heart-btn' +
            (c.adminHearted === true ? " is-active" : "") +
            '" aria-label="Yoruma admin kalbi bırak">' +
            '<span class="heart">❤</span><span>' +
            (c.adminHearted === true ? "Kalbi geri çek" : "Kalp") +
            "</span></button>"
          : "";
      const adminOptionsAction =
        currentIsAdmin && c.uid
          ? '<div class="comment-admin-options">' +
            '<button type="button" class="comment-admin-menu-btn" aria-label="Yorum seçenekleri">⋯</button>' +
            '<div class="comment-admin-menu hidden">' +
            '<button type="button" class="comment-admin-action" data-action="delete-comment">Yorumu sil</button>' +
            '<button type="button" class="comment-admin-action" data-action="ban-user">Kullanıcıyı yorumdan engelle</button>' +
            "</div></div>"
          : "";
      card.innerHTML =
        '<div class="comment-item-head">' +
        authorBlock +
        adminHeartBadge +
        (c.isPro ? '<span class="comment-pro">PLUS ÜYE</span>' : "") +
        '<span class="comment-date">' +
        escapeHtml(formatDate(c.createdAt)) +
        "</span>" +
        adminOptionsAction +
        "</div>" +
        '<div class="comment-text">' +
        txt +
        "</div>" +
        '<div class="comment-actions">' +
        '<button type="button" class="comment-like-btn' +
        (likedByMe ? " is-active" : "") +
        '" aria-label="Yorumu beğen">' +
        '<span class="thumb">👍</span><span>' +
        likeLabel +
        "</span><span class=\"count\">" +
        likeTotal +
        "</span></button>" +
        adminHeartAction +
        '<button type="button" class="comment-reply-toggle" aria-label="Yoruma yanıt yaz">Yanıtla</button>' +
        "</div>" +
        '<div class="comment-reply-wrap hidden">' +
        '<textarea class="comment-reply-input" maxlength="400" placeholder="Bu yoruma yanıt yaz..."></textarea>' +
        '<div class="comment-reply-row"><button type="button" class="comment-btn comment-reply-send">Yanıt gönder</button></div>' +
        "</div>" +
        '<div class="comment-replies"></div>';

      const likeBtn = card.querySelector(".comment-like-btn");
      const heartBtn = card.querySelector(".comment-heart-btn");
      const menuBtn = card.querySelector(".comment-admin-menu-btn");
      const menu = card.querySelector(".comment-admin-menu");
      const replyToggle = card.querySelector(".comment-reply-toggle");
      const replyWrap = card.querySelector(".comment-reply-wrap");
      const replyInput = card.querySelector(".comment-reply-input");
      const replySend = card.querySelector(".comment-reply-send");
      const repliesWrap = card.querySelector(".comment-replies");

      likeBtn.addEventListener("click", () => {
        toggleCommentLike(c).catch((e) => alert("Beğeni güncellenemedi: " + dehlizUserError(e, "Lütfen tekrar deneyin.")));
      });
      if (heartBtn) {
        heartBtn.addEventListener("click", () => {
          toggleAdminHeart(c).catch((e) => alert("Kalp güncellenemedi: " + dehlizUserError(e, "Lütfen tekrar deneyin.")));
        });
      }
      if (menuBtn && menu) {
        menuBtn.addEventListener("click", () => {
          menu.classList.toggle("hidden");
        });
        menu.querySelectorAll(".comment-admin-action").forEach((btn) => {
          btn.addEventListener("click", () => {
            const action = btn.getAttribute("data-action");
            if (action === "delete-comment") {
              deleteComment(c.commentId).catch((e) => alert("Yorum silinemedi: " + dehlizUserError(e, "Lütfen tekrar deneyin.")));
            } else if (action === "ban-user") {
              banUserFromComments(c.uid).catch((e) => alert("Kullanıcı engellenemedi: " + dehlizUserError(e, "Lütfen tekrar deneyin.")));
            }
            menu.classList.add("hidden");
          });
        });
      }
      replyToggle.addEventListener("click", () => {
        const willOpen = replyWrap.classList.contains("hidden");
        replyWrap.classList.toggle("hidden");
        if (willOpen) replyInput.focus();
      });
      replySend.addEventListener("click", () => {
        sendReply(c, replyInput, replySend);
      });

      repliesWrap.innerHTML = "";
      replies.forEach((r) => {
        const reply = document.createElement("div");
        reply.className = "reply-item";
        const replyAdminOptions =
          currentIsAdmin && r.uid
            ? '<div class="comment-admin-options">' +
              '<button type="button" class="comment-admin-menu-btn" aria-label="Yanıt seçenekleri">⋯</button>' +
              '<div class="comment-admin-menu hidden">' +
              '<button type="button" class="comment-admin-action" data-action="delete-reply">Yanıtı sil</button>' +
              '<button type="button" class="comment-admin-action" data-action="ban-user">Kullanıcıyı yorumdan engelle</button>' +
              "</div></div>"
            : "";
        reply.innerHTML =
          '<div class="reply-head">' +
          renderUserTagHtml(r) +
          (r.isPro ? '<span class="comment-pro">PLUS ÜYE</span>' : "") +
          '<span class="comment-date">' +
          escapeHtml(formatDate(r.createdAt)) +
          "</span>" +
          replyAdminOptions +
          "</div>" +
          '<div class="reply-text">' +
          escapeHtml(r.text || "") +
          "</div>";
        const rMenuBtn = reply.querySelector(".comment-admin-menu-btn");
        const rMenu = reply.querySelector(".comment-admin-menu");
        if (rMenuBtn && rMenu) {
          rMenuBtn.addEventListener("click", () => rMenu.classList.toggle("hidden"));
          rMenu.querySelectorAll(".comment-admin-action").forEach((btn) => {
            btn.addEventListener("click", () => {
              const action = btn.getAttribute("data-action");
              if (action === "delete-reply") {
                deleteReply(c.commentId, r.replyId).catch((e) => alert("Yanıt silinemedi: " + dehlizUserError(e, "Lütfen tekrar deneyin.")));
              } else if (action === "ban-user") {
                banUserFromComments(r.uid).catch((e) => alert("Kullanıcı engellenemedi: " + dehlizUserError(e, "Lütfen tekrar deneyin.")));
              }
              rMenu.classList.add("hidden");
            });
          });
        }
        repliesWrap.appendChild(reply);
      });

      commentsList.appendChild(card);
    });
    updateCommentsLoadMoreVisibility(list.length);
  }

  function ensureCommentsLoadMoreButton() {
    if (commentsLoadMoreBtn) return commentsLoadMoreBtn;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "comment-btn ghost comments-load-more";
    btn.textContent = "Daha fazla yorum yükle";
    btn.addEventListener("click", () => {
      commentsPageSize += 25;
      bindCommentsLive();
    });
    commentsPanel.appendChild(btn);
    commentsLoadMoreBtn = btn;
    return btn;
  }

  function updateCommentsLoadMoreVisibility(currentCount) {
    const btn = ensureCommentsLoadMoreButton();
    // Görünen yorum sayısı sayfa boyutuna ulaştıysa daha eski yorumlar olabilir.
    if (currentCount >= commentsPageSize) btn.classList.remove("hidden");
    else btn.classList.add("hidden");
  }

  function bindCommentsLive() {
    if (!id) return;
    if (commentsQueryRef) commentsQueryRef.off();
    commentsQueryRef = DataService.commentsRef(id).orderByChild("createdAt").limitToLast(commentsPageSize);
    commentsQueryRef.on("value", (snap) => {
      renderCommentList(snap.exists() ? snap.val() : {});
    });
  }

  function updateCommentAuthUI() {
    const u = currentUser;
    if (!u) {
      commentAuthBox.classList.remove("hidden");
      commentWriteBox.classList.add("hidden");
      return;
    }
    commentAuthBox.classList.add("hidden");
    commentWriteBox.classList.remove("hidden");
    commentInput.disabled = false;
    commentInput.readOnly = false;
    const display = displayNameForUser(u, currentProfile);
    const pro = !!(currentProfile && currentProfile.isPro === true);
    if (currentUserCommentBanned) {
      commentAs.textContent = "Yorum yapan: " + display + " · Yorum yetkiniz kapatıldı";
      commentInput.disabled = true;
      commentInput.readOnly = true;
      document.getElementById("commentSendBtn").disabled = true;
      return;
    }
    document.getElementById("commentSendBtn").disabled = false;
    commentAs.textContent = "Yorum yapan: " + display + (pro ? " · +PLUS" : "");
  }

  async function sendComment() {
    if (!currentUser) return;
    if (currentUserCommentBanned) {
      alert("Yorum yazma yetkiniz kaldırıldı.");
      return;
    }
    const text = (commentInput.value || "").trim();
    if (!text) return;
    const display =
      (currentProfile && currentProfile.displayName) || (currentUser.email ? currentUser.email.split("@")[0] : "Kullanici");
    const payload = {
      uid: currentUser.uid,
      displayName: String(display).slice(0, 32),
      text: text.slice(0, 800),
      createdAt: Date.now(),
      isPro: !!(currentProfile && currentProfile.isPro === true),
      isAdmin: !!currentIsAdmin
    };
    const btn = document.getElementById("commentSendBtn");
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Gönderiliyor…";
    try {
      await DataService.commentsRef(id).push(payload);
      commentInput.value = "";
      commentLimit.textContent = "0 / 800";
    } catch (e) {
      alert("Yorum kaydedilemedi: " + dehlizUserError(e, "Lütfen tekrar deneyin."));
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  async function loginForComment() {
    cAuthErr.classList.add("hidden");
    const cAuthOk = document.getElementById("cAuthOk");
    if (cAuthOk) cAuthOk.classList.add("hidden");
    const email = (document.getElementById("cLoginEmail").value || "").trim();
    const pw = document.getElementById("cLoginPw").value || "";
    try {
      await dehlizAuth.signInWithEmailAndPassword(email, pw);
    } catch (e) {
      cAuthErr.textContent = dehlizUserError(e, "Giriş hatası.");
      cAuthErr.classList.remove("hidden");
    }
  }

  function wireCommentUi() {
    document.getElementById("cLoginBtn").addEventListener("click", loginForComment);
    document.getElementById("cRegisterBtn").addEventListener("click", () => {
      const email = encodeURIComponent((document.getElementById("cLoginEmail").value || "").trim());
      window.location.href = "register.html?email=" + email;
    });
    document.getElementById("cLogoutBtn").addEventListener("click", () => dehlizSignOut());
    document.getElementById("commentSendBtn").addEventListener("click", sendComment);
    commentInput.addEventListener("input", () => {
      const v = (commentInput.value || "").length;
      commentLimit.textContent = v + " / 800";
    });
  }

  dehlizAuth.onAuthStateChanged(() => {
    authResolved = false;
    lock.style.display = "none";
    currentUser = dehlizAuth.currentUser;
    const loadData = currentUser
      ? DataService.ensureUserProfile(currentUser).then(() =>
          Promise.all([
            DataService.userOnce(currentUser.uid),
            DataService.isAdmin(currentUser),
            DataService.commentBanOnce(currentUser.uid)
          ])
        )
      : Promise.resolve([null, false, null]);
    loadData
      .then(([profile, isAdmin, commentBan]) => {
        currentProfile = profile;
        currentIsAdmin = !!isAdmin;
        currentUserCommentBanned = !!(commentBan && commentBan.banned === true);
        if (myListRef) myListRef.off();
        if (currentUser) {
          myListRef = DataService.userListRef(currentUser.uid);
          myListRef.on("value", (snap) => {
            currentMyList = snap.val() || {};
            if (currentItemForPlayback) renderMeta(currentItemForPlayback);
          });
        }
        authResolved = true;
        updateCommentAuthUI();
        run();
      })
      .catch(() => {
        currentProfile = null;
        currentIsAdmin = false;
        currentUserCommentBanned = false;
        currentMyList = {};
        if (myListRef) {
          myListRef.off();
          myListRef = null;
        }
        authResolved = true;
        updateCommentAuthUI();
        run();
      });
  });

  wireCommentUi();
  bindCommentsLive();
  bindContentLive();

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (canBackgroundPlay()) {
        // Plus/Admin kullanıcıda kilitlenme anında sistem pause ederse,
        // kısa aralıklarla play komutu gönderip devamlılığı güçlendir.
        setTimeout(() => sendPlayerCommand("play"), 120);
        setTimeout(() => sendPlayerCommand("play"), 620);
        return;
      }
      applyBackgroundRestriction();
      return;
    }
    if (!canBackgroundPlay() && backgroundBlockedSrc) showBackgroundRestrictionNotice();
    releaseBackgroundRestriction();
    setMediaSessionMetadata();
  });

  window.addEventListener("pagehide", () => {
    if (canBackgroundPlay()) return;
    applyBackgroundRestriction();
  });

  window.addEventListener("blur", () => {
    if (canBackgroundPlay()) return;
    // Mobilde oynaticiya dokunma veya UI odagi degisimi blur tetikleyebilir.
    // Sayfa gercekten arka plana dusmediyse videoyu kapatma.
    if (!document.hidden) return;
    applyBackgroundRestriction();
  });
})();
