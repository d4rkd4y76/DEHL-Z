(function () {
  const $ = (id) => document.getElementById(id);

  function query(name) {
    const u = new URL(window.location.href);
    return String(u.searchParams.get(name) || "");
  }

  function normalizeSearchText(value) {
    return String(value || "")
      .trim()
      .toLocaleLowerCase("tr-TR")
      .replace(/\s+/g, " ");
  }

  function scoreSearchItem(item, queryText) {
    const q = normalizeSearchText(queryText);
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
    q.split(" ")
      .filter(Boolean)
      .forEach((w) => {
        if (title.indexOf(w) !== -1) score += 20;
        else if (hay.indexOf(w) !== -1) score += 8;
      });
    return score;
  }

  function isProContent(item) {
    const v = item && item.isPro;
    return v === true || v === 1 || v === "1" || String(v).toLowerCase() === "true";
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

  function searchItems(contentMap, queryText) {
    const q = normalizeSearchText(queryText);
    if (!q) return [];
    return Object.entries(contentMap || {})
      .map(([id, value]) => ({ id, ...(value || {}) }))
      .map((item) => ({ item, score: scoreSearchItem(item, q) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return String(a.item.title || "").localeCompare(String(b.item.title || ""), "tr");
      })
      .map((x) => x.item);
  }

  function card(item) {
    const el = document.createElement("article");
    el.className = "card search-card";
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    const duration = formatDuration(item);
    const episodeCount = Array.isArray(item && item.episodes) ? item.episodes.length : 0;
    el.innerHTML =
      '<div class="card-media"><img class="card-poster" alt="" src="' +
      (item.posterUrl || "") +
      '" loading="lazy" />' +
      (episodeCount > 1 ? '<span class="card-episodes-badge">' + episodeCount + " Bölüm</span>" : "") +
      "</div>" +
      '<div class="card-body"><div class="card-title"></div><div class="card-meta-row">' +
      (duration ? '<span class="card-duration">' + duration + "</span>" : "") +
      (isProContent(item) ? '<span class="card-pro">+PLUS</span>' : "") +
      "</div></div>";
    el.querySelector(".card-title").textContent = item.title || "Başlıksız";
    const go = () => {
      window.location.href = "watch.html?id=" + encodeURIComponent(item.id || "");
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

  async function runSearch(queryText) {
    const grid = $("searchGrid");
    const title = $("searchTitle");
    const meta = $("searchMeta");
    const q = String(queryText || "").trim();

    $("searchPageInput").value = q;
    if (!q) {
      title.textContent = "Arama";
      meta.textContent = "Aramak istediğiniz başlığı yazarak sonuçları görüntüleyin.";
      grid.innerHTML = '<p style="color:#a1a1aa">Henüz arama yapılmadı.</p>';
      return;
    }

    title.textContent = '"' + q + '" için sonuçlar';
    meta.textContent = "Sonuçlar yükleniyor…";
    const content = await DataService.contentOnce();
    const results = searchItems(content, q);
    meta.textContent = results.length + " sonuç bulundu";
    grid.innerHTML = "";
    if (!results.length) {
      grid.innerHTML = '<p style="color:#a1a1aa">Eşleşen içerik bulunamadı.</p>';
      return;
    }
    results.forEach((item) => grid.appendChild(card(item)));
  }

  document.addEventListener("DOMContentLoaded", () => {
    const form = $("searchPageForm");
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const q = ($("searchPageInput").value || "").trim();
      const u = new URL(window.location.href);
      if (q) u.searchParams.set("q", q);
      else u.searchParams.delete("q");
      window.location.href = u.toString();
    });

    runSearch(query("q")).catch((e) => {
      $("searchMeta").textContent = "Arama sırasında hata oluştu.";
      console.error(e);
    });
  });
})();
