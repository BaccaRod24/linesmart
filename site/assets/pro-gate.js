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
  /** Where Pro should attach. Public pages pass this into the private bundle. It does not grant access. */
  function context() {
    const ds = (document.body && document.body.dataset) || {};
    const link = document.querySelector("a[href*='#/p/']");
    let ctx = G.pageContext({
      hash: location.hash,
      page: ds.page || "",
      lg: ds.lg || "",
      route: ds.route || "",
      gid: ds.gid || "",
      pid: ds.pid || "",
      playerHref: link ? link.getAttribute("href") : "",
    });
    if (ctx.id) return ctx;
    if (ctx.kind !== "game" && ctx.kind !== "props" && ds.page !== "game" && ds.page !== "player") return ctx;
    const pages = window.LSApp && window.LSApp.pages && window.LSApp.pages();
    const hit = pages && G.idFromPages(pages, location.pathname);
    if (!hit) return ctx;
    if (ds.page === "player" || hit.kind === "props") return { ...ctx, kind: "props", lg: hit.lg, id: hit.id };
    return { ...ctx, kind: "game", lg: hit.lg, id: hit.id };
  }
  function stored() {
    try { return localStorage.getItem(AC.AUTH_KEY) || ""; } catch (e) { return ""; }
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
    } catch (e) { return { verdict: "unknown", status: 0 }; }
    if (!res.ok) return { verdict: G.verdict(null, false), status: res.status };
    let body;
    try { body = await res.json(); } catch (e) { return { verdict: "unknown", status: res.status }; }
    if (G.allow(body)) return { verdict: "yes", status: res.status };
    return { verdict: G.verdict(body, true), status: res.status };
  }
  // One refresh per stale access token. A TOKEN_REFRESHED event starts another check; it must not refresh again.
  let refreshP = null, refreshedFor = null;
  async function refreshOnce(stale) {
    const key = stale || "";
    if (refreshP) return refreshP;
    if (refreshedFor === key) return "";
    const acct = window.LSAccount;
    if (!acct || !acct.client) return "";
    refreshedFor = key;
    refreshP = (async () => {
      try {
        const sb = await acct.client();
        if (acct.session) {
          const s = await acct.session();
          const got = (s && s.access_token) || token();
          if (got && got !== stale) return got;
        }
        if (!sb || !sb.auth || !sb.auth.refreshSession) return "";
        const { data, error } = await sb.auth.refreshSession();
        if (error || !data || !data.session) return "";
        const next = data.session.access_token || "";
        return next && next !== stale ? next : "";
      } catch (e) { return ""; }
      finally { refreshP = null; }
    })();
    return refreshP;
  }
  async function bundle(tok) {
    const res = await fetch(G.bundleUrl(AC.SB_URL, G.SITE_BUILD), {
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
    console.info("LineSmart Pro build " + (window.__PRO_BUILD || "no-build-id"));
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
      const raw = stored();
      let tok = G.tokenOf(raw);
      if ((!tok || G.accessStale(raw)) && G.hasRefresh(raw)) {
        const next = await refreshOnce(tok);
        if (n !== gen) return;
        if (next) tok = next;
      }
      if (!tok) {
        if (n !== gen) return;
        conceal();
        return;
      }
      let result = await ask(tok);
      if (n !== gen) return;
      if (result.status === 401 && G.hasRefresh(stored())) {
        const next = await refreshOnce(tok);
        if (n !== gen) return;
        if (next && next !== tok) {
          tok = next;
          result = await ask(tok);
          if (n !== gen) return;
        }
      }
      const v = result.verdict;
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
      if (n === gen) settle();
    }
  }

  window.LSProGate = { ready, check, context, verified: () => verified };
  window.addEventListener("hashchange", noindex);
  window.addEventListener("ls-auth", () => { check(); });
  check();
})();
