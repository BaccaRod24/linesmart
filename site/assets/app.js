/* LineSmart front-end: hash-routed static SPA reading ./data/*.json (built by scripts/build_data.py) */
(() => {
  const CFG = window.SITE_CONFIG || { name: "LineSmart", timeZone: "America/New_York", tzLabel: "ET" };
  const TZ = CFG.timeZone, TZL = CFG.tzLabel || "ET";
  const app = document.getElementById("app");
  const cache = {}, cacheAt = {};
  const DATA_TTL_MS = 60000;   // parsed data/*.json is reused for 60 s, then revalidated (was: kept until a full reload)
  let netGen = 0;  // bumped when the browser comes back online
  let META = null;
  let PREV = {};   // data/previews.json from scripts/previews.py: {leagues: {lg: {gameId: "preview/lg/slug/"}}}; absent locally → no links
  const previewHref = (lg, id) => ((PREV.leagues || {})[lg] || {})[id] || null;
  const previewLink = (lg, g, cls = "pv-tile") => { const h = g && g.state === "pre" ? previewHref(lg, g.id) : null; return h ? `<a class="${cls}" href="${esc(h)}" title="Game preview: odds, line movement, form and injuries" aria-label="${esc(`Preview: ${g.away.name} at ${g.home.name}`)}">Preview</a>` : ""; };
  // ---------- live scores (assets/live.js + live-core.js): overlays newer than the static file win
  const GENS = {};                       // league -> generated stamp of its data/<lg>/index.json
  const LV = () => window.LSLive || null;
  const liveG = (lg, g) => (LV() ? LV().merge(lg, g, GENS[lg]) : g);
  const TILES = {}, TICKS = {};          // "lg/id" -> static game / ticker item last rendered (re-rendered on live updates)

  if (!document.title.startsWith(CFG.name)) document.title = CFG.name;   // keep the descriptive static <title> (SEO)
  const intro = document.getElementById("intro");
  if (intro) intro.classList.add("js");
  document.querySelectorAll("[data-brand]").forEach(e => (e.textContent = CFG.name));
  document.querySelectorAll("[data-brand-alt]").forEach(e => (e.alt = CFG.name));
  document.querySelectorAll("[data-brand-title]").forEach(e => (e.title = CFG.name + " — home"));
  document.querySelectorAll("[data-tagline]").forEach(e => (e.textContent = CFG.tagline || ""));

  // ---------- utils
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const NA = '<span class="na">N/A</span>';
  const isNum = v => v !== null && v !== undefined && v !== "" && !isNaN(v);
  const am = v => (isNum(v) ? (v > 0 ? "+" + v : String(v)) : null);
  const line = v => (isNum(v) ? (v > 0 ? "+" + v : v === 0 ? "PK" : String(v)) : null);
  const fx = (v, d = 1) => (isNum(v) ? Number(v).toFixed(d) : null);
  const getJSON = async url => {
    if (cache[url] && Date.now() - (cacheAt[url] || 0) < DATA_TTL_MS) return cache[url];
    const gen = netGen, r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) throw new Error(url + " " + r.status);
    if (r.headers.get("X-LineSmart-Offline") && gen === netGen) showOffline();  // ignore a stale offline reply that started before we came back online
    const j = await r.json(); cacheAt[url] = Date.now();
    const m = /^data\/([a-z0-9]+)\/index\.json$/.exec(url); if (m && j && j.generated) GENS[m[1]] = j.generated;
    return (cache[url] = j);
  };
  const fmt = (iso, opts) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, ...opts }).format(new Date(iso));
  const dayKey = iso => fmt(iso, { year: "numeric", month: "2-digit", day: "2-digit" });
  const dayLabel = iso => {
    const k = dayKey(iso), today = dayKey(new Date().toISOString()), tmr = dayKey(new Date(Date.now() + 864e5).toISOString());
    const base = fmt(iso, { weekday: "long", month: "short", day: "numeric" });
    return k === today ? `Today · ${base}` : k === tmr ? `Tomorrow · ${base}` : base;
  };
  const timeET = iso => fmt(iso, { hour: "numeric", minute: "2-digit" }) + " " + TZL;
  const fullET = iso => fmt(iso, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " " + TZL;
  // keep-last-good fallback (scripts/lastgood.py): the build couldn't reach ESPN for this league, so these games are the
  // last good copy. st = index.stale or game.stale ({asOf, reason}).
  const staleNote = (st, what = "games") => st && st.asOf ? `<div class="stale-note" role="status"><b>Delayed data.</b> The ESPN feed didn't load on the latest refresh, so these ${esc(what)} are from the last good update (${esc(fullET(st.asOf))}). Times, scores and lines may be out of date; they'll update automatically once the feed is back.</div>` : "";
  const addStale = (st, what) => {   // views rendered by other modules (UFC): put the note under the page heading
    const h = staleNote(st, what); if (!h) return;
    const at = app.querySelector(".page-head, .match");
    if (at) at.insertAdjacentHTML("afterend", h); else app.insertAdjacentHTML("afterbegin", h);
  };
  const unitWord = kind => ({ football: "Pts", basketball: "Pts", hockey: "Goals", soccer: "Goals", baseball: "Runs" }[kind] || "Pts");
  const formDots = f => (f ? `<span class="form" title="Last ${f.length}: ${esc(f)} (most recent first)">${[...f].map(c => `<i class="f-${c}"></i>`).join("")}</span>` : "");
  const rec = (a, kind) => (!a ? null : kind === "soccer" ? `${a.w}-${a.d}-${a.l}` : a.d ? `${a.w}-${a.l}-${a.d}` : `${a.w}-${a.l}`);
  const logo = (t, cls = "") => (t && t.logo ? `<img class="${cls}" src="${esc(t.logo)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : `<span class="${cls}"></span>`);

  // ---------- nav
  // active: a league key, HOME (the dashboard: the "All" pill lights up, no league does) or null (no pill lit)
  const HOME = "@home";
  function renderTabs(active) {
    const tabs = document.getElementById("leagueTabs");
    const all = Object.values(META.leagues || {}).reduce((a, L) => a + (L.upcoming || 0), 0);
    const homeOn = active === HOME;
    tabs.innerHTML = `<a class="tab tab-all ${homeOn ? "active" : ""}" href="#/" title="Home: today's slate across all leagues"${homeOn ? ' aria-current="page"' : ""}>All<span class="cnt">${all}</span></a>` + META.order.map(k => {
      const L = META.leagues[k] || {};
      const off = !L.games, on = k === active;
      return `<a class="tab ${on ? "active" : ""} ${off ? "off" : ""}" href="#/l/${k}" title="${esc(L.full || "")}"${on ? ' aria-current="page"' : ""}>${esc(L.name || k.toUpperCase())}<span class="cnt">${L.upcoming ?? 0}</span></a>`;
    }).join("");
    const nav = document.getElementById("leagueNav"), a = tabs.querySelector(".active");
    if (nav && a) {   // bring the active pill into view inside the row only (scrollIntoView would also scroll the page)
      const want = a.offsetLeft - (nav.clientWidth - a.offsetWidth) / 2;
      nav.scrollTo({ left: Math.max(0, want), behavior: "instant" });
    } else if (nav && homeOn) nav.scrollTo({ left: 0, behavior: "instant" });
    lnavEdges();
  }
  // swipe affordance: fade + chevron on whichever side has more pills off-screen
  function lnavEdges() {
    const nav = document.getElementById("leagueNav"), box = nav && nav.parentElement; if (!box || !box.classList.contains("lnav")) return;
    const max = nav.scrollWidth - nav.clientWidth;
    box.classList.toggle("more-l", nav.scrollLeft > 4);
    box.classList.toggle("more-r", nav.scrollLeft < max - 4);
  }
  (() => {
    const nav = document.getElementById("leagueNav"); if (!nav) return;
    nav.addEventListener("scroll", lnavEdges, { passive: true });
    window.addEventListener("resize", lnavEdges);
    document.querySelectorAll("[data-lnav]").forEach(b => b.addEventListener("click", () =>
      nav.scrollBy({ left: (b.dataset.lnav === "r" ? 1 : -1) * Math.max(160, nav.clientWidth * 0.7), behavior: "smooth" })));
  })();

  // ---------- odds snippets
  // ---------- line movement helpers
  // g.move is built server-side (scripts/line_history.py); fall back to ESPN's open line in g.odds.
  function moveOf(g) {
    if (g.move) return g.move;
    const o = g.odds; if (!o) return null;
    const m = { book: o.provider, notable: [] };
    if (isNum(o.homeSpreadOpen) && isNum(o.homeSpread)) m.spread = { open: o.homeSpreadOpen, cur: o.homeSpread, delta: o.homeSpread - o.homeSpreadOpen };
    if (isNum(o.totalOpen) && isNum(o.total)) m.total = { open: o.totalOpen, cur: o.total, delta: o.total - o.totalOpen };
    return m;
  }
  const arrow = (delta, title) => (!isNum(delta) || Math.abs(delta) < 1e-9 ? "" : `<i class="mv ${delta > 0 ? "up" : "dn"}" title="${esc(title + ` (${delta > 0 ? "+" : ""}${+delta.toFixed(2)})`)}">${delta > 0 ? "▲" : "▼"}</i>`);
  const spreadArrow = (g, side) => {
    const m = moveOf(g); if (!m || !m.spread) return "";
    const sgn = side === "home" ? 1 : -1, t = g[side];
    return arrow(sgn * m.spread.delta, `${t.abbr} opened ${line(sgn * m.spread.open)}, now ${line(sgn * m.spread.cur)}`);
  };
  const totalArrow = g => { const m = moveOf(g); return m && m.total ? arrow(m.total.delta, `Total opened ${m.total.open}, now ${m.total.cur}`) : ""; };
  const notableBadge = g => { const m = moveOf(g); return m && (m.notable || []).length ? `<span class="mvbadge" title="${esc(m.notable.join(" · "))}">⚡ Line move</span>` : ""; };
  // pick'em note (assets/pickem-core.js): close game where books disagree on the spread favorite. Display only; lines untouched.
  const PK_TEXT = "Pick'em: books differ on the favorite";
  const pkSplit = (g, kind) => (window.PickemCore ? window.PickemCore.split(g, kind) : null);
  const pkWho = (g, s) => [["away", g.away], ["home", g.home]].map(([side, t]) => { const xs = s[side]; const ls = [...new Set(xs.map(x => line(x.line)))];
    return `${xs.map(x => BOOKNAME(x.book)).join(" and ")} ${xs.length > 1 ? "have" : "has"} ${t.abbr} ${ls.join(" / ")}`; }).join("; ");
  const pkTile = (g, kind) => { const s = pkSplit(g, kind); return s ? `<div class="pk-note" title="${esc(pkWho(g, s))}">${esc(PK_TEXT)}</div>` : ""; };
  const pkCard = (g, kind) => { const s = pkSplit(g, kind); return s ? `<div class="pk-note pk-detail"><span><b>${esc(PK_TEXT)}.</b> ${esc(pkWho(g, s))}. Close game, so the books lean different ways. Every line below is shown as posted.</span></div>` : ""; };

  // sparkline: tiny inline SVG of a line's path since open (move.spark from scripts/line_history.py)
  const ICON = (id, cls = "ic") => `<svg class="${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
  function sparkSvg(vals, W = 44, H = 16) {
    const v = (vals || []).filter(isNum).map(Number);
    if (v.length < 2) return "";
    const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1, p = 2;
    const pts = v.map((y, i) => [(i * (W - 2 * p)) / (v.length - 1) + p, hi === lo ? H / 2 : H - p - ((y - lo) * (H - 2 * p)) / span]);
    const d = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" "), [ex, ey] = pts[pts.length - 1];
    return `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true"><polygon class="area" points="${p},${H} ${d} ${W - p},${H}"/><polyline points="${d}"/><circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="1.9"/></svg>`;
  }
  function sparks(g) {
    const m = g.move, sk = m && m.spark; if (!sk) return "";
    const one = (lbl, vals, title) => {
      const svg = sparkSvg(vals); if (!svg) return "";
      const d = vals[vals.length - 1] - vals[0], dir = Math.abs(d) < 1e-9 ? "flat" : d > 0 ? "up" : "dn";
      return `<span class="spk ${dir}" title="${esc(title)}">${lbl}${svg}</span>`;
    };
    const sp = sk.spread && m.spread ? one("SPR", sk.spread, `${g.home.abbr} spread: opened ${line(m.spread.open)}, now ${line(m.spread.cur)}`) : "";
    const tt = sk.total && m.total ? one("TOT", sk.total, `Total: opened ${m.total.open}, now ${m.total.cur}`) : "";
    return sp || tt ? `<span class="spks" aria-label="Line movement since open">${sp}${tt}</span>` : "";
  }

  // odds chip: main value (+ move arrow) and an optional price underneath
  const chip = (main, sub, extra = "") => (main === null || main === undefined
    ? `<span class="oc na-oc" aria-label="not available">—</span>`
    : `<span class="oc"><b>${main}${extra}</b>${sub ? `<small>${sub}</small>` : ""}</span>`);
  const spreadLabelOf = kind => (kind === "hockey" ? "Puck line" : kind === "baseball" ? "Run line" : "Spread");

  function statusHtml(g) {
    if (g.state === "in") return `<span class="status live">LIVE · ${esc(g.statusDetail || "")}</span>`;
    if (g.state === "post") return `<span class="status final">${esc(g.statusDetail || "Final")}</span>`;
    return `<span class="status">${timeET(g.date)}</span>`;
  }

  function teamRow(t, g, side, kind) {
    const o = g.odds, showScore = g.state !== "pre" && t.score != null;
    const other = side === "home" ? g.away : g.home;
    const lose = g.state === "post" && isNum(t.score) && isNum(other.score) && +t.score < +other.score;
    let chips = "";
    if (o) {
      const tot = side === "away" ? chip(isNum(o.total) ? "O " + fx(o.total, 1) : null, am(o.overOdds), totalArrow(g))
                                  : chip(isNum(o.total) ? "U " + fx(o.total, 1) : null, am(o.underOdds));
      chips = kind === "soccer" ? chip(am(o[side + "ML"])) + tot
        : chip(line(o[side + "Spread"]), am(o[side + "SpreadOdds"]), spreadArrow(g, side)) + chip(am(o[side + "ML"])) + tot;
    }
    const poss = g.state === "in" && g.live && g.live.situation && g.live.situation.possession && String(g.live.situation.possession) === String(t.id) ? `<span class="poss" title="Possession"><span class="sr-only">(has the ball)</span></span>` : "";
    return `<div class="trow ${lose ? "lose" : ""}">${logo(t, "tl")}<div class="tn"><div class="tname">${t.rank ? `<span class="rk">#${t.rank}</span>` : ""}<span class="nm-l">${esc(t.name)}</span><span class="nm-s">${esc(t.short || t.name)}</span>${poss}</div>
      <div class="tmeta">${esc(t.record || "—")}${formDots(t.form)}</div></div>
      <div class="tscore">${showScore ? esc(t.score) : ""}</div>${chips}</div>`;
  }

  function sitLine(g, cls = "lv-sit") {
    const s = g.live && g.state === "in" && g.live.situation;
    return s && s.text ? `<div class="${cls}${s.redZone ? " rz" : ""}">${esc(s.text)}</div>` : "";
  }
  function gameTile(g, key, kind) {
    TILES[`${key}/${g.id}`] = { g, kind }; g = liveG(key, g);
    const o = g.odds, soccer = kind === "soccer";
    const cols = !o ? [] : soccer ? ["1X2", "Total"] : [spreadLabelOf(kind), "Money", "Total"];
    const head = cols.length ? `<div class="gt-head"><span></span><span></span><span></span>${cols.map(c => `<span>${esc(c)}</span>`).join("")}</div>` : "";
    const draw = soccer && o ? `<div class="trow draw"><span class="tl"></span><div class="tn"><div class="tname">Draw</div></div><div class="tscore"></div>${chip(am(o.drawML))}<span></span></div>` : "";
    const live = k => { const b = (g.books || {})[k]; return b && !b.stale && b.asOf; };   // pre-game Odds API line (Hard Rock / FanDuel)
    const mv = moveOf(g), hasMv = mv && (mv.spread || mv.total);
    const wx = window.LSWeather && g.state !== "post" ? window.LSWeather.chip(g) : "";
    const pk = GEO() ? GEO().providerKey(o && o.provider) : null, pNa = pk && !bookAvail(pk) ? GEO().naLabel(pk) : "";
    const pTag = o ? `<span class="bk${pNa ? " bk-na" : ""}"${pNa ? ` title="${esc(pNa)}"` : ""}>${esc(o.provider || "provider n/a")}${pNa ? `<span class="sr-only"> (${esc(pNa)})</span>` : ""}</span>` : "", altTag = (k, cls, name) => { if (!live(k)) return ""; const na = bookAvail(k) ? "" : GEO().naLabel(k);
      return `<span class="bk ${cls}${na ? " bk-na" : ""}"${na ? ` title="${esc(na)}"` : ""}>${name}${na ? `<span class="sr-only"> (${esc(na)})</span>` : ""}</span>`; };
    // legal-in-your-state books first (Florida: Hard Rock Bet, then the dimmed DraftKings / FanDuel)
    const tags = [[pk || "espn", pTag], ["hardrockbet", altTag("hardrockbet", "hr", "Hard Rock Bet")], ["fanduel", altTag("fanduel", "fd", "FanDuel")]]
      .sort((a, b) => (bookAvail(b[0]) ? 1 : 0) - (bookAvail(a[0]) ? 1 : 0)).map(t => t[1]).join("");
    const foot = o ? `<div class="tfoot${wx ? " has-wx" : ""}">${tags}${sparks(g)}<span class="hint">${hasMv ? "▲▼ move since open" : soccer ? "3-way moneyline" : ""}</span>${wx}</div>`
                   : `<div class="noline">Lines not posted yet</div>${wx ? `<div class="tfoot has-wx wx-only">${wx}</div>` : ""}`;
    const net = esc([g.note, (g.broadcasts || []).slice(0, 2).join(", ")].filter(Boolean).join(" · "));
    const bell = window.LSAlerts && o ? window.LSAlerts.tileBell(key, g) : "", pv = previewLink(key, g), wrap = bell || pv;
    return `${wrap ? `<div class="gwrap${pv ? " has-pv" : ""}${bell ? " has-bell" : ""}">` : ""}<a class="game c${cols.length}${g.state === "in" ? " is-live" : ""}" href="#/g/${key}/${g.id}" aria-label="${esc(g.away.name)} at ${esc(g.home.name)}">
      <div class="game-top">${statusHtml(g)}${g.state === "pre" ? notableBadge(g) : ""}<span class="net">${net}</span></div>
      ${head}${teamRow(g.away, g, "away", kind)}${draw}${teamRow(g.home, g, "home", kind)}${sitLine(g)}${foot}${o ? pkTile(g, kind) : ""}</a>${wrap ? `${bell}${pv}</div>` : ""}`;
  }

  // ---------- live scores: hero, box score, poller wiring
  function heroMid(g) {
    const s = g.live && g.state === "in" && g.live.situation, lp = s && s.lastPlay;
    return `<div class="lv-mid"><div class="score">${esc(g.away.score)} – ${esc(g.home.score)}</div><div class="when${g.state === "in" ? " is-live" : ""}">${g.state === "in" ? '<span class="live-dot"></span>' : ""}${esc(g.statusDetail || "")}</div>${sitLine(g)}${lp ? `<div class="where lv-lp" title="Last play">${esc(lp)}</div>` : ""}</div>`;
  }
  const REG_PERIODS = { football: 4, basketball: 4, hockey: 3, soccer: 2, baseball: 9 };
  function liveBoxHtml(box, A, H, kind, g, lg) {
    const fin = g.state === "post", title = fin ? "Final box score" : "Live box score";
    const stamp = `<span class="st-sub lv-stamp" data-lv-stamp>${fin ? "ESPN" : "Connecting to live data…"}</span>`;
    if (!box) return `<div class="section-title">${title} ${stamp}</div><div class="card note lbx-wait">${fin ? "Loading the box score from ESPN…" : "Loading live stats from ESPN… Scores update about every 25 seconds while the game is live."}</div>`;
    const ov = g.live || {}, ha = ov.away || {}, hh = ov.home || {};
    const reg = lg === "ncaab" ? 2 : REG_PERIODS[kind] || 4, n = Math.max(box.periods || 0, (ha.linescores || []).length, (hh.linescores || []).length);
    const plab = i => (i < reg || kind === "baseball" ? String(i + 1) : kind === "soccer" ? (i === 2 ? "ET" : "PK") : i === reg ? "OT" : `${i - reg + 1}OT`);
    const rhe = kind === "baseball", cell = (t, i) => `<td class="num">${esc(((t.linescores || [])[i]) ?? "")}</td>`;
    const lrow = (T, t) => `<tr><td>${logo(T, "tlogo")}${esc(T.abbr)}</td>${Array.from({ length: n }, (_, i) => cell(t, i)).join("")}<td class="num tot">${esc(t.score ?? T.score ?? "")}</td>${rhe ? `<td class="num">${esc(t.hits ?? "")}</td><td class="num">${esc(t.errors ?? "")}</td>` : ""}</tr>`;
    const lines = n ? `<div class="tbl-wrap"><table class="lbx-ls"><thead><tr><th></th>${Array.from({ length: n }, (_, i) => `<th>${plab(i)}</th>`).join("")}<th>${rhe ? "R" : "T"}</th>${rhe ? "<th>H</th><th>E</th>" : ""}</tr></thead><tbody>${lrow(A, ha)}${lrow(H, hh)}</tbody></table></div>` : "";
    const sa = box.away.stats, sh = box.home.stats, labels = [...new Set([...sa, ...sh].map(r => r.label))].slice(0, 16);
    const v = (arr, l) => (arr.find(r => r.label === l) || {}).value;
    const tstats = labels.length ? `<div class="card"><h3>Team stats</h3>${cmpTable(A, H, labels.map(l => ({ label: l, a: v(sa, l), h: v(sh, l) })))}</div>` : "";
    const grp = gp => `<div class="lbx-g"><h4>${esc(gp.title)}</h4><div class="tbl-wrap"><table class="lbx-t"><thead><tr><th>Player</th>${gp.labels.map(l => `<th>${esc(l)}</th>`).join("")}</tr></thead><tbody>${gp.rows.map(r => `<tr><td>${r.id ? `<a class="lnk" href="#/p/${esc(lg)}/${esc(r.id)}">${esc(r.name)}</a>` : esc(r.name)}</td>${r.stats.map(x => `<td class="num">${esc(x)}</td>`).join("")}</tr>`).join("")}${gp.totals && kind !== "football" ? `<tr class="tot"><td>Team</td>${gp.totals.map(x => `<td class="num">${esc(x)}</td>`).join("")}</tr>` : ""}</tbody></table></div>${gp.more ? `<div class="note">+${gp.more} more</div>` : ""}</div>`;
    const pcard = (T, t) => (t.players.length ? `<div class="card lbx-p"><h3>${logo(T)}${esc(T.name || T.abbr)}</h3>${t.players.map(grp).join("")}</div>` : "");
    const players = box.away.players.length || box.home.players.length ? `<div class="cols">${pcard(A, box.away)}${pcard(H, box.home)}</div>` : "";
    return `<div class="section-title">${title} ${stamp}</div><div class="card lbx-lines">${lines || '<div class="note">No line score yet.</div>'}</div>${tstats}${players}
      <div class="note">${fin ? "Final stats from ESPN." : "Live from ESPN: scores about every 25 s, box score about every 30 s while this tab is open (paused in the background)."}</div>`;
  }
  // Start polling for the games on screen (no-op when none is live). sum = the open game page, if any.
  function startLive(games, sum) {
    const L = LV(); if (!L) return;
    const tok = NAV;
    const alive = () => tok === NAV;
    const patch = keys => {
      if (!alive()) return;
      for (const k of keys) {
        const [lg] = k.split("/"), T = TILES[k];
        if (T) app.querySelectorAll(`a.game[href="#/g/${k}"]`).forEach(el => { const w = el.parentElement && el.parentElement.classList.contains("gwrap") ? el.parentElement : el; w.outerHTML = gameTile(T.g, lg, T.kind); });   // a pre-game tile wrapped with its alert bell is replaced whole
        const t = TICKS[k];
        if (t && tickerOne) document.querySelectorAll(`a.tk[data-lk="${k}"]`).forEach(el => (el.outerHTML = tickerOne(t, !!el.closest('[aria-hidden="true"]'))));
        if (sum && k === `${sum.lg}/${sum.id}`) { const m = app.querySelector(".match .lv-mid"); if (m) m.outerHTML = heroMid(liveG(sum.lg, sum.g)); }
      }
      const lbl = document.querySelector(".ticker .tl-t");
      if (lbl) { const on = Object.values(TICKS).some(t => (L.mergeTicker(t, (META || {}).generated) || {}).st === "in"); lbl.textContent = on ? "LIVE" : "SCORES"; }
    };
    L.watch({
      games: games.filter(Boolean),
      summary: sum ? { lg: sum.lg, id: sum.id, state: sum.g.state, date: sum.g.date } : null,
      onChange: patch,
      onSummary: model => {
        const el = alive() && document.getElementById("liveBox"); if (!el) return;
        el.innerHTML = liveBoxHtml(model.box, sum.A, sum.H, sum.kind, liveG(sum.lg, sum.g), sum.lg);
      },
      // ESPN unreachable: re-read our own (GitHub Actions-built) data files instead
      onStatic: async lgs => {
        if (!alive()) return null;
        const keys = [];
        for (const lg of lgs) {
          delete cache[`data/${lg}/index.json`];
          const d = await getJSON(`data/${lg}/index.json`).catch(() => null); if (!d || !alive()) continue;
          for (const ng of d.games || []) {
            const k = `${lg}/${ng.id}`;
            if (TILES[k]) { TILES[k].g = ng; keys.push(k); }
            if (TICKS[k]) { TICKS[k] = Object.assign({}, TICKS[k], { st: ng.state, det: ng.statusDetail, a: Object.assign({}, TICKS[k].a, { s: ng.away.score }), h: Object.assign({}, TICKS[k].h, { s: ng.home.score }) }); keys.push(k); }
            if (sum && sum.lg === lg && String(ng.id) === sum.id) { sum.g = Object.assign({}, sum.g, { state: ng.state, statusDetail: ng.statusDetail, home: Object.assign({}, sum.g.home, { score: ng.home.score }), away: Object.assign({}, sum.g.away, { score: ng.away.score }) }); keys.push(k); }
          }
          GENS[lg] = d.generated || GENS[lg];
        }
        patch([...new Set(keys)]);
        return games.map(x => { const k = `${x.lg}/${x.id}`, T = TILES[k], t = TICKS[k]; return T ? { lg: x.lg, id: x.id, state: T.g.state, date: T.g.date } : t ? { lg: x.lg, id: x.id, state: t.st, date: t.d } : x; });
      },
    });
  }
  const liveRef = (lg, g) => ({ lg, id: String(g.id), state: g.state, date: g.date });

  // ---------- skeleton loaders (shown while JSON loads)
  const skTile = `<div class="skel-tile"><span class="sk" style="width:40%;height:12px"></span>${'<div class="r"><span class="sk"></span><span class="sk"></span><span class="sk c"></span><span class="sk c"></span><span class="sk c"></span></div>'.repeat(2)}</div>`;
  const skelLeague = () => `<div class="loading" aria-busy="true"><span class="sr-only">Loading games…</span><div class="skel-head"><span class="sk"></span><span class="sk"></span></div><div class="grid">${skTile.repeat(6)}</div></div>`;
  const skelGame = () => `<div class="loading" aria-busy="true"><span class="sr-only">Loading matchup…</span><span class="sk skel-hero"></span><div class="skel-cols"><span class="sk"></span><span class="sk"></span></div></div>`;
  const showSkel = html => { if (!app.querySelector(".loading")) app.innerHTML = html; };
  const teamColor = (t, fb) => (/^[0-9a-f]{6}$/i.test(t.color || "") ? "#" + t.color : fb);

  // ---------- home: scores ticker + "Today's slate" (meta.slate from scripts/slate.py; falls back to meta counts)
  let tickerOne = null;
  function tickerHtml(S) {
    const items = (S && S.ticker) || [];
    if (!items.length) return "";
    const one = (t0, hide) => {
      TICKS[`${t0.lg}/${t0.id}`] = t0; const t = LV() ? LV().mergeTicker(t0, (META || {}).generated) : t0;
      const lgN = esc((META.leagues[t.lg] || {}).name || t.lg.toUpperCase());
      const sc = t.st !== "pre" && t.a.s != null && t.h.s != null;
      const aw = sc && +t.a.s > +t.h.s, hw = sc && +t.h.s > +t.a.s;
      const mid = sc ? `<span class="${aw ? "w" : hw ? "l" : ""}">${esc(t.a.a)} <b>${esc(t.a.s)}</b></span><span class="${hw ? "w" : aw ? "l" : ""}">${esc(t.h.a)} <b>${esc(t.h.s)}</b></span>`
                     : `<span>${esc(t.a.a)} @ ${esc(t.h.a)}</span>`;
      const st = t.st === "in" ? `<span class="live-dot"></span><span class="ts">${esc(t.det || "Live")}</span>` : t.st === "post" ? `<span class="ts">${esc(t.det || "Final")}</span>`
               : `<span class="ts">${esc(dayKey(t.d) === dayKey(new Date().toISOString()) ? timeET(t.d) : fmt(t.d, { weekday: "short" }) + " " + timeET(t.d))}</span>`;
      return `<a class="tk${t.st === "in" ? " live" : ""}" data-lk="${esc(t.lg)}/${esc(t.id)}" href="#/g/${esc(t.lg)}/${esc(t.id)}"${hide ? ' tabindex="-1"' : ""}><i>${lgN}</i>${mid}${st}</a>`;
    };
    tickerOne = one;
    const set = hide => `<div class="tk-set"${hide ? ' aria-hidden="true"' : ""}>${items.map(t => one(t, hide)).join("")}</div>`;
    const live = items.some(t => t.st === "in");
    return `<div class="ticker" role="region" aria-label="Scores ticker"><span class="tk-lbl">${live ? '<span class="live-dot"></span>' : ICON("pulse", "ic")}<span class="tl-t">${live ? "LIVE" : "SCORES"}</span></span>
      <div class="tk-vp"><div class="tk-track" style="--tk-dur:${Math.max(30, items.length * 5)}s">${set(false)}${set(true)}</div></div></div>`;
  }
  // home quick links to the tools that otherwise hide behind a game page or the Account page
  function toolsHtml() {
    const t = (href, icon, name, sub) => `<a class="tool" href="${href}">${ICON(icon)}<span><b>${esc(name)}</b><small>${esc(sub)}</small></span></a>`;
    return `<nav class="tools" aria-label="Tools">${[
      META.previews ? t("preview/", "doc", "Game previews", "Lines, form and injuries per game") : "",
      t("#/account/alerts", "bell", "Line alerts", "Email me when a line moves"),
      t("#/bets", "ticket", "Bet tracker", "Track bets or import a slip"),
    ].join("")}</nav>`;
  }
  function slateHtml() {
    const S = META.slate, L = META.leagues || {};
    const sum = k => Object.values(L).reduce((a, x) => a + (x[k] || 0), 0);
    const T = (S && S.totals) || { upcoming: sum("upcoming"), props: Object.values(META.props || {}).reduce((a, x) => a + (x.props || 0), 0) };
    const ldat = k => ((S && S.leagues) || {})[k] || {};
    const stat = (cls, icon, label, val, sub, href) => (val === undefined || val === null ? "" :
      `<${href ? `a href="${href}"` : "div"} class="st ${cls}${href ? " st-go" : ""}"><span class="mlbl">${ICON(icon)}${esc(label)}</span><b>${esc(val)}</b>${sub ? `<small>${sub}</small>` : ""}</${href ? "a" : "div"}>`);
    const today = S && S.day ? new Date(S.day + "T12:00:00Z").toISOString() : new Date().toISOString();
    const propLgs = Object.entries((S && S.leagues) || {}).filter(([, e]) => e.props).map(([k]) => esc((L[k] || {}).name || k)).join(" · ");
    const stats = [
      stat("", "cal", S ? "Games today" : "Upcoming", S ? T.today : T.upcoming, S ? `${esc(T.upcoming)} upcoming` : ""),
      stat(T.live ? "live" : "", "pulse", "Live now", S ? T.live : null, (T.live ? "in progress" : "none right now") + ' <span class="st-arrow">· see all ›</span>', "#/live"),
      stat("", "layers", "Props tracked", T.props, propLgs || "DraftKings"),
      stat("hot", "bolt", "Hot props", S ? T.hot : null, "4/5+ over"),
      stat("wxw", "cloud", "Weather watch", S ? T.wxWatch : null, "wind · cold · rain"),
    ].join("");
    // league chips: who plays today (needs meta.slate; the tabs above already carry upcoming counts)
    const chips = META.order.filter(k => ldat(k).today).map(k => {
      const x = L[k] || {}, e = ldat(k);
      return `<a class="lgc" href="#/l/${k}" title="${esc(x.full || "")} · ${esc(e.today)} today${e.live ? `, ${esc(e.live)} live` : ""}">${e.live ? '<span class="live-dot"></span>' : ""}${esc(x.name || k.toUpperCase())}<span class="n today">${esc(e.today)}<small>today</small></span></a>`;
    }).join("");
    return `${tickerHtml(S)}<section class="slate" aria-label="Today's slate"><div class="sl-head"><div><span class="eyebrow">${ICON("trend", "ic")}Today's slate</span>
      <div class="sl-title">${esc(fmt(today, { weekday: "long", month: "long", day: "numeric" }))}</div><div class="sl-sub">Lines, props and form across ${META.order.length} leagues · times in ${TZL}</div></div></div>
      <div class="sl-stats">${stats}</div>${chips ? `<nav class="sl-lgs" aria-label="Leagues playing today">${chips}</nav>` : ""}</section>${toolsHtml()}${window.LSAdv ? window.LSAdv.valueSpots(META) : ""}`;
  }

  // ---------- league view
  async function viewLeague(key, home = false) {
    renderTabs(home ? HOME : key);
    const L = META.leagues[key];
    if (!cache[`data/${key}/index.json`]) showSkel(skelLeague());
    if (!L) return (app.innerHTML = `<div class="empty"><h3>Unknown league</h3></div>`);
    let data;
    try { data = await getJSON(`data/${key}/index.json`); }
    catch (e) { return (app.innerHTML = `<div class="page-head"><h1>${esc(L.full)}</h1></div><div class="empty"><h3>No data file for ${esc(L.name)}</h3>Run <code>python3 scripts/build_data.py</code> to refresh.${L.error ? "<br>" + esc(L.error) : ""}</div>`); }
    const kind = data.league.kind;
    const filter = sessionStorage.getItem("filter-" + key) || "upcoming";
    if (kind === "mma" && window.LSUfc) {   // UFC: fight cards grouped by event and main card / prelims (assets/ufc.js)
      app.innerHTML = window.LSUfc.league(data, key, filter);
      addStale(data.stale, "fights");
      app.querySelectorAll(".seg button").forEach(b => (b.onclick = () => { sessionStorage.setItem("filter-" + key, b.dataset.f); viewLeague(key); }));
      return;
    }
    let games = data.games;
    if (filter === "upcoming") games = games.filter(g => g.state !== "post");
    const days = {};
    games.forEach(g => (days[dayKey(g.date)] ||= []).push(g));
    const chips = `<div class="chips">
      <span class="chip"><b>${data.report.upcoming}</b> upcoming</span>
      <span class="chip"><b>${data.report.withOdds}</b> with lines</span>
      <span class="chip">Lines: <b>${esc((data.report.providers || []).join(", ") || "none")}</b></span>
      <span class="chip">Next ${data.windowDays} days</span></div>${staleNote(data.stale)}`;
    let html = `${home ? slateHtml() + offersSlot("home") : ""}<div class="page-head${home ? " home-head" : ""}"><div>${home ? `<span class="eyebrow">Featured league</span>` : ""}<h1>${esc(data.league.full)}</h1><div class="sub">Upcoming games, lines and form · times in ${TZL}</div></div>
      <div class="seg"><button data-f="upcoming" class="${filter === "upcoming" ? "on" : ""}">Upcoming & live</button><button data-f="all" class="${filter === "all" ? "on" : ""}">Incl. today's finals</button></div></div>${chips}`;
    if (!games.length) {
      html += `<div class="empty" style="margin-top:16px"><h3>No ${esc(data.league.name)} games in the next ${data.windowDays} days</h3>
        ${data.league.key === "mlb" ? "MLB is in its offseason / postseason window." : data.league.key === "ncaab" ? "The college basketball season is just getting started." : "The league may be on a break or out of season."} Check back after the next data refresh.</div>`;
    } else {
      for (const k of Object.keys(days)) {
        html += `<div class="day">${dayLabel(days[k][0].date)}<span class="dn">${days[k].length} game${days[k].length > 1 ? "s" : ""}</span></div><div class="grid">` +
          days[k].map(g => gameTile(g, key, kind)).join("") + `</div>`;
      }
    }
    html += teamTable(data, kind);
    app.innerHTML = html;
    app.querySelectorAll(".seg button").forEach(b => (b.onclick = () => { sessionStorage.setItem("filter-" + key, b.dataset.f); viewLeague(key, home); }));
    wireSort(app.querySelector("#teamTbl"));
    const tick = home ? ((META.slate || {}).ticker || []).map(t => ({ lg: t.lg, id: String(t.id), state: t.st, date: t.d })) : [];
    startLive([...games.map(g => liveRef(key, g)), ...tick]);
  }

  function teamTable(data, kind) {
    const u = unitWord(kind);
    const byId = {};
    data.games.forEach(g => ["home", "away"].forEach(s => (byId[g[s].id] ||= g[s])));
    const rows = Object.entries(data.teams).map(([id, t]) => ({ id, t, b: byId[id] || {} })).filter(r => r.t);
    if (!rows.length) return "";
    rows.sort((a, b) => ((b.t.all?.pf ?? -1) - (b.t.all?.pa ?? 0)) - ((a.t.all?.pf ?? -1) - (a.t.all?.pa ?? 0)));
    const td = v => `<td class="num">${v ?? NA}</td>`;
    const diff = a => (a ? a.pf - a.pa : null);
    return `<div class="section-title">Team stats — teams playing in this window</div>
      <div class="tbl-wrap"><table id="teamTbl"><thead><tr>
        <th>Team</th><th>Record</th><th>GP</th><th>${u}/G</th><th>Opp ${u}/G</th><th>Diff</th><th>Home</th><th>Home ${u} F/A</th><th>Away</th><th>Away ${u} F/A</th><th>Streak</th><th>Last 5</th>
      </tr></thead><tbody>${rows.map(({ id, t, b }) => {
        const a = t.all, d = diff(a);
        return `<tr><td data-v="${esc(b.name)}">${logo(b, "tlogo")}<a class="tlink" href="#/t/${data.league.key}/${id}">${esc(b.name || "")}</a></td>
          ${td(esc(t.recordSummary || rec(a, kind)))}${td(a?.gp)}${td(fx(a?.pf, 1))}${td(fx(a?.pa, 1))}
          <td class="num ${d > 0 ? "pos" : d < 0 ? "neg" : ""}" data-v="${d ?? -999}">${d !== null ? (d > 0 ? "+" : "") + d.toFixed(1) : NA}</td>
          ${td(rec(t.homeSplit, kind))}${td(t.homeSplit ? `${fx(t.homeSplit.pf)} / ${fx(t.homeSplit.pa)}` : null)}
          ${td(rec(t.awaySplit, kind))}${td(t.awaySplit ? `${fx(t.awaySplit.pf)} / ${fx(t.awaySplit.pa)}` : null)}
          ${td(t.streak)}<td data-v="${esc(b.form || "")}">${formDots(b.form) || NA}</td></tr>`;
      }).join("")}</tbody></table></div>
      <div class="note">Computed from each team's completed games this season (ESPN team schedules${rows[0].t.seasonType ? ", " + esc(rows[0].t.seasonType) : ""}). Teams with no completed games show N/A.${window.LSAdv && window.LSAdv.ADV_LGS.has(data.league.key) ? " ATS and over/under records are on each team page." : ""}</div>`;
  }

  function wireSort(tbl) {
    if (!tbl) return;
    tbl.querySelectorAll("th").forEach((th, i) => (th.onclick = () => {
      const body = tbl.tBodies[0], dir = th.dataset.dir === "asc" ? "desc" : "asc";
      tbl.querySelectorAll("th").forEach(x => delete x.dataset.dir); th.dataset.dir = dir;
      const val = tr => { const c = tr.children[i]; const v = c.dataset.v ?? c.textContent.trim(); const n = parseFloat(v); return isNaN(n) ? v : n; };
      [...body.rows].sort((a, b) => { const x = val(a), y = val(b); const r = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y)); return dir === "asc" ? r : -r; }).forEach(r => body.appendChild(r));
    }));
  }

  // ---------- game detail
  async function viewGame(key, id) {
    renderTabs(key);
    if (!cache[`data/${key}/games/${id}.json`]) { showSkel(skelGame()); window.scrollTo(0, 0); }
    let d, idx;
    try { [d, idx] = await Promise.all([getJSON(`data/${key}/games/${id}.json`), getJSON(`data/${key}/index.json`)]); }
    catch (e) { return (app.innerHTML = `<a class="back" href="#/l/${key}">← Back</a><div class="empty"><h3>Game not found</h3>It may have dropped out of the data window. Refresh the data.</div>`); }
    if (idx.league.kind === "mma" && window.LSUfc) {
      const at = location.hash;
      await window.LSUfc.fight(d, idx, key);
      if (location.hash === at) addStale(d.game.stale, "fight details");
      return;
    }
    const g0 = d.game, det = d.detail || {}, kind = idx.league.kind, u = unitWord(kind);
    const g = liveG(key, g0);
    const H = g.home, A = g.away, tH = d.teams[H.id] || {}, tA = d.teams[A.id] || {};
    const mid = g.state === "pre"
      ? `<div class="vs">${g.neutral ? "VS" : "AT"}</div><div class="when">${fullET(g.date)}</div>`
      : heroMid(g);
    let html = `<a class="back" href="#/l/${key}">← ${esc(idx.league.full)}</a>${previewLink(key, g, "back pv-back")}
      <div class="match" style="--ca:${teamColor(A, "#334155")};--ch:${teamColor(H, "#475569")}">
        <div class="mteam">${logo(A)}<div><div class="nm">${A.rank ? `<span class="rk" style="color:var(--warn)">#${A.rank} </span>` : ""}<a class="tlink" href="#/t/${key}/${A.id}">${esc(A.name)}</a></div><div class="rec">${esc(A.record || "—")} · Away ${esc(A.awayRecord || "—")}${formDots(A.form)}</div></div></div>
        <div class="mmid">${mid}<div class="where">${esc([g.venue, g.city].filter(Boolean).join(", "))}${g.neutral ? " (neutral)" : ""}</div><div class="where">${esc(g.broadcasts.join(", "))}</div>${g.note ? `<div class="where">${esc(g.note)}</div>` : ""}${window.LSWeather && g.state !== "post" && g.weather ? `<div class="where wx-where">${window.LSWeather.chip(g)}</div>` : ""}</div>
        <div class="mteam home">${logo(H)}<div><div class="nm">${H.rank ? `<span class="rk" style="color:var(--warn)">#${H.rank} </span>` : ""}<a class="tlink" href="#/t/${key}/${H.id}">${esc(H.name)}</a></div><div class="rec">${esc(H.record || "—")} · Home ${esc(H.homeRecord || "—")}${formDots(H.form)}</div></div></div>
      </div>${staleNote(g0.stale, "game details")}`;

    if (LV() && window.LiveCore && window.LiveCore.supported(key) && (g.state !== "pre" || window.LiveCore.needsLive({ lg: key, id: g.id, state: g.state, date: g.date })))
      html += `<div id="liveBox" class="lbx-wrap">${liveBoxHtml(LV().box(key, g.id), A, H, kind, g, key)}</div>`;
    html += `<div class="section-title">Betting lines${window.LSAlerts && g.state === "pre" ? `<span class="st-act">${window.LSAlerts.pageBell(key, g)}</span>` : ""}</div><div class="cols">${linesCard(g, kind)}${booksCard(g, kind, key)}</div>${offersSlot("game")}`;
    if (window.LSBets) html += window.LSBets.trackCard(key, g, kind);
    const lm = lineMoveSection(d, g, kind);
    html += lm.html;
    if (window.LSProps) html += window.LSProps.gameSlot(key, g);
    if (window.LSWeather) html += window.LSWeather.section(g, kind);

    // side-by-side
    const rows = [];
    const add = (label, a, h, better) => rows.push({ label, a, h, better });
    add("Record", tA.recordSummary || A.record, tH.recordSummary || H.record);
    add("Standing", tA.standingSummary, tH.standingSummary);
    add(`${u} / game`, tA.all?.pf, tH.all?.pf, "high");
    add(`Opp ${u} / game`, tA.all?.pa, tH.all?.pa, "low");
    add(`${u} differential`, tA.all ? tA.all.pf - tA.all.pa : null, tH.all ? tH.all.pf - tH.all.pa : null, "high");
    add("Home record", rec(tA.homeSplit, kind), rec(tH.homeSplit, kind));
    add(`Home ${u} for / against`, tA.homeSplit ? `${fx(tA.homeSplit.pf)} / ${fx(tA.homeSplit.pa)}` : null, tH.homeSplit ? `${fx(tH.homeSplit.pf)} / ${fx(tH.homeSplit.pa)}` : null);
    add("Away record", rec(tA.awaySplit, kind), rec(tH.awaySplit, kind));
    add(`Away ${u} for / against`, tA.awaySplit ? `${fx(tA.awaySplit.pf)} / ${fx(tA.awaySplit.pa)}` : null, tH.awaySplit ? `${fx(tH.awaySplit.pf)} / ${fx(tH.awaySplit.pa)}` : null);
    add("Last 10", rec(tA.last10, kind), rec(tH.last10, kind));
    add("Streak", tA.streak, tH.streak);
    const atsA = (det.ats || {})[A.id] || [], atsH = (det.ats || {})[H.id] || [];
    add("ATS record", atsA.length ? atsA.map(r => r.summary).join(" · ") : null, atsH.length ? atsH.map(r => r.summary).join(" · ") : null);
    if (det.predictor) add("ESPN win projection", isNum(det.predictor.away) ? det.predictor.away + "%" : null, isNum(det.predictor.home) ? det.predictor.home + "%" : null);
    html += `<div class="section-title">Head to head comparison</div><div class="card">${cmpTable(A, H, rows)}
      <div class="note">Splits computed from completed ${esc(tH.seasonType || tA.seasonType || "season")} games via ESPN team schedules. ${atsA.length || atsH.length || (window.LSAdv && window.LSAdv.ADV_LGS.has(key)) ? "" : "ATS: not available from ESPN's free feeds for this matchup."}</div></div>`;
    if (window.LSAdv) html += window.LSAdv.gameSlot(key, g);

    // ESPN season stats
    const sA = (det.teamStats || {})[A.id] || [], sH = (det.teamStats || {})[H.id] || [];
    if (sA.length || sH.length) {
      const labels = [...new Set([...sA, ...sH].map(s => s.label))];
      const val = (arr, l) => (arr.find(s => s.label === l) || {}).value;
      const srows = labels.map(l => ({ label: l, a: val(sA, l), h: val(sH, l), better: /against|allowed|turnover|penalt|goals against/i.test(l) ? "low" : /streak|last ten/i.test(l) ? null : "high" }));
      html += `<div class="section-title">Season team stats (ESPN)</div><div class="card">${cmpTable(A, H, srows)}</div>`;
    }

    if (det.predictor && isNum(det.predictor.home) && isNum(det.predictor.away)) {
      html += `<div class="section-title">ESPN matchup predictor</div><div class="card"><div class="pred">
        <div style="width:${det.predictor.away}%;background:#${esc(A.color || "334155")}">${esc(A.abbr)} ${det.predictor.away}%</div>
        <div style="width:${det.predictor.home}%;background:#${esc(H.color || "475569")};justify-content:flex-end">${esc(H.abbr)} ${det.predictor.home}%</div></div></div>`;
    }

    // last 5
    html += `<div class="section-title">Last 5 games</div><div class="cols">${lastFive(A, det, tA)}${lastFive(H, det, tH)}</div>`;

    // injuries
    if (det.injuriesAvailable) html += `<div class="section-title">Injury report</div><div class="cols">${injuries(A, det)}${injuries(H, det)}</div>`;
    else html += `<div class="section-title">Injury report</div><div class="card note">Injury data not provided by ESPN for this league/game.</div>`;

    // leaders
    if ((det.leaders || []).length) {
      const by = t => det.leaders.filter(x => x.teamId === t.id);
      const lc = t => `<div class="card"><h3>${logo(t)}${esc(t.name)}</h3><table><tbody>${by(t).map(x => `<tr><td>${esc(x.cat)}</td><td style="text-align:left">${esc(x.player)}</td><td class="num">${esc(x.value)}</td></tr>`).join("") || `<tr><td>${NA}</td></tr>`}</tbody></table></div>`;
      html += `<div class="section-title">Season leaders</div><div class="cols">${lc(A)}${lc(H)}</div>`;
      if (window.LSMatchup && window.LSMatchup.SUPPORTED.has(key)) html += `<div id="keyMu"></div>`;
    }
    if ((det.seasonSeries || []).length) {
      html += `<div class="section-title">Season series</div><div class="card">${det.seasonSeries.map(s => `<div><b>${esc(s.title || "")}</b> ${esc(s.summary || "")}<div class="note">${(s.events || []).map(e => `${e.date ? fmt(e.date, { month: "short", day: "numeric", year: "numeric" }) : ""}: ${esc(e.score)}`).join(" · ")}</div></div>`).join("")}</div>`;
    }
    if (!d.hasSummary) html += `<div class="note">Detailed matchup data (ESPN game summary) wasn't fetched for this game.</div>`;
    app.innerHTML = html;
    lm.wire();
    window.scrollTo(0, 0);
    const km = document.getElementById("keyMu");
    if (km) { const tok = NAV; window.LSMatchup.keyMatchups(km, key, g, det, () => tok === NAV).catch(e => console.warn(e)); }
    const av = document.getElementById("advGame");
    if (av) { const tok = NAV; window.LSAdv.mountGame(av, key, g, () => tok === NAV).catch(e => console.warn(e)); }
    startLive([liveRef(key, g0)], { lg: key, id: String(g0.id), g: g0, A, H, kind });
    const pp = document.getElementById("ppBox");
    if (pp) { const tok = NAV; window.LSProps.mountGame(pp, key, g, () => tok === NAV).catch(e => { pp.innerHTML = notAvail("Player props", "Couldn't load player props right now."); console.warn(e); }); }
  }

  // ---------- line movement (game detail)
  const BOOKNAME = k => ({ draftkings: "DraftKings", fanduel: "FanDuel", hardrockbet: "Hard Rock Bet", betmgm: "BetMGM" }[k] || k.replace(/^espn-/, "ESPN · "));
  const shortET = d => fmt(d.toISOString(), { weekday: "short", hour: "numeric", minute: "2-digit" });
  function lineMoveSection(d, g, kind) {
    const H = d.history, o = g.odds;
    const none = { html: "", wire: () => {} };
    if (!o && !H) return none;
    // Build per-book data: change points + ESPN open
    let books = H && H.books ? Object.keys(H.books) : [];
    const order = ["draftkings", "hardrockbet", "fanduel"];
    books.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
    books = sortByState(books);   // books legal in the visitor's state first (Hard Rock Bet in FL)
    const fromOdds = !books.length;   // no history file: show ESPN open -> current only
    if (fromOdds) books = ["current"];
    const pointsFor = bk => {
      if (!fromOdds) return H.books[bk].map(([t, v]) => ({ t: new Date(t), v }));
      return [{ t: new Date(), v: { hs: o.homeSpread, as: o.awaySpread, tot: o.total, hml: o.homeML, aml: o.awayML, dml: o.drawML } }];
    };
    const openFor = bk => (fromOdds ? { hs: o.homeSpreadOpen, tot: o.totalOpen, hml: o.homeMLOpen, aml: o.awayMLOpen, dml: o.drawMLOpen } : (H.open || {})[bk] || {});
    const spreadLabel = kind === "hockey" ? "Puck line" : kind === "baseball" ? "Run line" : "Spread";
    const MARKETS = {
      spread: { label: spreadLabel, series: [{ key: "hs", name: `${g.home.abbr} ${spreadLabel.toLowerCase()}`, color: "var(--chart-1)" }], f: line },
      total: { label: kind === "mma" ? "Total rounds" : "Total", series: [{ key: "tot", name: kind === "mma" ? "Total rounds (O/U)" : "Total (O/U)", color: "var(--chart-2)" }], f: v => String(v) },
      ml: { label: "Moneyline", series: [{ key: "aml", name: `${g.away.abbr} ML`, color: "var(--chart-3)" }, { key: "hml", name: `${g.home.abbr} ML`, color: "var(--chart-1)" }].concat(kind === "soccer" ? [{ key: "dml", name: "Draw", color: "var(--chart-4)" }] : []), f: am },
    };
    const has = (bk, key) => pointsFor(bk).some(p => isNum(p.v[key])) || isNum(openFor(bk)[key]);
    let st = { bk: books[0], mk: has(books[0], "hs") ? "spread" : has(books[0], "tot") ? "total" : "ml" };
    const m = moveOf(g);
    const notes = (m && m.notable) || [];
    const id = "lm" + g.id;
    const html = `<div class="section-title">Line movement</div><div class="card lm" id="${id}"></div>`;
    function stats() {
      const pts = pointsFor(st.bk), op = openFor(st.bk), M = MARKETS[st.mk];
      return M.series.map(s => {
        const ser = pts.filter(p => isNum(p.v[s.key]));
        if (!ser.length) return "";
        const cur = ser[ser.length - 1], open = isNum(op[s.key]) ? op[s.key] : ser[0].v[s.key];
        let big = cur.v[s.key], bigT = cur.t;
        ser.forEach(p => { if (Math.abs(p.v[s.key] - open) > Math.abs(big - open)) { big = p.v[s.key]; bigT = p.t; } });
        // last change time = first point of the current run of equal values
        let lc = null; for (let i = ser.length - 1; i > 0; i--) if (ser[i].v[s.key] !== ser[i - 1].v[s.key]) { lc = ser[i].t; break; }
        const dlt = cur.v[s.key] - open;
        return `<tr><td><i class="sw" style="background:${s.color}"></i>${esc(s.name)}</td><td class="num">${esc(M.f(open) ?? "")}${isNum(op[s.key]) ? "" : '<span class="na">*</span>'}</td>
          <td class="num"><b>${esc(M.f(cur.v[s.key]) ?? "")}</b></td>
          <td class="num ${dlt ? "chg" : ""}">${dlt ? (dlt > 0 ? "▲ +" : "▼ ") + +dlt.toFixed(2) : "—"}</td>
          <td class="num">${big !== open ? `${esc(M.f(big))} <span class="na">(${big - open > 0 ? "+" : ""}${+(big - open).toFixed(2)})</span>` : "—"}</td>
          <td class="num na">${lc ? shortET(lc) + " " + TZL : fromOdds ? "—" : "no change tracked"}</td></tr>`;
      }).join("");
    }
    function chart(w) {
      const pts = pointsFor(st.bk), op = openFor(st.bk), M = MARKETS[st.mk];
      const h = w < 500 ? 190 : 230, L = w < 500 ? 40 : 52, R = 14, T = 14, B = 28;
      const end = new Date(Math.max(H && H.lastSeen ? Date.parse(H.lastSeen) : 0, ...pts.map(p => +p.t)));
      let x0 = +pts[0].t, x1 = +end; if (x1 - x0 < 3600e3) { x0 -= 1800e3; x1 += 1800e3; }
      // moneyline is charted as implied win % (American odds jump from -100 to +100, so the raw scale is misleading)
      const isML = st.mk === "ml", tv = v => (!isML ? v : v < 0 ? (100 * -v) / (-v + 100) : 10000 / (v + 100));
      const vals = []; M.series.forEach(s => { pts.forEach(p => isNum(p.v[s.key]) && vals.push(tv(p.v[s.key]))); isNum(op[s.key]) && vals.push(tv(op[s.key])); });
      if (!vals.length) return `<div class="note">No ${esc(M.label.toLowerCase())} data for this book.</div>`;
      let y0 = Math.min(...vals), y1 = Math.max(...vals);
      const pad = Math.max((y1 - y0) * 0.15, isML ? 3 : 0.5); y0 -= pad; y1 += pad;
      const X = t => L + ((t - x0) / (x1 - x0)) * (w - L - R), Yr = v => T + (1 - (v - y0) / (y1 - y0)) * (h - T - B), Y = v => Yr(tv(v));
      let svg = `<svg class="lmchart" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(M.label)} line movement">`;
      for (let i = 0; i <= 4; i++) { const v = y0 + ((y1 - y0) * i) / 4, y = Yr(v); svg += `<line x1="${L}" x2="${w - R}" y1="${y}" y2="${y}" class="gl"/><text x="${L - 6}" y="${y + 4}" class="ax" text-anchor="end">${esc(isML ? Math.round(v) + "%" : st.mk === "spread" ? line(Math.round(v * 2) / 2) : (Math.round(v * 2) / 2).toString())}</text>`; }
      const nx = w < 500 ? 2 : 5, short = x1 - x0 < 20 * 3600e3;
      const tl = t => (short ? new Date(t).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }) : shortET(new Date(t)));
      for (let i = 0; i <= nx; i++) { const t = x0 + ((x1 - x0) * i) / nx; svg += `<text x="${X(t)}" y="${h - 8}" class="ax" text-anchor="${i === 0 ? "start" : i === nx ? "end" : "middle"}">${esc(tl(t))}</text>`; }
      if (isML) svg += `<text x="${L}" y="${T - 3}" class="ax">implied win %</text>`;
      M.series.forEach(s => {
        const ser = pts.filter(p => isNum(p.v[s.key]));
        if (isNum(op[s.key])) { const y = Y(op[s.key]); svg += `<line x1="${L}" x2="${w - R}" y1="${y}" y2="${y}" style="stroke:${s.color}" class="openl"/><text x="${w - R - 2}" y="${y - 5}" class="ax" text-anchor="end">open ${esc(M.f(op[s.key]))}</text>`; }
        if (!ser.length) return;
        let dpath = `M${X(+ser[0].t)},${Y(ser[0].v[s.key])}`;
        ser.forEach((p, i) => { if (i) dpath += `H${X(+p.t)}V${Y(p.v[s.key])}`; });
        dpath += `H${X(+end)}`;
        svg += `<path d="${dpath}" fill="none" style="stroke:${s.color}" stroke-width="2.5" stroke-linejoin="round"/>`;
        ser.forEach(p => (svg += `<circle cx="${X(+p.t)}" cy="${Y(p.v[s.key])}" r="3.5" style="fill:${s.color}"><title>${esc(fullET(p.t.toISOString()))}: ${esc(s.name)} ${esc(M.f(p.v[s.key]))}</title></circle>`));
        const last = ser[ser.length - 1];
        svg += `<circle cx="${X(+end)}" cy="${Y(last.v[s.key])}" r="4.5" style="fill:var(--bg);stroke:${s.color}" stroke-width="2"><title>Current (checked ${esc(fullET(end.toISOString()))}): ${esc(M.f(last.v[s.key]))}</title></circle>`;
      });
      return svg + `</svg>`;
    }
    function changes() {
      if (fromOdds) return "";
      const pts = pointsFor(st.bk).slice().reverse().slice(0, 8);
      return `<details class="lmlog"><summary>Recorded changes (${pointsFor(st.bk).length}) · ${esc(BOOKNAME(st.bk))}</summary><table><thead><tr><th>Time (${TZL})</th><th>${esc(g.away.abbr)} / ${esc(g.home.abbr)} ${esc(spreadLabel.toLowerCase())}</th><th>Total</th><th>ML ${esc(g.away.abbr)} / ${esc(g.home.abbr)}</th></tr></thead><tbody>` +
        pts.map(p => `<tr><td>${esc(fullET(p.t.toISOString()))}</td><td class="num">${line(p.v.as) ?? "—"} / ${line(p.v.hs) ?? "—"}</td><td class="num">${p.v.tot ?? "—"}</td><td class="num">${am(p.v.aml) ?? "—"} / ${am(p.v.hml) ?? "—"}</td></tr>`).join("") + `</tbody></table></details>`;
    }
    function draw() {
      const el = document.getElementById(id); if (!el) return;
      const segM = Object.entries(MARKETS).filter(([k, M]) => M.series.some(s => has(st.bk, s.key))).map(([k, M]) => `<button data-mk="${k}" class="${st.mk === k ? "on" : ""}">${esc(M.label)}</button>`).join("");
      const segB = books.length > 1 ? `<div class="seg">${books.map(b => `<button data-bk="${b}" class="${st.bk === b ? "on" : ""}">${esc(BOOKNAME(b))}</button>`).join("")}</div>` : "";
      const since = !fromOdds && H.firstSeen ? `Tracking since ${esc(fullET(H.firstSeen))} · last checked ${esc(fullET(H.lastSeen))}` : "History not recorded for this game yet; showing ESPN's open vs current";
      el.innerHTML = `<div class="lmhead"><h3>${esc(MARKETS[st.mk].label)} movement <span class="na">· ${esc(fromOdds ? o.provider || "" : BOOKNAME(st.bk))}</span></h3><div class="lmctl">${segB}<div class="seg">${segM}</div></div></div>
        ${notes.length ? `<div class="lmnotes">${notes.map(n => `<span class="mvbadge">⚡ ${esc(n)}</span>`).join("")}</div>` : ""}
        <div class="lmplot"></div>
        <div class="tbl-wrap"><table class="lmstats"><thead><tr><th>Line</th><th>Open</th><th>Current</th><th>Change</th><th>Biggest move</th><th>Last change</th></tr></thead><tbody>${stats()}</tbody></table></div>
        ${changes()}
        <div class="note">${since}. Open = opening line as reported by ESPN (<span class="na">*</span> = ESPN open not available, first recorded value used). Lines are snapshotted about every 30 min (Hard Rock Bet, FanDuel and DraftKings via The Odds API, budget permitting; DraftKings via ESPN when the Odds API lacks it); points mark recorded changes. Times in ${TZL}.</div>`;
      const plot = el.querySelector(".lmplot");
      plot.innerHTML = chart(Math.max(280, Math.floor(plot.clientWidth)));
      el.querySelectorAll("[data-mk]").forEach(b => (b.onclick = () => { st.mk = b.dataset.mk; draw(); }));
      el.querySelectorAll("[data-bk]").forEach(b => (b.onclick = () => { st.bk = b.dataset.bk; if (!MARKETS[st.mk].series.some(s => has(st.bk, s.key))) st.mk = "ml"; draw(); }));
    }
    return { html, wire: () => { draw(); let rt; window.onresize = () => { clearTimeout(rt); rt = setTimeout(draw, 150); }; } };
  }

  function cmpTable(A, H, rows) {
    const cell = v => (v === null || v === undefined || v === "" ? NA : esc(typeof v === "number" ? (Number.isInteger(v) ? v : v.toFixed(1)) : v));
    return `<div class="cmp"><div class="cmp-head"><div>${esc(A.abbr)} <span class="na">(away)</span></div><div></div><div class="r"><span class="na">(home)</span> ${esc(H.abbr)}</div></div>` +
      rows.map(r => {
        let ca = "", ch = "";
        const a = parseFloat(r.a), h = parseFloat(r.h);
        if (r.better && !isNaN(a) && !isNaN(h) && a !== h) { const aWins = r.better === "high" ? a > h : a < h; aWins ? (ca = "adv") : (ch = "adv"); }
        return `<div class="cmp-row"><div class="l ${ca}">${cell(r.a)}</div><div class="m">${esc(r.label)}</div><div class="r ${ch}">${cell(r.h)}</div></div>`;
      }).join("") + `</div>`;
  }

  function linesCard(g, kind) {
    const o = g.odds;
    if (!o) return `<div class="card"><h3>Current line</h3><div class="note">No line posted yet by the sportsbook ESPN reports. Lines usually appear closer to game time.</div></div>`;
    const mv = (cur, open, isSpread) => {
      if (!isNum(open)) return "";
      const f = isSpread ? line(open) : am(open);
      if (!isNum(cur) || cur === open) return `<div class="move">open ${esc(f)}</div>`;
      return `<div class="move ${cur > open ? "up" : "down"}">open ${esc(f)} → ${esc(isSpread ? line(cur) : am(cur))}</div>`;
    };
    const r = (label, a, h, extra = "") => `<tr><td>${label}</td><td class="num">${a}</td><td class="num">${h}</td>${extra}</tr>`;
    const spreadLabel = kind === "hockey" ? "Puck line" : kind === "baseball" ? "Run line" : "Spread";
    let body = "";
    if (isNum(o.homeSpread) || isNum(o.awaySpread))
      body += r(spreadLabel, `${line(o.awaySpread) ?? NA} <span class="na">${am(o.awaySpreadOdds) ?? ""}</span>${mv(o.awaySpread, o.awaySpreadOpen, true)}`, `${line(o.homeSpread) ?? NA} <span class="na">${am(o.homeSpreadOdds) ?? ""}</span>${mv(o.homeSpread, o.homeSpreadOpen, true)}`);
    body += r(kind === "soccer" ? "Moneyline (3-way)" : "Moneyline", `${am(o.awayML) ?? NA}${mv(o.awayML, o.awayMLOpen, false)}`, `${am(o.homeML) ?? NA}${mv(o.homeML, o.homeMLOpen, false)}`);
    if (kind === "soccer") body += `<tr><td>Draw</td><td class="num" colspan="2" style="text-align:center">${am(o.drawML) ?? NA}${mv(o.drawML, o.drawMLOpen, false)}</td></tr>`;
    body += `<tr><td>${kind === "mma" ? "Total rounds" : "Total"}</td><td class="num">O ${fx(o.total) ?? NA} <span class="na">${am(o.overOdds) ?? ""}</span></td><td class="num">U ${fx(o.total) ?? NA} <span class="na">${am(o.underOdds) ?? ""}</span>${isNum(o.totalOpen) && o.totalOpen !== o.total ? `<div class="move">open ${o.totalOpen} → ${o.total}</div>` : ""}</td></tr>`;
    const pk = GEO() ? GEO().providerKey(o.provider) : null, pNa = pk && !bookAvail(pk);
    return `<div class="card${pNa ? " na-st-card" : ""}"><h3>Current line · ${esc(o.provider || "provider n/a")}${pk ? naTag(pk) : ""}</h3>
      <table class="books"><thead><tr><th>Market</th><th>${esc(g.away.abbr)}</th><th>${esc(g.home.abbr)}</th></tr></thead><tbody>${body}</tbody></table>
      <div class="note">Source: ${esc(g.oddsSource || "ESPN")} — as reported by ${esc(o.provider || "the listed book")}. "open" = opening line (line movement).</div></div>`;
  }

  function booksCard(g, kind, lg) {
    let books = META.targetBooks || [{ key: "draftkings", name: "DraftKings" }, { key: "hardrockbet", name: "Hard Rock Bet" }, { key: "fanduel", name: "FanDuel" }];
    const ord = sortByState(books.map(b => b.key));
    books = ord.map(k => books.find(b => b.key === k));   // legal-in-your-state books first
    const HR = META.hardrock || {};
    const B = Object.fromEntries(Object.entries(g.books || {}).filter(([, b]) => b && !b.stale));   // stale = game started since the pull
    const staleB = g.books || {};
    // Only books with a line for this game get a column: a book with no data (e.g. FanDuel has no NCAAB, UCL, UFC or
    // some MLS lines) would render an all-"N/A" column. The footnote names the books left out.
    const allBooks = books;
    books = books.filter(bk => B[bk.key]);
    const missing = allBooks.filter(bk => !B[bk.key]);
    const missNote = !books.length ? "" : missing.length ? ` No ${missing.map(bk => bk.name).join(" or ")} line for this game at the last pull, so ${missing.length > 1 ? "those columns are" : "that column is"} hidden.` : "";
    const markets = [];
    const LV = window.LSAdv && kind !== "mma" ? window.LSAdv.booksExtra(B, kind) : null;   // implied %, fair line, edge, outliers (assets/adv.js)
    const sp = s => b => (isNum(b?.[s + "Spread"]) ? { disp: `${line(b[s + "Spread"])} <span class="na">${am(b[s + "SpreadOdds"]) ?? ""}</span>`, score: b[s + "Spread"] * 1000 + (b[s + "SpreadOdds"] ?? -110) } : null);
    const ml = s => b => (isNum(b?.[s + "ML"]) ? { disp: am(b[s + "ML"]), score: b[s + "ML"] } : null);
    const ov = b => (isNum(b?.total) ? { disp: `O ${b.total} <span class="na">${am(b.overOdds) ?? ""}</span>`, score: -b.total * 1000 + (b.overOdds ?? -110) } : null);
    const un = b => (isNum(b?.total) ? { disp: `U ${b.total} <span class="na">${am(b.underOdds) ?? ""}</span>`, score: b.total * 1000 + (b.underOdds ?? -110) } : null);
    if (kind !== "soccer" && kind !== "mma") { markets.push([`${g.away.abbr} spread`, sp("away"), "spread", "away"], [`${g.home.abbr} spread`, sp("home"), "spread", "home"]); }
    markets.push([`${g.away.abbr} ML`, ml("away"), "ml", "away"]);
    if (kind === "soccer") markets.push(["Draw", ml("draw"), "ml", "draw"]);
    markets.push([`${g.home.abbr} ML`, ml("home"), "ml", "home"], ["Over", ov, "total", "over"], ["Under", un, "total", "under"]);
    const lvOn = LV && LV.anyFair;
    // "+" on each price you can bet in your state: opens My Bets' add sheet prefilled with that book, line and price (CSS draws the "+", so cell text is unchanged)
    const TB = lg && g.state === "pre" && window.LSBets && window.LSBets.cellHref ? window.LSBets : null;
    const trk = (bk, mk, o, label) => { const h = TB && bookAvail(bk.key) ? TB.cellHref(lg, g, bk.key, mk, o) : ""; return h ? `<a class="trk" href="${esc(h)}" aria-label="${esc(`Track ${label} at ${bk.name}`)}" title="Track this bet"></a>` : ""; };
    const rows = markets.map(([label, fn, mk, o]) => {
      const vals = books.map(bk => fn(B[bk.key]));
      // "best price" only among books legal in the visitor's state; out-of-state columns are reference data
      const have = vals.filter((v, i) => v && bookAvail(books[i].key));
      const best = have.length > 1 ? Math.max(...have.map(v => v.score)) : null;
      return `<tr><td>${esc(label)}${lvOn ? LV.fairInline(mk, o) : ""}</td>${vals.map((v, i) => { const na = bookAvail(books[i].key) ? "" : " na-col"; return v ? `<td class="num${na} ${best !== null && v.score === best && !na ? "best" : ""}"><span class="px">${v.disp}</span>${trk(books[i], mk, o, label)}${lvOn ? LV.cell(mk, o, books[i].key) : ""}</td>` : `<td class="${na.trim()}">${NA}</td>`; }).join("")}${lvOn ? LV.fairCell(mk, o) : ""}</tr>`;
    }).join("");
    const sub = bk => {
      const b = B[bk.key], sb = staleB[bk.key];
      if (b && b.asOf) return `as of ${esc(fullET(b.asOf))}`;
      if (b) return esc(b.source || "");
      if (sb && sb.stale) return `closed · game started`;
      if (bk.key === "hardrockbet" || bk.key === "fanduel") return HR.asOf ? "not posted at last pull" : "no pull yet";
      return "no data";
    };
    const head = books.map(bk => `<th${bookAvail(bk.key) ? "" : ' class="na-col"'}>${esc(bk.name)}${naTag(bk.key)}<span class="src">${sub(bk)}</span></th>`).join("");
    const ev = GEO() ? GEO().current() : null, out = ev && ev.state ? books.map(b => b.key).filter(k => !bookAvail(k)) : [];   // only books with a column here (BetMGM has no odds data)
    const outNote = out.length ? ` ${out.map(k => BOOKNAME(k)).join(" and ")} ${out.length > 1 ? "don't" : "doesn't"} run a legal online sportsbook in ${esc(ev.stateName)}; ${out.length > 1 ? "their" : "its"} lines are shown for reference only.` : "";
    const nHave = books.filter(bk => B[bk.key]).length;
    const OA = META.oddsApi || {}, every = OA.gameInterval || (OA.cadence || {}).games || 30;
    const pace = OA.level === "stop" ? " Odds API pulls are paused for the rest of the billing month (credit budget reached); showing the last pull."
               : OA.level === "slow-games" ? ` Refresh slowed to about every ${every >= 60 ? `${+(every / 60).toFixed(1)} h` : `${every} min`} to stay within this month's credit budget.` : "";
    const dkPaid = B.draftkings && B.draftkings.source === "The Odds API";
    // newest of the meta stamp and this game's own book stamps (an edge-cached meta.json can lag the game file)
    const lastPull = [HR.asOf, ...Object.values(B).map(b => b.asOf)].filter(Boolean).sort().pop();
    const hrNote = (HR.asOf ? `Hard Rock Bet, FanDuel and DraftKings via The Odds API, refreshed about every ${every >= 60 ? `${+(every / 60).toFixed(1)} h` : `${every} min`}; last pull ${esc(fullET(lastPull))}. Pre-game lines only: they're hidden once a game starts.`
                            : "Hard Rock Bet, FanDuel and DraftKings via The Odds API; no pull yet.") + pace;
    const dkNote = dkPaid ? "DraftKings' opening line (line movement) comes from ESPN. "
                 : B.draftkings ? "DraftKings here is ESPN's copy (The Odds API had no DraftKings line for this game at the last pull). " : "";
    if (!books.length) {   // no book has a current line: say why instead of a table of N/A
      const closed = allBooks.some(bk => staleB[bk.key] && staleB[bk.key].stale);
      const why = closed ? "Pre-game lines closed when the game started." : HR.asOf ? "No sportsbook posted a line for this game at the last pull." : "No sportsbook lines yet.";
      return `<div class="card"><h3>Odds comparison</h3><div class="note">${why} ${hrNote}</div>${affLine()}</div>`;
    }
    return `<div class="card"><h3>Odds comparison</h3>${pkCard(g, kind)}<div class="tbl-wrap"><table class="books${lvOn ? " lv-on" : ""}"><thead><tr><th>Market</th>${head}${lvOn ? `<th class="lv-fair">Fair line<span class="src">no-vig consensus</span></th>` : ""}</tr></thead><tbody>${rows}</tbody></table></div>
      <div class="note">${nHave > 1 ? "Best available price highlighted in green. " : ""}${hrNote}${missNote} ${dkNote}${outNote}</div>${lvOn ? LV.note : ""}${affLine()}</div>`;
  }

  function lastFive(t, det, ts) {
    const rows = ((det.lastFive || {})[t.id] || []);
    let body;
    if (rows.length) {
      const sc = r => { if (r.homeScore == null || r.awayScore == null) return r.score || ""; const mine = r.homeTeamId === t.id ? r.homeScore : r.awayScore, opp = r.homeTeamId === t.id ? r.awayScore : r.homeScore; return `${mine}-${opp}`; };
      body = [...rows].sort((a, b) => String(b.date).localeCompare(String(a.date))).map(r => `<tr><td>${r.date ? fmt(r.date, { month: "short", day: "numeric", year: "2-digit" }) : ""}</td><td>${esc(r.atVs || "")} ${esc(r.opp || "")}</td><td class="res ${esc(r.result)}">${esc(r.result || "")}</td><td class="num">${esc(sc(r))}</td></tr>`).join("");
    } else if ((ts.recent || []).length) {
      body = ts.recent.map(r => `<tr><td>${fmt(r.date, { month: "short", day: "numeric", year: "2-digit" })}</td><td>${r.home ? "vs" : "@"} ${esc(r.opp)}</td><td class="res ${r.res}">${r.res}</td><td class="num">${r.pf}-${r.pa}</td></tr>`).join("");
    } else body = `<tr><td colspan="4">${NA} — no completed games found</td></tr>`;
    return `<div class="card l5"><h3>${logo(t)}${esc(t.name)}</h3><table><thead><tr><th>Date</th><th>Opp</th><th>Res</th><th>Score (team-opp)</th></tr></thead><tbody>${body}</tbody></table></div>`;
  }

  function injuries(t, det) {
    const rows = ((det.injuries || {})[t.id] || []);
    const cls = s => (/out|injured reserve|ir/i.test(s || "") ? "out" : /question|doubt|day-to-day/i.test(s || "") ? "q" : "");
    const body = rows.length ? rows.map(r => `<tr><td>${esc(r.player)} <span class="na">${esc(r.pos || "")}</span></td><td><span class="badge ${cls(r.status)}">${esc(r.status || "")}</span></td><td>${esc(r.type || "")}</td></tr>`).join("")
      : `<tr><td colspan="3" class="na">No injuries listed</td></tr>`;
    return `<div class="card inj"><h3>${logo(t)}${esc(t.name)}</h3><table><thead><tr><th>Player</th><th>Status</th><th>Injury</th></tr></thead><tbody>${body}</tbody></table></div>`;
  }

  // ---------- search, team & player pages
  // Index: data/search/<lg>.json (built by scripts/search_index.py). Team schedule/stats and player bio/stats/game log
  // come straight from ESPN's site.web.api host, which allows cross-origin reads (site.api.espn.com does not).
  const LG = {
    nfl: ["football/nfl", "football"], nba: ["basketball/nba", "basketball"], ncaaf: ["football/college-football", "football"],
    ncaab: ["basketball/mens-college-basketball", "basketball"], nhl: ["hockey/nhl", "hockey"], mlb: ["baseball/mlb", "baseball"],
    epl: ["soccer/eng.1", "soccer"], mls: ["soccer/usa.1", "soccer"], ucl: ["soccer/uefa.champions", "soccer"],
    ufc: ["mma/ufc", "mma"],
  };
  const PRO = new Set(["nfl", "nba", "nhl", "mlb", "epl", "mls", "ucl"]);
  const lgName = lg => (META.leagues[lg] || {}).name || lg.toUpperCase();
  // affiliate disclosure line next to sportsbook prices; renders nothing until SITE_CONFIG.affiliate.enabled (site.js)
  const GEO = () => window.LSGeo || null;
  const naTag = k => (GEO() ? GEO().naTag(k) : "");
  const bookAvail = k => (GEO() ? GEO().isAvailable(k) : true);
  const sortByState = keys => (GEO() ? GEO().sortBooks(keys) : keys);
  const offersSlot = ctx => (GEO() ? GEO().offersHTML(ctx) : "");
  const affLine = () => (window.LineSmart && window.LineSmart.affDisclosure ? window.LineSmart.affDisclosure() : "");
  let NAV = 0; // bumps on every route; async views bail out if the user has moved on
  const espnCache = {};
  async function espn(path, ms = 12000) {
    const url = "https://site.web.api.espn.com/apis/" + path;
    if (espnCache[url]) return espnCache[url];
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
    try {
      const gen = netGen, r = await fetch(url, { signal: ctl.signal });
      if (!r.ok) throw new Error(url + " " + r.status);
      if (r.headers.get("X-LineSmart-Offline") && gen === netGen) showOffline();
      return (espnCache[url] = await r.json());
    } finally { clearTimeout(t); }
  }
  const settle = p => (p ? p.then(v => v, () => null) : Promise.resolve(null));
  const norm = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/['’.]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const words = s => [...new Set(norm(s).split(" ").filter(Boolean))];
  const initials = n => esc(String(n || "").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase());
  const hexOk = c => /^[0-9a-f]{6}$/i.test(c || "");
  const avatar = (img, name, color, cls = "") => `<span class="av ${cls}" aria-hidden="true"${hexOk(color) ? ` style="--tc:#${color}"` : ""}>${initials(name)}${img ? `<img src="${esc(img)}" alt="" loading="lazy" onerror="this.remove()">` : ""}</span>`;
  const crest = (src, name, cls = "") => `<span class="av crest ${cls}" aria-hidden="true">${src ? `<img src="${esc(src)}" alt="" loading="lazy" onerror="this.remove()">` : initials(name)}</span>`;
  const notAvail = (title, why) => `<div class="card na-card"><h3>${esc(title)}</h3><div class="na">${esc(why || "Not available right now.")}</div></div>`;
  // "Back" returns to wherever the user came from inside the app; on a cold deep link it goes to Search
  const backLink = () => `<a class="back" href="#/search" data-back>← Back</a>`;
  document.addEventListener("click", e => { const b = e.target.closest && e.target.closest("[data-back]"); if (b && NAV > 1) { e.preventDefault(); history.back(); } });

  const SIDX = {};
  async function sidx(lg) {
    if (SIDX[lg]) return SIDX[lg];
    const d = await getJSON(`data/search/${lg}.json`);
    const teams = d.teams.map(r => ({ id: r[0], name: r[1], abbr: r[2], short: r[3], logo: r[4], color: r[5], record: r[6], group: r[7], hasRoster: !!r[8] }));
    const byTeam = {}, byId = {};
    const players = d.players.map(r => { const p = { id: r[0], name: r[1], team: teams[r[2]], pos: r[3], jersey: r[4], img: r[5] ? d.hs + r[0] + ".png" : "" }; (byTeam[p.team.id] ||= []).push(p); byId[p.id] = p; return p; });
    return (SIDX[lg] = { meta: d, teams, players, byTeam, byId, teamById: Object.fromEntries(teams.map(t => [t.id, t])) });
  }

  let ENTRIES = null;
  async function searchEntries() {
    if (ENTRIES && !ENTRIES.missing.length) return ENTRIES;
    const res = await Promise.allSettled(META.order.map(lg => sidx(lg)));
    const list = [], missing = [], soccer = {};
    res.forEach((r, i) => {
      const lg = META.order[i];
      if (r.status !== "fulfilled") return missing.push(lg);
      const d = r.value, kind = d.meta.kind, b = PRO.has(lg) ? 6 : 0;
      if (kind !== "mma") d.teams.forEach(t => list.push({ k: "t", lg, lgs: [lg], o: t, name: t.name, x: norm(t.name), w: words(`${t.name} ${t.short} ${t.abbr}`), ab: norm(t.abbr), sh: norm(t.short), b: b + 12 }));
      d.players.forEach(p => {
        if (kind === "soccer" && soccer[p.id]) return soccer[p.id].lgs.push(lg); // same player in EPL/MLS + UCL: one result
        const e = { k: "p", lg, lgs: [lg], o: p, name: p.name, x: norm(p.name), w: words(p.name), b };
        if (kind === "soccer") soccer[p.id] = e;
        list.push(e);
      });
    });
    return (ENTRIES = { list, missing });
  }
  function runSearch(q, lgf) {
    const qt = norm(q).split(" ").filter(Boolean); if (!qt.length || !ENTRIES) return [];
    const qx = qt.join(" "), out = [];
    for (const e of ENTRIES.list) {
      if (lgf && !e.lgs.includes(lgf)) continue;
      let ok = true;
      for (const t of qt) if (!e.w.some(w => w.startsWith(t))) { ok = false; break; }
      if (!ok) continue;
      let s = e.b - e.name.length / 50;
      if (e.x === qx) s += 60; else if (e.x.startsWith(qx)) s += 25;
      if (e.k === "t" && (e.ab === qx || e.sh === qx)) s += 45;
      out.push([s, e]);
    }
    return out.sort((a, b) => b[0] - a[0]).slice(0, 40).map(r => r[1]);
  }
  const hrefOf = e => (e.k === "t" ? `#/t/${e.lg}/${e.o.id}` : `#/p/${e.lg}/${e.o.id}`);
  function resultRow(e, i) {
    const o = e.o, team = e.k === "t";
    const pic = team ? crest(o.logo, o.abbr || o.name) : avatar(o.img, o.name, o.team.color);
    const sub = team ? ["Team", o.record, o.group].filter(Boolean) : [o.pos, o.jersey ? "#" + o.jersey : "", o.team.name].filter(Boolean);
    return `<a class="sr" role="option" id="sr${i}" href="${hrefOf(e)}" data-i="${i}">${pic}<span class="sr-t"><b>${esc(e.name)}</b><span>${esc(sub.join(" · "))}</span></span><span class="sr-lg">${e.lgs.map(l => `<i>${esc(lgName(l))}</i>`).join("")}</span></a>`;
  }
  // recently viewed teams/players (this device only)
  const RKEY = "ls-recent";
  const recent = () => { try { return JSON.parse(localStorage.getItem(RKEY) || "[]"); } catch (e) { return []; } };
  const remember = item => { try { localStorage.setItem(RKEY, JSON.stringify([item, ...recent().filter(r => r.href !== item.href)].slice(0, 8))); } catch (e) {} };

  let searchLg = "";
  async function viewSearch(q0) {
    const tok = NAV; renderTabs(null);
    app.innerHTML = `<div class="page-head"><div><h1>Search</h1><div class="sub">Teams and players across all ${META.order.length} leagues</div></div></div>
      <div class="sbox"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input id="q" type="search" placeholder="Team or player, e.g. Eagles or Jalen Hurts" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="go" role="combobox" aria-expanded="true" aria-controls="sres" aria-label="Search teams and players">
        <button class="sclear" type="button" aria-label="Clear search" hidden>✕</button></div>
      <div class="chips sfilt" role="group" aria-label="Filter by league">${["", ...META.order].map(k => `<button type="button" class="chip${k === searchLg ? " on" : ""}" data-lg="${k}">${k ? esc(lgName(k)) : "All leagues"}</button>`).join("")}</div>
      <div id="sres" class="sres" role="listbox" aria-label="Results"><div class="loading s-load" aria-busy="true"><span class="sr-only">Loading search index…</span>${'<span class="sk sk-row"></span>'.repeat(5)}</div></div>`;
    const inp = app.querySelector("#q"), box = app.querySelector("#sres"), clr = app.querySelector(".sclear");
    inp.value = q0 || "";
    inp.focus({ preventScroll: true });
    try { await searchEntries(); } catch (e) {}
    if (tok !== NAV) return;
    let cur = [], sel = 0;
    const mark = () => box.querySelectorAll(".sr").forEach((a, i) => { a.classList.toggle("sel", i === sel); a.setAttribute("aria-selected", i === sel); if (i === sel) inp.setAttribute("aria-activedescendant", a.id); });
    const draw = () => {
      const q = inp.value.trim(); clr.hidden = !q;
      if (!ENTRIES || !ENTRIES.list.length) { box.innerHTML = `<div class="empty"><h3>Search isn't available right now</h3>The team and player index hasn't been built yet. It's created with the next data refresh.</div>`; return; }
      const miss = ENTRIES.missing.length ? `<div class="note">Not searchable right now: ${ENTRIES.missing.map(lgName).join(", ")} (index file missing).</div>` : "";
      if (!q) {
        const r = recent();
        const tries = ["Eagles", "Jalen Hurts", "Lakers", "Arsenal", "Duke", "Yankees"];
        box.innerHTML = (r.length ? `<div class="section-title">Recently viewed</div><div class="srl">${r.map(x => `<a class="sr" href="${esc(x.href)}">${x.k === "t" ? crest(x.img, x.name) : avatar(x.img, x.name, x.color)}<span class="sr-t"><b>${esc(x.name)}</b><span>${esc(x.sub || "")}</span></span><span class="sr-lg"><i>${esc(lgName(x.lg))}</i></span></a>`).join("")}</div>` : "")
          + `<div class="section-title">Try</div><div class="chips">${tries.map(t => `<button type="button" class="chip try">${esc(t)}</button>`).join("")}</div>`
          + `<div class="note">${ENTRIES.list.length.toLocaleString()} teams and players. College players: FBS (football) and Division I (basketball) rosters.</div>${miss}`;
        box.querySelectorAll(".try").forEach(b => (b.onclick = () => { inp.value = b.textContent; inp.dispatchEvent(new Event("input")); inp.focus(); }));
        cur = []; return;
      }
      cur = runSearch(q, searchLg); sel = 0;
      box.innerHTML = cur.length ? `<div class="srl">${cur.map(resultRow).join("")}</div>${cur.length === 40 ? `<div class="note">Showing the top 40. Keep typing to narrow it down.</div>` : ""}${miss}`
        : `<div class="empty"><h3>No matches for “${esc(q)}”</h3>Try a last name, a city or a team nickname${searchLg ? `, or search all leagues` : ""}.</div>${miss}`;
      mark();
    };
    inp.oninput = () => { draw(); history.replaceState(null, "", "#/search" + (inp.value.trim() ? "/" + encodeURIComponent(inp.value.trim()) : "")); };
    inp.onkeydown = e => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (!cur.length) return; e.preventDefault();
        sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + cur.length) % cur.length; mark();
        box.querySelector(".sr.sel")?.scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter") { if (cur[sel]) { e.preventDefault(); inp.blur(); location.hash = hrefOf(cur[sel]); } }
      else if (e.key === "Escape") { if (inp.value) { inp.value = ""; inp.oninput(); } else inp.blur(); }
    };
    clr.onclick = () => { inp.value = ""; inp.oninput(); inp.focus(); };
    app.querySelectorAll(".sfilt .chip").forEach(b => (b.onclick = () => {
      searchLg = b.dataset.lg; app.querySelectorAll(".sfilt .chip").forEach(x => x.classList.toggle("on", x === b)); draw();
    }));
    inp.oninput(); // also syncs the hash if the user typed while the index was loading
  }

  // ---------- team page
  function schedGames(sch, id, kind) {
    return ((sch && sch.events) || []).map(ev => {
      const c = (ev.competitions || [])[0] || {}, cs = c.competitors || [];
      const me = cs.find(x => String(x.id || (x.team || {}).id) === String(id)), op = cs.find(x => x !== me);
      if (!me || !op) return null;
      const st = (c.status || ev.status || {}).type || {};
      const sc = x => (x.score == null ? null : typeof x.score === "object" ? x.score.displayValue ?? x.score.value : x.score);
      const ms = sc(me), os = sc(op), a = parseFloat(ms), b = parseFloat(os);
      let res = null;
      if (st.completed) res = me.winner ? "W" : op.winner ? "L" : isNum(a) && isNum(b) ? (a > b ? "W" : a < b ? "L" : kind === "soccer" ? "D" : "T") : null;
      const ot = op.team || {};
      return { id: String(ev.id), date: c.date || ev.date, state: st.state, done: !!st.completed, detail: st.shortDetail || st.detail || "", home: me.homeAway === "home",
               opp: { id: ot.id, name: ot.displayName || ot.name || "", abbr: ot.abbreviation || "", logo: (ot.logos || [])[0]?.href || ot.logo || "" }, ms, os, gf: a, ga: b, res };
    }).filter(Boolean);
  }
  function gameRow(g, lg, inIdx, upcoming) {
    const opp = `<span class="gr-o">${g.home ? "vs" : "@"} ${crest(g.opp.logo, g.opp.abbr || g.opp.name, "xs")}<span class="nm-l">${esc(g.opp.name)}</span><span class="nm-s">${esc(g.opp.abbr || g.opp.name)}</span></span>`;
    const right = upcoming ? `<span class="gr-r">${g.state === "in" ? `<b class="live">LIVE</b>` : esc(timeET(g.date))}${inIdx ? ` <span class="gr-go">Lines ›</span>` : ""}</span>`
                           : `<span class="gr-r"><span class="res ${esc(g.res || "")}">${esc(g.res || "")}</span> <span class="num">${esc(g.ms ?? "")}-${esc(g.os ?? "")}</span></span>`;
    const inner = `<span class="gr-d">${fmt(g.date, { month: "short", day: "numeric" })}</span>${opp}${right}`;
    return inIdx ? `<a class="grow" href="#/g/${lg}/${g.id}">${inner}</a>` : `<div class="grow">${inner}</div>`;
  }
  const KEY_STATS = {
    football: [["scoring", "totalPointsPerGame", "Points / game"], ["passing", "netPassingYardsPerGame", "Pass yds / game"], ["rushing", "rushingYardsPerGame", "Rush yds / game"], ["passing", "passingTouchdowns", "Pass TD"], ["rushing", "rushingTouchdowns", "Rush TD"], ["passing", "interceptions", "INT thrown"], ["miscellaneous", "thirdDownConvPct", "3rd down %"], ["defensive", "sacks", "Sacks (def)"], ["defensiveInterceptions", "interceptions", "INT (def)"], ["miscellaneous", "totalPenaltyYards", "Penalty yds"]],
    basketball: [["offensive", "avgPoints", "Points / game"], ["offensive", "fieldGoalPct", "FG %"], ["offensive", "threePointFieldGoalPct", "3PT %"], ["offensive", "freeThrowPct", "FT %"], ["general", "avgRebounds", "Rebounds / game"], ["offensive", "avgAssists", "Assists / game"], ["offensive", "avgTurnovers", "Turnovers / game"], ["defensive", "avgSteals", "Steals / game"], ["defensive", "avgBlocks", "Blocks / game"]],
    hockey: [["offensive", "goals", "Goals"], ["defensive", "goalsAgainst", "Goals against"], ["defensive", "avgGoalsAgainst", "GA / game"], ["offensive", "shootingPct", "Shooting %"], ["defensive", "savePct", "Save %"], ["offensive", "powerPlayGoals", "PP goals"], ["offensive", "faceoffPercent", "Faceoff %"], ["penalties", "penaltyMinutes", "PIM"]],
    baseball: [["batting", "avg", "AVG"], ["batting", "OPS", "OPS"], ["batting", "runs", "Runs"], ["batting", "homeRuns", "Home runs"], ["batting", "stolenBases", "Stolen bases"], ["pitching", "ERA", "ERA"], ["pitching", "WHIP", "WHIP"], ["pitching", "strikeouts", "Strikeouts (P)"], ["fielding", "fieldingPct", "Fielding %"]],
  };
  const statBox = (label, val, sub) => `<div class="stat"><span class="sl">${esc(label)}</span><b class="num">${esc(val)}</b>${sub ? `<span class="ss">${esc(sub)}</span>` : ""}</div>`;
  function teamStats(st, kind, games) {
    if (kind === "soccer") {
      const done = games.filter(g => g.done && isNum(g.gf) && isNum(g.ga));
      if (!done.length) return null;
      const w = done.filter(g => g.res === "W").length, d = done.filter(g => g.res === "D").length, l = done.length - w - d;
      const gf = done.reduce((s, g) => s + g.gf, 0), ga = done.reduce((s, g) => s + g.ga, 0), cs = done.filter(g => g.ga === 0).length;
      return { label: "This competition (completed games)", html: [statBox("Played", done.length), statBox("W-D-L", `${w}-${d}-${l}`), statBox("Points", 3 * w + d), statBox("Goals for", gf, (gf / done.length).toFixed(2) + " / game"), statBox("Goals against", ga, (ga / done.length).toFixed(2) + " / game"), statBox("Goal diff", (gf - ga > 0 ? "+" : "") + (gf - ga)), statBox("Clean sheets", cs)].join("") };
    }
    const cats = (((st || {}).results || {}).stats || {}).categories || [];
    if (!cats.length) return null;
    const find = (c, n) => ((cats.find(x => x.name === c) || {}).stats || []).find(x => x.name === n);
    let boxes = (KEY_STATS[kind] || []).map(([c, n, lab]) => { const s = find(c, n); return s && s.displayValue != null ? statBox(lab, s.displayValue, s.rankDisplayValue) : ""; }).filter(Boolean);
    if (!boxes.length) boxes = (cats[0].stats || []).slice(0, 8).map(s => statBox(s.displayName || s.name, s.displayValue));
    const season = (st.season && st.season.displayName) || "";
    return { label: season + (st.season && st.season.type === 3 ? " postseason" : ""), html: boxes.join("") };
  }
  function teamHero(t, info, lg) {
    const color = hexOk(t.color) ? "#" + t.color : "#334155";
    const chips = [info.record && `<span class="chip"><b>${esc(info.record)}</b></span>`, info.standing && `<span class="chip">${esc(info.standing)}</span>`,
      !info.standing && t.group && `<span class="chip">${esc(t.group)}</span>`, `<span class="chip">${esc(lgName(lg))}</span>`].filter(Boolean).join("");
    return `<div class="phero" style="--tc:${color}">${crest(t.logo, t.abbr || t.name, "xl")}<div class="ph-t"><h1>${esc(t.name)}</h1><div class="chips">${chips}</div>${info.form ? `<div class="ph-f">Last ${info.form.length} ${formDots(info.form)}</div>` : ""}</div></div>`;
  }
  async function viewTeam(lg, id) {
    const tok = NAV; renderTabs(lg); window.scrollTo(0, 0);
    if (!LG[lg]) return (app.innerHTML = `<div class="empty"><h3>Unknown league</h3></div>`);
    const [path, kind] = LG[lg], mlb = lg === "mlb", sp = `site/v2/sports/${path}/teams/${id}`;
    app.innerHTML = skelGame();
    // MLB: default schedule is postseason, so also pull the regular season. Soccer: default is results only, fixture=true gives upcoming.
    const extra = mlb ? "?seasontype=2" : kind === "soccer" ? "?fixture=true" : "";
    const [d, sch, sch2, st, li] = await Promise.all([settle(sidx(lg)), settle(espn(`${sp}/schedule`)), extra ? settle(espn(`${sp}/schedule${extra}`)) : null,
      kind === "soccer" ? null : settle(espn(`${sp}/statistics${mlb ? "?seasontype=2" : ""}`)), settle(getJSON(`data/${lg}/index.json`))]);
    if (tok !== NAV) return;
    const it = d && d.teamById[id], stT = (mlb ? (sch2 && sch2.team) || (sch && sch.team) : (sch && sch.team) || (sch2 && sch2.team)) || {};
    if (!it && !stT.id) return (app.innerHTML = `${backLink()}<div class="empty"><h3>Team not found</h3>We couldn't load this team from ESPN. Check your connection and try again.</div>`);
    const t = it || { id, name: stT.displayName || "", abbr: stT.abbreviation || "", logo: (stT.logo || ((stT.logos || [])[0] || {}).href || ""), color: stT.color || "", record: "", group: "" };
    // games: merge both schedule calls by id (MLB post+regular, soccer results+fixtures)
    const gm = {}; [...schedGames(sch, id, kind), ...schedGames(sch2, id, kind)].forEach(g => (gm[g.id] = g));
    const games = Object.values(gm).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const done = games.filter(g => g.done).reverse(), next = games.filter(g => !g.done && g.state !== "post");
    const idxGames = (li && li.games) || [], idxIds = new Set(idxGames.map(g => String(g.id)));
    const form = done.slice(0, 5).map(g => g.res || "").join("").replace(/[^WLDT]/g, "");
    const info = { record: (mlb ? t.record || stT.recordSummary : stT.recordSummary || t.record), // ESPN schedule recordSummary is the postseason record for MLB
      standing: stT.standingSummary, form };
    remember({ k: "t", lg, href: `#/t/${lg}/${id}`, name: t.name, img: t.logo, sub: ["Team", info.record].filter(Boolean).join(" · ") });
    let html = `${backLink()}${teamHero(t, info, lg)}`;
    // next game + lines (only from our own data; never invented)
    const ng = idxGames.filter(g => g.state !== "post" && (String(g.home.id) === String(id) || String(g.away.id) === String(id))).sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
    html += `<div class="section-title">Next game</div>`;
    if (ng) html += `<div class="grid one">${gameTile(ng, lg, li.league.kind)}</div>`;
    else if (next[0]) html += `<div class="card"><div class="grows">${gameRow(next[0], lg, false, true)}</div><div class="note">${esc(dayLabel(next[0].date))}. Lines for this game aren't in our data yet (we track the next ${esc((li && li.windowDays) || "few")} days).</div></div>`;
    else html += notAvail("No upcoming games", "Nothing on ESPN's schedule for this team right now (off-season or break).");
    // stats
    const ts = teamStats(st, kind, games);
    if (window.LSAdv) html += window.LSAdv.teamSlot(lg);
    html += `<div class="section-title">Season stats${ts && ts.label ? ` <span class="st-sub">${esc(ts.label)}</span>` : ""}</div>` + (ts ? `<div class="statgrid">${ts.html}</div>` : notAvail("Season stats", "ESPN has no team stats for this season yet."));
    // results / schedule
    const recentHtml = done.length ? `<div class="grows">${done.slice(0, 6).map(g => gameRow(g, lg, idxIds.has(g.id), false)).join("")}</div>` : `<div class="na">No completed games this season yet.</div>`;
    const upHtml = next.length ? `<div class="grows">${next.slice(0, 6).map(g => gameRow(g, lg, idxIds.has(g.id), true)).join("")}</div>` : `<div class="na">No upcoming games scheduled.</div>`;
    html += `<div class="cols tcols"><div class="card"><h3>Recent results</h3>${recentHtml}</div><div class="card"><h3>Upcoming</h3>${upHtml}</div></div>`;
    if (!sch && !sch2) html += `<div class="note">Schedule not available from ESPN right now.</div>`;
    // roster: from the search index; if it has none (index missing, or a college team outside FBS / D-I), ask ESPN live
    let ro = (d && d.byTeam[id]) || [], live = false;
    if (!ro.length) {
      const r = await settle(espn(`${sp}/roster`)); if (tok !== NAV) return;
      const ath = ((r && r.athletes) || []).flatMap(a => (a && Array.isArray(a.items) ? a.items : [a]));
      ro = ath.filter(a => a && a.id && (a.displayName || a.fullName)).map(a => ({ id: String(a.id), name: a.displayName || a.fullName, pos: ((a.position || {}).abbreviation) || "", jersey: a.jersey || "", img: (a.headshot || {}).href || "" }));
      live = ro.length > 0;
    }
    html += `<div class="section-title">Roster${ro.length ? ` <span class="st-sub">${ro.length} players</span>` : ""}</div>`;
    if (ro.length) {
      const by = {}; ro.forEach(p => (by[p.pos || "—"] ||= []).push(p));
      html += `<div class="roster">${Object.entries(by).map(([pos, ps]) => `<div class="rgrp"><div class="rpos">${esc(pos)}</div><div class="rlist">${ps.map(p => `<a class="pl" href="#/p/${lg}/${p.id}">${avatar(p.img, p.name, t.color, "sm")}<span><b>${esc(p.name)}</b><span>${p.jersey ? "#" + esc(p.jersey) : ""}</span></span></a>`).join("")}</div></div>`).join("")}</div>`
        + (live ? `<div class="note">Roster loaded live from ESPN.${d && it && !it.hasRoster && (lg === "ncaaf" || lg === "ncaab") ? ` Player search covers ${lg === "ncaaf" ? "FBS" : "Division I"} programs only, so these players aren't searchable.` : ""}</div>`
          : d && d.meta.rostersAsOf ? `<div class="note">Roster from ESPN, as of ${esc(fullET(d.meta.rostersAsOf))}.</div>` : "");
    } else {
      html += notAvail("Roster", "ESPN didn't return a roster for this team.");
    }
    app.innerHTML = html;
    if (ng) startLive([liveRef(lg, ng)]);
    const av = document.getElementById("advTeam");
    if (av) window.LSAdv.mountTeam(av, lg, id, () => tok === NAV).catch(e => console.warn(e));
  }

  // ---------- player page
  // optional "Passing | Rushing" header row when ESPN groups the columns into categories
  function catRow(cats, n, lead) {
    cats = (cats || []).filter(c => c && c.count > 0);
    if (cats.length < 2 || cats.reduce((t, c) => t + c.count, 0) !== n) return "";
    return `<tr class="cat"><th colspan="${lead}"></th>${cats.map(c => `<th colspan="${c.count}">${esc(c.displayName || c.name || "")}</th>`).join("")}</tr>`;
  }
  function statTable(s) {
    const labels = (s && s.labels) || [], names = (s && s.displayNames) || [];
    const splits = ((s && s.splits) || []).filter(x => !/projected/i.test(x.displayName || "") && (x.stats || []).length);
    if (!labels.length || !splits.length) return null;
    return `<div class="tbl-wrap"><table class="ptbl"><thead>${catRow(s.categories, labels.length, 1)}<tr><th>Split</th>${labels.map((l, i) => `<th title="${esc(names[i] || l)}">${esc(l)}</th>`).join("")}</tr></thead>
      <tbody>${splits.slice(0, 6).map(x => `<tr><td>${esc(x.displayName || "")}</td>${(x.stats || []).map(v => `<td class="num">${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }
  function gameLog(gl, lg, idxIds) {
    if (!gl || !gl.events) return null;
    const labels = gl.labels || [], names = gl.displayNames || [], rows = {};
    for (const s of gl.seasonTypes || []) for (const c of s.categories || []) for (const e of c.events || []) if (e.eventId && !rows[e.eventId]) rows[e.eventId] = e.stats || [];
    const list = Object.keys(rows).map(id => ({ id, st: rows[id], ev: gl.events[id] })).filter(r => r.ev && r.ev.gameDate)
      .sort((a, b) => String(b.ev.gameDate).localeCompare(String(a.ev.gameDate))).slice(0, 10);
    if (!list.length) return null;
    const body = list.map(r => {
      const o = r.ev.opponent || {}, res = r.ev.gameResult || "";
      const d = fmt(r.ev.gameDate, { month: "short", day: "numeric" });
      return `<tr><td>${idxIds.has(String(r.id)) ? `<a class="lnk" href="#/g/${lg}/${r.id}">${d}</a>` : d}</td><td class="gl-o">${esc(r.ev.atVs || "")} ${crest(o.logo, o.abbreviation || o.displayName, "xs")}${esc(o.abbreviation || o.displayName || "")}</td>
        <td><span class="res ${esc(res)}">${esc(res)}</span> <span class="num">${esc(r.ev.score || "")}</span></td>${r.st.map(v => `<td class="num">${esc(v)}</td>`).join("")}</tr>`;
    }).join("");
    return { n: list.length, html: `<div class="tbl-wrap"><table class="ptbl glog"><thead>${catRow(gl.categories, labels.length, 3)}<tr><th>Date</th><th>Opp</th><th>Result</th>${labels.map((l, i) => `<th title="${esc(names[i] || l)}">${esc(l)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>` };
  }
  async function viewPlayer(lg, id, sub) {
    if (lg === "ufc" && window.LSUfc) return window.LSUfc.fighter(id);   // fighter page (assets/ufc.js)
    const tok = NAV, wantMatchup = sub === "m"; renderTabs(lg); window.scrollTo(0, 0);
    if (!LG[lg]) return (app.innerHTML = `<div class="empty"><h3>Unknown league</h3></div>`);
    const [path, kind] = LG[lg], base = `common/v3/sports/${path}/athletes/${id}`;
    app.innerHTML = skelGame();
    const [d, bio, ov, gl, li] = await Promise.all([settle(sidx(lg)), settle(espn(base)), settle(espn(base + "/overview")), settle(espn(base + "/gamelog")), settle(getJSON(`data/${lg}/index.json`))]);
    if (tok !== NAV) return;
    const p = d && d.byId[id], a = (bio && bio.athlete) || null;
    if (!p && !a) return (app.innerHTML = `${backLink()}<div class="empty"><h3>Player not found</h3>We couldn't load this player from ESPN. Check your connection and try again.</div>`);
    const at = a || {}, team = at.team || {};
    const tid = String(team.id || (p && p.team.id) || ""), it = d && d.teamById[tid];
    const tname = team.displayName || (it && it.name) || (p && p.team.name) || "";
    const color = (it && it.color) || team.color || "";
    const img = (at.headshot && at.headshot.href) || (p && p.img) || "";
    const name = at.displayName || (p && p.name) || "";
    const pos = (at.position && (at.position.displayName || at.position.abbreviation)) || (p && p.pos) || "";
    const jersey = at.displayJersey || (p && p.jersey ? "#" + p.jersey : "");
    remember({ k: "p", lg, href: `#/p/${lg}/${id}`, name, img, color, sub: [(p && p.pos) || (at.position || {}).abbreviation, tname].filter(Boolean).join(" · ") });
    const status = at.status && at.status.name && !/^active$/i.test(at.status.name) ? `<span class="badge ${/out|injur/i.test(at.status.name) ? "out" : "q"}">${esc(at.status.name)}</span>` : "";
    const chips = [pos && `<span class="chip">${esc(pos)}</span>`, jersey && `<span class="chip">${esc(jersey)}</span>`,
      tname && (tid ? `<a class="chip tchip" href="#/t/${lg}/${tid}">${crest((it && it.logo) || (team.logos || [])[0]?.href || team.logo, tname, "xs")}${esc(tname)}</a>` : `<span class="chip">${esc(tname)}</span>`),
      `<span class="chip">${esc(lgName(lg))}</span>`].filter(Boolean).join("");
    const bioRows = [["Height / weight", [at.displayHeight, at.displayWeight].filter(Boolean).join(", ")], ["Age", at.age ? `${at.age}${at.displayDOB ? ` (born ${at.displayDOB})` : ""}` : ""],
      ["Birthplace", at.displayBirthPlace], ["College", (at.college && (at.college.name || at.college.shortName)) || ""], ["Draft", at.displayDraft], ["Experience", at.displayExperience],
      ["Bats / throws", at.displayBatsThrows || ""], ["Hand", at.hand && at.hand.displayValue], ["Citizenship", at.citizenship]].filter(r => r[1]);
    let html = `${backLink()}<div class="phero" style="--tc:${hexOk(color) ? "#" + color : "#334155"}">${avatar(img, name, color, "xl")}<div class="ph-t"><h1>${esc(name)} ${status}</h1><div class="chips">${chips}</div></div></div>`;
    const MU = window.LSMatchup, muOn = !!(MU && MU.SUPPORTED.has(lg));
    if (muOn) html += `<div class="section-title" id="matchup">Matchup <span class="st-sub">next opponent</span></div><div class="mu" id="muBox"></div>`;
    if (window.LSAdv) html += window.LSAdv.playerSlot(lg);
    if (window.LSProps && window.LSProps.SUPPORTED.has(lg)) html += `<div id="ppPlayer"></div>`;
    html += `<div class="section-title">Bio</div>` + (bioRows.length ? `<div class="card"><dl class="bio">${bioRows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl></div>` : notAvail("Bio", a ? "ESPN lists no bio details for this player." : "Bio not available from ESPN right now."));
    // season stats (overview splits) with headline boxes from the first split
    const s = ov && ov.statistics, tbl = statTable(s);
    if (tbl) {
      const first = s.splits.find(x => !/projected/i.test(x.displayName || "") && (x.stats || []).length);
      const boxes = (s.labels || []).slice(0, 6).map((l, i) => statBox((s.displayNames || [])[i] || l, first.stats[i])).join("");
      html += `<div class="section-title">Stats <span class="st-sub">${esc(first.displayName || "")}</span></div><div class="statgrid">${boxes}</div><div class="card" style="margin-top:12px"><h3>Season and career</h3>${tbl}</div>`;
    } else html += `<div class="section-title">Stats</div>` + notAvail("Season stats", "ESPN has no stats for this player this season.");
    const idxIds = new Set(((li && li.games) || []).map(g => String(g.id)));
    const glh = gameLog(gl, lg, idxIds);
    html += `<div class="section-title">Game log ${glh ? `<span class="st-sub">${glh.n === 1 ? "last game" : `last ${glh.n} games`}</span>` : ""}</div>` + (glh ? `<div class="card">${glh.html}</div>` : notAvail("Game log", "No game-by-game stats from ESPN for this player yet."));
    html += `<div class="note">Player data from ESPN, loaded live. Times in ${TZL}.</div>`;
    app.innerHTML = html;
    const ppEl = document.getElementById("ppPlayer");
    if (ppEl) window.LSProps.mountPlayer(ppEl, lg, String(id), () => tok === NAV).catch(e => console.warn(e));
    const avP = document.getElementById("advPlayer");
    if (avP) window.LSAdv.mountPlayer(avP, lg, String(id), () => tok === NAV).catch(e => console.warn(e));
    if (muOn) {
      const box = document.getElementById("muBox");
      if (wantMatchup) document.getElementById("matchup")?.scrollIntoView();
      MU.mount(box, { lg, id: String(id), teamId: tid, teamAbbr: (it && it.abbr) || team.abbreviation || "", teamName: tname, name, pos: (p && p.pos) || (at.position || {}).abbreviation || "",
        status: at.status && at.status.name && !/^active$/i.test(at.status.name) ? at.status.name : "", rookie: /rookie|^1st/i.test(at.displayExperience || "") || (at.experience && at.experience.years === 0),
        gamelog: gl, index: li, alive: () => tok === NAV }).then(() => { if (wantMatchup && tok === NAV) document.getElementById("matchup")?.scrollIntoView(); }, e => { box.innerHTML = notAvail("Matchup", "Couldn't load matchup stats right now."); console.warn(e); });
    }
  }


  // ---------- Live tab (#/live): every game in progress across leagues, plus starting soon / just finished.
  // Bucketing lives in assets/livetab-core.js (scripts/livetab_test.mjs). Scores: the same client-side ESPN polling as
  // the rest of the site (assets/live.js, ~25 s, only while this tab is visible); no new server calls.
  const LTC = () => window.LiveTabCore || null;
  const FIN = {}, LSEEN = {};    // "lg/id" -> ms we saw it go final this session / last state rendered
  let LIVE_N = null, LIVE_N_AT = 0;
  const liveCount = () => (LIVE_N !== null && Date.now() - LIVE_N_AT < 10 * 60e3 ? LIVE_N : (((META || {}).slate || {}).totals || {}).live || 0);
  function setLiveBadge(n) {
    document.querySelectorAll("[data-live-badge]").forEach(el => { el.textContent = n > 99 ? "99+" : String(n || 0); el.hidden = !n; });
    document.querySelectorAll("[data-live-link]").forEach(el => {
      el.classList.toggle("has-live", !!n);
      el.setAttribute("aria-label", n ? `Live: ${n} game${n === 1 ? "" : "s"} in progress` : "Live scores");
    });
  }
  const pendingBetKeys = () => {
    const C = window.BetCore; if (!C || !LTC()) return new Set();
    try { const d = JSON.parse(localStorage.getItem(C.KEY) || "null"); return LTC().betKeys(Array.isArray(d && d.bets) ? d.bets : []); } catch (e) { return new Set(); }
  };
  const inMin = ms => { const m = Math.round(ms / 60e3); return m <= 0 ? "now" : m < 60 ? `in ${m} min` : `in ${Math.floor(m / 60)}h${m % 60 ? " " + (m % 60) + "m" : ""}`; };
  function ltRow(x, kind, bets, now) {
    const { lg, g } = x, k = `${lg}/${g.id}`, mma = kind === "mma";
    if (x.fights) {   // a UFC card (soon / just finished): one row per event
      const ev = x.event || {}, mn = x.main;
      return `<a class="lt-row lt-ev" href="#/l/ufc"><div class="lt-st">${x.g.state === "pre" ? `<span>${esc(timeET(x.g.date))}</span><small>${esc(x.starting ? "starting" : inMin(x.at - now))}</small>` : `<span>Final</span>`}</div>
        <div class="lt-body"><div class="lt-evn">${esc(ev.name || "UFC")}</div><div class="lt-sub">${mn ? esc(`${mn.away.name} vs ${mn.home.name} · `) : ""}${x.fights} fight${x.fights === 1 ? "" : "s"}</div></div></a>`;
    }
    const A = g.away || {}, Hm = g.home || {}, ov = g.live;
    const sc = !mma && g.state !== "pre" && A.score != null && Hm.score != null && A.score !== "" && Hm.score !== "";
    const aw = sc && +A.score > +Hm.score, hw = sc && +Hm.score > +A.score;
    const poss = ov && g.state === "in" && ov.situation && ov.situation.possession;
    const possSide = poss ? (String(ov.home.id) === String(poss) ? "home" : String(ov.away.id) === String(poss) ? "away" : null) : null;
    const name = t => (mma ? t.short || t.name : t.short || t.name || t.abbr) || "TBD";
    const tm = (t, side, lead, trail) => `<div class="lt-tm${lead ? " w" : trail && g.state === "post" ? " l" : ""}">${logo(t, "lt-logo")}<span class="lt-n">${t.rank ? `<i class="lt-rk">${esc(t.rank)}</i>` : ""}${esc(name(t))}</span>${possSide === side ? '<i class="lt-poss" title="Possession" aria-label="has the ball"></i>' : ""}${mma && g.state === "post" && t.winner ? '<i class="lt-win">W</i>' : ""}<b class="lt-sc">${sc ? esc(t.score) : ""}</b></div>`;
    const st = g.state === "in" ? `<span class="lt-clk"><span class="live-dot"></span>${esc(LTC().clockText(lg, g, kind))}</span>`
      : g.state === "pre" ? `<span>${esc(timeET(g.date))}</span><small>${esc(x.starting ? "starting" : inMin(x.at - now))}</small>`
      : `<span>${esc(g.statusDetail || "Final")}</span>${x.at ? `<small>${esc(Math.max(1, Math.round((now - x.at) / 60e3)))} min ago</small>` : ""}`;
    const sit = g.state === "in" && ov && ov.situation && ov.situation.text ? `<div class="lt-sit${ov.situation.redZone ? " rz" : ""}">${esc(ov.situation.text)}</div>` : "";
    const fight = mma ? `<div class="lt-sub">${esc([g.weightClass || g.note, g.event && g.event.short].filter(Boolean).join(" · "))}</div>` : "";
    const bet = bets.has(k) ? `<span class="lt-bet" title="You have a pending bet on this game in My Bets">${ICON("ticket", "ic")}You have a bet</span>` : "";
    return `<a class="lt-row lt-${esc(g.state)}" href="#/g/${esc(lg)}/${esc(g.id)}" data-lk="${esc(k)}"><div class="lt-st">${st}</div>
      <div class="lt-body">${tm(A, "away", aw, hw)}${tm(Hm, "home", hw, aw)}${fight}${sit}${bet ? `<div class="lt-tags">${bet}</div>` : ""}</div></a>`;
  }
  async function viewLive() {
    renderTabs(null);
    const tok = NAV, alive = () => tok === NAV, C = LTC();
    if (!C) return (app.innerHTML = `<div class="empty"><h3>Live scores didn't load</h3>Reload the page to try again.</div>`);
    if (!app.querySelector(".lt-page")) showSkel(skelLeague());
    const idx = {};   // lg -> data/<lg>/index.json
    const load = async () => {
      const m = await getJSON("data/meta.json").catch(() => META); if (m) META = m;
      await Promise.all(C.leaguesToLoad(META).map(lg => getJSON(`data/${lg}/index.json`).then(d => { idx[lg] = d; }, () => {})));
    };
    await load();
    if (!alive()) return;
    let watched = "";
    const render = () => {
      if (!alive()) return;
      const now = Date.now(), items = [], kinds = {};
      for (const [lg, d] of Object.entries(idx)) {
        kinds[lg] = (d.league || {}).kind;
        for (const g0 of d.games || []) {
          const g = liveG(lg, g0), k = `${lg}/${g.id}`;
          if (LSEEN[k] === "in" && g.state === "post" && !FIN[k]) FIN[k] = now;
          LSEEN[k] = g.state; items.push({ lg, g });
        }
      }
      const B = C.classify(items, now, { finishedAt: FIN }), bets = pendingBetKeys(), order = META.order || [];
      LIVE_N = B.live.length; LIVE_N_AT = now; setLiveBadge(LIVE_N);
      const lgName2 = lg => (META.leagues[lg] || {}).name || lg.toUpperCase();
      const block = (list, cap) => {
        let shown = 0, more = 0;
        const html = C.group(list, order).map(({ lg, items: xs }) => {
          const room = cap ? Math.max(0, cap - shown) : xs.length, vis = xs.slice(0, room); more += xs.length - vis.length; shown += vis.length;
          if (!vis.length) return "";
          const n = xs.filter(x => x.g.state === "in").length;
          return `<div class="lt-lg"><div class="lt-lgh"><a href="#/l/${esc(lg)}">${esc(lgName2(lg))}</a>${n ? `<span class="lt-n-live">${n} live</span>` : `<span>${xs.length}</span>`}</div>
            <div class="lt-grid">${vis.map(x => ltRow(x, kinds[x.lg], bets, now)).join("")}</div></div>`;
        }).join("");
        return html + (more ? `<div class="lt-more">+ ${more} more · see each league for the full list</div>` : "");
      };
      const soon = C.collapseFights(B.soon), recent = C.collapseFights(B.recent);
      const next = B.live.length || soon.length ? null : items.filter(x => x.g.state === "pre" && Date.parse(x.g.date) > now).sort((a, b) => Date.parse(a.g.date) - Date.parse(b.g.date))[0];
      const nextLine = next ? `Next up: <a href="#/g/${esc(next.lg)}/${esc(next.g.id)}">${esc(lgName2(next.lg))} · ${esc((next.g.away || {}).short || (next.g.away || {}).name || "")} ${kinds[next.lg] === "mma" ? "vs" : "@"} ${esc((next.g.home || {}).short || (next.g.home || {}).name || "")}</a>, ${esc(dayKey(next.g.date) === dayKey(new Date(now).toISOString()) ? timeET(next.g.date) : fullET(next.g.date))}` : "";
      const liveSec = B.live.length ? block(B.live)
        : `<div class="empty lt-empty"><div class="lt-empty-ic">${ICON("pulse", "ic")}</div><h3>Nothing live right now</h3>
            <p>${soon.length ? "Games are starting soon; see below. This page updates on its own once they tip off." : "No games are in progress in any league. Check back closer to game time."}</p>${nextLine ? `<p class="lt-next">${nextLine}</p>` : ""}
            <p><a class="lt-cta" href="#/">See today's slate</a></p></div>`;
      const hasLive = B.live.length > 0, old = app.querySelector(".lt-page [data-lv-stamp]"), stamp = old && old.textContent ? old.textContent : hasLive ? "Live · connecting…" : "";
      app.innerHTML = `<div class="lt-page"><div class="page-head"><div><span class="eyebrow">${hasLive ? '<span class="live-dot"></span>' : ICON("pulse", "ic")}Live scores</span>
          <h1>Live games${hasLive ? ` <span class="lt-count" aria-label="${B.live.length} in progress">${B.live.length}</span>` : ""}</h1>
          <div class="sub">Every game in progress across ${order.length} leagues · tap a game for the live box score · times in ${TZL}</div></div>
          <div class="lt-stamp${old && old.classList.contains("lv-off") ? " lv-off" : ""}" data-lv-stamp>${esc(hasLive || (old && old.textContent) ? stamp : "")}</div></div>
        <section class="lt-sec" aria-label="In progress"><div class="section-title">In progress</div>${liveSec}</section>
        ${soon.length ? `<section class="lt-sec lt-small" aria-label="Starting soon"><div class="section-title">Starting soon <span class="st-sub">next 2 hours</span></div>${block(soon, 12)}</section>` : ""}
        ${recent.length ? `<section class="lt-sec lt-small" aria-label="Just finished"><div class="section-title">Just finished <span class="st-sub">last hour</span></div>${block(recent, 12)}</section>` : ""}
        <div class="note lt-note">Scores refresh from ESPN about every 25 s while this tab is open (paused in the background). UFC fights update with each site data refresh (about every 30 min). Not affiliated with any league.</div></div>`;
      return items;
    };
    const rewatch = items => {
      const L = LV(); if (!L || !alive()) return;
      const now = Date.now();
      // in progress, about to start (12 h covers tonight), or final but maybe stale in the static file
      const refs = items.filter(({ g }) => g.state === "in" || (g.state === "pre" && Date.parse(g.date) - now < 12 * 3600e3 && now - Date.parse(g.date) < 8 * 3600e3)).map(({ lg, g }) => liveRef(lg, (idx[lg].games || []).find(x => x.id === g.id) || g));
      const sig = refs.map(r => `${r.lg}/${r.id}/${r.state}`).sort().join(",");
      if (sig === watched) return;
      watched = sig;
      L.watch({ games: refs, onChange: () => render(),
        onStatic: async lgs => { for (const lg of lgs) delete cache[`data/${lg}/index.json`]; await load(); if (!alive()) return null; const it = render(); return (it || []).filter(({ lg }) => lgs.includes(lg)).map(({ lg, g }) => liveRef(lg, g)); } });
    };
    rewatch(render() || []);
    // move games between sections as the clock runs, and pick up new static data; nothing runs while the tab is hidden
    let ticks = 0;
    const iv = setInterval(async () => {
      if (!alive()) return clearInterval(iv);
      if (document.hidden) return;
      if (++ticks % 6 === 0) { await load(); if (!alive()) return; }   // every ~3 min: re-read our data files (60 s cache)
      const it = render(); if (it) rewatch(it);
    }, 30e3);
  }

  // ---------- router
  async function route() {
    if (GEO()) await GEO().ready;
    if (!META) {
      try { META = await getJSON("data/meta.json"); const pv = META.previews; if (!pv) PREV = {}; else if (PREV.generated !== pv.generated) PREV = await getJSON("data/previews.json").catch(() => ({})); }
      catch (e) { app.innerHTML = `<div class="empty"><h3>No data yet</h3>Run <code>python3 scripts/build_data.py</code> then reload.</div>`; return; }
      const gen = META.generated ? new Date(META.generated) : null;
      if (gen) { const iso = gen.toISOString(); const u = document.getElementById("updated"); u.title = "Data updated " + fullET(iso); u.innerHTML = `<span class="dot"></span><span><span class="u-long">Updated ${esc(fmt(iso, { weekday: "short", month: "short", day: "numeric" }))}, </span>${esc(timeET(iso))}</span>`; }
    }
    const h = location.hash.replace(/^#\/?/, "").split("/");
    const isValue = h[0].split("?")[0] === "value";   // #/value?lg=&mk=&min=&h=
    NAV++;
    if (LV()) LV().stop();   // each view starts its own live watch for the games it shows
    const sb = document.getElementById("searchBtn"); if (sb) sb.classList.toggle("on", h[0] === "search");
    const bb = document.getElementById("betsBtn"); if (bb) bb.classList.toggle("on", h[0] === "bets");
    const vb = document.getElementById("valueBtn"); if (vb) vb.classList.toggle("on", isValue);
    const ab = document.getElementById("acctBtn"); if (ab) ab.classList.toggle("on", h[0] === "account");
    const lb = document.getElementById("liveBtn"); if (lb) lb.classList.toggle("on", h[0] === "live");
    const navOn = h[0] === "search" || h[0] === "bets" || h[0] === "account" || h[0] === "live" ? h[0] : isValue ? "value" : !h[0] ? "home" : "";
    setLiveBadge(liveCount());
    if (intro) intro.hidden = navOn !== "home";   // static SEO intro: home only
    document.querySelectorAll("#bnav [data-nav]").forEach(a => { const on = a.dataset.nav === navOn; a.classList.toggle("on", on); if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    if (h[0] === "bets") return window.LSBets ? window.LSBets.view() : (app.innerHTML = `<div class="empty"><h3>My Bets didn't load</h3>Reload the page to try again.</div>`);
    if (h[0] === "account") return window.LSAccount ? window.LSAccount.view() : (app.innerHTML = `<div class="empty"><h3>Account didn't load</h3>Reload the page to try again.</div>`);
    if (isValue) return window.LSValue ? window.LSValue.view() : (app.innerHTML = `<div class="empty"><h3>Value finder didn't load</h3>Reload the page to try again.</div>`);
    if (h[0] === "live") return viewLive();
    if (h[0] === "search") return viewSearch(decodeURIComponent(h.slice(1).join("/") || ""));
    if (h[0] === "t" && h[1] && h[2]) return viewTeam(h[1], h[2]);
    if (h[0] === "p" && h[1] && h[2]) return viewPlayer(h[1], h[2], h[3]);
    if (h[0] === "g" && h[1] && h[2]) return viewGame(h[1], h[2]);
    if (h[0] === "l" && h[1]) return viewLeague(h[1]);
    const def = (META.leagues[CFG.defaultLeague]?.upcoming ? CFG.defaultLeague : META.order.find(k => META.leagues[k]?.upcoming)) || META.order[0];
    return viewLeague(def, true);
  }
  window.addEventListener("hashchange", route);
  // visitor state changed (lookup finished or picker): re-render odds/offers views in place (not the bet form or search)
  window.addEventListener("ls-state-change", () => {
    const h0 = location.hash.replace(/^#\/?/, "").split("/")[0];
    if (h0 === "bets" || h0 === "search" || h0 === "account") return;
    const y = window.scrollY;
    Promise.resolve(route()).then(() => window.scrollTo(0, y));
  });
  // helpers shared with the My Bets tracker (assets/bets.js)
  window.LSApp = { previewHref, previewLink, esc, fmt, timeET, fullET, getJSON, LG, renderTabs, lgName, meta: () => META, nav: () => NAV, espn, crest, notAvail, sidx, linesCard, booksCard, lineMoveSection };
  // "/" opens search from anywhere (unless typing in a field)
  document.addEventListener("keydown", e => {
    if (e.key === "/" && !e.metaKey && !e.ctrlKey && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target || {}).tagName || "")) {
      e.preventDefault(); if (!location.hash.startsWith("#/search")) location.hash = "#/search"; else document.getElementById("q")?.focus();
    }
  });
  route();

  // ---------- PWA: offline note, service worker, install button
  function showOffline() {
    const el = document.getElementById("offlineNote"); if (!el) return;
    const gen = META && META.generated ? " from " + fullET(META.generated) : "";
    el.textContent = `You're offline — showing saved data${gen}. Lines may have moved; reconnect to refresh.`;
    el.hidden = false;
  }
  // Back online: soft refresh (drop cached JSON, re-render the current view) instead of location.reload(),
  // which keeps scroll/UI state and can't race a navigation the user starts at the same moment.
  window.addEventListener("online", () => {
    const el = document.getElementById("offlineNote"); if (!el || el.hidden) return;
    netGen++; el.hidden = true; for (const c of [cache, cacheAt, espnCache]) for (const k of Object.keys(c)) delete c[k]; META = null; route();
  });
  // service worker registration lives in assets/site.js (shared with the legal pages)
  const installBtn = document.getElementById("installBtn");
  const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault(); deferredPrompt = e;
    if (installBtn && !standalone()) installBtn.hidden = false;
  });
  installBtn && installBtn.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    installBtn.hidden = true; deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch (e) {}
    deferredPrompt = null;
  });
  window.addEventListener("appinstalled", () => { deferredPrompt = null; if (installBtn) installBtn.hidden = true; });
})();
