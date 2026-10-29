window.__PRO_BUILD="4a988187be-2026-10-29T10:06:01Z";
/* Hot props for LineSmart Pro. Pure logic: no DOM, no network.
   Input is data/props/<lg>.json (the shape scripts/props.py writes) plus props-core.js.
   Browser: window.HotProps. Node: require("./hot-props-core.js"). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("../site/assets/props-core.js"));
  else root.HotProps = factory(root.PropsCore);
})(typeof self !== "undefined" ? self : this, function (P) {
  "use strict";
  const KEY = "ls-pro-hot-v1";
  const SPORT_FIRST = ["nfl", "nba", "nhl", "mlb", "ncaaf", "ncaab"];
  const SPORT_LABEL = { nfl: "NFL", nba: "NBA", nhl: "NHL", mlb: "MLB", ncaaf: "NCAAF", ncaab: "NCAAB" };
  const isNum = v => typeof v === "number" && isFinite(v);

  /** Implied probability of an American price, or null when it isn't a real price. */
  function implied(a) {
    if (!isNum(a) || Math.abs(a) < 100) return null;
    return a > 0 ? 100 / (a + 100) : -a / (-a + 100);
  }

  /** Leagues that have a props file: NFL, NBA, NHL, MLB, NCAAF, NCAAB first, then any other file. */
  function sportList(docs) {
    const have = Object.keys(docs || {}).filter(k => docs[k] && docs[k].games && Object.keys(docs[k].games).length);
    const named = SPORT_FIRST.filter(k => have.includes(k));
    const rest = have.filter(k => !SPORT_FIRST.includes(k)).sort();
    return [...named, ...rest];
  }

  /** One flat row per prop. `open` is the file's opening line (often null). `books` come from props-core. */
  function collect(docs) {
    const rows = [];
    for (const [lg, doc] of Object.entries(docs || {})) {
      if (!doc || !doc.games) continue;
      const markets = doc.markets || {}, players = doc.players || {};
      for (const [gid, g] of Object.entries(doc.games)) {
        for (const row of g.props || []) {
          const [pid, mk, line, open] = row;
          const pl = players[pid];
          if (!pl || !isNum(line)) continue;
          rows.push({
            lg, gid: String(gid), pid: String(pid),
            name: pl.n || "Player", pos: pl.pos || "", team: pl.ta || "", teamId: String(pl.t || ""),
            mk, label: (markets[mk] || [mk])[0],
            line, open: isNum(open) ? open : null,
            books: P.rowBooks(row), log: pl.log || [],
          });
        }
      }
    }
    return rows;
  }

  function applyFilters(rows, f = {}) {
    const lg = f.lg && f.lg !== "all" ? f.lg : "";
    const team = String(f.team || "").trim().toLowerCase();
    const player = String(f.player || "").trim().toLowerCase();
    const mk = f.mk && f.mk !== "all" ? f.mk : "";
    return rows.filter(r => {
      if (lg && r.lg !== lg) return false;
      if (team && r.team.toLowerCase() !== team && String(r.teamId) !== String(f.team).trim()) return false;
      if (player && String(r.pid).toLowerCase() !== player && !r.name.toLowerCase().includes(player)) return false;
      if (mk && r.mk !== mk) return false;
      return true;
    });
  }

  /** Widest implied-probability gap between two books that posted the same line and a price. Different lines are not a price gap. */
  function gapOf(books) {
    const groups = new Map();
    for (const b of books || []) {
      if (!b || !isNum(b.line)) continue;
      const k = String(b.line);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(b);
    }
    let best = null;
    for (const [line, list] of groups) {
      for (const side of ["over", "under"]) {
        const priced = [];
        for (const b of list) {
          const p = implied(b[side]);
          if (p == null) continue;
          priced.push({ key: b.key, line: b.line, price: b[side], p, side });
        }
        if (priced.length < 2) continue;
        const ps = priced.map(x => x.p);
        const gap = Math.max(...ps) - Math.min(...ps);
        if (gap < 1e-9) continue;
        if (!best || gap > best.gap) best = { line: Number(line), side, gap, quotes: priced };
      }
    }
    return best;
  }

  /** True when any row has a real over or under price. No prices means the gap section stays hidden. */
  function hasPrices(rows) {
    return (rows || []).some(r => (r.books || []).some(b => implied(b && b.over) != null || implied(b && b.under) != null));
  }

  function priceGaps(rows) {
    const out = [];
    for (const r of rows) {
      const g = gapOf(r.books);
      if (g) out.push({ ...r, ...g });
    }
    out.sort((a, b) => b.gap - a.gap || a.name.localeCompare(b.name) || a.mk.localeCompare(b.mk));
    return out;
  }

  const hasOpen = rows => rows.some(r => isNum(r.open));

  /** Opening line to current line. Empty when the file stored no opening line. */
  function lineMoves(rows) {
    const out = [];
    for (const r of rows) {
      if (!isNum(r.open) || r.open === r.line) continue;
      out.push({ ...r, delta: r.line - r.open, abs: Math.abs(r.line - r.open), text: P.moveText(r.line, r.open) });
    }
    out.sort((a, b) => b.abs - a.abs || a.name.localeCompare(b.name) || a.mk.localeCompare(b.mk));
    return out;
  }

  function hasLog(rows) {
    return rows.some(r => (r.log || []).some(g => g && g[3] && typeof g[3] === "object"));
  }

  /** Line the streak is graded on: the first preferred book that posted it, else the row line. */
  function gradedLine(row, prefer) {
    for (const k of prefer || []) {
      const b = (row.books || []).find(x => x.key === k);
      if (b && isNum(b.line)) return { line: b.line, book: k };
    }
    return { line: row.line, book: null };
  }

  /** Players the props page would call hot. `available` is false when no game log is in the rows. */
  function hotStreaks(rows, prefer) {
    if (!hasLog(rows)) return { available: false, rows: [] };
    const out = [];
    for (const r of rows) {
      const g = gradedLine(r, prefer);
      if (!P.isHot(r.log, r.mk, g.line)) continue;
      const sm = P.summary(r.log, r.mk, g.line, 5);
      out.push({ ...r, gradedLine: g.line, gradedBook: g.book, text: sm.text, pct: sm.pct, overs: sm.o, played: sm.n });
    }
    out.sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1) || b.overs - a.overs || a.name.localeCompare(b.name));
    return { available: true, rows: out };
  }

  function validSaved(x) {
    return !!x && typeof x.id === "string" && x.id.length > 0 && x.id.length <= 40
      && typeof x.name === "string" && x.name.trim().length > 0 && x.name.trim().length <= 40
      && typeof x.lg === "string";
  }
  function readSaved(store) {
    if (!store || !store.getItem) return [];
    let raw;
    try { raw = JSON.parse(store.getItem(KEY) || "[]"); } catch (e) { return []; }
    if (!Array.isArray(raw)) return [];
    return raw.filter(validSaved).slice(0, 12);
  }
  function addSaved(store, entry) {
    const name = String(entry && entry.name || "").trim();
    if (!name) return { ok: false, error: "Name this filter." };
    if (name.length > 40) return { ok: false, error: "Use 40 characters or fewer." };
    const row = {
      id: String(entry.id || Date.now()),
      name,
      lg: String(entry.lg || "nfl"),
      team: String(entry.team || ""),
      player: String(entry.player || ""),
      mk: String(entry.mk || "all"),
    };
    if (!validSaved(row)) return { ok: false, error: "That filter couldn't be saved." };
    const list = readSaved(store).filter(x => x.id !== row.id);
    if (list.length >= 12) return { ok: false, error: "Delete a saved filter first (12 is the limit)." };
    list.push(row);
    store.setItem(KEY, JSON.stringify(list));
    return { ok: true, list, row };
  }
  function removeSaved(store, id) {
    const list = readSaved(store).filter(x => x.id !== id);
    store.setItem(KEY, JSON.stringify(list));
    return list;
  }

  return {
    KEY, SPORT_FIRST, SPORT_LABEL, implied, sportList, collect, applyFilters, gapOf, hasPrices, priceGaps,
    hasOpen, lineMoves, hasLog, gradedLine, hotStreaks, readSaved, addSaved, removeSaved,
  };
});

