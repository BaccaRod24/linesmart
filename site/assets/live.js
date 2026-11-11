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
  let W = null, timer = null, wake = null, inflight = false, failures = 0, lastTick = 0, lastStatic = 0, lastSummary = 0, sumSig = "", rerun = false;
  const TIMEOUT_MS = 10000, STATIC_EVERY_MS = 120000, FRESH_MS = 20000;
  const fresh = new Map(), flying = new Map();   // same URL in flight, or fetched this poll, is not requested again

  const saveData = () => { const c = navigator.connection; return !!(c && (c.saveData || /(^|slow-)2g|3g/.test(c.effectiveType || ""))); };
  async function getJ(url) {
    const hit = fresh.get(url);
    if (hit && Date.now() - hit.at < FRESH_MS) return hit.json;
    if (flying.has(url)) return flying.get(url);
    const p = (async () => {
      const ctl = typeof AbortController !== "undefined" ? new AbortController() : null, t = ctl && setTimeout(() => ctl.abort(), TIMEOUT_MS);
      try {
        // simple GET, no custom headers (a preflight would fail); no-store so neither the HTTP cache nor the SW serves stale scores
        const r = await fetch(url, { cache: "no-store", credentials: "omit", signal: ctl ? ctl.signal : undefined });
        if (!r.ok) throw new Error(`${r.status} ${url}`);
        if (r.headers.get("X-LineSmart-Offline")) throw new Error("offline copy");   // the SW's saved copy is not live data
        const json = await r.json();
        fresh.set(url, { at: Date.now(), json });
        return json;
      } finally { if (t) clearTimeout(t); flying.delete(url); }
    })();
    flying.set(url, p);
    return p;
  }
  const clear = () => { if (timer) clearTimeout(timer); if (wake) clearTimeout(wake); timer = wake = null; };
  const later = (ms) => { if (timer) clearTimeout(timer); timer = setTimeout(tick, ms); };

  // keep the scoreboard's down & distance when a summary (which has none) arrives for the same moment of the game
  function keep(k, ov) {
    const prev = store[k];
    if (prev && ov.situation && !ov.situation.text && prev.situation && prev.situation.text && prev.detail === ov.detail && prev.state === ov.state)
      ov.situation = Object.assign({}, prev.situation, { possession: ov.situation.possession || prev.situation.possession });
    // A per-game college read has the score and the clock, not the quarter line or the last play.
    if (prev && !ov.situation && prev.situation && prev.detail === ov.detail && prev.state === ov.state) ov.situation = prev.situation;
    if (prev && ov.home && prev.home && !(ov.home.linescores || []).length && (prev.home.linescores || []).length && prev.detail === ov.detail) {
      ov.home.linescores = prev.home.linescores; if (ov.away && prev.away) ov.away.linescores = prev.away.linescores;
    }
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
    if (!W) return;
    if (inflight) { rerun = true; return; }   // a newer watch() (page re-rendered) while a request is out: run again when it lands
    if (document.hidden) return;   // resumed by visibilitychange
    const w = W, now = Date.now(); lastTick = now;
    const needing = (w.games || []).filter(g => C.needsLive(g, now, store[C.key(g.lg, g.id)]));
    const byLg = {};
    for (const g of needing) (byLg[g.lg] ||= []).push(g);
    const lgs = Object.keys(byLg), wantSum = summaryDue(now);
    if (!lgs.length && !wantSum) { setStatus(false); return armWake(); }   // nothing live on screen: no polling
    inflight = true;
    let ok = 0, bad = 0;
    const touched = [];
    const jobs = [];
    async function fetchDirect(g) {
      const lg = g.lg, id = String(g.id), asOf = new Date().toISOString();
      let homeId = g.homeId, awayId = g.awayId;
      const statusP = getJ(C.directStatusUrl(lg, id));
      if (!homeId || !awayId) {
        const comp = await getJ(C.directCompetitionUrl(lg, id));
        for (const c of (comp && comp.competitors) || []) {
          if (c.homeAway === "home") homeId = c.id;
          else if (c.homeAway === "away") awayId = c.id;
        }
      }
      if (!homeId || !awayId) throw new Error("no teams");
      const [status, hs, as] = await Promise.all([statusP, getJ(C.directScoreUrl(lg, id, homeId)), getJ(C.directScoreUrl(lg, id, awayId))]);
      const ov = C.parseDirect(lg, id, status, hs, as, homeId, awayId, asOf);
      const k = C.key(lg, id);
      if (ov && keep(k, ov)) touched.push(k);
    }
    for (const lg of lgs) {
      const gs = byLg[lg];
      if (C.useDirect(lg, gs)) {
        for (const g of gs) jobs.push(fetchDirect(g).then(() => { ok++; }, () => { bad++; }));
      } else {
        for (const day of new Set(gs.map(g => C.etDay(g.date)).filter(Boolean))) jobs.push(getJ(C.scoreboardUrl(lg, day)).then(sb => {
          const asOf = new Date().toISOString(), m = C.parseScoreboard(lg, sb, asOf); ok++;
          for (const [k, ov] of Object.entries(m)) if (keep(k, ov)) touched.push(k);
        }, () => { bad++; }));
      }
    }
    let model = null;
    if (wantSum) jobs.push(getJ(C.summaryUrl(w.summary.lg, w.summary.id)).then(sm => {
      model = C.parseSummary(w.summary.lg, sm, new Date().toISOString()); ok++; lastSummary = Date.now();
      if (model) { const k = C.key(w.summary.lg, w.summary.id); boxes[k] = model.box; if (keep(k, model.overlay)) touched.push(k); }
    }, () => { bad++; }));
    await Promise.all(jobs);
    inflight = false;
    if (w !== W) { if (W && rerun) { rerun = false; tick(); } return; }   // navigated away / re-watched meanwhile: start polling for the new page
    rerun = false;
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
