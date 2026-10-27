/* LineSmart live scores: browser side. Polls ESPN (site.web.api.espn.com, CORS-enabled) while a game on screen is live and
 * the tab is visible, keeps the latest overlay per game, and calls back into app.js so it can re-render just the changed tiles,
 * ticker items and the game hero. Pure parsing/merging lives in live-core.js (unit-tested in scripts/live_test.mjs).
 * Rules: no requests when nothing on screen is live or the tab is hidden; fetches use cache:"no-store" (the service worker
 * lets them straight through); ESPN failing -> back off and fall back to re-reading the static data files. */
(() => {
  const C = window.LiveCore;
  if (!C) return;
  const store = {};          // "lg/id" -> latest overlay
  const sigs = {};           // "lg/id" -> last signature handed to the page
  const boxes = {};          // "lg/id" -> latest parsed box score (summary)
  let W = null, timer = null, wake = null, inflight = false, failures = 0, lastTick = 0, lastStatic = 0, lastSummary = 0, sumSig = "";
  const TIMEOUT_MS = 10000, STATIC_EVERY_MS = 120000;

  const saveData = () => { const c = navigator.connection; return !!(c && (c.saveData || /(^|slow-)2g|3g/.test(c.effectiveType || ""))); };
  async function getJ(url) {
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : null, t = ctl && setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      // simple GET, no custom headers (a preflight would fail); no-store so neither the HTTP cache nor the SW serves stale scores
      const r = await fetch(url, { cache: "no-store", credentials: "omit", signal: ctl ? ctl.signal : undefined });
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      if (r.headers.get("X-LineSmart-Offline")) throw new Error("offline copy");   // the SW's saved copy is not live data
      return await r.json();
    } finally { if (t) clearTimeout(t); }
  }
  const clear = () => { if (timer) clearTimeout(timer); if (wake) clearTimeout(wake); timer = wake = null; };
  const later = (ms) => { if (timer) clearTimeout(timer); timer = setTimeout(tick, ms); };

  // keep the scoreboard's down & distance when a summary (which has none) arrives for the same moment of the game
  function keep(k, ov) {
    const prev = store[k];
    if (prev && ov.situation && !ov.situation.text && prev.situation && prev.situation.text && prev.detail === ov.detail && prev.state === ov.state)
      ov.situation = Object.assign({}, prev.situation, { possession: ov.situation.possession || prev.situation.possession });
    if (prev && Date.parse(prev.asOf) > Date.parse(ov.asOf)) return false;
    store[k] = ov; return true;
  }
  function changedKeys(keys) {
    const out = [];
    for (const k of keys) { const s = C.sig(store[k]); if (s !== sigs[k]) { sigs[k] = s; out.push(k); } }
    return out;
  }
  const watchedKeys = () => new Set((W ? W.games : []).map(g => C.key(g.lg, g.id)));

  function summaryDue(now) {
    if (!W || !W.summary) return false;
    const s = W.summary, ov = store[C.key(s.lg, s.id)];
    if (!lastSummary) return s.state !== "pre" || C.needsLive(s, now, ov);    // first load: live or final box score
    if (!C.needsLive(s, now, ov)) return false;                               // final: fetched once, done
    return now - lastSummary >= C.intervals({ saveData: saveData() }).summary - 1000;
  }

  async function tick() {
    timer = null;
    if (!W || inflight) return;
    if (document.hidden) return;   // resumed by visibilitychange
    const w = W, now = Date.now(); lastTick = now;
    const plan = C.plan(w.games, now, store), lgs = Object.keys(plan), wantSum = summaryDue(now);
    if (!lgs.length && !wantSum) { setStatus(false); return armWake(); }   // nothing live on screen: no polling
    inflight = true;
    let ok = 0, bad = 0;
    const touched = [];
    const jobs = [];
    for (const lg of lgs) for (const day of plan[lg]) jobs.push(getJ(C.scoreboardUrl(lg, day)).then(sb => {
      const asOf = new Date().toISOString(), m = C.parseScoreboard(lg, sb, asOf); ok++;
      for (const [k, ov] of Object.entries(m)) if (keep(k, ov)) touched.push(k);
    }, () => { bad++; }));
    let model = null;
    if (wantSum) jobs.push(getJ(C.summaryUrl(w.summary.lg, w.summary.id)).then(sm => {
      model = C.parseSummary(w.summary.lg, sm, new Date().toISOString()); ok++; lastSummary = Date.now();
      if (model) { const k = C.key(w.summary.lg, w.summary.id); boxes[k] = model.box; if (keep(k, model.overlay)) touched.push(k); }
    }, () => { bad++; }));
    await Promise.all(jobs);
    inflight = false;
    if (w !== W) return;   // navigated away meanwhile
    const wk = watchedKeys(), ch = changedKeys([...new Set(touched)].filter(k => wk.has(k)));
    if (ch.length && w.onChange) try { w.onChange(ch); } catch (e) { console.warn(e); }
    if (model && w.onSummary) { const s = JSON.stringify(model.box) + C.sig(model.overlay); if (s !== sumSig) { sumSig = s; try { w.onSummary(model); } catch (e) { console.warn(e); } } }
    failures = ok ? 0 : bad ? failures + 1 : failures;
    setStatus(ok > 0, failures);
    if (failures >= 2 && Date.now() - lastStatic > STATIC_EVERY_MS && w.onStatic) {   // ESPN down: re-read our own data files
      lastStatic = Date.now();
      try { const games = await w.onStatic(lgs.length ? lgs : [w.summary && w.summary.lg].filter(Boolean)); if (w === W && games) W.games = games; } catch (e) { console.warn(e); }
    }
    if (w === W) later(C.intervals({ failures, saveData: saveData() }).score);
  }
  // a game that hasn't started: sleep until just before its listed start instead of polling
  function armWake() {
    if (!W) return;
    const now = Date.now();
    const next = W.games.map(g => Date.parse(g.date) - 90e3).filter(t => !isNaN(t) && t > now && t - now < 12 * 3600e3).sort((a, b) => a - b)[0];
    if (wake) clearTimeout(wake);
    wake = next ? setTimeout(() => { wake = null; tick(); }, next - now) : null;
  }
  function setStatus(on, fails = 0) {
    document.documentElement.classList.toggle("ls-live-on", !!on);
    document.querySelectorAll("[data-lv-stamp]").forEach(el => {
      if (on && W) { const t = new Date(); el.textContent = `Live · updated ${t.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", second: "2-digit" })} ET`; el.classList.remove("lv-off"); }
      else if (fails) { el.textContent = "Live updates paused (ESPN not responding) · showing last data"; el.classList.add("lv-off"); }
    });
  }

  document.addEventListener("visibilitychange", () => {
    if (!W) return;
    if (document.hidden) { if (timer) clearTimeout(timer); timer = null; return; }
    if (Date.now() - lastTick > 5000) tick(); else later(C.intervals({ failures, saveData: saveData() }).score);
  });
  window.addEventListener("online", () => { if (W) { failures = 0; tick(); } });

  window.LSLive = {
    // opts: {games:[{lg,id,state,date}], summary?:{lg,id,state,date}, onChange(keys), onSummary(model), onStatic(lgs)->Promise<games>}
    watch(opts) {
      clear(); W = Object.assign({ games: [] }, opts); W.games = (W.games || []).filter(g => g && C.supported(g.lg));
      failures = 0; lastSummary = 0; sumSig = "";
      // anything already known renders immediately (e.g. coming back to a page)
      tick();
    },
    stop() { clear(); W = null; setStatus(false); },
    get: (lg, id) => store[C.key(lg, id)] || null,
    box: (lg, id) => boxes[C.key(lg, id)] || null,
    merge: (lg, g, generated) => (g ? C.mergeGame(g, store[C.key(lg, g.id)], generated) : g),
    mergeTicker: (t, generated) => (t ? C.mergeTicker(t, store[C.key(t.lg, t.id)], generated) : t),
    status: () => ({ watching: !!W, polling: !!timer, failures, lastTick, games: W ? W.games.length : 0 }),
    _store: store,
  };
})();
