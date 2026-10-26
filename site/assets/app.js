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
  function oddsBar(g, kind) {
    const o = g.odds;
    if (!o) return `<div class="prov">Lines not posted yet</div>`;
    const sp = (v, p) => (v === null ? NA : `${line(v)}${p !== null && p !== undefined ? ` <span class="na">(${am(p)})</span>` : ""}`);
    if (kind === "soccer") {
      return `<div class="oddsbar soccer">
        <div class="ocell"><div class="k">${esc(g.away.abbr)}</div><div class="v">${am(o.awayML) ?? NA}</div></div>
        <div class="ocell"><div class="k">Draw</div><div class="v">${am(o.drawML) ?? NA}</div></div>
        <div class="ocell"><div class="k">${esc(g.home.abbr)}</div><div class="v">${am(o.homeML) ?? NA}</div></div>
        <div class="ocell"><div class="k">O/U</div><div class="v">${fx(o.total, 1) ?? NA}</div></div>
      </div><div class="prov">3-way moneyline · ${esc(o.provider || "provider n/a")}</div>`;
    }
    const spreadLabel = kind === "hockey" ? "Puck line" : kind === "baseball" ? "Run line" : "Spread";
    return `<div class="oddsbar">
      <div class="ocell"><div class="k">${spreadLabel}</div><div class="v"><span>${esc(g.away.abbr)} ${o.awaySpread !== null ? line(o.awaySpread) : NA}</span><span>${esc(g.home.abbr)} ${o.homeSpread !== null ? line(o.homeSpread) : NA}</span></div></div>
      <div class="ocell"><div class="k">Moneyline</div><div class="v"><span>${am(o.awayML) ?? NA}</span><span>${am(o.homeML) ?? NA}</span></div></div>
      <div class="ocell"><div class="k">Total</div><div class="v"><span>O ${fx(o.total, 1) ?? NA}</span><span>U ${fx(o.total, 1) ?? NA}</span></div></div>
    </div><div class="prov">${esc(o.provider || "provider n/a")}</div>`;
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
            <div class="game-top">${statusHtml(g)}<span class="net">${esc([g.note, g.broadcasts.slice(0, 2).join(", ")].filter(Boolean).join(" · "))}</span></div>
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
    window.scrollTo(0, 0);
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
    const books = (META.targetBooks || [{ key: "draftkings", name: "DraftKings" }, { key: "fanduel", name: "FanDuel" }, { key: "hardrockbet", name: "Hard Rock Bet" }]);
    const B = g.books || {};
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
    const head = books.map(bk => `<th>${esc(bk.name)}<span class="src">${B[bk.key] ? esc(B[bk.key].source || "") : "no data"}</span></th>`).join("");
    const nHave = books.filter(bk => B[bk.key]).length;
    return `<div class="card"><h3>Odds comparison</h3><div class="tbl-wrap"><table class="books"><thead><tr><th>Market</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>
      <div class="note">${nHave > 1 ? "Best available price highlighted in green. " : ""}${META.oddsApiEnabled ? "Multi-book odds from The Odds API." : "N/A = no free source for that book. ESPN only reports one sportsbook per game; set <code>ODDS_API_KEY</code> (The Odds API) in the data-refresh script to fill in DraftKings, FanDuel and Hard Rock Bet."}</div></div>`;
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
})();
