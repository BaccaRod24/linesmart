/* Tiny public loader. Does nothing visible unless is_pro() returns true, then fetches the
   private bundle. Local flags are not an input. No Pro screens live in this file. */
(function () {
  "use strict";
  const G = window.ProGateCore, AC = window.AcctCore;
  if (!G || !AC) return;
  let started = false, gen = 0, resolveReady;
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
  async function rpc(tok) {
    const res = await fetch(G.rpcUrl(AC.SB_URL), {
      method: "POST",
      headers: { apikey: AC.SB_KEY, Authorization: "Bearer " + tok, "Content-Type": "application/json", Accept: "application/json" },
      body: "{}",
      cache: "no-store",
    });
    if (!res.ok) return false;
    try { return await res.json(); } catch (e) { return false; }
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

  async function check() {
    const n = ++gen;
    const first = !started;
    started = true;
    try {
      noindex();
      const tok = token();
      let ok = false;
      if (tok) {
        try { ok = G.allow(await rpc(tok)); } catch (e) { ok = false; }
      }
      if (n !== gen) return;
      if (!ok) {
        if (window.LSProApp && window.LSProApp.hide) window.LSProApp.hide();
        return;
      }
      if (!window.LSProApp) {
        let code = "";
        try { code = await bundle(tok); } catch (e) { code = ""; }
        if (n !== gen) return;
        if (!code || code.indexOf("window.LSProApp") < 0) { missing(); return; }
        mount(code);
      }
      if (window.LSProApp && window.LSProApp.boot) window.LSProApp.boot();
      if (!first && G.isOwnerHash(location.hash)) window.dispatchEvent(new HashChangeEvent("hashchange"));
    } finally {
      settle();
    }
  }

  window.LSProGate = { ready, check };
  window.addEventListener("hashchange", noindex);
  window.addEventListener("ls-auth", () => { check(); });
  check();
})();
