/* Box score for a finished game. Browser: window.BoxCore. Node: require("./box-core.js").
   compact() reads an ESPN summary the same way scripts/boxscore.py does, so a game
   file and a live fetch render through one html() function. UFC has no box score. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BoxCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const COLS = {
    basketball: ["MIN", "PTS", "FG", "3PT", "FT", "REB", "AST", "STL", "BLK", "TO", "PF", "+/-"],
    "hockey:forwards": ["G", "A", "SOG", "+/-", "TOI", "HT", "BS", "PIM"],
    "hockey:defenses": ["G", "A", "SOG", "+/-", "TOI", "HT", "BS", "PIM"],
    "hockey:skaters": ["G", "A", "SOG", "+/-", "TOI", "HT", "BS", "PIM"],
    "hockey:goalies": ["SA", "GA", "SV", "SV%", "TOI"],
    "baseball:batting": ["AB", "R", "H", "RBI", "HR", "BB", "K", "AVG"],
    "baseball:pitching": ["IP", "H", "R", "ER", "BB", "K", "HR", "PC-ST", "ERA"],
    soccer: ["G", "A", "SH", "ST", "FC", "FA", "OF", "YC", "RC"],
  };
  const FB_KEEP = new Set(["passing", "rushing", "receiving", "defensive", "interceptions", "kicking", "punting"]);
  const CAP = { passing: 4, rushing: 8, receiving: 10, defensive: 15, interceptions: 8, kicking: 3, punting: 3, forwards: 14, defenses: 8, skaters: 18, goalies: 3, batting: 14, pitching: 8 };
  const KIND_CAP = { football: 12, basketball: 15, hockey: 18, baseball: 14, soccer: 18 };
  const TITLES = { passing: "Passing", rushing: "Rushing", receiving: "Receiving", defensive: "Defense", interceptions: "Interceptions", kicking: "Kicking", punting: "Punting", forwards: "Forwards", defenses: "Defense", skaters: "Skaters", goalies: "Goalies", batting: "Batting", pitching: "Pitching" };
  const TEAM_NAMES = {
    football: ["firstDowns", "thirdDownEff", "fourthDownEff", "totalYards", "netPassingYards", "rushingYards", "sacksYardsLost", "interceptions", "redZoneAttempts", "totalPenaltiesYards", "turnovers", "possessionTime"],
    basketball: ["fieldGoalsMade-fieldGoalsAttempted", "fieldGoalPct", "threePointFieldGoalsMade-threePointFieldGoalsAttempted", "freeThrowsMade-freeThrowsAttempted", "totalRebounds", "offensiveRebounds", "assists", "steals", "blocks", "turnovers", "fouls", "points"],
    hockey: ["shots", "shotsOnGoal", "powerPlayGoals-powerPlayOpportunities", "powerPlayPct", "faceoffPercent", "hits", "blockedShots", "takeaways", "giveaways", "penaltyMinutes"],
  };
  const MLB_TEAM = {
    batting: [["R", "Runs"], ["H", "Hits"], ["HR", "Home runs"], ["RBI", "RBI"], ["BB", "Walks"], ["SO", "Strikeouts"], ["LOB", "Left on base"], ["AVG", "Batting avg"]],
    pitching: [["K", "Pitcher strikeouts"], ["BB", "Walks allowed"], ["ER", "Earned runs"], ["P", "Pitches"]],
    fielding: [["E", "Errors"]],
  };
  const REG = { football: 4, basketball: 4, hockey: 3, soccer: 2, baseball: 9 };

  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function colIdx(kind, name, labels) {
    const want = COLS[`${kind}:${name}`] || COLS[kind];
    if (want) {
      const idx = want.map(l => labels.indexOf(l)).filter(i => i >= 0);
      if (idx.length) return idx;
    }
    return labels.slice(0, 8).map((_, i) => i);
  }
  const capOf = (kind, name) => CAP[name] || KIND_CAP[kind] || 12;

  function teamStats(kind, block) {
    const flat = [];
    for (const s of (block && block.statistics) || []) {
      if (!s) continue;
      if (Array.isArray(s.stats)) {
        for (const [ab, label] of MLB_TEAM[s.name] || []) {
          const x = s.stats.find(y => y && y.abbreviation === ab);
          if (x && x.displayValue != null && x.displayValue !== "") flat.push([ab, label, String(x.displayValue)]);
        }
      } else if (s.displayValue != null && s.displayValue !== "") {
        flat.push([s.name || "", s.label || s.abbreviation || s.name || "", String(s.displayValue)]);
      }
    }
    const keep = TEAM_NAMES[kind];
    if (keep) {
      const by = new Map(flat.map(([n, lab, val]) => [n, [lab, val]]));
      const picked = keep.filter(n => by.has(n)).map(n => ({ label: by.get(n)[0], value: by.get(n)[1] }));
      if (picked.length) return picked;
    }
    const seen = new Set(), out = [];
    for (const [, lab, val] of flat) {
      if (!lab || seen.has(lab)) continue;
      seen.add(lab);
      out.push({ label: lab, value: val });
      if (out.length >= 12) break;
    }
    return out;
  }

  function playerGroups(kind, block) {
    const groups = [];
    for (const s of (block && block.statistics) || []) {
      if (!s) continue;
      const name = s.name || s.type || "";
      if (kind === "football" && !FB_KEEP.has(name)) continue;
      const athletes = (s.athletes || []).filter(a => a && !a.didNotPlay && a.athlete && (a.stats || []).length && (a.athlete.shortName || a.athlete.displayName));
      if (!athletes.length) continue;
      const labels = (s.labels || []).map(String);
      const idx = colIdx(kind, name, labels);
      if (!idx.length) continue;
      const lim = capOf(kind, name);
      groups.push({
        name,
        title: TITLES[name] || s.text || (kind === "basketball" || kind === "soccer" ? "Players" : name || "Players"),
        labels: idx.map(i => labels[i]),
        rows: athletes.slice(0, lim).map(a => ({
          name: a.athlete.shortName || a.athlete.displayName || "",
          id: a.athlete.id != null ? String(a.athlete.id) : "",
          stats: idx.map(i => (a.stats[i] == null ? "" : String(a.stats[i]))),
        })),
        more: Math.max(0, athletes.length - lim),
        totals: (s.totals || []).length ? idx.map(i => (s.totals[i] == null ? "" : String(s.totals[i]))) : [],
      });
    }
    return groups;
  }

  function linesOf(comp) {
    return (comp.linescores || []).map(x => (x && typeof x === "object" ? (x.displayValue != null ? x.displayValue : x.value) : x)).map(v => (v == null ? "" : String(v)));
  }

  function side(kind, comp, teamBlock, playerBlock) {
    const t = (comp && comp.team) || {};
    const tid = String((comp && (comp.id || (comp.team || {}).id)) || ((teamBlock || {}).team || {}).id || ((playerBlock || {}).team || {}).id || "");
    return { id: tid, abbr: t.abbreviation || ((teamBlock || {}).team || {}).abbreviation || "", lines: linesOf(comp || {}), stats: teamStats(kind, teamBlock), players: playerGroups(kind, playerBlock) };
  }

  function compact(kind, summary) {
    if (!kind || kind === "mma" || !summary || typeof summary !== "object") return null;
    const box = summary.boxscore || {};
    const header = (((summary.header || {}).competitions || [])[0]) || {};
    const comps = {};
    for (const c of header.competitors || []) if (c && c.homeAway) comps[c.homeAway] = c;
    const byId = (list) => {
      const m = {};
      for (const t of list || []) {
        const id = String(((t || {}).team || {}).id || "");
        if (id) m[id] = t;
      }
      return m;
    };
    const teams = byId(box.teams), players = byId(box.players);
    if (!Object.keys(teams).length && !Object.keys(players).length) return null;
    const block = ha => {
      const comp = comps[ha] || {};
      const tid = String(comp.id || (comp.team || {}).id || "");
      return side(kind, comp, teams[tid], players[tid]);
    };
    const away = block("away"), home = block("home");
    if (!(away.stats.length || away.players.length || home.stats.length || home.players.length)) return null;
    return { periods: Math.max(away.lines.length, home.lines.length), away, home };
  }

  function hasBox(box) {
    if (!box) return false;
    const ok = s => s && ((s.players && s.players.length) || (s.stats && s.stats.length));
    return ok(box.away) || ok(box.home);
  }

  /** Game JSON exists only for ids in the league index `games` list. Week-only rows and old links do not have a file. */
  function hasFile(index, id) {
    const want = String(id == null ? "" : id);
    if (!want) return false;
    const games = index && index.games;
    if (!Array.isArray(games)) return false;
    return games.some(g => g && String(g.id) === want);
  }

  function periodLabel(kind, i, reg) {
    if (i < reg || kind === "baseball") return String(i + 1);
    if (kind === "soccer") return i === 2 ? "ET" : "PK";
    return i === reg ? "OT" : `${i - reg + 1}OT`;
  }

  /** Team + player tables. A and H are {id, abbr, name, logo}. lg is the league key for player links. */
  function html(box, A, H, kind, lg) {
    if (!hasBox(box)) return `<div class="card note" data-box="empty">No box score for this game.</div>`;
    const reg = lg === "ncaab" ? 2 : (REG[kind] || 4);
    const la = (box.away && box.away.lines) || [], lh = (box.home && box.home.lines) || [];
    const n = Math.max(box.periods || 0, la.length, lh.length);
    const cell = (arr, i) => `<td class="num">${esc(arr[i] ?? "")}</td>`;
    const lrow = (T, arr) => `<tr><td>${esc((T && T.abbr) || "")}</td>${Array.from({ length: n }, (_, i) => cell(arr, i)).join("")}<td class="num tot">${esc((T && T.score) ?? "")}</td></tr>`;
    const lineScore = n ? `<div class="bx-scroll"><table class="bx-lines"><thead><tr><th></th>${Array.from({ length: n }, (_, i) => `<th>${periodLabel(kind, i, reg)}</th>`).join("")}<th>T</th></tr></thead><tbody>${lrow(A, la)}${lrow(H, lh)}</tbody></table></div>` : "";
    const sa = (box.away && box.away.stats) || [], sh = (box.home && box.home.stats) || [];
    const labels = [];
    for (const r of sa.concat(sh)) if (r && r.label && !labels.includes(r.label)) labels.push(r.label);
    const val = (arr, l) => { const x = arr.find(r => r.label === l); return x ? x.value : ""; };
    const teamTable = labels.length ? `<table class="bx-team"><thead><tr><th>Team stats</th><th>${esc((A && A.abbr) || "Away")}</th><th>${esc((H && H.abbr) || "Home")}</th></tr></thead><tbody>${labels.map(l => `<tr><td>${esc(l)}</td><td class="num">${esc(val(sa, l))}</td><td class="num">${esc(val(sh, l))}</td></tr>`).join("")}</tbody></table>` : "";
    const grp = gp => `<div class="bx-g"><h4>${esc(gp.title)}</h4><div class="bx-scroll"><table class="bx-players"><thead><tr><th>Player</th>${gp.labels.map(l => `<th>${esc(l)}</th>`).join("")}</tr></thead><tbody>${gp.rows.map(r => `<tr><td>${r.id ? `<a class="lnk" href="#/p/${esc(lg)}/${esc(r.id)}">${esc(r.name)}</a>` : esc(r.name)}</td>${r.stats.map(x => `<td class="num">${esc(x)}</td>`).join("")}</tr>`).join("")}${gp.totals && gp.totals.length ? `<tr class="tot"><td>Team</td>${gp.totals.map(x => `<td class="num">${esc(x)}</td>`).join("")}</tr>` : ""}</tbody></table></div>${gp.more ? `<div class="note">+${gp.more} more</div>` : ""}</div>`;
    const panel = (key, sideBox, hidden) => {
      const players = (sideBox && sideBox.players) || [];
      if (!players.length) return "";
      return `<div class="bx-panel" data-bx-panel="${key}"${hidden ? " hidden" : ""}>${players.map(grp).join("")}</div>`;
    };
    const pa = panel("away", box.away, false), ph = panel("home", box.home, !!pa);
    const toggle = pa && ph ? `<div class="bx-tog" role="group" aria-label="Team"><button type="button" data-bx-team="away" class="on" aria-pressed="true">${esc((A && (A.short || A.abbr || A.name)) || "Away")}</button><button type="button" data-bx-team="home" aria-pressed="false">${esc((H && (H.short || H.abbr || H.name)) || "Home")}</button></div>` : "";
    return `<div class="bx" data-box="1">${lineScore ? `<div class="card bx-lines-card">${lineScore}</div>` : ""}${teamTable ? `<div class="card bx-team-card">${teamTable}</div>` : ""}<div class="card bx-players-card">${toggle}${pa}${ph}</div><div class="note">Final stats from ESPN. Swipe a table sideways for the rest of the columns. The player name stays put.</div></div>`;
  }

  return { compact, hasBox, hasFile, html, esc };
});
