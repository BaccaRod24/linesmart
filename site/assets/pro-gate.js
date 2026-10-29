/* Tiny public loader. Does nothing visible unless is_pro() returns true, then fetches the
   private bundle. Local flags are not an input. No Pro screens live in this file. */
(function () {
  "use strict";
  const G = window.ProGateCore, AC = window.AcctCore;
  if (!G || !AC) return;
  let started = false, verified = false, gen = 0, resolveReady;
  const ready = new Promise(r => { resolveReady = r; });
  const settle = () => { if (resolveReady) { const f = resolveReady; resolveReady = null; f(); } };

  function noindex() {
    const on = G.isOwnerHash(location.hash);
    let m = document.querySelector('meta[name="robots"][data-pro-gate]');
    if (!on) { if (m) m.remove(); return; }
    if (!m) {
      m = document.createElement("meta");
      m.setAttribute("name", "robots");
      m.dataset.proGate = "1";
      document.head.appendChild(m);
    }
    m.setAttribute("content", "noindex, nofollow");
  }
  function token() {
    let raw = "";
    try { raw = localStorage.getItem(AC.AUTH_KEY) || ""; } catch (e) { raw = ""; }
    return G.tokenOf(raw);
  }
  function playerFromDom() {
    const a = document.querySelector("a[href*='#/p/']");
    const m = a && /#\/p\/([^/]+)\/([^/?#]+)/.exec(a.getAttribute("href") || "");
    return m ? { lg: decodeURIComponent(m[1]), id: decodeURIComponent(m[2]) } : null;
  }
  /** Where Pro should attach. Public pages pass this into the private bundle. It does not grant access. */
  function context() {
    const hash = location.hash || "";
    const path = hash.replace(/^#\/?/, "").split("?")[0];
    const segs = path ? path.split("/") : [];
    const page = (document.body && document.body.dataset.page) || "";
    const lgAttr = (document.body && document.body.dataset.lg) || "";
    const route = (document.body && document.body.dataset.route) || "";
    const base = { hash, page, lg: lgAttr, id: "", kind: "other" };
    if (segs[0] === "owner") return { ...base, kind: "owner" };
    if (segs[0] === "g" && segs[1] && segs[2]) return { ...base, kind: "game", lg: segs[1], id: decodeURIComponent(segs[2]) };
    if (segs[0] === "p" && segs[1] && segs[2]) return { ...base, kind: "props", lg: segs[1], id: decodeURIComponent(segs[2]) };
    if (segs[0] === "bets") return { ...base, kind: "bets" };
    if (segs[0] === "l" && segs[1]) return { ...base, kind: "league", lg: segs[1] };
    if (!segs[0]) {
      if (page === "game") {
        const r = route.split("/");
        return { ...base, kind: "game", lg: r[1] || lgAttr, id: r[2] ? decodeURIComponent(r[2]) : "" };
      }
      if (page === "player") {
        const found = playerFromDom();
        return { ...base, kind: "props", lg: (found && found.lg) || lgAttr, id: (found && found.id) || "" };
      }
      if (page === "hub") return { ...base, kind: "league", lg: lgAttr };
      if (page === "results") return { ...base, kind: "results", lg: lgAttr };
      if (!page) return { ...base, kind: "home" };
      return { ...base, kind: page };
    }
    return base;
  }
  async function ask(tok) {
    let res;
    try {
      res = await fetch(G.rpcUrl(AC.SB_URL), {
        method: "POST",
        headers: { apikey: AC.SB_KEY, Authorization: "Bearer " + tok, "Content-Type": "application/json", Accept: "application/json" },
        body: "{}",
        cache: "no-store",
      });
    } catch (e) { return "unknown"; }
    if (!res.ok) return G.verdict(null, false);
    let body;
    try { body = await res.json(); } catch (e) { return "unknown"; }
    if (G.allow(body)) return "yes";
    return G.verdict(body, true);
  }
  async function bundle(tok) {
    const res = await fetch(G.bundleUrl(AC.SB_URL), {
      headers: { apikey: AC.SB_KEY, Authorization: "Bearer " + tok },
      cache: "no-store",
    });
    if (!res.ok) return "";
    return await res.text();
  }
  function mount(code) {
    const s = document.createElement("script");
    s.dataset.proBundle = "1";
    s.text = code;
    document.body.appendChild(s);
  }
  function missing() {
    if (!G.isOwnerHash(location.hash) || window.LSProApp) return;
    const app = document.getElementById("app");
    if (!app) return;
    app.innerHTML = `<div class="card" data-pro-missing><p>Pro files aren't published yet.</p></div>`;
  }
  async function reveal(fireHash) {
    if (!window.LSProApp) return;
    if (window.LSProApp.boot) window.LSProApp.boot();
    if (window.LSProApp.enhance) {
      try { await window.LSProApp.enhance(context()); } catch (e) {}
    }
    if (fireHash && G.isOwnerHash(location.hash)) window.dispatchEvent(new HashChangeEvent("hashchange"));
  }
  function conceal() {
    verified = false;
    if (window.LSProApp && window.LSProApp.hide) window.LSProApp.hide();
  }

  async function check() {
    const n = ++gen;
    const first = !started;
    started = true;
    try {
      noindex();
      const tok = token();
      if (!tok) {
        if (n !== gen) return;
        conceal();
        return;
      }
      const v = await ask(tok);
      if (n !== gen) return;
      if (G.shouldHide(true, v)) { conceal(); return; }
      if (v !== "yes") {
        if (verified) await reveal(false);
        return;
      }
      if (!window.LSProApp) {
        let code = "";
        try { code = await bundle(tok); } catch (e) { code = ""; }
        if (n !== gen) return;
        if (!code || code.indexOf("window.LSProApp") < 0) { missing(); return; }
        mount(code);
      }
      if (n !== gen || !window.LSProApp) return;
      verified = true;
      await reveal(!first);
    } finally {
      settle();
    }
  }

  window.LSProGate = { ready, check, context, verified: () => verified };
  window.addEventListener("hashchange", noindex);
  window.addEventListener("ls-auth", () => { check(); });
  check();
})();