/* Pro feature decisions that don't touch the network: sharp moves, filters, books we
   actually have, refresh age, closing-line value, and local bet tags.
   Browser: window.ProFeatures. Node: require("./pro-features.js"). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ProFeatures = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const ACTIVE_FREE = 10;
  const ACTIVE_PRO = 25;
  const EMAIL_FREE = 5;          // unchanged daily email cap; a higher cap is not available
  const BOOK_KEYS = ["hardrockbet", "draftkings", "fanduel"];
  const BOOK_NAME = { hardrockbet: "Hard Rock Bet", draftkings: "DraftKings", fanduel: "FanDuel" };
  const COMING_BOOKS = ["BetMGM", "Caesars", "Fanatics", "bet365", "BetRivers"];
  const TAG_KEY = "ls-pro-tags-v1";
  const isNum = v => typeof v === "number" && isFinite(v);

  /** Upcoming games whose saved line movement already carries a sharp-move note. */
  function sharpMoves(byLg, now) {
    const out = [];
    for (const [lg, games] of Object.entries(byLg || {})) {
      for (const g of games || []) {
        const notes = (g.move && g.move.notable) || [];
        if (!notes.length || g.state !== "pre" || !(Date.parse(g.date) > now)) continue;
        out.push({
          lg, id: String(g.id), notes: notes.slice(),
          spread: g.move.spread || null, total: g.move.total || null, book: g.move.book || "",
        });
      }
    }
    out.sort((a, b) => Math.abs((b.spread && b.spread.delta) || 0) - Math.abs((a.spread && a.spread.delta) || 0) || a.lg.localeCompare(b.lg) || a.id.localeCompare(b.id));
    return out;
  }

  /** Custom filter over rows that already exist. `edge` is a fraction; `min` is in percentage points. */
  function filterBoard(rows, f) {
    const lg = f && f.lg && f.lg !== "all" ? f.lg : "";
    const mk = f && f.mk && f.mk !== "all" ? f.mk : "";
    const q = String((f && f.q) || "").trim().toLowerCase();
    const min = f && isNum(Number(f.min)) ? Number(f.min) : 0;
    return (rows || []).filter(r => {
      if (lg && r.lg !== lg) return false;
      if (mk && r.mk !== mk) return false;
      if (q && !`${r.label || ""} ${r.matchup || ""} ${r.player || ""} ${r.market || ""}`.toLowerCase().includes(q)) return false;
      if (isNum(r.edge) && r.edge * 100 < min - 1e-9) return false;
      return true;
    });
  }

  /** Book keys that posted at least one number on this game. Absent books are not invented. */
  function bookColumns(g) {
    const books = (g && g.books) || {};
    return BOOK_KEYS.filter(k => {
      const b = books[k];
      return !!b && typeof b === "object" && Object.keys(b).some(field => b[field] != null && b[field] !== "");
    });
  }

  /** File age and today's cadence. fasterMin stays null until a faster pull exists. */
  function refreshInfo(generated, now) {
    const t = Date.parse(generated || "");
    return { ageHours: isFinite(t) ? (now - t) / 36e5 : null, cadenceMin: 30, fasterMin: null };
  }

  /** Points between a bet line and a closing line. Unavailable when the close isn't a number. */
  function clvPoints(bet, closeLine) {
    if (!bet || !isNum(closeLine) || !isNum(bet.line)) return { available: false };
    if (bet.type !== "spread" && bet.type !== "total") return { available: false };
    return { available: true, delta: closeLine - bet.line };
  }

  function readTags(store) {
    if (!store || !store.getItem) return {};
    let raw;
    try { raw = JSON.parse(store.getItem(TAG_KEY) || "{}"); } catch (e) { return {}; }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out = {};
    for (const [id, tags] of Object.entries(raw)) {
      if (!Array.isArray(tags)) continue;
      const clean = [...new Set(tags.map(t => String(t).trim().toLowerCase()).filter(t => t && t.length <= 24))].slice(0, 6);
      if (clean.length) out[String(id)] = clean;
    }
    return out;
  }
  function setTag(store, id, tag, on) {
    const name = String(tag || "").trim().toLowerCase();
    if (!id) return { ok: false, error: "Pick a bet." };
    if (!name || name.length > 24) return { ok: false, error: "Use a short tag." };
    const all = readTags(store);
    const cur = new Set(all[id] || []);
    if (on) {
      if (cur.size >= 6 && !cur.has(name)) return { ok: false, error: "Six tags is the limit on one bet." };
      cur.add(name);
    } else cur.delete(name);
    if (cur.size) all[id] = [...cur];
    else delete all[id];
    store.setItem(TAG_KEY, JSON.stringify(all));
    return { ok: true, tags: all[id] || [] };
  }

  /** Open and recorded points for each book in a game history file. Missing markets stay null. */
  function historyMarkets(history) {
    const books = history && history.books;
    if (!books || typeof books !== "object") return [];
    const openAll = history.open && typeof history.open === "object" ? history.open : {};
    const out = [];
    for (const book of Object.keys(books)) {
      const pts = Array.isArray(books[book]) ? books[book] : [];
      const keyed = openAll[book];
      const op = keyed && typeof keyed === "object" && (isNum(keyed.hs) || isNum(keyed.tot) || isNum(keyed.hml) || isNum(keyed.aml))
        ? keyed
        : (isNum(openAll.hs) || isNum(openAll.tot) || isNum(openAll.hml) ? openAll : {});
      const series = key => {
        const vals = [];
        for (const p of pts) if (p && p[1] && isNum(p[1][key])) vals.push(p[1][key]);
        const open = isNum(op[key]) ? op[key] : null;
        if (open == null && !vals.length) return null;
        const points = [];
        if (open != null) points.push(open);
        for (const v of vals) points.push(v);
        return { open: open != null ? open : vals[0], current: vals.length ? vals[vals.length - 1] : open, points };
      };
      out.push({ book, spread: series("hs"), total: series("tot"), awayML: series("aml"), homeML: series("hml") });
    }
    return out;
  }

  /** Eastern calendar day (YYYY-MM-DD) for a timestamp or ISO string. */
  function etDay(v) {
    const t = typeof v === "number" ? v : Date.parse(v || "");
    if (!isFinite(t)) return "";
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
    } catch (e) { return ""; }
  }

  /** Spread and total moves already stored on the slate. One row per market that moved.
      Today's games when any of them moved; otherwise upcoming games in the file. Moneyline
      swings stay out so a cent move is not ranked against a point move. */
  function lineMoveBoard(byLg, now) {
    const today = etDay(now);
    const rows = [];
    for (const [lg, games] of Object.entries(byLg || {})) {
      for (const g of games || []) {
        const mv = g && g.move;
        if (!mv) continue;
        const markets = [];
        if (mv.spread && isNum(mv.spread.delta) && Math.abs(mv.spread.delta) > 1e-9) markets.push(["spread", mv.spread]);
        if (mv.total && isNum(mv.total.delta) && Math.abs(mv.total.delta) > 1e-9) markets.push(["total", mv.total]);
        if (!markets.length) continue;
        const day = etDay(g.date);
        for (const [market, m] of markets) {
          rows.push({
            lg, id: String(g.id),
            away: (g.away && g.away.abbr) || "",
            home: (g.home && g.home.abbr) || "",
            market, open: isNum(m.open) ? m.open : null, cur: isNum(m.cur) ? m.cur : null,
            delta: m.delta, size: Math.abs(m.delta),
            book: mv.book || "",
            sharp: !!(mv.notable && mv.notable.length),
            state: g.state || "",
            today: !!today && day === today,
          });
        }
      }
    }
    rows.sort((a, b) => b.size - a.size || a.lg.localeCompare(b.lg) || a.id.localeCompare(b.id) || a.market.localeCompare(b.market));
    const todays = rows.filter(r => r.today);
    if (todays.length) return { scope: "today", rows: todays };
    const upcoming = rows.filter(r => r.state === "pre");
    return { scope: "file", rows: upcoming.length ? upcoming : rows };
  }

  /** Higher score is the more favorable number for that side. Same rule as the public books table. */
  function quoteScore(kind, line, price) {
    const px = isNum(price) ? price : -110;
    if (kind === "ml") return line;
    if (kind === "over") return -line * 1000 + px;
    return line * 1000 + px;
  }

  /** Best posted number on each market. Hidden by the caller when fewer than two books priced it. */
  function bestPrices(g) {
    const cols = bookColumns(g);
    if (!g || cols.length < 2) return { available: false, rows: [] };
    const away = (g.away && g.away.abbr) || "Away";
    const home = (g.home && g.home.abbr) || "Home";
    const specs = [
      ["awaySpread", away + " spread", "spread", o => (isNum(o.awaySpread) ? [o.awaySpread, o.awaySpreadOdds] : null)],
      ["homeSpread", home + " spread", "spread", o => (isNum(o.homeSpread) ? [o.homeSpread, o.homeSpreadOdds] : null)],
      ["awayML", away + " ML", "ml", o => (isNum(o.awayML) ? [o.awayML, o.awayML] : null)],
      ["homeML", home + " ML", "ml", o => (isNum(o.homeML) ? [o.homeML, o.homeML] : null)],
      ["over", "Over", "over", o => (isNum(o.total) ? [o.total, o.overOdds] : null)],
      ["under", "Under", "under", o => (isNum(o.total) ? [o.total, o.underOdds] : null)],
    ];
    const rows = [];
    for (const [id, label, kind, read] of specs) {
      const quotes = [];
      for (const book of cols) {
        const got = read((g.books && g.books[book]) || {});
        if (!got) continue;
        const [line, price] = got;
        quotes.push({ book, line, price: isNum(price) ? price : null, score: quoteScore(kind, line, price) });
      }
      if (quotes.length < 2) continue;
      const bestScore = Math.max(...quotes.map(q => q.score));
      rows.push({ id, label, kind, quotes, best: quotes.filter(q => Math.abs(q.score - bestScore) < 1e-9).map(q => q.book) });
    }
    return { available: rows.length > 0, rows };
  }

  function betSide(bet) {
    const direct = bet && (bet.side || (bet.sel && bet.sel.side));
    if (direct) return String(direct);
    const s = String((bet && bet.selection) || "");
    if (/\bover\b/i.test(s)) return "over";
    if (/\bunder\b/i.test(s)) return "under";
    return "";
  }

  /** True when the bet's number is better than the close. Null when that can't be told. */
  function beatsClose(bet) {
    const c = clvPoints(bet, bet && bet.closeLine);
    if (!c.available) return null;
    const side = betSide(bet);
    if (bet.type === "total") {
      if (side === "over") return bet.line < bet.closeLine - 1e-9;
      if (side === "under") return bet.line > bet.closeLine + 1e-9;
      return null;
    }
    if (bet.type === "spread") return bet.line > bet.closeLine + 1e-9;
    return null;
  }

  /** Closing-line rows for bets that actually have a close. No number is invented. */
  function clvSummary(bets) {
    const rows = [];
    for (const b of bets || []) {
      const c = clvPoints(b, b && b.closeLine);
      if (!c.available) continue;
      rows.push({ id: String(b.id || ""), delta: c.delta, beat: beatsClose(b) });
    }
    if (!rows.length) return { available: false, n: 0, mean: null, beats: 0, judged: 0, beatRate: null, rows: [] };
    const mean = rows.reduce((s, r) => s + r.delta, 0) / rows.length;
    const judgedRows = rows.filter(r => r.beat === true || r.beat === false);
    const beats = judgedRows.filter(r => r.beat).length;
    return {
      available: true, n: rows.length, mean, beats, judged: judgedRows.length,
      beatRate: judgedRows.length ? beats / judgedRows.length : null, rows,
    };
  }

  /** Bets grouped by tag. A bet with no tag is "untagged". */
  function tagGroups(bets, tags) {
    const g = new Map();
    const add = (k, b) => { if (!g.has(k)) g.set(k, []); g.get(k).push(b); };
    for (const b of bets || []) {
      const mine = b && tags && tags[b.id];
      if (mine && mine.length) for (const t of mine) add(t, b);
      else add("untagged", b);
    }
    return [...g.entries()].map(([tag, list]) => ({ tag, bets: list }));
  }

  return {
    ACTIVE_FREE, ACTIVE_PRO, EMAIL_FREE, BOOK_KEYS, BOOK_NAME, COMING_BOOKS, TAG_KEY,
    sharpMoves, filterBoard, bookColumns, refreshInfo, clvPoints, clvSummary, beatsClose, tagGroups, historyMarkets, readTags, setTag,
    etDay, lineMoveBoard, bestPrices,
  };
});

window.__PRO_CSS = "/* Injected with the private Pro bundle. Not shipped in site/assets/styles.css. */\n.ppv-banner{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 14px;margin:16px 0 4px;padding:12px 16px;border-radius:var(--r-sm);border:1px solid color-mix(in srgb,var(--accent) 40%,transparent);background:color-mix(in srgb,var(--accent) 12%,var(--surface));font-size:14.5px;line-height:1.4}\n.ppv-build{margin:0 0 12px;font-size:12px;line-height:1.4;color:var(--dim)}\n.ppv-banner b{font-weight:800;letter-spacing:.01em}\n.ppv-back{display:inline-block;margin-bottom:4px;color:var(--accent);font-size:13px;font-weight:650}\n.ppv-nav{margin:0 0 16px}\n.ppv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;margin-bottom:14px}\n.ppv-card{display:flex;flex-direction:column;align-items:flex-start;gap:8px;min-height:148px;padding:16px;border:1px solid var(--line);border-radius:var(--r);background:var(--surface);box-shadow:var(--shadow)}\n.ppv-card:hover{border-color:var(--accent-line)}\n.ppv-card b{font-size:15.5px;line-height:1.35;letter-spacing:-.01em}\n.ppv-card span{color:var(--mute);font-size:13.5px;line-height:1.45}\n.ppv-go{margin-top:auto;color:var(--accent);font-weight:700}\n.ppv-h{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 12px;font-size:16px}\n.ppv-h .st-sub{font-weight:500}\n.ppv-soon{display:inline-flex;align-items:center;margin-left:6px;padding:1px 7px;border-radius:999px;border:1px solid var(--line2);color:var(--mute);font-size:11px;font-weight:750;letter-spacing:.02em;vertical-align:middle}\n.ppv-frow{display:flex;flex-wrap:wrap;align-items:flex-end;gap:10px;margin-top:10px}\n.ppv-q{display:flex;gap:8px;align-items:flex-end}\n.ppv-q input,.ppv-form input,.ppv-form select,.ppv-books select{font:500 14px var(--font);color:var(--txt);background:var(--bg2);border:1px solid var(--line2);border-radius:var(--r-sm);min-height:40px;padding:0 10px}\n.ppv-list{display:flex;flex-direction:column;gap:8px}\n.ppv-line{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--bg2)}\n.ppv-line.on{border-color:var(--accent-line);background:var(--accent-soft)}\n.ppv-line b{display:block;font-weight:750}\n.ppv-line small{display:block;color:var(--dim);font-size:12.5px}\n.ppv-line .num{text-align:right;font-variant-numeric:tabular-nums}\n.ppv-cap-row{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:baseline}\n.ppv-cap-row b{font-size:22px;letter-spacing:-.02em}\n.ppv-meter{height:8px;margin:10px 0 4px;border-radius:99px;background:var(--bg2);border:1px solid var(--line);overflow:hidden}\n.ppv-meter i{display:block;height:100%;background:linear-gradient(90deg,var(--accent),var(--accent2))}\n.ppv-form{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end}\n.ppv-ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}\n.ppv-ul li{display:flex;flex-direction:column;gap:2px;padding-bottom:10px;border-bottom:1px solid var(--line);font-size:14px}\n.ppv-ul li:last-child{border-bottom:0;padding-bottom:0}\n.ppv-ul span{color:var(--mute)}\n.ppv-tags{margin:14px 0}\n.ppv-bets .chip{margin:2px 4px 2px 0}\n.ppv .card{margin-top:14px}\n.ppv .statgrid{margin:0 0 4px}\n.chip.ppv-off{opacity:.72}\n.ppv-saved{margin-top:8px}\n.ppv-saved-chip{gap:4px;padding-right:6px}\n.ppv-saved-chip a{color:inherit}\n.ppv-x{border:0;background:transparent;color:var(--mute);font:700 16px var(--font);line-height:1;padding:0 4px;cursor:pointer}\n.ppv-x:hover{color:var(--txt)}\nbody.app a.search-btn[data-pro-owner-nav]{display:inline-flex;width:auto;padding:0 12px;margin-left:8px}\n.ppv-inject{margin:8px 0 16px}\n.ppv-panel{margin-top:12px}\n.ppv-panel .ppv-h{gap:8px}\n.ppv-chart{display:block;width:100%;height:auto;margin:4px 0;color:var(--accent)}\n.ppv-chart path{stroke:currentColor;stroke-width:2.5;stroke-linejoin:round}\n.ppv-chart circle{fill:currentColor}\n.ppv-mk{margin:0 0 14px}\n.ppv-mk h4{margin:0 0 4px;font-size:14px}\n.ppv-apply{border:0;background:transparent;color:inherit;font:inherit;padding:0;cursor:pointer}\n.game-top .pro-pill{margin-left:6px}\n.pro-pill{display:inline-flex;align-items:center;padding:2px 7px;border-radius:999px;border:1px solid #a67c00;border-left:3px solid #8a6a12;background:linear-gradient(180deg,#f8e7b0,#e0b84a);color:#1c1404;font:800 9px/1.2 var(--font);letter-spacing:.14em;text-transform:uppercase;flex:none}\n.pro-frame{border-left:3px solid #e0b84a}\n.pro-sharp{display:inline-flex;align-items:center;gap:4px;margin-left:6px;padding:2px 8px 2px 4px;border-radius:999px;background:color-mix(in srgb,#e0b84a 18%,var(--surface))}\n.pro-sharp .pro-pill{margin-left:0}\n.pro-sharp-txt{color:var(--txt);font:750 10px var(--font);letter-spacing:.06em;text-transform:uppercase}\n.pro-empty{margin:8px 0 12px;color:var(--dim);font-size:13px;line-height:1.45}\n.pro-insights{margin:14px 0 16px;border:1px solid color-mix(in srgb,#e0b84a 55%,var(--line));border-left:3px solid #e0b84a;border-radius:var(--r);background:var(--surface);box-shadow:var(--shadow)}\n.pro-insights-sum{display:flex;align-items:center;gap:8px;min-height:44px;padding:10px 14px;cursor:pointer;font-weight:750;list-style:none}\n.pro-insights-sum::-webkit-details-marker{display:none}\n.pro-insights[open]>.pro-insights-sum{border-bottom:1px solid var(--line)}\n.pro-insights-body{padding:4px 12px 12px}\n.pro-insights .ppv-panel{margin:10px 0 0}\n.ppv-book{margin:8px 0 6px;font-size:14px}\n.pro-best{background:color-mix(in srgb,#e0b84a 22%,transparent)}\n.pro-best-tag{display:inline-block;margin-left:4px;padding:1px 4px;border-radius:4px;background:#e0b84a;color:#1c1404;font:800 8px var(--font);letter-spacing:.08em;text-transform:uppercase;vertical-align:1px}\n.pro-sort{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 10px}\n.pro-sort .chip{min-height:36px}\n[data-pro-owner] .card,[data-pro-enhance] .ppv-panel{border-left:3px solid #e0b84a}\n[data-pro-owner] h3.ppv-h:not(:has(.pro-pill))::before{content:\"PRO\";display:inline-flex;align-items:center;margin-right:6px;padding:2px 7px;border-radius:999px;border:1px solid #a67c00;border-left:3px solid #8a6a12;background:linear-gradient(180deg,#f8e7b0,#e0b84a);color:#1c1404;font:800 9px/1.2 var(--font);letter-spacing:.14em}\n.ppv-build{margin-top:18px;font-size:11px}\n@media (max-width:720px){\n  .ppv-grid{grid-template-columns:1fr}\n  .ppv-line{align-items:flex-start}\n  .ppv-q,.ppv-form{width:100%}\n  .ppv-q input,.ppv-form input,.ppv-form select{font-size:16px}\n  .pro-insights-sum{padding:10px 12px}\n  .pro-insights-body{padding:4px 8px 10px}\n  .ppv-panel{padding:12px}\n  .pro-moves,.ppv-panel .books,.pro-insights .books{font-size:12.5px}\n  .pro-moves th,.pro-moves td{padding:6px 5px}\n  .pro-sharp-txt{font-size:9px}\n}\n";

