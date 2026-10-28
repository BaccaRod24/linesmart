/* Private LineSmart Pro preview (#/pro-preview). Not linked from the nav or the footer.
   Reads the odds files the site already has (LSApp.getJSON). No payment, no email, no Supabase write.
   Numbers that are not in those files are marked "Preview, sample data". */
(function () {
  "use strict";
  const A = () => window.LSApp;
  const G = () => window.LSGeo;
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const isNum = v => typeof v === "number" && isFinite(v);
  const num = v => (v == null || v === "" || !isFinite(Number(v)) ? null : Number(v));
  const sgn = v => (v > 0 ? "+" + v : v === 0 ? "PK" : String(v));
  const am = v => { const n = num(v); return n == null ? "—" : n > 0 ? "+" + n : String(n); };
  const money = (v, sign) => { if (!isFinite(v)) return "—"; const n = Math.abs(v).toFixed(2); return (v < -0.004 ? "−" : sign && v > 0.004 ? "+" : "") + "$" + n; };
  const pct = v => (v == null || !isFinite(v) ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v * 100).toFixed(1) + "%");
  const ePct = e => (isNum(e) ? (e > 0 ? "+" : e < 0 ? "−" : "") + Math.abs(100 * e).toFixed(1) + "%" : "—");
  const cls = v => (v > 0.004 ? "pos" : v < -0.004 ? "neg" : "");
  const SAMPLE = `<span class="ppv-sample">Preview, sample data</span>`;
  const KNOWN = new Set(["hardrockbet", "draftkings", "fanduel", "betmgm"]);
  const BOOK = { draftkings: "DraftKings", hardrockbet: "Hard Rock Bet", fanduel: "FanDuel", betmgm: "BetMGM" };
  const FREE_CAP = 5, PRO_CAP = 25;
  const HINT = {
    props_ev: "Custom filters on the lines in the file. Prop edges are sample: this snapshot has no prop prices.",
    alerts_25: "Sharp-move flags from saved line movement, and a 25-alert cap. No email is sent.",
    tracker_pro: "Stats and tags. Final scores come from the file. The lines, stakes and CLV are sample.",
    books_10: "The book stored in the file, plus sample columns for the extra books. No sign-up links.",
    line_history: "The same line chart as a game page, and the sharp-move flags already on the slate.",
    fast_refresh: "How old this file is, next to a sample faster cadence. Nothing is fetched.",
  };
  const SCREEN = { props_ev: "value", alerts_25: "alerts", tracker_pro: "tracker", books_10: "books", line_history: "history", fast_refresh: "refresh" };

  // In-memory only. Never localStorage, never Supabase.
  const S = { watches: [], tagFlip: {}, hotErr: "" };
  let keepScroll = false, afterPaint = () => {}, IX = null, PROPS = null;

  const parts = () => {
    const raw = location.hash.replace(/^#\/?/, "");
    const [path, qs] = raw.split("?");
    const segs = path.split("/");
    return { screen: segs[1] || "", a: segs[2] || "", b: segs[3] || "", q: new URLSearchParams(qs || "") };
  };
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
    return "#/pro-preview/hot" + (s ? "?" + s : "");
  }
  function localStore() {
    try { const k = "ls-ppv-hot-probe"; localStorage.setItem(k, "1"); localStorage.removeItem(k); return localStorage; }
    catch (e) { return null; }
  }
  const flNote = () => `<p class="note ppv-fl"><b>Florida:</b> Hard Rock Bet is the only legal online sportsbook there. DraftKings and FanDuel are not available in Florida. Prices from those books, when the file has them, are comparison only.</p>`;
  function bookState(key) {
    const g = G(), ev = g.current();
    if (KNOWN.has(key)) { const avail = g.isAvailable(key); return { avail, label: avail ? "" : g.naLabel(key) }; }
    if (ev && ev.state === "FL") return { avail: false, label: "Not available in FL" };
    return { avail: false, label: "Sample only" };
  }
  const bookName = key => `${esc(BOOK[key] || key)}${bookState(key).label ? ` <span class="na-st">${esc(bookState(key).label)}</span>` : ""}`;
  function sampleBook() {
    const g = G(), ev = g.current();
    if (!ev || !ev.state || ev.state === "FL" || g.isAvailable("hardrockbet")) return { key: "hardrock", name: "Hard Rock Bet" };
    if (g.isAvailable("draftkings")) return { key: "draftkings", name: "DraftKings" };
    if (g.isAvailable("fanduel")) return { key: "fanduel", name: "FanDuel" };
    return { key: "other", name: "Sample book" };
  }

  async function indexes() {
    if (IX) return IX;
    const meta = A().meta();
    const order = meta.order || Object.keys(meta.leagues || {});
    const rows = await Promise.all(order.map(async lg => [lg, await A().getJSON(`data/${lg}/index.json`).catch(() => null)]));
    IX = { meta, order, by: Object.fromEntries(rows.filter(([, idx]) => idx && Array.isArray(idx.games))) };
    return IX;
  }
  const future = (idx, now) => (idx.games || []).filter(g => g.state === "pre" && Date.parse(g.date) > now && (g.odds || g.books));

  function banner() {
    return `<div class="ppv-banner" role="status"><b>Pro preview, not live</b><span>Private mock of the waitlist. No payment, no email, and nothing is saved.</span></div>`;
  }
  const labelOf = k => (window.ProCore.FEATURES.find(x => x[0] === k) || [, k])[1];
  function head(screen, title, sub) {
    return `<div class="page-head ppv-head"><div>${screen ? `<a class="lnk ppv-back" href="#/pro-preview">Pro preview</a>` : `<span class="eyebrow">Private</span>`}<h1>${esc(title)}</h1><div class="sub">${esc(sub)}</div></div></div>`;
  }
  function fine() {
    return `<p class="of-rg"><span class="of-21">21+</span> LineSmart is for adults 21 and older. Gambling problem? ${G().rgSpan()} <a href="responsible-gambling.html">Responsible gambling</a></p>
      <p class="note">Pro would be data and software: odds comparison, line history, alerts and a bet tracker. It doesn't include picks or predictions, and nothing here can promise that a bet wins. Most bets lose. LineSmart doesn't take bets. Always confirm the price at the sportsbook.</p>`;
  }
  function crumbs(screen) {
    const items = [["", "Overview"], ["value", "Value"], ["alerts", "Alerts"], ["tracker", "My Bets"], ["books", "Books"], ["history", "Line history"], ["refresh", "Refresh"], ["hot", "Hot props"]];
    return `<nav class="chips ppv-nav" aria-label="Pro preview">${items.map(([id, label]) => `<a class="chip${id === screen ? " on" : ""}" href="#/pro-preview${id ? "/" + id : ""}">${esc(label)}</a>`).join("")}</nav>`;
  }
  const shell = (screen, title, sub, body) => `<div class="ppv ppv-ready" data-screen="${esc(screen)}">${banner()}${head(screen, title, sub)}${crumbs(screen)}${body}${fine()}</div>`;

  function home() {
    const cards = window.ProCore.FEATURES.map(([k, label]) => `<a class="ppv-card" href="#/pro-preview/${SCREEN[k]}"><span class="pro-pill">Pro</span><b>${esc(label)}</b><span>${esc(HINT[k] || "")}</span><span class="ppv-go">Open</span></a>`).join("")
      + `<a class="ppv-card" href="#/pro-preview/hot"><span class="pro-pill">Pro</span><b>Hot props</b><span>Price gaps on the same line, opening-line moves and recent overs, from the props file. Saved filters stay in this browser only.</span><span class="ppv-go">Open</span></a>`;
    return shell("", "LineSmart Pro", "A private look at what the waitlist describes. Not for sale, and not live.",
      `<div class="ppv-grid">${cards}</div>
      <section class="card pro-what"><h3>What this preview is, and isn't</h3>
        <p>It uses the odds files already on the site, and the same Value finder, line-alert, line-history and My Bets math. Where the file has no number, the row says Preview, sample data.</p>
        <p>No payment, no checkout, and no email is sent. Nothing is written to an account. The live site is unchanged: Pro is still the waitlist at <a href="#/pro">#/pro</a>.</p></section>
      ${G().offersHTML("pro")}`);
  }

  // ----- value: real game lines + sample prop edges -----
  const SAMPLE_PROPS = [
    { lg: "nfl", player: "Sample quarterback", market: "Passing yards", side: "Over", line: 246.5, price: -108, edge: 0.024 },
    { lg: "nfl", player: "Sample receiver", market: "Receiving yards", side: "Over", line: 64.5, price: -115, edge: 0.012 },
    { lg: "nba", player: "Sample guard", market: "Points", side: "Over", line: 22.5, price: -105, edge: 0.031 },
    { lg: "nba", player: "Sample forward", market: "Rebounds", side: "Under", line: 8.5, price: -120, edge: 0.006 },
    { lg: "nfl", player: "Sample back", market: "Rushing yards", side: "Over", line: 72.5, price: 100, edge: -0.008 },
    { lg: "nba", player: "Sample center", market: "Assists", side: "Over", line: 5.5, price: -110, edge: 0.018 },
  ];
  function vq() {
    const q = parts().q;
    const min = num(q.get("min"));
    return { lg: q.get("lg") || "all", mk: ["all", "ml", "spread", "total", "prop"].includes(q.get("mk")) ? q.get("mk") : "all", min: min == null ? 0 : min, q: (q.get("q") || "").trim().toLowerCase() };
  }
  const vHref = patch => { const f = { ...vq(), ...patch }; const p = new URLSearchParams(); if (f.lg !== "all") p.set("lg", f.lg); if (f.mk !== "all") p.set("mk", f.mk); if (f.min) p.set("min", String(f.min)); if (f.q) p.set("q", f.q); const s = p.toString(); return "#/pro-preview/value" + (s ? "?" + s : ""); };
  function lineRows(lg, g) {
    const o = (g.books && (g.books.draftkings || g.books.hardrockbet || g.books.fanduel)) || g.odds;
    if (!o) return [];
    const bk = g.books && g.books.hardrockbet ? "hardrockbet" : g.books && g.books.fanduel && !g.books.draftkings ? "fanduel" : "draftkings";
    const away = g.away.abbr, home = g.home.abbr, base = { lg, gid: g.id, matchup: `${away} @ ${home}`, date: g.date, book: bk };
    const out = [];
    if (isNum(o.awaySpread)) out.push({ ...base, mk: "spread", label: `${away} ${sgn(o.awaySpread)}`, price: o.awaySpreadOdds });
    if (isNum(o.homeSpread)) out.push({ ...base, mk: "spread", label: `${home} ${sgn(o.homeSpread)}`, price: o.homeSpreadOdds });
    if (isNum(o.awayML)) out.push({ ...base, mk: "ml", label: `${away} ML`, price: o.awayML });
    if (isNum(o.homeML)) out.push({ ...base, mk: "ml", label: `${home} ML`, price: o.homeML });
    if (isNum(o.total)) { out.push({ ...base, mk: "total", label: `Over ${o.total}`, price: o.overOdds }); out.push({ ...base, mk: "total", label: `Under ${o.total}`, price: o.underOdds }); }
    return out;
  }
  function realEdges(by, now) {
    const V = window.ValueCore, rows = [];
    for (const [lg, idx] of Object.entries(by)) {
      const kind = idx.league.kind, fileNow = Date.parse(idx.generated) || now;
      for (const g of idx.games || []) {
        if (g.state !== "pre" || Date.parse(g.date) <= now) continue;
        const r = V.gameRows(lg, kind, g, idx.generated, fileNow);
        rows.push(...r.rows);
      }
    }
    const si = G().isAvailable.bind(G());
    return window.ValueCore.forState(rows, si);
  }
  async function viewValue() {
    const now = Date.now(), { by, order, meta } = await indexes(), f = vq();
    const edges = realEdges(by, now);
    const shownE = window.ValueCore.filterRows(edges, { lg: f.lg, mk: f.mk === "prop" ? "prop" : f.mk, min: f.min / 100, hours: 0, outliers: true }, now);
    let lines = [];
    for (const lg of order) if (by[lg]) for (const g of future(by[lg], now)) lines.push(...lineRows(lg, g));
    const qok = r => !f.q || `${r.label} ${r.matchup} ${r.player || ""} ${r.market || ""}`.toLowerCase().includes(f.q);
    lines = lines.filter(r => (f.lg === "all" || r.lg === f.lg) && (f.mk === "all" || r.mk === f.mk) && qok(r));
    const props = SAMPLE_PROPS.filter(r => (f.lg === "all" || r.lg === f.lg) && (f.mk === "all" || f.mk === "prop") && r.edge * 100 >= f.min - 1e-9 && qok({ ...r, matchup: "", label: r.player }));
    const leagues = order.filter(lg => future(by[lg], now).length);
    const chips = `<div class="chips">${[["all", "All"], ...leagues.map(lg => [lg, A().lgName(lg)])].map(([k, t]) => `<a class="chip${f.lg === k ? " on" : ""}" href="${esc(vHref({ lg: k }))}">${esc(t)}</a>`).join("")}</div>`;
    const mks = [["all", "All"], ["ml", "Moneyline"], ["spread", "Spread"], ["total", "Total"], ["prop", "Player props"]];
    const seg = `<nav class="seg" aria-label="Market">${mks.map(([k, t]) => `<a href="${esc(vHref({ mk: k }))}" class="${f.mk === k ? "on" : ""}">${esc(t)}</a>`).join("")}</nav>`;
    const mins = [[-2, "−2%"], [0, "0%"], [1, "+1%"], [2, "+2%"], [3, "+3%"]];
    const edgeHtml = shownE.length ? `<div class="ppv-list">${shownE.slice(0, 8).map(r => `<a class="ppv-line" href="#/g/${esc(r.lg)}/${esc(r.gid)}"><span><span class="vs-lg">${esc(A().lgName(r.lg))}</span> <b>${esc(r.label)}</b><small>${esc(r.matchup)}</small></span><span class="num ${cls(r.top.edge)}"><b>${esc(ePct(r.top.edge))}</b><small>${bookName(r.top.book)}</small></span></a>`).join("")}</div>`
      : `<p class="na">No consensus EV in this file. The Value finder needs 3 books on the same line, and this snapshot has DraftKings only, so the live math returns nothing.</p>`;
    const lineHtml = f.mk === "prop" ? "" : `<h3 class="ppv-h">Game lines in the file <span class="st-sub">${lines.length} match the filters · showing ${Math.min(8, lines.length)}</span></h3>
      ${lines.length ? `<div class="ppv-list">${lines.slice(0, 8).map(r => `<a class="ppv-line" href="#/g/${esc(r.lg)}/${esc(r.gid)}"><span><span class="vs-lg">${esc(A().lgName(r.lg))}</span> <b>${esc(r.label)}</b><small>${esc(r.matchup)} · ${esc(A().fmt(r.date, { weekday: "short" }))} ${esc(A().timeET(r.date))}</small></span><span class="num"><b class="px">${esc(am(r.price))}</b><small>${bookName(r.book)}</small></span></a>`).join("")}</div>` : `<p class="na">No line in the file matches these filters.</p>`}
      <p class="note">These prices are the ones stored in the data file${meta.generated ? ` (as of ${esc(A().fullET(meta.generated))})` : ""}. No EV is shown on them: one book is not a consensus. Older than 18 hours, the live Value finder hides them.</p>`;
    const propHtml = `<h3 class="ppv-h">Props EV ${SAMPLE}</h3>
      ${props.length ? `<div class="ppv-list">${props.map(r => `<div class="ppv-line"><span><span class="vs-lg">${esc(r.lg.toUpperCase())}</span> <b>${esc(r.player)} ${esc(r.side)} ${esc(r.line)} ${esc(r.market)}</b><small>Sample book · not a live price</small></span><span class="num ${cls(r.edge)}"><b>${esc(ePct(r.edge))}</b><small>${esc(am(r.price))}</small></span></div>`).join("")}</div>` : `<p class="na">No sample prop clears this filter.</p>`}
      <p class="note">Player-prop prices are not in this data file, so these six rows are made up to show the filter. An edge here is not a tip. A price can beat a sample consensus and still lose.</p>`;
    return shell("value", "Value finder extras", labelOf("props_ev"),
      `${flNote()}<section class="card vf-filters" aria-label="Custom filters">${chips}<div class="ppv-frow">${seg}<form class="ppv-q" id="ppvQ"><label>Search <input name="q" value="${esc(f.q)}" maxlength="40" aria-label="Search lines"></label><button type="submit" class="chip">Filter</button></form>
        <label class="vf-sel"><span>Min EV</span><select id="ppvMin" aria-label="Minimum EV">${mins.map(([v, t]) => `<option value="${v}"${v === f.min ? " selected" : ""}>${t}</option>`).join("")}</select></label></div></section>
      <section class="card"><h3 class="ppv-h">Consensus EV <span class="st-sub">Value finder math</span></h3>${edgeHtml}</section>
      ${f.mk === "prop" ? "" : `<section class="card">${lineHtml}</section>`}
      <section class="card">${propHtml}</section>`);
  }

  // ----- alerts: real sharp flags, in-memory list, no email -----
  function notable(by, now) {
    const out = [];
    for (const [lg, idx] of Object.entries(by)) for (const g of future(idx, now)) {
      const notes = (g.move && g.move.notable) || [];
      if (notes.length) out.push({ lg, g, kind: idx.league.kind, notes });
    }
    out.sort((a, b) => Math.abs(((b.g.move || {}).spread || {}).delta || 0) - Math.abs(((a.g.move || {}).spread || {}).delta || 0));
    return out;
  }
  function mailText(item) {
    const g = item.g, mv = g.move || {}, sp = mv.spread, bk = mv.book || "draftkings";
    const who = `${g.away.abbr} @ ${g.home.abbr}`;
    const move = sp ? ` Home spread opened ${sgn(sp.open)}, now ${sgn(sp.cur)}.` : "";
    const legal = bookState(bk);
    const na = legal.label ? ` ${legal.label}.` : "";
    return { who, subject: `Line move: ${who}`, body: `${item.notes.join(". ")}.${move} Book in the file: ${BOOK[bk] || bk}.${na} This preview did not send an email.` };
  }
  async function viewAlerts() {
    const now = Date.now(), { by } = await indexes(), flags = notable(by, now).slice(0, 8);
    const pick = parts().q.get("g") || (flags[0] ? `${flags[0].lg}/${flags[0].g.id}` : "");
    const cur = flags.find(x => `${x.lg}/${x.g.id}` === pick) || flags[0];
    const mail = cur ? mailText(cur) : null;
    const games = future(by.nfl || { games: [] }, now).filter(g => g.books && g.books.draftkings).slice(0, 12).map(g => ({ lg: "nfl", g }));
    const sel = parts().q.get("game") || (games[0] ? `${games[0].lg}/${games[0].g.id}` : "");
    const rows = flags.map(item => {
      const id = `${item.lg}/${item.g.id}`, on = id === pick;
      return `<a class="ppv-line${on ? " on" : ""}" href="#/pro-preview/alerts?g=${esc(id)}"><span><b>${esc(item.g.away.abbr)} @ ${esc(item.g.home.abbr)}</b><small>${item.notes.map(esc).join(" · ")}</small></span><span class="mvbadge">Sharp move</span></a>`;
    }).join("");
    const list = S.watches.length ? `<ul class="ppv-ul">${S.watches.map(w => `<li><b>${esc(w.title)}</b><span>${esc(w.text)}</span></li>`).join("")}</ul>` : `<p class="na">Nothing kept in this preview yet. Adding one stays in this tab only.</p>`;
    const mailHtml = mail ? `<article class="card ppv-mail" aria-label="Email preview"><h3 class="ppv-h">Email preview ${SAMPLE}</h3><div class="ppv-em"><span class="k">To</span><span>you, in this tab only</span><span class="k">Subject</span><span>${esc(mail.subject)}</span><span class="k">Body</span><span>${esc(mail.body)}</span></div>
      <p class="ppv-actions"><button type="button" class="chip" data-ppv-watch="${esc(cur.lg)}/${esc(cur.g.id)}"${S.watches.some(w => w.id === cur.lg + "/" + cur.g.id) || S.watches.length >= PRO_CAP ? " disabled" : ""}>Keep this flag in the preview list</button><span class="na">Does not send email.</span></p></article>` : "";
    const opts = games.slice(0, 12).map(({ lg, g }) => `<option value="${esc(lg)}/${esc(g.id)}"${sel === lg + "/" + g.id ? " selected" : ""}>${esc(g.away.abbr)} @ ${esc(g.home.abbr)} · ${esc(A().lgName(lg))}</option>`).join("");
    return shell("alerts", "Line alerts", labelOf("alerts_25"),
      `${flNote()}<section class="card ppv-cap"><div class="ppv-cap-row"><b>${S.watches.length} of ${PRO_CAP}</b><span>preview alerts kept in this tab · free accounts stay at ${FREE_CAP} a day</span></div><div class="ppv-meter" aria-hidden="true"><i style="width:${Math.min(100, S.watches.length / PRO_CAP * 100)}%"></i></div>
        <p class="note">Checked on the same schedule as the file, about every 30 minutes today. Each alert would email once and then turn off. This page never sends one.</p></section>
      ${mailHtml}
      <section class="card"><h3 class="ppv-h">Sharp-move flags <span class="st-sub">from the file</span></h3>${rows || `<p class="na">No sharp-move flag on an upcoming game in this file.</p>`}</section>
      <section class="card"><h3 class="ppv-h">Build an alert <span class="st-sub">not saved</span></h3>
        <form id="ppvAlert" class="ppv-form">${opts ? `<label class="vf-sel"><span>Game</span><select name="game">${opts}</select></label>` : `<p class="na">No upcoming game with a line.</p>`}
          <label class="vf-sel"><span>When</span><select name="kind"><option value="spread_move">Spread moves</option><option value="total_move">Total moves</option></select></label>
          <label class="vf-sel"><span>Points</span><input name="points" type="number" min="0.5" max="20" step="0.5" value="1.5"></label>
          <button type="submit" class="chip">Check the preview</button></form>
        <p class="ppv-out na" id="ppvAlertOut">Uses the line-alert rules. If your state has no book with a line in the file, it will say so. Nothing is stored on a server.</p></section>
      <section class="card"><h3 class="ppv-h">Preview list <span class="st-sub">${S.watches.length} of ${PRO_CAP}</span></h3>${list}${S.watches.length ? `<p class="ppv-actions"><button type="button" class="chip" data-ppv-clear>Clear preview list</button></p>` : ""}</section>`);
  }
  function addWatch(item, title, text) {
    const id = item.lg + "/" + item.g.id;
    if (S.watches.some(w => w.id === id) || S.watches.length >= PRO_CAP) return;
    S.watches.unshift({ id, title, text });
  }

  // ----- tracker: real finals, sample lines / CLV / tags -----
  const SPECS = [
    { type: "spread", side: "home", line: 3.5, odds: -110, stake: 25, clv: 1.5, tags: ["spread"] },
    { type: "spread", side: "away", line: -2.5, odds: -110, stake: 20, clv: -1, tags: ["spread", "prime"] },
    { type: "total", side: "over", line: 43.5, odds: -110, stake: 15, clv: 0.5, tags: ["total"] },
    { type: "ml", side: "home", odds: -130, stake: 30, clv: 8, tags: ["ml", "prime"] },
    { type: "total", side: "under", line: 47.5, odds: -105, stake: 10, clv: -0.5, tags: ["total"] },
  ];
  function finished(by) {
    const out = [];
    for (const g of ((by.nfl || {}).games || [])) if (g.completed && num(g.home.score) != null && num(g.away.score) != null) out.push(g);
    return out;
  }
  function trackerBets(games) {
    const C = window.BetCore, book = sampleBook();
    return games.slice(0, SPECS.length).map((g, i) => {
      const spec = SPECS[i], id = "s" + g.id;
      const final = { home: Number(g.home.score), away: Number(g.away.score), completed: true };
      const status = C.gradeSelection({ type: spec.type, side: spec.side, line: spec.line, league: "nfl" }, final) || "push";
      let tags = spec.tags.slice();
      if (S.tagFlip[id]) tags = tags.includes("prime") ? tags.filter(t => t !== "prime") : tags.concat("prime");
      const bet = { id, date: String(g.date).slice(0, 10), status, type: spec.type, book: book.key, stake: spec.stake, odds: spec.odds, league: "nfl", settledAt: String(g.date).slice(0, 10) };
      return { bet, g, spec, tags, book, final };
    });
  }
  async function viewTracker() {
    const { by } = await indexes(), rows = trackerBets(finished(by)), tag = parts().q.get("tag") || "all";
    const shown = rows.filter(r => tag === "all" || r.tags.includes(tag));
    const C = window.BetCore, stats = C.stats(shown.map(r => r.bet));
    const clvs = shown.map(r => r.spec.clv), avg = clvs.length ? clvs.reduce((a, b) => a + b, 0) / clvs.length : null;
    const chips = ["all", "spread", "total", "ml", "prime"].map(t => `<a class="chip${tag === t ? " on" : ""}" href="#/pro-preview/tracker${t === "all" ? "" : "?tag=" + t}">${esc(t === "all" ? "All tags" : t)}</a>`).join("");
    const box = (k, v, sub, c) => `<div class="stat"><span class="sl">${esc(k)}</span><b class="num ${c || ""}">${v}</b>${sub ? `<span class="ss">${sub}</span>` : ""}</div>`;
    const rec = `${stats.won}-${stats.lost}-${stats.push}`;
    const table = shown.length ? `<div class="tbl-wrap"><table class="books ppv-bets"><thead><tr><th>Game</th><th>Final</th><th>Sample line</th><th>Stake</th><th>Result</th><th>CLV</th><th>Tags</th></tr></thead><tbody>${shown.map(r => {
      const line = r.spec.type === "ml" ? `${r.spec.side === "home" ? r.g.home.abbr : r.g.away.abbr} ML ${am(r.spec.odds)}` : r.spec.type === "total" ? `${r.spec.side} ${r.spec.line}` : `${r.spec.side === "home" ? r.g.home.abbr : r.g.away.abbr} ${sgn(r.spec.line)}`;
      return `<tr><td>${esc(r.g.away.abbr)} @ ${esc(r.g.home.abbr)}</td><td class="num">${esc(r.g.away.score)}–${esc(r.g.home.score)}</td><td>${esc(line)} ${SAMPLE}</td><td class="num">${esc(money(r.spec.stake))} ${SAMPLE}</td><td>${esc(r.bet.status)}</td><td class="num ${cls(r.spec.clv)}">${r.spec.clv > 0 ? "+" : ""}${esc(r.spec.clv)} ${SAMPLE}</td><td>${r.tags.map(t => `<span class="chip">${esc(t)}</span>`).join(" ")} <button type="button" class="chip" data-ppv-tag="${esc(r.bet.id)}">Toggle prime</button></td></tr>`;
    }).join("")}</tbody></table></div>` : `<p class="na">No sample row has that tag.</p>`;
    return shell("tracker", "My Bets extras", labelOf("tracker_pro"),
      `<p class="note">This does not read or write My Bets. ${SAMPLE} The sportsbook name follows your state (${esc(sampleBook().name)}). The line, price, stake and closing-line value are sample. The result is the real final score, graded with the My Bets code against that sample line. It is not a pick. Finished games in this file don't keep a closing line, so CLV cannot be computed from the file.</p>
      <div class="statgrid bt-stats">${box("Net", money(stats.net, true), "sample stakes", cls(stats.net))}${box("ROI", pct(stats.roi), "sample", cls(stats.roi))}${box("Record", rec, `${stats.n} sample bets`)}${box("Win rate", stats.winRate == null ? "—" : (stats.winRate * 100).toFixed(0) + "%", "pushes excluded")}${box("Avg CLV", avg == null ? "—" : (avg > 0 ? "+" : "") + avg.toFixed(1), "sample points", cls(avg))}</div>
      <div class="chips ppv-tags" role="group" aria-label="Tags">${chips}</div>
      <section class="card">${table}</section>`);
  }

  // ----- books: one real column, sample columns, no links -----
  const EXTRA = [
    ["betmgm", "BetMGM"], ["caesars", "Caesars"], ["fanatics", "Fanatics"], ["espnbet", "ESPN BET"],
    ["bet365", "bet365"], ["betrivers", "BetRivers"], ["ballybet", "Bally Bet"],
  ];
  function shiftAm(price, delta) {
    const n0 = num(price); if (n0 == null) return null;
    let n = Math.round(n0 + delta);
    if (Math.abs(n) < 100) n = n >= 0 ? 100 : -100;
    return n;
  }
  const half = n => Math.round(n * 2) / 2;
  function realPrice(label, line, price) {
    if (label.endsWith("ML")) return isNum(num(price)) ? `<b>${esc(am(price))}</b>` : `<span class="na">No line in this file</span>`;
    if (!isNum(num(line))) return `<span class="na">No line in this file</span>`;
    const n = label === "Over" || label === "Under" ? line : sgn(line);
    return `<b>${esc(n)}</b> <span class="na">${esc(am(price))}</span>`;
  }
  function samplePrice(label, line, price, i) {
    const d = i - 3;
    if (label.endsWith("ML")) { const n = shiftAm(price, d * 8); return n == null ? `<span class="na">sample</span>` : `<b>${esc(am(n))}</b>`; }
    if (!isNum(num(line))) return `<span class="na">sample</span>`;
    if (label === "Over" || label === "Under") return `<b>${esc(half(line + d * 0.5))}</b> <span class="na">-110</span>`;
    return `<b>${esc(sgn(half(line + d * 0.5)))}</b> <span class="na">-110</span>`;
  }
  function bookCells(g) {
    const o = (g.books && g.books.draftkings) || g.odds || {};
    const mk = [
      ["spread", g.away.abbr + " spread", o.awaySpread, o.awaySpreadOdds, true],
      ["spread", g.home.abbr + " spread", o.homeSpread, o.homeSpreadOdds, true],
      ["ml", g.away.abbr + " ML", null, o.awayML, false],
      ["ml", g.home.abbr + " ML", null, o.homeML, false],
      ["total", "Over", o.total, o.overOdds, true],
      ["total", "Under", o.total, o.underOdds, true],
    ];
    return mk;
  }
  async function viewBooks() {
    const now = Date.now(), { by } = await indexes();
    const games = future(by.nfl || { games: [] }, now);
    const id = parts().b || parts().a || (games[0] && games[0].id);
    const g = games.find(x => String(x.id) === String(id)) || games[0];
    if (!g) return shell("books", "More sportsbooks", labelOf("books_10"), `<div class="empty"><h3>No upcoming NFL line in this file</h3></div>`);
    const realOrder = G().sortBooks(["hardrockbet", "draftkings", "fanduel"]);
    const cols = [...realOrder.map(k => ({ key: k, name: BOOK[k], sample: false })), ...EXTRA.map(([key, name], i) => ({ key, name, sample: true, i }))];
    const o = (g.books && g.books.draftkings) || {};
    const headR = cols.map(c => {
      const st = bookState(c.key), dim = c.sample || !st.avail;
      return `<th class="${dim ? "na-col" : ""}">${esc(c.name)}${st.label ? `<span class="na-st">${esc(st.label)}</span>` : ""}${c.sample ? SAMPLE : ""}</th>`;
    }).join("");
    const body = bookCells(g).map(([, label, line, price]) => {
      const tds = cols.map(c => {
        const dim = c.sample || !bookState(c.key).avail;
        const text = c.sample ? samplePrice(label, line, price, c.i) : c.key === "draftkings" ? realPrice(label, line, price) : `<span class="na">No line in this file</span>`;
        return `<td class="num${dim ? " na-col" : ""}">${text}</td>`;
      }).join("");
      return `<tr><td>${esc(label)}</td>${tds}</tr>`;
    }).join("");
    const sp = g.move && g.move.spread;
    const move = sp ? `<p class="note">In the file, the home spread (${esc(g.home.abbr)}) opened ${esc(sgn(sp.open))} and is now ${esc(sgn(sp.cur))} at ${bookName(g.move.book || "draftkings")}. ${g.move.notable && g.move.notable.length ? esc(g.move.notable.join(". ")) + "." : ""}</p>` : "";
    const sel = `<label class="vf-sel"><span>NFL game</span><select id="ppvGame" aria-label="Game">${games.map(x => `<option value="${esc(x.id)}"${String(x.id) === String(g.id) ? " selected" : ""}>${esc(x.away.abbr)} @ ${esc(x.home.abbr)}</option>`).join("")}</select></label>`;
    return shell("books", "More sportsbooks", labelOf("books_10"),
      `${flNote()}<section class="card ppv-books"><div class="ppv-frow">${sel}<span class="na">${esc(g.away.name)} at ${esc(g.home.name)}</span></div>
        <div class="tbl-wrap"><table class="books"><thead><tr><th>Market</th>${headR}</tr></thead><tbody>${body}</tbody></table></div>
        ${move}
        <p class="note">DraftKings is the only book with a line for this game in the file. Hard Rock Bet and FanDuel columns are empty on purpose. The other seven columns are ${SAMPLE}: a half-point or a few cents off the DraftKings number, with a flat -110, so the board has a shape. They are not live prices. No column links out. The waitlist also names Pinnacle. LineSmart only compares state-licensed US books, so Pinnacle is not shown and there is no sign-up link. Ten columns is the cap the waitlist describes, not ten places to bet.</p></section>`);
  }

  // ----- line history: real chart + real flags -----
  async function viewHistory() {
    const now = Date.now(), { by } = await indexes(), flags = notable(by, now);
    const lg = parts().a || (flags[0] && flags[0].lg);
    const id = parts().b || (flags[0] && flags[0].g.id);
    const item = flags.find(x => x.lg === lg && String(x.g.id) === String(id)) || flags[0];
    let chart = `<p class="na">No line history for this game.</p>`, note = "";
    if (item) {
      try {
        const d = await A().getJSON(`data/${item.lg}/games/${item.g.id}.json`);
        const sec = A().lineMoveSection(d, d.game, item.kind);
        chart = sec.html; afterPaint = sec.wire; note = "";
      } catch (e) { chart = `<p class="na">Couldn't read this game's history file.</p>`; }
    }
    const list = flags.slice(0, 8).map(x => {
      const on = item && x.lg === item.lg && String(x.g.id) === String(item.g.id);
      return `<a class="ppv-line${on ? " on" : ""}" href="#/pro-preview/history/${esc(x.lg)}/${esc(x.g.id)}"><span><span class="vs-lg">${esc(A().lgName(x.lg))}</span> <b>${esc(x.g.away.abbr)} @ ${esc(x.g.home.abbr)}</b><small>${x.notes.map(esc).join(" · ")} · ${bookName((x.g.move || {}).book || "draftkings")}</small></span><span class="mvbadge">Sharp move</span></a>`;
    }).join("");
    return shell("history", "Line history", labelOf("line_history"),
      `${flNote()}<section class="card"><h3 class="ppv-h">Sharp-move flags <span class="st-sub">${flags.length} upcoming in the file · showing ${Math.min(8, flags.length)}</span></h3>${list || `<p class="na">No sharp-move flag in this file.</p>`}<p class="note">A flag is the same rule the site already uses: a football or basketball spread that moved at least 1.5 points, a key number (3 or 7) crossed, or a total that moved past the sport's bar. It is a description of the saved line, not a pick.</p></section>
      <section>${chart}${note}</section>`);
  }

  // ----- refresh: real file age, sample cadence -----
  async function viewRefresh() {
    const { meta, by } = await indexes();
    const gen = meta.generated, age = gen ? (Date.now() - Date.parse(gen)) / 36e5 : null;
    const rows = (meta.order || []).map(lg => {
      const L = meta.leagues[lg] || {}, idx = by[lg];
      const t = L.updated || (idx && idx.generated);
      return `<tr><td>${esc(L.name || lg)}</td><td class="num">${t ? esc(A().fullET(t)) : "—"}</td><td class="num">${t ? esc(((Date.now() - Date.parse(t)) / 36e5).toFixed(1)) : "—"}</td></tr>`;
    }).join("");
    const checks = gen ? [0, 5, 10, 15].map(m => A().fullET(new Date(Date.parse(gen) + m * 60000).toISOString())) : [];
    return shell("refresh", "Faster refresh", labelOf("fast_refresh"),
      `<section class="card"><div class="statgrid">${[
        ["File age", age == null ? "—" : age.toFixed(1) + " h", "since the data file"],
        ["Live cadence", "about 30 min", "how the site refreshes today"],
        ["Pro cadence", "about 5 min", "the waitlist idea, not running"],
      ].map(([k, v, s]) => `<div class="stat"><span class="sl">${esc(k)}</span><b class="num">${esc(v)}</b><span class="ss">${esc(s)}</span></div>`).join("")}</div>
        <p class="note">This preview does not refresh on its own and does not call the odds provider. The age above is the file you already have.</p></section>
      <section class="card"><h3 class="ppv-h">When each league file was written</h3><div class="tbl-wrap"><table class="books"><thead><tr><th>League</th><th>Updated</th><th>Hours ago</th></tr></thead><tbody>${rows}</tbody></table></div></section>
      <section class="card"><h3 class="ppv-h">A 5-minute cadence ${SAMPLE}</h3>
        <ul class="ppv-ul">${checks.map(t => `<li><b>${esc(t)}</b><span>Sample check time, counted forward from the real file stamp. No pull happened then.</span></li>`).join("")}</ul>
        <p class="note">The prices on the other preview screens stay the file's prices. A faster cadence would not invent a newer number, and this page does not pretend to have one.</p></section>`);
  }

  async function propsDocs() {
    if (PROPS) return PROPS;
    const pairs = await Promise.all(["nfl", "nba"].map(async lg => {
      try { return [lg, await A().getJSON(`data/props/${lg}.json`)]; }
      catch (e) { return [lg, null]; }
    }));
    PROPS = Object.fromEntries(pairs.filter(([, d]) => d && d.games));
    return PROPS;
  }
  function preferBooks() {
    const g = G();
    const order = ["hardrockbet", "draftkings", "fanduel"];
    if (!g) return order;
    const ev = g.current();
    if (!ev || !ev.state) return order;
    const keys = g.sortBooks(order).filter(k => g.isAvailable(k));
    return keys.length ? keys : ["hardrockbet"];
  }
  function quoteLine(gap) {
    const by = Object.fromEntries(gap.quotes.map(q => [q.key, q]));
    const order = G().sortBooks(gap.quotes.map(q => q.key));
    return order.map(k => {
      const q = by[k], st = bookState(k);
      return `${BOOK[k] || k} ${am(q.price)}${st.label ? " (" + st.label + ")" : ""}`;
    }).join(" · ");
  }
  async function viewHot() {
    const Hp = window.HotProps;
    if (!Hp) return shell("hot", "Hot props", "Price gaps, line moves and recent overs from the props file.", `<div class="empty"><h3>Hot props didn't load</h3></div>`);
    const docs = await propsDocs();
    const f = hotState();
    const labels = Hp.SPORT_LABEL;
    const all = Hp.collect(docs);
    const sportAll = all.filter(r => r.lg === f.lg);
    const filtered = Hp.applyFilters(all, f);
    const extra = Hp.sportList(docs).filter(k => !Hp.SPORT_FIRST.includes(k));
    const chips = [...Hp.SPORT_FIRST, ...extra].map(k => {
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
    if (f.mk !== "all" && !seenM.has(f.mk)) mks.push({ mk: f.mk, label: f.mk });
    const sel = (id, label, options) => `<label class="vf-sel"><span>${label}</span><select id="${id}" aria-label="${label}">${options}</select></label>`;
    const teamSel = sel("ppvHotTeam", "Team", `<option value="">All teams</option>${teams.map(t => `<option value="${esc(t)}"${t === f.team ? " selected" : ""}>${esc(t)}</option>`).join("")}`);
    const playerSel = sel("ppvHotPlayer", "Player", `<option value="">All players</option>${players.map(p => `<option value="${esc(p.pid)}"${p.pid === f.player ? " selected" : ""}>${esc(p.name)}${p.team ? ` (${esc(p.team)})` : ""}</option>`).join("")}`);
    const mkSel = sel("ppvHotMk", "Prop type", `<option value="all"${f.mk === "all" ? " selected" : ""}>All props</option>${mks.map(p => `<option value="${esc(p.mk)}"${p.mk === f.mk ? " selected" : ""}>${esc(p.label)}</option>`).join("")}`);
    const store = localStore();
    const saved = store ? Hp.readSaved(store) : [];
    const savedHtml = saved.length ? `<div class="chips ppv-saved" aria-label="Saved filters">${saved.map(s => `<span class="chip ppv-saved-chip"><a href="${esc(hotHash({ lg: s.lg, team: s.team, player: s.player, mk: s.mk || "all" }))}">${esc(s.name)}</a><button type="button" class="ppv-x" data-ppv-hot-del="${esc(s.id)}" aria-label="${esc("Delete saved filter " + s.name)}">×</button></span>`).join("")}</div>` : `<p class="na">No saved filters in this browser.</p>`;
    const src = Object.entries(docs).map(([k, d]) => {
      const n = Object.values(d.games).reduce((a, g) => a + ((g.props || []).length), 0);
      return `${labels[k] || k.toUpperCase()}: ${n} props${d.gen ? " · " + A().fullET(d.gen) : ""}`;
    }).join("; ");
    const file = docs[f.lg];
    let lists;
    if (!file) {
      lists = `<section class="card"><h3 class="ppv-h">No props file for ${esc(labels[f.lg] || f.lg.toUpperCase())}</h3><p>This snapshot has no <span class="mono">data/props/${esc(f.lg)}.json</span>. Price gaps need that file. Prop line moves are left out because there is no opening line here, and hot streaks are left out because there is no player game log. Those lists are not filled with sample numbers.</p></section>`;
    } else {
      const gaps = Hp.priceGaps(filtered);
      const shownG = gaps.slice(0, 12);
      const gapHtml = shownG.length ? `<div class="ppv-list">${shownG.map(g => `<div class="ppv-line"><span><span class="vs-lg">${esc(labels[g.lg] || g.lg.toUpperCase())}</span> <b>${esc(g.name)} · ${esc(g.label)}</b><small>${esc(g.team)} · O/U ${esc(Pnum(g.line))} · ${g.side === "under" ? "Under" : "Over"} on this line</small><small>${esc(quoteLine(g))}</small></span><span class="num"><b>${esc((g.gap * 100).toFixed(1))} pts</b><small>implied gap</small></span></div>`).join("")}</div>` : `<p class="na">No prop in this filter has two different prices on the same line.</p>`;
      lists = `<section class="card" id="ppvGaps"><h3 class="ppv-h">Price gaps on the same line <span class="st-sub">${gaps.length} in this filter · showing ${shownG.length}</span></h3>${gapHtml}<p class="note">The gap is the difference in implied probability between the highest and lowest price among books that posted this exact number. A different number at another book is not included. It compares prices in the file. It is not a suggestion to bet either price.</p></section>`;
      if (Hp.hasOpen(sportAll)) {
        const moves = Hp.lineMoves(filtered);
        const shownM = moves.slice(0, 12);
        const moveHtml = shownM.length ? `<div class="ppv-list">${shownM.map(m => `<div class="ppv-line"><span><span class="vs-lg">${esc(m.team)}</span> <b>${esc(m.name)} · ${esc(m.label)}</b><small>O/U ${esc(Pnum(m.line))} · ${esc(m.text)}</small></span><span class="num"><b>${m.delta > 0 ? "+" : ""}${esc(String(Math.round(m.delta * 10) / 10))}</b><small>from the open</small></span></div>`).join("")}</div>` : `<p class="na">No opening line in this filter has moved.</p>`;
        lists += `<section class="card" id="ppvMoves"><h3 class="ppv-h">Prop line moves <span class="st-sub">${moves.length} in this filter · showing ${shownM.length}</span></h3>${moveHtml}<p class="note">The opening number is the one stored on the prop row. The change describes that file. It is not a prediction.</p></section>`;
      }
      const prefer = preferBooks();
      if (Hp.hotStreaks(sportAll, prefer).available) {
        const hot = Hp.hotStreaks(filtered, prefer).rows;
        const shownH = hot.slice(0, 12);
        const hotHtml = shownH.length ? `<div class="ppv-list">${shownH.map(h => {
          const bk = h.gradedBook ? bookName(h.gradedBook) : "the line in the file";
          return `<div class="ppv-line"><span><span class="vs-lg">${esc(h.team)}</span> <b>${esc(h.name)} · ${esc(h.label)}</b><small>O/U ${esc(Pnum(h.gradedLine))} · ${esc(h.text)} in the last games played</small><small>Graded against ${bk}. Past results only.</small></span></div>`;
        }).join("")}</div>` : `<p class="na">No player in this filter went over in at least 4 of the last 5 games played.</p>`;
        lists += `<section class="card" id="ppvHotStreaks"><h3 class="ppv-h">Hot streaks <span class="st-sub">${hot.length} in this filter · showing ${shownH.length}</span></h3>${hotHtml}<p class="note">Same rule as the props page: over in at least 4 of the last 5 games played, or the same share when fewer games are in the log (at least 2). Did-not-play games are skipped. This is a count of past games against the current line, not a pick.</p></section>`;
      }
      const omitted = [];
      if (!Hp.hasOpen(sportAll)) omitted.push("Prop line moves are left out: this file has no opening line.");
      if (!Hp.hotStreaks(sportAll, prefer).available) omitted.push("Hot streaks are left out: this file has no player game log.");
      if (omitted.length) lists += `<p class="note">${omitted.map(esc).join(" ")}</p>`;
    }
    return shell("hot", "Hot props", "Price gaps, opening-line moves and recent overs from the props file.",
      `${flNote()}<p class="note">Built from the props files already on the site${src ? ": " + esc(src) : ""}. The site writes those files for NFL and NBA. Nothing here calls the odds provider. Saved filters stay in this browser only.</p>
      <section class="card ppv-filters" aria-label="Hot props filters"><div class="chips" role="group" aria-label="Sport">${chips}</div><div class="ppv-frow">${teamSel}${playerSel}${mkSel}</div>
        <form id="ppvHotSave" class="ppv-form"><label class="vf-sel"><span>Save this filter</span><input name="name" maxlength="40" placeholder="Name" aria-label="Saved filter name"></label><button type="submit" class="chip">Save in this browser</button></form>
        ${S.hotErr ? `<p class="ppv-out" role="alert">${esc(S.hotErr)}</p>` : ""}
        <h3 class="ppv-h">Saved filters</h3>${store ? savedHtml : `<p class="na">This browser isn't storing filters.</p>`}
        <p class="note">A saved filter is a name plus the sport, team, player and prop type. It is written to localStorage on this device. It is not sent to an account.</p></section>
      ${lists}
      ${G().offersHTML("pro")}`);
  }
  const Pnum = v => (isNum(v) ? String(Math.round(v * 10) / 10) : "—");

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

  function flagById(by, id) {
    const now = Date.now();
    return notable(by, now).find(x => x.lg + "/" + x.g.id === id);
  }

  async function view() {
    const app = document.getElementById("app"), api = A();
    if (!app || !api || !window.ProCore || !G()) return;
    api.renderTabs(null);
    const y = keepScroll ? window.scrollY : 0;
    keepScroll = false;
    if (!y) window.scrollTo(0, 0);
    const tok = api.nav(), screen = parts().screen;
    afterPaint = () => {};
    app.innerHTML = `<div class="ppv ppv-ready" data-screen="${esc(screen)}">${banner()}<div class="card vf-loading"><span class="bt-spin" aria-hidden="true"></span> Loading the preview…</div></div>`;
    let html;
    try { html = await render(screen); }
    catch (e) { html = shell(screen, "Pro preview", "Something didn't load.", `<div class="empty"><h3>Couldn't load this preview</h3>Reload the page to try again.</div>`); console.warn(e); }
    if (tok !== api.nav()) return;
    app.innerHTML = html;
    if (y) window.scrollTo(0, y);
    try { afterPaint(); } catch (e) { console.warn(e); }
    bind(app);
  }

  function bind(app) {
    if (app.dataset.ppvBound) return;
    app.dataset.ppvBound = "1";
    app.addEventListener("submit", e => {
      const q = e.target.closest && e.target.closest("#ppvQ");
      const al = e.target.closest && e.target.closest("#ppvAlert");
      if (q) {
        e.preventDefault();
        const v = new FormData(q).get("q") || "";
        location.hash = vHref({ q: String(v).trim() });
      }
      if (al) {
        e.preventDefault();
        previewAlert(al);
      }
      const hot = e.target.closest && e.target.closest("#ppvHotSave");
      if (hot) { e.preventDefault(); saveHot(hot); }
    });
    app.addEventListener("change", e => {
      const t = e.target;
      if (t.id === "ppvMin") location.hash = vHref({ min: Number(t.value) });
      if (t.id === "ppvGame") location.hash = "#/pro-preview/books/nfl/" + t.value;
      if (t.id === "ppvHotTeam") location.hash = hotHash({ team: t.value, player: "", mk: "all" });
      if (t.id === "ppvHotPlayer") location.hash = hotHash({ player: t.value, mk: "all" });
      if (t.id === "ppvHotMk") location.hash = hotHash({ mk: t.value });
    });
    app.addEventListener("click", e => {
      const w = e.target.closest && e.target.closest("[data-ppv-watch]");
      const tag = e.target.closest && e.target.closest("[data-ppv-tag]");
      const clr = e.target.closest && e.target.closest("[data-ppv-clear]");
      if (w) { e.preventDefault(); keepWatch(w.dataset.ppvWatch); }
      if (tag) { e.preventDefault(); S.tagFlip[tag.dataset.ppvTag] = !S.tagFlip[tag.dataset.ppvTag]; keepScroll = true; view(); }
      if (clr) { e.preventDefault(); S.watches = []; keepScroll = true; view(); }
      const del = e.target.closest && e.target.closest("[data-ppv-hot-del]");
      if (del) { e.preventDefault(); const store = localStore(); if (store && window.HotProps) window.HotProps.removeSaved(store, del.dataset.ppvHotDel); S.hotErr = ""; keepScroll = true; view(); }
    });
  }

  async function keepWatch(id) {
    const { by } = await indexes();
    const item = flagById(by, id);
    if (!item) return;
    const mail = mailText(item);
    addWatch(item, mail.subject, mail.body);
    keepScroll = true; view();
  }
  async function previewAlert(form) {
    const out = document.getElementById("ppvAlertOut");
    const fd = new FormData(form);
    const [lg, gid] = String(fd.get("game") || "").split("/");
    const { by } = await indexes();
    const idx = by[lg], g = idx && (idx.games || []).find(x => String(x.id) === gid);
    const C = window.AlertsCore;
    const allowed = C.allowedBooks(k => G().isAvailable(k));
    const built = g ? C.build({ kind: fd.get("kind"), side: "home", points: fd.get("points"), books: allowed }, { game: g, league: lg, allowed, now: Date.now() }) : { ok: false, error: "That game isn't in the file." };
    if (!built.ok) { out.className = "ppv-out"; out.textContent = built.error + " Nothing was saved."; return; }
    const text = C.describe(built.row) + " Preview only. No email is sent, and this is not saved to an account.";
    addWatch({ lg, g }, g.away.abbr + " @ " + g.home.abbr, text);
    keepScroll = true; view();
  }

  function saveHot(form) {
    const name = new FormData(form).get("name");
    const store = localStore();
    if (!store || !window.HotProps) { S.hotErr = "This browser isn't storing filters."; keepScroll = true; view(); return; }
    const r = window.HotProps.addSaved(store, { ...hotState(), name, id: Date.now().toString(36) });
    S.hotErr = r.ok ? "" : r.error;
    keepScroll = true;
    view();
  }

  window.LSProPreview = { view, _reset() { IX = null; PROPS = null; S.watches = []; S.tagFlip = {}; S.hotErr = ""; } };
})();
