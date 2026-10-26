/* LineSmart player props UI: the "Player props" section on game pages and "Prop lines" on player pages.
 * Logic lives in props-core.js (window.PropsCore); data from scripts/props.py: DraftKings lines via ESPN's free API, plus
 * Hard Rock Bet + FanDuel lines with prices from The Odds API (paid plan). Books not legal online in the visitor's state are
 * dimmed ("Not available in FL") and never linked; the graded line is the first legal book that posted the prop.
 * App helpers come from window.LSApp (app.js), read lazily because this file loads first. */
(() => {
  const C = window.PropsCore;
  const A = () => window.LSApp;
  const SUPPORTED = new Set(["nfl", "nba"]);
  const SHOW = 6;                 // players shown before "Show all"
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const load = lg => A().getJSON(`data/props/${lg}.json`);
  const RW = { o: "Over", u: "Under", p: "Push", x: "No game" };
  const BK = { draftkings: "DraftKings", hardrockbet: "Hard Rock Bet", fanduel: "FanDuel" };
  const BKS = { draftkings: "DK", hardrockbet: "Hard Rock", fanduel: "FanDuel" };
  const G = () => window.LSGeo || null;
  const avail = k => !G() || G().isAvailable(k);
  // books the visitor can bet, in state order (Florida: Hard Rock Bet only); the first that posted a prop sets its graded line
  const prefer = () => (G() ? G().sortBooks(C.BOOK_ORDER).filter(avail) : null);
  const multi = doc => !!(doc && (doc.altAt || doc.dkPriced)) || ((doc && doc.books) || []).some(k => k !== "draftkings");
  let MULTI = false;   // set per render: the file carries Odds API lines (Hard Rock / FanDuel / DraftKings prices), so show every row's per-book lines
  const am = v => (C.isNum(v) ? (v > 0 ? `+${v}` : `${v}`) : "");

  /** One row's per-book lines: "Hard Rock 31.5  o-115 u-105 · FanDuel 30.5 ... · DK 30.5 (no prices)". */
  function bookLine(p) {
    if (!MULTI || !p.books || !p.books.length) return "";
    const best = C.bestPrice(p.books, p.line, avail), td = p.mk === "anytime_td";
    const one = b => {
      const na = avail(b.key) ? "" : G().naLabel(b.key);
      const px = td ? (C.isNum(b.over) ? `<span class="pp-px${best.over === b.key ? " best" : ""}">Yes ${esc(am(b.over))}</span>` : `<span class="pp-px pp-nopx">no price</span>`)
        : C.isNum(b.over) || C.isNum(b.under) ? `<span class="pp-px${best.over === b.key ? " best" : ""}">o${esc(am(b.over) || "—")}</span><span class="pp-px${best.under === b.key ? " best" : ""}">u${esc(am(b.under) || "—")}</span>`
        : `<span class="pp-px pp-nopx">${b.key === "draftkings" ? "line only (ESPN)" : "no price"}</span>`;
      const ln = td ? "" : `<b>${esc(C.fmtNum(b.line))}</b>`;
      return `<span class="pp-bk${b.key === p.book && !na ? " prim" : ""}${na ? " na" : ""}"${na ? ` title="${esc(na)}"` : ""}><span class="pp-bn">${esc(BKS[b.key] || b.key)}</span>${ln}${px}${na ? `<span class="na-st">${esc(na)}</span>` : ""}</span>`;
    };
    const ord = [...p.books].sort((a, b) => (avail(b.key) - avail(a.key)) || (b.key === p.book) - (a.key === p.book));
    return `<div class="pp-bks" aria-label="Lines by sportsbook">${ord.map(one).join("")}</div>`;
  }

  function box(b, mk) {
    const date = b.d ? A().fmt(b.d + "T12:00:00Z", { month: "short", day: "numeric" }) : "";
    const tip = b.r === "x" ? `${date} ${b.ha} ${b.opp}: did not play / not in box score` : `${date} ${b.ha} ${b.opp}: ${C.fmtNum(b.v)} (${RW[b.r]})`;
    const val = b.r === "x" ? "DNP" : mk === "anytime_td" ? (b.v > 0 ? `${C.fmtNum(b.v)} TD` : "0") : C.fmtNum(b.v);
    return `<span class="pp-b pp-${b.r}" title="${esc(tip)}" aria-label="${esc(tip)}"><b>${esc(val)}</b><i>${esc(b.opp || "")}</i></span>`;
  }

  function propRow(p, log) {
    const s = C.strip(log, p.mk, p.line, 5), sm = C.summary(log, p.mk, p.line, 5), l10 = C.rate(log, p.mk, p.line, 10), se = C.season(p.tally);
    const mv = C.moveText(p.line, p.open);
    const cls = sm.n ? (sm.o / sm.n > 0.5 ? "hot" : sm.o / sm.n < 0.5 ? "cold" : "") : "";
    const hot = C.isHot(log, p.mk, p.line);
    return `<div class="pp-row${hot ? " is-hot" : ""}" data-mk="${esc(p.mk)}" data-hot="${hot ? 1 : 0}">
      <div class="pp-mk"><span class="pp-lab">${esc(p.label)}${MULTI && p.book ? ` <span class="pp-src">${esc(BKS[p.book] || "")}</span>` : ""}</span><span class="pp-line">${esc(C.lineText(p.mk, p.line))}</span>${mv ? `<span class="pp-mv">${esc(mv)}</span>` : ""}</div>
      <div class="pp-strip" role="list" aria-label="Last 5 games vs this line">${s.length ? s.map(b => box(b, p.mk)).join("") : `<span class="pp-none">No games yet this season</span>`}</div>
      <div class="pp-sum">${hot ? `<span class="pp-hot-tag">Hot</span>` : ""}<b class="pp-xs ${cls}">${esc(sm.text)}</b><span>L10 ${l10.n ? `${l10.o}/${l10.n}` : "—"}</span><span>Season ${esc(se.text)}</span></div>
      ${bookLine(p)}
    </div>`;
  }

  function playerCard(lg, pl, opts = {}) {
    return `<div class="pp-card" data-team="${esc(pl.t)}">
      <div class="pp-h">${opts.noLink ? `<b>${esc(pl.n)}</b>` : `<a href="#/p/${esc(lg)}/${esc(pl.pid)}">${esc(pl.n)}</a>`}<span class="pp-meta">${esc([pl.pos, pl.ta].filter(Boolean).join(" · "))}</span></div>
      ${pl.props.map(p => propRow(p, pl.log)).join("")}
    </div>`;
  }

  const legend = `<div class="pp-legend"><span><i class="pp-dot pp-o"></i>Over</span><span><i class="pp-dot pp-u"></i>Under</span><span><i class="pp-dot pp-p"></i>Push / no game</span><span class="pp-lt">Latest game first · graded vs today's line</span></div>`;
  // ESPN's per-line lastUpdated stamps run hours ahead of real time, so show when we last fetched the lines instead.
  function foot(doc) {
    const when = doc && doc.gen ? ` Lines checked ${A().fullET(doc.gen)}.` : "";
    const hist = doc && doc.historyScope ? ` History: ${esc(doc.historyScope)}.` : "";
    if (!multi(doc)) return `<div class="note pp-note">Lines: DraftKings, via ESPN's free odds feed.${when} Prices aren't shown. Past games are graded against the current line, so hit rates describe history, not a prediction.${hist}</div>`;
    const alt = doc.altAt ? ` (last pull ${A().fullET(doc.altAt)})` : "";
    const dkFb = "; when The Odds API has no DraftKings line, DraftKings falls back to ESPN's free feed (line only, no prices), which also gives DraftKings' opening line";
    const ev = G() ? G().current() : null, out = ev && ev.state ? C.BOOK_ORDER.filter(k => !avail(k)) : [];
    const outNote = out.length ? ` ${out.map(k => BK[k]).join(" and ")} ${out.length > 1 ? "don't" : "doesn't"} run a legal online sportsbook in ${esc(ev.stateName)}; ${out.length > 1 ? "their" : "its"} lines are shown dimmed, for reference only.` : "";
    return `<div class="note pp-note">Lines: Hard Rock Bet, FanDuel and DraftKings via The Odds API with prices, refreshed about every 2 h for games in the next 36 h${alt}${dkFb}. Each prop is graded against the first book you can bet in your state that posted it (labelled next to the market); best over/under price on that line is green.${outNote}${when} Past games are graded against the current line, so hit rates describe history, not a prediction.${hist}</div>`;
  }
  /** Section subtitle: the books in this file, legal-in-state first, others tagged "Not available in XX". */
  function subTitle(doc) {
    if (!multi(doc)) return `DraftKings · last 5 vs line${G() ? G().naTag("draftkings") : ""}`;
    const ks = (G() ? G().sortBooks(doc.books) : doc.books).filter(k => BK[k]);
    return ks.map(k => `<span class="${avail(k) ? "" : "pp-na-bk"}">${esc(BK[k])}${avail(k) ? "" : G().naTag(k)}</span>`).join(" · ") + " · last 5 vs line";
  }

  /** Placeholder on the game page; mount() fills it. */
  function gameSlot(lg, g) {
    if (!SUPPORTED.has(lg) || !g || g.state !== "pre") return "";
    return `<div class="section-title" id="props">Player props <span class="st-sub" id="ppSub">last 5 vs line</span></div><div id="ppBox" class="pp"><div class="card note">Loading player props…</div></div>`;
  }

  async function mountGame(el, lg, g, alive = () => true) {
    let doc = null;
    try { doc = await load(lg); } catch (e) { /* no props file yet */ }
    if (!alive()) return;
    const order = [String(g.away.id), String(g.home.id)];
    MULTI = multi(doc);
    const players = doc ? C.byPlayer(doc, g.id, order, prefer()) : [];
    const sub = document.getElementById("ppSub");
    if (sub) sub.innerHTML = doc ? subTitle(doc) : `DraftKings · last 5 vs line${G() ? G().naTag("draftkings") : ""}`;
    if (!players.length) {
      el.innerHTML = `<div class="card note">${doc && multi(doc) ? "No sportsbook has" : "DraftKings hasn't"} posted player props for this game yet${lg === "nba" ? " (NBA props usually appear the day before tip-off)" : " (NFL props fill in during game week)"}. Check back closer to game time.</div>`;
      return;
    }
    const teams = [[g.away.id, g.away.abbr], [g.home.id, g.home.abbr]];
    const mkts = Object.keys(doc.markets || {}).filter(m => players.some(p => p.props.some(x => x.mk === m)));
    const nHot = players.reduce((a, p) => a + p.props.filter(x => C.isHot(p.log, x.mk, x.line)).length, 0);
    const tabs = `<div class="pp-tabs" role="group" aria-label="Team">${[["", "All"], ...teams].map(([id, ab], i) => `<button class="${i ? "" : "on"}" data-f="${esc(id)}" aria-pressed="${!i}">${esc(ab)}</button>`).join("")}`
      + `<button class="pp-hot" data-hot aria-pressed="false" title="Only props that went over in at least 4 of his last 5 games (or all of them, with 2-4 games played)">Hot: 4/5+ over <span class="pp-n">${nHot}</span></button></div>`;
    const chips = mkts.length > 1 ? `<div class="pp-chips" role="group" aria-label="Prop type"><button class="on" data-m="" aria-pressed="true">All props</button>${mkts.map(m => `<button data-m="${esc(m)}" aria-pressed="false">${esc(doc.markets[m][1])}</button>`).join("")}</div>` : "";
    el.innerHTML = tabs + chips + legend + `<div class="pp-list">${players.map(p => playerCard(lg, p)).join("")}</div>`
      + `<div class="card note pp-empty" hidden></div><button class="pp-more" hidden></button>` + foot(doc);
    const f = { team: "", mk: "", hot: false };
    let open = false;
    const more = el.querySelector(".pp-more"), empty = el.querySelector(".pp-empty");
    const draw = () => {
      const cards = [...el.querySelectorAll(".pp-card")].filter(c => {
        let any = false;
        c.querySelectorAll(".pp-row").forEach(r => { const m = (!f.mk || r.dataset.mk === f.mk) && (!f.hot || r.dataset.hot === "1"); r.hidden = !m; any = any || m; });
        const m = any && (!f.team || c.dataset.team === f.team); c.hidden = !m; return m;
      });
      cards.forEach((c, i) => { if (!open && i >= SHOW) c.hidden = true; });
      more.hidden = open || cards.length <= SHOW;
      more.textContent = `Show all ${cards.length} players`;
      empty.hidden = cards.length > 0;
      empty.textContent = f.hot ? "No props over the line in 4 of the last 5 games (or every game, for players with fewer) for this selection." : "No props match this selection.";
    };
    const group = (sel, key, attr) => el.querySelectorAll(sel).forEach(b => b.addEventListener("click", () => {
      el.querySelectorAll(sel).forEach(x => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", String(x === b)); });
      f[key] = b.dataset[attr]; draw();
    }));
    group(".pp-tabs [data-f]", "team", "f");
    group(".pp-chips [data-m]", "mk", "m");
    const hb = el.querySelector(".pp-hot");
    hb.addEventListener("click", () => { f.hot = !f.hot; hb.classList.toggle("on", f.hot); hb.setAttribute("aria-pressed", String(f.hot)); draw(); });
    more.addEventListener("click", () => { open = true; draw(); });
    draw();
  }

  /** Player page: "Prop lines" for any upcoming game with props (DraftKings / Hard Rock Bet / FanDuel). Renders nothing when there are none. */
  async function mountPlayer(el, lg, pid, alive = () => true) {
    if (!SUPPORTED.has(lg) || !el) return;
    let doc = null, idx = null;
    try { [doc, idx] = await Promise.all([load(lg), A().getJSON(`data/${lg}/index.json`).catch(() => null)]); } catch (e) { return; }
    if (!alive()) return;
    MULTI = multi(doc);
    const games = C.forPlayer(doc, pid, prefer());
    if (!games.length) return;
    const byId = new Map(((idx && idx.games) || []).map(x => [String(x.id), x]));
    el.innerHTML = `<div class="section-title" id="props">Prop lines <span class="st-sub">${subTitle(doc)}</span></div><div class="pp">${legend}` + games.map(({ gid, player }) => {
      const g = byId.get(String(gid));
      const opp = g ? (String(g.home.id) === String(player.t) ? `vs ${g.away.abbr}` : `@ ${g.home.abbr}`) : "";
      const hdr = g ? `<a class="pp-game" href="#/g/${esc(lg)}/${esc(gid)}"><b>${esc(opp)}</b><span>${esc(A().fullET(g.date))}</span><span class="pp-go">Game →</span></a>` : "";
      return hdr + playerCard(lg, player, { noLink: true });
    }).join("") + foot(doc) + `</div>`;
  }

  window.LSProps = { SUPPORTED, gameSlot, mountGame, mountPlayer };
})();
