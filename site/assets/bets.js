/* LineSmart "My Bets": a private bet tracker. Bets live in this browser (localStorage); nothing is sent anywhere unless the
   visitor signs in on the Account tab, which syncs them to their own account (assets/account.js).
 * Routes: #/bets (overview), #/bets/list, #/bets/add[?lg=&ev=&mk=&side=&ln=&od=&bk=[&pid=&pm=&pn=]], #/bets/edit/<id>
 *   (mk=prop + pid/pm = a player prop from data/props/<lg>.json; pn = player name when he isn't in the feed)
 * Pure math/settlement lives in bets-core.js (window.BetCore); app helpers come from window.LSApp. */
(() => {
  const C = window.BetCore;
  const A = () => window.LSApp;
  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = s => A().esc(s);
  const isNum = C.isNum;
  const am = v => (isNum(v) ? (v > 0 ? "+" + v : String(v)) : "");
  const ln = v => (isNum(v) ? (v > 0 ? "+" + v : v == 0 ? "PK" : String(v)) : "");
  const money = (v, sign) => {
    if (!isNum(v)) return "—";
    const s = Math.abs(v).toLocaleString("en-US", { style: "currency", currency: "USD" });
    return sign ? (v > 0 ? "+" : v < 0 ? "−" : "") + s : (v < 0 ? "−" : "") + s;
  };
  const pct = (v, sign) => (v === null || v === undefined ? "—" : (sign && v > 0 ? "+" : "") + (v * 100).toFixed(1) + "%");
  const cls = v => (v > 0 ? "pos" : v < 0 ? "neg" : "");
  const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
  const lgName = k => { try { return A().lgName(k); } catch (e) { return String(k || "").toUpperCase(); } };
  const SOCCER = C.SOCCER;
  const PC = () => window.PropsCore;
  const FEED_NAME = { draftkings: "DraftKings'", hardrockbet: "Hard Rock Bet's", fanduel: "FanDuel's" };
  const TRACK_BOOK = { draftkings: "draftkings", hardrockbet: "hardrock", fanduel: "fanduel" };   // feed / odds-file key -> tracker key
  const PROP_LG = new Set(Object.keys(C.PROP_MARKETS));   // leagues with a props feed + box-score settlement (NFL, NBA)
  const GEO = () => window.LSGeo || null;
  const okBook = bk => { const g = GEO(), k = C.FEED_KEY[bk]; return !g || !k || !g.current().state || g.isAvailable(k); };
  /** New-bet book: the last one used, unless it isn't legal online in the visitor's state (Florida: Hard Rock Bet). */
  function defaultBook() {
    const last = prefs().book, geo = GEO() && GEO().defaultBetBook();
    if (last && C.BOOKS[last] && okBook(last)) return last;
    return geo || (last && C.BOOKS[last] ? last : "draftkings");
  }

  // ---------- storage (this device only)
  const DEMO_KEY = "ls-bets-demo";   // set only by scripts/screenshots_bets.mjs to label example data
  // Each bet carries a stable id + updatedAt (for optional Account sync, assets/account.js). Deletions leave a small
  // tombstone (id -> time) until they're pushed, so a delete on one device removes the bet on the others.
  const AC = window.AcctCore || null;
  let SIG = {};
  const readTombs = () => { try { return JSON.parse(localStorage.getItem(AC ? AC.TOMB_KEY : "ls-bets-tomb-v1") || "{}") || {}; } catch (e) { return {}; } };
  const writeTombs = t => { try { if (Object.keys(t).length) localStorage.setItem(AC.TOMB_KEY, JSON.stringify(t)); else localStorage.removeItem(AC.TOMB_KEY); } catch (e) {} };
  const writeRaw = bets => localStorage.setItem(C.KEY, JSON.stringify({ v: 1, saved: new Date().toISOString(), bets }));
  function load() {
    let bets;
    try { const d = JSON.parse(localStorage.getItem(C.KEY) || "null"); bets = Array.isArray(d && d.bets) ? d.bets.map(C.normalizeBet).filter(Boolean) : []; }
    catch (e) { bets = []; }
    if (AC) { const m = AC.migrate(bets, new Date().toISOString(), C.uid); bets = m.bets; if (m.changed) try { writeRaw(bets); } catch (e) {} SIG = AC.snapshot(bets); }
    return bets;
  }
  let BETS = load();
  function save() {
    try {
      if (AC) {
        const now = new Date().toISOString(), st = AC.stamp(SIG, BETS, now);
        BETS = st.bets;
        writeRaw(BETS); SIG = st.sig;
        if (st.removed.length) { const t = readTombs(); for (const id of st.removed) t[id] = now; writeTombs(t); }
        window.dispatchEvent(new CustomEvent("ls-bets-changed"));
      } else writeRaw(BETS);
      return true;
    }
    catch (e) { toast("Couldn't save: this browser's storage is full or blocked."); return false; }
  }
  // for assets/account.js: a consistent read of this device's bets, and a guarded write of the merged result
  function syncState() { const bets = load(); return { bets, tombs: readTombs(), raw: localStorage.getItem(C.KEY) || "" }; }
  function applySync(bets, tombs, raw) {
    if ((localStorage.getItem(C.KEY) || "") !== raw) return false;          // edited meanwhile: the caller syncs again
    try { writeRaw(bets); } catch (e) { return false; }
    writeTombs(tombs || {});
    BETS = bets; SIG = AC.snapshot(bets);
    const seg = location.hash.replace(/^#\/?/, "").split("?")[0].split("/");
    if (seg[0] === "bets" && seg[1] !== "add" && seg[1] !== "edit" && seg[1] !== "import") view();   // never wipe a form in progress
    return true;
  }

  window.addEventListener("storage", e => { if (e.key === C.KEY) { BETS = load(); if (/^#\/bets/.test(location.hash)) view(); } });
  const isDemo = () => localStorage.getItem(DEMO_KEY) === "1";
  const prefs = () => { try { return JSON.parse(localStorage.getItem("ls-bets-prefs") || "{}"); } catch (e) { return {}; } };
  const setPref = (k, v) => { const p = prefs(); p[k] = v; try { localStorage.setItem("ls-bets-prefs", JSON.stringify(p)); } catch (e) {} };

  // ---------- describing bets
  const bookName = b => (b.book === "other" ? b.bookOther || "Other" : C.BOOKS[b.book] || b.book);
  const teamOf = (s, side) => (s.event && s.event[side]) || null;
  function describe(s) {
    const type = s.type || s.mk;
    if (type === "parlay") return `${(s.legs || []).length}-leg parlay`;
    if (type === "prop" && s.prop && s.prop.mk) return C.describeProp(s);
    if (s.selection && (!s.event || type === "prop")) return s.selection;
    if (type === "total") return `${s.side === "under" ? "Under" : "Over"} ${isNum(s.line) ? s.line : ""}`.trim();
    if (s.side === "draw") return "Draw";
    const t = teamOf(s, s.side);
    const nm = t ? t.short || t.name || t.abbr : s.side;
    if (type === "spread") return `${nm} ${ln(s.line)}`;
    if (type === "ml") return `${nm} ML`;
    return s.selection || "";
  }
  const eventLabel = s => (s.event ? s.event.name || `${(s.event.away || {}).abbr} @ ${(s.event.home || {}).abbr}` : s.eventText || "");
  const badge = st => `<span class="bs bs-${esc(st)}">${esc(C.STATUS[st] || st)}</span>`;

  // ---------- auto-settle (ESPN finals, read in the browser)
  // Site data files first (they include today's finals); otherwise ESPN's summary endpoint on site.web.api.espn.com (CORS-enabled).
  let lastAuto = 0, autoBusy = false, REVIEWED = 0;
  async function espnSummary(lg, id) {
    const path = (A().LG[lg] || [])[0]; if (!path) return null;
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 10000);
    try {
      const r = await fetch(`https://site.web.api.espn.com/apis/site/v2/sports/${path}/summary?event=${encodeURIComponent(id)}`, { signal: ctl.signal, cache: "no-store" });
      return r.ok ? await r.json() : null;
    } catch (e) { return null; } finally { clearTimeout(t); }
  }
  async function fetchFinal(lg, id, box) {
    if (box && PROP_LG.has(lg)) {   // player props need the box score: ESPN summary (final + per-player stats)
      const bs = C.boxScore(await espnSummary(lg, id), lg);
      return bs.final ? { ...bs.final, box: bs } : null;
    }
    try {
      const d = await A().getJSON(`data/${lg}/games/${id}.json`);
      const g = d && d.game;
      if (g && g.state === "post" && g.completed && g.result && C.MMA.has(lg))   // UFC bout: winner 1/0 (draw / NC = 0-0 -> ML push), rounds elapsed for totals
        return { home: +g.home.score || 0, away: +g.away.score || 0, rounds: g.result.rounds, completed: true, status: g.statusDetail || "" };
      if (g && g.state === "post" && g.completed && !SOCCER.has(lg)) return { home: +g.home.score, away: +g.away.score, completed: true, status: g.statusDetail || "" };
    } catch (e) { /* not in the data window: ask ESPN */ }
    if (C.MMA.has(lg)) return null;   // ESPN's MMA summary has no scores: grade by hand once the bout leaves the data window
    return C.boxScore(await espnSummary(lg, id), lg).final;
  }
  async function runAutoSettle(force) {
    if (autoBusy || (!force && Date.now() - lastAuto < 3 * 6e4)) return 0;
    const now = Date.now(), need = new Map();
    for (const b of BETS) for (const e of C.pendingEvents(b)) {
      if (e.date && Date.parse(e.date) > now - 2 * 3600e3) continue;  // not over yet
      const k = `${e.league}:${e.id}`, had = need.get(k);
      need.set(k, had && had.box ? had : e);   // one fetch per game; with the box score if any bet on it is a player prop
    }
    if (!need.size) return 0;
    autoBusy = true; lastAuto = now;
    try {
      const finals = {};
      await Promise.all([...need.entries()].map(async ([k, e]) => { const f = await fetchFinal(e.league, e.id, e.box); if (f) finals[k] = f; }));
      let n = 0; REVIEWED = 0;
      BETS = BETS.map(b => { const u = C.autoSettle(b, finals); if (u) { if (u.status !== "pending") n++; else if (C.needsReview(u) && !C.needsReview(b)) REVIEWED++; return u; } return b; });
      save();
      return n;
    } finally { autoBusy = false; }
  }

  // ---------- views
  let FILT = { range: "all", book: "", league: "", type: "" };
  let LISTF = "all";
  function shell(active, body) {
    const demo = isDemo() ? `<div class="bt-demo" role="note"><b>Example data</b> These are sample bets for screenshots only, not real wagers.</div>` : "";
    return `<div class="page-head bt-head"><div><h1>My Bets</h1><div class="sub">${signedIn() ? "Private tracker · synced to your account" : "Private tracker · stored on this device"}</div></div>
      <div class="bt-hbtns"><a class="chip bt-impbtn" href="#/bets/import">Import slip</a><a class="bt-add" href="#/bets/add">+ Add bet</a></div></div>
      <nav class="seg bt-tabs" aria-label="My Bets sections"><a href="#/bets" class="${active === "ov" ? "on" : ""}">Overview</a><a href="#/bets/list" class="${active === "list" ? "on" : ""}">Bets${BETS.length ? ` <span class="na">${BETS.length}</span>` : ""}</a><a href="#/bets/add" class="${active === "add" ? "on" : ""}">Add</a><a href="#/bets/import" class="${active === "imp" ? "on" : ""}">Import</a></nav>
      ${demo}${body}`;
  }
  const privacyNote = () => signedIn()
    ? `<div class="note bt-priv">Your bets are saved in this browser and synced to your LineSmart account, so they show up wherever you sign in. Manage sync on the <a href="#/account">Account</a> tab. They aren't linked to any sportsbook account.</div>`
    : `<div class="note bt-priv">Your bets are saved only in this browser on this device. They aren't linked to any sportsbook account (sportsbooks don't offer a public way to connect). Clearing browser data deletes them, so export a backup, or <a href="#/account">sign in</a> (optional) to keep the same bets on your phone and computer.</div>`;
  const signedIn = () => { try { return !!localStorage.getItem(AC ? AC.AUTH_KEY : "ls-sb-auth"); } catch (e) { return false; } };
  const newsBox = `<div class="news-bets" data-news-signup="bets"></div>`;   // weekly email signup (assets/news.js)
  const rgNote = () => `<div class="note bt-rg">Tracking shows what betting really costs you over time. Set a budget you're comfortable losing, and take a break if it stops being fun. Gambling problem? ${window.LSGeo ? window.LSGeo.rgSpan() : ""}</div>`;

  function filterBar(all) {
    const opt = (v, cur, label) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(label)}</option>`;
    const books = [...new Set(all.map(b => b.book))], leagues = [...new Set(all.flatMap(C.betLeagues))], types = [...new Set(all.map(b => b.type))];
    return `<div class="bt-filters">
      <div class="seg" role="group" aria-label="Date range">${[["7d", "7D"], ["30d", "30D"], ["season", "Season"], ["all", "All"]].map(([k, l]) => `<button type="button" data-range="${k}" class="${FILT.range === k ? "on" : ""}" ${k === "season" ? 'title="Since Aug 1"' : ""}>${l}</button>`).join("")}</div>
      <select data-filt="book" aria-label="Sportsbook">${opt("", FILT.book, "All books")}${books.map(k => opt(k, FILT.book, C.BOOKS[k] || k)).join("")}</select>
      <select data-filt="league" aria-label="League">${opt("", FILT.league, "All leagues")}${leagues.map(k => opt(k, FILT.league, lgName(k))).join("")}</select>
      <select data-filt="type" aria-label="Bet type">${opt("", FILT.type, "All types")}${types.map(k => opt(k, FILT.type, C.TYPES[k] || k)).join("")}</select></div>`;
  }
  function wireFilters(el, redraw) {
    el.querySelectorAll("[data-range]").forEach(b => (b.onclick = () => { FILT.range = b.dataset.range; redraw(); }));
    el.querySelectorAll("[data-filt]").forEach(s => (s.onchange = () => { FILT[s.dataset.filt] = s.value; redraw(); }));
  }
  // ---------- Overview: summary, profit over time, breakdowns, activity (math in bets-core.js; no chart library)
  const statBox = (label, val, sub, c = "", extra = "") => `<div class="stat${extra}"><span class="sl">${esc(label)}</span><b class="num ${c}">${val}</b>${sub ? `<span class="ss">${sub}</span>` : ""}</div>`;
  // units view: a unit size saved in this browser only (ls-bets-prefs, never synced); money values then read as units
  const unitSize = () => { const u = Number(prefs().unit); return isNum(u) && u > 0 ? u : null; };
  const unitsOn = () => !!prefs().units && !!unitSize();
  /** money, or units when the units view is on */
  const mv = (v, sign) => {
    if (!unitsOn() || !isNum(v)) return money(v, sign);
    const u = C.toUnits(v, unitSize()), a = Math.abs(u);
    return (sign ? (u > 0.0049 ? "+" : u < -0.0049 ? "−" : "") : u < -0.0049 ? "−" : "") + (a >= 100 ? a.toFixed(0) : a.toFixed(2)) + "u";
  };
  const RANGE_LBL = { "7d": "last 7 days", "30d": "last 30 days", season: "since Aug 1", all: "all time" };
  let CHART_RANGE = null;                       // profit chart's own range (defaults to the filter bar's)
  const SORT = {};                              // breakdown table sort per card: {col, dir}
  const BD_DIM = { sport: "sport" };            // "By sport" card: sport | league
  let OV = null;                                // the overview's current filtered list (for card re-renders)

  function unitBar() {
    const on = unitsOn(), u = unitSize();
    return `<div class="bt-units"><div class="seg" role="group" aria-label="Show amounts in"><button type="button" data-units="0" class="${on ? "" : "on"}">$</button><button type="button" data-units="1" class="${on ? "on" : ""}">Units</button></div>
      <label class="bt-usize"${prefs().units || !u ? "" : " hidden"}><span>1u =</span> <span class="bt-usize-in">$<input type="number" inputmode="decimal" min="0.01" step="0.01" data-unit-size value="${esc(u ?? "")}" placeholder="25" aria-label="Unit size in dollars"></span></label></div>`;
  }
  function wireUnits(app, redraw) {
    app.querySelectorAll("[data-units]").forEach(b => (b.onclick = () => {
      const want = b.dataset.units === "1";
      setPref("units", want);
      if (want && !unitSize()) { redraw(); const i = $("[data-unit-size]", app); if (i) i.focus(); return; }
      redraw();
    }));
    const inp = $("[data-unit-size]", app);
    if (inp) inp.onchange = () => { const v = parseFloat(inp.value); if (isNum(v) && v > 0) { setPref("unit", Math.round(v * 100) / 100); redraw(); } };
  }

  const streakTxt = st => (st.current ? `${st.current.kind}${st.current.n}` : "—");
  function summaryGrid(s, list) {
    const series = C.dailySeries(list, "all");
    const spark = sparkline(series);
    const bw = s.biggestWin, rec = `${s.won}-${s.lost}-${s.push}`;
    const recSub = [s.cashout ? `${s.cashout} cashed out` : "", s.void ? `${s.void} void` : ""].filter(Boolean).join(" · ") || `${s.settled} settled`;
    const cur = s.current;
    const curCls = cur ? (cur.kind === "W" ? "pos" : "neg") : "";
    return `<div class="statgrid bt-stats">
      <div class="stat bt-hero ${cls(s.net)}"><span class="sl">Net profit</span><div class="bt-hero-row"><b class="num ${cls(s.net)}">${mv(s.net, true)}</b>${spark}</div>
        <span class="ss"><span class="bt-pill ${cls(s.roi)}">${pct(s.roi, true)} ROI</span> on ${mv(s.staked)} staked · ${s.n} bet${s.n === 1 ? "" : "s"} · ${esc(RANGE_LBL[FILT.range] || "")}</span></div>
      ${statBox("ROI", pct(s.roi, true), "profit ÷ staked", cls(s.roi))}
      ${statBox("Win rate", pct(s.winRate), "pushes excluded")}
      ${statBox("Record (W-L-P)", rec, recSub)}
      ${statBox("Total staked", mv(s.staked), "settled, voids excluded")}
      ${statBox("Avg odds", s.avgOdds === null ? "—" : am(s.avgOdds), "mean price, non-void")}
      ${statBox("Biggest win", bw ? mv(bw.net, true) : "—", bw ? esc(describe(bw.bet)) : "no wins yet", bw ? "pos" : "")}
      ${statBox("Streak", streakTxt(s), `longest W${s.longestWin} · L${s.longestLoss}`, curCls)}
      ${statBox("Pending", mv(s.exposure), `${s.pending} open · to win ${mv(s.toWinPending)}`)}
</div>`;
  }
  function sparkline(series) {
    if (series.length < 2) return "";
    const pts = [{ v: 0 }, ...series], vs = pts.map(p => p.v), lo = Math.min(0, ...vs), hi = Math.max(0, ...vs), W = 120, H = 34;
    const X = i => (i / (pts.length - 1)) * W, Y = v => H - 2 - ((v - lo) / ((hi - lo) || 1)) * (H - 4);
    const d = pts.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`).join("");
    const up = pts[pts.length - 1].v >= 0;
    return `<svg class="bt-spark ${up ? "pos" : "neg"}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><path d="${d}L${W},${H}L0,${H}Z" class="a"/><path d="${d}" class="l"/></svg>`;
  }

  function viewOverview(app) {
    if (!BETS.length) {
      app.innerHTML = shell("ov", `<div class="empty bt-empty"><div class="bt-empty-art" aria-hidden="true">${emptyArt()}</div><h3>No bets tracked yet</h3>Log a bet you've placed at any sportsbook to see your profit, ROI, record, streaks and breakdowns by sport, bet type, book and prop.
        <div style="margin-top:16px"><a class="bt-add" href="#/bets/add">+ Add your first bet</a></div></div>${privacyNote()}${dataCard()}${newsBox}${rgNote()}`);
      wireData(app); return;
    }
    const list = C.filterBets(BETS, FILT), s = C.stats(list);
    OV = list;
    const redraw = () => viewOverview(app);
    let html = `<div class="bt-bar">${filterBar(BETS)}${unitBar()}</div>`;
    if (!list.length) {
      html += `<div class="empty"><h3>No bets match these filters</h3>Try a wider date range or clear the book, league or type filter.</div>`;
    } else {
      html += summaryGrid(s, list);
      html += `<div class="section-title">Profit over time</div><div class="card bt-chart" data-chart></div>`;
      html += `<div class="section-title">Breakdowns</div><div class="bt-bd-grid">${["sport", "type", "book", "prop"].map(k => `<div class="card bt-bd" data-bd="${k}"></div>`).join("")}</div>`;
      html += `<div class="section-title">Activity</div><div class="cols bt-cols">${activityCard(list)}${recentCard(list)}</div>`;
      if (window.LSPro) html += window.LSPro.teaser("bets");
    }
    html += privacyNote() + dataCard() + newsBox + rgNote();
    app.innerHTML = shell("ov", html);
    wireFilters(app, () => { CHART_RANGE = null; redraw(); });
    wireUnits(app, redraw);
    wireData(app);
    if (!list.length) return;
    for (const k of ["sport", "type", "book", "prop"]) renderBD(app, k);
    renderChart(app);
    let rt; window.onresize = () => { clearTimeout(rt); rt = setTimeout(() => renderChart(app), 150); };
  }

  // ----- profit over time
  function renderChart(app) {
    const el = $("[data-chart]", app); if (!el || !el.isConnected) return;
    const range = CHART_RANGE || FILT.range;
    // the chart keeps the book / league / type filters but uses its own date range, by the day each bet SETTLED
    const base = C.filterBets(BETS, { ...FILT, range: "all" });
    const series = C.dailySeries(base, range), dd = C.drawdown(series);
    const last = series.length ? series[series.length - 1].v : 0, n = series.reduce((a, p) => a + p.n, 0);
    el.innerHTML = `<div class="bt-ch-head"><div class="bt-ch-kpi"><span class="sl">Profit · ${esc(RANGE_LBL[range])}</span><b class="num ${cls(last)}">${mv(last, true)}</b></div>
        <div class="bt-ch-mini"><span><i>Peak</i><b class="num">${mv(dd.peak, true)}</b></span><span><i>Max drawdown</i><b class="num ${dd.maxDrawdown ? "neg" : ""}">${dd.maxDrawdown ? mv(-dd.maxDrawdown, true) : mv(0)}</b></span><span><i>Settled</i><b class="num">${n}</b></span></div>
        <div class="seg bt-ch-range" role="group" aria-label="Chart range">${[["7d", "7D"], ["30d", "30D"], ["season", "Season"], ["all", "All"]].map(([k, l]) => `<button type="button" data-crange="${k}" class="${range === k ? "on" : ""}"${k === "season" ? ' title="Since Aug 1"' : ""}>${l}</button>`).join("")}</div></div>
      <div class="bt-plot"></div>`;
    el.querySelectorAll("[data-crange]").forEach(b => (b.onclick = () => { CHART_RANGE = b.dataset.crange; renderChart(app); }));
    const plot = $(".bt-plot", el);
    plot.innerHTML = chart(series, Math.max(280, Math.floor(plot.clientWidth)), range);
    wireTip(plot);
  }
  const dt = s => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d || 1); };
  const fdate = (s, o = { month: "short", day: "numeric" }) => dt(s).toLocaleDateString("en-US", o);
  function chart(series, w, range) {
    if (!series.length) return `<div class="na bt-nochart">${BETS.some(b => b.status !== "pending" && b.status !== "void") ? `No bets settled in the ${esc(RANGE_LBL[range])}.` : "Settle a bet to start the chart."}</div>`;
    const sm = w < 500, h = sm ? 210 : 280, L = sm ? 50 : 62, R = 16, T = 18, B = 30;
    // start the line at $0 the day before the first settled day (or at the start of a 7D / 30D window)
    const first = dt(series[0].d), start = new Date(first); start.setDate(start.getDate() - 1);
    if (range === "7d" || range === "30d") { const s0 = new Date(); s0.setHours(12, 0, 0, 0); s0.setDate(s0.getDate() - (range === "7d" ? 7 : 30)); if (s0 < start) start.setTime(s0.getTime()); }
    const pts = [{ d: null, t: start.getTime(), v: 0, net: 0, n: 0 }, ...series.map(p => ({ ...p, t: dt(p.d).getTime() }))];
    const t0 = pts[0].t, t1 = Math.max(pts[pts.length - 1].t, t0 + 864e5);
    const vals = pts.map(p => p.v), lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
    const raw = Math.max((hi - lo) / 4, unitsOn() ? unitSize() / 2 : 5), mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
    const stepV = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
    let y0 = Math.floor(lo / stepV) * stepV, y1 = Math.ceil(hi / stepV) * stepV;
    if (y0 === lo && lo < 0) y0 -= stepV; if (y1 === hi && hi > 0) y1 += stepV; if (y1 === y0) y1 = y0 + stepV;
    const X = t => L + ((t - t0) / (t1 - t0)) * (w - L - R), Y = v => T + (1 - (v - y0) / (y1 - y0)) * (h - T - B);
    const id = "g" + Math.random().toString(36).slice(2, 7);
    let svg = `<svg class="bt-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Cumulative profit: ${esc(mv(pts[pts.length - 1].v, true))} over ${series.length} days with settled bets">
      <defs><linearGradient id="${id}a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="ga0"/><stop offset="1" class="ga1"/></linearGradient>
      <linearGradient id="${id}l" x1="0" y1="0" x2="1" y2="0"><stop offset="0" class="gl0"/><stop offset="1" class="gl1"/></linearGradient></defs>`;
    const tick = v => mv(Math.round(v * 100) / 100, true).replace(/\.00(?=u?$)/, "");
    for (let v = y0; v <= y1 + 1e-9; v += stepV) { const y = Y(v); svg += `<line x1="${L}" x2="${w - R}" y1="${y}" y2="${y}" class="gl"/><text x="${L - 8}" y="${y + 4}" class="ax" text-anchor="end">${esc(tick(v))}</text>`; }
    svg += `<line x1="${L}" x2="${w - R}" y1="${Y(0)}" y2="${Y(0)}" class="zero"/>`;
    // x ticks: evenly spaced dates
    const nt = sm ? 3 : 6;
    for (let i = 0; i <= nt; i++) { const t = t0 + (i / nt) * (t1 - t0), x = X(t); svg += `<text x="${x}" y="${h - 9}" class="ax" text-anchor="${i === 0 ? "start" : i === nt ? "end" : "middle"}">${esc(new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" }))}</text>`; }
    // step-free line through each day's running total
    const d = pts.map((p, i) => `${i ? "L" : "M"}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join("");
    svg += `<path d="${d}L${X(pts[pts.length - 1].t).toFixed(1)},${Y(y0).toFixed(1)}L${X(t0).toFixed(1)},${Y(y0).toFixed(1)}Z" fill="url(#${id}a)" class="area"/><path d="${d}" class="ln" stroke="url(#${id}l)"/>`;
    if (pts.length <= 90) pts.slice(1).forEach(p => { svg += `<circle cx="${X(p.t).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="${sm ? 2.5 : 3}" class="pt ${p.net > 0 ? "w" : p.net < 0 ? "l" : ""}"/>`; });
    const lp = pts[pts.length - 1];
    svg += `<circle cx="${X(lp.t)}" cy="${Y(lp.v)}" r="9" class="halo ${cls(lp.v)}"/><circle cx="${X(lp.t)}" cy="${Y(lp.v)}" r="5" class="end ${cls(lp.v)}"/>`;
    svg += `<line class="guide" x1="0" x2="0" y1="${T}" y2="${h - B}" visibility="hidden"/><circle class="hov" r="5" visibility="hidden"/>`;
    // hover / tap targets, read by wireTip
    const tip = pts.slice(1).map(p => ({ x: +X(p.t).toFixed(1), y: +Y(p.v).toFixed(1), d: p.d, net: p.net, v: p.v, n: p.n, w: p.won, l: p.lost }));
    return svg + `</svg><div class="bt-tip" hidden></div><script type="application/json" class="bt-tipdata">${JSON.stringify(tip).replace(/</g, "\\u003c")}</script>`;
  }
  function wireTip(plot) {
    const svg = $(".bt-svg", plot), box = $(".bt-tip", plot), data = $(".bt-tipdata", plot); if (!svg || !box || !data) return;
    const pts = JSON.parse(data.textContent), g = $(".guide", svg), hv = $(".hov", svg);
    const hide = () => { box.hidden = true; g.setAttribute("visibility", "hidden"); hv.setAttribute("visibility", "hidden"); };
    const show = e => {
      const r = svg.getBoundingClientRect(), x = (e.clientX - r.left) * (svg.viewBox.baseVal.width / r.width);
      let best = pts[0]; for (const p of pts) if (Math.abs(p.x - x) < Math.abs(best.x - x)) best = p;
      g.setAttribute("x1", best.x); g.setAttribute("x2", best.x); g.setAttribute("visibility", "visible");
      hv.setAttribute("cx", best.x); hv.setAttribute("cy", best.y); hv.setAttribute("class", "hov " + cls(best.net)); hv.setAttribute("visibility", "visible");
      box.innerHTML = `<b>${esc(fdate(best.d, { weekday: "short", month: "short", day: "numeric" }))}</b><span>Day <em class="${cls(best.net)}">${esc(mv(best.net, true))}</em> · ${best.n} bet${best.n === 1 ? "" : "s"}${best.w || best.l ? ` (${best.w}-${best.l})` : ""}</span><span>Total <em class="${cls(best.v)}">${esc(mv(best.v, true))}</em></span>`;
      box.hidden = false;
      const px = best.x * (r.width / svg.viewBox.baseVal.width), bw = box.offsetWidth;
      box.style.left = Math.max(4, Math.min(r.width - bw - 4, px - bw / 2)) + "px";
      box.style.top = Math.max(0, best.y * (r.height / svg.viewBox.baseVal.height) - box.offsetHeight - 14) + "px";
    };
    svg.addEventListener("pointermove", show); svg.addEventListener("pointerdown", show); svg.addEventListener("pointerleave", hide);
  }

  // ----- breakdowns (sortable tables with a diverging P/L bar)
  const BD = {
    sport: { title: "By sport", label: "Sport" },
    type: { title: "By bet type", label: "Type", note: "Each parlay counts once, settled from its legs." },
    book: { title: "By sportsbook", label: "Book" },
    prop: { title: "By prop market", label: "Prop", note: "Single player props only; props inside parlays count under Parlay." },
  };
  function bdRows(list, k) {
    if (k === "sport" && BD_DIM.sport === "league")
      return C.groupBy(list, b => (b.type === "parlay" ? (C.sportOf(b) === "multi" || C.betLeagues(b).filter((x, i, a) => a.indexOf(x) === i).length > 1 ? "parlay" : C.betLeagues(b)[0] || "parlay") : b.league || "other"))
        .map(r => ({ ...r, name: r.key === "parlay" ? "Multi-league parlay" : r.key === "other" ? "Other / manual" : lgName(r.key) }));
    if (k === "sport") return C.groupBy(list, C.sportOf).map(r => ({ ...r, name: C.SPORTS[r.key] || r.key }));
    if (k === "type") return C.groupBy(list, b => b.type).map(r => ({ ...r, name: { ml: "Moneyline", spread: "Spread", total: "Total", prop: "Prop", parlay: "Parlay" }[r.key] || r.key }));
    if (k === "book") return C.groupBy(list, b => (b.book === "other" ? "other:" + (b.bookOther || "Other") : b.book)).map(r => ({ ...r, name: r.key.startsWith("other:") ? r.key.slice(6) : C.BOOKS[r.key] || r.key }));
    return C.groupBy(list.filter(b => C.propMarket(b)), C.propMarket).map(r => {
      const lg = r.key.split(":")[0];
      return { ...r, name: C.propMarketLabel(r.key), tag: r.key === "other" ? "" : lgName(lg) };
    });
  }
  function renderBD(app, k) {
    const el = $(`[data-bd="${k}"]`, app); if (!el) return;
    const cfg = BD[k], so = SORT[k] || { col: "net", dir: "desc" };
    const rows = C.sortRows(bdRows(OV, k), so.col, so.dir);
    const max = Math.max(1e-9, ...rows.map(r => Math.abs(r.net)));
    const th = (col, label, c = "") => `<th class="${c}" aria-sort="${so.col === col ? (so.dir === "asc" ? "ascending" : "descending") : "none"}"><button type="button" data-sort="${col}" class="${so.col === col ? "on" : ""}">${esc(label)}<i aria-hidden="true">${so.col === col ? (so.dir === "asc" ? "▲" : "▼") : "↕"}</i></button></th>`;
    const dim = k === "sport" ? `<div class="seg bt-dim" role="group" aria-label="Group by">${[["sport", "Sport"], ["league", "League"]].map(([d, l]) => `<button type="button" data-dim="${d}" class="${BD_DIM.sport === d ? "on" : ""}">${l}</button>`).join("")}</div>` : "";
    const body = rows.length ? `<div class="tbl-wrap"><table class="bt-tbl bt-bdt"><thead><tr>${th("name", cfg.label)}${th("n", "Bets", "c-n")}${th("rec", "W-L-P")}${th("winRate", "Win %", "c-w")}${th("staked", "Staked", "c-s")}${th("net", "Profit")}${th("roi", "ROI")}</tr></thead><tbody>${rows.map(r =>
      `<tr><td><span class="bt-nm">${esc(r.name)}${r.tag ? ` <small>${esc(r.tag)}</small>` : ""}</span></td><td class="num c-n">${r.n}</td><td class="num">${r.won}-${r.lost}-${r.push}</td><td class="num c-w">${pct(r.winRate)}</td><td class="num c-s">${mv(r.staked)}</td>
        <td class="num bt-plc ${cls(r.net)}"><span class="bt-pl-bar" aria-hidden="true"><i class="${r.net < 0 ? "neg" : "pos"}" style="width:${(Math.abs(r.net) / max * 50).toFixed(1)}%"></i></span><span class="bt-plv">${mv(r.net, true)}</span></td><td class="num ${cls(r.roi)}">${pct(r.roi, true)}</td></tr>`).join("")}</tbody></table></div>`
      : `<div class="na bt-bd-empty">${k === "prop" ? "No single player props in this filter." : "No bets in this filter."}</div>`;
    const pend = rows.reduce((a, r) => a + r.pending, 0);
    el.innerHTML = `<h3><span>${esc(cfg.title)}</span>${dim}</h3>${body}${cfg.note || pend ? `<div class="bt-bd-note">${[cfg.note, pend ? `${pend} open bet${pend > 1 ? "s" : ""} not counted yet.` : ""].filter(Boolean).map(esc).join(" ")}</div>` : ""}`;
    el.querySelectorAll("[data-sort]").forEach(b => (b.onclick = () => {
      const col = b.dataset.sort, cur = SORT[k] || { col: "net", dir: "desc" };
      SORT[k] = { col, dir: cur.col === col ? (cur.dir === "desc" ? "asc" : "desc") : col === "name" ? "asc" : "desc" };
      renderBD(app, k);
    }));
    el.querySelectorAll("[data-dim]").forEach(b => (b.onclick = () => { BD_DIM.sport = b.dataset.dim; renderBD(app, k); }));
  }

  // ----- activity: calendar heatmap (by settle day) + weekday bars
  function activityCard(list) {
    const days = C.byDay(list), keys = Object.keys(days).sort();
    // 8–18 week window: enough to show the history without a wall of empty weeks
    const WEEKS = Math.max(8, Math.min(18, keys.length ? Math.ceil((Date.now() - dt(keys[0]).getTime()) / 6048e5) + 1 : 8));
    const now = new Date(); now.setHours(12, 0, 0, 0);
    const end = new Date(now); end.setDate(end.getDate() + (7 - ((end.getDay() + 6) % 7)) - 1);   // Sunday of this week (Mon-start weeks)
    const start = new Date(end); start.setDate(start.getDate() - WEEKS * 7 + 1);
    const vals = Object.values(days).map(x => Math.abs(x.net)), max = Math.max(1e-9, ...vals);
    let cells = "", months = "", lastM = -1;
    for (let w = 0; w < WEEKS; w++) {
      const wk = new Date(start); wk.setDate(wk.getDate() + w * 7);
      const m = wk.getMonth(); months += `<span>${m !== lastM ? esc(wk.toLocaleDateString("en-US", { month: "short" })) : ""}</span>`; lastM = m;
      for (let i = 0; i < 7; i++) {
        const d = new Date(wk); d.setDate(d.getDate() + i);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`, x = days[key];
        const future = d > now, lvl = x ? Math.max(1, Math.ceil((Math.abs(x.net) / max) * 4)) : 0;
        const c = !x ? (future ? "fut" : "") : x.net > 0 ? `p${lvl}` : x.net < 0 ? `n${lvl}` : "z";
        const tip = x ? `${fdate(key, { weekday: "short", month: "short", day: "numeric" })}: ${mv(x.net, true)} (${x.n} bet${x.n > 1 ? "s" : ""})` : fdate(key, { weekday: "short", month: "short", day: "numeric" });
        cells += `<i class="${c}" style="grid-column:${w + 2};grid-row:${i + 1}" title="${esc(tip)}"></i>`;
      }
    }
    const wd = C.byWeekday(list), order = [1, 2, 3, 4, 5, 6, 0], wmax = Math.max(1e-9, ...wd.map(r => Math.abs(r.net)));
    const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const best = wd.filter(r => r.settled).sort((a, b) => b.net - a.net)[0];
    const bars = order.map(i => { const r = wd[i];
      return `<div class="bt-wd-row"><span class="bt-wd-d">${names[i]}</span><span class="bt-pl-bar" aria-hidden="true"><i class="${r.net < 0 ? "neg" : "pos"}" style="width:${(Math.abs(r.net) / wmax * 50).toFixed(1)}%"></i></span><b class="num ${cls(r.net)}">${r.settled ? mv(r.net, true) : "—"}</b><span class="na num">${r.settled ? `${r.won}-${r.lost}-${r.push}` : ""}</span></div>`; }).join("");
    return `<div class="card bt-act-card"><h3><span>Calendar</span><span class="bt-legend" aria-hidden="true"><span>Loss</span><i class="n4"></i><i class="n2"></i><i></i><i class="p2"></i><i class="p4"></i><span>Win</span></span></h3>
      <div class="bt-cal-wrap"><div class="bt-cal-m" style="grid-template-columns:28px repeat(${WEEKS},minmax(0,30px))" aria-hidden="true"><span></span>${months}</div>
        <div class="bt-cal" style="grid-template-columns:28px repeat(${WEEKS},minmax(0,30px))" role="img" aria-label="Daily profit over the last ${WEEKS} weeks">${["Mon", "", "Wed", "", "Fri", "", "Sun"].map((l, i) => `<span class="bt-cal-d" style="grid-row:${i + 1}" aria-hidden="true">${l}</span>`).join("")}${cells}</div></div>
      <div class="bt-wd"><div class="bt-wd-h"><span>By weekday settled</span>${best && best.net > 0 ? `<span class="na">Best: <b class="pos">${names[best.key]}</b></span>` : ""}</div>${bars}</div></div>`;
  }
  const emptyArt = () => `<svg viewBox="0 0 160 70" width="160" height="70"><defs><linearGradient id="bteg" x1="0" x2="1"><stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="var(--accent2)"/></linearGradient></defs><path d="M4 58 L34 46 L58 52 L86 30 L110 36 L140 12 L156 16" fill="none" stroke="url(#bteg)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="6 6" opacity=".8"/><circle cx="140" cy="12" r="5" fill="var(--accent2)"/></svg>`;

  function recentCard(list) {
    const pend = list.filter(b => b.status === "pending").sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, 5);
    return `<div class="card"><h3>Open bets <a class="lnk bt-more" href="#/bets/list">See all ›</a></h3>${pend.length ? `<div class="bt-mini">${pend.map(b => `<a class="bt-mrow" href="#/bets/list" data-focus="${esc(b.id)}"><span><b>${esc(describe(b))}</b><span class="na">${esc(eventLabel(b) || bookName(b))}</span></span><span class="num">${money(b.stake)} <span class="na">@ ${esc(am(b.odds) || am(C.parlayAmerican(b.legs)))}</span></span></a>`).join("")}</div>` : `<div class="na">No open bets.</div>`}</div>`;
  }


  // ---------- bet list
  function betCard(b) {
    const net = C.netResult(b), pend = b.status === "pending";
    const price = isNum(b.odds) ? am(b.odds) : am(C.parlayAmerican(b.legs));
    const legs = b.type === "parlay" ? `<ol class="bt-legs">${(b.legs || []).map(l => `<li>${l.result && l.result !== "pending" ? badge(l.result) : l.review ? `<span class="bs bs-review">Review</span>` : ""}<b>${esc(describe(l))}</b> <span class="na">${esc([eventLabel(l), am(l.odds), isNum(l.statValue) ? `final: ${l.statValue}` : ""].filter(Boolean).join(" · "))}</span>${l.review && (!l.result || l.result === "pending") ? `<div class="bt-rv-why">${esc(l.review.reason)}</div>` : ""}</li>`).join("")}</ol>` : "";
    const fin = isNum(b.statValue) && b.prop ? ` · final: ${esc(b.statValue)} ${esc(C.propLabel(b.league, b.prop.mk).toLowerCase())}` : b.final ? ` · final ${esc(b.final.away)}-${esc(b.final.home)}` : "";
    const rv = C.needsReview(b);
    const review = rv ? `<div class="bt-review" role="note"><b>Needs review</b> ${esc(b.review ? b.review.reason : "A leg couldn't be graded from the box score.")}
      ${b.type === "parlay" ? `<span class="bt-rv-btns"><button type="button" class="chip" data-settle="${esc(b.id)}">Grade legs</button></span>` : `<span class="bt-rv-btns">${["won", "lost", "push"].map(st => `<button type="button" class="bt-rb rb-${st}" data-quick="${st}" data-id="${esc(b.id)}">${st === "won" ? "Win" : st === "lost" ? "Loss" : "Push"}</button>`).join("")}</span>`}</div>` : "";
    const meta = [b.date, bookName(b), b.type === "parlay" ? null : lgName(b.league || ""), C.TYPES[b.type]].filter(Boolean).join(" · ");
    const res = pend ? `<span class="na">to win</span> <b>${money(C.toWin(b))}</b>` : b.status === "void" ? `<b class="na">stake returned</b>` : `<b class="${cls(net)}">${money(net, true)}</b>`;
    return `<article class="bt-card st-${esc(b.status)}" id="bet-${esc(b.id)}">
      <div class="bt-top">${badge(b.status)}${rv ? `<span class="bs bs-review">Needs review</span>` : ""}${b.settledBy === "auto" && !pend ? `<span class="bt-auto" title="${b.prop ? "Settled automatically from the ESPN box score" : "Settled automatically from the ESPN final score"}">auto${fin}</span>` : ""}<span class="bt-meta">${esc(meta)}</span></div>
      <div class="bt-main"><div class="bt-sel"><b>${esc(describe(b))}</b><span class="na">${esc(eventLabel(b))}</span></div>
        <div class="bt-px"><span class="oc"><b>${esc(price || "—")}</b><small>${money(b.stake)}</small></span></div></div>
      ${legs}${review}${b.notes ? `<div class="bt-notes">${esc(b.notes)}</div>` : ""}
      <div class="bt-foot"><span class="bt-res">${res}</span>
        <span class="bt-act"><button type="button" class="chip" data-settle="${esc(b.id)}">${pend ? "Settle" : "Change result"}</button><a class="chip" href="#/bets/edit/${encodeURIComponent(b.id)}">Edit</a><button type="button" class="chip bt-del" data-del="${esc(b.id)}" aria-label="Delete bet">Delete</button></span></div></article>`;
  }
  function viewList(app) {
    const list = C.filterBets(BETS, FILT);
    const counts = { all: list.length, pending: list.filter(b => b.status === "pending").length };
    counts.settled = counts.all - counts.pending;
    const shown = list.filter(b => LISTF === "all" || (LISTF === "pending" ? b.status === "pending" : b.status !== "pending"))
      .sort((a, b) => (b.status === "pending") - (a.status === "pending") || String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt)));
    let html = filterBar(BETS) + `<div class="chips bt-lf" role="group" aria-label="Show">${[["all", "All"], ["pending", "Open"], ["settled", "Settled"]].map(([k, l]) => `<button type="button" class="chip${LISTF === k ? " on" : ""}" data-lf="${k}">${l} <b>${counts[k]}</b></button>`).join("")}</div>`;
    html += shown.length ? `<div class="bt-list">${shown.map(betCard).join("")}</div>` : `<div class="empty"><h3>${BETS.length ? "No bets match these filters" : "No bets tracked yet"}</h3>${BETS.length ? "Try a wider date range." : `<a class="lnk" href="#/bets/add">Add a bet</a> you've placed to start tracking.`}</div>`;
    html += `<div class="note">Moneyline, spread and total bets linked to a game settle automatically once ESPN posts the final score. NFL and NBA player props picked from a game settle from ESPN's box score; if a player isn't in the box score (didn't play) or the game wasn't completed, the bet is marked "Needs review" for you to grade. Other props and manual entries: tap Settle.</div>` + privacyNote();
    app.innerHTML = shell("list", html);
    wireFilters(app, () => viewList(app));
    app.querySelectorAll("[data-lf]").forEach(b => (b.onclick = () => { LISTF = b.dataset.lf; viewList(app); }));
    app.querySelectorAll("[data-del]").forEach(b => (b.onclick = () => {
      const bet = BETS.find(x => x.id === b.dataset.del); if (!bet) return;
      if (!confirm(`Delete "${describe(bet)}" (${money(bet.stake)})? This can't be undone.`)) return;
      BETS = BETS.filter(x => x.id !== bet.id); save(); viewList(app);
    }));
    app.querySelectorAll("[data-settle]").forEach(b => (b.onclick = () => settleDialog(b.dataset.settle, () => viewList(app))));
    app.querySelectorAll("[data-quick]").forEach(b => (b.onclick = () => {
      const i = BETS.findIndex(x => x.id === b.dataset.id); if (i < 0) return;
      const nb = { ...BETS[i], status: b.dataset.quick, manual: true, settledBy: "manual", settledAt: today() }; delete nb.review;
      BETS[i] = nb; save(); viewList(app); toast(`Marked ${C.STATUS[nb.status].toLowerCase()}.`);
    }));
  }

  // manual settle / override
  function settleDialog(id, done) {
    const bet = BETS.find(b => b.id === id); if (!bet) return;
    let dlg = document.getElementById("btDlg");
    if (!dlg) { dlg = document.createElement("dialog"); dlg.id = "btDlg"; dlg.className = "bt-dlg"; document.body.appendChild(dlg); }
    const legs = bet.type === "parlay" ? `<div class="bt-dl-legs"><div class="bt-lbl">Legs</div>${(bet.legs || []).map((l, i) => `<div class="bt-dl-leg"><span>${esc(describe(l))}</span><span class="seg">${["pending", "won", "lost", "push"].map(r => `<button type="button" data-leg="${i}" data-r="${r}" class="${(l.result || "pending") === r ? "on" : ""}">${r === "pending" ? "—" : r[0].toUpperCase()}</button>`).join("")}</span></div>`).join("")}<div class="note">Setting every leg works out the parlay result for you (pushed legs drop out and the odds are re-priced).</div></div>` : "";
    dlg.innerHTML = `<form method="dialog" class="bt-dl"><h3>Settle bet</h3><div class="bt-dl-sel"><b>${esc(describe(bet))}</b><span class="na">${esc([eventLabel(bet), bookName(bet), money(bet.stake) + " @ " + (am(bet.odds) || am(C.parlayAmerican(bet.legs)))].filter(Boolean).join(" · "))}</span></div>
      ${legs}<div class="bt-lbl">Result</div><div class="bt-res-btns">${["won", "lost", "push", "void", "cashout"].map(s => `<button type="button" class="bt-rb rb-${s}${bet.status === s ? " on" : ""}" data-st="${s}">${C.STATUS[s]}</button>`).join("")}</div>
      <label class="bt-co" ${bet.status === "cashout" ? "" : "hidden"}><span class="bt-lbl">Cash-out amount received</span><input type="number" inputmode="decimal" step="0.01" min="0" name="co" value="${esc(bet.cashout ?? "")}" placeholder="0.00"></label>
      <div class="bt-dl-foot">${bet.status !== "pending" ? `<button type="button" class="chip" data-st="pending">Back to open</button>` : ""}<span style="flex:1"></span><button type="button" class="chip" data-x>Cancel</button><button type="button" class="bt-add" data-ok>Save</button></div></form>`;
    let pick = bet.status === "pending" ? null : bet.status;
    const legsR = (bet.legs || []).map(l => l.result || "pending");
    const co = dlg.querySelector(".bt-co");
    dlg.querySelectorAll("[data-leg]").forEach(b => (b.onclick = () => {
      legsR[+b.dataset.leg] = b.dataset.r;
      dlg.querySelectorAll(`[data-leg="${b.dataset.leg}"]`).forEach(x => x.classList.toggle("on", x === b));
      const st = C.parlayStatus(bet.legs.map((l, i) => ({ ...l, result: legsR[i] })));
      if (st !== "pending") { pick = st; dlg.querySelectorAll(".bt-rb").forEach(x => x.classList.toggle("on", x.dataset.st === st)); co.hidden = true; }
    }));
    dlg.querySelectorAll(".bt-rb").forEach(b => (b.onclick = () => { pick = b.dataset.st; dlg.querySelectorAll(".bt-rb").forEach(x => x.classList.toggle("on", x === b)); co.hidden = pick !== "cashout"; if (!co.hidden) co.querySelector("input").focus(); }));
    const close = () => (dlg.close ? dlg.close() : dlg.removeAttribute("open"));
    dlg.querySelector("[data-x]").onclick = close;
    const commit = st => {
      const i = BETS.findIndex(b => b.id === id); if (i < 0) return close();
      const b = { ...BETS[i] };
      if (b.type === "parlay") b.legs = b.legs.map((l, j) => { const x = { ...l, result: legsR[j] }; if (legsR[j] !== "pending") delete x.review; return x; });
      if (st !== "pending") delete b.review;
      if (st === "pending") Object.assign(b, { status: "pending", manual: false, settledAt: null, settledBy: null, cashout: null, final: null });
      else {
        if (st === "cashout") { const v = parseFloat(dlg.querySelector('[name="co"]').value); if (!isNum(v) || v < 0) { dlg.querySelector('[name="co"]').focus(); return; } b.cashout = Math.round(v * 100) / 100; }
        Object.assign(b, { status: st, manual: true, settledBy: "manual", settledAt: today() });
      }
      BETS[i] = b; save(); close(); done();
    };
    dlg.querySelector("[data-ok]").onclick = () => (pick ? commit(pick) : bet.type === "parlay" ? commit("pending") : close());
    const back = dlg.querySelector('.bt-dl-foot [data-st="pending"]'); if (back) back.onclick = () => commit("pending");
    dlg.showModal ? dlg.showModal() : dlg.setAttribute("open", "");
  }

  // ---------- export / import
  function dataCard() {
    return `<div class="section-title">Backup</div><div class="card bt-data"><div class="bt-data-btns">
      <button type="button" class="chip" data-exp="json">Export JSON</button><button type="button" class="chip" data-exp="csv">Export CSV</button>
      <label class="chip bt-imp">Import JSON<input type="file" accept="application/json,.json" hidden></label>
      ${BETS.length ? `<button type="button" class="chip bt-del" data-clear>Delete all bets</button>` : ""}</div>
      <div class="note">JSON backups can be imported on another phone or browser (bets with the same ID are updated, new ones added). CSV opens in Excel or Google Sheets.</div></div>`;
  }
  function download(name, text, type) {
    const a = document.createElement("a"), url = URL.createObjectURL(new Blob([text], { type }));
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function wireData(app) {
    const stamp = today();
    app.querySelectorAll("[data-exp]").forEach(b => (b.onclick = () => b.dataset.exp === "json"
      ? download(`linesmart-bets-${stamp}.json`, JSON.stringify({ app: "LineSmart", v: 1, exported: new Date().toISOString(), bets: BETS }, null, 2), "application/json")
      : download(`linesmart-bets-${stamp}.csv`, C.toCSV(BETS, describe), "text/csv")));
    const inp = app.querySelector(".bt-imp input");
    if (inp) inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      try { const r = C.mergeBets(BETS, C.parseImport(await f.text())); BETS = r.bets; save(); toast(`Imported: ${r.added} new, ${r.updated} updated.`); view(); }
      catch (e) { toast("Couldn't import that file: " + e.message); }
      inp.value = "";
    };
    const clr = app.querySelector("[data-clear]");
    if (clr) clr.onclick = () => {
      if (!confirm(signedIn() ? `Delete all ${BETS.length} bets? You're signed in, so they'll also be deleted from your account and your other devices. Export a backup first if you want to keep them.` : `Delete all ${BETS.length} bets from this device? Export a backup first if you want to keep them.`)) return;
      BETS = []; save(); localStorage.removeItem(DEMO_KEY); view();
    };
  }
  function toast(msg) {
    let t = document.getElementById("btToast");
    if (!t) { t = document.createElement("div"); t.id = "btToast"; t.className = "bt-toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("on"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("on"), 3200);
  }

  // ---------- add / edit form
  const GAMES = {}, PROPS = {};
  /** data/props/<lg>.json (already on the site; no extra API calls). null when there's no feed. */
  async function propsFor(lg) {
    if (!PROP_LG.has(lg)) return null;
    if (lg in PROPS) return PROPS[lg];
    try { PROPS[lg] = await A().getJSON(`data/props/${lg}.json`); } catch (e) { PROPS[lg] = null; }
    return PROPS[lg];
  }
  /** Feed players for a leg's game: [{pid, n, pos, ta, props:[{mk, label, short, line, books}]}] */
  function feedPlayers(l) {
    const doc = PROPS[l.league], ev = l.event;
    if (!doc || !l.eventId || !PC()) return [];
    return PC().byPlayer(doc, l.eventId, ev ? [String(ev.away.id), String(ev.home.id)] : []);
  }
  const feedProp = l => { const pl = feedPlayers(l).find(p => p.pid === String(l.pid)); return pl ? pl.props.find(x => x.mk === l.pmk) || null : null; };
  async function gamesFor(lg) {
    propsFor(lg);
    if (GAMES[lg]) return GAMES[lg];
    try { const d = await A().getJSON(`data/${lg}/index.json`); return (GAMES[lg] = { kind: d.league.kind, games: d.games.slice().sort((a, b) => String(a.date).localeCompare(String(b.date))) }); }
    catch (e) { return (GAMES[lg] = { kind: "", games: [] }); }
  }
  const evOf = (g, lg) => ({ id: String(g.id), lg, date: g.date, name: `${g.away.abbr} @ ${g.home.abbr}`, home: { id: g.home.id, abbr: g.home.abbr, name: g.home.name, short: g.home.short }, away: { id: g.away.id, abbr: g.away.abbr, name: g.away.name, short: g.away.short } });
  // price for a market from the book the user picked (Hard Rock / FanDuel / DraftKings via The Odds API; DraftKings falls back to ESPN); else ESPN's listed book
  function quote(g, book) {
    if (!g) return null;
    const B = g.books || {}, key = { draftkings: "draftkings", hardrock: "hardrockbet", fanduel: "fanduel" }[book];
    const b = key && B[key] && !B[key].stale ? B[key] : null;
    return b ? { o: b, src: C.BOOKS[book] } : g.odds ? { o: g.odds, src: g.odds.provider || "ESPN" } : null;
  }
  function priceFor(q, mk, side) {
    if (!q) return {};
    const o = q.o;
    if (mk === "ml") return { odds: o[side + "ML"] };
    if (mk === "spread") return { line: o[side + "Spread"], odds: o[side + "SpreadOdds"] };
    if (mk === "total") return { line: o.total, odds: o[side + "Odds"] };
    return {};
  }
  const newLeg = lg => ({ league: lg || prefs().lg || "nfl", eventId: "", manual: false, eventText: "", mk: "ml", side: "", line: "", odds: "", selection: "", pid: "", player: "", pmk: "", custom: false });
  const clearProp = l => Object.assign(l, { pid: "", player: "", pmk: "", custom: false, side: "", line: "" });

  let F = null; // form state
  async function viewForm(app, editId, qs) {
    const tok = A().nav();
    const ex = editId ? BETS.find(b => b.id === editId) : null;
    if (editId && !ex) { app.innerHTML = shell("add", `<div class="empty"><h3>Bet not found</h3>It may have been deleted. <a class="lnk" href="#/bets/list">Back to your bets</a></div>`); return; }
    const p = prefs();
    if (ex) {
      const toLeg = s => { const pr = s.prop || null;
        return { league: s.league || (s.event && s.event.lg) || "nfl", eventId: s.event ? s.event.id : "", event: s.event || null, manual: !s.event, eventText: s.eventText || "", mk: s.type === "parlay" ? "ml" : s.type,
          side: (pr ? pr.side : s.side) || "", line: (pr ? pr.line : s.line) ?? "", odds: s.odds ?? "", selection: s.selection || "", result: s.result,
          // older free-text props on a game keep their text ("Something else"); structured props reopen in the picker
          pid: pr && pr.pid ? String(pr.pid) : "", player: pr ? pr.player || "" : "", pmk: pr ? pr.mk : (s.type === "prop" && s.event ? "other" : ""), custom: !!(pr ? !pr.pid : s.type === "prop" && s.event) }; };
      F = { id: ex.id, book: ex.book, bookOther: ex.bookOther || "", type: ex.type, date: ex.date || today(), stake: ex.stake, odds: ex.odds ?? "", oddsManual: !!ex.oddsManual, notes: ex.notes || "",
        legs: ex.type === "parlay" ? ex.legs.map(l => ({ ...toLeg(l), mk: l.type || "ml" })) : [toLeg(ex)],
        status: ex.status === "pending" ? "" : ex.status, cashout: ex.cashout ?? "", statusPicked: ex.status !== "pending" };
    } else {
      F = { book: defaultBook(), bookOther: p.bookOther || "", type: "ml", date: today(), stake: p.stake || "", odds: "", oddsManual: false, notes: "", legs: [newLeg()], status: "", cashout: "", statusPicked: false };
      if (qs && qs.get("lg")) {
        const leg = F.legs[0]; leg.league = qs.get("lg"); leg.eventId = qs.get("ev") || "";
        const mk = qs.get("mk"); if (C.TYPES[mk] && mk !== "parlay") { F.type = mk; leg.mk = mk; }
        if (qs.get("side")) leg.side = qs.get("side");
        if (isNum(qs.get("ln"))) leg.line = Number(qs.get("ln"));
        if (isNum(qs.get("od"))) { leg.odds = Number(qs.get("od")); F.odds = Number(qs.get("od")); }
        if (C.BOOKS[qs.get("bk")]) F.book = qs.get("bk");
        if (mk === "prop") { leg.pid = qs.get("pid") || ""; leg.pmk = qs.get("pm") || ""; leg.player = qs.get("pn") || ""; if (C.YESNO.has(leg.pmk) && !leg.side) leg.side = "over"; }
      }
    }
    for (const l of F.legs) { await gamesFor(l.league); await propsFor(l.league); }
    if (tok !== A().nav()) return;
    for (const l of F.legs) if (l.eventId && !l.event) { const g = GAMES[l.league].games.find(x => String(x.id) === String(l.eventId)); if (g) l.event = evOf(g, l.league); else if (!ex) { l.eventId = ""; } }
    for (const l of F.legs) if (!ex && l.mk === "prop" && (l.pid || l.player)) {   // "+ Track" from a prop row: fill name, line and price at the chosen book
      const pl = feedPlayers(l).find(x => x.pid === String(l.pid));
      if (pl) { l.player = pl.n; if (l.pmk && !pl.props.some(x => x.mk === l.pmk)) l.pmk = ""; } else { l.custom = true; l.pid = ""; }
      const fp = feedProp(l);
      if (fp) { const q = C.propQuote(fp.books, F.book, l.side, fp.line); if (!isNum(l.line) || q.posted) l.line = q.line ?? l.line; if (isNum(q.odds)) { l.odds = q.odds; F.odds = q.odds; } }
    }
    drawForm(app);
  }

  function legHtml(l, i, parlay, typeSeg = "") {
    const G = GAMES[l.league] || { games: [] }, soccer = SOCCER.has(l.league);
    const lgs = A().meta().order;
    const mk = parlay ? l.mk : F.type;
    const now = Date.now();
    const games = G.games.filter(g => g.state !== "post" || now - Date.parse(g.date) < 3 * 864e5 || String(g.id) === String(l.eventId));
    const dayOpt = g => `${A().fmt(g.date, { weekday: "short", month: "short", day: "numeric" })} · ${g.away.abbr} @ ${g.home.abbr}${g.state === "in" ? " · LIVE" : g.state === "post" ? " · Final" : " · " + A().timeET(g.date)}`;
    const g = G.games.find(x => String(x.id) === String(l.eventId));
    const known = l.event && !g; // edited bet whose game left the data window
    let h = `<div class="bt-leg" data-leg="${i}">`;
    if (parlay) h += `<div class="bt-leg-h"><b>Leg ${i + 1}</b><div class="seg bt-mk">${["ml", "spread", "total", "prop"].map(k => `<button type="button" data-a="mk" data-v="${k}" class="${l.mk === k ? "on" : ""}">${k === "ml" ? "ML" : k === "prop" ? "Prop" : C.TYPES[k].replace(" (O/U)", "")}</button>`).join("")}</div>${F.legs.length > 1 ? `<button type="button" class="sclear bt-rm" data-a="rmleg" aria-label="Remove leg ${i + 1}">✕</button>` : ""}</div>`;
    if (l.review) h += legReview(l.review);
    h += `<div class="bt-lbl">League</div><div class="chips bt-scroll">${lgs.map(k => `<button type="button" class="chip${k === l.league ? " on" : ""}" data-a="lg" data-v="${k}">${esc(lgName(k))}</button>`).join("")}</div>`;
    h += `<label class="bt-f"><span class="bt-lbl">Game</span><select data-f="game"><option value="">${games.length ? "Choose a game…" : "No games in our data right now"}</option>${known ? `<option value="${esc(l.eventId)}" selected>${esc(l.event.name)}</option>` : ""}${games.map(x => `<option value="${esc(x.id)}"${String(x.id) === String(l.eventId) && !l.manual ? " selected" : ""}>${esc(dayOpt(x))}</option>`).join("")}<option value="__manual"${l.manual ? " selected" : ""}>Not listed or already played: type it in</option></select></label>`;
    if (l.manual) h += pastHtml(l) + `<label class="bt-f"><span class="bt-lbl">Event <span class="na">(teams or fight)</span></span><input data-f="eventText" value="${esc(l.eventText)}" placeholder="${esc(eventPh(l.league))}" autocomplete="off"></label>`;
    h += typeSeg;
    const linked = !l.manual && (g || l.event);
    if (linked && mk !== "prop" && mk !== "parlay") {
      const ev = g ? evOf(g, l.league) : l.event, q = quote(g, F.book);
      const sides = mk === "total" ? [["over", "Over"], ["under", "Under"]] : [["away", ev.away.short || ev.away.abbr], ["home", ev.home.short || ev.home.abbr]].concat(mk === "ml" && soccer ? [["draw", "Draw"]] : []);
      h += `<div class="bt-lbl">Pick</div><div class="bt-sides">${sides.map(([s, label]) => { const pr = priceFor(q, mk, s); const sub = mk === "ml" ? am(pr.odds) : mk === "spread" ? `${ln(pr.line)} ${am(pr.odds)}` : `${isNum(pr.line) ? pr.line : ""} ${am(pr.odds)}`;
        return `<button type="button" class="bt-side${l.side === s ? " on" : ""}" data-a="side" data-v="${s}"><b>${esc(label)}</b><small>${esc(sub.trim() || "—")}</small></button>`; }).join("")}</div>`;
      if (q) h += `<div class="bt-hint">Prices: ${esc(q.src)} from LineSmart's latest data. Check them against your bet slip.</div>`;
      if (mk === "spread" || mk === "total") h += `<label class="bt-f bt-half"><span class="bt-lbl">${mk === "total" ? "Total line" : "Spread line (your side)"}</span><input data-f="line" type="text" inputmode="decimal" value="${esc(l.line)}" placeholder="${mk === "total" ? "e.g. 44.5" : "e.g. -3.5"}"></label>`;
    } else if (linked && mk === "prop" && PROP_LG.has(l.league)) {
      h += propHtml(l, i);
    } else {
      h += `<label class="bt-f"><span class="bt-lbl">Your pick</span><input data-f="selection" value="${esc(l.selection)}" placeholder="${mk === "prop" ? "e.g. Jalen Hurts over 1.5 pass TD" : "e.g. Eagles -3.5"}" autocomplete="off"></label>`;
      if (mk === "prop" && PROP_LG.has(l.league) && !linked) h += `<div class="bt-hint">Pick the game above to choose the player and prop from the list (and have it settle automatically).</div>`;
    }
    if (parlay) {
      const lr = C.LEG_RESULTS.includes(l.result) ? l.result : "pending";
      h += `<div class="bt-legfoot"><label class="bt-f bt-half"><span class="bt-lbl">Leg odds</span><input data-f="odds" type="text" inputmode="numeric" value="${esc(l.odds)}" placeholder="-110"></label>
        <div class="bt-f bt-lrf"><span class="bt-lbl">Leg result <span class="na">(optional)</span></span><div class="seg bt-lres" role="group" aria-label="Leg ${i + 1} result">${[["pending", "Open"], ["won", "W"], ["lost", "L"], ["push", "P"]].concat(lr === "void" ? [["void", "Void"]] : []).map(([k, n]) => `<button type="button" data-a="lres" data-v="${k}" class="${lr === k ? "on" : ""}" aria-pressed="${lr === k}" title="${C.STATUS[k] === "Pending" ? "Not settled" : C.STATUS[k]}">${n}</button>`).join("")}</div></div></div>`;
    }
    return h + `</div>`;
  }

  /** Player-prop picker for a linked NFL/NBA game: player (search) → prop type → Over/Under, priced at the chosen book. */
  function propHtml(l, i) {
    const players = feedPlayers(l), yes = C.YESNO.has(l.pmk), M = C.PROP_MARKETS[l.league];
    const bkName = F.book === "other" ? (F.bookOther || "your book") : C.BOOKS[F.book];
    let h = "";
    const sideBtns = q => `<div class="bt-lbl">${yes ? "Scores a TD?" : "Over or under?"}</div><div class="bt-sides bt-ou">${[["over", yes ? "Yes" : "Over"], ["under", yes ? "No" : "Under"]].map(([sd, lab]) => {
      const pq = q ? q(sd) : null, sub = pq ? `${yes ? "" : `${sd === "over" ? "o" : "u"}${C.isNum(pq.line) ? pq.line : ""} `}${am(pq.odds) || ""}`.trim() : "";
      return `<button type="button" class="bt-side${l.side === sd ? " on" : ""}" data-a="side" data-v="${sd}"><b>${esc(lab)}</b><small>${esc(sub || "—")}</small></button>`; }).join("")}</div>`;
    const lineIn = () => (yes ? "" : `<label class="bt-f bt-half"><span class="bt-lbl">Line</span><input data-f="line" type="text" inputmode="decimal" value="${esc(l.line)}" placeholder="e.g. 24.5"></label>`);
    if (!l.custom && players.length) {
      if (!l.pid) {
        h += `<div class="bt-lbl">Player <span class="na">· ${players.length} with props posted</span></div>
          <input class="bt-psearch" data-f="psearch" type="search" placeholder="Search players…" aria-label="Search players" autocomplete="off">
          <div class="bt-plist" role="list">${players.map(p => `<button type="button" class="bt-pl" role="listitem" data-a="pl" data-v="${esc(p.pid)}" data-n="${esc(C.normName(p.n))}"><b>${esc(p.n)}</b><small>${esc([p.pos, p.ta].filter(Boolean).join(" · "))} · ${p.props.length} prop${p.props.length > 1 ? "s" : ""}</small></button>`).join("")}</div>`;
      } else {
        const pl = players.find(p => p.pid === String(l.pid));
        h += `<div class="bt-lbl">Player</div><div class="bt-pick"><span><b>${esc(pl ? pl.n : l.player)}</b><small>${esc(pl ? [pl.pos, pl.ta].filter(Boolean).join(" · ") : "")}</small></span><button type="button" class="chip" data-a="plclear">Change</button></div>`;
        if (pl) {
          h += `<div class="bt-lbl">Prop</div><div class="bt-pms">${pl.props.map(x => { const q = C.propQuote(x.books, F.book, "over", x.line);
            return `<button type="button" class="bt-pm${l.pmk === x.mk ? " on" : ""}" data-a="pm" data-v="${esc(x.mk)}"><b>${esc(x.short)}</b><small>${esc(C.YESNO.has(x.mk) ? (isNum(q.odds) ? am(q.odds) : "Yes / No") : PC().fmtNum(q.line))}</small></button>`; }).join("")}</div>`;
          const fp = l.pmk ? pl.props.find(x => x.mk === l.pmk) : null;
          if (fp) {
            h += sideBtns(sd => C.propQuote(fp.books, F.book, sd, fp.line)) + lineIn();
            const q = C.propQuote(fp.books, F.book, l.side || "over", fp.line);
            h += `<div class="bt-hint">${q.posted ? `Line and price: ${esc(bkName)} from LineSmart's latest pull.` : `${esc(bkName)} hasn't posted this prop in our data; line shown is ${esc(FEED_NAME[(fp.books.find(b => b.line === fp.line) || {}).key] || "another book's")}. Enter the line and odds from your slip.`} You can edit both.</div>`;
          }
        }
      }
      h += `<button type="button" class="lnk bt-custom" data-a="custom">Player or prop not listed? Enter it yourself</button>`;
    } else {
      if (!players.length) h += `<div class="bt-hint">${PROPS[l.league] ? "No props in our feed for this game" : "No props feed loaded"} (NFL props post during game week, NBA the day before). Enter the prop below; it still settles from the box score.</div>`;
      h += `<label class="bt-f"><span class="bt-lbl">Player</span><input data-f="player" value="${esc(l.player)}" placeholder="Full name, e.g. ${l.league === "nba" ? "Jalen Brunson" : "Jalen Hurts"}" autocomplete="off"></label>
        <label class="bt-f"><span class="bt-lbl">Prop</span><select data-f="pmk"><option value="">Choose a prop…</option>${Object.entries(M).map(([k, v]) => `<option value="${k}"${l.pmk === k ? " selected" : ""}>${esc(v[0])}</option>`).join("")}<option value="other"${l.pmk === "other" ? " selected" : ""}>Something else (settle it yourself)</option></select></label>`;
      if (l.pmk === "other") h += `<label class="bt-f"><span class="bt-lbl">Your pick</span><input data-f="selection" value="${esc(l.selection)}" placeholder="e.g. first TD scorer, double-double" autocomplete="off"></label>`;
      else if (l.pmk) h += sideBtns(null) + lineIn();
      if (players.length) h += `<button type="button" class="lnk bt-custom" data-a="uncustom">← Pick from the ${players.length} players with posted props</button>`;
    }
    return h;
  }

  // ---------- result + finished-game lookup for the add / edit form
  const EVENT_PH = { ufc: "e.g. Pereira vs Ankalaev, UFC 320", nba: "e.g. Lakers @ Celtics", ncaab: "e.g. Duke @ North Carolina", nhl: "e.g. Rangers @ Bruins", mlb: "e.g. Yankees @ Dodgers", epl: "e.g. Arsenal vs Liverpool", mls: "e.g. Inter Miami vs LAFC", ucl: "e.g. Real Madrid vs Bayern" };
  const eventPh = lg => EVENT_PH[lg] || "e.g. Chiefs @ Bills";
  /** parlay: per-leg W/L/P work out the overall result unless the user picked one themselves */
  function legsToStatus() {
    if (F.type !== "parlay" || (F.statusPicked && F.status)) return;
    const r = C.parlayResult(F.legs, "");
    F.status = r.status === "pending" ? "" : r.status; F.statusPicked = false;
  }
  function resultBlock(parlay) {
    const fromLegs = parlay && F.status && !F.statusPicked;
    const graded = parlay ? F.legs.filter(l => C.LEG_RESULTS.includes(l.result)).length : 0;
    const hint = fromLegs ? `Worked out from the leg results. ${C.STATUS[F.status]} counts in your stats as soon as you save.`
      : F.status ? `Settled by you on the date placed: counts in your profit, ROI and streaks right away. Auto-settle won't change it.`
      : parlay && graded ? `${graded} of ${F.legs.length} legs settled. The rest settle automatically if they're linked to a game, or set the result here.`
      : `Leave it Open for a bet that's still running (bets linked to a game settle automatically). Already finished? Pick the result.`;
    return `<div class="bt-resrow"><div class="bt-row">${resultSel(fromLegs ? " (from the legs)" : "")}</div><div class="bt-hint">${esc(hint)}</div></div>`;
  }
  // a finished game that's left the picker: one ESPN scoreboard read for the chosen day (in the browser, site.web.api.espn.com)
  const PAST = {};
  const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  async function loadPast(lg, day) {
    const k = `${lg}|${day}`, LC = window.LiveCore;
    if (PAST[k]) return PAST[k];
    if (!LC || !LC.supported(lg) || !/^\d{4}-\d{2}-\d{2}$/.test(day || "")) return (PAST[k] = { games: [] });
    PAST[k] = { loading: true };
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 10000);
    try {
      const r = await fetch(LC.scoreboardUrl(lg, day.replace(/-/g, "")), { signal: ctl.signal });
      if (!r.ok) throw new Error(r.status);
      return (PAST[k] = { games: C.scoreboardGames(await r.json()) });
    } catch (e) { return (PAST[k] = { error: true }); } finally { clearTimeout(t); }
  }
  function pastHtml(l) {
    const LC = window.LiveCore;
    if (!LC || !LC.supported(l.league)) return `<div class="bt-hint">Type the ${l.league === "ufc" ? "fight" : "game"} and your pick below, then set the Result if it's already over.</div>`;
    const t = today(), def = F.date && F.date < t ? F.date : addDays(t, -1);
    if (!l.pastDay) l.pastDay = def;
    const key = `${l.league}|${l.pastDay}`;
    if (!PAST[key]) loadPast(l.league, l.pastDay).then(() => {
      const app = document.getElementById("app"); if (F && F.legs.includes(l) && app && app.querySelector(".bt-form")) drawForm(app); });
    const P = PAST[`${l.league}|${l.pastDay}`] || { loading: true };
    const fin = g => g.state === "post" ? `${g.away.abbr} ${g.away.score ?? ""} @ ${g.home.abbr} ${g.home.score ?? ""}` : `${g.away.abbr} @ ${g.home.abbr}`;
    const list = P.loading ? `<div class="na bt-past-msg">Loading ${esc(lgName(l.league))} games…</div>`
      : P.error ? `<div class="na bt-past-msg">Couldn't load games for that day. Type the game below instead.</div>`
      : !P.games.length ? `<div class="na bt-past-msg">No ${esc(lgName(l.league))} games that day.</div>`
      : `<div class="bt-past-list">${P.games.map(g => `<button type="button" class="bt-pg" data-a="past" data-v="${esc(g.id)}"><b>${esc(fin(g))}</b><small>${esc(g.state === "post" ? g.detail || "Final" : g.state === "in" ? "Live" : A().timeET(g.date))}</small></button>`).join("")}</div>`;
    return `<div class="bt-past"><div class="bt-past-h"><span class="bt-lbl">Game already played? Find it</span><input data-f="pastday" type="date" aria-label="Game date" min="${addDays(t, -30)}" max="${t}" value="${esc(l.pastDay)}"></div>${list}
      <div class="bt-hint">Pick it to link the game (it then settles from the final score if you leave the Result Open), or type it below.</div></div>`;
  }

  function drawForm(app) {
    const parlay = F.type === "parlay";
    const combined = parlay ? C.parlayAmerican(F.legs.map(l => ({ odds: isNum(l.odds) ? Number(l.odds) : null }))) : null;
    const R = F.review;
    let h = `<form class="bt-form${R ? " bt-rv-form" : ""}" novalidate autocomplete="off"><h2 class="bt-fh">${R ? `Review imported bet${R.n > 1 ? ` <span class="na">${R.i + 1} of ${R.n}</span>` : ""}` : F.id ? "Edit bet" : "Add a bet"}</h2>`;
    if (R) h += reviewPanel();
    else if (!F.id) h += `<a class="bt-implink" href="#/bets/import">Have a bet slip? <b>Import it instead ›</b></a>`;
    h += `<div class="bt-lbl">Sportsbook</div><div class="chips bt-books">${Object.entries(C.BOOKS).map(([k, n]) => `<button type="button" class="chip${F.book === k ? " on" : ""}" data-a="book" data-v="${k}">${esc(n)}</button>`).join("")}</div>`;
    if (F.book === "other") h += `<label class="bt-f"><span class="bt-lbl">Sportsbook name</span><input data-f="bookOther" value="${esc(F.bookOther)}" placeholder="e.g. BetMGM" autocomplete="off"></label>`;
    // guided order for a single bet: sport -> game -> bet type -> pick; a parlay keeps the type switch on top (legs pick their own market)
    const typeSeg = `<div class="bt-lbl">Bet type</div><div class="seg bt-types">${Object.entries(C.TYPES).map(([k, n]) => `<button type="button" data-a="type" data-v="${k}" class="${F.type === k ? "on" : ""}">${esc(k === "total" ? "Total" : k === "prop" ? "Player prop" : n)}</button>`).join("")}</div>`;
    if (parlay) h += typeSeg;
    h += `<div class="bt-legs-ed">${F.legs.map((l, i) => legHtml(l, i, parlay, parlay ? "" : typeSeg)).join("")}</div>`;
    if (parlay) h += `<button type="button" class="chip bt-addleg" data-a="addleg">+ Add leg</button>
      <div class="bt-comb">Combined odds <b>${combined === null ? "—" : esc(am(combined))}</b> <span class="na">from ${F.legs.length} leg${F.legs.length > 1 ? "s" : ""}</span></div>
      <label class="bt-chk"><input type="checkbox" data-f="oddsManual"${F.oddsManual ? " checked" : ""}> Use the odds on my ticket instead (boosts, same-game parlays)</label>`;
    const showOdds = !parlay || F.oddsManual;
    h += `<div class="bt-row">${showOdds ? `<label class="bt-f"><span class="bt-lbl">Odds (American)</span><input data-f="odds" type="text" inputmode="numeric" value="${esc(F.odds)}" placeholder="-110 or +150"></label>` : ""}
      <label class="bt-f"><span class="bt-lbl">Stake ($)</span><input data-f="stake" type="number" inputmode="decimal" step="0.01" min="0" value="${esc(F.stake)}" placeholder="10.00"></label>
      <label class="bt-f"><span class="bt-lbl">Date placed</span><input data-f="date" type="date" max="${today()}" value="${esc(F.date)}"></label></div>
      ${R ? "" : resultBlock(parlay)}
      <div class="bt-towin" aria-live="polite"></div>
      <label class="bt-f"><span class="bt-lbl">Notes <span class="na">(optional)</span></span><input data-f="notes" value="${esc(F.notes)}" placeholder="e.g. bet ID, boost, reasoning" autocomplete="off"></label>
      <div class="bt-err" role="alert"></div>
      <div class="bt-actions"><a class="chip" href="${R ? "#/bets/import" : F.id ? "#/bets/list" : "#/bets"}">${R ? "Back" : "Cancel"}</a>${R && R.n > 1 ? `<button type="button" class="chip" data-a="skip">Skip this bet</button>` : ""}<button type="submit" class="bt-add">${R ? (R.n > 1 ? `Save bet ${R.i + 1} of ${R.n}` : "Looks right: save bet") : F.id ? "Save changes" : "Save bet"}</button></div>
      <div class="note">${signedIn() ? "Saved on this device and synced to your account. " : "Saved on this device. "}${F.type === "prop" || F.type === "parlay" ? "NFL and NBA player props picked from a game settle automatically from ESPN's box score; anything it can't grade (player didn't play, prop not in the box score) is flagged for you to settle. Other props and manual entries are settled by you from the Bets list." : "Moneyline, spread and total bets linked to a game settle automatically from ESPN final scores."}</div></form>`;
    app.innerHTML = shell(R ? "imp" : "add", h);
    const form = $(".bt-form", app);
    updateToWin(form);
    form.addEventListener("click", e => {
      const b = e.target.closest("[data-a]"); if (!b) return;
      const legEl = b.closest("[data-leg]"), l = legEl ? F.legs[+legEl.dataset.leg] : F.legs[0], v = b.dataset.v;
      const a = b.dataset.a;
      if (a === "skip") return nextImport(app, false);
      if (a === "book") { F.book = v; if (F.review) F.review.bookTouched = true; refreshPrices(); }
      else if (a === "type") {
        const was = F.type; F.type = v;
        if (v === "parlay" && was !== "parlay") { F.legs.forEach(x => { x.mk = was === "parlay" ? x.mk : was; if (!isNum(x.odds) && isNum(F.odds)) x.odds = F.odds; }); if (F.legs.length < 2) F.legs.push(newLeg(F.legs[0].league)); F.odds = ""; }
        if (v !== "parlay" && was === "parlay" && !F.statusPicked) F.status = "";
        if (v !== "parlay") { F.legs = [F.legs[0]]; F.legs[0].mk = v; if (was === "parlay") F.odds = F.legs[0].odds; if (was !== v) clearProp(F.legs[0]); }
      }
      else if (a === "mk") { l.mk = v; clearProp(l); }
      else if (a === "lg") { l.league = v; l.eventId = ""; l.event = null; l.manual = false; clearProp(l); setPref("lg", v); return Promise.all([gamesFor(v), propsFor(v)]).then(() => drawForm(app)); }
      else if (a === "side") { l.side = v; setPrice(l); }
      else if (a === "pl") { const pl = feedPlayers(l).find(x => x.pid === v); Object.assign(l, { pid: v, player: pl ? pl.n : "", pmk: "", side: "", line: "" }); }
      else if (a === "plclear") clearProp(l);
      else if (a === "pm") { l.pmk = v; l.side = C.YESNO.has(v) ? "over" : l.side; l.line = ""; setPrice(l); }
      else if (a === "custom") { l.custom = true; l.pid = ""; }
      else if (a === "uncustom") clearProp(l);
      else if (a === "addleg") { F.legs.push(newLeg(F.legs[F.legs.length - 1].league)); }
      else if (a === "rmleg") { F.legs.splice(+legEl.dataset.leg, 1); legsToStatus(); }
      else if (a === "lres") { l.result = v === "pending" ? undefined : v; delete l.review; legsToStatus(); }
      else if (a === "past") { const g = (PAST[`${l.league}|${l.pastDay}`] || {}).games?.find(x => String(x.id) === v); if (g) { Object.assign(l, { manual: false, eventId: String(g.id), event: evOf(g, l.league), eventText: "" }); clearProp(l); } }
      drawForm(app);
    });
    form.addEventListener("change", e => {
      const t = e.target, legEl = t.closest("[data-leg]"), l = legEl ? F.legs[+legEl.dataset.leg] : null;
      if (t.dataset.f === "game") {
        l.manual = t.value === "__manual"; l.eventId = l.manual ? "" : t.value; clearProp(l);
        const g = ((GAMES[l.league] || {}).games || []).find(x => String(x.id) === l.eventId); l.event = g ? evOf(g, l.league) : null;
        drawForm(app);
      } else if (t.dataset.f === "oddsManual") { F.oddsManual = t.checked; drawForm(app); }
      else if (t.dataset.f === "status") { F.status = t.value; F.statusPicked = !!t.value; drawForm(app); }
      else if (t.dataset.f === "pastday") { if (t.value) { l.pastDay = t.value; drawForm(app); } }
      else if (t.dataset.f === "pmk") { l.pmk = t.value; l.side = C.YESNO.has(t.value) ? "over" : ""; l.line = ""; drawForm(app); }
    });
    form.addEventListener("input", e => {
      const t = e.target, f = t.dataset.f; if (!f || f === "game" || f === "oddsManual" || f === "pmk" || f === "status" || f === "pastday") return;
      if (f === "psearch") {   // filter the player list in place (no redraw, keeps the keyboard up)
        const q = C.normName(t.value);
        t.closest("[data-leg]").querySelectorAll(".bt-pl").forEach(b => (b.hidden = !!q && !b.dataset.n.includes(q)));
        return;
      }
      const legEl = t.closest("[data-leg]");
      if (legEl) { F.legs[+legEl.dataset.leg][f] = t.value; if (f === "odds" && F.type === "parlay") { const c = $(".bt-comb b", form), x = C.parlayAmerican(F.legs.map(l => ({ odds: isNum(l.odds) ? Number(l.odds) : null }))); if (c) c.textContent = x === null ? "—" : am(x); } }
      else F[f] = t.value;
      updateToWin(form);
    });
    form.addEventListener("submit", e => { e.preventDefault(); submit(form); });
    function setPrice(l) {
      const mk = F.type === "parlay" ? l.mk : F.type;
      if (mk === "prop") {
        const fp = !l.custom && feedProp(l); if (!fp) return;
        const q = C.propQuote(fp.books, F.book, l.side || "over", fp.line);
        if (isNum(q.line) && !C.YESNO.has(l.pmk)) l.line = q.line;
        if (l.side) { l.odds = isNum(q.odds) ? q.odds : ""; if (F.type !== "parlay") F.odds = l.odds; }
        return;
      }
      const g = ((GAMES[l.league] || {}).games || []).find(x => String(x.id) === String(l.eventId)); if (!g) return;
      const pr = priceFor(quote(g, F.book), mk, l.side);
      if (isNum(pr.line)) l.line = pr.line;
      if (isNum(pr.odds)) { l.odds = pr.odds; if (F.type !== "parlay") F.odds = pr.odds; }
    }
    function refreshPrices() { F.legs.forEach(l => (l.side || l.pmk) && setPrice(l)); }
  }
  function currentOdds() {
    if (F.type !== "parlay" || F.oddsManual) return isNum(F.odds) ? Number(F.odds) : null;
    return C.parlayAmerican(F.legs.map(l => ({ odds: isNum(l.odds) ? Number(l.odds) : null })));
  }
  function updateToWin(form) {
    const o = currentOdds(), s = parseFloat(F.stake), el = $(".bt-towin", form);
    const w = isNum(s) && s > 0 && C.validAmerican(o) ? C.winProfit(s, o) : null;
    el.innerHTML = w === null ? `<span class="na">Enter odds and stake to see the potential payout.</span>` : `To win <b>${money(w)}</b> <span class="na">· total payout ${money(w + s)} · implied ${(C.impliedProb(o) * 100).toFixed(1)}%</span>`;
  }
  function submit(form) {
    const err = msg => { const e = $(".bt-err", form); e.textContent = msg; e.scrollIntoView({ block: "center", behavior: "smooth" }); return false; };
    const stake = parseFloat(F.stake);
    if (!isNum(stake) || stake <= 0) return err("Enter the amount you staked.");
    if (F.book === "other" && !F.bookOther.trim()) return err("Enter the sportsbook name.");
    const parlay = F.type === "parlay";
    const legs = [];
    for (const [i, l] of F.legs.entries()) {
      const mk = parlay ? l.mk : F.type, tag = parlay ? `Leg ${i + 1}: ` : "";
      const linked = !l.manual && l.event;
      if (!linked && !l.manual && !l.selection.trim()) return err(tag + "Choose a game (or pick “Not listed”).");
      const leg = { league: l.league, type: mk, odds: isNum(l.odds) ? Number(l.odds) : null };
      if (linked) leg.event = l.event; else if (l.eventText.trim()) leg.eventText = l.eventText.trim();
      if (linked && mk === "prop" && PROP_LG.has(l.league) && l.pmk !== "other") {
        const name = String(l.player || "").trim(), yes = C.YESNO.has(l.pmk);
        if (!name) return err(tag + "Pick the player (or type his name).");
        if (!l.pmk) return err(tag + "Pick the prop (e.g. points, passing yards).");
        if (!l.side) return err(tag + (yes ? "Tap Yes or No." : "Tap Over or Under."));
        if (!yes && !isNum(l.line)) return err(tag + "Enter the prop line (e.g. 24.5).");
        if (!yes && Number(l.line) < 0) return err(tag + "Prop lines can't be negative.");
        leg.prop = { mk: l.pmk, pid: l.pid ? String(l.pid) : undefined, player: name, label: C.propLabel(l.league, l.pmk), line: yes ? 0.5 : Number(l.line), side: l.side };
        leg.selection = C.describeProp(leg);
      } else if (linked && mk !== "prop") {
        if (!l.side) return err(tag + "Tap the side you bet.");
        leg.side = l.side;
        if (mk !== "ml") { if (!isNum(l.line)) return err(tag + "Enter the line (e.g. -3.5 or 44.5)."); leg.line = Number(l.line); }
        if (mk === "total" && leg.line < 0) return err(tag + "Totals can't be negative.");
      } else {
        if (!l.selection.trim()) return err(tag + "Describe your pick.");
        leg.selection = l.selection.trim();
      }
      if (parlay) { if (!F.oddsManual && !C.validAmerican(leg.odds)) return err(tag + "Enter the leg's American odds (e.g. -110 or +150)."); if (l.result) leg.result = l.result; }
      legs.push(leg);
    }
    if (parlay && legs.length < 2) return err("A parlay needs at least two legs.");
    const odds = currentOdds();
    if (!C.validAmerican(odds)) return err("Enter American odds, e.g. -110 or +150 (at least 100 either way).");
    const prev = F.id ? BETS.find(b => b.id === F.id) : null;
    const R = F.review;
    let chosen = C.RESULTS.includes(F.status) ? F.status : "";
    if (parlay) { const pr = C.parlayResult(legs, chosen); if (pr.error) return err(pr.error); chosen = pr.status === "pending" ? "" : pr.status; }
    const slipSt = R ? chosen : "";
    let co = null;
    if (chosen === "cashout") { co = parseFloat(F.cashout); if (!isNum(co) || co < 0) return err("Enter the cash-out amount you received."); co = Math.round(co * 100) / 100; }
    const base = { id: F.id || C.uid(), createdAt: prev ? prev.createdAt : new Date().toISOString(), date: F.date || today(), book: F.book, bookOther: F.book === "other" ? F.bookOther.trim() : undefined,
      type: F.type, odds, stake: Math.round(stake * 100) / 100, notes: F.notes.trim() || undefined, status: prev ? prev.status : "pending" };
    if (prev) for (const k of ["settledAt", "settledBy", "manual", "cashout", "final", "slipRef", "source"]) if (prev[k] !== undefined) base[k] = prev[k];
    if (R) {   // imported from a bet slip: remember its ID (duplicate check) and a result the slip already showed
      base.source = "slip"; if (F.ref) base.slipRef = F.ref;
      if (slipSt) Object.assign(base, { status: slipSt, manual: true, settledBy: "slip", settledAt: today(), cashout: co ?? undefined });
    }
    let bet = parlay ? { ...base, legs, oddsManual: !!F.oddsManual, league: undefined } : { ...base, ...legs[0], type: F.type, odds };
    if (!parlay) delete bet.result;
    bet = C.normalizeBet(JSON.parse(JSON.stringify(bet)));
    // a changed selection on an auto-settled bet re-opens it so it can be graded again
    // Result picked in the form: settled by hand on the placed date (counts in stats now; auto-settle leaves it alone)
    const prevSt = prev && prev.status !== "pending" ? prev.status : "";
    const resultSet = !R && (prev ? chosen !== prevSt || (chosen === "cashout" && co !== prev.cashout) || (chosen && prev.settledBy === "manual" && (F.date || today()) !== prev.date) : !!chosen);
    if (resultSet) bet = C.manualSettle(bet, chosen, { cashout: co, date: F.date || today(), today: today() });
    else if (prev && prev.settledBy === "auto") Object.assign(bet, { status: "pending", settledAt: null, settledBy: null, final: null });
    BETS = prev ? BETS.map(b => (b.id === prev.id ? bet : b)) : [bet, ...BETS];
    if (!save()) return;
    if (R) { lastAuto = 0; if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); return nextImport(document.getElementById("app"), true); }
    setPref("book", F.book); if (F.book === "other") setPref("bookOther", F.bookOther.trim()); setPref("stake", F.stake);
    if (!prev && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    lastAuto = 0;
    toast((prev ? "Bet updated." : "Bet saved on this device.") + (resultSet && chosen ? ` Marked ${C.STATUS[chosen].toLowerCase()}.` : ""));
    location.hash = "#/bets/list";
  }


  // ---------- bet slip import: paste a slip's text or add a screenshot. slip-core.js reads it on this device (OCR via tesseract.js,
  // loaded only when a screenshot is picked), matches games/players, and every bet opens in the normal form to review. Nothing saves silently.
  const SC = () => window.SlipCore;
  const QKEY = "ls-slip-queue";
  const TESS_SRC = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
  let SLIPQ = null, SLIP_TEXT = "", SLIP_BOOK = "";
  const loadQ = () => { if (!SLIPQ) try { SLIPQ = JSON.parse(sessionStorage.getItem(QKEY) || "null"); } catch (e) { SLIPQ = null; } return SLIPQ; };
  const saveQ = () => { try { SLIPQ ? sessionStorage.setItem(QKEY, JSON.stringify(SLIPQ)) : sessionStorage.removeItem(QKEY); } catch (e) {} };
  const SEARCH = {};
  async function searchFor(lg) { if (!(lg in SEARCH)) { try { SEARCH[lg] = await A().getJSON(`data/search/${lg}.json`); } catch (e) { SEARCH[lg] = null; } } return SEARCH[lg]; }
  async function slipIndex() {
    const lgs = A().meta().order;
    await Promise.all(lgs.map(lg => gamesFor(lg)));
    await Promise.all(["nfl", "nba", "mlb", "nhl"].filter(l => lgs.includes(l)).map(lg => Promise.all([searchFor(lg), propsFor(lg)])));
    const ctx = { games: {}, search: {}, props: {} };
    for (const lg of lgs) ctx.games[lg] = (GAMES[lg] || {}).games || [];
    for (const lg of Object.keys(SEARCH)) if (SEARCH[lg]) ctx.search[lg] = SEARCH[lg];
    for (const lg of Object.keys(PROPS)) if (PROPS[lg]) ctx.props[lg] = PROPS[lg];
    return SC().buildIndex(ctx);
  }
  const SLIP_EXAMPLE = "Hard Rock Bet\nBet Placed\nSingle\nPhiladelphia Eagles -3.5\n-110\nPoint Spread\nDallas Cowboys @ Philadelphia Eagles\nStake\n$10.00\nPotential Return\n$19.09\nBet Ref: HRB2610264471";

  function viewImport(app) {
    const q = loadQ(), left = q && q.items && q.i < q.items.length ? q.items.length - q.i : 0;
    const books = [["", "Auto-detect"], ...Object.entries(C.BOOKS)];
    app.innerHTML = shell("imp", `<div class="bt-imp-wrap">
      <section class="card bt-slip">
        <h2 class="bt-fh">Import a bet slip</h2>
        <p class="sub bt-slip-sub">Paste the text of a bet slip or confirmation, or add a screenshot. LineSmart reads it on this device, matches it to games and players, then shows you every field to check before anything is saved.</p>
        ${left ? `<div class="bt-slip-resume" role="note"><span>${left} imported bet${left > 1 ? "s" : ""} still waiting for review.</span><a class="chip" href="#/bets/import/review/${q.i}">Continue review</a><button type="button" class="chip" data-a="discard">Discard</button></div>` : ""}
        <div class="bt-lbl">Sportsbook</div>
        <div class="chips bt-books bt-scroll">${books.map(([k, n]) => `<button type="button" class="chip${SLIP_BOOK === k ? " on" : ""}" data-a="sbook" data-v="${k}">${esc(n)}</button>`).join("")}</div>
        <label class="bt-f"><span class="bt-lbl">Bet slip text</span><textarea class="bt-slip-ta" rows="10" spellcheck="false" placeholder="Paste here, e.g.&#10;Philadelphia Eagles -3.5  -110&#10;Dallas Cowboys @ Philadelphia Eagles&#10;Stake $10.00   To Win $9.09">${esc(SLIP_TEXT)}</textarea></label>
        <div class="bt-slip-btns">
          <label class="chip bt-shot"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M9 3 7.2 5H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3H9Zm3 5a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"/></svg>Add screenshot<input type="file" accept="image/*" data-a="shot" hidden></label>
          <button type="button" class="lnk bt-ex" data-a="example">Try an example</button>
          <span class="bt-sp"></span>
          <button type="button" class="bt-add" data-a="read">Read slip</button>
        </div>
        <div class="bt-ocr" aria-live="polite" hidden><span class="bt-spin" aria-hidden="true"></span><span class="bt-ocr-t"></span></div>
        <div class="bt-err" role="alert"></div>
      </section>
      <section class="card bt-slip-help">
        <h3>Getting your slip</h3>
        <ul>
          <li><b>Hard Rock Bet</b>: My Bets → open the bet → take a screenshot, or press and hold to select and copy the text.</li>
          <li><b>DraftKings / FanDuel</b>: My Bets → tap the bet → Share (copy) or screenshot it. Desktop: select the bet card and copy.</li>
          <li><b>Several bets?</b> Paste them together: each slip with its own stake becomes its own bet to review.</li>
        </ul>
        <h3>What it reads</h3>
        <p class="na">Singles, parlays and same-game parlays: moneyline, spread, total and NFL/NBA player props (over/under, “25+” ladders, anytime TD), with odds, stake, payout, bet ID and date. Bets linked to a LineSmart game settle automatically from final scores. Teasers, round robins, half/quarter bets and other props are kept for you to settle.</p>
        <p class="na bt-slip-priv">Private: screenshots are read in your browser with open-source OCR (a one-time ~10 MB download of the reader). Your slip is never uploaded, and it isn't connected to your sportsbook account.</p>
      </section></div>`);
    const root = $(".bt-imp-wrap", app), ta = $(".bt-slip-ta", root), err = $(".bt-err", root), st = $(".bt-ocr", root);
    const status = msg => { st.hidden = !msg; $(".bt-ocr-t", st).textContent = msg || ""; };
    const fail = msg => { status(""); err.textContent = msg; return false; };
    ta.addEventListener("input", () => { SLIP_TEXT = ta.value; err.textContent = ""; });
    const fromImage = async file => {
      err.textContent = "";
      if (!file || !/^image\//.test(file.type)) return fail("Choose an image file (a screenshot of your bet slip).");
      try {
        const text = await ocrImage(file, status);
        if (!text.trim()) return fail("Couldn't read any text in that screenshot. Try a sharper one, or paste the text instead.");
        SLIP_TEXT = ta.value = text.trim();
        return read();
      } catch (e) { return fail(e && e.message ? e.message : "Couldn't read that screenshot."); }
    };
    const read = async () => {
      err.textContent = "";
      const text = ta.value;
      if (!text.trim()) return fail("Paste your bet slip text or add a screenshot first.");
      status("Matching to LineSmart games…");
      const tok = A().nav();
      let idx; try { idx = await slipIndex(); } catch (e) { idx = SC().buildIndex({}); }
      if (tok !== A().nav()) return;
      const r = SC().parseSlip(text, idx);
      if (!r.tickets.length) return fail("Couldn't find a bet in that text. Include the selection (e.g. “Eagles -3.5 -110”) and the stake, or use + Add bet.");
      const items = r.tickets.map(t => {
        SC().matchTicket(t, idx);
        if (SLIP_BOOK) { t.book = SLIP_BOOK; if (SLIP_BOOK !== "other") t.bookName = null; }
        const D = SC().toDraft(t, { defaultBook: defaultBook(), defaultLeague: prefs().lg, today: today() });
        if (D.book === "other" && !D.bookOther) D.bookOther = prefs().bookOther || "";
        D.review = { warnings: t.warnings || [], bookFromSlip: !!t.book, bookName: t.bookName || "", text: (t.lines || []).join("\n"),
          sum: { stake: t.stake, odds: t.odds, toWin: t.toWin, payout: t.payout, ref: t.ref, placed: t.placed ? t.placed.date : "", status: t.status, cashout: t.cashout, parlay: !!t.parlay, legs: t.legs.length } };
        return D;
      });
      status("");
      SLIPQ = { items, i: 0, saved: 0, at: Date.now() }; saveQ();
      location.hash = "#/bets/import/review/0";
    };
    root.addEventListener("click", e => {
      const b = e.target.closest("[data-a]"); if (!b) return;
      const a = b.dataset.a;
      if (a === "sbook") { SLIP_BOOK = b.dataset.v; root.querySelectorAll('[data-a="sbook"]').forEach(x => x.classList.toggle("on", x === b)); }
      else if (a === "example") { SLIP_TEXT = ta.value = SLIP_EXAMPLE; ta.focus(); }
      else if (a === "read") read();
      else if (a === "discard") { SLIPQ = null; saveQ(); viewImport(app); }
    });
    $('[data-a="shot"]', root).addEventListener("change", e => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) fromImage(f); });
    ta.addEventListener("paste", e => {   // pasting a screenshot straight from the clipboard
      const it = [...((e.clipboardData && e.clipboardData.items) || [])].find(x => x.kind === "file" && /^image\//.test(x.type));
      if (it) { e.preventDefault(); fromImage(it.getAsFile()); }
    });
    root.addEventListener("dragover", e => e.preventDefault());
    root.addEventListener("drop", e => { const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f && /^image\//.test(f.type)) { e.preventDefault(); fromImage(f); } });
  }

  let tessP = null;
  function loadTess() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    return tessP || (tessP = new Promise((res, rej) => {
      const sc = document.createElement("script"); sc.src = TESS_SRC; sc.async = true; sc.crossOrigin = "anonymous";
      sc.onload = () => (window.Tesseract ? res(window.Tesseract) : rej(new Error("The screenshot reader didn't load.")));
      sc.onerror = () => { tessP = null; sc.remove(); rej(new Error("Couldn't load the screenshot reader (are you offline?). Paste the slip text instead.")); };
      document.head.appendChild(sc);
    }));
  }
  async function slipCanvas(file) {   // upscale small screenshots, grayscale + invert dark mode + stretch contrast (slip-core ocrPrep)
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("That file isn't an image this browser can open.")); i.src = url; });
      const w = img.naturalWidth || img.width, k = w < 1100 ? Math.min(2.5, 1600 / w) : w > 2400 ? 2400 / w : 1;
      const c = document.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round((img.naturalHeight || img.height) * k);
      const x = c.getContext("2d", { willReadFrequently: true }); x.imageSmoothingQuality = "high"; x.drawImage(img, 0, 0, c.width, c.height);
      const d = x.getImageData(0, 0, c.width, c.height); SC().ocrPrep(d.data); x.putImageData(d, 0, 0);
      return c;
    } finally { URL.revokeObjectURL(url); }
  }
  async function ocrImage(file, status) {
    status("Loading the screenshot reader…");
    const T = await loadTess();
    const canvas = await slipCanvas(file);
    const worker = await T.createWorker("eng", 1, { logger: m => {
      if (m.status === "recognizing text") status(`Reading your screenshot… ${Math.round((m.progress || 0) * 100)}%`);
      else if (/load|initiali/i.test(m.status || "")) status("Loading the screenshot reader (first time only)…");
    } });
    try { await worker.setParameters({ preserve_interword_spaces: "1" }); const r = await worker.recognize(canvas); return (r && r.data && r.data.text) || ""; }
    finally { worker.terminate(); }
  }

  async function viewReview(app, i) {
    const q = loadQ();
    if (!q || !q.items || !q.items[i]) { location.hash = "#/bets/import"; return; }
    q.i = i; saveQ();
    const tok = A().nav();
    F = JSON.parse(JSON.stringify(q.items[i]));
    Object.assign(F.review, { i, n: q.items.length });
    F.statusPicked = !!F.status;
    for (const l of F.legs) { await gamesFor(l.league); await propsFor(l.league); }
    if (tok !== A().nav()) return;
    for (const l of F.legs) if (l.mk === "prop" && l.pid && !feedPlayers(l).some(p => p.pid === String(l.pid))) { l.pid = ""; l.custom = true; }
    const d = F.ref ? SC().dupOf(BETS, F.ref) : null;
    F.review.dup = d ? { date: d.date, what: describe(d) } : null;
    drawForm(app);
  }
  function nextImport(app, saved) {
    const q = loadQ(); if (!q) { location.hash = "#/bets/list"; return; }
    if (saved) q.saved = (q.saved || 0) + 1;
    const next = (F && F.review ? F.review.i : q.i) + 1;
    if (next < q.items.length) {
      q.i = next; saveQ();
      if (saved) toast(`Saved. Now bet ${next + 1} of ${q.items.length}.`);
      location.hash = `#/bets/import/review/${next}`;
      return;
    }
    const n = q.saved || 0;
    SLIPQ = null; saveQ(); SLIP_TEXT = "";
    toast(n ? `${n} imported bet${n > 1 ? "s" : ""} saved${signedIn() ? " and synced" : " on this device"}.` : "No bets imported.");
    location.hash = n ? "#/bets/list" : "#/bets/import";
  }
  const REV_ST = { matched: ["ok", "✓", "Matched"], check: ["chk", "!", "Check"], settle: ["set", "✎", "You settle"], manual: ["man", "?", "No game found"] };
  function legReview(r) {
    const [cls, ic, label] = REV_ST[r.status] || REV_ST.manual;
    const why = r.why || (r.status === "matched" ? "Linked to this game: settles automatically." : r.status === "manual" ? "Pick the game below to auto-settle, or leave “Not listed” and settle it yourself." : "");
    return `<div class="bt-from rv-${cls}"><span class="bt-rvb"><i aria-hidden="true">${ic}</i>${label}</span><span class="bt-from-t">From slip: <q>${esc(r.text || "—")}</q></span>${why ? `<span class="bt-from-why">${esc(why)}</span>` : ""}</div>`;
  }
  /** Result select shared by the add / edit form and the slip review (Open = not settled yet); cash-out asks for the amount */
  function resultSel(suffix = "") {
    return `<label class="bt-f bt-half"><span class="bt-lbl">Result${suffix}</span><select data-f="status" aria-label="Result">${[["", "Open (not settled yet)"], ["won", "Won"], ["lost", "Lost"], ["push", "Push"], ["void", "Void"], ["cashout", "Cashed out"]].map(([k, n]) => `<option value="${k}"${(F.status || "") === k ? " selected" : ""}>${n}</option>`).join("")}</select></label>${F.status === "cashout" ? `<label class="bt-f bt-half"><span class="bt-lbl">Cash-out amount ($)</span><input data-f="cashout" type="number" inputmode="decimal" step="0.01" min="0" value="${esc(F.cashout)}" placeholder="0.00"></label>` : ""}`;
  }
  function reviewPanel() {
    const R = F.review, s = R.sum || {};
    const cells = [["Stake", isNum(s.stake) ? money(s.stake) : "—"], ["Odds", isNum(s.odds) ? am(s.odds) : "—"], [isNum(s.payout) ? "Payout" : "To win", isNum(s.payout) ? money(s.payout) : isNum(s.toWin) ? money(s.toWin) : "—"], ["Bet ID", s.ref || "—"]];
    const counts = {}; for (const l of F.legs) if (l.review) counts[l.review.status] = (counts[l.review.status] || 0) + 1;
    const book = R.bookFromSlip || R.bookTouched ? "" : `<li>Sportsbook isn't on the slip: set to ${esc(C.BOOKS[F.book] || F.book)}. Change it below if needed.</li>`;
    const warn = [...(R.warnings || []).map(w => `<li>${esc(w)}</li>`), book].filter(Boolean).join("");
    const resSel = resultSel(s.status ? " (from the slip)" : "");
    return `<div class="bt-rv" role="region" aria-label="What we read from your slip">
      <div class="bt-rv-h"><span class="bt-rv-tag">${R.bookFromSlip ? esc(R.bookName || C.BOOKS[F.book] || "Sportsbook") + " slip" : "Bet slip"}</span><span class="na">Nothing is saved until you tap Save. Fix anything that looks off.</span></div>
      <div class="bt-rv-sum">${cells.map(([k, v]) => `<div><span>${k}</span><b>${esc(v)}</b></div>`).join("")}</div>
      <div class="bt-rv-legs">${Object.entries(REV_ST).filter(([k]) => counts[k]).map(([k, [cls, ic, label]]) => `<span class="bt-rvb rv-${cls}"><i aria-hidden="true">${ic}</i>${counts[k]} ${label.toLowerCase()}</span>`).join("")}</div>
      ${R.dup ? `<div class="bt-rv-dup" role="alert"><b>Already tracked?</b> A bet with this bet ID (${esc(F.ref)}) was saved${R.dup.date ? ` on ${esc(R.dup.date)}` : ""}: ${esc(R.dup.what)}. ${R.n > 1 ? "Skip it" : "Go back"} unless it's a different bet.</div>` : ""}
      ${warn ? `<ul class="bt-rv-warn">${warn}</ul>` : ""}
      <div class="bt-row">${resSel}</div>
      ${R.text ? `<details class="bt-rv-raw"><summary>Text read from the slip</summary><pre>${esc(R.text)}</pre></details>` : ""}
    </div>`;
  }

  // ---------- router entry (called by app.js)
  async function view() {
    const app = document.getElementById("app");
    const raw = location.hash.replace(/^#\/?/, ""), [path, query] = raw.split("?"), seg = path.split("/");
    A().renderTabs(null);
    window.onresize = null;
    BETS = load();
    if (seg[1] === "add") { window.scrollTo(0, 0); return viewForm(app, null, new URLSearchParams(query || "")); }
    if (seg[1] === "import") { window.scrollTo(0, 0); return seg[2] === "review" ? viewReview(app, Number(seg[3]) || 0) : viewImport(app); }
    if (seg[1] === "edit" && seg[2]) { window.scrollTo(0, 0); return viewForm(app, decodeURIComponent(seg[2])); }
    const render = () => (seg[1] === "list" ? viewList(app) : viewOverview(app));
    render();
    const tok = A().nav();
    const n = await runAutoSettle();
    if ((n || REVIEWED) && tok === A().nav()) { render(); toast([n ? `${n} bet${n > 1 ? "s" : ""} settled from final scores.` : "", REVIEWED ? `${REVIEWED} need${REVIEWED > 1 ? "" : "s"} your review.` : ""].filter(Boolean).join(" ")); }
  }
  /** "Track this bet" link for a game (and optionally a market) */
  function trackHref(lg, g, mk, side, book, pr) {
    const p = new URLSearchParams({ lg, ev: g.id });
    if (mk) p.set("mk", mk); if (side) p.set("side", side); if (book) p.set("bk", book);
    if (pr && isNum(pr.line)) p.set("ln", pr.line); if (pr && isNum(pr.odds)) p.set("od", pr.odds);
    return "#/bets/add?" + p.toString();
  }
  /** "+ Track" on a player-prop row: opens the add sheet with the game, player and prop picked (you tap Over / Under).
   *  feedBook = the row's graded book (props feed key); left off when it isn't legal in the visitor's state so the form's default (Hard Rock in FL) applies. */
  function propHref(lg, gid, pid, mk, feedBook, line, side) {
    const p = new URLSearchParams({ lg, ev: gid, mk: "prop", pid, pm: mk });
    const bk = TRACK_BOOK[feedBook];
    if (bk && okBook(bk)) p.set("bk", bk);
    if (isNum(line)) p.set("ln", line);
    if (side === "over" || side === "under") p.set("side", side);   // Value finder: the side it found
    return "#/bets/add?" + p.toString();
  }
  /** "+" on an odds-comparison cell: book (odds-file key) + market + side, prefilled with that book's line and price. */
  function cellHref(lg, g, feedBook, mk, side) {
    const b = (g.books || {})[feedBook], bk = TRACK_BOOK[feedBook];
    if (!b || b.stale || !bk || !okBook(bk)) return "";
    return trackHref(lg, g, mk, side, bk, priceFor({ o: b }, mk, side));
  }
  /** game page card: one-tap shortcuts that prefill the add form */
  function trackCard(lg, g, kind) {
    if (g.state === "post") return `<div class="section-title">Track a bet</div><div class="card bt-track"><h3>Bet on this game? <a class="lnk bt-more" href="${esc(trackHref(lg, g))}">Log it ›</a></h3><div class="note">Moneyline, spread and total bets on finished games are graded from the final score as soon as you save them.</div></div>`;
    const soccer = kind === "soccer", mma = kind === "mma", out = [];
    const GEO = window.LSGeo, map = { draftkings: "draftkings", hardrockbet: "hardrock", fanduel: "fanduel" };
    // one-tap shortcuts only for books that are legal online in the visitor's state (Hard Rock first in FL)
    const keys = GEO ? GEO.sortBooks(["draftkings", "hardrockbet", "fanduel"]) : ["draftkings", "hardrockbet", "fanduel"];
    let hidden = 0;
    for (const key of keys) {
      const bk = map[key], b = (g.books || {})[key]; if (!b || b.stale) continue;
      if (GEO && !GEO.isAvailable(key)) { hidden++; continue; }
      const q = { o: b }, row = [];
      const add = (mk, side, label) => { const pr = priceFor(q, mk, side); if (isNum(pr.odds) || (mk !== "ml" && isNum(pr.line))) row.push(`<a class="oc bt-q" href="${esc(trackHref(lg, g, mk, side, bk, pr))}"><b>${esc(label(pr))}</b><small>${esc(am(pr.odds) || "")}</small></a>`); };
      if (!soccer && !mma) { add("spread", "away", pr => `${g.away.abbr} ${ln(pr.line)}`); add("spread", "home", pr => `${g.home.abbr} ${ln(pr.line)}`); }
      add("ml", "away", () => `${g.away.abbr} ML`); if (soccer) add("ml", "draw", () => "Draw"); add("ml", "home", () => `${g.home.abbr} ML`);
      add("total", "over", pr => `O ${pr.line ?? ""}`); add("total", "under", pr => `U ${pr.line ?? ""}`);
      if (row.length) out.push(`<div class="bt-qrow"><span class="bt-qb">${esc(C.BOOKS[bk])}</span><div class="bt-qgrid">${row.join("")}</div></div>`);
    }
    return `<div class="section-title">Track a bet</div><div class="card bt-track"><h3>Placed a bet on this game? <a class="lnk bt-more" href="${esc(trackHref(lg, g))}">Other bet ›</a></h3>
      ${out.join("") || (hidden ? `<div class="na">Shortcuts appear only for sportsbooks that are legal online in ${esc((GEO.current() || {}).stateName || "your state")}. You can still log a bet.</div>` : `<div class="na">No book prices for this game yet. You can still log it.</div>`)}<div class="note">Tap the line you bet to log it in My Bets (saved only on this device). Your stake and the exact odds on your slip come next.</div></div>`;
  }
  window.LSBets = { view, trackHref, trackCard, propHref, cellHref, syncState, applySync };
})();
