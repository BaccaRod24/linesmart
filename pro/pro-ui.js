/* LineSmart Pro screens. Loaded only after is_pro() is true, from the private bundle.
   Numbers come from the files the site already has. Missing data is a coming-soon note. */
(function () {
  "use strict";
  const css = window.__PRO_CSS || "";
  if (css && !document.getElementById("pro-owner-css")) {
    const st = document.createElement("style");
    st.id = "pro-owner-css";
    st.textContent = css;
    document.head.appendChild(st);
  }
  const A = () => window.LSApp;
  const G = () => window.LSGeo;
  const F = () => window.ProFeatures;
  const Hp = () => window.HotProps;
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const isNum = v => typeof v === "number" && isFinite(v);
  const num = v => (v == null || v === "" || !isFinite(Number(v)) ? null : Number(v));
  const sgn = v => (v > 0 ? "+" + v : v === 0 ? "PK" : String(v));
  const am = v => { const n = num(v); return n == null ? "—" : n > 0 ? "+" + n : String(n); };
  const money = (v, sign) => { if (!isFinite(v)) return "—"; const n = Math.abs(v).toFixed(2); return (v < -0.004 ? "−" : sign && v > 0.004 ? "+" : "") + "$" + n; };
  const pct = v => (v == null || !isFinite(v) ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v * 100).toFixed(1) + "%");
  const ePct = e => (isNum(e) ? (e > 0 ? "+" : e < 0 ? "−" : "") + Math.abs(100 * e).toFixed(1) + "%" : "—");
  const cls = v => (v > 0.004 ? "pos" : v < -0.004 ? "neg" : "");
  const SOON = `<span class="ppv-soon">Coming soon</span>`;
  const PROP_LEAGUES = ["nfl", "nba", "nhl", "mlb", "ncaaf", "ncaab", "ufc", "epl", "mls", "ucl"];
  const SCREEN = { props_ev: "value", alerts_25: "alerts", tracker_pro: "tracker", books_10: "books", line_history: "history", fast_refresh: "refresh" };
  const HINT = {
    props_ev: "Consensus edges and filters on the lines in the file. Prop edges appear only when the file can support them.",
    alerts_25: "Sharp-move flags from saved line movement. A higher daily email limit is not on yet.",
    tracker_pro: "Stats from My Bets on this device, plus tags kept in this browser. Closing-line value needs a closing price.",
    books_10: "Every book that posted a number in the file. Books with no feed are listed as coming soon.",
    line_history: "The same line chart as a game page, and the sharp-move flags already on the slate.",
    fast_refresh: "How old this file is. A faster pull is not running.",
  };

  let keepScroll = false, afterPaint = () => {}, IX = null, PROPS = null, ALERTS = null;

  const parts = () => {
    const raw = location.hash.replace(/^#\/?/, "");
    const [path, qs] = raw.split("?");
    const segs = path.split("/");
    return { screen: segs[1] || "", a: segs[2] || "", b: segs[3] || "", q: new URLSearchParams(qs || "") };
  };
  const href = (screen, extra) => "#/owner" + (screen ? "/" + screen : "") + (extra || "");
  const gameHref = (lg, id) => `${href("history")}/${esc(lg)}/${esc(id)}`;
  function hotState() {
    const q = parts().q;
    return { lg: q.get("lg") || "nfl", team: q.get("team") || "", player: q.get("player") || "", mk: q.get("mk") || "all" };
  }
  function hotHash(patch) {
    const n = { ...hotState(), ...patch };
    const p = new URLSearchParams();
    if (n.lg) p.set("lg", n.lg);
    if (n.team) p.set("team", n.team);
    if (n.player) p.set("player", n.player);
    if (n.mk && n.mk !== "all") p.set("mk", n.mk);
    const s = p.toString();
    return href("hot") + (s ? "?" + s : "");
  }
  function localStore() {
    try { const k = "ls-pro-probe"; localStorage.setItem(k, "1"); localStorage.removeItem(k); return localStorage; }
    catch (e) { return null; }
  }
  function bookBits(key) {
    const g = G();
    if (!g) return { label: "" };
    const label = g.naLabel ? g.naLabel(key) : "";
    return { label: label || "" };
  }
  const bookName = key => `${esc((F().BOOK_NAME)[key] || key)}${bookBits(key).label ? ` <span class="na-st">${esc(bookBits(key).label)}</span>` : ""}`;
  const flNote = () => `<p class="note"><b>Florida:</b> Hard Rock Bet is the only legal online sportsbook there. DraftKings and FanDuel are not available in Florida.</p>`;

  async function indexes() {
    if (IX) return IX;
    const meta = A().meta() || {};
    const order = meta.order || Object.keys(meta.leagues || {});
    const rows = await Promise.all(order.map(async lg => [lg, await A().getJSON(`data/${lg}/index.json`).catch(() => null)]));
    IX = { meta, order, by: Object.fromEntries(rows.filter(([, idx]) => idx && Array.isArray(idx.games))) };
    return IX;
  }
  const gamesOf = idx => (idx && idx.games) || [];
  const future = (idx, now) => gamesOf(idx).filter(g => g.state === "pre" && Date.parse(g.date) > now);

  function banner() {
    return `<div class="ppv-banner" role="status"><b>LineSmart Pro</b><span>Your account only. No payment. Not linked from the public site.</span></div>`;
  }
  const labelOf = k => { const row = ((window.ProCore && window.ProCore.FEATURES) || []).find(x => x[0] === k); return row ? row[1] : k; };
  function head(screen, title, sub) {
    return `<div class="page-head ppv-head"><div>${screen ? `<a class="lnk ppv-back" href="${href()}">Pro</a>` : `<span class="eyebrow">Owner</span>`}<h1>${esc(title)}</h1><div class="sub">${esc(sub)}</div></div></div>`;
  }
  function fine() {
    const rg = G() && G().rgSpan ? G().rgSpan() : `Call or text <a href="tel:18004262537">1-800-GAMBLER</a>.`;
    return `<p class="of-rg"><span class="of-21">21+</span> LineSmart is for adults 21 and older. Gambling problem? ${rg} <a href="responsible-gambling.html">Responsible gambling</a></p>
      <p class="note">Pro is data and software: odds comparison, line history, alerts and a bet tracker. It doesn't include picks or predictions, and nothing here can promise that a bet wins. Most bets lose. LineSmart doesn't take bets. Always confirm the price at the sportsbook.</p>`;
  }
  function crumbs(screen) {
    const items = [["", "Overview"], ["value", "Value"], ["alerts", "Alerts"], ["tracker", "My Bets"], ["books", "Books"], ["history", "Line history"], ["refresh", "Refresh"], ["hot", "Hot props"]];
    return `<nav class="chips ppv-nav" aria-label="Pro">${items.map(([id, label]) => `<a class="chip${id === screen ? " on" : ""}" href="${href(id)}">${esc(label)}</a>`).join("")}</nav>`;
  }
  const shell = (screen, title, sub, body) => `<div class="ppv ppv-ready" data-pro-owner data-screen="${esc(screen)}">${banner()}${head(screen, title, sub)}${crumbs(screen)}${body}${fine()}</div>`;

  function buildLine() {
    const build = window.__PRO_BUILD || "unknown";
    const site = (window.ProGateCore && window.ProGateCore.SITE_BUILD) || "unknown";
    return `<p class="ppv-build">Pro build ${esc(build)} · site ${esc(site)}</p>`;
  }
  function home() {
    const cards = ((window.ProCore && window.ProCore.FEATURES) || []).map(([k, label]) => `<a class="ppv-card" href="${href(SCREEN[k])}"><span class="pro-pill">Pro</span><b>${esc(label)}</b><span>${esc(HINT[k] || "")}</span><span class="ppv-go">Open</span></a>`).join("")
      + `<a class="ppv-card" href="${href("hot")}"><span class="pro-pill">Pro</span><b>Hot props</b><span>Same-line price gaps, prop line moves, and hot streaks, only from props files the site has. Saved filters stay in this browser.</span><span class="ppv-go">Open</span></a>`;
    const offers = G() && G().offersHTML ? G().offersHTML("pro") : "";
    return shell("", "LineSmart Pro", "Tools on top of the lines already on the site. The public waitlist is unchanged.",
      `${buildLine()}${flNote()}<div class="ppv-grid">${cards}</div>
      <section class="card"><h3>What is on, and what isn't</h3>
        <p>Sharp-move flags, line charts, game lines, My Bets stats, and hot props use the data files. Email above the free daily limit, extra sportsbooks, a faster odds pull, prop history, game logs, and closing-line value show a coming-soon note when the file doesn't have them. No payment and no new email from this page.</p>
        <p>The public site still has the waitlist at <a href="#/pro">#/pro</a>.</p></section>
      ${offers}`);
  }

  function lineRows(lg, g) {
    const out = [];
    const away = g.away.abbr, home = g.home.abbr;
    for (const bk of F().bookColumns(g)) {
      const o = g.books[bk];
      const base = { lg, gid: String(g.id), matchup: `${away} @ ${home}`, date: g.date, book: bk };
      if (isNum(o.awaySpread)) out.push({ ...base, mk: "spread", label: `${away} ${sgn(o.awaySpread)}`, price: o.awaySpreadOdds });
      if (isNum(o.homeSpread)) out.push({ ...base, mk: "spread", label: `${home} ${sgn(o.homeSpread)}`, price: o.homeSpreadOdds });
      if (isNum(o.awayML)) out.push({ ...base, mk: "ml", label: `${away} ML`, price: o.awayML });
      if (isNum(o.homeML)) out.push({ ...base, mk: "ml", label: `${home} ML`, price: o.homeML });
      if (isNum(o.total)) {
        out.push({ ...base, mk: "total", label: `Over ${o.total}`, price: o.overOdds });
        out.push({ ...base, mk: "total", label: `Under ${o.total}`, price: o.underOdds });
      }
    }
    return out;
  }
  function realEdges(by, now) {
    const V = window.ValueCore;
    if (!V) return [];
    const rows = [];
    for (const [lg, idx] of Object.entries(by)) {
      const kind = idx.league.kind, fileNow = Date.parse(idx.generated) || now;
      for (const g of idx.games || []) {
        if (g.state !== "pre" || Date.parse(g.date) <= now) continue;
        const r = V.gameRows(lg, kind, g, idx.generated, fileNow);
        rows.push(...r.rows);
      }
    }
    const si = G() && G().isAvailable ? G().isAvailable.bind(G()) : () => true;
    return V.forState(rows, si);
  }
  async function propsDocs() {
    if (PROPS) return PROPS;
    const pairs = await Promise.all(PROP_LEAGUES.map(async lg => {
      try { return [lg, await A().getJSON(`data/props/${lg}.json`)]; }
      catch (e) { return [lg, null]; }
    }));
    PROPS = Object.fromEntries(pairs.filter(([, d]) => d && d.games));
    return PROPS;
  }
  async function propEdges(by, now) {
    const V = window.ValueCore;
    const docs = await propsDocs();
    if (!V || !Object.keys(docs).length) return { available: false, rows: [] };
    const rows = [];
    for (const [lg, doc] of Object.entries(docs)) {
      const idx = by[lg];
      if (!idx) continue;
      const kind = idx.league.kind, fileNow = Date.parse(doc.gen) || now;
      for (const g of idx.games || []) {
        const pg = doc.games[String(g.id)];
        if (!pg) continue;
        const r = V.propRows(lg, kind, g, pg, doc.players, doc.markets, doc.gen, fileNow);
        rows.push(...r.rows);
      }
    }
    if (!rows.length) return { available: false, rows: [] };
    const si = G() && G().isAvailable ? G().isAvailable.bind(G()) : () => true;
    return { available: true, rows: V.forState(rows, si) };
  }
  function vq() {
    const q = parts().q;
    const min = num(q.get("min"));
    const mk = q.get("mk");
    return { lg: q.get("lg") || "all", mk: ["all", "ml", "spread", "total", "prop"].includes(mk) ? mk : "all", min: min == null ? 0 : min, q: (q.get("q") || "").trim() };
  }
  const vHref = patch => {
    const f = { ...vq(), ...patch };
    const p = new URLSearchParams();
    if (f.lg !== "all") p.set("lg", f.lg);
    if (f.mk !== "all") p.set("mk", f.mk);
    if (f.min) p.set("min", String(f.min));
    if (f.q) p.set("q", f.q);
    const s = p.toString();
    return href("value") + (s ? "?" + s : "");
  };
  async function viewValue() {
    const now = Date.now(), { by, order, meta } = await indexes(), f = vq();
    const edges = realEdges(by, now);
    const shownE = window.ValueCore.filterRows(edges, { lg: f.lg, mk: f.mk === "prop" ? "none" : f.mk, min: f.min / 100, hours: 0, outliers: true }, now);
    let lines = [];
    for (const lg of order) if (by[lg]) for (const g of future(by[lg], now)) lines.push(...lineRows(lg, g));
    lines = F().filterBoard(lines, f);
    const props = await propEdges(by, now);
    const propRows = props.available ? F().filterBoard(props.rows.map(r => ({ ...r, edge: r.top && r.top.edge })), { ...f, mk: f.mk === "all" ? "prop" : f.mk }).filter(r => f.mk === "all" || f.mk === "prop") : [];
    const leagues = order.filter(lg => future(by[lg], now).length);
    const chips = `<div class="chips">${[["all", "All"], ...leagues.map(lg => [lg, A().lgName(lg)])].map(([k, t]) => `<a class="chip${f.lg === k ? " on" : ""}" href="${esc(vHref({ lg: k }))}">${esc(t)}</a>`).join("")}</div>`;
    const mks = [["all", "All"], ["ml", "Moneyline"], ["spread", "Spread"], ["total", "Total"], ["prop", "Player props"]];
    const seg = `<nav class="seg" aria-label="Market">${mks.map(([k, t]) => `<a href="${esc(vHref({ mk: k }))}" class="${f.mk === k ? "on" : ""}">${esc(t)}</a>`).join("")}</nav>`;
    const mins = [[-2, "−2%"], [0, "0%"], [1, "+1%"], [2, "+2%"], [3, "+3%"]];
    const edgeHtml = shownE.length ? `<div class="ppv-list">${shownE.slice(0, 12).map(r => `<a class="ppv-line" href="${gameHref(r.lg, r.gid)}"><span><span class="vs-lg">${esc(A().lgName(r.lg))}</span> <b>${esc(r.label)}</b><small>${esc(r.matchup)}</small></span><span class="num ${cls(r.top.edge)}"><b>${esc(ePct(r.top.edge))}</b><small>${bookName(r.top.book)}</small></span></a>`).join("")}</div>`
      : `<p class="na">No consensus edge in this file for these filters. That math needs three books on the same line.</p>`;
    const lineHtml = f.mk === "prop" ? "" : `<h3 class="ppv-h">Game lines in the file <span class="st-sub">${lines.length} match</span></h3>
      ${lines.length ? `<div class="ppv-list">${lines.slice(0, 12).map(r => `<a class="ppv-line" href="${gameHref(r.lg, r.gid)}"><span><span class="vs-lg">${esc(A().lgName(r.lg))}</span> <b>${esc(r.label)}</b><small>${esc(r.matchup)}</small></span><span class="num"><b class="px">${esc(am(r.price))}</b><small>${bookName(r.book)}</small></span></a>`).join("")}</div>` : `<p class="na">No line in the file matches these filters.</p>`}
      <p class="note">Prices are the ones stored in the data file${meta.generated ? ` (as of ${esc(A().fullET(meta.generated))})` : ""}. A single book is not a consensus, so these rows are the line, not an edge.</p>`;
    const propHtml = props.available
      ? `<h3 class="ppv-h">Props edges <span class="st-sub">${propRows.length} match</span></h3>${propRows.length ? `<div class="ppv-list">${propRows.slice(0, 12).map(r => `<div class="ppv-line"><span><span class="vs-lg">${esc(A().lgName(r.lg))}</span> <b>${esc(r.label)}</b><small>${esc(r.matchup)}</small></span><span class="num ${cls(r.top.edge)}"><b>${esc(ePct(r.top.edge))}</b><small>${bookName(r.top.book)}</small></span></div>`).join("")}</div>` : `<p class="na">No prop edge clears this filter.</p>`}<p class="note">An edge compares prices in the file. It is not a suggestion to bet.</p>`
      : `<h3 class="ppv-h">Props edges ${SOON}</h3><p>This copy doesn't have three books on the same prop line, so there is no prop edge to show.</p>`;
    return shell("value", "Value finder extras", labelOf("props_ev"),
      `${flNote()}<section class="card vf-filters" aria-label="Custom filters">${chips}<div class="ppv-frow">${seg}<form class="ppv-q" id="ppvQ"><label>Search <input name="q" value="${esc(f.q)}" maxlength="40" aria-label="Search lines"></label><button type="submit" class="chip">Filter</button></form>
        <label class="vf-sel"><span>Min edge</span><select id="ppvMin" aria-label="Minimum edge">${mins.map(([v, t]) => `<option value="${v}"${v === f.min ? " selected" : ""}>${t}</option>`).join("")}</select></label></div></section>
      <section class="card"><h3 class="ppv-h">Consensus edges <span class="st-sub">Value finder math</span></h3>${edgeHtml}</section>
      ${f.mk === "prop" ? "" : `<section class="card">${lineHtml}</section>`}
      <section class="card">${propHtml}</section>`);
  }

  function notable(by, now) {
    const map = {};
    for (const [lg, idx] of Object.entries(by)) map[lg] = gamesOf(idx);
    return F().sharpMoves(map, now).map(row => {
      const g = (by[row.lg].games || []).find(x => String(x.id) === row.id);
      return { ...row, g, kind: by[row.lg].league.kind };
    }).filter(x => x.g);
  }
  async function loadAlerts() {
    if (ALERTS) return ALERTS;
    const AC = window.AcctCore, GC = window.ProGateCore;
    const tok = GC.tokenOf((() => { try { return localStorage.getItem(AC.AUTH_KEY); } catch (e) { return ""; } })());
    if (!tok) { ALERTS = []; return ALERTS; }
    try {
      const res = await fetch(AC.SB_URL + "/rest/v1/line_alerts?select=*&order=created_at.desc&limit=50", {
        headers: { apikey: AC.SB_KEY, Authorization: "Bearer " + tok, Accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) { ALERTS = []; return ALERTS; }
      const body = await res.json();
      ALERTS = Array.isArray(body) ? body : [];
    } catch (e) { ALERTS = []; }
    return ALERTS;
  }
  async function viewAlerts() {
    const now = Date.now(), { by } = await indexes(), flags = notable(by, now);
    const mine = await loadAlerts();
    const C = window.AlertsCore;
    const active = mine.filter(a => C.status(a, now).key === "active").length;
    const cap = F().ACTIVE_PRO;
    const rows = flags.slice(0, 12).map(item => `<a class="ppv-line" href="${gameHref(item.lg, item.id)}"><span><span class="vs-lg">${esc(A().lgName(item.lg))}</span> <b>${esc(item.g.away.abbr)} @ ${esc(item.g.home.abbr)}</b><small>${item.notes.map(esc).join(" · ")}</small></span><span class="mvbadge">Sharp move</span></a>`).join("");
    const list = mine.length ? `<ul class="ppv-ul">${mine.slice(0, 25).map(a => `<li><b>${esc(C.describe(a))}</b><span>${esc(a.game_label || "")} · ${esc(C.status(a, now).text)}</span></li>`).join("")}</ul>` : `<p class="na">No line alerts on this account yet. The bell on a game still saves one, up to the cap.</p>`;
    return shell("alerts", "Line alerts", labelOf("alerts_25"),
      `${flNote()}<section class="card ppv-cap"><div class="ppv-cap-row"><b>${active} of ${cap}</b><span>active alerts for this account · free accounts stay at ${F().ACTIVE_FREE}</span></div>
        <div class="ppv-meter" aria-hidden="true"><i style="width:${Math.min(100, active / cap * 100)}%"></i></div>
        <p class="note">The server allows ${cap} active alerts on an owner account after the migration. Emails still stop at ${F().EMAIL_FREE} a day. This page does not send email.</p></section>
      <section class="card"><h3 class="ppv-h">Sharp-move flags <span class="st-sub">${flags.length} upcoming</span></h3>${rows || `<p class="na">No sharp-move flag on an upcoming game in this file.</p>`}
        <p class="note">A flag is the rule the site already uses on the slate: a large spread move, a key number crossed, or a total that moved past the sport's bar. It describes the saved line. It is not a pick.</p></section>
      <section class="card"><h3 class="ppv-h">Your alerts</h3>${list}</section>
      <section class="card"><h3 class="ppv-h">Email above ${F().EMAIL_FREE} a day ${SOON}</h3>
        <p>The free line-alert email still sends, up to ${F().EMAIL_FREE} a day, from alerts you save with the bell. A higher daily email limit is not turned on. Nothing on this page sends a message.</p></section>`);
  }

  function loadBets() {
    if (window.LSBets && window.LSBets.syncState) return window.LSBets.syncState().bets || [];
    try {
      const d = JSON.parse(localStorage.getItem(window.BetCore.KEY) || "null");
      const list = Array.isArray(d && d.bets) ? d.bets : [];
      return list.map(window.BetCore.normalizeBet).filter(Boolean);
    } catch (e) { return []; }
  }
  function betLabel(b) {
    const ev = b.event && (b.event.name || [b.event.away, b.event.home].filter(Boolean).join(" @ "));
    return ev || b.eventText || b.selection || b.type || "Bet";
  }
  async function viewTracker() {
    const bets = loadBets();
    const store = localStore();
    const tags = store ? F().readTags(store) : {};
    const tag = (parts().q.get("tag") || "all").toLowerCase();
    const names = [...new Set(Object.values(tags).flat())].sort();
    const shown = bets.filter(b => tag === "all" || (tags[b.id] || []).includes(tag));
    const stats = window.BetCore.stats(shown);
    const anyClose = shown.some(b => F().clvPoints(b, b.closeLine).available);
    const chips = ["all", ...names].map(t => `<a class="chip${tag === t ? " on" : ""}" href="${href("tracker")}${t === "all" ? "" : "?tag=" + encodeURIComponent(t)}">${esc(t === "all" ? "All tags" : t)}</a>`).join("");
    const box = (k, v, sub, c) => `<div class="stat"><span class="sl">${esc(k)}</span><b class="num ${c || ""}">${v}</b>${sub ? `<span class="ss">${sub}</span>` : ""}</div>`;
    const rec = `${stats.won}-${stats.lost}-${stats.push}`;
    const table = shown.length ? `<div class="tbl-wrap"><table class="books ppv-bets"><thead><tr><th>Bet</th><th>Status</th><th>Stake</th><th>Net</th><th>CLV</th><th>Tags</th></tr></thead><tbody>${shown.slice(0, 20).map(b => {
      const net = window.BetCore.netResult(b);
      const clv = F().clvPoints(b, b.closeLine);
      const mine = tags[b.id] || [];
      return `<tr><td>${esc(betLabel(b))}<small class="na"> ${esc(b.date || "")}</small></td><td>${esc(b.status || "pending")}</td><td class="num">${esc(money(Number(b.stake) || 0))}</td><td class="num ${cls(net)}">${esc(money(net, true))}</td><td class="num">${clv.available ? esc((clv.delta > 0 ? "+" : "") + clv.delta) : "—"}</td><td>${mine.map(t => `<span class="chip">${esc(t)}</span>`).join(" ")}${store ? `<form class="ppv-form" data-ppv-tag="${esc(b.id)}"><input name="tag" maxlength="24" aria-label="Tag" placeholder="Tag"><button type="submit" class="chip">Add</button></form>` : ""}</td></tr>`;
    }).join("")}</tbody></table></div>` : `<p class="na">${bets.length ? "No bet has that tag." : "No bets saved on this device. Stats use My Bets. Add a bet there and it shows up here."}</p>`;
    const clvNote = anyClose ? "" : `<section class="card"><h3 class="ppv-h">Closing-line value ${SOON}</h3><p>Finished games in this copy don't include a closing price matched to a bet, so CLV isn't shown. No number is filled in for it.</p></section>`;
    return shell("tracker", "My Bets extras", labelOf("tracker_pro"),
      `<div class="statgrid bt-stats">${box("Net", money(stats.net, true), "from My Bets", cls(stats.net))}${box("ROI", pct(stats.roi), "", cls(stats.roi || 0))}${box("Record", rec, `${stats.n} bets`)}${box("Win rate", stats.winRate == null ? "—" : (stats.winRate * 100).toFixed(0) + "%", "pushes excluded")}</div>
      <div class="chips ppv-tags" role="group" aria-label="Tags">${chips || `<span class="na">No tags yet.</span>`}</div>
      <section class="card">${table}<p class="note">Tags stay in this browser. They are not sent to an account, and they don't turn Pro on.</p></section>
      ${clvNote}`);
  }

  function cell(g, key, label, line, price) {
    const o = g.books && g.books[key];
    if (!o) return `<span class="na">No line in this file</span>`;
    if (label.endsWith("ML")) {
      const n = label.startsWith(g.away.abbr) ? o.awayML : o.homeML;
      return isNum(n) ? `<b>${esc(am(n))}</b>` : `<span class="na">No line in this file</span>`;
    }
    if (label === "Over" || label === "Under") {
      if (!isNum(o.total)) return `<span class="na">No line in this file</span>`;
      const px = label === "Over" ? o.overOdds : o.underOdds;
      return `<b>${esc(o.total)}</b> <span class="na">${esc(am(px))}</span>`;
    }
    const side = label.startsWith(g.home.abbr) ? "home" : "away";
    const ln = o[side + "Spread"], px = o[side + "SpreadOdds"];
    if (!isNum(ln)) return `<span class="na">No line in this file</span>`;
    return `<b>${esc(sgn(ln))}</b> <span class="na">${esc(am(px))}</span>`;
  }
  async function viewBooks() {
    const now = Date.now(), { by, order } = await indexes();
    const games = [];
    for (const lg of order) for (const g of future(by[lg], now)) if (F().bookColumns(g).length) games.push({ lg, g });
    const pa = parts();
    const cur = games.find(x => x.lg === pa.a && String(x.g.id) === String(pa.b)) || games[0];
    if (!cur) return shell("books", "More sportsbooks", labelOf("books_10"), `<div class="empty"><h3>No upcoming line in this file</h3></div>`);
    const g = cur.g;
    const cols = G() && G().sortBooks ? G().sortBooks(F().BOOK_KEYS.slice()) : F().BOOK_KEYS.slice();
    const headR = cols.map(k => {
      const st = bookBits(k);
      return `<th>${esc(F().BOOK_NAME[k] || k)}${st.label ? `<span class="na-st">${esc(st.label)}</span>` : ""}</th>`;
    }).join("");
    const markets = [
      [g.away.abbr + " spread"],
      [g.home.abbr + " spread"],
      [g.away.abbr + " ML"],
      [g.home.abbr + " ML"],
      ["Over"],
      ["Under"],
    ];
    const body = markets.map(([label]) => `<tr><td>${esc(label)}</td>${cols.map(k => `<td class="num">${cell(g, k, label)}</td>`).join("")}</tr>`).join("");
    const sel = `<label class="vf-sel"><span>Game</span><select id="ppvGame" aria-label="Game">${games.slice(0, 40).map(x => `<option value="${esc(x.lg)}/${esc(x.g.id)}"${x.lg === cur.lg && String(x.g.id) === String(g.id) ? " selected" : ""}>${esc(A().lgName(x.lg))} · ${esc(x.g.away.abbr)} @ ${esc(x.g.home.abbr)}</option>`).join("")}</select></label>`;
    const soon = F().COMING_BOOKS.map(esc).join(", ");
    const offers = G() && G().offersHTML ? G().offersHTML("pro") : "";
    return shell("books", "More sportsbooks", labelOf("books_10"),
      `${flNote()}<section class="card ppv-books"><div class="ppv-frow">${sel}<span class="na">${esc(g.away.name)} at ${esc(g.home.name)}</span></div>
        <div class="tbl-wrap"><table class="books"><thead><tr><th>Market</th>${headR}</tr></thead><tbody>${body}</tbody></table></div>
        <p class="note">Only books with a number in the file get a column. An empty cell means that book didn't post this game. No price is filled in.</p>
        <h3 class="ppv-h">Other books ${SOON}</h3>
        <p>${soon}. The waitlist names these. This file doesn't include them, so they aren't shown as prices. Pinnacle isn't listed: LineSmart only compares state-licensed US books.</p></section>
      ${offers}`);
  }

  async function viewHistory() {
    const now = Date.now(), { by } = await indexes(), flags = notable(by, now);
    const lg = parts().a || (flags[0] && flags[0].lg);
    const id = parts().b || (flags[0] && flags[0].id);
    const item = flags.find(x => x.lg === lg && String(x.id) === String(id)) || flags[0];
    let chart = `<p class="na">No line history for this game.</p>`;
    if (item) {
      try {
        const d = await A().getJSON(`data/${item.lg}/games/${item.g.id}.json`);
        const sec = A().lineMoveSection(d, d.game, item.kind);
        chart = sec.html || `<p class="na">No line history stored for this game.</p>`;
        afterPaint = sec.wire || (() => {});
      } catch (e) { chart = `<p class="na">Couldn't read this game's history file.</p>`; }
    }
    const list = flags.slice(0, 12).map(x => {
      const on = item && x.lg === item.lg && String(x.id) === String(item.id);
      return `<a class="ppv-line${on ? " on" : ""}" href="${href("history")}/${esc(x.lg)}/${esc(x.id)}"><span><span class="vs-lg">${esc(A().lgName(x.lg))}</span> <b>${esc(x.g.away.abbr)} @ ${esc(x.g.home.abbr)}</b><small>${x.notes.map(esc).join(" · ")} · ${bookName(x.book || "draftkings")}</small></span><span class="mvbadge">Sharp move</span></a>`;
    }).join("");
    return shell("history", "Line history", labelOf("line_history"),
      `${flNote()}<section class="card"><h3 class="ppv-h">Sharp-move flags <span class="st-sub">${flags.length} upcoming</span></h3>${list || `<p class="na">No sharp-move flag in this file.</p>`}<p class="note">Same flags as the slate. A description of the saved line, not a pick.</p></section>
      <section class="card">${chart}</section>`);
  }

  async function viewRefresh() {
    const { meta, by, order } = await indexes();
    const info = F().refreshInfo(meta.generated, Date.now());
    const rows = (order || []).map(lg => {
      const L = (meta.leagues || {})[lg] || {}, idx = by[lg];
      const t = L.updated || (idx && idx.generated);
      const age = t ? ((Date.now() - Date.parse(t)) / 36e5) : null;
      return `<tr><td>${esc(L.name || A().lgName(lg))}</td><td class="num">${t ? esc(A().fullET(t)) : "—"}</td><td class="num">${age == null ? "—" : esc(age.toFixed(1))}</td></tr>`;
    }).join("");
    return shell("refresh", "Faster refresh", labelOf("fast_refresh"),
      `<section class="card"><div class="statgrid">${[
        ["File age", info.ageHours == null ? "—" : info.ageHours.toFixed(1) + " h", "since the data file"],
        ["Cadence today", "about " + info.cadenceMin + " min", "how the site refreshes"],
      ].map(([k, v, s]) => `<div class="stat"><span class="sl">${esc(k)}</span><b class="num">${esc(v)}</b><span class="ss">${esc(s)}</span></div>`).join("")}</div>
        <p class="note">This page does not fetch new odds and does not call the odds provider.</p></section>
      <section class="card"><h3 class="ppv-h">When each league file was written</h3><div class="tbl-wrap"><table class="books"><thead><tr><th>League</th><th>Updated</th><th>Hours ago</th></tr></thead><tbody>${rows}</tbody></table></div></section>
      <section class="card"><h3 class="ppv-h">Faster refresh ${SOON}</h3><p>A shorter pull is not running. There is no newer price than the file above, and none is invented here.</p></section>`);
  }

  function preferBooks() {
    const g = G();
    const order = ["hardrockbet", "draftkings", "fanduel"];
    if (!g || !g.sortBooks) return order;
    const keys = g.sortBooks(order).filter(k => !g.isAvailable || g.isAvailable(k));
    return keys.length ? keys : ["hardrockbet"];
  }
  function quoteLine(gap) {
    const by = Object.fromEntries(gap.quotes.map(q => [q.key, q]));
    const order = G() && G().sortBooks ? G().sortBooks(gap.quotes.map(q => q.key)) : gap.quotes.map(q => q.key);
    return order.map(k => {
      const q = by[k], st = bookBits(k);
      return `${(F().BOOK_NAME)[k] || k} ${am(q.price)}${st.label ? " (" + st.label + ")" : ""}`;
    }).join(" · ");
  }
  const Pnum = v => (isNum(v) ? String(Math.round(v * 10) / 10) : "—");
  async function viewHot() {
    const H = Hp();
    if (!H) return shell("hot", "Hot props", "Price gaps, line moves, and recent overs.", `<div class="empty"><h3>Hot props didn't load</h3></div>`);
    const docs = await propsDocs();
    const f = hotState();
    const labels = H.SPORT_LABEL;
    const all = H.collect(docs);
    const sportAll = all.filter(r => r.lg === f.lg);
    const filtered = H.applyFilters(all, f);
    const extra = H.sportList(docs).filter(k => !H.SPORT_FIRST.includes(k));
    const chips = [...H.SPORT_FIRST, ...extra].map(k => {
      const has = !!(docs[k] && docs[k].games && Object.keys(docs[k].games).length);
      return `<a class="chip${f.lg === k ? " on" : ""}${has ? "" : " ppv-off"}" href="${esc(hotHash({ lg: k, team: "", player: "", mk: "all" }))}">${esc(labels[k] || k.toUpperCase())}${has ? "" : ` <span class="na">no file</span>`}</a>`;
    }).join("");
    const teams = [...new Set(sportAll.map(r => r.team).filter(Boolean))].sort();
    const teamRows = f.team ? sportAll.filter(r => r.team === f.team || r.teamId === f.team) : sportAll;
    const players = [];
    const seenP = new Set();
    for (const r of teamRows) if (!seenP.has(r.pid)) { seenP.add(r.pid); players.push(r); }
    players.sort((a, b) => a.name.localeCompare(b.name));
    const playerRows = f.player ? teamRows.filter(r => r.pid === f.player || r.name.toLowerCase().includes(f.player.toLowerCase())) : teamRows;
    const mks = [];
    const seenM = new Set();
    for (const r of playerRows) if (!seenM.has(r.mk)) { seenM.add(r.mk); mks.push({ mk: r.mk, label: r.label }); }
    const sel = (id, label, options) => `<label class="vf-sel"><span>${label}</span><select id="${id}" aria-label="${label}">${options}</select></label>`;
    const teamSel = sel("ppvHotTeam", "Team", `<option value="">All teams</option>${teams.map(t => `<option value="${esc(t)}"${t === f.team ? " selected" : ""}>${esc(t)}</option>`).join("")}`);
    const playerSel = sel("ppvHotPlayer", "Player", `<option value="">All players</option>${players.map(p => `<option value="${esc(p.pid)}"${p.pid === f.player ? " selected" : ""}>${esc(p.name)}${p.team ? ` (${esc(p.team)})` : ""}</option>`).join("")}`);
    const mkSel = sel("ppvHotMk", "Prop type", `<option value="all"${f.mk === "all" ? " selected" : ""}>All props</option>${mks.map(p => `<option value="${esc(p.mk)}"${p.mk === f.mk ? " selected" : ""}>${esc(p.label)}</option>`).join("")}`);
    const store = localStore();
    const saved = store ? H.readSaved(store) : [];
    const savedHtml = saved.length ? `<div class="chips ppv-saved" aria-label="Saved filters">${saved.map(s => `<span class="chip ppv-saved-chip"><a href="${esc(hotHash({ lg: s.lg, team: s.team, player: s.player, mk: s.mk || "all" }))}">${esc(s.name)}</a><button type="button" class="ppv-x" data-ppv-hot-del="${esc(s.id)}" aria-label="${esc("Delete saved filter " + s.name)}">×</button></span>`).join("")}</div>` : `<p class="na">No saved filters in this browser.</p>`;
    const file = docs[f.lg];
    let lists;
    if (!file) {
      lists = `<section class="card"><h3 class="ppv-h">No props file</h3><p>This snapshot has no props file for ${esc(labels[f.lg] || f.lg.toUpperCase())}. Price gaps, prop history, and hot streaks aren't filled in.</p></section>`;
    } else {
      lists = "";
      if (H.hasPrices(sportAll)) {
        const gaps = H.priceGaps(filtered);
        const shownG = gaps.slice(0, 12);
        const gapHtml = shownG.length ? `<div class="ppv-list">${shownG.map(g => `<div class="ppv-line"><span><span class="vs-lg">${esc(labels[g.lg] || g.lg.toUpperCase())}</span> <b>${esc(g.name)} · ${esc(g.label)}</b><small>${esc(g.team)} · O/U ${esc(Pnum(g.line))} · ${g.side === "under" ? "Under" : "Over"}</small><small>${esc(quoteLine(g))}</small></span><span class="num"><b>${esc((g.gap * 100).toFixed(1))} pts</b><small>implied gap</small></span></div>`).join("")}</div>` : `<p class="na">No prop in this filter has two different prices on the same line.</p>`;
        lists += `<section class="card" id="ppvGaps"><h3 class="ppv-h">Price gaps on the same line <span class="st-sub">${gaps.length} in this filter</span></h3>${gapHtml}<p class="note">The gap is the difference in implied probability between books that posted this exact number. A different number is not included. It is not a suggestion to bet either price.</p></section>`;
      }
      if (H.hasOpen(sportAll)) {
        const moves = H.lineMoves(filtered);
        const shownM = moves.slice(0, 12);
        const moveHtml = shownM.length ? `<div class="ppv-list">${shownM.map(m => `<div class="ppv-line"><span><span class="vs-lg">${esc(m.team)}</span> <b>${esc(m.name)} · ${esc(m.label)}</b><small>O/U ${esc(Pnum(m.line))} · ${esc(m.text)}</small></span><span class="num"><b>${m.delta > 0 ? "+" : ""}${esc(String(Math.round(m.delta * 10) / 10))}</b><small>from the open</small></span></div>`).join("")}</div>` : `<p class="na">No opening line in this filter has moved.</p>`;
        lists += `<section class="card" id="ppvMoves"><h3 class="ppv-h">Prop line moves <span class="st-sub">${moves.length} in this filter</span></h3>${moveHtml}<p class="note">The opening number is the one stored on the prop row. It describes that file. It is not a prediction.</p></section>`;
      }
      const prefer = preferBooks();
      if (H.hotStreaks(sportAll, prefer).available) {
        const hot = H.hotStreaks(filtered, prefer).rows;
        const shownH = hot.slice(0, 12);
        const hotHtml = shownH.length ? `<div class="ppv-list">${shownH.map(h => `<div class="ppv-line"><span><span class="vs-lg">${esc(h.team)}</span> <b>${esc(h.name)} · ${esc(h.label)}</b><small>O/U ${esc(Pnum(h.gradedLine))} · ${esc(h.text)} in the last games played</small><small>Past results only.</small></span></div>`).join("")}</div>` : `<p class="na">No player in this filter went over in at least 4 of the last 5 games played.</p>`;
        lists += `<section class="card" id="ppvHotStreaks"><h3 class="ppv-h">Hot streaks <span class="st-sub">${hot.length} in this filter</span></h3>${hotHtml}<p class="note">Same rule as the props page: over in at least 4 of the last 5 games played, or the same share when fewer games are in the log. This is a count of past games, not a pick.</p></section>`;
      }
      const omitted = [];
      if (!H.hasPrices(sportAll)) omitted.push("Price gaps are left out: no book in this file posted a price.");
      if (!H.hasOpen(sportAll)) omitted.push("Prop history is coming soon. This file has no opening line.");
      if (!H.hotStreaks(sportAll, prefer).available) omitted.push("Hot streaks are coming soon. This file has no player game log.");
      if (omitted.length) lists += `<section class="card"><h3 class="ppv-h">Not in this file</h3><p>${omitted.map(esc).join(" ")}</p></section>`;
    }
    const offers = G() && G().offersHTML ? G().offersHTML("pro") : "";
    const src = Object.entries(docs).map(([k, d]) => `${labels[k] || k.toUpperCase()}`).join(", ");
    return shell("hot", "Hot props", "Price gaps, opening-line moves, and recent overs from the props file.",
      `${flNote()}<p class="note">Built from props files on the site${src ? " (" + esc(src) + ")" : ""}. Nothing here calls the odds provider. Saved filters stay in this browser only.</p>
      <section class="card ppv-filters" aria-label="Hot props filters"><div class="chips" role="group" aria-label="Sport">${chips}</div><div class="ppv-frow">${teamSel}${playerSel}${mkSel}</div>
        <form id="ppvHotSave" class="ppv-form"><label class="vf-sel"><span>Save this filter</span><input name="name" maxlength="40" placeholder="Name" aria-label="Saved filter name"></label><button type="submit" class="chip">Save in this browser</button></form>
        <p class="ppv-out" id="ppvHotErr" role="alert"></p>
        <h3 class="ppv-h">Saved filters</h3>${store ? savedHtml : `<p class="na">This browser isn't storing filters.</p>`}</section>
      ${lists}
      ${offers}`);
  }

  async function render(screen) {
    if (screen === "value") return viewValue();
    if (screen === "alerts") return viewAlerts();
    if (screen === "tracker") return viewTracker();
    if (screen === "books") return viewBooks();
    if (screen === "history") return viewHistory();
    if (screen === "refresh") return viewRefresh();
    if (screen === "hot") return viewHot();
    return home();
  }

  async function view() {
    const app = document.getElementById("app"), api = A();
    if (!app || !api) return;
    if (window.LSLive && window.LSLive.stop) window.LSLive.stop();
    api.renderTabs(null);
    const intro = document.getElementById("intro");
    if (intro) intro.hidden = true;
    const homeStates = document.getElementById("homeStates");
    if (homeStates) homeStates.hidden = true;
    const y = keepScroll ? window.scrollY : 0;
    keepScroll = false;
    if (!y) window.scrollTo(0, 0);
    const tok = api.nav(), screen = parts().screen;
    afterPaint = () => {};
    document.title = "LineSmart";
    app.innerHTML = `<div class="ppv ppv-ready" data-pro-owner data-screen="${esc(screen)}">${banner()}<div class="card"><span class="bt-spin" aria-hidden="true"></span> Loading…</div></div>`;
    let html;
    try { html = await render(screen); }
    catch (e) { html = shell(screen, "LineSmart Pro", "Something didn't load.", `<div class="empty"><h3>Couldn't load this page</h3>Reload to try again.</div>`); console.warn(e); }
    if (tok !== api.nav()) return;
    app.innerHTML = html;
    if (y) window.scrollTo(0, y);
    try { afterPaint(); } catch (e) { console.warn(e); }
    bind(app);
  }

  function bind(app) {
    if (app.dataset.proBound) return;
    app.dataset.proBound = "1";
    app.addEventListener("submit", e => {
      if (e.target.closest && e.target.closest("[data-pro-enhance]")) return;
      const q = e.target.closest && e.target.closest("#ppvQ");
      const hot = e.target.closest && e.target.closest("#ppvHotSave");
      const tag = e.target.closest && e.target.closest("[data-ppv-tag]");
      if (q) {
        e.preventDefault();
        location.hash = vHref({ q: String(new FormData(q).get("q") || "").trim() });
      }
      if (hot) { e.preventDefault(); saveHot(hot); }
      if (tag) {
        e.preventDefault();
        const store = localStore();
        const name = new FormData(tag).get("tag");
        if (store) F().setTag(store, tag.dataset.ppvTag, name, true);
        keepScroll = true;
        view();
      }
    });
    app.addEventListener("change", e => {
      const t = e.target;
      if (t.closest && t.closest("[data-pro-enhance]")) return;
      if (t.id === "ppvMin") location.hash = vHref({ min: Number(t.value) });
      if (t.id === "ppvGame") location.hash = href("books") + "/" + t.value;
      if (t.id === "ppvHotTeam") location.hash = hotHash({ team: t.value, player: "", mk: "all" });
      if (t.id === "ppvHotPlayer") location.hash = hotHash({ player: t.value, mk: "all" });
      if (t.id === "ppvHotMk") location.hash = hotHash({ mk: t.value });
    });
    app.addEventListener("click", e => {
      if (e.target.closest && e.target.closest("[data-pro-enhance]")) return;
      const del = e.target.closest && e.target.closest("[data-ppv-hot-del]");
      if (del) {
        e.preventDefault();
        const store = localStore();
        if (store && Hp()) Hp().removeSaved(store, del.dataset.ppvHotDel);
        keepScroll = true;
        view();
      }
    });
  }
  function saveHot(form) {
    const name = new FormData(form).get("name");
    const store = localStore();
    const err = document.getElementById("ppvHotErr");
    if (!store || !Hp()) { if (err) err.textContent = "This browser isn't storing filters."; return; }
    const r = Hp().addSaved(store, { ...hotState(), name, id: Date.now().toString(36) });
    if (!r.ok) { if (err) err.textContent = r.error; return; }
    keepScroll = true;
    view();
  }

  function addNav() {
    if (document.querySelector("[data-pro-owner-nav]")) return;
    const bar = document.querySelector(".topbar-inner");
    if (!bar) return;
    const a = document.createElement("a");
    a.className = "search-btn";
    a.href = "#/owner";
    a.dataset.proOwnerNav = "1";
    a.textContent = "Pro";
    a.title = "LineSmart Pro";
    const inst = document.getElementById("installBtn");
    bar.insertBefore(a, inst || null);
  }
  function boot() {
    addNav();
    window.LSProApp.alertCap = F().ACTIVE_PRO;
    watchSlate();
    watchApp();
    bindEmbed();
  }
  function hide() {
    const a = document.querySelector("[data-pro-owner-nav]");
    if (a) a.remove();
    document.querySelectorAll("[data-pro-enhance], [data-pro-badge]").forEach(el => el.remove());
    if (window.LSProApp) delete window.LSProApp.alertCap;
    IX = null; PROPS = null; ALERTS = null;
    embedHot = null;
    if (window.ProGateCore && window.ProGateCore.isOwnerHash(location.hash)) location.hash = "#/";
  }

  const PILL = `<span class="pro-pill">Pro</span>`;
  let paint = 0, embedHot = null, embedBound = false, slateWatch = false;
  function panel(title, body) {
    return `<section class="card ppv-panel"><h3 class="ppv-h">${PILL} ${title}</h3>${body}</section>`;
  }
  function place(id, kind, html, anchorSel) {
    let host = document.getElementById(id);
    if (!host) {
      host = document.createElement("div");
      host.id = id;
      const list = Array.isArray(anchorSel) ? anchorSel : [anchorSel];
      const anchor = list.map(s => s && document.querySelector(s)).find(Boolean);
      const app = document.getElementById("app");
      if (anchor && anchor.parentNode) anchor.insertAdjacentElement("afterend", host);
      else if (app) app.insertBefore(host, app.firstChild);
      else return null;
    }
    host.className = "ppv-inject";
    host.dataset.proEnhance = kind;
    host.innerHTML = html;
    return host;
  }
  function spark(points, labelFmt) {
    const nums = (points || []).filter(v => typeof v === "number" && isFinite(v));
    if (!nums.length) return `<p class="na">No line in this file.</p>`;
    const w = 320, h = 88, pad = 10;
    let lo = Math.min(...nums), hi = Math.max(...nums);
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    const X = i => pad + (nums.length === 1 ? (w - pad * 2) / 2 : (i / (nums.length - 1)) * (w - pad * 2));
    const Y = v => pad + (1 - (v - lo) / (hi - lo)) * (h - pad * 2);
    const d = nums.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join("");
    const dots = nums.map((v, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="3.5"/>`).join("");
    return `<svg class="ppv-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Line history"><path d="${d}" fill="none"/>${dots}</svg><p class="na">${esc(labelFmt(nums[0]))} open → ${esc(labelFmt(nums[nums.length - 1]))} now</p>`;
  }
  function impliedPts(points) {
    return (points || []).map(v => {
      if (typeof v !== "number" || Math.abs(v) < 100) return null;
      return v > 0 ? 100 / (v + 100) : -v / (-v + 100);
    }).filter(v => v != null);
  }
  async function enhanceGame(ctx) {
    const api = A();
    if (!api || !ctx.lg || !ctx.id) return;
    let d = null;
    try { d = await api.getJSON(`data/${ctx.lg}/games/${ctx.id}.json`); } catch (e) { d = null; }
    if (!d || !d.game) {
      place("pro-game-panel", "game", panel("LineSmart Pro", `<p class="na">Couldn't read this game's file.</p>`), ".match, .pv-h1, h1");
      return;
    }
    const g = d.game;
    const idx = await api.getJSON(`data/${ctx.lg}/index.json`).catch(() => null);
    const kind = (idx && idx.league && idx.league.kind) || "";
    const meta = api.meta ? api.meta() : null;
    const notes = (g.move && g.move.notable) || [];
    const sharp = notes.length
      ? `<ul class="ppv-ul">${notes.map(n => `<li><span class="mvbadge">Sharp move</span> <span>${esc(n)}</span></li>`).join("")}</ul><p class="note">Same rule as the slate: a large spread move, a key number crossed, or a total that moved past the sport's bar. A description of the saved line, not a pick.</p>`
      : `<p class="na">No sharp-move flag on this game in the file.</p>`;
    const markets = F().historyMarkets(d.history);
    const spreadName = kind === "hockey" ? "Puck line" : kind === "baseball" ? "Run line" : "Spread";
    let charts = "";
    if (!markets.length) charts = `<p class="na">No line history stored for this game.</p>`;
    else {
      charts = markets.map(m => {
        const blocks = [
          [spreadName, m.spread, v => sgn(v)],
          [kind === "mma" ? "Total rounds" : "Total", m.total, v => String(v)],
          [`${g.away.abbr} ML`, m.awayML, v => am(v), true],
          [`${g.home.abbr} ML`, m.homeML, v => am(v), true],
        ];
        const body = blocks.map(([label, ser, fmt, ml]) => {
          if (!ser) return `<div class="ppv-mk"><h4>${esc(label)}</h4><p class="na">No line in this file.</p></div>`;
          const pts = ml ? impliedPts(ser.points) : ser.points;
          const shown = pts.length ? spark(pts, ml ? (v => Math.round(v * 100) + "% implied") : fmt) : `<p class="na">No line in this file.</p>`;
          const ends = ml ? `<p class="na">${esc(fmt(ser.open))} open → ${esc(fmt(ser.current))} now</p>` : "";
          return `<div class="ppv-mk"><h4>${esc(label)}</h4>${shown}${ml ? ends : ""}</div>`;
        }).join("");
        return `<h4 class="ppv-h">${esc(F().BOOK_NAME[m.book] || m.book)}</h4>${body}`;
      }).join("");
      charts += `<p class="note">Each chart is the opening number in the file, then the recorded snapshots. Moneyline is drawn as implied win percent so a move across even money stays on one scale. The prices under it are the American odds.</p>`;
    }
    const cols = F().bookColumns(g);
    const bookHead = cols.map(k => `<th>${esc(F().BOOK_NAME[k] || k)}</th>`).join("");
    const labels = [`${g.away.abbr} spread`, `${g.home.abbr} spread`, `${g.away.abbr} ML`, `${g.home.abbr} ML`, "Over", "Under"];
    const bookBody = cols.length ? labels.map(label => `<tr><td>${esc(label)}</td>${cols.map(k => `<td class="num">${cell(g, k, label)}</td>`).join("")}</tr>`).join("") : "";
    const books = cols.length
      ? `<div class="tbl-wrap"><table class="books"><thead><tr><th>Market</th>${bookHead}</tr></thead><tbody>${bookBody}</tbody></table></div><p class="note">Only books with a number in the file get a column. ${esc(F().COMING_BOOKS.join(", "))}: not in this file, so no price is shown. Pinnacle isn't listed.</p>`
      : `<p class="na">No book in this file posted a number for this game.</p>`;
    const info = F().refreshInfo((meta && meta.generated) || (idx && idx.generated) || "", Date.now());
    const fresh = `<div class="statgrid"><div class="stat"><span class="sl">File age</span><b class="num">${info.ageHours == null ? "—" : esc(info.ageHours.toFixed(1) + " h")}</b><span class="ss">since the data file</span></div><div class="stat"><span class="sl">Cadence today</span><b class="num">about ${esc(String(info.cadenceMin))} min</b><span class="ss">how the site refreshes</span></div></div><p class="note">A faster pull is not running. This panel does not fetch new odds.</p>`;
    const html = `${flNote()}${panel("Sharp move", sharp)}${panel("Line history", charts)}${panel("All books", books)}${panel("File freshness", fresh)}<p class="note"><span class="of-21">21+</span> Pro reads the lines already in the file. It isn't a pick. Confirm the price at the sportsbook.</p>`;
    place("pro-game-panel", "game", html, [".lm", "#line-movement-s", "#odds-s", ".pv-h1", "article.sx-game", ".cols"]);
  }
  function hotFilter(ctx) {
    const key = (ctx.lg || "") + "/" + (ctx.id || "");
    if (!embedHot || embedHot.key !== key) embedHot = { key, f: { lg: ctx.lg || "nfl", team: "", player: ctx.id || "", mk: "all" } };
    return embedHot.f;
  }
  async function enhanceProps(ctx) {
    const H = Hp();
    if (!H) return;
    const docs = await propsDocs();
    const f = hotFilter(ctx);
    const labels = H.SPORT_LABEL;
    const all = H.collect(docs);
    const sportAll = all.filter(r => r.lg === f.lg);
    const filtered = H.applyFilters(all, f);
    const teams = [...new Set(sportAll.map(r => r.team).filter(Boolean))].sort();
    const teamRows = f.team ? sportAll.filter(r => r.team === f.team || r.teamId === f.team) : sportAll;
    const players = [];
    const seenP = new Set();
    for (const r of teamRows) if (!seenP.has(r.pid)) { seenP.add(r.pid); players.push(r); }
    players.sort((a, b) => a.name.localeCompare(b.name));
    const playerRows = f.player ? teamRows.filter(r => r.pid === f.player || r.name.toLowerCase().includes(String(f.player).toLowerCase())) : teamRows;
    const mks = [];
    const seenM = new Set();
    for (const r of playerRows) if (!seenM.has(r.mk)) { seenM.add(r.mk); mks.push({ mk: r.mk, label: r.label }); }
    const opt = (val, text, on) => `<option value="${esc(val)}"${on ? " selected" : ""}>${text}</option>`;
    const teamSel = `<label class="vf-sel"><span>Team</span><select id="proHotTeam" aria-label="Team">${opt("", "All teams", !f.team)}${teams.map(t => opt(t, esc(t), t === f.team)).join("")}</select></label>`;
    const playerSel = `<label class="vf-sel"><span>Player</span><select id="proHotPlayer" aria-label="Player">${opt("", "All players", !f.player)}${players.map(p => opt(p.pid, `${esc(p.name)}${p.team ? ` (${esc(p.team)})` : ""}`, p.pid === f.player)).join("")}</select></label>`;
    const mkSel = `<label class="vf-sel"><span>Prop type</span><select id="proHotMk" aria-label="Prop type">${opt("all", "All props", f.mk === "all")}${mks.map(p => opt(p.mk, esc(p.label), p.mk === f.mk)).join("")}</select></label>`;
    const store = localStore();
    const saved = store ? H.readSaved(store) : [];
    const savedHtml = saved.length ? `<div class="chips ppv-saved" aria-label="Saved filters">${saved.map(s => `<span class="chip ppv-saved-chip"><button type="button" class="ppv-apply" data-pro-hot-apply="${esc(s.id)}">${esc(s.name)}</button><button type="button" class="ppv-x" data-pro-hot-del="${esc(s.id)}" aria-label="${esc("Delete saved filter " + s.name)}">×</button></span>`).join("")}</div>` : `<p class="na">No saved filters in this browser.</p>`;
    const file = docs[f.lg];
    let lists;
    if (!file) {
      lists = `<h3 class="ppv-h">No props file</h3><p>This snapshot has no props file for ${esc(labels[f.lg] || String(f.lg || "").toUpperCase())}. Price gaps, prop history, and hot streaks aren't filled in.</p>`;
    } else {
      lists = "";
      if (H.hasPrices(sportAll)) {
        const gaps = H.priceGaps(filtered).slice(0, 8);
        lists += `<h3 class="ppv-h">Price gaps on the same line</h3>${gaps.length ? `<div class="ppv-list">${gaps.map(g => `<div class="ppv-line"><span><b>${esc(g.name)} · ${esc(g.label)}</b><small>${esc(g.team)} · ${esc(quoteLine(g))}</small></span><span class="num"><b>${esc((g.gap * 100).toFixed(1))} pts</b></span></div>`).join("")}</div>` : `<p class="na">No prop in this filter has two different prices on the same line.</p>`}`;
      } else lists += `<p>Price gaps are left out: no book in this file posted a price.</p>`;
      if (H.hasOpen(sportAll)) {
        const moves = H.lineMoves(filtered).slice(0, 8);
        lists += `<h3 class="ppv-h">Prop line moves</h3>${moves.length ? `<div class="ppv-list">${moves.map(m => `<div class="ppv-line"><span><b>${esc(m.name)} · ${esc(m.label)}</b><small>${esc(m.text)}</small></span><span class="num"><b>${m.delta > 0 ? "+" : ""}${esc(String(Math.round(m.delta * 10) / 10))}</b></span></div>`).join("")}</div>` : `<p class="na">No opening line in this filter has moved.</p>`}`;
      } else lists += `<p>Prop history is coming soon. This file has no opening line.</p>`;
      const prefer = preferBooks();
      if (H.hotStreaks(sportAll, prefer).available) {
        const hot = H.hotStreaks(filtered, prefer).rows.slice(0, 8);
        lists += `<h3 class="ppv-h">Hot streaks</h3>${hot.length ? `<div class="ppv-list">${hot.map(h => `<div class="ppv-line"><span><b>${esc(h.name)} · ${esc(h.label)}</b><small>${esc(h.text)} in the last games played</small></span></div>`).join("")}</div>` : `<p class="na">No player in this filter went over in at least 4 of the last 5 games played.</p>`}<p class="note">Past results only, not a pick.</p>`;
      } else lists += `<p>Hot streaks are coming soon. This file has no player game log.</p>`;
    }
    const html = `${flNote()}<p class="note">Built from the props file already on the site. Nothing here calls the odds provider. Saved filters stay in this browser.</p>
      <div class="ppv-frow" data-pro-hot>${teamSel}${playerSel}${mkSel}</div>
      <form id="proHotSave" class="ppv-form"><label class="vf-sel"><span>Save this filter</span><input name="name" maxlength="40" placeholder="Name" aria-label="Saved filter name"></label><button type="submit" class="chip">Save in this browser</button></form>
      <p class="ppv-out" id="proHotErr" role="alert"></p>
      <h3 class="ppv-h">Saved filters</h3>${store ? savedHtml : `<p class="na">This browser isn't storing filters.</p>`}
      ${lists}
      <p class="note"><span class="of-21">21+</span> A price gap is not a suggestion to bet either number.</p>`;
    place("pro-props-panel", "props", panel("Hot props", html), ["#lines-s", "#ppPlayer", ".sx-player", ".phero", "h1"]);
  }
  function enhanceBets() {
    const bets = loadBets();
    const store = localStore();
    const tags = store ? F().readTags(store) : {};
    const C = window.BetCore;
    const clv = F().clvSummary(bets);
    const clvHtml = clv.available
      ? `<p><b>${clv.n}</b> bet${clv.n === 1 ? "" : "s"} with a closing line. Mean close minus bet line: <b class="num">${esc((clv.mean > 0 ? "+" : "") + clv.mean.toFixed(2))}</b></p>`
      : `<p>Closing-line value ${SOON}. None of these bets has a closing price, so CLV isn't filled in.</p>`;
    const groups = F().tagGroups(bets, tags);
    const one = (label, list) => {
      const s = C ? C.stats(list) : { n: list.length, net: 0 };
      return `<div class="ppv-line"><span><b>${esc(label)}</b><small>${s.n} bet${s.n === 1 ? "" : "s"}</small></span><span class="num ${cls(s.net || 0)}"><b>${esc(money(s.net || 0, true))}</b></span></div>`;
    };
    const byType = C ? C.groupBy(bets, b => (C.TYPES && C.TYPES[b.type]) || b.type || "Bet") : [];
    const typeHtml = byType.length ? `<div class="ppv-list">${byType.map(r => one(r.key, bets.filter(b => ((C.TYPES && C.TYPES[b.type]) || b.type) === r.key))).join("")}</div>` : `<p class="na">No bets on this device yet.</p>`;
    const tagHtml = groups.length ? `<div class="ppv-list">${groups.map(g => one(g.tag === "untagged" ? "No tag" : g.tag, g.bets)).join("")}</div>` : "";
    const rows = bets.slice(0, 12).map(b => {
      const c = F().clvPoints(b, b.closeLine);
      const mine = tags[b.id] || [];
      return `<tr><td>${esc(betLabel(b))}</td><td class="num">${c.available ? esc((c.delta > 0 ? "+" : "") + c.delta) : "—"}</td><td>${mine.map(t => `<span class="chip">${esc(t)}</span>`).join(" ")}${store ? `<form class="ppv-form" data-pro-tag="${esc(b.id)}"><input name="tag" maxlength="24" aria-label="Tag" placeholder="Tag"><button type="submit" class="chip">Add</button></form>` : ""}</td></tr>`;
    }).join("");
    const table = bets.length ? `<div class="tbl-wrap"><table class="books ppv-bets"><thead><tr><th>Bet</th><th>CLV</th><th>Tags</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="na">No bets saved on this device. Add one in My Bets and the split shows up here.</p>`;
    const html = `${clvHtml}<h3 class="ppv-h">Splits by type</h3>${typeHtml}<h3 class="ppv-h">Splits by tag</h3>${tagHtml}${table}<p class="note">Tags stay in this browser. They don't turn Pro on. <span class="of-21">21+</span></p>`;
    place("pro-bets-panel", "bets", panel("My Bets extras", html), [".bt-stats", ".bt-empty", ".page-head"]);
  }
  function enhanceSlate() {
    document.querySelectorAll("a.game").forEach(a => {
      const top = a.querySelector(".game-top");
      if (!top || top.querySelector("[data-pro-badge]")) return;
      const pub = top.querySelector(".mvbadge");
      if (!pub) return;
      const s = document.createElement("span");
      s.className = "pro-pill";
      s.dataset.proBadge = "1";
      s.textContent = "Sharp";
      s.title = "Pro · sharp move";
      top.appendChild(s);
    });
  }
  let appWatch = false;
  function watchApp() {
    if (appWatch || !window.MutationObserver) return;
    const app = document.getElementById("app");
    if (!app) return;
    appWatch = true;
    let t = 0;
    new MutationObserver(() => {
      const ctx = window.LSProGate && window.LSProGate.context && window.LSProGate.context();
      if (!ctx || !proOn() || ctx.kind === "owner" || ctx.kind === "other") return;
      const want = ctx.kind === "game" || ctx.kind === "props" || ctx.kind === "bets";
      if (!want) return;
      if (document.querySelector(`[data-pro-enhance="${ctx.kind}"]`)) return;
      clearTimeout(t);
      t = setTimeout(() => { if (window.LSProApp) enhance(ctx); }, 40);
    }).observe(app, { childList: true });
  }
  function watchSlate() {
    if (slateWatch || !window.MutationObserver) return;
    const app = document.getElementById("app");
    if (!app) return;
    slateWatch = true;
    let t = 0;
    new MutationObserver(() => {
      const ctx = window.LSProGate && window.LSProGate.context && window.LSProGate.context();
      if (!ctx || (ctx.kind !== "home" && ctx.kind !== "league" && ctx.kind !== "results")) return;
      clearTimeout(t);
      t = setTimeout(() => { if (window.LSProApp) enhanceSlate(); }, 40);
    }).observe(app, { childList: true, subtree: true });
  }
  function refreshEmbed() {
    if (!proOn()) return;
    const ctx = window.LSProGate && window.LSProGate.context && window.LSProGate.context();
    if (!ctx) return;
    if (ctx.kind === "props") enhanceProps(ctx);
    else if (ctx.kind === "bets") enhanceBets();
  }
  function bindEmbed() {
    if (embedBound) return;
    embedBound = true;
    document.addEventListener("change", e => {
      const t = e.target;
      if (!t.closest || !t.closest("[data-pro-enhance]")) return;
      const f = embedHot && embedHot.f;
      if (!f) return;
      if (t.id === "proHotTeam") { f.team = t.value; f.player = ""; f.mk = "all"; }
      if (t.id === "proHotPlayer") { f.player = t.value; f.mk = "all"; }
      if (t.id === "proHotMk") f.mk = t.value;
      refreshEmbed();
    });
    document.addEventListener("submit", e => {
      const hot = e.target.closest && e.target.closest("#proHotSave");
      const tag = e.target.closest && e.target.closest("[data-pro-tag]");
      if (!hot && !tag) return;
      if (e.target.closest("[data-pro-owner]")) return;
      e.preventDefault();
      const store = localStore();
      if (hot) {
        const err = document.getElementById("proHotErr");
        if (!store || !Hp() || !embedHot) { if (err) err.textContent = "This browser isn't storing filters."; return; }
        const r = Hp().addSaved(store, { ...embedHot.f, name: new FormData(hot).get("name"), id: Date.now().toString(36) });
        if (!r.ok) { if (err) err.textContent = r.error; return; }
        refreshEmbed();
      }
      if (tag && store) {
        F().setTag(store, tag.dataset.proTag, new FormData(tag).get("tag"), true);
        refreshEmbed();
      }
    });
    document.addEventListener("click", e => {
      const del = e.target.closest && e.target.closest("[data-pro-hot-del]");
      const apply = e.target.closest && e.target.closest("[data-pro-hot-apply]");
      if (!del && !apply) return;
      if (e.target.closest("[data-pro-owner]")) return;
      e.preventDefault();
      const store = localStore();
      const H = Hp();
      if (!store || !H || !embedHot) return;
      if (del) H.removeSaved(store, del.dataset.proHotDel);
      if (apply) {
        const row = H.readSaved(store).find(s => s.id === apply.dataset.proHotApply);
        if (row) embedHot.f = { lg: embedHot.f.lg, team: row.team || "", player: row.player || "", mk: row.mk || "all" };
      }
      refreshEmbed();
    });
  }
  function proOn() {
    const g = window.LSProGate;
    if (g && g.verified && !g.verified()) return false;
    return true;
  }
  async function enhance(ctx) {
    if (!proOn()) return;
    const n = ++paint;
    ctx = ctx || {};
    addNav();
    document.querySelectorAll("[data-pro-enhance]").forEach(el => { if (el.dataset.proEnhance !== ctx.kind) el.remove(); });
    if (ctx.kind !== "home" && ctx.kind !== "league" && ctx.kind !== "results") document.querySelectorAll("[data-pro-badge]").forEach(el => el.remove());
    if (ctx.kind === "owner" || ctx.kind === "other") return;
    try {
      if (ctx.kind === "game") await enhanceGame(ctx);
      else if (ctx.kind === "props") await enhanceProps(ctx);
      else if (ctx.kind === "bets") enhanceBets();
      else if (ctx.kind === "home" || ctx.kind === "league" || ctx.kind === "results") enhanceSlate();
    } catch (e) { console.warn(e); }
    if (n !== paint) return;
  }
  window.LSProApp = { view, boot, hide, enhance, alertCap: window.ProFeatures.ACTIVE_PRO };
})();
