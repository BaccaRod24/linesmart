/* LineSmart "My Bets": a private bet tracker. Bets live only in this browser (localStorage); nothing is sent anywhere.
 * Routes: #/bets (overview), #/bets/list, #/bets/add[?lg=&ev=&mk=&side=&ln=&od=&bk=], #/bets/edit/<id>
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

  // ---------- storage (this device only)
  const DEMO_KEY = "ls-bets-demo";   // set only by scripts/screenshots_bets.mjs to label example data
  function load() {
    try { const d = JSON.parse(localStorage.getItem(C.KEY) || "null"); return Array.isArray(d && d.bets) ? d.bets.map(C.normalizeBet).filter(Boolean) : []; }
    catch (e) { return []; }
  }
  let BETS = load();
  function save() {
    try { localStorage.setItem(C.KEY, JSON.stringify({ v: 1, saved: new Date().toISOString(), bets: BETS })); return true; }
    catch (e) { toast("Couldn't save: this browser's storage is full or blocked."); return false; }
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
  let lastAuto = 0, autoBusy = false;
  async function fetchFinal(lg, id) {
    try {
      const d = await A().getJSON(`data/${lg}/games/${id}.json`);
      const g = d && d.game;
      if (g && g.state === "post" && g.completed && g.result && C.MMA.has(lg))   // UFC bout: winner 1/0 (draw / NC = 0-0 -> ML push), rounds elapsed for totals
        return { home: +g.home.score || 0, away: +g.away.score || 0, rounds: g.result.rounds, completed: true, status: g.statusDetail || "" };
      if (g && g.state === "post" && g.completed && !SOCCER.has(lg)) return { home: +g.home.score, away: +g.away.score, completed: true, status: g.statusDetail || "" };
    } catch (e) { /* not in the data window: ask ESPN */ }
    if (C.MMA.has(lg)) return null;   // ESPN's MMA summary has no scores: grade by hand once the bout leaves the data window
    const path = (A().LG[lg] || [])[0]; if (!path) return null;
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 10000);
    try {
      const r = await fetch(`https://site.web.api.espn.com/apis/site/v2/sports/${path}/summary?event=${encodeURIComponent(id)}`, { signal: ctl.signal, cache: "no-store" });
      if (!r.ok) return null;
      const c = (((await r.json()).header || {}).competitions || [])[0]; if (!c) return null;
      const st = (c.status || {}).type || {}, cs = c.competitors || [];
      const h = cs.find(x => x.homeAway === "home"), a = cs.find(x => x.homeAway === "away");
      if (!h || !a) return null;
      return { home: parseFloat(h.score), away: parseFloat(a.score), completed: !!st.completed, status: st.name || "" };
    } catch (e) { return null; } finally { clearTimeout(t); }
  }
  async function runAutoSettle(force) {
    if (autoBusy || (!force && Date.now() - lastAuto < 3 * 6e4)) return 0;
    const now = Date.now(), need = new Map();
    for (const b of BETS) for (const e of C.pendingEvents(b)) {
      if (e.date && Date.parse(e.date) > now - 2 * 3600e3) continue;  // not over yet
      need.set(`${e.league}:${e.id}`, e);
    }
    if (!need.size) return 0;
    autoBusy = true; lastAuto = now;
    try {
      const finals = {};
      await Promise.all([...need.entries()].map(async ([k, e]) => { const f = await fetchFinal(e.league, e.id); if (f) finals[k] = f; }));
      let n = 0;
      BETS = BETS.map(b => { const u = C.autoSettle(b, finals); if (u) { if (u.status !== "pending") n++; return u; } return b; });
      save();
      return n;
    } finally { autoBusy = false; }
  }

  // ---------- views
  let FILT = { range: "all", book: "", league: "", type: "" };
  let LISTF = "all";
  function shell(active, body) {
    const demo = isDemo() ? `<div class="bt-demo" role="note"><b>Example data</b> These are sample bets for screenshots only, not real wagers.</div>` : "";
    return `<div class="page-head bt-head"><div><h1>My Bets</h1><div class="sub">Private tracker · stored only on this device</div></div>
      <a class="bt-add" href="#/bets/add">+ Add bet</a></div>
      <nav class="seg bt-tabs" aria-label="My Bets sections"><a href="#/bets" class="${active === "ov" ? "on" : ""}">Overview</a><a href="#/bets/list" class="${active === "list" ? "on" : ""}">Bets${BETS.length ? ` <span class="na">${BETS.length}</span>` : ""}</a><a href="#/bets/add" class="${active === "add" ? "on" : ""}">Add</a></nav>
      ${demo}${body}`;
  }
  const privacyNote = `<div class="note bt-priv">Your bets are saved only in this browser on this device. They aren't uploaded, synced or linked to any sportsbook account (sportsbooks don't offer a public way to connect). Clearing browser data deletes them, so export a backup from time to time.</div>`;
  const rgNote = `<div class="note bt-rg">Tracking shows what betting really costs you over time. Set a budget you're comfortable losing, and take a break if it stops being fun. Gambling problem? Call <a href="tel:18004262537">1-800-GAMBLER</a>.</div>`;

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
  const statBox = (label, val, sub, c = "") => `<div class="stat"><span class="sl">${esc(label)}</span><b class="num ${c}">${val}</b>${sub ? `<span class="ss">${sub}</span>` : ""}</div>`;

  function viewOverview(app) {
    const list = C.filterBets(BETS, FILT), s = C.summarize(list);
    if (!BETS.length) {
      app.innerHTML = shell("ov", `<div class="empty bt-empty"><h3>No bets tracked yet</h3>Log a bet you've placed at any sportsbook to see your profit and loss, record and ROI over time.
        <div style="margin-top:16px"><a class="bt-add" href="#/bets/add">+ Add your first bet</a></div></div>${privacyNote}${dataCard()}${rgNote}`);
      wireData(app); return;
    }
    const rec = `${s.won}-${s.lost}-${s.push}`;
    let html = filterBar(BETS);
    html += `<div class="statgrid bt-stats">
      ${statBox("Profit / loss", money(s.net, true), `${s.settled} settled bet${s.settled === 1 ? "" : "s"}`, cls(s.net))}
      ${statBox("Record (W-L-P)", rec, s.cashout ? `${s.cashout} cashed out` : s.void ? `${s.void} void` : "&nbsp;")}
      ${statBox("Win rate", pct(s.winRate), "pushes excluded")}
      ${statBox("ROI", pct(s.roi, true), "profit ÷ staked", cls(s.roi))}
      ${statBox("Total staked", money(s.staked), "settled bets")}
      ${statBox("Pending", money(s.exposure), `${s.pending} open · to win ${money(s.toWinPending)}`)}
      ${statBox("Avg odds", s.avgOdds === null ? "—" : am(s.avgOdds), "average price")}
      ${statBox("Bets", String(s.n), FILT.range === "all" ? "all time" : esc({ "7d": "last 7 days", "30d": "last 30 days", season: "since Aug 1" }[FILT.range]))}</div>`;
    html += `<div class="section-title">Cumulative profit / loss</div><div class="card bt-chart"><div class="bt-plot"></div></div>`;
    const tbl = (title, rows, label) => `<div class="card"><h3>${esc(title)}</h3>${rows.length ? `<div class="tbl-wrap"><table class="bt-tbl"><thead><tr><th>${esc(label)}</th><th>Bets</th><th>W-L-P</th><th>Staked</th><th>P/L</th><th>ROI</th></tr></thead><tbody>${rows.map(r =>
      `<tr><td>${esc(r.name)}</td><td class="num">${r.n}</td><td class="num">${r.won}-${r.lost}-${r.push}</td><td class="num">${money(r.staked)}</td><td class="num ${cls(r.net)}">${money(r.net, true)}</td><td class="num ${cls(r.roi)}">${pct(r.roi, true)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="na">No bets in this filter.</div>`}</div>`;
    const byBook = C.groupBy(list, b => b.book).map(r => ({ ...r, name: r.key === "other" ? "Other" : C.BOOKS[r.key] || r.key }));
    const byLg = C.groupBy(list, b => (b.type === "parlay" ? "parlay" : b.league || "other")).map(r => ({ ...r, name: r.key === "parlay" ? "Parlays (multi)" : r.key === "other" ? "Other / manual" : lgName(r.key) }));
    const byType = C.groupBy(list, b => b.type).map(r => ({ ...r, name: C.TYPES[r.key] || r.key }));
    html += `<div class="section-title">Breakdown</div><div class="cols bt-cols">${tbl("By sportsbook", byBook, "Book")}${tbl("By league", byLg, "League")}</div><div class="cols bt-cols" style="margin-top:16px">${tbl("By bet type", byType, "Type")}${recentCard(list)}</div>`;
    html += privacyNote + dataCard() + rgNote;
    app.innerHTML = shell("ov", html);
    wireFilters(app, () => viewOverview(app));
    wireData(app);
    const plot = $(".bt-plot", app);
    const draw = () => { if (plot.isConnected) plot.innerHTML = chart(C.cumulative(list), Math.max(280, Math.floor(plot.clientWidth))); };
    draw();
    let rt; window.onresize = () => { clearTimeout(rt); rt = setTimeout(draw, 150); };
  }
  function recentCard(list) {
    const pend = list.filter(b => b.status === "pending").sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, 5);
    return `<div class="card"><h3>Open bets <a class="lnk bt-more" href="#/bets/list">See all ›</a></h3>${pend.length ? `<div class="bt-mini">${pend.map(b => `<a class="bt-mrow" href="#/bets/list" data-focus="${esc(b.id)}"><span><b>${esc(describe(b))}</b><span class="na">${esc(eventLabel(b) || bookName(b))}</span></span><span class="num">${money(b.stake)} <span class="na">@ ${esc(am(b.odds) || am(C.parlayAmerican(b.legs)))}</span></span></a>`).join("")}</div>` : `<div class="na">No open bets.</div>`}</div>`;
  }

  // lightweight SVG line chart (no library) — colours come from CSS custom properties via classes
  function chart(pts, w) {
    if (!pts.length) return `<div class="na bt-nochart">Settle a bet to start the chart.</div>`;
    const h = w < 500 ? 200 : 240, L = w < 500 ? 52 : 64, R = 14, T = 16, B = 28;
    const series = [{ t: pts[0].t, v: 0 }, ...pts];
    const vals = series.map(p => p.v);
    const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
    const raw = Math.max((hi - lo) / 4, 5), mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
    const stepV = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;   // "nice" gridline spacing
    let y0 = Math.floor(lo / stepV) * stepV, y1 = Math.ceil(hi / stepV) * stepV;
    if (y0 === lo && lo < 0) y0 -= stepV; if (y1 === hi && hi > 0) y1 += stepV; if (y1 === y0) y1 = y0 + stepV;
    const X = i => L + (i / Math.max(1, series.length - 1)) * (w - L - R), Y = v => T + (1 - (v - y0) / (y1 - y0)) * (h - T - B);
    let svg = `<svg class="bt-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Cumulative profit and loss over ${pts.length} settled bets">`;
    const tick = v => (v > 0 ? "+" : v < 0 ? "−" : "") + "$" + Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
    for (let v = y0; v <= y1 + 1e-9; v += stepV) { const y = Y(v); svg += `<line x1="${L}" x2="${w - R}" y1="${y}" y2="${y}" class="gl"/><text x="${L - 6}" y="${y + 4}" class="ax" text-anchor="end">${esc(tick(Math.round(v * 100) / 100))}</text>`; }
    svg += `<line x1="${L}" x2="${w - R}" y1="${Y(0)}" y2="${Y(0)}" class="zero"/>`;
    const d = series.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`).join("");
    svg += `<path d="${d}L${X(series.length - 1).toFixed(1)},${Y(0).toFixed(1)}L${X(0).toFixed(1)},${Y(0).toFixed(1)}Z" class="area"/><path d="${d}" class="ln"/>`;
    const step = Math.max(1, Math.ceil(series.length / 40));
    series.forEach((p, i) => { if (i && (i % step === 0 || i === series.length - 1)) svg += `<circle cx="${X(i)}" cy="${Y(p.v)}" r="3" class="pt ${p.net > 0 ? "w" : p.net < 0 ? "l" : ""}"><title>${esc(p.t)}: ${esc(money(p.net, true))} → ${esc(money(p.v, true))}</title></circle>`; });
    const fd = s => { const [y, m, dd] = String(s).split("-"); return y && m ? new Date(+y, m - 1, +dd || 1).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : s; };
    svg += `<text x="${L}" y="${h - 8}" class="ax">${esc(fd(series[0].t))}</text><text x="${w - R}" y="${h - 8}" class="ax" text-anchor="end">${esc(fd(series[series.length - 1].t))} · ${pts.length} settled</text>`;
    const last = series[series.length - 1];
    svg += `<circle cx="${X(series.length - 1)}" cy="${Y(last.v)}" r="5" class="end ${cls(last.v)}"/>`;
    return svg + "</svg>";
  }

  // ---------- bet list
  function betCard(b) {
    const net = C.netResult(b), pend = b.status === "pending";
    const price = isNum(b.odds) ? am(b.odds) : am(C.parlayAmerican(b.legs));
    const legs = b.type === "parlay" ? `<ol class="bt-legs">${(b.legs || []).map(l => `<li>${l.result && l.result !== "pending" ? badge(l.result) : ""}<b>${esc(describe(l))}</b> <span class="na">${esc([eventLabel(l), am(l.odds)].filter(Boolean).join(" · "))}</span></li>`).join("")}</ol>` : "";
    const fin = b.final ? ` · final ${esc(b.final.away)}-${esc(b.final.home)}` : "";
    const meta = [b.date, bookName(b), b.type === "parlay" ? null : lgName(b.league || ""), C.TYPES[b.type]].filter(Boolean).join(" · ");
    const res = pend ? `<span class="na">to win</span> <b>${money(C.toWin(b))}</b>` : b.status === "void" ? `<b class="na">stake returned</b>` : `<b class="${cls(net)}">${money(net, true)}</b>`;
    return `<article class="bt-card st-${esc(b.status)}" id="bet-${esc(b.id)}">
      <div class="bt-top">${badge(b.status)}${b.settledBy === "auto" && !pend ? `<span class="bt-auto" title="Settled automatically from the ESPN final score">auto${fin}</span>` : ""}<span class="bt-meta">${esc(meta)}</span></div>
      <div class="bt-main"><div class="bt-sel"><b>${esc(describe(b))}</b><span class="na">${esc(eventLabel(b))}</span></div>
        <div class="bt-px"><span class="oc"><b>${esc(price || "—")}</b><small>${money(b.stake)}</small></span></div></div>
      ${legs}${b.notes ? `<div class="bt-notes">${esc(b.notes)}</div>` : ""}
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
    html += `<div class="note">Moneyline, spread and total bets linked to a game settle automatically once ESPN posts the final score. Props, manual entries and anything else: tap Settle.</div>` + privacyNote;
    app.innerHTML = shell("list", html);
    wireFilters(app, () => viewList(app));
    app.querySelectorAll("[data-lf]").forEach(b => (b.onclick = () => { LISTF = b.dataset.lf; viewList(app); }));
    app.querySelectorAll("[data-del]").forEach(b => (b.onclick = () => {
      const bet = BETS.find(x => x.id === b.dataset.del); if (!bet) return;
      if (!confirm(`Delete "${describe(bet)}" (${money(bet.stake)})? This can't be undone.`)) return;
      BETS = BETS.filter(x => x.id !== bet.id); save(); viewList(app);
    }));
    app.querySelectorAll("[data-settle]").forEach(b => (b.onclick = () => settleDialog(b.dataset.settle, () => viewList(app))));
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
      if (b.type === "parlay") b.legs = b.legs.map((l, j) => ({ ...l, result: legsR[j] }));
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
      if (!confirm(`Delete all ${BETS.length} bets from this device? Export a backup first if you want to keep them.`)) return;
      BETS = []; save(); localStorage.removeItem(DEMO_KEY); view();
    };
  }
  function toast(msg) {
    let t = document.getElementById("btToast");
    if (!t) { t = document.createElement("div"); t.id = "btToast"; t.className = "bt-toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("on"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("on"), 3200);
  }

  // ---------- add / edit form
  const GAMES = {};
  async function gamesFor(lg) {
    if (GAMES[lg]) return GAMES[lg];
    try { const d = await A().getJSON(`data/${lg}/index.json`); return (GAMES[lg] = { kind: d.league.kind, games: d.games.slice().sort((a, b) => String(a.date).localeCompare(String(b.date))) }); }
    catch (e) { return (GAMES[lg] = { kind: "", games: [] }); }
  }
  const evOf = (g, lg) => ({ id: String(g.id), lg, date: g.date, name: `${g.away.abbr} @ ${g.home.abbr}`, home: { id: g.home.id, abbr: g.home.abbr, name: g.home.name, short: g.home.short }, away: { id: g.away.id, abbr: g.away.abbr, name: g.away.name, short: g.away.short } });
  // price for a market from the book the user picked (DraftKings via ESPN, Hard Rock / FanDuel via The Odds API); else ESPN's listed book
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
  const newLeg = lg => ({ league: lg || prefs().lg || "nfl", eventId: "", manual: false, eventText: "", mk: "ml", side: "", line: "", odds: "", selection: "" });

  let F = null; // form state
  async function viewForm(app, editId, qs) {
    const tok = A().nav();
    const ex = editId ? BETS.find(b => b.id === editId) : null;
    if (editId && !ex) { app.innerHTML = shell("add", `<div class="empty"><h3>Bet not found</h3>It may have been deleted. <a class="lnk" href="#/bets/list">Back to your bets</a></div>`); return; }
    const p = prefs();
    if (ex) {
      const toLeg = s => ({ league: s.league || (s.event && s.event.lg) || "nfl", eventId: s.event ? s.event.id : "", event: s.event || null, manual: !s.event, eventText: s.eventText || "", mk: s.type === "parlay" ? "ml" : s.type, side: s.side || "", line: s.line ?? "", odds: s.odds ?? "", selection: s.selection || "", result: s.result });
      F = { id: ex.id, book: ex.book, bookOther: ex.bookOther || "", type: ex.type, date: ex.date || today(), stake: ex.stake, odds: ex.odds ?? "", oddsManual: !!ex.oddsManual, notes: ex.notes || "",
        legs: ex.type === "parlay" ? ex.legs.map(l => ({ ...toLeg(l), mk: l.type || "ml" })) : [toLeg(ex)] };
    } else {
      F = { book: p.book || (window.LSGeo && window.LSGeo.defaultBetBook()) || "draftkings", bookOther: p.bookOther || "", type: "ml", date: today(), stake: p.stake || "", odds: "", oddsManual: false, notes: "", legs: [newLeg()] };
      if (qs && qs.get("lg")) {
        const leg = F.legs[0]; leg.league = qs.get("lg"); leg.eventId = qs.get("ev") || "";
        const mk = qs.get("mk"); if (C.TYPES[mk] && mk !== "parlay") { F.type = mk; leg.mk = mk; }
        if (qs.get("side")) leg.side = qs.get("side");
        if (isNum(qs.get("ln"))) leg.line = Number(qs.get("ln"));
        if (isNum(qs.get("od"))) { leg.odds = Number(qs.get("od")); F.odds = Number(qs.get("od")); }
        if (C.BOOKS[qs.get("bk")]) F.book = qs.get("bk");
      }
    }
    for (const l of F.legs) await gamesFor(l.league);
    if (tok !== A().nav()) return;
    for (const l of F.legs) if (l.eventId && !l.event) { const g = GAMES[l.league].games.find(x => String(x.id) === String(l.eventId)); if (g) l.event = evOf(g, l.league); else if (!ex) { l.eventId = ""; } }
    drawForm(app);
  }

  function legHtml(l, i, parlay) {
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
    h += `<div class="bt-lbl">League</div><div class="chips bt-scroll">${lgs.map(k => `<button type="button" class="chip${k === l.league ? " on" : ""}" data-a="lg" data-v="${k}">${esc(lgName(k))}</button>`).join("")}</div>`;
    h += `<label class="bt-f"><span class="bt-lbl">Game</span><select data-f="game"><option value="">${games.length ? "Choose a game…" : "No games in our data right now"}</option>${known ? `<option value="${esc(l.eventId)}" selected>${esc(l.event.name)}</option>` : ""}${games.map(x => `<option value="${esc(x.id)}"${String(x.id) === String(l.eventId) && !l.manual ? " selected" : ""}>${esc(dayOpt(x))}</option>`).join("")}<option value="__manual"${l.manual ? " selected" : ""}>Not listed: type it in</option></select></label>`;
    if (l.manual) h += `<label class="bt-f"><span class="bt-lbl">Event</span><input data-f="eventText" value="${esc(l.eventText)}" placeholder="e.g. Chiefs vs Bills, or UFC 310" autocomplete="off"></label>`;
    const linked = !l.manual && (g || l.event);
    if (linked && mk !== "prop" && mk !== "parlay") {
      const ev = g ? evOf(g, l.league) : l.event, q = quote(g, F.book);
      const sides = mk === "total" ? [["over", "Over"], ["under", "Under"]] : [["away", ev.away.short || ev.away.abbr], ["home", ev.home.short || ev.home.abbr]].concat(mk === "ml" && soccer ? [["draw", "Draw"]] : []);
      h += `<div class="bt-lbl">Pick</div><div class="bt-sides">${sides.map(([s, label]) => { const pr = priceFor(q, mk, s); const sub = mk === "ml" ? am(pr.odds) : mk === "spread" ? `${ln(pr.line)} ${am(pr.odds)}` : `${isNum(pr.line) ? pr.line : ""} ${am(pr.odds)}`;
        return `<button type="button" class="bt-side${l.side === s ? " on" : ""}" data-a="side" data-v="${s}"><b>${esc(label)}</b><small>${esc(sub.trim() || "—")}</small></button>`; }).join("")}</div>`;
      if (q) h += `<div class="bt-hint">Prices: ${esc(q.src)} from LineSmart's latest data. Check them against your bet slip.</div>`;
      if (mk === "spread" || mk === "total") h += `<label class="bt-f bt-half"><span class="bt-lbl">${mk === "total" ? "Total line" : "Spread line (your side)"}</span><input data-f="line" type="text" inputmode="decimal" value="${esc(l.line)}" placeholder="${mk === "total" ? "e.g. 44.5" : "e.g. -3.5"}"></label>`;
    } else {
      h += `<label class="bt-f"><span class="bt-lbl">Your pick</span><input data-f="selection" value="${esc(l.selection)}" placeholder="${mk === "prop" ? "e.g. Jalen Hurts over 1.5 pass TD" : "e.g. Eagles -3.5"}" autocomplete="off"></label>`;
    }
    if (parlay) h += `<label class="bt-f bt-half"><span class="bt-lbl">Leg odds</span><input data-f="odds" type="text" inputmode="numeric" value="${esc(l.odds)}" placeholder="-110"></label>`;
    return h + `</div>`;
  }

  function drawForm(app) {
    const parlay = F.type === "parlay";
    const combined = parlay ? C.parlayAmerican(F.legs.map(l => ({ odds: isNum(l.odds) ? Number(l.odds) : null }))) : null;
    let h = `<form class="bt-form" novalidate autocomplete="off"><h2 class="bt-fh">${F.id ? "Edit bet" : "Add a bet"}</h2>`;
    h += `<div class="bt-lbl">Sportsbook</div><div class="chips bt-books">${Object.entries(C.BOOKS).map(([k, n]) => `<button type="button" class="chip${F.book === k ? " on" : ""}" data-a="book" data-v="${k}">${esc(n)}</button>`).join("")}</div>`;
    if (F.book === "other") h += `<label class="bt-f"><span class="bt-lbl">Sportsbook name</span><input data-f="bookOther" value="${esc(F.bookOther)}" placeholder="e.g. BetMGM" autocomplete="off"></label>`;
    h += `<div class="bt-lbl">Bet type</div><div class="seg bt-types">${Object.entries(C.TYPES).map(([k, n]) => `<button type="button" data-a="type" data-v="${k}" class="${F.type === k ? "on" : ""}">${esc(k === "total" ? "Total" : k === "prop" ? "Prop" : n)}</button>`).join("")}</div>`;
    h += `<div class="bt-legs-ed">${F.legs.map((l, i) => legHtml(l, i, parlay)).join("")}</div>`;
    if (parlay) h += `<button type="button" class="chip bt-addleg" data-a="addleg">+ Add leg</button>
      <div class="bt-comb">Combined odds <b>${combined === null ? "—" : esc(am(combined))}</b> <span class="na">from ${F.legs.length} leg${F.legs.length > 1 ? "s" : ""}</span></div>
      <label class="bt-chk"><input type="checkbox" data-f="oddsManual"${F.oddsManual ? " checked" : ""}> Use the odds on my ticket instead (boosts, same-game parlays)</label>`;
    const showOdds = !parlay || F.oddsManual;
    h += `<div class="bt-row">${showOdds ? `<label class="bt-f"><span class="bt-lbl">Odds (American)</span><input data-f="odds" type="text" inputmode="numeric" value="${esc(F.odds)}" placeholder="-110 or +150"></label>` : ""}
      <label class="bt-f"><span class="bt-lbl">Stake ($)</span><input data-f="stake" type="number" inputmode="decimal" step="0.01" min="0" value="${esc(F.stake)}" placeholder="10.00"></label>
      <label class="bt-f"><span class="bt-lbl">Date placed</span><input data-f="date" type="date" value="${esc(F.date)}"></label></div>
      <div class="bt-towin" aria-live="polite"></div>
      <label class="bt-f"><span class="bt-lbl">Notes <span class="na">(optional)</span></span><input data-f="notes" value="${esc(F.notes)}" placeholder="e.g. bet ID, boost, reasoning" autocomplete="off"></label>
      <div class="bt-err" role="alert"></div>
      <div class="bt-actions"><a class="chip" href="${F.id ? "#/bets/list" : "#/bets"}">Cancel</a><button type="submit" class="bt-add">${F.id ? "Save changes" : "Save bet"}</button></div>
      <div class="note">Saved only on this device. ${F.type === "prop" || F.type === "parlay" ? "Props and parlays with prop or manual legs are settled by you from the Bets list." : "Moneyline, spread and total bets linked to a game settle automatically from ESPN final scores."}</div></form>`;
    app.innerHTML = shell("add", h);
    const form = $(".bt-form", app);
    updateToWin(form);
    form.addEventListener("click", e => {
      const b = e.target.closest("[data-a]"); if (!b) return;
      const legEl = b.closest("[data-leg]"), l = legEl ? F.legs[+legEl.dataset.leg] : F.legs[0], v = b.dataset.v;
      const a = b.dataset.a;
      if (a === "book") { F.book = v; refreshPrices(); }
      else if (a === "type") {
        const was = F.type; F.type = v;
        if (v === "parlay" && was !== "parlay") { F.legs.forEach(x => { x.mk = was === "parlay" ? x.mk : was; if (!isNum(x.odds) && isNum(F.odds)) x.odds = F.odds; }); if (F.legs.length < 2) F.legs.push(newLeg(F.legs[0].league)); F.odds = ""; }
        if (v !== "parlay") { F.legs = [F.legs[0]]; F.legs[0].mk = v; if (was === "parlay") F.odds = F.legs[0].odds; if (was !== v) { F.legs[0].side = ""; F.legs[0].line = ""; } }
      }
      else if (a === "mk") { l.mk = v; l.side = ""; l.line = ""; }
      else if (a === "lg") { l.league = v; l.eventId = ""; l.event = null; l.manual = false; l.side = ""; setPref("lg", v); return gamesFor(v).then(() => drawForm(app)); }
      else if (a === "side") { l.side = v; setPrice(l); }
      else if (a === "addleg") { F.legs.push(newLeg(F.legs[F.legs.length - 1].league)); }
      else if (a === "rmleg") { F.legs.splice(+legEl.dataset.leg, 1); }
      drawForm(app);
    });
    form.addEventListener("change", e => {
      const t = e.target, legEl = t.closest("[data-leg]"), l = legEl ? F.legs[+legEl.dataset.leg] : null;
      if (t.dataset.f === "game") {
        l.manual = t.value === "__manual"; l.eventId = l.manual ? "" : t.value; l.side = ""; l.line = "";
        const g = (GAMES[l.league].games || []).find(x => String(x.id) === l.eventId); l.event = g ? evOf(g, l.league) : null;
        drawForm(app);
      } else if (t.dataset.f === "oddsManual") { F.oddsManual = t.checked; drawForm(app); }
    });
    form.addEventListener("input", e => {
      const t = e.target, f = t.dataset.f; if (!f || f === "game" || f === "oddsManual") return;
      const legEl = t.closest("[data-leg]");
      if (legEl) { F.legs[+legEl.dataset.leg][f] = t.value; if (f === "odds" && F.type === "parlay") { const c = $(".bt-comb b", form), x = C.parlayAmerican(F.legs.map(l => ({ odds: isNum(l.odds) ? Number(l.odds) : null }))); if (c) c.textContent = x === null ? "—" : am(x); } }
      else F[f] = t.value;
      updateToWin(form);
    });
    form.addEventListener("submit", e => { e.preventDefault(); submit(form); });
    function setPrice(l) {
      const g = (GAMES[l.league].games || []).find(x => String(x.id) === String(l.eventId)); if (!g) return;
      const pr = priceFor(quote(g, F.book), F.type === "parlay" ? l.mk : F.type, l.side);
      if (isNum(pr.line)) l.line = pr.line;
      if (isNum(pr.odds)) { l.odds = pr.odds; if (F.type !== "parlay") F.odds = pr.odds; }
    }
    function refreshPrices() { F.legs.forEach(l => l.side && setPrice(l)); }
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
      if (linked && mk !== "prop") {
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
    const base = { id: F.id || C.uid(), createdAt: prev ? prev.createdAt : new Date().toISOString(), date: F.date || today(), book: F.book, bookOther: F.book === "other" ? F.bookOther.trim() : undefined,
      type: F.type, odds, stake: Math.round(stake * 100) / 100, notes: F.notes.trim() || undefined, status: prev ? prev.status : "pending" };
    if (prev) for (const k of ["settledAt", "settledBy", "manual", "cashout", "final"]) if (prev[k] !== undefined) base[k] = prev[k];
    let bet = parlay ? { ...base, legs, oddsManual: !!F.oddsManual, league: undefined } : { ...base, ...legs[0], type: F.type, odds };
    if (!parlay) delete bet.result;
    bet = C.normalizeBet(JSON.parse(JSON.stringify(bet)));
    // a changed selection on an auto-settled bet re-opens it so it can be graded again
    if (prev && prev.settledBy === "auto") Object.assign(bet, { status: "pending", settledAt: null, settledBy: null, final: null });
    BETS = prev ? BETS.map(b => (b.id === prev.id ? bet : b)) : [bet, ...BETS];
    if (!save()) return;
    setPref("book", F.book); if (F.book === "other") setPref("bookOther", F.bookOther.trim()); setPref("stake", F.stake);
    if (!prev && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    lastAuto = 0;
    toast(prev ? "Bet updated." : "Bet saved on this device.");
    location.hash = "#/bets/list";
  }

  // ---------- router entry (called by app.js)
  async function view() {
    const app = document.getElementById("app");
    const raw = location.hash.replace(/^#\/?/, ""), [path, query] = raw.split("?"), seg = path.split("/");
    A().renderTabs(null);
    window.onresize = null;
    BETS = load();
    if (seg[1] === "add") { window.scrollTo(0, 0); return viewForm(app, null, new URLSearchParams(query || "")); }
    if (seg[1] === "edit" && seg[2]) { window.scrollTo(0, 0); return viewForm(app, decodeURIComponent(seg[2])); }
    const render = () => (seg[1] === "list" ? viewList(app) : viewOverview(app));
    render();
    const tok = A().nav();
    const n = await runAutoSettle();
    if (n && tok === A().nav()) { render(); toast(`${n} bet${n > 1 ? "s" : ""} settled from final scores.`); }
  }
  /** "Track this bet" link for a game (and optionally a market) */
  function trackHref(lg, g, mk, side, book, pr) {
    const p = new URLSearchParams({ lg, ev: g.id });
    if (mk) p.set("mk", mk); if (side) p.set("side", side); if (book) p.set("bk", book);
    if (pr && isNum(pr.line)) p.set("ln", pr.line); if (pr && isNum(pr.odds)) p.set("od", pr.odds);
    return "#/bets/add?" + p.toString();
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
  window.LSBets = { view, trackHref, trackCard };
})();
