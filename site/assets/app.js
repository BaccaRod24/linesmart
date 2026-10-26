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

  function oddsBar(g, kind) {
    const o = g.odds;
    if (!o) return `<div class="prov">Lines not posted yet</div>`;
    const sp = (v, p) => (v === null ? NA : `${line(v)}${p !== null && p !== undefined ? ` <span class="na">(${am(p)})</span>` : ""}`);
    if (kind === "soccer") {
      return `<div class="oddsbar soccer">
        <div class="ocell"><div class="k">${esc(g.away.abbr)}</div><div class="v">${am(o.awayML) ?? NA}</div></div>
        <div class="ocell"><div class="k">Draw</div><div class="v">${am(o.drawML) ?? NA}</div></div>
        <div class="ocell"><div class="k">${esc(g.home.abbr)}</div><div class="v">${am(o.homeML) ?? NA}</div></div>
        <div class="ocell"><div class="k">O/U</div><div class="v">${fx(o.total, 1) ?? NA}${totalArrow(g)}</div></div>
      </div><div class="prov">3-way moneyline · ${esc(o.provider || "provider n/a")}</div>`;
    }
    const spreadLabel = kind === "hockey" ? "Puck line" : kind === "baseball" ? "Run line" : "Spread";
    return `<div class="oddsbar">
      <div class="ocell"><div class="k">${spreadLabel}</div><div class="v"><span>${esc(g.away.abbr)} ${o.awaySpread !== null ? line(o.awaySpread) : NA}${spreadArrow(g, "away")}</span><span>${esc(g.home.abbr)} ${o.homeSpread !== null ? line(o.homeSpread) : NA}${spreadArrow(g, "home")}</span></div></div>
      <div class="ocell"><div class="k">Moneyline</div><div class="v"><span>${am(o.awayML) ?? NA}</span><span>${am(o.homeML) ?? NA}</span></div></div>
      <div class="ocell"><div class="k">Total</div><div class="v"><span>O ${fx(o.total, 1) ?? NA}${totalArrow(g)}</span><span>U ${fx(o.total, 1) ?? NA}</span></div></div>
    </div><div class="prov">${moveOf(g)?.spread || moveOf(g)?.total ? '<span class="na">▲▼ = move since open · </span>' : ""}${esc(o.provider || "provider n/a")}</div>`;
  }

  function statusHtml(g) {
    if (g.state === "in") return `<span class="status live">● LIVE · ${esc(g.statusDetail || "")}</span>`;
    if (g.state === "post") return `<span class="status final">${esc(g.statusDetail || "Final")}</span>`;
    return `<span class="status">${timeET(g.date)}</span>`;
  }

  function teamRow(t, g, showScore) {
    return `<div class="trow">${logo(t)}<div><div class="tname">${t.rank ? `<span class="rk">#${t.rank}</span>` : ""}${esc(t.name)}</div>
      <div class="tmeta">${esc(t.record || "—")}${formDots(t.form)}</div></div>
      <div class="tscore">${showScore && t.score != null ? esc(t.score) : ""}</div></div>`;
  }

  // ---------- league view
  async function viewLeague(key) {
    renderTabs(key);
    const L = META.leagues[key];
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
        html += `<div class="day">${dayLabel(days[k][0].date)}</div><div class="grid">` +
          days[k].map(g => `<a class="game" href="#/g/${key}/${g.id}">
            <div class="game-top">${statusHtml(g)}${g.state === "pre" ? notableBadge(g) : ""}<span class="net">${esc([g.note, g.broadcasts.slice(0, 2).join(", ")].filter(Boolean).join(" · "))}</span></div>
            ${teamRow(g.away, g, g.state !== "pre")}${teamRow(g.home, g, g.state !== "pre")}
            ${oddsBar(g, kind)}</a>`).join("") + `</div>`;
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
      </tr></thead><tbody>${rows.map(({ t, b }) => {
        const a = t.all, d = diff(a);
        return `<tr><td data-v="${esc(b.name)}">${logo(b, "tlogo")}${esc(b.name || "")}</td>
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
    let d, idx;
    try { [d, idx] = await Promise.all([getJSON(`data/${key}/games/${id}.json`), getJSON(`data/${key}/index.json`)]); }
    catch (e) { return (app.innerHTML = `<a class="back" href="#/l/${key}">← Back</a><div class="empty"><h3>Game not found</h3>It may have dropped out of the data window. Refresh the data.</div>`); }
    const g = d.game, det = d.detail || {}, kind = idx.league.kind, u = unitWord(kind);
    const H = g.home, A = g.away, tH = d.teams[H.id] || {}, tA = d.teams[A.id] || {};
    const mid = g.state === "pre"
      ? `<div class="vs">AT</div><div class="when">${fullET(g.date)}</div>`
      : `<div class="score">${esc(A.score)} – ${esc(H.score)}</div><div class="when">${esc(g.statusDetail || "")}</div>`;
    let html = `<a class="back" href="#/l/${key}">← ${esc(idx.league.full)}</a>
      <div class="match">
        <div class="mteam">${logo(A)}<div><div class="nm">${A.rank ? `<span class="rk" style="color:var(--warn)">#${A.rank} </span>` : ""}${esc(A.name)}</div><div class="rec">${esc(A.record || "—")} · Away ${esc(A.awayRecord || "—")}${formDots(A.form)}</div></div></div>
        <div class="mmid">${mid}<div class="where">${esc([g.venue, g.city].filter(Boolean).join(", "))}${g.neutral ? " (neutral)" : ""}</div><div class="where">${esc(g.broadcasts.join(", "))}</div>${g.note ? `<div class="where">${esc(g.note)}</div>` : ""}</div>
        <div class="mteam home">${logo(H)}<div><div class="nm">${H.rank ? `<span class="rk" style="color:var(--warn)">#${H.rank} </span>` : ""}${esc(H.name)}</div><div class="rec">${esc(H.record || "—")} · Home ${esc(H.homeRecord || "—")}${formDots(H.form)}</div></div></div>
      </div>`;

    html += `<div class="section-title">Betting lines</div><div class="cols">${linesCard(g, kind)}${booksCard(g, kind)}</div>`;
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
      spread: { label: spreadLabel, series: [{ key: "hs", name: `${g.home.abbr} ${spreadLabel.toLowerCase()}`, color: "#22d3a6" }], f: line },
      total: { label: "Total", series: [{ key: "tot", name: "Total (O/U)", color: "#38bdf8" }], f: v => String(v) },
      ml: { label: "Moneyline", series: [{ key: "aml", name: `${g.away.abbr} ML`, color: "#fbbf24" }, { key: "hml", name: `${g.home.abbr} ML`, color: "#22d3a6" }].concat(kind === "soccer" ? [{ key: "dml", name: "Draw", color: "#a3a3a3" }] : []), f: am },
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
        if (isNum(op[s.key])) { const y = Y(op[s.key]); svg += `<line x1="${L}" x2="${w - R}" y1="${y}" y2="${y}" stroke="${s.color}" class="openl"/><text x="${w - R - 2}" y="${y - 5}" class="ax" fill="${s.color}" text-anchor="end">open ${esc(M.f(op[s.key]))}</text>`; }
        if (!ser.length) return;
        let dpath = `M${X(+ser[0].t)},${Y(ser[0].v[s.key])}`;
        ser.forEach((p, i) => { if (i) dpath += `H${X(+p.t)}V${Y(p.v[s.key])}`; });
        dpath += `H${X(+end)}`;
        svg += `<path d="${dpath}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round"/>`;
        ser.forEach(p => (svg += `<circle cx="${X(+p.t)}" cy="${Y(p.v[s.key])}" r="3.5" fill="${s.color}"><title>${esc(fullET(p.t.toISOString()))}: ${esc(s.name)} ${esc(M.f(p.v[s.key]))}</title></circle>`));
        const last = ser[ser.length - 1];
        svg += `<circle cx="${X(+end)}" cy="${Y(last.v[s.key])}" r="4.5" fill="#0b0f17" stroke="${s.color}" stroke-width="2"><title>Current (checked ${esc(fullET(end.toISOString()))}): ${esc(M.f(last.v[s.key]))}</title></circle>`;
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
      return `<tr><td>${esc(label)}</td>${vals.map(v => (v ? `<td class="num ${best !== null && v.score === best ? "best" : ""}">${v.disp}</td>` : `<td>${NA}</td>`)).join("")}</tr>`;
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

  // ---------- router
  async function route() {
    if (!META) {
      try { META = await getJSON("data/meta.json"); }
      catch (e) { app.innerHTML = `<div class="empty"><h3>No data yet</h3>Run <code>python3 scripts/build_data.py</code> then reload.</div>`; return; }
      const gen = META.generated ? new Date(META.generated) : null;
      if (gen) document.getElementById("updated").textContent = "Data updated " + fullET(gen.toISOString());
    }
    const h = location.hash.replace(/^#\/?/, "").split("/");
    if (h[0] === "g" && h[1] && h[2]) return viewGame(h[1], h[2]);
    if (h[0] === "l" && h[1]) return viewLeague(h[1]);
    const def = (META.leagues[CFG.defaultLeague]?.upcoming ? CFG.defaultLeague : META.order.find(k => META.leagues[k]?.upcoming)) || META.order[0];
    return viewLeague(def);
  }
  window.addEventListener("hashchange", route);
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
