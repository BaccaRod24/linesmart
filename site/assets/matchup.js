/* LineSmart player matchups UI: the "Matchup" section on player pages (#/p/<lg>/<id>[/m]) and the
 * "Key player matchups" card on game pages. Math lives in matchup-core.js (window.MatchCore); app helpers come from
 * window.LSApp (app.js), read lazily because this file loads first. Past results only: nothing here predicts outcomes. */
(() => {
  const M = window.MatchCore;
  const A = () => window.LSApp;
  const SUPPORTED = new Set(["nfl", "nba"]);
  const isNum = v => M.isNum(v);
  const f1 = v => (isNum(v) ? (Math.abs(v) >= 100 ? Math.round(v) : Number(v).toFixed(1)).toString() : "–");
  const raw = v => (isNum(v) ? (Number.isInteger(+v) ? String(+v) : f1(v)) : "–");   // single-game values: 75, 7, 0.5
  const BUCKET_NAME = { QB: "QBs", RB: "RBs", WR: "WRs", TE: "TEs", G: "guards", F: "forwards", C: "centers" };
  const TIER = { tough: "Tough", mid: "Avg", soft: "Soft" };
  const trendIcon = t => (t === "up" ? `<i class="mu-tr up" title="Above season average">▲</i>` : t === "down" ? `<i class="mu-tr dn" title="Below season average">▼</i>` : t === "flat" ? `<i class="mu-tr fl" title="Near season average">•</i>` : "");
  const signed = v => (isNum(v) ? (v > 0 ? "+" + v : v === 0 ? "PK" : String(v)) : null);
  const amer = v => (isNum(v) ? (v > 0 ? "+" + v : String(v)) : null);
  const skel = `<div class="loading" aria-busy="true"><span class="sr-only">Loading matchup…</span><span class="sk skel-hero"></span></div>`;

  // ---------- next-game header
  function header(ctx, ng, sched, det) {
    const { esc, fullET, crest } = A(), lg = ctx.lg;
    if (!ng && !sched) return `<div class="card mu-next"><div class="na">No upcoming game on ESPN's schedule for ${esc(ctx.teamName || "this team")} (off-season, bye or break). Recent form below.</div></div>`;
    const opp = ng ? ng.opp : sched.opp, date = ng ? ng.game.date : sched.date, home = ng ? ng.home : sched.home;
    const where = home ? "Home" : "Away", at = home ? "vs" : "@";
    const G = window.LSGeo, ok = l => !G || !l.key || G.isAvailable(l.key);
    // books legal in the visitor's state first; the others are dimmed reference lines (Florida: Hard Rock Bet only)
    const lines = (ng ? M.linesFor(ng.game, home) : []).map((l, i) => [l, i]).sort((a, b) => (ok(b[0]) - ok(a[0])) || a[1] - b[1]).map(x => x[0]);
    const lineRows = lines.length ? lines.map(l => `<div class="mu-line${ok(l) ? "" : " mu-na"}"><span class="mu-bk">${esc(l.book)}${ok(l) ? "" : G.naTag(l.key)}</span><span class="num">${esc(ctx.teamAbbr || "")} ${esc(signed(l.spread) ?? "–")}${isNum(l.ml) ? ` <span class="na">(${esc(amer(l.ml))})</span>` : ""}</span><span class="num">O/U ${esc(isNum(l.total) ? l.total : "–")}</span></div>`).join("")
      : `<div class="na mu-line">${ng ? "No line posted yet." : `Lines aren't in our data yet (we track the next few days).`}</div>`;
    const inj = injuryFor(ctx, det);
    const link = ng ? `<a class="mu-go" href="#/g/${lg}/${ng.game.id}">Game page ›</a>` : "";
    return `<div class="card mu-next">
      <div class="mu-nh">${crest(opp.logo, opp.abbr || opp.name)}<div class="mu-nt"><div class="mu-k">Next game</div><b>${esc(at)} ${esc(opp.name || opp.abbr)}</b>
      <div class="mu-when">${esc(fullET(date))} · ${where}</div></div>${link}</div>
      ${inj}<div class="mu-lines">${lineRows}</div></div>`;
  }
  function injuryFor(ctx, det) {
    const { esc } = A();
    const rows = (((det || {}).detail || {}).injuries || {})[ctx.teamId] || [];
    const me = rows.find(r => r.player && ctx.name && r.player.toLowerCase() === ctx.name.toLowerCase());
    if (me) return `<div class="mu-inj"><span class="badge ${/out|reserve/i.test(me.status || "") ? "out" : "q"}">${esc(me.status || "Listed")}</span> ${esc([me.type, me.detail].filter(x => x && !/^not specified$/i.test(x)).join(" · "))} <span class="na">on the injury report</span></div>`;
    if (ctx.status) return `<div class="mu-inj"><span class="badge q">${esc(ctx.status)}</span></div>`;
    return "";
  }

  // ---------- averages table (season / L5 / L10 / vs opp / home / away)
  function formTable(defs, rows, base, opp) {
    const { esc } = A();
    const l5 = M.lastN(rows, 5), l10 = M.lastN(rows, 10), vs = opp ? M.vsOpp(rows, opp.id) : [];
    const splitRows = base.rows.length >= 6 ? base.rows : M.lastN(rows, 20);
    const body = defs.map(([k, label]) => {
      const s = M.avg(base.rows, k), a5 = M.avg(l5, k), a10 = M.avg(l10, k), av = M.avg(vs, k), ha = M.splitHA(splitRows, k);
      return `<tr><th scope="row">${esc(label)}</th><td class="num">${f1(s)}</td><td class="num">${f1(a5)}${trendIcon(M.trend(a5, s))}</td><td class="num">${f1(a10)}${trendIcon(M.trend(a10, s))}</td>
        ${opp ? `<td class="num">${vs.length ? f1(av) + trendIcon(M.trend(av, s)) : "–"}</td>` : ""}<td class="num">${f1(ha.home)}</td><td class="num">${f1(ha.away)}</td></tr>`;
    }).join("");
    const seasonLbl = base.fallback ? `${base.key} season` : "Season";
    const head = `<tr><th>Avg</th><th title="${esc(seasonLbl)} average (${base.rows.length} games)">${esc(base.fallback ? base.key : "Season")}</th><th>L5</th><th>L10</th>${opp ? `<th title="Average in past meetings">vs ${esc(opp.abbr || "")}</th>` : ""}<th>Home</th><th>Away</th></tr>`;
    const splitNote = base.rows.length >= 6 ? `this season` : `last ${splitRows.length} games`;
    return `<div class="tbl-wrap"><table class="ptbl mu-tbl"><thead>${head}</thead><tbody>${body}</tbody></table></div>
      <div class="note">${esc(seasonLbl)}: ${base.rows.length} game${base.rows.length === 1 ? "" : "s"}${base.fallback ? " (no games yet this season)" : ""}. L5/L10 span seasons. ▲/▼: more than 10% above/below the season average. Home/away: ${splitNote}${opp ? `; vs ${esc(opp.abbr || "")}: ${vs.length} meeting${vs.length === 1 ? "" : "s"}` : ""}.</div>`;
  }

  // ---------- past meetings
  function history(ctx, defs, rows, opp, seasons) {
    const { esc, fmt } = A();
    const vs = M.vsOpp(rows, opp.id);
    if (!vs.length) return `<div class="na">No meetings with ${esc(opp.name || opp.abbr)} in ${esc(seasons)}${ctx.rookie ? " (first season)" : ""}.</div>`;
    const body = vs.map(r => `<tr><td>${fmt(r.date, { month: "short", day: "numeric", year: "2-digit" })}${r.post ? ` <span class="badge">Playoffs</span>` : ""}</td><td>${r.home ? "vs" : "@"}</td><td><span class="res ${esc(r.res)}">${esc(r.res)}</span> <span class="num">${esc(r.score)}</span></td>${defs.map(([k]) => `<td class="num">${raw(r.v[k])}</td>`).join("")}</tr>`).join("");
    return `<div class="tbl-wrap"><table class="ptbl mu-tbl"><thead><tr><th>Date</th><th></th><th>Result</th>${defs.map(d => `<th>${esc(d[1])}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  // ---------- opponent defense
  function defense(ctx, mu, opp, bucket) {
    const { esc, notAvail } = A();
    if (!mu) return notAvail("Opponent defense", "Defense-vs-position data isn't built yet. It's computed when the site data refreshes.");
    const d = M.oppDefense(mu, opp.id, bucket);
    if (!d) return notAvail("Opponent defense", `No completed games for ${opp.name || opp.abbr} this season yet.`);
    const row = x => `<tr><th scope="row">${esc(x.label)}</th><td class="num">${f1(x.val)}</td><td class="num">${esc(M.ordinal(x.rank))}<span class="na"> / ${d.n}</span></td><td>${x.tier ? `<span class="mu-tier ${x.tier}">${TIER[x.tier]}</span>` : ""}</td></tr>`;
    const posT = d.pos.length ? `<h4 class="mu-h4">Allowed to ${esc(BUCKET_NAME[d.bucket] || d.bucket)} per game</h4><div class="tbl-wrap"><table class="ptbl mu-tbl mu-def"><thead><tr><th>Stat</th><th>Per game</th><th>Rank</th><th></th></tr></thead><tbody>${d.pos.map(row).join("")}</tbody></table></div>` : "";
    const teamT = `<h4 class="mu-h4">Team defense</h4><div class="tbl-wrap"><table class="ptbl mu-tbl mu-def"><thead><tr><th>Stat</th><th>Per game</th><th>Rank</th><th></th></tr></thead><tbody>${d.team.map(row).join("")}</tbody></table></div>`;
    const why = !d.pos.length ? `<div class="na">Position-level splits cover ${ctx.lg === "nfl" ? "QB, RB, WR and TE" : "guards, forwards and centers"}; showing team-level defense instead.</div>` : "";
    return `<div class="card"><h3>${esc(opp.abbr || opp.name)} defense <span class="st-sub">${d.gp} game${d.gp === 1 ? "" : "s"} · ${esc(mu.season ? String(mu.season) : "")}</span></h3>${why}${posT}${teamT}
      <div class="note">Rank 1 = fewest allowed (toughest), ${d.n} = most allowed.${ctx.lg === "nba" ? " Pace: possessions per 48 (rank 1 = slowest); def rating: points allowed per 100 possessions (estimated from box scores)." : ""} ${d.gp < 5 ? "Small sample this early in the season. " : ""}Computed from ESPN box scores of completed ${esc(String(mu.season || ""))} regular-season games.</div></div>`;
  }

  // ---------- hit rate
  function hitHtml(defs, rows, key, lineV) {
    const { esc, fmt } = A();
    const d = defs.find(x => x[0] === key) || defs[0];
    const h = M.hitRate(rows, d[0], lineV, 10);
    if (!h.n) return `<div class="na">No recent games with ${esc(d[1])}.</div>`;
    const max = Math.max(lineV, ...h.games.map(g => g.val)) || 1;
    const bars = [...h.games].reverse().map(g => `<div class="mu-bar ${g.over ? "o" : g.push ? "p" : "u"}" title="${esc(fmt(g.date, { month: "short", day: "numeric" }))} vs ${esc(g.opp)}: ${g.val}"><span style="height:${Math.max(4, Math.round(100 * g.val / max))}%"></span><em class="num">${esc(raw(g.val))}</em></div>`).join("");
    const pct = `<b class="num">${h.over}</b> of last <b class="num">${h.n}</b> (${h.pct}%)`;
    return `<div class="mu-hit-sum">Over ${esc(lineV)} ${esc(d[1].toLowerCase())}: ${pct}${h.push ? ` · ${h.push} exactly on` : ""}</div>
      <div class="mu-bars" style="--ln:${Math.min(1, lineV / max).toFixed(3)}" role="img" aria-label="Last ${h.n} games, oldest to newest">${bars}<i class="mu-ln"></i></div>`;
  }
  function hitCard(defs, rows, base) {
    const { esc } = A();
    const k = defs[0][0], l = M.defaultLine(M.avg(base.rows.length ? base.rows : rows, k));
    return `<div class="card mu-hit"><h3>Hit rate <span class="st-sub">last 10 games</span></h3>
      <div class="mu-ctl"><label><span class="sr-only">Stat</span><select class="mu-sel" aria-label="Stat">${defs.map(d => `<option value="${esc(d[0])}">${esc(d[1])}</option>`).join("")}</select></label>
      <label class="mu-in"><span>Over</span><input class="mu-x" type="number" inputmode="decimal" step="0.5" min="0" value="${l}" aria-label="Threshold"></label></div>
      <div class="mu-hit-out">${hitHtml(defs, rows, k, l)}</div>
      <div class="note">How often past games cleared the number you set. Past results only, not a prediction.</div></div>`;
  }
  function wireHit(root, defs, rows, base) {
    const sel = root.querySelector(".mu-sel"), inp = root.querySelector(".mu-x"), out = root.querySelector(".mu-hit-out");
    if (!sel || !inp || !out) return;
    const draw = () => { const v = parseFloat(inp.value); out.innerHTML = hitHtml(defs, rows, sel.value, isNum(v) ? v : 0); };
    sel.onchange = () => { inp.value = M.defaultLine(M.avg(base.rows.length ? base.rows : rows, sel.value)); draw(); };
    inp.oninput = draw;
  }

  // ---------- player page section
  async function mount(el, ctx) {
    const app = A(), { esc, espn, getJSON, LG } = app;
    if (!el) return;
    const lg = ctx.lg, [path] = LG[lg] || [];
    if (!SUPPORTED.has(lg)) { el.innerHTML = ""; return; }
    el.innerHTML = skel;
    const settle = p => (p ? p.then(v => v, () => null) : Promise.resolve(null));
    const idxGames = (ctx.index && ctx.index.games) || [];
    const ng = M.nextGame(idxGames, ctx.teamId);
    const seasons = M.seasonsOf(ctx.gamelog), cur = M.currentSeason(ctx.gamelog) || seasons[0];
    const prev = seasons.filter(s => s !== cur).slice(0, 2);
    const base = `common/v3/sports/${path}/athletes/${ctx.id}/gamelog`;
    const [p1, p2, mu, det, sch] = await Promise.all([
      prev[0] ? settle(espn(`${base}?season=${prev[0]}`)) : null, prev[1] ? settle(espn(`${base}?season=${prev[1]}`)) : null,
      settle(getJSON(`data/matchups/${lg}.json`)), ng ? settle(getJSON(`data/${lg}/games/${ng.game.id}.json`)) : null,
      !ng && ctx.teamId ? settle(espn(`site/v2/sports/${path}/teams/${ctx.teamId}/schedule`)) : null]);
    if (!ctx.alive()) return;
    let sched = null;
    if (!ng && sch) {
      const ev = (sch.events || []).find(e => { const t = ((e.competitions || [])[0] || {}).status?.type || {}; return !t.completed && t.state !== "post"; });
      const c = ev && (ev.competitions || [])[0], me = c && (c.competitors || []).find(x => String(x.id || x.team?.id) === String(ctx.teamId)), op = c && (c.competitors || []).find(x => x !== me);
      if (me && op) sched = { date: c.date || ev.date, home: me.homeAway === "home", opp: { id: String(op.team?.id || op.id), name: op.team?.displayName || "", abbr: op.team?.abbreviation || "", logo: (op.team?.logos || [])[0]?.href || op.team?.logo || "" } };
    }
    const opp = ng ? ng.opp : sched ? sched.opp : null;
    const rows = M.mergeRows(M.parseLog(ctx.gamelog, cur), M.parseLog(p1, prev[0]), M.parseLog(p2, prev[1]));
    const defs = M.statDefs(lg, ctx.pos, ctx.gamelog || p1, rows);
    const bucket = M.posBucket(lg, ctx.pos);
    const sb = M.seasonRows(rows, cur);
    const seasonsTxt = [cur, ...prev].filter(Boolean).length > 1 ? `the last ${[cur, ...prev].filter(Boolean).length} seasons` : "this season";
    let html = header(ctx, ng, sched, det);
    if (!rows.length || !defs.length) {
      html += `<div class="card"><div class="na">No game-by-game stats from ESPN for ${esc(ctx.name || "this player")} in ${esc(seasonsTxt)}${ctx.rookie ? " (rookie)" : ""}, so there's no form or matchup history to show.</div></div>`;
      if (opp) html += `<div class="mu-cols">${defense(ctx, mu, opp, bucket)}</div>`;
      el.innerHTML = html; return;
    }
    html += `<div class="card"><h3>Form <span class="st-sub">averages per game</span></h3>${formTable(defs, rows, sb, opp)}</div>`;
    html += `<div class="mu-cols">`;
    if (opp) html += `<div class="card"><h3>History vs ${esc(opp.abbr || opp.name)} <span class="st-sub">${esc(seasonsTxt)}</span></h3>${history(ctx, defs, rows, opp, seasonsTxt)}</div>`;
    html += hitCard(defs, rows, sb);
    html += `</div>`;
    if (opp) html += `<div class="mu-cols one">${defense(ctx, mu, opp, bucket)}</div>`;
    html += `<div class="note">Matchup stats: ESPN game logs (${esc([cur, ...prev].filter(Boolean).join(", "))} seasons, regular season and playoffs; preseason excluded), loaded live. Opponent defense: built from ESPN box scores when the site data refreshes${mu && mu.gen ? ` (as of ${esc(app.fullET(mu.gen))})` : ""}.</div>`;
    el.innerHTML = html;
    wireHit(el, defs, rows, sb);
  }

  // ---------- game page: key player matchups
  async function keyMatchups(el, lg, g, det, alive = () => true) {
    const app = A(), { esc, getJSON, crest } = app;
    if (!el || !SUPPORTED.has(lg)) return;
    const settle = p => (p ? p.then(v => v, () => null) : Promise.resolve(null));
    const [mu, si] = await Promise.all([settle(getJSON(`data/matchups/${lg}.json`)), settle(app.sidx(lg))]);
    if (!alive()) return;
    const sides = [g.away, g.home];
    const pick = t => {
      const out = [], seen = new Set();
      for (const l of (det.leaders || []).filter(x => String(x.teamId) === String(t.id))) {
        let id = l.id, pos = l.pos;
        if ((!id || !pos) && si) { const p = (si.byTeam[t.id] || []).find(p => p.name === l.player); if (p) { id = id || p.id; pos = pos || p.pos; } }
        if (!id || seen.has(id) || !M.leaderKey(lg, l.cat, M.posBucket(lg, pos))) continue;
        seen.add(id); out.push({ id, pos: pos || (si && si.byId[id] && si.byId[id].pos) || "", name: l.player, cat: l.cat, value: l.value });
      }
      return out.slice(0, 3);
    };
    const row = (p, t, opp) => {
      const b = M.posBucket(lg, p.pos), lk = M.leaderKey(lg, p.cat, b);
      const d = lk && mu ? M.oppDefense(mu, opp.id, lk[0]) : null, x = d && d.pos.find(s => s.key === lk[1]);
      const vs = x ? `<span class="mu-km-d">${esc(opp.abbr)} allows <b class="num">${f1(x.val)}</b> ${esc(x.label.toLowerCase())} to ${esc(BUCKET_NAME[lk[0]] || lk[0])} · <span class="mu-tier ${x.tier || "mid"}">${esc(M.ordinal(x.rank))}</span></span>` : `<span class="mu-km-d na">${esc(p.cat || "")}</span>`;
      return `<a class="mu-km" href="#/p/${lg}/${esc(p.id)}/m"><span class="mu-km-n"><b>${esc(p.name)}</b> <span class="na">${esc(p.pos)}</span></span><span class="mu-km-go">Matchup ›</span><span class="mu-km-v"><span class="na">${esc(p.cat || "")}:</span> <span class="num">${esc(p.value || "")}</span></span>${vs}</a>`;
    };
    const blocks = sides.map((t, i) => { const opp = sides[1 - i], ps = pick(t); return ps.length ? `<div class="card mu-kmc"><h3>${t.logo ? `<img src="${esc(t.logo)}" alt="" onerror="this.remove()">` : ""}${esc(t.name)}</h3>${ps.map(p => row(p, t, opp)).join("")}</div>` : ""; }).join("");
    el.innerHTML = blocks ? `<div class="section-title">Key player matchups</div><div class="cols">${blocks}</div><div class="note">Season leaders vs the opponent's defense against their position (rank 1 = fewest allowed). Tap a player for form, history vs this opponent and hit rates.</div>` : "";
  }

  window.LSMatchup = { mount, keyMatchups, SUPPORTED };
})();
