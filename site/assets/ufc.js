/* LineSmart UFC views: fight cards (events -> main card / prelims -> bouts), the fight page and the fighter page.
   Data: data/ufc/index.json + games/{boutId}.json + fighters.json (scripts/ufc.py, ESPN MMA feeds; DraftKings lines via ESPN).
   Each bout is a "game" (away = red corner / order 1, home = blue corner / order 2), so lines, line movement and My Bets reuse app.js. */
(() => {
  const A = () => window.LSApp;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const isNum = v => v !== null && v !== undefined && v !== "" && !isNaN(v);
  const am = v => (isNum(v) ? (v > 0 ? "+" + v : String(v)) : null);
  const NA = '<span class="na">N/A</span>';
  const app = () => document.getElementById("app");
  const flag = (f, cls = "uf-flag") => (f && f.logo ? `<img class="${cls}" src="${esc(f.logo)}" alt="${esc(f.country || "")}" title="${esc(f.country || "")}" loading="lazy" onerror="this.style.visibility='hidden'">` : `<span class="${cls}"></span>`);
  const dots = f => (f ? `<span class="form" title="Last ${f.length}: ${esc(f)} (most recent first)">${[...f].map(c => `<i class="f-${c === "W" ? "W" : c === "L" ? "L" : "D"}"></i>`).join("")}</span>` : "");
  const chip = (main, sub) => (main == null ? `<span class="oc na-oc" aria-label="not available">—</span>` : `<span class="oc"><b>${main}</b>${sub ? `<small>${sub}</small>` : ""}</span>`);
  const rnd = (r, c) => (r ? `R${r}${c ? " " + c : ""}` : "");
  const RES = { W: "Win", L: "Loss", D: "Draw", NC: "No contest" };

  // pure helpers (exported for tests)
  function resultLine(g) {
    const r = g.result || {};
    if (!r || g.state !== "post") return "";
    if (r.outcome === "draw") return ["Draw", r.method, rnd(r.round, r.clock)].filter(Boolean).join(" · ");
    if (r.outcome === "nc") return ["No contest", r.detail || r.method].filter(Boolean).join(" · ");
    const w = r.winner ? g[r.winner] : null;
    return [w ? `${w.short || w.name} wins` : "Final", r.method, r.detail && r.detail !== r.method ? r.detail : "", rnd(r.round, r.clock)].filter(Boolean).join(" · ");
  }
  // last-N W/L strip in the props strip style (green = win, red = loss, grey = draw / NC)
  function strip(hist, n = 5) {
    return (hist || []).slice(0, n).map(h => {
      const cls = h.res === "W" ? "pp-o" : h.res === "L" ? "pp-u" : "pp-p";
      const tip = `${RES[h.res] || h.res} vs ${h.opp || "?"}${h.method ? " · " + h.method : ""}${h.round ? " · " + rnd(h.round, h.clock) : ""}${h.date ? " · " + h.date.slice(0, 10) : ""}`;
      return { cls, res: h.res, tip, opp: (h.opp || "").split(" ").slice(-1)[0] };
    });
  }
  const stripHtml = (hist, n = 5) => {
    const s = strip(hist, n);
    return s.length ? `<div class="pp-strip uf-strip" role="list" aria-label="Last ${n} fights">${s.map(b => `<span role="listitem" class="pp-b ${b.cls}" title="${esc(b.tip)}" aria-label="${esc(b.tip)}"><b>${esc(b.res)}</b><i>${esc(b.opp)}</i></span>`).join("")}</div>`
                    : `<span class="pp-none">No recent UFC fights on file</span>`;
  };
  const tally = hist => { const t = { W: 0, L: 0, D: 0 }; (hist || []).slice(0, 5).forEach(h => (t[h.res === "W" ? "W" : h.res === "L" ? "L" : "D"]++)); return t; };

  // ---------- league view
  function fighterRow(g, side) {
    const t = g[side], o = g.odds, r = g.result || {};
    const won = g.state === "post" && r.winner === side, lost = g.state === "post" && r.winner && r.winner !== side;
    let chips = "";
    if (o) chips = chip(am(o[side + "ML"])) + (side === "away" ? chip(isNum(o.total) ? "O " + o.total : null, am(o.overOdds)) : chip(isNum(o.total) ? "U " + o.total : null, am(o.underOdds)));
    return `<div class="trow ${lost ? "lose" : ""}">${flag(t, "tl uf-flag")}<div class="tn"><div class="tname"><span class="nm-l">${esc(t.name)}</span><span class="nm-s">${esc(t.short || t.name)}</span></div>
      <div class="tmeta">${esc(t.record || "—")}${dots(t.form)}</div></div><div class="tscore">${won ? '<span class="uf-w">W</span>' : ""}</div>${chips}</div>`;
  }
  function boutTile(g, key) {
    const o = g.odds;
    const cols = o ? ["Money", "Rounds"] : [];
    const head = cols.length ? `<div class="gt-head"><span></span><span></span><span></span>${cols.map(c => `<span>${c}</span>`).join("")}</div>` : "";
    const st = g.state === "in" ? `<span class="status live">LIVE · ${esc(g.statusDetail || "")}</span>` : g.state === "post" ? `<span class="status final">Final</span>` : `<span class="status">${A().timeET(g.date)}</span>`;
    const tag = [g.mainEvent ? '<span class="uf-tag me">Main event</span>' : "", g.title ? '<span class="uf-tag ti">Title</span>' : ""].join("");
    const foot = g.state === "post" ? `<div class="tfoot uf-res"><span>${esc(resultLine(g))}</span></div>`
      : o ? `<div class="tfoot"><span class="bk">${esc(o.provider || "provider n/a")}</span>${(g.books || {}).hardrockbet && !(g.books.hardrockbet.stale) ? '<span class="bk hr">Hard Rock Bet</span>' : ""}<span class="hint">${g.rounds || 3} rds</span></div>`
      : `<div class="noline">Lines not posted yet</div>`;
    return `<a class="game bout c${cols.length}" href="#/g/${key}/${g.id}" aria-label="${esc(g.name)}">
      <div class="game-top">${st}${tag}<span class="net">${esc([g.weightClass, g.rounds ? g.rounds + " rounds" : ""].filter(Boolean).join(" · "))}</span></div>
      ${head}${fighterRow(g, "away")}${fighterRow(g, "home")}${foot}</a>`;
  }
  function league(data, key, filter) {
    const { fullET, timeET } = A();
    const byId = Object.fromEntries(data.games.map(g => [g.id, g]));
    let evs = data.events || [];
    if (filter === "upcoming") evs = evs.filter(e => e.state !== "post");
    const chips = `<div class="chips"><span class="chip"><b>${data.report.upcoming}</b> upcoming bouts</span><span class="chip"><b>${data.report.withOdds}</b> with lines</span>
      <span class="chip">Lines: <b>${esc((data.report.providers || []).join(", ") || "none")}</b></span><span class="chip">${(data.events || []).filter(e => e.state !== "post").length} upcoming cards</span></div>`;
    let html = `<div class="page-head"><div><h1>${esc(data.league.full)}</h1><div class="sub">Fight cards, fighter moneylines and results · times in ${esc((window.SITE_CONFIG || {}).tzLabel || "ET")}</div></div>
      <div class="seg"><button data-f="upcoming" class="${filter === "upcoming" ? "on" : ""}">Upcoming & live</button><button data-f="all" class="${filter === "all" ? "on" : ""}">Incl. recent results</button></div></div>${chips}`;
    if (!evs.length) html += `<div class="empty" style="margin-top:16px"><h3>No UFC cards in the next ${data.windowDays} days</h3>Check back after the next data refresh, or show recent results.</div>`;
    for (const e of evs) {
      html += `<section class="uf-ev" id="ev-${esc(e.id)}"><div class="uf-evh"><div><h2>${esc(e.name)}</h2><div class="sub">${esc(fullET(e.date))} · ${esc([e.venue, e.city].filter(Boolean).join(", "))}${(e.broadcasts || []).length ? " · " + esc(e.broadcasts.join(", ")) : ""}</div></div>
        ${e.state === "post" ? '<span class="status final">Results</span>' : e.state === "in" ? '<span class="status live">LIVE</span>' : ""}</div>`;
      for (const s of e.segments || []) {
        const bouts = e.bouts.map(id => byId[id]).filter(g => g && g.segment === s.key);
        if (!bouts.length) continue;
        html += `<div class="day">${esc(s.name)}<span class="dn">${s.start ? esc(timeET(s.start)) + " · " : ""}${bouts.length} bout${bouts.length > 1 ? "s" : ""}</span></div><div class="grid">${bouts.map(g => boutTile(g, key)).join("")}</div>`;
      }
      html += `</section>`;
    }
    html += `<div class="note">Cards, records and results from ESPN's MMA feeds; fighter moneylines and total rounds from DraftKings via ESPN. Fight props (method of victory, round betting) aren't in the free feeds.</div>`;
    return html;
  }

  // ---------- fight page
  function lastFights(f, hist) {
    const rows = (hist || []).slice(0, 5);
    const t = tally(hist);
    return `<div class="card"><h3>${flag(f)} <a class="tlink" href="#/p/ufc/${esc(f.id)}">${esc(f.name)}</a></h3>
      <div class="uf-l5">${stripHtml(hist)}<span class="pp-sum">${rows.length ? `${t.W}-${t.L}${t.D ? "-" + t.D : ""} last ${rows.length}` : ""}</span></div>
      ${rows.length ? `<table class="uf-hist"><tbody>${rows.map(h => `<tr><td class="uf-r uf-${esc(h.res)}">${esc(h.res)}</td><td>${h.oppId ? `<a class="tlink" href="#/p/ufc/${esc(h.oppId)}">${esc(h.opp || "")}</a>` : esc(h.opp || "")}<div class="note">${esc([h.method, h.detail && h.detail !== h.method ? h.detail : "", rnd(h.round, h.clock)].filter(Boolean).join(" · "))}</div></td><td class="num">${h.date ? esc(A().fmt(h.date, { month: "short", day: "numeric", year: "2-digit" })) : ""}</td></tr>`).join("")}</tbody></table>` : ""}</div>`;
  }
  async function fight(d, idx, key) {
    const L = A(), g = d.game, H = g.home, W = g.away, r = g.result || {};
    let F = {};
    try { F = (await L.getJSON(`data/${key}/fighters.json`)).fighters || {}; } catch (e) {}
    const side = (t, s) => {
      const win = g.state === "post" && r.winner === s;
      return `<div class="mteam ${s === "home" ? "home" : ""}">${flag(t, "uf-flag lg")}<div><div class="nm"><a class="tlink" href="#/p/ufc/${esc(t.id)}">${esc(t.name)}</a>${win ? ' <span class="uf-w">W</span>' : ""}</div><div class="rec">${esc(t.record || "—")}${t.country ? " · " + esc(t.country) : ""}${dots(t.form)}</div></div></div>`;
    };
    const mid = g.state === "pre" ? `<div class="vs">VS</div><div class="when">${esc(L.fullET(g.date))}</div>`
      : g.state === "in" ? `<div class="vs live">LIVE</div><div class="when">${esc(g.statusDetail || "")}</div>`
      : `<div class="vs">${r.outcome === "draw" ? "DRAW" : r.outcome === "nc" ? "NC" : "FINAL"}</div><div class="when">${esc(resultLine(g))}</div>`;
    let html = `<a class="back" href="#/l/${key}">← ${esc(idx.league.full)}</a>
      <div class="match uf-match" style="--ca:#b91c1c;--ch:#1d4ed8">${side(W, "away")}
        <div class="mmid">${mid}<div class="where">${esc([g.weightClass, g.rounds ? g.rounds + " rounds" : "", g.segmentName].filter(Boolean).join(" · "))}</div>
        <div class="where">${esc((g.event || {}).name || "")}</div><div class="where">${esc([g.venue, g.city].filter(Boolean).join(", "))}</div>${(g.broadcasts || []).length ? `<div class="where">${esc(g.broadcasts.join(", "))}</div>` : ""}</div>
        ${side(H, "home")}</div>`;
    if (g.state === "post") {
      const jt = [W, H].filter(t => (t.judges || []).length).map(t => `${esc(t.short || t.name)}: ${t.judges.map(esc).join(", ")}`).join(" · ");
      html += `<div class="section-title">Result</div><div class="card uf-result"><div class="uf-big">${esc(resultLine(g))}</div>${jt ? `<div class="note">Judges' totals: ${jt}</div>` : ""}</div>`;
    }
    html += `<div class="section-title">Betting lines</div><div class="cols">${L.linesCard(g, "mma")}${L.booksCard(g, "mma")}</div>`;
    if (window.LSBets) html += window.LSBets.trackCard(key, g, "mma");
    const lm = L.lineMoveSection(d, g, "mma");
    html += lm.html;
    html += `<div class="section-title">Fight props</div>${L.notAvail("Fight props", "Method of victory, round betting and other fight props aren't in ESPN's free feeds.")}`;
    html += `<div class="section-title">Tale of the tape</div><div id="ufTape" class="card"><div class="note">Loading fighter bios from ESPN…</div></div>`;
    html += `<div class="section-title">Last 5 fights</div><div class="cols">${lastFights(W, (F[W.id] || {}).hist)}${lastFights(H, (F[H.id] || {}).hist)}</div>`;
    const ev = (idx.events || []).find(e => e.id === (g.event || {}).id);
    if (ev) {
      const byId = Object.fromEntries(idx.games.map(x => [x.id, x]));
      const rest = ev.bouts.filter(id => id !== g.id).map(id => byId[id]).filter(Boolean);
      if (rest.length) html += `<div class="section-title">Rest of the card</div><div class="grid">${rest.map(x => boutTile(x, key)).join("")}</div>`;
    }
    html += `<div class="note">ESPN MMA feeds. Red corner listed first. Lines: ${esc(g.oddsSource || "ESPN")}.</div>`;
    app().innerHTML = html;
    lm.wire();
    window.scrollTo(0, 0);
    const tok = L.nav();
    tape([W, H], tok).catch(e => console.warn(e));
  }
  const bioOf = a => {
    if (!a) return {};
    const x = a.athlete || a;
    return { height: x.displayHeight, weight: x.displayWeight, reach: x.displayReach || (x.reach ? x.reach + '"' : ""), stance: (x.stance || {}).text, age: x.age,
      style: (x.styles || []).map(s => s.text).join(", "), assoc: (x.association || {}).name, nick: x.nickname, headshot: (x.headshot || {}).href,
      wc: (x.weightClass || {}).text, country: x.citizenship || (x.flag || {}).alt };
  };
  async function tape(fs, tok) {
    const L = A(), el = () => document.getElementById("ufTape");
    const bios = await Promise.all(fs.map(f => L.espn(`common/v3/sports/mma/athletes/${f.id}`).then(bioOf, () => ({}))));
    if (tok !== L.nav() || !el()) return;
    const rows = [["Record", fs[0].record, fs[1].record], ["Age", bios[0].age, bios[1].age], ["Height", bios[0].height, bios[1].height], ["Weight", bios[0].weight, bios[1].weight],
      ["Reach", bios[0].reach, bios[1].reach], ["Stance", bios[0].stance, bios[1].stance], ["Style", bios[0].style, bios[1].style], ["Team", bios[0].assoc, bios[1].assoc]].filter(r => r[1] || r[2]);
    el().innerHTML = rows.length ? `<table class="books"><thead><tr><th></th><th>${esc(fs[0].short || fs[0].name)}</th><th>${esc(fs[1].short || fs[1].name)}</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r[0])}</td><td class="num">${r[1] != null && r[1] !== "" ? esc(r[1]) : NA}</td><td class="num">${r[2] != null && r[2] !== "" ? esc(r[2]) : NA}</td></tr>`).join("")}</tbody></table><div class="note">Fighter bios: ESPN (live).</div>`
      : `<div class="note">ESPN didn't return fighter bios for this bout.</div>`;
  }

  // ---------- fighter page (#/p/ufc/{id})
  async function fighter(id) {
    const L = A(), tok = L.nav(), settle = p => p.then(v => v, () => null);
    L.renderTabs("ufc"); window.scrollTo(0, 0);
    app().innerHTML = `<div class="loading" aria-busy="true"><span class="sr-only">Loading fighter…</span><span class="sk skel-hero"></span></div>`;
    const [fj, idx, bio] = await Promise.all([settle(L.getJSON("data/ufc/fighters.json")), settle(L.getJSON("data/ufc/index.json")), settle(L.espn(`common/v3/sports/mma/athletes/${id}`))]);
    if (tok !== L.nav()) return;
    const f = ((fj || {}).fighters || {})[id], b = bioOf(bio), a = (bio && bio.athlete) || {};
    if (!f && !a.id) return (app().innerHTML = `<a class="back" href="#/l/ufc">← UFC</a><div class="empty"><h3>Fighter not found</h3>We couldn't load this fighter from ESPN. Check your connection and try again.</div>`);
    const name = (f && f.name) || a.displayName, rec = (f && f.record) || ((a.statsSummary || {}).statistics || []).find(s => s.name === "wins-losses-draws")?.displayValue;
    // ESPN's bio says whether a headshot exists; only guess the CDN path when the bio didn't load (avoids 404s)
    const img = b.headshot || (a.id ? null : `https://a.espncdn.com/i/headshots/mma/players/full/${id}.png`);
    const ini = String(name || "?").split(" ").filter(Boolean).map(w => w[0]).slice(0, 2).join("").toUpperCase();
    const stats = ((a.statsSummary || {}).statistics || []).filter(s => s.name !== "wins-losses-draws").map(s => `<span class="chip" title="${esc(s.displayName || "")}">${esc(({ "tkos-tkoLosses": "KO/TKO W-L", "submissions-submissionLosses": "Submission W-L", "decisions-decisionLosses": "Decision W-L" })[s.name] || s.abbreviation || s.displayName)} <b>${esc(s.displayValue)}</b></span>`).join("");
    const bouts = ((f && f.bouts) || []).map(bid => (idx ? idx.games.find(g => g.id === bid) : null)).filter(Boolean);
    const hist = (f && f.hist) || [];
    const ch = [rec && `<span class="chip"><b>${esc(rec)}</b></span>`, (b.wc || (f && f.wc)) && `<span class="chip">${esc(b.wc || f.wc)}</span>`,
      (f && f.flag || b.country) && `<span class="chip">${f && f.flag ? flag({ logo: f.flag, country: f.country }, "uf-flag xs") : ""}${esc(b.country || (f && f.country) || "")}</span>`, `<span class="chip">UFC</span>`].filter(Boolean).join("");
    let html = `<a class="back" href="#/l/ufc">← UFC</a>
      <div class="phero" style="--tc:#1d4ed8"><span class="av xl" aria-hidden="true">${img ? `<img src="${esc(img)}" alt="" onerror="this.remove()">` : esc(ini)}</span><div class="ph-t"><h1>${esc(name)}</h1>
        ${b.nick ? `<div class="sub uf-nick">“${esc(b.nick)}”</div>` : ""}<div class="chips">${ch}</div></div></div>`;
    html += `<div class="section-title">Last 5 fights</div><div class="card"><div class="uf-l5">${stripHtml(hist)}</div>${hist.length ? "" : `<div class="note">Recent fight history is tracked for fighters on cards in the data window.</div>`}</div>`;
    if (stats) html += `<div class="chips">${stats}</div>`;
    if (bouts.length) html += `<div class="section-title">On the card</div><div class="grid">${bouts.map(g => boutTile(g, "ufc")).join("")}</div>`;
    if (hist.length) html += `<div class="section-title">Recent fights</div>${lastFights({ id, name, logo: f && f.flag, country: f && f.country }, hist)}`;
    const tp = [["Age", b.age], ["Height / weight", [b.height, b.weight].filter(Boolean).join(", ")], ["Reach", b.reach], ["Stance", b.stance], ["Style", b.style], ["Team", b.assoc]].filter(r => r[1]);
    html += `<div class="section-title">Bio</div>` + (tp.length ? `<div class="card"><dl class="bio">${tp.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl></div>` : L.notAvail("Bio", "ESPN lists no bio details for this fighter."));
    app().innerHTML = html;
  }

  window.LSUfc = { league, fight, fighter, boutTile, resultLine, strip, tally, bioOf };
})();
