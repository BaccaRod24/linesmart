/* LineSmart advanced stats UI (window.LSAdv). Lazy-loads data/adv/<lg>.json (team efficiency, pace/ratings, ATS/O-U)
   and data/adv/<lg>-players.json (usage trends) only on the pages that need them. Math lives in adv-core.js.
   Everything here is informational: records and edges describe the past or a consensus price, not a prediction. */
(function () {
  const C = window.AdvCore;
  const A = () => window.LSApp, G = () => window.LSGeo;
  const esc = s => (A() ? A().esc(s) : String(s ?? ""));
  const avail = k => !G() || G().isAvailable(k);
  const BK = { draftkings: "DraftKings", hardrockbet: "Hard Rock Bet", fanduel: "FanDuel" };
  const BKS = { draftkings: "DK", hardrockbet: "HR", fanduel: "FD" };
  const NA = '<span class="na">N/A</span>';
  const ADV_LGS = new Set(["nfl", "nba", "ncaaf", "ncaab", "nhl", "mlb"]);
  const PLAYER_LGS = new Set(["nfl", "nba"]);
  const isNum = v => typeof v === "number" && isFinite(v);
  const am = v => (isNum(v) ? (v > 0 ? "+" + v : String(v)) : "—");
  const pct = (v, d = 1) => (isNum(v) ? (100 * v).toFixed(d) + "%" : "—");
  const sgn = (v, d = 3) => (isNum(v) ? (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d) : "—");
  const ePct = e => (isNum(e) ? (e > 0 ? "+" : e < 0 ? "−" : "") + Math.abs(e).toFixed(1) + "%" : "—");
  const ord = n => (isNum(n) ? n + (["th", "st", "nd", "rd"][(n % 100 - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th") : "");
  const rkTag = (r, of = 32) => (isNum(r) ? `<span class="av-rk ${r <= Math.ceil(of / 4) ? "top" : r > of - Math.ceil(of / 4) ? "bot" : ""}">${ord(r)}</span>` : "");
  const arrow = t => (t === "up" ? '<span class="av-tr up" title="Trending up">▲</span>' : t === "down" ? '<span class="av-tr down" title="Trending down">▼</span>' : t === "flat" ? '<span class="av-tr flat" title="Steady">▬</span>' : "");
  const day = iso => (A() ? A().fmt(iso, { month: "short", day: "numeric" }) : iso);

  const docs = {};
  async function load(lg, players) {
    const url = `data/adv/${lg}${players ? "-players" : ""}.json`;
    if (!(url in docs)) docs[url] = A().getJSON(url).catch(() => null);
    return docs[url];
  }

  // ---------- line value (odds comparison card)
  /** Per-game helpers for app.js booksCard(): cell extras, a fair-line column and a footnote. */
  function booksExtra(B, kind) {
    if (!C) return null;
    const an = C.analyze(B, kind);
    const anyFair = Object.values(an).some(m => m.fair);
    const cell = (mk, o, bk) => {
      const M = an[mk], b = M && M.books[bk];
      if (!b) return "";
      const imp = C.implied(b.prices[o]), e = b.edge ? b.edge[o] : null, ok = avail(bk);
      const out = b.out.includes(o);
      const eCls = !ok ? "" : e > 0 ? "pos" : e < -0.03 ? "neg" : "";
      return `<span class="lv"><span title="Implied probability at this price (includes the book's margin)">${pct(imp)}</span>${isNum(e) ? ` · <b class="lv-e ${eCls}" title="Edge vs the no-vig consensus fair price">${ePct(100 * e)}</b>` : ""}</span>`
        + (out ? `<span class="lv-out${ok ? "" : " ref"}" title="${b.outKind === "line" || (b.line !== M.line && b.line !== null) ? `Line differs from the consensus (${esc(M.line)}) by ${esc(Math.abs(b.line - M.line))}` : "Price is at least 3 points of probability better than the other books"}">Outlier</span>` : "");
    };
    const fairCell = (mk, o) => {
      const M = an[mk];
      if (!M || !M.fair) return `<td class="num lv-fair">${NA}</td>`;
      const ln = M.line === null ? "" : mk === "spread" ? `${(o === "home" ? M.line : -M.line) > 0 ? "+" : ""}${o === "home" ? M.line : -M.line} ` : `${o === "over" ? "O" : "U"} ${M.line} `;
      return `<td class="num lv-fair"><span class="px">${esc(ln)}${am(M.fairAm[o])}</span><span class="lv">${pct(M.fair[o])} · ${M.n} bks</span></td>`;
    };
    // phones: the fair line rides under the market label instead of a far-right column
    const fairInline = (mk, o) => {
      const M = an[mk];
      if (!M || !M.fair) return "";
      const ln = M.line === null ? "" : mk === "spread" ? `${(o === "home" ? M.line : -M.line) > 0 ? "+" : ""}${o === "home" ? M.line : -M.line} ` : "";
      return `<span class="lv-fair-m">Fair ${esc(ln)}${am(M.fairAm[o])}<i>${pct(M.fair[o])}</i></span>`;
    };
    const note = anyFair ? `<div class="note lv-note"><b>Line value.</b> Under each price: implied probability (it includes the book's margin) and edge vs the <b>fair line</b>, the no-vig consensus of the books hanging the most common line (each book's margin removed proportionally, then averaged; needs 2+ books). Edge = fair probability × decimal odds − 1, so 0% is a fair price and most prices sit a little below it. <b>Outlier</b> marks a book that is clearly off the others: a spread/total ${C.LINE_GAP[kind] ?? C.LINE_GAP_DEFAULT}+ points from the consensus line, or a price 3+ points of probability better than the other two books. Off-market numbers can be stale or posted in error, so confirm at the book.${G() && G().current().state ? ` Edges are colored only for books legal in ${esc(G().current().stateName)}.` : ""} Informational only, not a prediction.</div>` : "";
    return { an, cell, fairCell, fairInline, note, anyFair };
  }

  // ---------- Today's Slate: value spots
  function valueSpots(meta) {
    const V = meta && meta.slate && meta.slate.value;
    if (!V || !Array.isArray(V.rows)) return "";
    const ev = G() ? G().current() : null, st = ev && ev.state;
    const rows = V.rows.map(r => {
      const offs = Object.entries(r.offers || {}).filter(([bk]) => avail(bk)).sort((a, b) => b[1][1] - a[1][1]);
      return offs.length ? { r, bk: offs[0][0], o: offs[0][1] } : null;
    }).filter(Boolean).filter(x => x.o[1] >= 0).sort((a, b) => b.o[1] - a.o[1]).slice(0, 6);   // home card: 0%+ EV only
    const lines = (V.lines || []).filter(x => avail(x.bk)).slice(0, 3);
    const nm = k => esc(((meta.leagues || {})[k] || {}).name || k.toUpperCase());
    const t = iso => (A() ? (A().timeET(iso)) : iso);
    const when = r => `${r.today ? "" : esc(A() ? A().fmt(r.d, { weekday: "short" }) + " " : "")}${esc(t(r.d))}`;
    const item = ({ r, bk, o }) => `<a class="vs-row" href="#/g/${esc(r.lg)}/${esc(r.id)}">
        <span class="vs-l"><span class="vs-lg">${nm(r.lg)}</span><b>${esc(r.lbl)}</b><small>${esc(r.m)} · ${when(r)}</small></span>
        <span class="vs-p"><b class="px">${am(o[0])}</b><small>${esc(BKS[bk] || bk)}${o[2] ? ' · <span class="lv-out">Outlier</span>' : ""}</small></span>
        <span class="vs-f"><small>fair</small>${am(r.fairAm)}</span>
        <span class="vs-e ${o[1] > 0 ? "pos" : ""}">${ePct(o[1])}</span></a>`;
    const lrow = x => `<a class="vs-row vs-line" href="#/g/${esc(x.lg)}/${esc(x.id)}">
        <span class="vs-l"><span class="vs-lg">${nm(x.lg)}</span><b>${esc(x.lbl)}</b><small>${esc(x.m)} · consensus ${esc(x.cons)}</small></span>
        <span class="vs-p"><b class="px">${am(x.price)}</b><small>${esc(BKS[x.bk] || x.bk)}</small></span><span class="lv-out">Outlier</span></a>`;
    // the full method (no-vig math, EV formula, what's left out) lives in the Value page's "How this works"
    const more = window.LSValue ? window.LSValue.link("All value ›") : "";
    const where = st === "FL" ? " Florida: Hard Rock Bet prices only." : st ? ` Books legal in ${esc(ev.stateName)} only.` : "";
    const body = rows.length ? `<div class="vs-list">${rows.map(item).join("")}</div>`
      : `<div class="vs-none" role="status">No value spots right now — prices are in line with the market. Check back after the next refresh.${more ? `<br>${more}` : ""}</div>`;
    return `<section class="card vspots" aria-label="Value spots"><div class="vs-head"><h3>Value spots</h3><span class="st-sub">best price vs no-vig fair line · next ${esc(V.hours || 36)} h</span>${rows.length ? more : ""}</div>
      ${body}${lines.length ? `<div class="vs-sub">Off-consensus lines</div><div class="vs-list">${lines.map(lrow).join("")}</div>` : ""}
      <div class="note vs-cap">Prices that pay more than the market's fair odds.${where} Informational, not a prediction.</div></section>`;
  }

  // ---------- ATS / O-U
  const rec = r => (Array.isArray(r) ? C.recStr(r) : null);
  const strip = (s, kind) => (s ? `<span class="av-strip">${[...String(s).slice(-10)].map(c => `<i class="av-${kind}-${c}">${c}</i>`).join("")}</span>` : "");
  function atsNote(ats) {
    if (!ats) return "";
    const src = Object.entries(ats.src || {}).map(([k, n]) => `${n} ${k === "nflverse" ? "nflverse closing lines" : k === "espn-close" ? "DraftKings closing lines via ESPN" : k === "linesmart" ? "our own last pre-game lines" : k}`).join(", ");
    return `Graded from ${esc(ats.graded)} of ${esc(ats.finals)} completed games${ats.since ? ` since ${esc(day(ats.since))}` : ""} (${esc(src || "no lines")}).${ats.pendingBackfill ? ` ${esc(ats.pendingBackfill)} older games are still being backfilled.` : ""} W-L-P; a push (P) is a game landing exactly on the number.`;
  }
  function atsCmp(ats, aId, hId, A_, H_) {
    const a = ats && ats.teams[aId], h = ats && ats.teams[hId];
    if (!a && !h) return "";
    const row = (label, x, y, better) => `<div class="cmp-row"><div class="l">${x ?? NA}</div><div class="m">${esc(label)}</div><div class="r">${y ?? NA}</div></div>`;
    const pc = r => { const p = C.recPct(r); return p === null ? "" : ` <span class="na">${Math.round(100 * p)}%</span>`; };
    const r = (t, k, b) => (t && t[k] && t[k][b] ? rec(t[k][b]) + pc(t[k][b]) : null);
    return `<div class="cmp"><div class="cmp-head"><div>${esc(A_.abbr)} <span class="na">(away)</span></div><div></div><div class="r"><span class="na">(home)</span> ${esc(H_.abbr)}</div></div>
      ${row("ATS overall", r(a, "ats", "all"), r(h, "ats", "all"))}${row("ATS away / home", r(a, "ats", "away"), r(h, "ats", "home"))}${row("ATS last 10", r(a, "ats", "l10"), r(h, "ats", "l10"))}
      ${row("O/U overall", r(a, "ou", "all"), r(h, "ou", "all"))}${row("O/U away / home", r(a, "ou", "away"), r(h, "ou", "home"))}${row("O/U last 10", r(a, "ou", "l10"), r(h, "ou", "l10"))}
      ${row("Recent ATS", a ? strip(a.last, "ats") : null, h ? strip(h.last, "ats") : null)}</div>`;
  }

  // ---------- NFL efficiency
  const NFL_ROWS = [
    ["Off EPA / play", t => t.off, "epa", "high", v => sgn(v)], ["Def EPA / play allowed", t => t.dfn, "epa", "low", v => sgn(v)],
    ["Off success rate", t => t.off, "sr", "high", v => pct(v)], ["Def success allowed", t => t.dfn, "sr", "low", v => pct(v)],
    ["Pass EPA / play", t => t.off, "pepa", "high", v => sgn(v)], ["Rush EPA / play", t => t.off, "repa", "high", v => sgn(v)],
    ["Red-zone TD %", t => t.off, "rz", "high", v => pct(v, 0)], ["Red-zone TD % allowed", t => t.dfn, "rz", "low", v => pct(v, 0)],
    ["3rd-down conv %", t => t.off, "td3", "high", v => pct(v, 0)], ["3rd-down allowed", t => t.dfn, "td3", "low", v => pct(v, 0)],
  ];
  function nflCmp(n, aId, hId, A_, H_) {
    const a = n.teams[aId], h = n.teams[hId];
    if (!a || !h) return "";
    const cellv = (t, get, k, f) => { const s = get(t); return s && isNum(s[k]) ? `${f(s[k])}${rkTag(s.rk && s.rk[k])}` : NA; };
    const rows = NFL_ROWS.map(([label, get, k, better, f]) => {
      const x = get(a)[k], y = get(h)[k];
      let ca = "", ch = "";
      if (isNum(x) && isNum(y) && x !== y) ((better === "high") === (x > y) ? (ca = "adv") : (ch = "adv"));
      return `<div class="cmp-row"><div class="l ${ca}">${cellv(a, get, k, f)}</div><div class="m">${esc(label)}</div><div class="r ${ch}">${cellv(h, get, k, f)}</div></div>`;
    });
    const qb = t => n.qbs && n.qbs[t.qb];
    const qa = qb(a), qh = qb(h);
    const qcell = (q, id) => (q ? `<a class="tlink" href="#/p/nfl/${esc(id)}">${esc(q.n)}</a><br><span class="na">${sgn(q.epa)} EPA · CPOE ${q.cpoe > 0 ? "+" : ""}${esc(q.cpoe)}</span>` : NA);
    rows.push(`<div class="cmp-row"><div class="l">${qcell(qa, a.qb)}</div><div class="m">QB EPA / dropback · CPOE</div><div class="r">${qcell(qh, h.qb)}</div></div>`);
    const mm = (o, d) => (o && d && o.off.rk && d.dfn.rk ? `${esc(o.abbr)} offense ${ord(o.off.rk.epa)} vs ${esc(d.abbr)} defense ${ord(d.dfn.rk.epa)}` : "");
    return `<div class="av-mm"><span>${mm(a, h)}</span><span>${mm(h, a)}</span></div><div class="cmp"><div class="cmp-head"><div>${esc(A_.abbr)} <span class="na">(away)</span></div><div></div><div class="r"><span class="na">(home)</span> ${esc(H_.abbr)}</div></div>${rows.join("")}</div>`;
  }
  const nflNote = n => `nflverse play-by-play (CC-BY 4.0), ${esc(n.season)} regular season week${n.weeks.length > 1 ? `s ${n.weeks[0]}–${n.weeks[n.weeks.length - 1]}` : ` ${n.weeks[0]}`}; refreshed daily (last ${esc(A().fullET(n.fetched))}). EPA = expected points added per play; success = EPA > 0; ranks are out of 32 (1st = best, on defense the lowest allowed). Red-zone TD % = drives reaching the opponent 20 that end in a TD.`;

  // ---------- NBA pace / ratings
  function nbaCmp(N, gid, aId, hId, A_, H_) {
    const a = N.teams[aId], h = N.teams[hId], gx = (N.games || {})[gid];
    if (!a && !h) return "";
    const rows = [["Offensive rating", "ortg", "high"], ["Defensive rating", "drtg", "low"], ["Net rating", "net", "high"], ["Pace", "pace", null]].map(([label, k, better]) => {
      const x = a && a[k], y = h && h[k];
      let ca = "", ch = "";
      if (better && isNum(x) && isNum(y) && x !== y) ((better === "high") === (x > y) ? (ca = "adv") : (ch = "adv"));
      const f = (t, v) => (isNum(v) ? `${k === "net" && v > 0 ? "+" : ""}${v.toFixed(1)}${rkTag(t.rk && t.rk[k], 30)}` : NA);
      return `<div class="cmp-row"><div class="l ${ca}">${a ? f(a, x) : NA}</div><div class="m">${esc(label)}</div><div class="r ${ch}">${h ? f(h, y) : NA}</div></div>`;
    });
    const l10 = t => (t && t.l10 ? `${t.l10[0]}-${t.l10[1]}` : null);
    rows.push(`<div class="cmp-row"><div class="l">${l10(a) ?? NA}</div><div class="m">Last 10</div><div class="r">${l10(h) ?? NA}</div></div>`);
    const rest = s => (s ? (s.b2b ? `<span class="badge out">Back-to-back</span>` : isNum(s.rest) ? `${s.rest} day${s.rest === 1 ? "" : "s"}` : "1st game") : null);
    if (gx) rows.push(`<div class="cmp-row"><div class="l">${rest(gx.a) ?? NA}</div><div class="m">Rest</div><div class="r">${rest(gx.h) ?? NA}</div></div>`);
    const head = gx && isNum(gx.pace) ? `<div class="av-proj"><span class="mlbl">Projected pace</span><b>${gx.pace.toFixed(1)}</b><small>possessions / 48 · league avg ${esc(N.league.pace)}</small></div>` : "";
    return `${head}<div class="cmp"><div class="cmp-head"><div>${esc(A_.abbr)} <span class="na">(away)</span></div><div></div><div class="r"><span class="na">(home)</span> ${esc(H_.abbr)}</div></div>${rows.join("")}</div>`;
  }
  const nbaNote = N => `Computed from ESPN box scores of ${esc(N.league.games)} games this season: possessions = FGA − OREB + TOV + 0.44 × FTA (average of both teams); ratings are points per 100 possessions; pace is possessions per 48 minutes. Projected pace = home pace × away pace ÷ league pace. Rest counts full days off since the last game; back-to-back = played yesterday. Ranks out of 30.`;

  /** Game page: placeholder + async mount (after the head-to-head card). */
  const gameSlot = (lg, g) => (ADV_LGS.has(lg) && g && g.home && g.away ? `<div id="advGame"></div>` : "");
  async function mountGame(el, lg, g, alive = () => true) {
    const d = await load(lg);
    if (!alive() || !d) return;
    const H = g.home, Aw = g.away, aId = String(Aw.id), hId = String(H.id);
    let html = "";
    if (d.nfl) { const x = nflCmp(d.nfl, aId, hId, Aw, H); if (x) html += `<div class="section-title">Efficiency matchup <span class="st-sub">nflverse · EPA</span></div><div class="card av-card">${x}<div class="note">${nflNote(d.nfl)}</div></div>`; }
    if (d.nba) { const x = nbaCmp(d.nba, String(g.id), aId, hId, Aw, H); if (x) html += `<div class="section-title">Pace & ratings <span class="st-sub">per 100 possessions</span></div><div class="card av-card">${x}<div class="note">${nbaNote(d.nba)}</div></div>`; }
    if (d.ats) { const x = atsCmp(d.ats, aId, hId, Aw, H); if (x) html += `<div class="section-title">ATS & over/under <span class="st-sub">vs closing lines</span></div><div class="card av-card">${x}<div class="note">${atsNote(d.ats)}</div></div>`; }
    el.innerHTML = html;
  }

  // ---------- team page
  const box = (label, val, sub) => `<div class="stat"><span class="sl">${esc(label)}</span><b class="num">${val}</b>${sub ? `<span class="ss">${sub}</span>` : ""}</div>`;
  const teamSlot = lg => (ADV_LGS.has(lg) ? `<div id="advTeam"></div>` : "");
  async function mountTeam(el, lg, tid, alive = () => true) {
    const d = await load(lg);
    if (!alive() || !d) return;
    tid = String(tid);
    let html = "";
    const nt = d.nfl && d.nfl.teams[tid];
    if (nt) {
      const q = d.nfl.qbs && d.nfl.qbs[nt.qb];
      const b = (l, s, k, f) => box(l, f(s[k]), s.rk && s.rk[k] ? `${ord(s.rk[k])} of 32` : "");
      html += `<div class="section-title">Efficiency <span class="st-sub">nflverse · ${esc(d.nfl.season)} wk ${esc(d.nfl.weeks[0])}–${esc(d.nfl.weeks[d.nfl.weeks.length - 1])}</span></div><div class="statgrid av-grid">
        ${b("Off EPA / play", nt.off, "epa", sgn)}${b("Def EPA / play allowed", nt.dfn, "epa", sgn)}${b("Off success rate", nt.off, "sr", pct)}${b("Def success allowed", nt.dfn, "sr", pct)}
        ${b("Pass EPA / play", nt.off, "pepa", sgn)}${b("Rush EPA / play", nt.off, "repa", sgn)}${b("Red-zone TD %", nt.off, "rz", v => pct(v, 0))}${b("Red-zone TD % allowed", nt.dfn, "rz", v => pct(v, 0))}
        ${b("3rd-down conv %", nt.off, "td3", v => pct(v, 0))}${b("3rd-down allowed", nt.dfn, "td3", v => pct(v, 0))}
        ${q ? box(`QB · ${esc(q.n)}`, `${sgn(q.epa)}`, `EPA / dropback${q.qual && q.rk ? ` · ${ord(q.rk.epa)}` : ""} · CPOE ${q.cpoe > 0 ? "+" : ""}${esc(q.cpoe)}${q.qual && q.rk ? ` (${ord(q.rk.cpoe)})` : ""}`) : ""}</div>
        <div class="note">${nflNote(d.nfl)} QB ranks among ${esc(d.nfl.qualQB)} QBs with ${esc(d.nfl.qbMin)}+ dropbacks.</div>`;
    }
    const bt = d.nba && d.nba.teams[tid];
    if (bt) {
      const r = k => (bt.rk && bt.rk[k] ? `${ord(bt.rk[k])} of 30` : "");
      html += `<div class="section-title">Pace & ratings <span class="st-sub">${esc(bt.gp)} games</span></div><div class="statgrid av-grid">
        ${box("Offensive rating", bt.ortg.toFixed(1), r("ortg"))}${box("Defensive rating", bt.drtg.toFixed(1), r("drtg"))}${box("Net rating", (bt.net > 0 ? "+" : "") + bt.net.toFixed(1), r("net"))}
        ${box("Pace", bt.pace.toFixed(1), r("pace"))}${box("Last 10", `${bt.l10[0]}-${bt.l10[1]}`, "")}${bt.lastGame ? box("Last game", esc(day(bt.lastGame)), "") : ""}</div><div class="note">${nbaNote(d.nba)}</div>`;
    }
    const at = d.ats && d.ats.teams[tid];
    if (at) {
      const pc = r => { const p = C.recPct(r); return p === null ? "" : ` <span class="na">${Math.round(100 * p)}%</span>`; };
      const row = (l, k) => `<tr><td>${l}</td><td class="num">${rec(at.ats[k]) || "—"}${pc(at.ats[k])}</td><td class="num">${rec(at.ou[k]) || "—"}${pc(at.ou[k])}</td></tr>`;
      html += `<div class="section-title">ATS & over/under <span class="st-sub">vs closing lines</span></div><div class="card av-card"><table class="av-tbl"><thead><tr><th></th><th>ATS (W-L-P)</th><th>O/U (O-U-P)</th></tr></thead><tbody>
        ${row("Overall", "all")}${row("Home", "home")}${row("Away", "away")}${row("Last 10", "l10")}</tbody></table>
        <div class="av-strips"><span>ATS ${strip(at.last, "ats")}</span><span>O/U ${strip(at.lastOU, "ou")}</span></div><div class="note">${atsNote(d.ats)}</div></div>`;
    }
    el.innerHTML = html;
  }

  // ---------- player usage
  const NFL_U = [["tgt", "Target share", "share"], ["car", "Carry share", "share"], ["snap", "Snap share", "snap"], ["rz", "Red-zone touches / game", "rz"]];
  function usageRows(lg, p) {
    if (lg === "nfl") return NFL_U.filter(([k]) => p[k] && (p[k][0] > 0 || p[k][1] > 0)).map(([k, l]) => [l, k === "rz" ? p[k][0].toFixed(1) : pct(p[k][0], 0), k === "rz" ? p[k][1].toFixed(1) : pct(p[k][1], 0), p[k][2]]);
    return [["Minutes", p.min], ["Usage rate", p.usg]].filter(([, v]) => v).map(([l, v]) => [l, isNum(v[0]) ? v[0].toFixed(1) + (l === "Usage rate" ? "%" : "") : "—", isNum(v[1]) ? v[1].toFixed(1) + (l === "Usage rate" ? "%" : "") : "—", v[2]]);
  }
  const recentLbl = lg => (lg === "nfl" ? "Last 3" : "Last 5");
  const playerSlot = lg => (PLAYER_LGS.has(lg) ? `<div id="advPlayer"></div>` : "");
  async function mountPlayer(el, lg, pid, alive = () => true) {
    const [pd, td] = await Promise.all([load(lg, true), lg === "nfl" ? load(lg) : null]);
    if (!alive()) return;
    const p = pd && pd.players[String(pid)], q = td && td.nfl && td.nfl.qbs && td.nfl.qbs[String(pid)];
    if (!p && !q) return;
    let html = `<div class="section-title">Usage trends <span class="st-sub">${recentLbl(lg)} vs season</span></div><div class="card av-card">`;
    if (p) {
      const rows = usageRows(lg, p);
      html += `<table class="av-tbl"><thead><tr><th></th><th>Season</th><th>${recentLbl(lg)}</th><th>Trend</th></tr></thead><tbody>${rows.map(([l, s, r, t]) => `<tr><td>${esc(l)}</td><td class="num">${esc(s)}</td><td class="num">${esc(r)}</td><td class="num">${arrow(t) || '<span class="na">—</span>'}</td></tr>`).join("")}</tbody></table>`;
    }
    if (q) html += `<div class="av-qb">${box("EPA / dropback", sgn(q.epa), q.qual && q.rk ? `${ord(q.rk.epa)} of ${esc(td.nfl.qualQB)}` : `${esc(q.db)} dropbacks`)}${box("CPOE", (q.cpoe > 0 ? "+" : "") + esc(q.cpoe), q.qual && q.rk ? `${ord(q.rk.cpoe)} of ${esc(td.nfl.qualQB)}` : "completion % over expected")}</div>`;
    const T = pd && pd.trend;
    html += `<div class="note">${lg === "nfl" ? `nflverse play-by-play and snap counts (CC-BY 4.0; snap counts originate from Pro Football Reference), ${p ? `${esc(p.g)} games` : "this season"}. Shares are of the team's targets / designed carries / offensive snaps in games he played. Arrow when the last 3 games move ${T ? Math.round(T.share * 100) : 3}+ points (snaps ${T ? Math.round(T.snap * 100) : 5}+, red-zone ${T ? T.rz : 0.5}+ per game); needs 4+ games.` : `ESPN box scores, ${esc(p.g)} games. Usage rate = share of team plays (FGA + 0.44 × FTA + TOV) used while on the floor. Arrow when the last 5 move ${T ? T.min : 3}+ minutes or ${T ? T.usg : 2}+ usage points; needs 6+ games.`}</div></div>`;
    el.innerHTML = html;
  }

  /** Props cards: small usage chips under each player's name (game props view). */
  async function decorateProps(el, lg) {
    if (!PLAYER_LGS.has(lg) || !el) return;
    const pd = await load(lg, true);
    if (!pd) return;
    el.querySelectorAll(".pp-card[data-pid]").forEach(c => {
      const p = pd.players[c.dataset.pid];
      if (!p || c.querySelector(".av-chips")) return;
      const rows = usageRows(lg, p).slice(0, lg === "nfl" ? 3 : 2);
      if (!rows.length) return;
      const short = { "Target share": "Tgt", "Carry share": "Car", "Snap share": "Snap", "Red-zone touches / game": "RZ/g", Minutes: "Min", "Usage rate": "USG" };
      const h = c.querySelector(".pp-h");
      h && h.insertAdjacentHTML("afterend", `<div class="av-chips" title="${recentLbl(lg)} vs season">${rows.map(([l, s, r, t]) => `<span>${esc(short[l] || l)} <b>${esc(r)}</b>${arrow(t)}<small>${esc(s)}</small></span>`).join("")}</div>`);
    });
  }

  window.LSAdv = { ADV_LGS, PLAYER_LGS, load, booksExtra, valueSpots, gameSlot, mountGame, teamSlot, mountTeam, playerSlot, mountPlayer, decorateProps };
})();
