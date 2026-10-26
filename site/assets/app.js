/* LineSmart front-end: hash-routed static SPA reading ./data/*.json (built by scripts/build_data.py) */
(() => {
  const CFG = window.SITE_CONFIG || { name: "LineSmart", timeZone: "America/New_York", tzLabel: "ET" };
  const TZ = CFG.timeZone, TZL = CFG.tzLabel || "ET";
  const app = document.getElementById("app");
  const cache = {};
  let META = null;

  document.title = CFG.name;
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
    if (cache[url]) return cache[url];
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) throw new Error(url + " " + r.status);
    if (r.headers.get("X-LineSmart-Offline")) showOffline();
    return (cache[url] = await r.json());
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
  const unitWord = kind => ({ football: "Pts", basketball: "Pts", hockey: "Goals", soccer: "Goals", baseball: "Runs" }[kind] || "Pts");
  const formDots = f => (f ? `<span class="form" title="Last ${f.length}: ${esc(f)} (most recent first)">${[...f].map(c => `<i class="f-${c}"></i>`).join("")}</span>` : "");
  const rec = (a, kind) => (!a ? null : kind === "soccer" ? `${a.w}-${a.d}-${a.l}` : a.d ? `${a.w}-${a.l}-${a.d}` : `${a.w}-${a.l}`);
  const logo = (t, cls = "") => (t && t.logo ? `<img class="${cls}" src="${esc(t.logo)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : `<span class="${cls}"></span>`);

  // ---------- nav
  function renderTabs(active) {
    const tabs = document.getElementById("leagueTabs");
    tabs.innerHTML = META.order.map(k => {
      const L = META.leagues[k] || {};
      const off = !L.games;
      return `<a class="tab ${k === active ? "active" : ""} ${off ? "off" : ""}" href="#/l/${k}" title="${esc(L.full || "")}">${esc(L.name || k.toUpperCase())}<span class="cnt">${L.upcoming ?? 0}</span></a>`;
    }).join("");
    const a = tabs.querySelector(".active");
    if (a) a.scrollIntoView({ block: "nearest", inline: "center" });
  }

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
    return `<div class="trow ${lose ? "lose" : ""}">${logo(t, "tl")}<div class="tn"><div class="tname">${t.rank ? `<span class="rk">#${t.rank}</span>` : ""}<span class="nm-l">${esc(t.name)}</span><span class="nm-s">${esc(t.short || t.name)}</span></div>
      <div class="tmeta">${esc(t.record || "—")}${formDots(t.form)}</div></div>
      <div class="tscore">${showScore ? esc(t.score) : ""}</div>${chips}</div>`;
  }

  function gameTile(g, key, kind) {
    const o = g.odds, soccer = kind === "soccer";
    const cols = !o ? [] : soccer ? ["1X2", "Total"] : [spreadLabelOf(kind), "Money", "Total"];
    const head = cols.length ? `<div class="gt-head"><span></span><span></span><span></span>${cols.map(c => `<span>${esc(c)}</span>`).join("")}</div>` : "";
    const draw = soccer && o ? `<div class="trow draw"><span class="tl"></span><div class="tn"><div class="tname">Draw</div></div><div class="tscore"></div>${chip(am(o.drawML))}<span></span></div>` : "";
    const hr = (g.books || {}).hardrockbet, hrLive = hr && !hr.stale && hr.asOf;
    const mv = moveOf(g), hasMv = mv && (mv.spread || mv.total);
    const foot = o ? `<div class="tfoot"><span class="bk">${esc(o.provider || "provider n/a")}</span>${hrLive ? '<span class="bk hr">Hard Rock Bet</span>' : ""}<span class="hint">${hasMv ? "▲▼ move since open" : soccer ? "3-way moneyline" : ""}</span></div>`
                   : `<div class="noline">Lines not posted yet</div>`;
    const net = esc([g.note, (g.broadcasts || []).slice(0, 2).join(", ")].filter(Boolean).join(" · "));
    return `<a class="game c${cols.length}" href="#/g/${key}/${g.id}" aria-label="${esc(g.away.name)} at ${esc(g.home.name)}">
      <div class="game-top">${statusHtml(g)}${g.state === "pre" ? notableBadge(g) : ""}<span class="net">${net}</span></div>
      ${head}${teamRow(g.away, g, "away", kind)}${draw}${teamRow(g.home, g, "home", kind)}${foot}</a>`;
  }

  // ---------- skeleton loaders (shown while JSON loads)
  const skTile = `<div class="skel-tile"><span class="sk" style="width:40%;height:12px"></span>${'<div class="r"><span class="sk"></span><span class="sk"></span><span class="sk c"></span><span class="sk c"></span><span class="sk c"></span></div>'.repeat(2)}</div>`;
  const skelLeague = () => `<div class="loading" aria-busy="true"><span class="sr-only">Loading games…</span><div class="skel-head"><span class="sk"></span><span class="sk"></span></div><div class="grid">${skTile.repeat(6)}</div></div>`;
  const skelGame = () => `<div class="loading" aria-busy="true"><span class="sr-only">Loading matchup…</span><span class="sk skel-hero"></span><div class="skel-cols"><span class="sk"></span><span class="sk"></span></div></div>`;
  const showSkel = html => { if (!app.querySelector(".loading")) app.innerHTML = html; };
  const teamColor = (t, fb) => (/^[0-9a-f]{6}$/i.test(t.color || "") ? "#" + t.color : fb);

  // ---------- league view
  async function viewLeague(key) {
    renderTabs(key);
    const L = META.leagues[key];
    if (!cache[`data/${key}/index.json`]) showSkel(skelLeague());
    if (!L) return (app.innerHTML = `<div class="empty"><h3>Unknown league</h3></div>`);
    let data;
    try { data = await getJSON(`data/${key}/index.json`); }
    catch (e) { return (app.innerHTML = `<div class="page-head"><h1>${esc(L.full)}</h1></div><div class="empty"><h3>No data file for ${esc(L.name)}</h3>Run <code>python3 scripts/build_data.py</code> to refresh.${L.error ? "<br>" + esc(L.error) : ""}</div>`); }
    const kind = data.league.kind;
    const filter = sessionStorage.getItem("filter-" + key) || "upcoming";
    let games = data.games;
    if (filter === "upcoming") games = games.filter(g => g.state !== "post");
    const days = {};
    games.forEach(g => (days[dayKey(g.date)] ||= []).push(g));
    const chips = `<div class="chips">
      <span class="chip"><b>${data.report.upcoming}</b> upcoming</span>
      <span class="chip"><b>${data.report.withOdds}</b> with lines</span>
      <span class="chip">Lines: <b>${esc((data.report.providers || []).join(", ") || "none")}</b></span>
      <span class="chip">Next ${data.windowDays} days</span></div>`;
    let html = `<div class="page-head"><div><h1>${esc(data.league.full)}</h1><div class="sub">Upcoming games, lines and form · times in ${TZL}</div></div>
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
    app.querySelectorAll(".seg button").forEach(b => (b.onclick = () => { sessionStorage.setItem("filter-" + key, b.dataset.f); viewLeague(key); }));
    wireSort(app.querySelector("#teamTbl"));
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
      <div class="note">Computed from each team's completed games this season (ESPN team schedules${rows[0].t.seasonType ? ", " + esc(rows[0].t.seasonType) : ""}). Teams with no completed games show N/A. ATS records are not provided by ESPN's free feeds.</div>`;
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
    const g = d.game, det = d.detail || {}, kind = idx.league.kind, u = unitWord(kind);
    const H = g.home, A = g.away, tH = d.teams[H.id] || {}, tA = d.teams[A.id] || {};
    const mid = g.state === "pre"
      ? `<div class="vs">${g.neutral ? "VS" : "AT"}</div><div class="when">${fullET(g.date)}</div>`
      : `<div class="score">${esc(A.score)} – ${esc(H.score)}</div><div class="when">${esc(g.statusDetail || "")}</div>`;
    let html = `<a class="back" href="#/l/${key}">← ${esc(idx.league.full)}</a>
      <div class="match" style="--ca:${teamColor(A, "#334155")};--ch:${teamColor(H, "#475569")}">
        <div class="mteam">${logo(A)}<div><div class="nm">${A.rank ? `<span class="rk" style="color:var(--warn)">#${A.rank} </span>` : ""}<a class="tlink" href="#/t/${key}/${A.id}">${esc(A.name)}</a></div><div class="rec">${esc(A.record || "—")} · Away ${esc(A.awayRecord || "—")}${formDots(A.form)}</div></div></div>
        <div class="mmid">${mid}<div class="where">${esc([g.venue, g.city].filter(Boolean).join(", "))}${g.neutral ? " (neutral)" : ""}</div><div class="where">${esc(g.broadcasts.join(", "))}</div>${g.note ? `<div class="where">${esc(g.note)}</div>` : ""}</div>
        <div class="mteam home">${logo(H)}<div><div class="nm">${H.rank ? `<span class="rk" style="color:var(--warn)">#${H.rank} </span>` : ""}<a class="tlink" href="#/t/${key}/${H.id}">${esc(H.name)}</a></div><div class="rec">${esc(H.record || "—")} · Home ${esc(H.homeRecord || "—")}${formDots(H.form)}</div></div></div>
      </div>`;

    html += `<div class="section-title">Betting lines</div><div class="cols">${linesCard(g, kind)}${booksCard(g, kind)}</div>`;
    if (window.LSBets) html += window.LSBets.trackCard(key, g, kind);
    const lm = lineMoveSection(d, g, kind);
    html += lm.html;

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
      <div class="note">Splits computed from completed ${esc(tH.seasonType || tA.seasonType || "season")} games via ESPN team schedules. ${atsA.length || atsH.length ? "" : "ATS: not available from ESPN's free feeds for this matchup."}</div></div>`;

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
    }
    if ((det.seasonSeries || []).length) {
      html += `<div class="section-title">Season series</div><div class="card">${det.seasonSeries.map(s => `<div><b>${esc(s.title || "")}</b> ${esc(s.summary || "")}<div class="note">${(s.events || []).map(e => `${e.date ? fmt(e.date, { month: "short", day: "numeric", year: "numeric" }) : ""}: ${esc(e.score)}`).join(" · ")}</div></div>`).join("")}</div>`;
    }
    if (!d.hasSummary) html += `<div class="note">Detailed matchup data (ESPN game summary) wasn't fetched for this game.</div>`;
    app.innerHTML = html;
    lm.wire();
    window.scrollTo(0, 0);
  }

  // ---------- line movement (game detail)
  const BOOKNAME = k => ({ draftkings: "DraftKings", fanduel: "FanDuel", hardrockbet: "Hard Rock Bet" }[k] || k.replace(/^espn-/, "ESPN · "));
  const shortET = d => fmt(d.toISOString(), { weekday: "short", hour: "numeric", minute: "2-digit" });
  function lineMoveSection(d, g, kind) {
    const H = d.history, o = g.odds;
    const none = { html: "", wire: () => {} };
    if (!o && !H) return none;
    // Build per-book data: change points + ESPN open
    let books = H && H.books ? Object.keys(H.books) : [];
    const order = ["draftkings", "hardrockbet", "fanduel"];
    books.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
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
      total: { label: "Total", series: [{ key: "tot", name: "Total (O/U)", color: "var(--chart-2)" }], f: v => String(v) },
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
        <div class="note">${since}. Open = opening line as reported by ESPN (<span class="na">*</span> = ESPN open not available, first recorded value used). Lines are snapshotted about every 30 min (Hard Rock Bet: every other day); points mark recorded changes. Times in ${TZL}.</div>`;
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
    if (o.homeSpread !== null || o.awaySpread !== null)
      body += r(spreadLabel, `${line(o.awaySpread) ?? NA} <span class="na">${am(o.awaySpreadOdds) ?? ""}</span>${mv(o.awaySpread, o.awaySpreadOpen, true)}`, `${line(o.homeSpread) ?? NA} <span class="na">${am(o.homeSpreadOdds) ?? ""}</span>${mv(o.homeSpread, o.homeSpreadOpen, true)}`);
    body += r(kind === "soccer" ? "Moneyline (3-way)" : "Moneyline", `${am(o.awayML) ?? NA}${mv(o.awayML, o.awayMLOpen, false)}`, `${am(o.homeML) ?? NA}${mv(o.homeML, o.homeMLOpen, false)}`);
    if (kind === "soccer") body += `<tr><td>Draw</td><td class="num" colspan="2" style="text-align:center">${am(o.drawML) ?? NA}${mv(o.drawML, o.drawMLOpen, false)}</td></tr>`;
    body += `<tr><td>Total</td><td class="num">O ${fx(o.total) ?? NA} <span class="na">${am(o.overOdds) ?? ""}</span></td><td class="num">U ${fx(o.total) ?? NA} <span class="na">${am(o.underOdds) ?? ""}</span>${isNum(o.totalOpen) && o.totalOpen !== o.total ? `<div class="move">open ${o.totalOpen} → ${o.total}</div>` : ""}</td></tr>`;
    return `<div class="card"><h3>Current line · ${esc(o.provider || "provider n/a")}</h3>
      <table class="books"><thead><tr><th>Market</th><th>${esc(g.away.abbr)}</th><th>${esc(g.home.abbr)}</th></tr></thead><tbody>${body}</tbody></table>
      <div class="note">Source: ${esc(g.oddsSource || "ESPN")} — as reported by ${esc(o.provider || "the listed book")}. "open" = opening line (line movement).</div></div>`;
  }

  function booksCard(g, kind) {
    const books = (META.targetBooks || [{ key: "draftkings", name: "DraftKings" }, { key: "hardrockbet", name: "Hard Rock Bet" }]).filter(bk => bk.key !== "fanduel");
    const HR = META.hardrock || {};
    const B = Object.fromEntries(Object.entries(g.books || {}).filter(([, b]) => b && !b.stale));   // stale = game started since the pull
    const staleB = g.books || {};
    const markets = [];
    const sp = s => b => (isNum(b?.[s + "Spread"]) ? { disp: `${line(b[s + "Spread"])} <span class="na">${am(b[s + "SpreadOdds"]) ?? ""}</span>`, score: b[s + "Spread"] * 1000 + (b[s + "SpreadOdds"] ?? -110) } : null);
    const ml = s => b => (isNum(b?.[s + "ML"]) ? { disp: am(b[s + "ML"]), score: b[s + "ML"] } : null);
    const ov = b => (isNum(b?.total) ? { disp: `O ${b.total} <span class="na">${am(b.overOdds) ?? ""}</span>`, score: -b.total * 1000 + (b.overOdds ?? -110) } : null);
    const un = b => (isNum(b?.total) ? { disp: `U ${b.total} <span class="na">${am(b.underOdds) ?? ""}</span>`, score: b.total * 1000 + (b.underOdds ?? -110) } : null);
    if (kind !== "soccer") { markets.push([`${g.away.abbr} spread`, sp("away")], [`${g.home.abbr} spread`, sp("home")]); }
    markets.push([`${g.away.abbr} ML`, ml("away")]);
    if (kind === "soccer") markets.push(["Draw", ml("draw")]);
    markets.push([`${g.home.abbr} ML`, ml("home")], ["Over", ov], ["Under", un]);
    const rows = markets.map(([label, fn]) => {
      const vals = books.map(bk => fn(B[bk.key]));
      const have = vals.filter(Boolean);
      const best = have.length > 1 ? Math.max(...have.map(v => v.score)) : null;
      return `<tr><td>${esc(label)}</td>${vals.map(v => (v ? `<td class="num ${best !== null && v.score === best ? "best" : ""}"><span class="px">${v.disp}</span></td>` : `<td>${NA}</td>`)).join("")}</tr>`;
    }).join("");
    const sub = bk => {
      const b = B[bk.key], sb = staleB[bk.key];
      if (b && b.asOf) return `as of ${esc(fullET(b.asOf))}`;
      if (b) return esc(b.source || "");
      if (sb && sb.stale) return `closed · game started`;
      if (bk.key === "hardrockbet") return HR.asOf ? "not posted at last pull" : "no pull yet";
      return "no data";
    };
    const head = books.map(bk => `<th>${esc(bk.name)}<span class="src">${sub(bk)}</span></th>`).join("");
    const nHave = books.filter(bk => B[bk.key]).length;
    const hrNote = HR.asOf ? `Hard Rock Bet via The Odds API, pulled every other day (free plan); last pull ${esc(fullET(HR.asOf))}. Pre-game lines only: they're hidden once a game starts.`
                           : "Hard Rock Bet via The Odds API, pulled every other day (free plan); no pull yet.";
    return `<div class="card"><h3>Odds comparison</h3><div class="tbl-wrap"><table class="books"><thead><tr><th>Market</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>
      <div class="note">${nHave > 1 ? "Best available price highlighted in green. " : ""}DraftKings via ESPN (refreshed about every 30 min, when ESPN's listed book is DraftKings). ${hrNote} FanDuel: not tracked (free plan).</div></div>`;
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
  };
  const PRO = new Set(["nfl", "nba", "nhl", "mlb", "epl", "mls", "ucl"]);
  const lgName = lg => (META.leagues[lg] || {}).name || lg.toUpperCase();
  let NAV = 0; // bumps on every route; async views bail out if the user has moved on
  const espnCache = {};
  async function espn(path, ms = 12000) {
    const url = "https://site.web.api.espn.com/apis/" + path;
    if (espnCache[url]) return espnCache[url];
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      if (!r.ok) throw new Error(url + " " + r.status);
      if (r.headers.get("X-LineSmart-Offline")) showOffline();
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
      d.teams.forEach(t => list.push({ k: "t", lg, lgs: [lg], o: t, name: t.name, x: norm(t.name), w: words(`${t.name} ${t.short} ${t.abbr}`), ab: norm(t.abbr), sh: norm(t.short), b: b + 12 }));
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
  async function viewPlayer(lg, id) {
    const tok = NAV; renderTabs(lg); window.scrollTo(0, 0);
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
  }

  // ---------- router
  async function route() {
    if (!META) {
      try { META = await getJSON("data/meta.json"); }
      catch (e) { app.innerHTML = `<div class="empty"><h3>No data yet</h3>Run <code>python3 scripts/build_data.py</code> then reload.</div>`; return; }
      const gen = META.generated ? new Date(META.generated) : null;
      if (gen) { const iso = gen.toISOString(); const u = document.getElementById("updated"); u.title = "Data updated " + fullET(iso); u.innerHTML = `<span class="dot"></span><span><span class="u-long">Updated ${esc(fmt(iso, { weekday: "short", month: "short", day: "numeric" }))}, </span>${esc(timeET(iso))}</span>`; }
    }
    const h = location.hash.replace(/^#\/?/, "").split("/");
    NAV++;
    const sb = document.getElementById("searchBtn"); if (sb) sb.classList.toggle("on", h[0] === "search");
    const bb = document.getElementById("betsBtn"); if (bb) bb.classList.toggle("on", h[0] === "bets");
    if (h[0] === "bets") return window.LSBets ? window.LSBets.view() : (app.innerHTML = `<div class="empty"><h3>My Bets didn't load</h3>Reload the page to try again.</div>`);
    if (h[0] === "search") return viewSearch(decodeURIComponent(h.slice(1).join("/") || ""));
    if (h[0] === "t" && h[1] && h[2]) return viewTeam(h[1], h[2]);
    if (h[0] === "p" && h[1] && h[2]) return viewPlayer(h[1], h[2]);
    if (h[0] === "g" && h[1] && h[2]) return viewGame(h[1], h[2]);
    if (h[0] === "l" && h[1]) return viewLeague(h[1]);
    const def = (META.leagues[CFG.defaultLeague]?.upcoming ? CFG.defaultLeague : META.order.find(k => META.leagues[k]?.upcoming)) || META.order[0];
    return viewLeague(def);
  }
  window.addEventListener("hashchange", route);
  // helpers shared with the My Bets tracker (assets/bets.js)
  window.LSApp = { esc, fmt, timeET, fullET, getJSON, LG, renderTabs, lgName, meta: () => META, nav: () => NAV };
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
  window.addEventListener("online", () => { const el = document.getElementById("offlineNote"); if (el && !el.hidden) location.reload(); });
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js", { scope: "./" }).catch(e => console.warn("SW registration failed", e)));
  }
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
