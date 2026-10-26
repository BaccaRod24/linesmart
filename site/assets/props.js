/* LineSmart player props UI: the "Player props" section on game pages and "Prop lines" on player pages.
 * Logic lives in props-core.js (window.PropsCore); data from scripts/props.py (DraftKings lines via ESPN's free API).
 * App helpers come from window.LSApp (app.js), read lazily because this file loads first. */
(() => {
  const C = window.PropsCore;
  const A = () => window.LSApp;
  const SUPPORTED = new Set(["nfl", "nba"]);
  const SHOW = 6;                 // players shown before "Show all"
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const load = lg => A().getJSON(`data/props/${lg}.json`);
  const RW = { o: "Over", u: "Under", p: "Push", x: "No game" };

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
    return `<div class="pp-row" data-mk="${esc(p.mk)}">
      <div class="pp-mk"><span class="pp-lab">${esc(p.label)}</span><span class="pp-line">${esc(C.lineText(p.mk, p.line))}</span>${mv ? `<span class="pp-mv">${esc(mv)}</span>` : ""}</div>
      <div class="pp-strip" role="list" aria-label="Last 5 games vs this line">${s.length ? s.map(b => box(b, p.mk)).join("") : `<span class="pp-none">No games yet this season</span>`}</div>
      <div class="pp-sum"><b class="pp-xs ${cls}">${esc(sm.text)}</b><span>L10 ${l10.n ? `${l10.o}/${l10.n}` : "—"}</span><span>Season ${esc(se.text)}</span></div>
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
    return `<div class="note pp-note">Lines: DraftKings, via ESPN's free odds feed.${when} Prices aren't shown. Past games are graded against the current line, so hit rates describe history, not a prediction. ${doc && doc.historyScope ? `History: ${esc(doc.historyScope)}.` : ""}</div>`;
  }

  /** Placeholder on the game page; mount() fills it. */
  function gameSlot(lg, g) {
    if (!SUPPORTED.has(lg) || !g || g.state !== "pre") return "";
    return `<div class="section-title" id="props">Player props <span class="st-sub">DraftKings · last 5 vs line</span></div><div id="ppBox" class="pp"><div class="card note">Loading player props…</div></div>`;
  }

  async function mountGame(el, lg, g, alive = () => true) {
    let doc = null;
    try { doc = await load(lg); } catch (e) { /* no props file yet */ }
    if (!alive()) return;
    const order = [String(g.away.id), String(g.home.id)];
    const players = doc ? C.byPlayer(doc, g.id, order) : [];
    if (!players.length) {
      el.innerHTML = `<div class="card note">DraftKings hasn't posted player props for this game yet${lg === "nba" ? " (NBA props usually appear the day before tip-off)" : " (NFL props fill in during game week)"}. Check back closer to game time.</div>`;
      return;
    }
    const teams = [[g.away.id, g.away.abbr], [g.home.id, g.home.abbr]];
    const tabs = `<div class="pp-tabs" role="tablist"><button class="on" data-f="">All</button>${teams.map(([id, ab]) => `<button data-f="${esc(id)}">${esc(ab)}</button>`).join("")}</div>`;
    el.innerHTML = tabs + legend + `<div class="pp-list">${players.map(p => playerCard(lg, p)).join("")}</div>`
      + `<button class="pp-more" hidden></button>` + foot(doc);
    let filt = "", open = false;
    const more = el.querySelector(".pp-more");
    const draw = () => {
      const cards = [...el.querySelectorAll(".pp-card")].filter(c => { const m = !filt || c.dataset.team === filt; c.hidden = !m; return m; });
      cards.forEach((c, i) => { if (!open && i >= SHOW) c.hidden = true; });
      more.hidden = open || cards.length <= SHOW;
      more.textContent = `Show all ${cards.length} players`;
    };
    el.querySelectorAll(".pp-tabs button").forEach(b => b.addEventListener("click", () => {
      el.querySelectorAll(".pp-tabs button").forEach(x => x.classList.toggle("on", x === b));
      filt = b.dataset.f; draw();
    }));
    more.addEventListener("click", () => { open = true; draw(); });
    draw();
  }

  /** Player page: "Prop lines" for any upcoming game with DraftKings props. Renders nothing when there are none. */
  async function mountPlayer(el, lg, pid, alive = () => true) {
    if (!SUPPORTED.has(lg) || !el) return;
    let doc = null, idx = null;
    try { [doc, idx] = await Promise.all([load(lg), A().getJSON(`data/${lg}/index.json`).catch(() => null)]); } catch (e) { return; }
    if (!alive()) return;
    const games = C.forPlayer(doc, pid);
    if (!games.length) return;
    const byId = new Map(((idx && idx.games) || []).map(x => [String(x.id), x]));
    el.innerHTML = `<div class="section-title" id="props">Prop lines <span class="st-sub">DraftKings · last 5 vs line</span></div><div class="pp">${legend}` + games.map(({ gid, player }) => {
      const g = byId.get(String(gid));
      const opp = g ? (String(g.home.id) === String(player.t) ? `vs ${g.away.abbr}` : `@ ${g.home.abbr}`) : "";
      const hdr = g ? `<a class="pp-game" href="#/g/${esc(lg)}/${esc(gid)}"><b>${esc(opp)}</b><span>${esc(A().fullET(g.date))}</span><span class="pp-go">Game →</span></a>` : "";
      return hdr + playerCard(lg, player, { noLink: true });
    }).join("") + foot(doc) + `</div>`;
  }

  window.LSProps = { SUPPORTED, gameSlot, mountGame, mountPlayer };
})();