/* LineSmart Pro screens. Loaded only after is_pro() is true, from the private bundle.
   Numbers come from the files the site already has. A panel with no numbers is left out. */
(function () {
  "use strict";
  const css = window.__PRO_CSS || "";
  if (css && !document.getElementById("pro-owner-css")) {
    const st = document.createElement("style");
    st.id = "pro-owner-css";
    st.textContent = css;
    document.head.appendChild(st);
  }
  const A = () => window.LSApp;
  const G = () => window.LSGeo;
  const F = () => window.ProFeatures;
  const Hp = () => window.HotProps;
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const isNum = v => typeof v === "number" && isFinite(v);
  const num = v => (v == null || v === "" || !isFinite(Number(v)) ? null : Number(v));
  const sgn = v => (v > 0 ? "+" + v : v === 0 ? "PK" : String(v));
  const am = v => { const n = num(v); return n == null ? "—" : n > 0 ? "+" + n : String(n); };
  const money = (v, sign) => { if (!isFinite(v)) return "—"; const n = Math.abs(v).toFixed(2); return (v < -0.004 ? "−" : sign && v > 0.004 ? "+" : "") + "$" + n; };
  const pct = v => (v == null || !isFinite(v) ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v * 100).toFixed(1) + "%");
  const ePct = e => (isNum(e) ? (e > 0 ? "+" : e < 0 ? "−" : "") + Math.abs(100 * e).toFixed(1) + "%" : "—");
  const cls = v => (v > 0.004 ? "pos" : v < -0.004 ? "neg" : "");
  const PILL = `<span class="pro-pill">PRO</span>`;
  const EMPTY = `<p class="pro-empty">Pro data appears here once lines start moving</p>`;
  const publicGame = (lg, id) => `#/g/${esc(lg)}/${esc(id)}`;
  const PROP_LEAGUES = ["nfl", "nba", "nhl", "mlb", "ncaaf", "ncaab", "ufc", "epl", "mls", "ucl"];
  const SCREEN = { props_ev: "value", alerts_25: "alerts", tracker_pro: "tracker", books_10: "books", line_history: "history", fast_refresh: "refresh" };
  const HINT = {
    props_ev: "Consensus edges and filters on the lines in the file. Prop edges appear only when the file can support them.",
    alerts_25: "Sharp-move flags from saved line movement. A higher daily email limit is not on yet.",
    tracker_pro: "Stats from My Bets on this device, plus tags kept in this browser. Closing-line value needs a closing price.",
    books_10: "Every book that posted a number in the file.",
    line_history: "The same line chart as a game page, and the sharp-move flags already on the slate.",
    fast_refresh: "How old this file is. A faster pull is not running.",
  };

  let keepScroll = false, afterPaint = () => {}, IX = null, PROPS = null, ALERTS = null;

  const parts = () => {
    const raw = location.hash.replace(/^#\/?/, "");
    const [path, qs] = raw.split("?");
    const segs = path.split("/");
    return { screen: segs[1] || "", a: segs[2] || "", b: segs[3] || "", q: new URLSearchParams(qs || "") };
  };
  const href = (screen, extra) => "#/owner" + (screen ? "/" + screen : "") + (extra || "");
  const gameHref = (lg, id) => `${href("history")}/${esc(lg)}/${esc(id)}`;
  function hotState() {
    const q = parts().q;
    return { lg: q.get("lg") || "nfl", team: q.get("team") || "", player: q.get("player") || "", mk: q.get("mk") || "all" };
  }
  function hotHash(patch) {
    const n = { ...hotState(), ...patch };
    const p = new URLSearchParams();
    if (n.lg) p.set("lg", n.lg);
    if (n.team) p.set("team", n.team);
    if (n.player) p.set("player", n.player);
    if (n.mk && n.mk !== "all") p.set("mk", n.mk);
    const s = p.toString();
    return href("hot") + (s ? "?" + s : "");
  }
  function localStore() {
    try { const k = "ls-pro-probe"; localStorage.setItem(k, "1"); localStorage.removeItem(k); return localStorage; }
    catch (e) { return null; }
  }
  function bookBits(key) {
    const g = G();
    if (!g) return { label: "" };
    const label = g.naLabel ? g.naLabel(key) : "";
    return { label: label || "" };
  }
  const bookName = key => `${esc((F().BOOK_NAME)[key] || key)}${bookBits(key).label ? ` <span class="na-st">${esc(bookBits(key).label)}</span>` : ""}`;
  const flNote = () => `<p class="note"><b>Florida:</b> Hard Rock Bet is the only legal online sportsbook there. DraftKings and FanDuel are not available in Florida.</p>`;

  async function indexes() {
    if (IX) return IX;
    const meta = A().meta() || {};
    const order = meta.order || Object.keys(meta.leagues || {});
    const rows = await Promise.all(order.map(async lg => [lg, await A().getJSON(`data/${lg}/index.json`).catch(() => null)]));
    IX = { meta, order, by: Object.fromEntries(rows.filter(([, idx]) => idx && Array.isArray(idx.games))) };
    return IX;
  }
  const gamesOf = idx => (idx && idx.games) || [];
  const future = (idx, now) => gamesOf(idx).filter(g => g.state === "pre" && Date.parse(g.date) > now);

  function banner() {
    return `<div class="ppv-banner" role="status"><b>LineSmart Pro</b><span>Your account only. No payment. Not linked from the public site.</span></div>`;
  }
  const labelOf = k => { const row = ((window.ProCore && window.ProCore.FEATURES) || []).find(x => x[0] === k); return row ? row[1] : k; };
  function head(screen, title, sub) {
    return `<div class="page-head ppv-head"><div>${screen ? `<a class="lnk ppv-back" href="${href()}">Pro</a>` : `<span class="eyebrow">Owner</span>`}<h1>${esc(title)}</h1><div class="sub">${esc(sub)}</div></div></div>`;
  }
  function fine() {
    const rg = G() && G().rgSpan ? G().rgSpan() : `Call or text <a href="tel:18004262537">1-800-GAMBLER</a>.`;
    return `<p class="of-rg"><span class="of-21">21+</span> LineSmart is for adults 21 and older. Gambling problem? ${rg} <a href="responsible-gambling.html">Responsible gambling</a></p>
      <p class="note">Pro is data and software: odds comparison, line history, alerts and a bet tracker. It doesn't include picks or predictions, and nothing here can promise that a bet wins. Most bets lose. LineSmart doesn't take bets. Always confirm the price at the sportsbook.</p>`;
  }
  function crumbs(screen) {
    const items = [["", "Overview"], ["value", "Value"], ["alerts", "Alerts"], ["tracker", "My Bets"], ["books", "Books"], ["history", "Line history"], ["refresh", "Refresh"], ["hot", "Hot props"]];
    return `<nav class="chips ppv-nav" aria-label="Pro">${items.map(([id, label]) => `<a class="chip${id === screen ? " on" : ""}" href="${href(id)}">${esc(label)}</a>`).join("")}</nav>`;
  }
  const shell = (screen, title, sub, body) => `<div class="ppv ppv-ready" data-pro-owner data-screen="${esc(screen)}">${banner()}${head(screen, title, sub)}${crumbs(screen)}${body}${fine()}</div>`;

  function buildLine() {
    const build = window.__PRO_BUILD || "unknown";
    const site = (window.ProGateCore && window.ProGateCore.SITE_BUILD) || "unknown";
    return `<p class="ppv-build">Pro build ${esc(build)} · site ${esc(site)}</p>`;
  }
  function signedPts(v) {
    if (!isNum(v)) return "—";
    const n = Math.round(v * 10) / 10;
    return (n > 0 ? "+" : "") + String(n);
  }
  function moveLabel(market, v) {
    if (!isNum(v)) return "—";
    return market === "spread" ? sgn(v) : String(v);
  }
  function clvBlock(clv) {
    if (!clv || !clv.available) return "";
    const mean = (clv.mean > 0 ? "+" : "") + clv.mean.toFixed(2);
    const rate = clv.beatRate == null ? "" : ` Beat the close: <b>${Math.round(clv.beatRate * 100)}%</b> (${clv.beats} of ${clv.judged}).`;
    return `<p><b>${clv.n}</b> bet${clv.n === 1 ? "" : "s"} with a closing line. Average CLV <b class="num ${cls(clv.mean)}">${esc(mean)}</b> points (close minus the bet line).${rate}</p><p class="note">A bet beats the close when its number is better than the closing number: a higher spread, a lower over, or a higher under. It is not a pick.</p>`;
  }
  function hubBets() {
    const bets = loadBets();
    if (!bets.length) return "";
    const C = window.BetCore;
    const stats = C ? C.stats(bets) : null;
    const clv = F().clvSummary(bets);
    const rec = stats ? `${stats.won}-${stats.lost}-${stats.push}` : "—";
    const net = stats ? money(stats.net, true) : "—";
    return panel("My Bets", `<div class="statgrid"><div class="stat"><span class="sl">Bets</span><b class="num">${bets.length}</b></div><div class="stat"><span class="sl">Record</span><b class="num">${esc(rec)}</b></div><div class="stat"><span class="sl">Net</span><b class="num ${cls(stats ? stats.net : 0)}">${esc(net)}</b></div></div>${clvBlock(clv)}<p><a href="#/bets">Open My Bets</a></p>`);
  }
  function boardTable(rows) {
    const body = rows.map(r => `<tr data-size="${esc(String(r.size))}" data-lg="${esc(r.lg)}"><td><a href="${publicGame(r.lg, r.id)}" data-pro-goto="game">${esc(r.away)} @ ${esc(r.home)}</a></td><td>${esc(A().lgName(r.lg))}</td><td>${esc(r.market === "total" ? "Total" : "Spread")}</td><td class="num">${esc(moveLabel(r.market, r.open))}</td><td class="num">${esc(moveLabel(r.market, r.cur))}</td><td class="num"><b>${esc(signedPts(r.delta))}</b></td></tr>`).join("");
    return `<div class="pro-sort" role="group" aria-label="Sort line moves"><button type="button" class="chip on" data-pro-sort="size" data-dir="desc" aria-pressed="true">Size</button><button type="button" class="chip" data-pro-sort="league" aria-pressed="false">League</button></div><div class="tbl-wrap"><table class="books pro-moves" id="proMoves"><thead><tr><th>Game</th><th>League</th><th>Market</th><th>Open</th><th>Now</th><th>Move</th></tr></thead><tbody>${body}</tbody></table></div><p class="note">Size is how far the spread or total moved, in points. Open and current are the numbers stored in the file.</p>`;
  }
  function sortMoves(btn) {
    const table = document.getElementById("proMoves");
    if (!table) return;
    const mode = btn.dataset.proSort || "size";
    const dir = btn.classList.contains("on") ? (btn.dataset.dir === "desc" ? "asc" : "desc") : (mode === "league" ? "asc" : "desc");
    btn.dataset.dir = dir;
    const bar = btn.parentElement;
    if (bar) bar.querySelectorAll("[data-pro-sort]").forEach(b => { const on = b === btn; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on ? "true" : "false"); });
    const tb = table.querySelector("tbody");
    const rows = [...tb.querySelectorAll("tr")];
    rows.sort((a, b) => {
      const sizeDesc = Number(b.dataset.size) - Number(a.dataset.size);
      const lgAsc = (a.dataset.lg || "").localeCompare(b.dataset.lg || "") || (Number(a.dataset.size) - Number(b.dataset.size));
      if (mode === "league") return dir === "asc" ? lgAsc : -lgAsc;
      return dir === "desc" ? sizeDesc : -sizeDesc;
    });
    rows.forEach(r => tb.appendChild(r));
  }
  async function home() {
    const now = Date.now(), { by } = await indexes();
    const map = {};
    for (const [lg, idx] of Object.entries(by)) map[lg] = gamesOf(idx);
    const board = F().lineMoveBoard(map, now);
    const shown = board.rows.slice(0, 20);
    const flags = notable(by, now);
    const todayKey = F().etDay(now);
    const todayFlags = flags.filter(x => F().etDay(x.g && x.g.date) === todayKey);
    const sharpList = (todayFlags.length ? todayFlags : flags).slice(0, 8);
    let dash = "";
    if (shown.length) {
      const title = board.scope === "today" ? "Biggest line moves today" : "Biggest line moves in the file";
      const sub = board.scope === "today"
        ? `${shown.length} market${shown.length === 1 ? "" : "s"} across the files`
        : "No game in the file starts today. These are the upcoming moves already stored.";
      const more = board.rows.length > shown.length ? `<p class="note">Showing the ${shown.length} largest of ${board.rows.length}.</p>` : "";
      dash += panel(title, `<p class="na">${esc(sub)}</p>${boardTable(shown)}${more}`);
    }
    if (sharpList.length) {
      const rows = sharpList.map(item => `<a class="ppv-line" href="${publicGame(item.lg, item.id)}" data-pro-goto="game"><span><span class="vs-lg">${esc(A().lgName(item.lg))}</span> <b>${esc(item.g.away.abbr)} @ ${esc(item.g.home.abbr)}</b><small>${item.notes.map(esc).join(" · ")}</small></span><span class="mvbadge">Sharp move</span></a>`).join("");
      dash += panel(todayFlags.length ? "Sharp-flagged games today" : "Sharp-flagged games", `<div class="ppv-list">${rows}</div><p class="note">Same flags as the slate: a large spread move, a key number crossed, or a total that moved past the sport's bar. A description of the saved line, not a pick.</p><p><a href="${href("alerts")}">All sharp flags</a></p>`);
    }
    dash += hubBets();
    if (!dash) dash = EMPTY;
    const cards = ((window.ProCore && window.ProCore.FEATURES) || []).map(([k, label]) => `<a class="ppv-card pro-frame" href="${href(SCREEN[k])}">${PILL}<b>${esc(label)}</b><span>${esc(HINT[k] || "")}</span><span class="ppv-go">Open</span></a>`).join("")
      + `<a class="ppv-card pro-frame" href="${href("hot")}">${PILL}<b>Hot props</b><span>Same-line price gaps, prop line moves, and hot streaks, only from props files the site has. Saved filters stay in this browser.</span><span class="ppv-go">Open</span></a>`;
    const offers = G() && G().offersHTML ? G().offersHTML("pro") : "";
    return shell("", "LineSmart Pro", "Today's line moves, sharp flags, and My Bets, from the files already on the site.",
      `${flNote()}${dash}<h2 class="ppv-h">${PILL} Tools</h2><div class="ppv-grid">${cards}</div>
      <p class="note">Sharp-move flags, line charts, game lines, My Bets, and hot props use the data files. Nothing here calls the odds provider, takes a payment, or sends email. The public waitlist stays at <a href="#/pro">#/pro</a> for everyone else.</p>
      ${offers}${buildLine()}`);
  }

  function lineRows(lg, g) {
    const out = [];
    const away = g.away.abbr, home = g.home.abbr;
    for (const bk of F().bookColumns(g)) {
      const o = g.books[bk];
      const base = { lg, gid: String(g.id), matchup: `${away} @ ${home}`, date: g.date, book: bk };
      if (isNum(o.awaySpread)) out.push({ ...base, mk: "spread", label: `${away} ${sgn(o.awaySpread)}`, price: o.awaySpreadOdds });
      if (isNum(o.homeSpread)) out.push({ ...base, mk: "spread", label: `${home} ${sgn(o.homeSpread)}`, price: o.homeSpreadOdds });
      if (isNum(o.awayML)) out.push({ ...base, mk: "ml", label: `${away} ML`, price: o.awayML });
      if (isNum(o.homeML)) out.push({ ...base, mk: "ml", label: `${home} ML`, price: o.homeML });
      if (isNum(o.total)) {
        out.push({ ...base, mk: "total", label: `Over ${o.total}`, price: o.overOdds });
        out.push({ ...base, mk: "total", label: `Under ${o.total}`, price: o.underOdds });
      }
    }
    return out;
  }
  function realEdges(by, now) {
    const V = window.ValueCore;
    if (!V) return [];
    const rows = [];
    for (const [lg, idx] of Object.entries(by)) {
      const kind = idx.league.kind, fileNow = Date.parse(idx.generated) || now;
      for (const g of idx.games || []) {
        if (g.state !== "pre" || Date.parse(g.date) <= now) continue;
        const r = V.gameRows(lg, kind, g, idx.generated, fileNow);
        rows.push(...r.rows);
      }
    }
    const si = G() && G().isAvailable ? G().isAvailable.bind(G()) : () => true;
    return V.forState(rows, si);
  }
  async function propsDocs() {
    if (PROPS) return PROPS;
    const pairs = await Promise.all(PROP_LEAGUES.map(async lg => {
      try { return [lg, await A().getJSON(`data/props/${lg}.json`)]; }
      catch (e) { return [lg, null]; }
    }));
    PROPS = Object.fromEntries(pairs.filter(([, d]) => d && d.games));
    return PROPS;
  }
  async function propEdges(by, now) {
    const V = window.ValueCore;
    const docs = await propsDocs();
    if (!V || !Object.keys(docs).length) return { available: false, rows: [] };
    const rows = [];
    for (const [lg, doc] of Object.entries(docs)) {
      const idx = by[lg];
      if (!idx) continue;
      const kind = idx.league.kind, fileNow = Date.parse(doc.gen) || now;
      for (const g of idx.games || []) {
        const pg = doc.games[String(g.id)];
        if (!pg) continue;
        const r = V.propRows(lg, kind, g, pg, doc.players, doc.markets, doc.gen, fileNow);
        rows.push(...r.rows);
      }
    }
    if (!rows.length) return { available: false, rows: [] };
    const si = G() && G().isAvailable ? G().isAvailable.bind(G()) : () => true;
    return { available: true, rows: V.forState(rows, si) };
  }
  function vq() {
    const q = parts().q;
    const min = num(q.get("min"));
    const mk = q.get("mk");
    return { lg: q.get("lg") || "all", mk: ["all", "ml", "spread", "total", "prop"].includes(mk) ? mk : "all", min: min == null ? 0 : min, q: (q.get("q") || "").trim() };
  }
  const vHref = patch => {
    const f = { ...vq(), ...patch };
    const p = new URLSearchParams();
    if (f.lg !== "all") p.set("lg", f.lg);
    if (f.mk !== "all") p.set("mk", f.mk);
    if (f.min) p.set("min", String(f.min));
    if (f.q) p.set("q", f.q);
    const s = p.toString();
    return href("value") + (s ? "?" + s : "");
  };
  async function viewValue() {
    const now = Date.now(), { by, order, meta } = await indexes(), f = vq();
    const edges = realEdges(by, now);
    const shownE = window.ValueCore.filterRows(edges, { lg: f.lg, mk: f.mk === "prop" ? "none" : f.mk, min: f.min / 100, hours: 0, outliers: true }, now);
    let lines = [];
    for (const lg of order) if (by[lg]) for (const g of future(by[lg], now)) lines.push(...lineRows(lg, g));
    lines = F().filterBoard(lines, f);
    const props = await propEdges(by, now);
    const propRows = props.available ? F().filterBoard(props.rows.map(r => ({ ...r, edge: r.top && r.top.edge })), { ...f, mk: f.mk === "all" ? "prop" : f.mk }).filter(r => f.mk === "all" || f.mk === "prop") : [];
    const leagues = order.filter(lg => future(by[lg], now).length);
    const chips = `<div class="chips">${[["all", "All"], ...leagues.map(lg => [lg, A().lgName(lg)])].map(([k, t]) => `<a class="chip${f.lg === k ? " on" : ""}" href="${esc(vHref({ lg: k }))}">${esc(t)}</a>`).join("")}</div>`;
    const mks = [["all", "All"], ["ml", "Moneyline"], ["spread", "Spread"], ["total", "Total"], ["prop", "Player props"]];
    const seg = `<nav class="seg" aria-label="Market">${mks.map(([k, t]) => `<a href="${esc(vHref({ mk: k }))}" class="${f.mk === k ? "on" : ""}">${esc(t)}</a>`).join("")}</nav>`;
    const mins = [[-2, "−2%"], [0, "0%"], [1, "+1%"], [2, "+2%"], [3, "+3%"]];
    const edgeHtml = shownE.length ? `<section class="card pro-frame"><h3 class="ppv-h">${PILL} Consensus edges <span class="st-sub">Value finder math</span></h3><div class="ppv-list">${shownE.slice(0, 12).map(r => `<a class="ppv-line" href="${gameHref(r.lg, r.gid)}"><span><span class="vs-lg">${esc(A().lgName(r.lg))}</span> <b>${esc(r.label)}</b><small>${esc(r.matchup)}</small></span><span class="num ${cls(r.top.edge)}"><b>${esc(ePct(r.top.edge))}</b><small>${bookName(r.top.book)}</small></span></a>`).join("")}</div></section>` : "";
    const lineHtml = f.mk === "prop" || !lines.length ? "" : `<section class="card pro-frame"><h3 class="ppv-h">${PILL} Game lines in the file <span class="st-sub">${lines.length} match</span></h3><div class="ppv-list">${lines.slice(0, 12).map(r => `<a class="ppv-line" href="${gameHref(r.lg, r.gid)}"><span><span class="vs-lg">${esc(A().lgName(r.lg))}</span> <b>${esc(r.label)}</b><small>${esc(r.matchup)}</small></span><span class="num"><b class="px">${esc(am(r.price))}</b><small>${bookName(r.book)}</small></span></a>`).join("")}</div><p class="note">Prices are the ones stored in the data file${meta.generated ? ` (as of ${esc(A().fullET(meta.generated))})` : ""}. A single book is not a consensus, so these rows are the line, not an edge.</p></section>`;
    const propHtml = props.available && propRows.length ? `<section class="card pro-frame"><h3 class="ppv-h">${PILL} Props edges <span class="st-sub">${propRows.length} match</span></h3><div class="ppv-list">${propRows.slice(0, 12).map(r => `<div class="ppv-line"><span><span class="vs-lg">${esc(A().lgName(r.lg))}</span> <b>${esc(r.label)}</b><small>${esc(r.matchup)}</small></span><span class="num ${cls(r.top.edge)}"><b>${esc(ePct(r.top.edge))}</b><small>${bookName(r.top.book)}</small></span></div>`).join("")}</div><p class="note">An edge compares prices in the file. It is not a suggestion to bet.</p></section>` : "";
    const results = `${edgeHtml}${lineHtml}${propHtml}` || EMPTY;
    return shell("value", "Value finder extras", labelOf("props_ev"),
      `${flNote()}<section class="card pro-frame vf-filters" aria-label="Custom filters">${chips}<div class="ppv-frow">${seg}<form class="ppv-q" id="ppvQ"><label>Search <input name="q" value="${esc(f.q)}" maxlength="40" aria-label="Search lines"></label><button type="submit" class="chip">Filter</button></form>
        <label class="vf-sel"><span>Min edge</span><select id="ppvMin" aria-label="Minimum edge">${mins.map(([v, t]) => `<option value="${v}"${v === f.min ? " selected" : ""}>${t}</option>`).join("")}</select></label></div></section>
      ${results}`);
  }

  function notable(by, now) {
    const map = {};
    for (const [lg, idx] of Object.entries(by)) map[lg] = gamesOf(idx);
    return F().sharpMoves(map, now).map(row => {
      const g = (by[row.lg].games || []).find(x => String(x.id) === row.id);
      return { ...row, g, kind: by[row.lg].league.kind };
    }).filter(x => x.g);
  }
  async function loadAlerts() {
    if (ALERTS) return ALERTS;
    const AC = window.AcctCore, GC = window.ProGateCore;
    const tok = GC.tokenOf((() => { try { return localStorage.getItem(AC.AUTH_KEY); } catch (e) { return ""; } })());
    if (!tok) { ALERTS = []; return ALERTS; }
    try {
      const res = await fetch(AC.SB_URL + "/rest/v1/line_alerts?select=*&order=created_at.desc&limit=50", {
        headers: { apikey: AC.SB_KEY, Authorization: "Bearer " + tok, Accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) { ALERTS = []; return ALERTS; }
      const body = await res.json();
      ALERTS = Array.isArray(body) ? body : [];
    } catch (e) { ALERTS = []; }
    return ALERTS;
  }
  async function viewAlerts() {
    const now = Date.now(), { by } = await indexes(), flags = notable(by, now);
    const mine = await loadAlerts();
    const C = window.AlertsCore;
    const active = mine.filter(a => C.status(a, now).key === "active").length;
    const cap = F().ACTIVE_PRO;
    const rows = flags.slice(0, 12).map(item => `<a class="ppv-line" href="${gameHref(item.lg, item.id)}"><span><span class="vs-lg">${esc(A().lgName(item.lg))}</span> <b>${esc(item.g.away.abbr)} @ ${esc(item.g.home.abbr)}</b><small>${item.notes.map(esc).join(" · ")}</small></span><span class="mvbadge">Sharp move</span></a>`).join("");
    const sharp = rows ? `<section class="card pro-frame"><h3 class="ppv-h">${PILL} Sharp-move flags <span class="st-sub">${flags.length} upcoming</span></h3><div class="ppv-list">${rows}</div><p class="note">A flag is the rule the site already uses on the slate: a large spread move, a key number crossed, or a total that moved past the sport's bar. It describes the saved line. It is not a pick.</p></section>` : "";
    const list = mine.length ? `<section class="card pro-frame"><h3 class="ppv-h">${PILL} Your alerts</h3><ul class="ppv-ul">${mine.slice(0, 25).map(a => `<li><b>${esc(C.describe(a))}</b><span>${esc(a.game_label || "")} · ${esc(C.status(a, now).text)}</span></li>`).join("")}</ul></section>` : "";
    return shell("alerts", "Line alerts", labelOf("alerts_25"),
      `${flNote()}<section class="card pro-frame ppv-cap"><div class="ppv-cap-row"><b>${active} of ${cap}</b><span>active alerts for this account · free accounts stay at ${F().ACTIVE_FREE}</span></div>
        <div class="ppv-meter" aria-hidden="true"><i style="width:${Math.min(100, active / cap * 100)}%"></i></div>
        <p class="note">The server allows ${cap} active alerts on an owner account after the migration. Emails still stop at ${F().EMAIL_FREE} a day. This page does not send email.</p></section>
      ${sharp}${list}`);
  }

  function loadBets() {
    if (window.LSBets && window.LSBets.syncState) return window.LSBets.syncState().bets || [];
    try {
      const d = JSON.parse(localStorage.getItem(window.BetCore.KEY) || "null");
      const list = Array.isArray(d && d.bets) ? d.bets : [];
      return list.map(window.BetCore.normalizeBet).filter(Boolean);
    } catch (e) { return []; }
  }
  function betLabel(b) {
    const ev = b.event && (b.event.name || [b.event.away, b.event.home].filter(Boolean).join(" @ "));
    return ev || b.eventText || b.selection || b.type || "Bet";
  }
  async function viewTracker() {
    const bets = loadBets();
    const store = localStore();
    const tags = store ? F().readTags(store) : {};
    const tag = (parts().q.get("tag") || "all").toLowerCase();
    const names = [...new Set(Object.values(tags).flat())].sort();
    const shown = bets.filter(b => tag === "all" || (tags[b.id] || []).includes(tag));
    const stats = window.BetCore.stats(shown);
    const clvAll = F().clvSummary(shown);
    const chips = ["all", ...names].map(t => `<a class="chip${tag === t ? " on" : ""}" href="${href("tracker")}${t === "all" ? "" : "?tag=" + encodeURIComponent(t)}">${esc(t === "all" ? "All tags" : t)}</a>`).join("");
    if (!shown.length) return shell("tracker", "My Bets extras", labelOf("tracker_pro"), `${chips ? `<div class="chips ppv-tags" role="group" aria-label="Tags">${chips}</div>` : ""}${EMPTY}`);
    const box = (k, v, sub, c) => `<div class="stat"><span class="sl">${esc(k)}</span><b class="num ${c || ""}">${v}</b>${sub ? `<span class="ss">${sub}</span>` : ""}</div>`;
    const rec = `${stats.won}-${stats.lost}-${stats.push}`;
    const clvHead = clvAll.available ? `<th>CLV</th>` : "";
    const table = `<div class="tbl-wrap"><table class="books ppv-bets"><thead><tr><th>Bet</th><th>Status</th><th>Stake</th><th>Net</th>${clvHead}<th>Tags</th></tr></thead><tbody>${shown.slice(0, 20).map(b => {
      const net = window.BetCore.netResult(b);
      const clv = F().clvPoints(b, b.closeLine);
      const mine = tags[b.id] || [];
      const clvCell = clvAll.available ? `<td class="num">${clv.available ? esc((clv.delta > 0 ? "+" : "") + clv.delta) : "—"}</td>` : "";
      return `<tr><td>${esc(betLabel(b))}<small class="na"> ${esc(b.date || "")}</small></td><td>${esc(b.status || "pending")}</td><td class="num">${esc(money(Number(b.stake) || 0))}</td><td class="num ${cls(net)}">${esc(money(net, true))}</td>${clvCell}<td>${mine.map(t => `<span class="chip">${esc(t)}</span>`).join(" ")}${store ? `<form class="ppv-form" data-ppv-tag="${esc(b.id)}"><input name="tag" maxlength="24" aria-label="Tag" placeholder="Tag"><button type="submit" class="chip">Add</button></form>` : ""}</td></tr>`;
    }).join("")}</tbody></table></div>`;
    return shell("tracker", "My Bets extras", labelOf("tracker_pro"),
      `<div class="statgrid bt-stats">${box("Net", money(stats.net, true), "from My Bets", cls(stats.net))}${box("ROI", pct(stats.roi), "", cls(stats.roi || 0))}${box("Record", rec, `${stats.n} bets`)}${box("Win rate", stats.winRate == null ? "—" : (stats.winRate * 100).toFixed(0) + "%", "pushes excluded")}</div>
      ${clvBlock(clvAll)}
      <div class="chips ppv-tags" role="group" aria-label="Tags">${chips}</div>
      <section class="card pro-frame">${table}<p class="note">Tags stay in this browser. They are not sent to an account, and they don't turn Pro on.</p></section>`);
  }

  function cell(g, key, label, line, price) {
    const o = g.books && g.books[key];
    if (!o) return "";
    if (label.endsWith("ML")) {
      const n = label.startsWith(g.away.abbr) ? o.awayML : o.homeML;
      return isNum(n) ? `<b>${esc(am(n))}</b>` : "";
    }
    if (label === "Over" || label === "Under") {
      if (!isNum(o.total)) return "";
      const px = label === "Over" ? o.overOdds : o.underOdds;
      return `<b>${esc(o.total)}</b> <span class="na">${esc(am(px))}</span>`;
    }
    const side = label.startsWith(g.home.abbr) ? "home" : "away";
    const ln = o[side + "Spread"], px = o[side + "SpreadOdds"];
    if (!isNum(ln)) return "";
    return `<b>${esc(sgn(ln))}</b> <span class="na">${esc(am(px))}</span>`;
  }
  async function viewBooks() {
    const now = Date.now(), { by, order } = await indexes();
    const games = [];
    for (const lg of order) for (const g of future(by[lg], now)) if (F().bookColumns(g).length) games.push({ lg, g });
    const pa = parts();
    const cur = games.find(x => x.lg === pa.a && String(x.g.id) === String(pa.b)) || games[0];
    if (!cur) return shell("books", "More sportsbooks", labelOf("books_10"), EMPTY);
    const g = cur.g;
    const cols = G() && G().sortBooks ? G().sortBooks(F().BOOK_KEYS.slice()) : F().BOOK_KEYS.slice();
    const headR = cols.map(k => {
      const st = bookBits(k);
      return `<th>${esc(F().BOOK_NAME[k] || k)}${st.label ? `<span class="na-st">${esc(st.label)}</span>` : ""}</th>`;
    }).join("");
    const markets = [
      [g.away.abbr + " spread"],
      [g.home.abbr + " spread"],
      [g.away.abbr + " ML"],
      [g.home.abbr + " ML"],
      ["Over"],
      ["Under"],
    ];
    const body = markets.map(([label]) => {
      const cells = cols.map(k => cell(g, k, label));
      if (!cells.some(Boolean)) return "";
      return `<tr><td>${esc(label)}</td>${cells.map(c => `<td class="num">${c || "—"}</td>`).join("")}</tr>`;
    }).join("");
    const sel = `<label class="vf-sel"><span>Game</span><select id="ppvGame" aria-label="Game">${games.slice(0, 40).map(x => `<option value="${esc(x.lg)}/${esc(x.g.id)}"${x.lg === cur.lg && String(x.g.id) === String(g.id) ? " selected" : ""}>${esc(A().lgName(x.lg))} · ${esc(x.g.away.abbr)} @ ${esc(x.g.home.abbr)}</option>`).join("")}</select></label>`;
    const offers = G() && G().offersHTML ? G().offersHTML("pro") : "";
    const table = body ? `<div class="tbl-wrap"><table class="books"><thead><tr><th>Market</th>${headR}</tr></thead><tbody>${body}</tbody></table></div><p class="note">Only books with a number in the file get a column. An empty cell means that book didn't post this market. No price is filled in. Pinnacle isn't listed.</p>` : EMPTY;
    return shell("books", "More sportsbooks", labelOf("books_10"),
      `${flNote()}<section class="card pro-frame ppv-books"><div class="ppv-frow">${sel}<span class="na">${esc(g.away.name)} at ${esc(g.home.name)}</span></div>
        ${table}</section>
      ${offers}`);
  }

  async function viewHistory() {
    const now = Date.now(), { by } = await indexes(), flags = notable(by, now);
    const lg = parts().a || (flags[0] && flags[0].lg);
    const id = parts().b || (flags[0] && flags[0].id);
    const item = flags.find(x => x.lg === lg && String(x.id) === String(id)) || flags[0];
    let chart = "";
    if (item) {
      try {
        const d = await A().getJSON(`data/${item.lg}/games/${item.g.id}.json`);
        const sec = A().lineMoveSection(d, d.game, item.kind);
        chart = sec.html || "";
        afterPaint = sec.wire || (() => {});
      } catch (e) { chart = ""; }
    }
    const list = flags.slice(0, 12).map(x => {
      const on = item && x.lg === item.lg && String(x.id) === String(item.id);
      return `<a class="ppv-line${on ? " on" : ""}" href="${href("history")}/${esc(x.lg)}/${esc(x.id)}"><span><span class="vs-lg">${esc(A().lgName(x.lg))}</span> <b>${esc(x.g.away.abbr)} @ ${esc(x.g.home.abbr)}</b><small>${x.notes.map(esc).join(" · ")} · ${bookName(x.book || "draftkings")}</small></span><span class="mvbadge">Sharp move</span></a>`;
    }).join("");
    const sharp = list ? `<section class="card pro-frame"><h3 class="ppv-h">${PILL} Sharp-move flags <span class="st-sub">${flags.length} upcoming</span></h3><div class="ppv-list">${list}</div><p class="note">Same flags as the slate. A description of the saved line, not a pick.</p></section>` : "";
    const chartBlock = chart ? `<section class="card pro-frame">${chart}</section>` : "";
    const histBody = sharp || chartBlock ? `${flNote()}${sharp}${chartBlock}` : `${flNote()}${EMPTY}`;
    return shell("history", "Line history", labelOf("line_history"), histBody);
  }

  async function viewRefresh() {
    const { meta, by, order } = await indexes();
    const info = F().refreshInfo(meta.generated, Date.now());
    const rows = (order || []).map(lg => {
      const L = (meta.leagues || {})[lg] || {}, idx = by[lg];
      const t = L.updated || (idx && idx.generated);
      const age = t ? ((Date.now() - Date.parse(t)) / 36e5) : null;
      return `<tr><td>${esc(L.name || A().lgName(lg))}</td><td class="num">${t ? esc(A().fullET(t)) : "—"}</td><td class="num">${age == null ? "—" : esc(age.toFixed(1))}</td></tr>`;
    }).join("");
    const ageCard = info.ageHours == null ? "" : `<section class="card pro-frame"><div class="statgrid">${[
        ["File age", info.ageHours.toFixed(1) + " h", "since the data file"],
        ["Cadence today", "about " + info.cadenceMin + " min", "how the site refreshes"],
      ].map(([k, v, s]) => `<div class="stat"><span class="sl">${esc(k)}</span><b class="num">${esc(v)}</b><span class="ss">${esc(s)}</span></div>`).join("")}</div>
        <p class="note">This page does not fetch new odds and does not call the odds provider.</p></section>`;
    return shell("refresh", "Faster refresh", labelOf("fast_refresh"),
      `${ageCard}<section class="card pro-frame"><h3 class="ppv-h">${PILL} When each league file was written</h3><div class="tbl-wrap"><table class="books"><thead><tr><th>League</th><th>Updated</th><th>Hours ago</th></tr></thead><tbody>${rows}</tbody></table></div></section>`);
  }

  function preferBooks() {
    const g = G();
    const order = ["hardrockbet", "draftkings", "fanduel"];
    if (!g || !g.sortBooks) return order;
    const keys = g.sortBooks(order).filter(k => !g.isAvailable || g.isAvailable(k));
    return keys.length ? keys : ["hardrockbet"];
  }
  function quoteLine(gap) {
    const by = Object.fromEntries(gap.quotes.map(q => [q.key, q]));
    const order = G() && G().sortBooks ? G().sortBooks(gap.quotes.map(q => q.key)) : gap.quotes.map(q => q.key);
    return order.map(k => {
      const q = by[k], st = bookBits(k);
      return `${(F().BOOK_NAME)[k] || k} ${am(q.price)}${st.label ? " (" + st.label + ")" : ""}`;
    }).join(" · ");
  }
  const Pnum = v => (isNum(v) ? String(Math.round(v * 10) / 10) : "—");
  async function viewHot() {
    const H = Hp();
    if (!H) return shell("hot", "Hot props", "Price gaps, line moves, and recent overs.", `<div class="empty"><h3>Hot props didn't load</h3></div>`);
    const docs = await propsDocs();
    const f = hotState();
    const labels = H.SPORT_LABEL;
    const all = H.collect(docs);
    const sportAll = all.filter(r => r.lg === f.lg);
    const filtered = H.applyFilters(all, f);
    const extra = H.sportList(docs).filter(k => !H.SPORT_FIRST.includes(k));
    const chips = [...H.SPORT_FIRST, ...extra].map(k => {
      const has = !!(docs[k] && docs[k].games && Object.keys(docs[k].games).length);
      return `<a class="chip${f.lg === k ? " on" : ""}${has ? "" : " ppv-off"}" href="${esc(hotHash({ lg: k, team: "", player: "", mk: "all" }))}">${esc(labels[k] || k.toUpperCase())}${has ? "" : ` <span class="na">no file</span>`}</a>`;
    }).join("");
    const teams = [...new Set(sportAll.map(r => r.team).filter(Boolean))].sort();
    const teamRows = f.team ? sportAll.filter(r => r.team === f.team || r.teamId === f.team) : sportAll;
    const players = [];
    const seenP = new Set();
    for (const r of teamRows) if (!seenP.has(r.pid)) { seenP.add(r.pid); players.push(r); }
    players.sort((a, b) => a.name.localeCompare(b.name));
    const playerRows = f.player ? teamRows.filter(r => r.pid === f.player || r.name.toLowerCase().includes(f.player.toLowerCase())) : teamRows;
    const mks = [];
    const seenM = new Set();
    for (const r of playerRows) if (!seenM.has(r.mk)) { seenM.add(r.mk); mks.push({ mk: r.mk, label: r.label }); }
    const sel = (id, label, options) => `<label class="vf-sel"><span>${label}</span><select id="${id}" aria-label="${label}">${options}</select></label>`;
    const teamSel = sel("ppvHotTeam", "Team", `<option value="">All teams</option>${teams.map(t => `<option value="${esc(t)}"${t === f.team ? " selected" : ""}>${esc(t)}</option>`).join("")}`);
    const playerSel = sel("ppvHotPlayer", "Player", `<option value="">All players</option>${players.map(p => `<option value="${esc(p.pid)}"${p.pid === f.player ? " selected" : ""}>${esc(p.name)}${p.team ? ` (${esc(p.team)})` : ""}</option>`).join("")}`);
    const mkSel = sel("ppvHotMk", "Prop type", `<option value="all"${f.mk === "all" ? " selected" : ""}>All props</option>${mks.map(p => `<option value="${esc(p.mk)}"${p.mk === f.mk ? " selected" : ""}>${esc(p.label)}</option>`).join("")}`);
    const store = localStore();
    const saved = store ? H.readSaved(store) : [];
    const savedHtml = saved.length ? `<div class="chips ppv-saved" aria-label="Saved filters">${saved.map(s => `<span class="chip ppv-saved-chip"><a href="${esc(hotHash({ lg: s.lg, team: s.team, player: s.player, mk: s.mk || "all" }))}">${esc(s.name)}</a><button type="button" class="ppv-x" data-ppv-hot-del="${esc(s.id)}" aria-label="${esc("Delete saved filter " + s.name)}">×</button></span>`).join("")}</div>` : "";
    const file = docs[f.lg];
    let lists;
    if (!file) {
      lists = EMPTY;
    } else {
      lists = "";
      if (H.hasPrices(sportAll)) {
        const gaps = H.priceGaps(filtered);
        const shownG = gaps.slice(0, 12);
        if (shownG.length) lists += `<section class="card pro-frame" id="ppvGaps"><h3 class="ppv-h">${PILL} Price gaps on the same line <span class="st-sub">${gaps.length} in this filter</span></h3><div class="ppv-list">${shownG.map(g => `<div class="ppv-line"><span><span class="vs-lg">${esc(labels[g.lg] || g.lg.toUpperCase())}</span> <b>${esc(g.name)} · ${esc(g.label)}</b><small>${esc(g.team)} · O/U ${esc(Pnum(g.line))} · ${g.side === "under" ? "Under" : "Over"}</small><small>${esc(quoteLine(g))}</small></span><span class="num"><b>${esc((g.gap * 100).toFixed(1))} pts</b><small>implied gap</small></span></div>`).join("")}</div><p class="note">The gap is the difference in implied probability between books that posted this exact number. A different number is not included. It is not a suggestion to bet either price.</p></section>`;
      }
      if (H.hasOpen(sportAll)) {
        const moves = H.lineMoves(filtered);
        const shownM = moves.slice(0, 12);
        if (shownM.length) lists += `<section class="card pro-frame" id="ppvMoves"><h3 class="ppv-h">${PILL} Prop line moves <span class="st-sub">${moves.length} in this filter</span></h3><div class="ppv-list">${shownM.map(m => `<div class="ppv-line"><span><span class="vs-lg">${esc(m.team)}</span> <b>${esc(m.name)} · ${esc(m.label)}</b><small>O/U ${esc(Pnum(m.line))} · ${esc(m.text)}</small></span><span class="num"><b>${m.delta > 0 ? "+" : ""}${esc(String(Math.round(m.delta * 10) / 10))}</b><small>from the open</small></span></div>`).join("")}</div><p class="note">The opening number is the one stored on the prop row. It describes that file. It is not a prediction.</p></section>`;
      }
      const prefer = preferBooks();
      if (H.hotStreaks(sportAll, prefer).available) {
        const hot = H.hotStreaks(filtered, prefer).rows;
        const shownH = hot.slice(0, 12);
        if (shownH.length) lists += `<section class="card pro-frame" id="ppvHotStreaks"><h3 class="ppv-h">${PILL} Hot streaks <span class="st-sub">${hot.length} in this filter</span></h3><div class="ppv-list">${shownH.map(h => `<div class="ppv-line"><span><span class="vs-lg">${esc(h.team)}</span> <b>${esc(h.name)} · ${esc(h.label)}</b><small>O/U ${esc(Pnum(h.gradedLine))} · ${esc(h.text)} in the last games played</small><small>Past results only.</small></span></div>`).join("")}</div><p class="note">Same rule as the props page: over in at least 4 of the last 5 games played, or the same share when fewer games are in the log. This is a count of past games, not a pick.</p></section>`;
      }
      if (!lists) lists = EMPTY;
    }
    const offers = G() && G().offersHTML ? G().offersHTML("pro") : "";
    const src = Object.entries(docs).map(([k, d]) => `${labels[k] || k.toUpperCase()}`).join(", ");
    return shell("hot", "Hot props", "Price gaps, opening-line moves, and recent overs from the props file.",
      `${flNote()}<p class="note">Built from props files on the site${src ? " (" + esc(src) + ")" : ""}. Nothing here calls the odds provider. Saved filters stay in this browser only.</p>
      <section class="card ppv-filters" aria-label="Hot props filters"><div class="chips" role="group" aria-label="Sport">${chips}</div><div class="ppv-frow">${teamSel}${playerSel}${mkSel}</div>
        <form id="ppvHotSave" class="ppv-form"><label class="vf-sel"><span>Save this filter</span><input name="name" maxlength="40" placeholder="Name" aria-label="Saved filter name"></label><button type="submit" class="chip">Save in this browser</button></form>
        <p class="ppv-out" id="ppvHotErr" role="alert"></p>
        ${savedHtml ? `<h3 class="ppv-h">Saved filters</h3>${savedHtml}` : ""}</section>
      ${lists}
      ${offers}`);
  }

  async function render(screen) {
    if (screen === "value") return viewValue();
    if (screen === "alerts") return viewAlerts();
    if (screen === "tracker") return viewTracker();
    if (screen === "books") return viewBooks();
    if (screen === "history") return viewHistory();
    if (screen === "refresh") return viewRefresh();
    if (screen === "hot") return viewHot();
    return home();
  }

  async function view() {
    const app = document.getElementById("app"), api = A();
    if (!app || !api) return;
    if (window.LSLive && window.LSLive.stop) window.LSLive.stop();
    api.renderTabs(null);
    const intro = document.getElementById("intro");
    if (intro) intro.hidden = true;
    const homeStates = document.getElementById("homeStates");
    if (homeStates) homeStates.hidden = true;
    const y = keepScroll ? window.scrollY : 0;
    keepScroll = false;
    if (!y) window.scrollTo(0, 0);
    const tok = api.nav(), screen = parts().screen;
    afterPaint = () => {};
    document.title = "LineSmart";
    app.innerHTML = `<div class="ppv ppv-ready" data-pro-owner data-screen="${esc(screen)}">${banner()}<div class="card"><span class="bt-spin" aria-hidden="true"></span> Loading…</div></div>`;
    let html;
    try { html = await render(screen); }
    catch (e) { html = shell(screen, "LineSmart Pro", "Something didn't load.", `<div class="empty"><h3>Couldn't load this page</h3>Reload to try again.</div>`); console.warn(e); }
    if (tok !== api.nav()) return;
    app.innerHTML = html;
    if (y) window.scrollTo(0, y);
    try { afterPaint(); } catch (e) { console.warn(e); }
    bind(app);
  }

  function bind(app) {
    if (app.dataset.proBound) return;
    app.dataset.proBound = "1";
    app.addEventListener("submit", e => {
      if (e.target.closest && e.target.closest("[data-pro-enhance]")) return;
      const q = e.target.closest && e.target.closest("#ppvQ");
      const hot = e.target.closest && e.target.closest("#ppvHotSave");
      const tag = e.target.closest && e.target.closest("[data-ppv-tag]");
      if (q) {
        e.preventDefault();
        location.hash = vHref({ q: String(new FormData(q).get("q") || "").trim() });
      }
      if (hot) { e.preventDefault(); saveHot(hot); }
      if (tag) {
        e.preventDefault();
        const store = localStore();
        const name = new FormData(tag).get("tag");
        if (store) F().setTag(store, tag.dataset.ppvTag, name, true);
        keepScroll = true;
        view();
      }
    });
    app.addEventListener("change", e => {
      const t = e.target;
      if (t.closest && t.closest("[data-pro-enhance]")) return;
      if (t.id === "ppvMin") location.hash = vHref({ min: Number(t.value) });
      if (t.id === "ppvGame") location.hash = href("books") + "/" + t.value;
      if (t.id === "ppvHotTeam") location.hash = hotHash({ team: t.value, player: "", mk: "all" });
      if (t.id === "ppvHotPlayer") location.hash = hotHash({ player: t.value, mk: "all" });
      if (t.id === "ppvHotMk") location.hash = hotHash({ mk: t.value });
    });
    app.addEventListener("click", e => {
      const sort = e.target.closest && e.target.closest("[data-pro-sort]");
      if (sort) { e.preventDefault(); sortMoves(sort); return; }
      if (e.target.closest && e.target.closest("[data-pro-enhance]")) return;
      const del = e.target.closest && e.target.closest("[data-ppv-hot-del]");
      if (del) {
        e.preventDefault();
        const store = localStore();
        if (store && Hp()) Hp().removeSaved(store, del.dataset.ppvHotDel);
        keepScroll = true;
        view();
      }
    });
  }
  function saveHot(form) {
    const name = new FormData(form).get("name");
    const store = localStore();
    const err = document.getElementById("ppvHotErr");
    if (!store || !Hp()) { if (err) err.textContent = "This browser isn't storing filters."; return; }
    const r = Hp().addSaved(store, { ...hotState(), name, id: Date.now().toString(36) });
    if (!r.ok) { if (err) err.textContent = r.error; return; }
    keepScroll = true;
    view();
  }

  function addNav() {
    if (document.querySelector("[data-pro-owner-nav]")) return;
    const bar = document.querySelector(".topbar-inner");
    if (!bar) return;
    const a = document.createElement("a");
    a.className = "search-btn";
    a.href = "#/owner";
    a.dataset.proOwnerNav = "1";
    a.textContent = "Pro";
    a.title = "LineSmart Pro";
    const inst = document.getElementById("installBtn");
    bar.insertBefore(a, inst || null);
  }
  function boot() {
    addNav();
    window.LSProApp.alertCap = F().ACTIVE_PRO;
    watchSlate();
    watchApp();
    bindEmbed();
  }
  function hide() {
    const a = document.querySelector("[data-pro-owner-nav]");
    if (a) a.remove();
    document.querySelectorAll("[data-pro-enhance], [data-pro-badge]").forEach(el => el.remove());
    if (window.LSProApp) delete window.LSProApp.alertCap;
    IX = null; PROPS = null; ALERTS = null;
    embedHot = null;
    if (window.ProGateCore && window.ProGateCore.isOwnerHash(location.hash)) location.hash = "#/";
  }

  let paint = 0, embedHot = null, embedBound = false, slateWatch = false;
  function panel(title, body) {
    if (!body) return "";
    return `<section class="card pro-frame ppv-panel"><h3 class="ppv-h">${PILL} ${title}</h3>${body}</section>`;
  }
  function insights(parts) {
    const inner = parts.filter(Boolean).join("");
    if (!inner) return EMPTY;
    return `<details class="pro-insights pro-frame" open><summary class="pro-insights-sum">${PILL} <span>Pro insights</span></summary><div class="pro-insights-body">${inner}</div></details>`;
  }
  function place(id, kind, html, anchorSel) {
    let host = document.getElementById(id);
    if (!host) {
      host = document.createElement("div");
      host.id = id;
      const list = Array.isArray(anchorSel) ? anchorSel : [anchorSel];
      const anchor = list.map(s => s && document.querySelector(s)).find(Boolean);
      const app = document.getElementById("app");
      if (anchor && anchor.parentNode) anchor.insertAdjacentElement("afterend", host);
      else if (app) app.insertBefore(host, app.firstChild);
      else return null;
    }
    host.className = "ppv-inject";
    host.dataset.proEnhance = kind;
    host.innerHTML = html;
    return host;
  }
  function spark(points, labelFmt) {
    const nums = (points || []).filter(v => typeof v === "number" && isFinite(v));
    if (!nums.length) return "";
    const w = 320, h = 88, pad = 10;
    let lo = Math.min(...nums), hi = Math.max(...nums);
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    const X = i => pad + (nums.length === 1 ? (w - pad * 2) / 2 : (i / (nums.length - 1)) * (w - pad * 2));
    const Y = v => pad + (1 - (v - lo) / (hi - lo)) * (h - pad * 2);
    const d = nums.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join("");
    const dots = nums.map((v, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="3.5"/>`).join("");
    return `<svg class="ppv-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Line history"><path d="${d}" fill="none"/>${dots}</svg><p class="na">${esc(labelFmt(nums[0]))} open → ${esc(labelFmt(nums[nums.length - 1]))} now</p>`;
  }
  function impliedPts(points) {
    return (points || []).map(v => {
      if (typeof v !== "number" || Math.abs(v) < 100) return null;
      return v > 0 ? 100 / (v + 100) : -v / (-v + 100);
    }).filter(v => v != null);
  }
  async function enhanceGame(ctx) {
    const api = A();
    if (!api || !ctx.lg || !ctx.id) return;
    let d = null;
    try { d = await api.getJSON(`data/${ctx.lg}/games/${ctx.id}.json`); } catch (e) { d = null; }
    const anchor = [".lm", "#line-movement-s", "#odds-s", ".pv-h1", "article.sx-game", ".cols"];
    if (!d || !d.game) {
      place("pro-game-panel", "game", `${flNote()}${EMPTY}`, anchor);
      return;
    }
    const g = d.game;
    const idx = await api.getJSON(`data/${ctx.lg}/index.json`).catch(() => null);
    const kind = (idx && idx.league && idx.league.kind) || "";
    const meta = api.meta ? api.meta() : null;
    const notes = (g.move && g.move.notable) || [];
    const sharp = notes.length
      ? panel("Sharp move", `<ul class="ppv-ul">${notes.map(n => `<li><span class="mvbadge">Sharp move</span> <span>${esc(n)}</span></li>`).join("")}</ul><p class="note">Same rule as the slate: a large spread move, a key number crossed, or a total that moved past the sport's bar. A description of the saved line, not a pick.</p>`)
      : "";
    const markets = F().historyMarkets(d.history);
    const spreadName = kind === "hockey" ? "Puck line" : kind === "baseball" ? "Run line" : "Spread";
    let charts = "";
    if (markets.length) {
      charts = markets.map(m => {
        const blocks = [
          [spreadName, m.spread, v => sgn(v)],
          [kind === "mma" ? "Total rounds" : "Total", m.total, v => String(v)],
          [`${g.away.abbr} ML`, m.awayML, v => am(v), true],
          [`${g.home.abbr} ML`, m.homeML, v => am(v), true],
        ];
        const body = blocks.map(([label, ser, fmt, ml]) => {
          if (!ser) return "";
          const pts = ml ? impliedPts(ser.points) : ser.points;
          const shown = spark(pts, ml ? (v => Math.round(v * 100) + "% implied") : fmt);
          if (!shown) return "";
          const ends = ml ? `<p class="na">${esc(fmt(ser.open))} open → ${esc(fmt(ser.current))} now</p>` : "";
          return `<div class="ppv-mk"><h4>${esc(label)}</h4>${shown}${ends}</div>`;
        }).filter(Boolean).join("");
        if (!body) return "";
        return `<h4 class="ppv-book">${esc(F().BOOK_NAME[m.book] || m.book)}</h4>${body}`;
      }).filter(Boolean).join("");
      if (charts) charts += `<p class="note">Each chart is the opening number in the file, then the recorded snapshots. Moneyline is drawn as implied win percent so a move across even money stays on one scale. The prices under it are the American odds.</p>`;
    }
    const cols = F().bookColumns(g);
    const bookHead = cols.map(k => `<th>${bookName(k)}</th>`).join("");
    const labels = [`${g.away.abbr} spread`, `${g.home.abbr} spread`, `${g.away.abbr} ML`, `${g.home.abbr} ML`, "Over", "Under"];
    const bookBody = cols.length ? labels.map(label => {
      const cells = cols.map(k => cell(g, k, label));
      if (!cells.some(Boolean)) return "";
      return `<tr><td>${esc(label)}</td>${cells.map(c => `<td class="num">${c || "—"}</td>`).join("")}</tr>`;
    }).join("") : "";
    const books = bookBody
      ? `<div class="tbl-wrap"><table class="books"><thead><tr><th>Market</th>${bookHead}</tr></thead><tbody>${bookBody}</tbody></table></div><p class="note">Only books with a number in the file get a column. Pinnacle isn't listed.</p>`
      : "";
    const best = bestTable(g);
    const info = F().refreshInfo((meta && meta.generated) || (idx && idx.generated) || "", Date.now());
    const fresh = info.ageHours == null ? "" : `<div class="statgrid"><div class="stat"><span class="sl">File age</span><b class="num">${esc(info.ageHours.toFixed(1) + " h")}</b><span class="ss">since the data file</span></div><div class="stat"><span class="sl">Cadence today</span><b class="num">about ${esc(String(info.cadenceMin))} min</b><span class="ss">how the site refreshes</span></div></div><p class="note">This panel does not fetch new odds.</p>`;
    const html = `${flNote()}${insights([sharp, panel("Line history", charts), panel("All books", books), panel("Best price", best), panel("File freshness", fresh)])}<p class="note"><span class="of-21">21+</span> Pro reads the lines already in the file. It isn't a pick. Confirm the price at the sportsbook.</p>`;
    place("pro-game-panel", "game", html, anchor);
  }
  function bestTable(g) {
    const bp = F().bestPrices(g);
    if (!bp.available) return "";
    const cols = [];
    for (const r of bp.rows) for (const q of r.quotes) if (!cols.includes(q.book)) cols.push(q.book);
    const head = cols.map(k => `<th>${bookName(k)}</th>`).join("");
    const body = bp.rows.map(r => {
      const by = Object.fromEntries(r.quotes.map(q => [q.book, q]));
      const cells = cols.map(k => {
        const q = by[k];
        if (!q) return `<td class="num">—</td>`;
        const on = r.best.includes(k);
        const text = r.kind === "ml" ? am(q.line) : r.kind === "spread" ? sgn(q.line) : String(q.line);
        const price = q.price == null || r.kind === "ml" ? "" : ` <span class="na">${esc(am(q.price))}</span>`;
        return `<td class="num${on ? " pro-best" : ""}"><b>${esc(text)}</b>${price}${on ? ` <span class="pro-best-tag">Best</span>` : ""}</td>`;
      }).join("");
      return `<tr><td>${esc(r.label)}</td>${cells}</tr>`;
    }).join("");
    return `<div class="tbl-wrap"><table class="books"><thead><tr><th>Market</th>${head}</tr></thead><tbody>${body}</tbody></table></div><p class="note">Highlighted when at least two books posted that market. The best number is the most favorable one in the file for that side: a higher spread or moneyline, a lower over, or a higher under. The price breaks a tie. It is not a suggestion to bet. Confirm the price at the sportsbook.</p>`;
  }
  function hotFilter(ctx) {
    const key = (ctx.lg || "") + "/" + (ctx.id || "");
    if (!embedHot || embedHot.key !== key) embedHot = { key, f: { lg: ctx.lg || "nfl", team: "", player: ctx.id || "", mk: "all" } };
    return embedHot.f;
  }
  async function enhanceProps(ctx) {
    const H = Hp();
    if (!H) return;
    const docs = await propsDocs();
    const f = hotFilter(ctx);
    const labels = H.SPORT_LABEL;
    const all = H.collect(docs);
    const sportAll = all.filter(r => r.lg === f.lg);
    const filtered = H.applyFilters(all, f);
    const teams = [...new Set(sportAll.map(r => r.team).filter(Boolean))].sort();
    const teamRows = f.team ? sportAll.filter(r => r.team === f.team || r.teamId === f.team) : sportAll;
    const players = [];
    const seenP = new Set();
    for (const r of teamRows) if (!seenP.has(r.pid)) { seenP.add(r.pid); players.push(r); }
    players.sort((a, b) => a.name.localeCompare(b.name));
    const playerRows = f.player ? teamRows.filter(r => r.pid === f.player || r.name.toLowerCase().includes(String(f.player).toLowerCase())) : teamRows;
    const mks = [];
    const seenM = new Set();
    for (const r of playerRows) if (!seenM.has(r.mk)) { seenM.add(r.mk); mks.push({ mk: r.mk, label: r.label }); }
    const opt = (val, text, on) => `<option value="${esc(val)}"${on ? " selected" : ""}>${text}</option>`;
    const teamSel = `<label class="vf-sel"><span>Team</span><select id="proHotTeam" aria-label="Team">${opt("", "All teams", !f.team)}${teams.map(t => opt(t, esc(t), t === f.team)).join("")}</select></label>`;
    const playerSel = `<label class="vf-sel"><span>Player</span><select id="proHotPlayer" aria-label="Player">${opt("", "All players", !f.player)}${players.map(p => opt(p.pid, `${esc(p.name)}${p.team ? ` (${esc(p.team)})` : ""}`, p.pid === f.player)).join("")}</select></label>`;
    const mkSel = `<label class="vf-sel"><span>Prop type</span><select id="proHotMk" aria-label="Prop type">${opt("all", "All props", f.mk === "all")}${mks.map(p => opt(p.mk, esc(p.label), p.mk === f.mk)).join("")}</select></label>`;
    const store = localStore();
    const saved = store ? H.readSaved(store) : [];
    const savedHtml = saved.length ? `<div class="chips ppv-saved" aria-label="Saved filters">${saved.map(s => `<span class="chip ppv-saved-chip"><button type="button" class="ppv-apply" data-pro-hot-apply="${esc(s.id)}">${esc(s.name)}</button><button type="button" class="ppv-x" data-pro-hot-del="${esc(s.id)}" aria-label="${esc("Delete saved filter " + s.name)}">×</button></span>`).join("")}</div>` : "";
    const file = docs[f.lg];
    let lists = "";
    if (file) {
      if (H.hasPrices(sportAll)) {
        const gaps = H.priceGaps(filtered).slice(0, 8);
        if (gaps.length) lists += `<h3 class="ppv-h">Price gaps on the same line</h3><div class="ppv-list">${gaps.map(g => `<div class="ppv-line"><span><b>${esc(g.name)} · ${esc(g.label)}</b><small>${esc(g.team)} · ${esc(quoteLine(g))}</small></span><span class="num"><b>${esc((g.gap * 100).toFixed(1))} pts</b></span></div>`).join("")}</div>`;
      }
      if (H.hasOpen(sportAll)) {
        const moves = H.lineMoves(filtered).slice(0, 8);
        if (moves.length) lists += `<h3 class="ppv-h">Prop line moves</h3><div class="ppv-list">${moves.map(m => `<div class="ppv-line"><span><b>${esc(m.name)} · ${esc(m.label)}</b><small>${esc(m.text)}</small></span><span class="num"><b>${m.delta > 0 ? "+" : ""}${esc(String(Math.round(m.delta * 10) / 10))}</b></span></div>`).join("")}</div>`;
      }
      const prefer = preferBooks();
      if (H.hotStreaks(sportAll, prefer).available) {
        const hot = H.hotStreaks(filtered, prefer).rows.slice(0, 8);
        if (hot.length) lists += `<h3 class="ppv-h">Hot streaks</h3><div class="ppv-list">${hot.map(h => `<div class="ppv-line"><span><b>${esc(h.name)} · ${esc(h.label)}</b><small>${esc(h.text)} in the last games played</small></span></div>`).join("")}</div><p class="note">Past results only, not a pick.</p>`;
      }
    }
    const html = `${flNote()}<p class="note">Built from the props file already on the site. Nothing here calls the odds provider. Saved filters stay in this browser.</p>
      <div class="ppv-frow" data-pro-hot>${teamSel}${playerSel}${mkSel}</div>
      <form id="proHotSave" class="ppv-form"><label class="vf-sel"><span>Save this filter</span><input name="name" maxlength="40" placeholder="Name" aria-label="Saved filter name"></label><button type="submit" class="chip">Save in this browser</button></form>
      <p class="ppv-out" id="proHotErr" role="alert"></p>
      ${savedHtml ? `<h3 class="ppv-h">Saved filters</h3>${savedHtml}` : `<h3 class="ppv-h">Saved filters</h3>`}
      ${lists || EMPTY}
      <p class="note"><span class="of-21">21+</span> A price gap is not a suggestion to bet either number.</p>`;
    place("pro-props-panel", "props", panel("Hot props", html), ["#lines-s", "#ppPlayer", ".sx-player", ".phero", "h1"]);
  }
  function enhanceBets() {
    const bets = loadBets();
    const anchor = [".bt-stats", ".bt-empty", ".page-head"];
    if (!bets.length) {
      place("pro-bets-panel", "bets", EMPTY, anchor);
      return;
    }
    const store = localStore();
    const tags = store ? F().readTags(store) : {};
    const C = window.BetCore;
    const clv = F().clvSummary(bets);
    const groups = F().tagGroups(bets, tags);
    const one = (label, list) => {
      const s = C ? C.stats(list) : { n: list.length, net: 0 };
      return `<div class="ppv-line"><span><b>${esc(label)}</b><small>${s.n} bet${s.n === 1 ? "" : "s"}</small></span><span class="num ${cls(s.net || 0)}"><b>${esc(money(s.net || 0, true))}</b></span></div>`;
    };
    const byType = C ? C.groupBy(bets, b => (C.TYPES && C.TYPES[b.type]) || b.type || "Bet") : [];
    const typeHtml = byType.length ? `<h3 class="ppv-h">Splits by type</h3><div class="ppv-list">${byType.map(r => one(r.key, bets.filter(b => ((C.TYPES && C.TYPES[b.type]) || b.type) === r.key))).join("")}</div>` : "";
    const tagHtml = groups.length ? `<h3 class="ppv-h">Splits by tag</h3><div class="ppv-list">${groups.map(g => one(g.tag === "untagged" ? "No tag" : g.tag, g.bets)).join("")}</div>` : "";
    const rows = bets.slice(0, 12).map(b => {
      const c = F().clvPoints(b, b.closeLine);
      const mine = tags[b.id] || [];
      const clvCell = clv.available ? `<td class="num">${c.available ? esc((c.delta > 0 ? "+" : "") + c.delta) : "—"}</td>` : "";
      return `<tr><td>${esc(betLabel(b))}</td>${clvCell}<td>${mine.map(t => `<span class="chip">${esc(t)}</span>`).join(" ")}${store ? `<form class="ppv-form" data-pro-tag="${esc(b.id)}"><input name="tag" maxlength="24" aria-label="Tag" placeholder="Tag"><button type="submit" class="chip">Add</button></form>` : ""}</td></tr>`;
    }).join("");
    const clvHead = clv.available ? `<th>CLV</th>` : "";
    const table = `<div class="tbl-wrap"><table class="books ppv-bets"><thead><tr><th>Bet</th>${clvHead}<th>Tags</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    const html = `${clvBlock(clv)}${typeHtml}${tagHtml}${table}<p class="note">Tags stay in this browser. They don't turn Pro on. <span class="of-21">21+</span></p>`;
    place("pro-bets-panel", "bets", panel("My Bets extras", html), anchor);
  }
  function enhanceSlate() {
    document.querySelectorAll("a.game").forEach(a => {
      const top = a.querySelector(".game-top");
      if (!top || top.querySelector("[data-pro-badge]")) return;
      const pub = top.querySelector(".mvbadge");
      if (!pub) return;
      const s = document.createElement("span");
      s.className = "pro-sharp pro-frame";
      s.dataset.proBadge = "1";
      s.title = "Pro · sharp move";
      s.innerHTML = `<span class="pro-pill">PRO</span><span class="pro-sharp-txt">Sharp</span>`;
      top.appendChild(s);
    });
  }
  let appWatch = false;
  function watchApp() {
    if (appWatch || !window.MutationObserver) return;
    const app = document.getElementById("app");
    if (!app) return;
    appWatch = true;
    let t = 0;
    new MutationObserver(() => {
      const ctx = window.LSProGate && window.LSProGate.context && window.LSProGate.context();
      if (!ctx || !proOn() || ctx.kind === "owner" || ctx.kind === "other") return;
      const want = ctx.kind === "game" || ctx.kind === "props" || ctx.kind === "bets";
      if (!want) return;
      if (document.querySelector(`[data-pro-enhance="${ctx.kind}"]`)) return;
      clearTimeout(t);
      t = setTimeout(() => { if (window.LSProApp) enhance(ctx); }, 40);
    }).observe(app, { childList: true });
  }
  function watchSlate() {
    if (slateWatch || !window.MutationObserver) return;
    const app = document.getElementById("app");
    if (!app) return;
    slateWatch = true;
    let t = 0;
    new MutationObserver(() => {
      const ctx = window.LSProGate && window.LSProGate.context && window.LSProGate.context();
      if (!ctx || (ctx.kind !== "home" && ctx.kind !== "league" && ctx.kind !== "results")) return;
      clearTimeout(t);
      t = setTimeout(() => { if (window.LSProApp) enhanceSlate(); }, 40);
    }).observe(app, { childList: true, subtree: true });
  }
  function refreshEmbed() {
    if (!proOn()) return;
    const ctx = window.LSProGate && window.LSProGate.context && window.LSProGate.context();
    if (!ctx) return;
    if (ctx.kind === "props") enhanceProps(ctx);
    else if (ctx.kind === "bets") enhanceBets();
  }
  function bindEmbed() {
    if (embedBound) return;
    embedBound = true;
    document.addEventListener("change", e => {
      const t = e.target;
      if (!t.closest || !t.closest("[data-pro-enhance]")) return;
      const f = embedHot && embedHot.f;
      if (!f) return;
      if (t.id === "proHotTeam") { f.team = t.value; f.player = ""; f.mk = "all"; }
      if (t.id === "proHotPlayer") { f.player = t.value; f.mk = "all"; }
      if (t.id === "proHotMk") f.mk = t.value;
      refreshEmbed();
    });
    document.addEventListener("submit", e => {
      const hot = e.target.closest && e.target.closest("#proHotSave");
      const tag = e.target.closest && e.target.closest("[data-pro-tag]");
      if (!hot && !tag) return;
      if (e.target.closest("[data-pro-owner]")) return;
      e.preventDefault();
      const store = localStore();
      if (hot) {
        const err = document.getElementById("proHotErr");
        if (!store || !Hp() || !embedHot) { if (err) err.textContent = "This browser isn't storing filters."; return; }
        const r = Hp().addSaved(store, { ...embedHot.f, name: new FormData(hot).get("name"), id: Date.now().toString(36) });
        if (!r.ok) { if (err) err.textContent = r.error; return; }
        refreshEmbed();
      }
      if (tag && store) {
        F().setTag(store, tag.dataset.proTag, new FormData(tag).get("tag"), true);
        refreshEmbed();
      }
    });
    document.addEventListener("click", e => {
      const del = e.target.closest && e.target.closest("[data-pro-hot-del]");
      const apply = e.target.closest && e.target.closest("[data-pro-hot-apply]");
      if (!del && !apply) return;
      if (e.target.closest("[data-pro-owner]")) return;
      e.preventDefault();
      const store = localStore();
      const H = Hp();
      if (!store || !H || !embedHot) return;
      if (del) H.removeSaved(store, del.dataset.proHotDel);
      if (apply) {
        const row = H.readSaved(store).find(s => s.id === apply.dataset.proHotApply);
        if (row) embedHot.f = { lg: embedHot.f.lg, team: row.team || "", player: row.player || "", mk: row.mk || "all" };
      }
      refreshEmbed();
    });
  }
  function proOn() {
    const g = window.LSProGate;
    if (g && g.verified && !g.verified()) return false;
    return true;
  }
  async function enhance(ctx) {
    if (!proOn()) return;
    const n = ++paint;
    ctx = ctx || {};
    addNav();
    document.querySelectorAll("[data-pro-enhance]").forEach(el => { if (el.dataset.proEnhance !== ctx.kind) el.remove(); });
    if (ctx.kind !== "home" && ctx.kind !== "league" && ctx.kind !== "results") document.querySelectorAll("[data-pro-badge]").forEach(el => el.remove());
    if (ctx.kind === "owner" || ctx.kind === "other") return;
    try {
      if (ctx.kind === "game") await enhanceGame(ctx);
      else if (ctx.kind === "props") await enhanceProps(ctx);
      else if (ctx.kind === "bets") enhanceBets();
      else if (ctx.kind === "home" || ctx.kind === "league" || ctx.kind === "results") enhanceSlate();
    } catch (e) { console.warn(e); }
    if (n !== paint) return;
  }
  window.LSProApp = { view, boot, hide, enhance, alertCap: window.ProFeatures.ACTIVE_PRO };
})();
