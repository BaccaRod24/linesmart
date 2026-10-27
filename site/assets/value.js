/* LineSmart Value finder UI (#/value, window.LSValue). Math: assets/value-core.js (window.ValueCore).
 * Reads only the data files the site already loads (data/<lg>/index.json, data/props/<lg>.json): no extra odds calls.
 * State-aware: only books legal in the visitor's state are listed as bettable (Florida: Hard Rock Bet only); every fresh book
 * still counts toward the consensus fair price. Informational only, never a guarantee. */
(function () {
  const V = window.ValueCore;
  const A = () => window.LSApp, G = () => window.LSGeo, B = () => window.LSBets;
  const esc = s => (A() ? A().esc(s) : String(s ?? ""));
  const BK = { draftkings: "DraftKings", hardrockbet: "Hard Rock Bet", fanduel: "FanDuel", betmgm: "BetMGM" };
  const BKS = { draftkings: "DK", hardrockbet: "HR", fanduel: "FD", betmgm: "MGM" };
  const MK = { all: "All", ml: "Moneyline", spread: "Spread", total: "Total", prop: "Player props" };
  const MINS = [[-2, "−2% (near fair)"], [0, "0% (beats fair)"], [1, "+1%"], [2, "+2%"], [3, "+3%"], [5, "+5%"]];
  const WIN = [[0, "Any time"], [24, "Next 24 h"], [72, "Next 3 days"]];
  const isNum = v => typeof v === "number" && isFinite(v);
  const am = v => (isNum(v) ? (v > 0 ? "+" + v : String(v)) : "—");
  const ePct = e => (isNum(e) ? (e > 0 ? "+" : e < 0 ? "−" : "") + Math.abs(100 * e).toFixed(1) + "%" : "—");
  const pct = p => (isNum(p) ? (100 * p).toFixed(1) + "%" : "—");
  const RG = `<span class="of-21">21+</span> Gambling problem? Call or text <a href="tel:18004262537">1-800-GAMBLER</a>. Florida: <a href="tel:18337529947">1-833-PLAYWISE</a>. <a href="responsible-gambling.html">Responsible gambling</a>`;

  let DATA = null, DATA_GEN = null;   // { rows, lines, suspect, games, gen, leagues, stale }
  async function loadAll() {
    const meta = A().meta();
    if (DATA && DATA_GEN === meta.generated) return DATA;
    const now = Date.now(), out = { rows: [], lines: [], suspect: 0, games: {}, gens: [], stale: [], leagues: new Set() };
    const order = meta.order || Object.keys(meta.leagues || {});
    await Promise.all(order.map(async lg => {
      const idx = await A().getJSON(`data/${lg}/index.json`).catch(() => null);
      if (!idx || !Array.isArray(idx.games)) return;
      const kind = (idx.league && idx.league.kind) || (A().LG[lg] || [])[1];
      if (idx.stale && idx.stale.asOf) out.stale.push(lg);
      if (idx.generated) out.gens.push(idx.generated);
      const hasProps = (meta.props || {})[lg];
      const pf = hasProps ? await A().getJSON(`data/props/${lg}.json`).catch(() => null) : null;
      for (const g of idx.games) {
        const r = V.gameRows(lg, kind, g, idx.generated, now);
        out.games[`${lg}:${g.id}`] = g;
        out.rows.push(...r.rows); out.lines.push(...r.lines); out.suspect += r.suspect;
        const pg = pf && pf.games && pf.games[g.id];
        if (pg) { const p = V.propRows(lg, kind, g, pg, pf.players, pf.markets, pf.gen, now); out.rows.push(...p.rows); out.suspect += p.suspect; }
      }
    }));
    DATA = out; DATA_GEN = meta.generated;
    return out;
  }

  function filters() {
    const q = new URLSearchParams((location.hash.split("?")[1]) || "");
    const n = (k, d) => (q.has(k) && isNum(Number(q.get(k))) ? Number(q.get(k)) : d);
    return { lg: q.get("lg") || "all", mk: MK[q.get("mk")] ? q.get("mk") : "all", minPct: n("min", 0), hours: n("h", 0) };
  }
  const href = f => { const p = new URLSearchParams(); if (f.lg !== "all") p.set("lg", f.lg); if (f.mk !== "all") p.set("mk", f.mk); if (f.minPct !== 0) p.set("min", f.minPct); if (f.hours !== 0) p.set("h", f.hours); const s = p.toString(); return "#/value" + (s ? "?" + s : ""); };

  /** what the visitor's state allows: { mode: "all"|"state"|"none", avail(bookKey), msg } */
  function stateInfo() {
    const g = G(), ev = g ? g.current() : null;
    const pick = `<button type="button" class="lnk of-change" data-state-pick>${ev && ev.state ? `Your state: <b>${esc(ev.state)}</b> · Change` : "Pick your state"}</button>`;
    if (!ev || ev.status === "unknown") return { mode: "all", avail: () => true, msg: `Showing every book we track. ${pick} to see only the sportsbooks you can legally use.` };
    if (ev.status === "ok") {
      const names = ev.available.filter(k => k !== "betmgm").map(k => BK[k] || k);
      const fl = ev.state === "FL";
      return { mode: "state", avail: k => g.isAvailable(k), fl, msg: fl
        ? `<b>Florida:</b> Hard Rock Bet is the only legal online sportsbook here, so only Hard Rock Bet prices are listed. DraftKings and FanDuel still count toward the fair price. ${pick}`
        : `Showing prices at books legal online in <b>${esc(ev.stateName)}</b>${names.length ? ` (${esc(names.join(", "))})` : ""}. Every book still counts toward the fair price. ${pick}` };
    }
    const why = ev.status === "notlegal" ? `Online sports betting isn't legal in ${esc(ev.stateName)}`
      : ev.status === "nobooks" ? `We don't list a sportsbook you can sign up for online in ${esc(ev.stateName)}`
      : "You appear to be outside the US";
    return { mode: "none", avail: () => false, msg: `${why}, so the Value finder has no bettable prices to show. ${pick}` };
  }

  function trackLink(r) {
    const L = B(); if (!L) return "";
    let h = "";
    if (r.mk === "prop") h = L.propHref ? L.propHref(r.lg, r.gid, r.pid, r.pmk, r.top.book, r.line, r.side) : "";
    else { const g = DATA.games[`${r.lg}:${r.gid}`]; h = g && L.cellHref ? L.cellHref(r.lg, g, r.top.book, r.mk, r.side) : ""; }
    return h ? `<a class="vf-trk" href="${esc(h)}" aria-label="${esc(`Track ${r.label} at ${BK[r.top.book] || r.top.book}`)}">+ Track</a>` : "";
  }

  function rowHtml(r, si) {
    const t = r.top, others = r.offers.slice(1);
    const when = `${A().fmt(r.date, { weekday: "short" })} ${A().timeET(r.date)}`;
    const nm = A().lgName(r.lg);
    const mkName = r.mk === "prop" ? r.market : MK[r.mk];
    const gHref = `#/g/${esc(r.lg)}/${esc(r.gid)}`;
    return `<article class="vf-row" data-lg="${esc(r.lg)}" data-mk="${esc(r.mk)}">
      <div class="vf-main"><div class="vf-tags"><span class="vs-lg">${esc(nm)}</span><span class="vf-mk">${esc(mkName)}</span>${t.out ? '<span class="lv-out" title="This book\'s price is at least 3 points of probability better than the other books">Outlier</span>' : ""}${t.best && r.offers.length > 1 ? '<span class="vf-best">Best price</span>' : ""}</div>
        <b class="vf-lbl">${esc(r.label)}</b>
        <a class="vf-game" href="${gHref}">${esc(r.matchup)} · ${esc(when)}</a>
        ${others.length ? `<span class="vf-also">Also: ${others.map(o => `${esc(BKS[o.book] || o.book)} ${esc(am(o.price))} <i class="${o.edge > 0 ? "pos" : ""}">${esc(ePct(o.edge))}</i>`).join(" · ")}</span>` : ""}
        ${r.hidden && si.mode === "state" ? `<span class="vf-also vf-hid">${r.hidden} more book${r.hidden > 1 ? "s" : ""} not legal in your state</span>` : ""}</div>
      <div class="vf-px"><small>${esc(BK[t.book] || t.book)}</small><b class="px">${esc(am(t.price))}</b></div>
      <div class="vf-fair"><small>Fair</small><b>${esc(am(r.fairAm))}</b><i>${esc(pct(r.fairP))} · ${r.n} books</i></div>
      <div class="vf-ev ${t.edge > 0 ? "pos" : t.edge < -0.01 ? "neg" : ""}"><small>EV</small><b>${esc(ePct(t.edge))}</b></div>
      <div class="vf-act">${si.mode === "none" ? "" : trackLink(r)}</div></article>`;
  }

  function lineHtml(x) {
    const when = `${A().fmt(x.date, { weekday: "short" })} ${A().timeET(x.date)}`;
    return `<a class="vs-row vs-line" href="#/g/${esc(x.lg)}/${esc(x.gid)}">
      <span class="vs-l"><span class="vs-lg">${esc(A().lgName(x.lg))}</span><b>${esc(x.label)}</b><small>${esc(x.matchup)} · ${esc(when)} · consensus ${esc(x.consLabel)}</small></span>
      <span class="vs-p"><b class="px">${esc(am(x.price))}</b><small>${esc(BKS[x.book] || x.book)}</small></span><span class="lv-out">${esc(x.gap)} pt${x.gap === 1 ? "" : "s"} better</span></a>`;
  }

  async function view() {
    const app = document.getElementById("app");
    A().renderTabs(null);
    window.scrollTo(0, 0);
    const tok = A().nav();
    app.innerHTML = `<div class="page-head"><div><h1>Value finder</h1><div class="sub">Prices that beat the no-vig market consensus</div></div></div><div class="card vf-loading"><span class="bt-spin" aria-hidden="true"></span> Comparing every book's prices…</div>`;
    let D;
    try { D = await loadAll(); } catch (e) { D = null; }
    if (tok !== A().nav()) return;
    if (!D) { app.innerHTML = `<div class="empty"><h3>Couldn't load odds</h3>Reload the page to try again.</div>`; return; }
    const f = filters(), si = stateInfo(), now = Date.now();
    const rowsSt = V.forState(D.rows, si.avail);
    const base = V.filterRows(rowsSt, { lg: "all", mk: "all", min: f.minPct / 100, hours: f.hours, outliers: true }, now);
    const rows = V.filterRows(rowsSt, { lg: f.lg, mk: f.mk, min: f.minPct / 100, hours: f.hours, outliers: true }, now);
    const lines = D.lines.filter(x => si.avail(x.book) && (f.lg === "all" || x.lg === f.lg) && (f.mk === "all" || x.mk === f.mk) && (!f.hours || Date.parse(x.date) - now <= f.hours * 3600e3))
      .sort((a, b) => b.gap - a.gap || Date.parse(a.date) - Date.parse(b.date)).slice(0, 12);
    const lgCount = {}; base.forEach(r => (lgCount[r.lg] = (lgCount[r.lg] || 0) + 1));
    const order = (A().meta().order || []).filter(lg => lgCount[lg] || lg === f.lg);
    const gen = D.gens.sort().pop();
    const lgChips = `<div class="chips vf-lgs bt-scroll" role="group" aria-label="Sport"><a class="chip ${f.lg === "all" ? "on" : ""}" href="${esc(href({ ...f, lg: "all" }))}">All <span class="na">${base.length}</span></a>${order.map(lg => `<a class="chip ${f.lg === lg ? "on" : ""}" href="${esc(href({ ...f, lg }))}">${esc(A().lgName(lg))} <span class="na">${lgCount[lg] || 0}</span></a>`).join("")}</div>`;
    const mkSeg = `<nav class="seg vf-mks" aria-label="Market">${Object.entries(MK).map(([k, v]) => `<a href="${esc(href({ ...f, mk: k }))}" class="${f.mk === k ? "on" : ""}">${esc(v)}</a>`).join("")}</nav>`;
    const sel = (id, label, opts, cur) => `<label class="vf-sel"><span>${label}</span><select id="${id}">${opts.map(([v, t]) => `<option value="${v}"${v === cur ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></label>`;
    const empty = si.mode === "none" ? "" : `<div class="empty vf-empty"><h3>No price beats the market${f.minPct > 0 ? ` by ${esc(f.minPct)}%+` : ""} right now</h3>${f.minPct > -2 ? `Books usually agree within their margin. <a class="lnk" href="${esc(href({ ...f, minPct: -2 }))}">Show prices within 2% of fair</a> or try a wider window.` : "Try another sport, market or time window."}</div>`;
    const nPos = rows.filter(r => r.top.edge > 0).length;
    app.innerHTML = `<div class="page-head"><div><span class="eyebrow">Odds tools</span><h1>Value finder</h1><div class="sub">Prices that beat the no-vig consensus of ${esc(V.MIN_BOOKS)}+ books${gen ? ` · odds from ${esc(A().fullET(gen))}` : ""}</div></div></div>
      <div class="vf-state card ${si.mode === "none" ? "vf-none" : ""}" role="note">${si.msg}</div>
      ${D.stale.length ? `<div class="stale-note" role="status"><b>Delayed data.</b> ${esc(D.stale.map(lg => A().lgName(lg)).join(", "))}: the latest refresh didn't load, so prices are from the last good update. Lines older than ${V.MAX_AGE_H} hours are left out.</div>` : ""}
      <section class="card vf-filters" aria-label="Filters">${lgChips}<div class="vf-frow">${mkSeg}${sel("vfMin", "Min EV", MINS, f.minPct)}${sel("vfWin", "Starts", WIN, f.hours)}</div></section>
      ${si.mode === "none" ? "" : `<div class="vf-count" role="status">${rows.length ? `<b>${rows.length}</b> price${rows.length > 1 ? "s" : ""}${nPos ? ` · <b class="pos">${nPos}</b> beat${nPos > 1 ? "" : "s"} the fair price` : ""} · sorted by EV` : ""}</div>`}
      <div class="vf-list">${si.mode === "none" ? "" : rows.length ? rows.slice(0, 80).map(r => rowHtml(r, si)).join("") : empty}</div>
      ${si.mode !== "none" && lines.length ? `<section class="card vspots vf-lines"><div class="vs-head"><h3>Off-consensus lines</h3><span class="st-sub">one book hangs a better number than the rest</span></div><div class="vs-list">${lines.map(lineHtml).join("")}</div><div class="note">A spread or total ${esc(window.AdvCore.LINE_GAP_DEFAULT)}+ (hockey, baseball, soccer) or ${esc(window.AdvCore.LINE_GAP.football)}+ points (football, basketball) off the consensus line. No EV is shown because the line itself differs; these are the most likely to be stale or about to move, so check the book first.</div></section>` : ""}
      <section class="card vf-how"><h3>How this works</h3>
        <ul><li><b>Fair price.</b> For each market we take every book hanging the same line (at least ${esc(V.MIN_BOOKS)}: Hard Rock Bet, DraftKings, FanDuel), remove each book's margin proportionally, and average. That no-vig consensus is the "fair" probability.</li>
        <li><b>EV</b> = fair probability × decimal odds − 1: the average return per $1 <i>if</i> the consensus is right. +2% means $0.02 per $1 over many bets, not on this one.</li>
        <li><b>Outlier</b> = a price at least 3 points of probability better than the other books. Outliers are listed even up to ${esc(-100 * V.OUTLIER_FLOOR)}% below fair, because with three books the outlier pulls the consensus toward itself. <b>Best price</b> = the best of the books shown.</li>
        <li><b>Left out:</b> games that have started, prices older than ${esc(V.MAX_AGE_H)} hours, markets with a margin under ${esc(-100 * V.HOLD_MIN)}% or over ${esc(100 * V.HOLD_MAX)}%, long shots past +${esc(V.MAX_PRICE)}, one-sided props (anytime TD, ladders), and anything more than ${esc(100 * V.MAX_EDGE)}% over fair, which is almost always a stale or mistyped line${D.suspect ? ` (${D.suspect} hidden right now)` : ""}. UFC odds come from DraftKings only, so there's no consensus to compare.</li>
        <li>Odds refresh about every 30 minutes and move constantly. Always confirm the price at the sportsbook before you bet.</li></ul>
        <p class="vf-disc"><b>Not a guarantee.</b> A price that beats the consensus can still lose, and most bets do. This is information, not a tip or a prediction. Only bet what you can afford to lose.</p>
        <p class="of-rg">${RG}</p></section>`;
    const go = patch => { location.hash = href({ ...filters(), ...patch }); };
    const m = document.getElementById("vfMin"); if (m) m.onchange = () => go({ minPct: Number(m.value) });
    const w = document.getElementById("vfWin"); if (w) w.onchange = () => go({ hours: Number(w.value) });
  }

  /** Home page "Top value" link for the Value spots card. */
  const link = (label = "See all in Value finder ›") => `<a class="lnk vf-more" href="#/value">${esc(label)}</a>`;

  window.LSValue = { view, link, _data: () => DATA, _reset: () => { DATA = null; DATA_GEN = null; } };
})();
