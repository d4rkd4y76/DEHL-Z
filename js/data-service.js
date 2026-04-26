(function () {
  const db = () => window.dehlizDb;

  function snapVal(snap) {
    return snap.exists() ? snap.val() : null;
  }

  window.DataService = {
    settingsOnce() {
      return db().ref("settings").once("value").then(snapVal);
    },
    settingsRef() {
      return db().ref("settings");
    },
    categoriesOnce() {
      return db()
        .ref("categories")
        .once("value")
        .then((snap) => snapVal(snap) || {});
    },
    contentOnce() {
      return db()
        .ref("content")
        .once("value")
        .then((snap) => snapVal(snap) || {});
    },
    contentRef() {
      return db().ref("content");
    },
    categoriesRef() {
      return db().ref("categories");
    },
    userRef(uid) {
      return db().ref("users/" + uid);
    },
    userOnce(uid) {
      return this.userRef(uid)
        .once("value")
        .then(snapVal);
    },
    userListRef(uid) {
      return db().ref("users/" + uid + "/myList");
    },
    userListOnce(uid) {
      return this.userListRef(uid)
        .once("value")
        .then((snap) => snapVal(snap) || {});
    },
    commentsRef(contentId) {
      return db().ref("comments/" + contentId);
    },
    commentsOnce(contentId) {
      return this.commentsRef(contentId)
        .once("value")
        .then((snap) => snapVal(snap) || {});
    },
    commentBanRef(uid) {
      return db().ref("commentBans/" + uid);
    },
    commentBanOnce(uid) {
      return this.commentBanRef(uid)
        .once("value")
        .then(snapVal);
    },
    commentBansRef() {
      return db().ref("commentBans");
    },
    adminsRef() {
      return db().ref("admins");
    },
    isAdmin(user) {
      if (!user || !user.uid) return Promise.resolve(false);
      const email = user.email || "";
      return Promise.all([
        db()
          .ref("admins/" + user.uid)
          .once("value"),
        db().ref("settings/ownerEmail").once("value")
      ]).then(([adminSnap, ownerSnap]) => {
        if (adminSnap.val() === true) return true;
        const owner = ownerSnap.val();
        return !!(email && owner && email === owner);
      });
    },
    ensureUserProfile(user, displayName) {
      if (!user) return Promise.resolve();
      const ref = this.userRef(user.uid);
      return ref.once("value").then((snap) => {
        const safeName =
          (displayName && String(displayName).trim()) ||
          (user.displayName && String(user.displayName).trim()) ||
          (user.email ? String(user.email).split("@")[0] : "") ||
          "Kullanici";
        if (!snap.exists()) {
          return ref.set({
            email: user.email || "",
            displayName: safeName,
            isPro: false,
            createdAt: Date.now()
          });
        }
        const cur = snap.val() || {};
        if (!cur.displayName) {
          return ref.child("displayName").set(safeName);
        }
        return null;
      });
    },
    updateDisplayName(uid, displayName) {
      return this.userRef(uid).child("displayName").set(String(displayName || "").trim());
    },
    async toggleMyListSecure(contentId) {
      const user = window.dehlizAuth && window.dehlizAuth.currentUser;
      if (!user) throw new Error("Giriş yapmanız gerekiyor.");
      const idToken = await user.getIdToken();
      const base = (window.DEHLIZ_CONFIG && window.DEHLIZ_CONFIG.recoveryApiBase) || "";
      if (!base) throw new Error("API adresi yapılandırılmamış.");
      const endpoint = base.replace(/\/$/, "") + "/myListToggle";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + idToken
        },
        body: JSON.stringify({ contentId: String(contentId || "") })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        throw new Error((data && data.message) || "Liste işlemi başarısız.");
      }
      return {
        added: data.added === true,
        contentId: data.contentId || String(contentId || "")
      };
    }
  };
})();
