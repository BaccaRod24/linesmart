/* Futures route (#/l/<league>/futures and #/l/golf/futures). Loaded by assets/load.js. */
(() => {
  const C = () => window.FuturesCore;
  const A = () => window.LSApp;
  const G = () => window.LSGeo || null;

  function formatWhen(iso) {
    const L = A();
    if (!iso || !L || !L.fullET) return iso ? String(iso) : "";
    return L.fullET(iso);
  }
  function formatDate(iso) {
    const L = A();
    if (!iso || !L || !L.fmt) return iso ? String(iso).slice(0, 10) : "";
    return L.fmt(iso, { month: "short", day: "numeric", year: "numeric" });
  }

  async function view(opts) {
    const app = (opts && opts.app) || document.getElementById("app");
    const key = opts.key;
    const core = C();
    if (!core) {
      app.innerHTML = `<div class="empty"><h3>Futures didn't load</h3>Reload the page to try again.</div>`;
      return;
    }
    let doc = null;
    try { doc = await A().getJSON(`data/futures/${key}.json`); }
    catch (e) { doc = { v: 1, league: key, markets: [] }; }
    if (!doc || typeof doc !== "object") doc = { v: 1, league: key, markets: [] };
    doc.league = doc.league || key;
    const ev = G() && G().current ? G().current() : null;
    const meta = A().meta ? A().meta() : null;
    const L = meta && meta.leagues ? meta.leagues[key] : null;
    app.innerHTML = core.page(doc, {
      league: key,
      name: L && L.name,
      full: key === "golf" ? "Golf majors" : (L && L.full) || (key || "").toUpperCase(),
      seg: opts.seg || "",
      geo: ev,
      formatWhen,
      formatDate,
    });
  }

  window.LSFutures = { view };
})();
