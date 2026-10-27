// LineSmart weekly email: pure selection + rendering (no network), unit-tested by scripts/newsletter_test.mjs.
// Input is the site's own published data (data/meta.json, data/<lg>/index.json, data/props/<lg>.json); nothing here
// calls a sportsbook or odds API. scripts/newsletter.mjs fetches the files, renders, and (only when enabled) sends.
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const P = require("../site/assets/props-core.js");

export const BOOKS = [["hardrockbet", "Hard Rock Bet"], ["draftkings", "DraftKings"], ["fanduel", "FanDuel"]];
export const BOOK_NAME = Object.fromEntries(BOOKS);
const TZ = "America/New_York";
const isNum = v => typeof v === "number" && isFinite(v);

// Words the email must never use (hype / guarantees / promos). Checked on the template copy in tests and before every send.
export const BANNED = [/\blocks?\b/i, /\blocked\b/i, /\bguarantee[ds]?\b/i, /\bcan[’']?t lose\b/i, /\bcannot lose\b/i, /\bfree money\b/i,
  /\bpromo(tion)?s?\b/i, /\bbonus\b/i, /\bcoupon/i, /\brisk[- ]free\b/i, /\bsure thing\b/i, /\bsure bet\b/i];
export function bannedIn(text) { const t = String(text).replace(/<[^>]+>/g, " "); return BANNED.filter(r => r.test(t)).map(r => (t.match(r) || [])[0]); }

// ---------------------------------------------------------------- odds helpers
export const implied = a => (a > 0 ? 100 / (a + 100) : -a / (-a + 100));
/** American odds on one continuous scale so "cents" work across +/-100: -105 -> -5, +100 -> 0, +154 -> 54. */
export const centsScale = a => (a > 0 ? a - 100 : a + 100);
export const fmtOdds = a => (!isNum(a) ? "—" : a > 0 ? `+${a}` : `\u2212${Math.abs(a)}`);
export const fmtNum = v => (Number.isInteger(v) ? String(v) : (Math.round(v * 10) / 10).toFixed(1));
export const fmtSpread = v => (!isNum(v) ? "—" : v === 0 ? "PK" : v > 0 ? `+${fmtNum(v)}` : `\u2212${fmtNum(-v)}`);
const fmtD = (iso, o) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, ...o }).format(new Date(iso));
export const kickoffET = iso => `${fmtD(iso, { weekday: "short", month: "short", day: "numeric" })}, ${fmtD(iso, { hour: "numeric", minute: "2-digit" })} ET`;
export const dateET = iso => fmtD(iso, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
export const ymdET = iso => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso)).map(x => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}`; };

export function upcoming(g, nowMs, days) {
  const t = Date.parse(g && g.date);
  return !!g && g.state === "pre" && isFinite(t) && t > nowMs && t <= nowMs + days * 864e5;
}

/** Live prices for one side of one market: [{key, line, price}] (stale books and books without a price are skipped). */
export function offers(g, market, side) {
  const out = [];
  for (const [key] of BOOKS) {
    const b = g.books && g.books[key];
    if (!b || b.stale) continue;
    let line = null, price;
    if (market === "ml") price = b[side + "ML"];
    else if (market === "spread") { line = b[side + "Spread"]; price = b[side + "SpreadOdds"]; }
    else { line = b.total; price = b[side + "Odds"]; }
    // spread sanity: the side laying points must not be the moneyline underdog at the same book (feed glitch)
    if (market === "spread" && isNum(line) && line !== 0 && isNum(b.homeML) && isNum(b.awayML) && b.homeML !== b.awayML) {
      const sideFav = side === "home" ? b.homeML < b.awayML : b.awayML < b.homeML;
      if ((line < 0) !== sideFav) continue;
    }
    if (isNum(price) && (market === "ml" || isNum(line))) out.push({ key, line, price });
  }
  return out;
}

/** League-balanced pick from rows already ranked best-first: up to `cap` per league in the configured league order,
 *  then any slots left go to the best remaining rows. Output keeps league order (NFL first), rank within a league. */
export function perLeague(rows, cap, limit, order = []) {
  const ix = lg => (order.indexOf(lg) + 1) || 99;
  const lgs = [...new Set(rows.map(r => r.lg))].sort((a, b) => ix(a) - ix(b));
  const take = new Set();
  for (const lg of lgs) rows.filter(r => r.lg === lg).slice(0, cap).forEach(r => { if (take.size < limit) take.add(r); });
  for (const r of rows) if (take.size < limit) take.add(r);
  return rows.filter(r => take.has(r)).map((r, i) => [r, i]).sort((a, b) => ix(a[0].lg) - ix(b[0].lg) || a[1] - b[1]).map(x => x[0]);
}

const SIDES = [["ml", "away"], ["ml", "home"], ["spread", "away"], ["spread", "home"], ["total", "over"], ["total", "under"]];
function betLabel(g, market, side, line) {
  if (market === "ml") return `${g[side].abbr} moneyline`;
  if (market === "spread") return `${g[side].abbr} ${fmtSpread(line)}`;
  return `${side === "over" ? "Over" : "Under"} ${fmtNum(line)}`;
}

/** Same bet, same number, different price: the biggest gaps (in implied probability), one per game. */
export function pickPrices(games, limit = 8, order = [], cap = 3) {
  const best = new Map();
  for (const { lg, g } of games) {
    for (const [market, side] of SIDES) {
      const offs = offers(g, market, side);
      if (offs.length < 2) continue;
      let L = null;
      if (market !== "ml") {
        const cnt = new Map(); offs.forEach(o => cnt.set(o.line, (cnt.get(o.line) || 0) + 1));
        const top = Math.max(...cnt.values()), cands = [...cnt.keys()].filter(l => cnt.get(l) === top);
        L = cands.length === 1 ? cands[0] : ((offs.find(o => o.key === "draftkings" && cands.includes(o.line)) || offs.find(o => cands.includes(o.line))).line);
      }
      const same = offs.filter(o => market === "ml" || o.line === L);
      if (market === "ml" && same.some(o => o.price < -400 || o.price > 400)) continue;   // skip long shots / heavy favorites
      if (same.length < 2) continue;
      const hi = Math.max(...same.map(o => o.price)), lo = Math.min(...same.map(o => o.price));
      const gap = implied(lo) - implied(hi);
      if (gap < 0.004) continue;   // under ~2 cents: not worth a line in the email
      const row = { type: "price", lg, g, market, side, line: L, label: betLabel(g, market, side, L),
        cells: offs.map(o => ({ ...o, off: market !== "ml" && o.line !== L, best: (market === "ml" || o.line === L) && o.price === hi })),
        bestKeys: same.filter(o => o.price === hi).map(o => o.key), worst: same.find(o => o.price === lo),
        hi, lo, gap, cents: centsScale(hi) - centsScale(lo) };
      const k = g.id, cur = best.get(k);
      if (!cur || row.gap > cur.gap) best.set(k, row);
    }
  }
  return perLeague([...best.values()].sort((a, b) => b.gap - a.gap || Date.parse(a.g.date) - Date.parse(b.g.date)), cap, limit, order);
}

/** Books posting different numbers on the same spread / total (a half point or more apart). */
export function pickNumbers(games, limit = 4, order = [], cap = 2) {
  const rows = [];
  for (const { lg, g } of games) {
    for (const market of ["spread", "total"]) {
      const side = market === "spread" ? "away" : "over";
      const offs = offers(g, market, side);
      if (offs.length < 2) continue;
      const lines = offs.map(o => o.line), diff = Math.max(...lines) - Math.min(...lines);
      if (diff < 0.5 || diff > 3) continue;                                         // >3 pts apart is more likely a feed error than a real market
      if (market === "spread" && Math.min(...lines) < 0 && Math.max(...lines) > 0) continue;   // books disagree on the favorite: skip
      rows.push({ type: "number", lg, g, market, diff, cells: offs, hiLine: Math.max(...lines), loLine: Math.min(...lines) });
    }
  }
  return perLeague(rows.sort((a, b) => b.diff - a.diff || (a.market === "spread" ? -1 : 1) || Date.parse(a.g.date) - Date.parse(b.g.date)), cap, limit, order);
}

/** Props that went over in at least 4 of the player's last 5 games played, against this week's line. */
export function pickProps(propDocs, gameById, nowMs, days, limit = 8) {
  const perLg = [];
  for (const { lg, doc } of propDocs) {
    const list = [], seen = new Set();
    for (const [gid, pg] of Object.entries((doc && doc.games) || {})) {
      const g = gameById.get(`${lg}:${gid}`);
      if (!g || !upcoming(g, nowMs, days)) continue;
      for (const row of pg.props || []) {
        const [pid, mk, line, , tally] = row;
        const pl = doc.players && doc.players[pid];
        if (!pl || !isNum(line)) continue;
        const r = P.rate(pl.log, mk, line, 5);
        if (!(r.n >= 4 && r.o >= 4)) continue;
        const books = P.rowBooks(row).filter(b => b.line === line && isNum(b.over));
        const top = books.length ? Math.max(...books.map(b => b.over)) : null;
        list.push({ lg, g, gid, pid, name: pl.n, team: pl.ta, pos: pl.pos, mk, label: ((doc.markets || {})[mk] || [mk])[0], line, r,
          season: P.season(tally), over: top, overKeys: books.filter(b => b.over === top).map(b => b.key), pricedBy: books.length });
      }
    }
    list.sort((a, b) => b.r.o / b.r.n - a.r.o / a.r.n || b.r.o - a.r.o || (b.season.pct ?? -1) - (a.season.pct ?? -1) || (a.mk === "anytime_td") - (b.mk === "anytime_td") || Date.parse(a.g.date) - Date.parse(b.g.date));
    const out = []; let td = 0;
    for (const x of list) {
      if (seen.has(x.pid)) continue;                    // one prop per player
      if (x.mk === "anytime_td" && td >= 3) continue;   // keep some variety
      seen.add(x.pid); if (x.mk === "anytime_td") td++;
      out.push(x);
    }
    perLg.push(out);
  }
  // share the slots between leagues (in config order), then fill leftovers
  const quota = Math.ceil(limit / Math.max(1, perLg.length)), res = [];
  perLg.forEach(l => res.push(...l.slice(0, quota)));
  for (const l of perLg) for (const x of l.slice(quota)) if (res.length < limit) res.push(x);
  return res.slice(0, limit);
}

/** Biggest line moves since open on upcoming games (the site's own move summary). */
export function pickMoves(games, limit = 6, order = [], cap = 2) {
  const rows = [];
  for (const { lg, g } of games) {
    const m = g.move;
    if (!m || !Array.isArray(m.notable) || !m.notable.length) continue;
    const sp = m.spread && isNum(m.spread.delta) && m.spread.delta !== 0 ? m.spread : null;
    const tot = m.total && isNum(m.total.delta) && m.total.delta !== 0 ? m.total : null;
    if (!sp && !tot) continue;
    const score = isNum(m.points) ? m.points : Math.abs(sp ? sp.delta : 0) * 2 + Math.abs(tot ? tot.delta : 0);
    rows.push({ lg, g, book: m.book, spread: sp, total: tot, notable: m.notable.filter(n => !/^(Spread|Total) moved/i.test(n)), score });
  }
  return perLeague(rows.sort((a, b) => b.score - a.score || Date.parse(a.g.date) - Date.parse(b.g.date)), cap, limit, order);
}

/** Everything the email needs, from the site's data files. */
export function buildIssue({ meta, indexes, props, now, cfg }) {
  const nowMs = Date.parse(now), days = cfg.windowDays || 7, L = cfg.limits || {};
  const games = [], gameById = new Map();
  for (const { lg, index } of indexes) for (const g of (index && index.games) || []) {
    gameById.set(`${lg}:${g.id}`, g);
    if (upcoming(g, nowMs, days)) games.push({ lg, g });
  }
  const asOf = [meta && meta.hardrock && meta.hardrock.asOf, meta && meta.generated].filter(Boolean).sort().pop() || now;
  return {
    now, asOf, issueDate: ymdET(now),
    prices: pickPrices(games, L.prices ?? 8, cfg.leagues, L.perLeague ?? 3),
    numbers: pickNumbers(games, L.numbers ?? 4, cfg.leagues, 2),
    props: pickProps(props, gameById, nowMs, days, L.props ?? 8),
    moves: pickMoves(games, L.moves ?? 6, cfg.leagues, 2),
    gamesInWindow: games.length,
  };
}
export const isEmptyIssue = d => !d.prices.length && !d.numbers.length && !d.props.length && !d.moves.length;

// ---------------------------------------------------------------- rendering
const C = { bg: "#050b1c", card: "#0c1630", card2: "#111d3c", line: "#1d2b52", txt: "#e8eeff", mute: "#a3b3d9", dim: "#7f90ba", blue: "#3d9bff", cyan: "#22e1ff", bestBg: "#0b2c42", bestLine: "#1f7a96", pos: "#34d399", warn: "#fbbf24" };
const FONT = "Inter,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const LGN = { nfl: "NFL", ncaaf: "College football", nba: "NBA", nhl: "NHL", ncaab: "College basketball", mlb: "MLB" };
const escHTML = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/**
 * Render the email. opts.unsubUrl: this recipient's one-click link. opts.lint: replace every data value with "X" so the
 * banned-word check sees only our own copy (player names like "Drew Lock" are data, not copy).
 * Returns {subject, preheader, html, text}.
 */
export function renderEmail(d, cfg, opts = {}) {
  const lint = !!opts.lint;
  const v = s => escHTML(lint ? "X" : s);                // data values
  const site = (cfg.siteUrl || "https://linesmart.app").replace(/\/$/, "");
  const unsub = opts.unsubUrl || `${site}/unsubscribe.html`;
  const addr = String(cfg.mailingAddress || "").trim();
  const gameUrl = r => `${site}/#/g/${r.lg}/${encodeURIComponent(r.g.id)}`;
  const gameHead = r => `<a href="${gameUrl(r)}" style="color:${C.txt};text-decoration:none;font-weight:700">${v(r.g.shortName)}</a> <span style="color:${C.dim}">· ${v(LGN[r.lg] || r.lg.toUpperCase())} · ${v(kickoffET(r.g.date))}</span>`;
  const issueDay = dateET(d.now), shortDay = fmtD(d.now, { month: "short", day: "numeric" });
  const subject = `LineSmart Weekly, ${shortDay}: best lines, hot props, line moves`;
  const counts = [d.prices.length && `${d.prices.length} price gaps`, d.props.length && `${d.props.length} hot props`, d.moves.length && `${d.moves.length} line moves`].filter(Boolean);
  const preheader = counts.length ? `${counts.join(", ")} across Hard Rock Bet, DraftKings and FanDuel for the week ahead.` : "This week's lines across Hard Rock Bet, DraftKings and FanDuel.";

  const P_ = (html, st = "") => `<p style="margin:0 0 10px;font-size:14px;line-height:1.55;color:${C.mute};${st}">${html}</p>`;
  const card = inner => `<tr><td style="padding:0 0 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.card};border:1px solid ${C.line};border-radius:14px"><tr><td style="padding:14px 16px">${inner}</td></tr></table></td></tr>`;
  const section = (title, sub, rows) => `<tr><td style="padding:22px 0 10px"><div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:${C.cyan};font-weight:800">${title}</div><div style="font-size:13px;color:${C.dim};margin-top:3px;line-height:1.5">${sub}</div></td></tr>${rows}`;
  const cell = (key, top, bottom, best) => `<td width="33%" valign="top" style="padding:3px"><div style="border:1px solid ${best ? C.bestLine : C.line};background:${best ? C.bestBg : C.card2};border-radius:10px;padding:8px 6px;text-align:center">
    <div style="font-size:11px;color:${C.dim};font-weight:700;white-space:nowrap">${BOOK_NAME[key]}${key === "hardrockbet" ? ` <span style="color:${C.warn}">FL</span>` : ""}</div>
    <div style="font-size:16px;font-weight:800;color:${best ? C.cyan : C.txt};margin-top:2px;white-space:nowrap">${top}</div>${bottom ? `<div style="font-size:11px;color:${C.dim};white-space:nowrap">${bottom}</div>` : ""}</div></td>`;
  const cells = list => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px"><tr>${BOOKS.map(([k]) => { const c = list.find(x => x.key === k); return c ? c.html : cell(k, `<span style="color:${C.dim};font-weight:600;font-size:13px">not posted</span>`, "", false); }).join("")}</tr></table>`;

  // ---- best prices
  const priceRows = d.prices.map(r => card(`<div style="font-size:13px;line-height:1.45">${gameHead(r)}</div>
    <div style="font-size:16px;font-weight:800;color:${C.txt};margin-top:4px">${v(r.label)}</div>
    ${cells(r.cells.map(c => ({ key: c.key, html: cell(c.key, v(fmtOdds(c.price)), c.off ? `at ${v(r.market === "spread" ? fmtSpread(c.line) : fmtNum(c.line))}` : r.market === "ml" ? "" : v(r.market === "spread" ? fmtSpread(c.line) : fmtNum(c.line)), c.best) })))}
    <div style="font-size:12.5px;color:${C.mute};margin-top:8px">Best: <b style="color:${C.cyan}">${v(r.bestKeys.map(k => BOOK_NAME[k]).join(" / "))} ${v(fmtOdds(r.hi))}</b>, ${v(r.cents)}¢ better than ${v(BOOK_NAME[r.worst.key])} ${v(fmtOdds(r.lo))}.</div>`)).join("");
  const numRows = d.numbers.map(r => {
    const hiK = r.cells.filter(c => c.line === r.hiLine).map(c => BOOK_NAME[c.key]).join(" / "), loK = r.cells.filter(c => c.line === r.loLine).map(c => BOOK_NAME[c.key]).join(" / ");
    const fmt = x => (r.market === "spread" ? fmtSpread(x) : fmtNum(x));
    const note = r.market === "spread"
      ? `${v(r.g.away.abbr)} gets the most points at ${v(hiK)} (${v(fmt(r.hiLine))}); ${v(r.g.home.abbr)} lays the fewest at ${v(loK)} (${v(fmtSpread(-r.loLine))}).`
      : `Lowest total for an over: ${v(loK)} (${v(fmt(r.loLine))}). Highest for an under: ${v(hiK)} (${v(fmt(r.hiLine))}).`;
    return card(`<div style="font-size:13px;line-height:1.45">${gameHead(r)}</div>
      <div style="font-size:16px;font-weight:800;color:${C.txt};margin-top:4px">${r.market === "spread" ? `${v(r.g.away.abbr)} spread` : "Game total"} <span style="font-size:12.5px;font-weight:600;color:${C.dim}">· books ${v(fmtNum(r.diff))} pt${r.diff === 1 ? "" : "s"} apart</span></div>
      ${cells(r.cells.map(c => ({ key: c.key, html: cell(c.key, v(fmt(c.line)), v(fmtOdds(c.price)), false) })))}
      <div style="font-size:12.5px;color:${C.mute};margin-top:8px">${note}</div>`);
  }).join("");
  const pricesBlock = (priceRows || numRows)
    ? section("Best lines this week", `Same bet, different price at Hard Rock Bet, DraftKings and FanDuel. Odds as of ${v(kickoffET(d.asOf))}; lines move, so check the book before you bet.`, priceRows + (numRows ? `<tr><td style="padding:6px 0 8px;font-size:13px;color:${C.mute};font-weight:700">Different numbers</td></tr>${numRows}` : ""))
    : section("Best lines this week", "No meaningful price differences between the three books right now. Check the site for live lines.", "");

  // ---- hot props
  const propRows = d.props.map(x => {
    const strip = x.mk === "anytime_td" ? `Scored a TD in <b style="color:${C.pos}">${v(x.r.o)} of his last ${v(x.r.n)}</b> games` : `Went over ${v(fmtNum(x.line))} in <b style="color:${C.pos}">${v(x.r.o)} of his last ${v(x.r.n)}</b> games`;
    const price = isNum(x.over) ? `Best over price: <b style="color:${C.txt}">${v(fmtOdds(x.over))}</b> at ${v(x.overKeys.map(k => BOOK_NAME[k]).join(" / "))}` : "DraftKings line (no prices posted yet)";
    return card(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td valign="top"><a href="${site}/#/p/${x.lg}/${encodeURIComponent(x.pid)}" style="font-size:15px;font-weight:800;color:${C.txt};text-decoration:none">${v(x.name)}</a> <span style="font-size:12px;color:${C.dim}">${v([x.team, x.pos].filter(Boolean).join(" · "))}</span>
        <div style="font-size:14px;color:${C.txt};margin-top:3px">${x.mk === "anytime_td" ? "<b>Anytime TD</b>" : `${v(x.label)} <b>over ${v(fmtNum(x.line))}</b>`}</div></td>
      <td valign="top" align="right" style="white-space:nowrap"><span style="display:inline-block;background:${C.bestBg};border:1px solid ${C.bestLine};color:${C.cyan};font-weight:800;font-size:13px;border-radius:999px;padding:3px 10px">${v(x.r.o)}/${v(x.r.n)}</span></td></tr></table>
      <div style="font-size:12.5px;color:${C.mute};margin-top:6px;line-height:1.5">${strip}${x.season.n ? ` · season ${v(x.season.o)}/${v(x.season.n)}` : ""}<br>${price}<br><span style="color:${C.dim}">${gameHead(x)}</span></div>`);
  }).join("");
  const propsBlock = section("Hot props", "Player props that went over in at least 4 of the player's last 5 games, graded against this week's line. Past results don't predict future ones.",
    propRows || card(P_("No props hit that bar for this week's games yet. Props post closer to game time; see them on the site.", "margin:0")));

  // ---- line moves
  const moveRows = d.moves.map(r => {
    const bits = [];
    if (r.spread) bits.push(`Spread <b style="color:${C.txt}">${v(r.g.home.abbr)} ${v(fmtSpread(r.spread.open))} → ${v(fmtSpread(r.spread.cur))}</b>`);
    if (r.total) bits.push(`Total <b style="color:${C.txt}">${v(fmtNum(r.total.open))} → ${v(fmtNum(r.total.cur))}</b>`);
    return card(`<div style="font-size:13px;line-height:1.45">${gameHead(r)}</div>
      <div style="font-size:14px;color:${C.mute};margin-top:5px;line-height:1.6">${bits.join(" &nbsp;·&nbsp; ")}</div>
      ${r.notable.length ? `<div style="margin-top:6px">${r.notable.map(n => `<span style="display:inline-block;font-size:11.5px;font-weight:700;color:${C.warn};border:1px solid #5a4a1a;border-radius:999px;padding:2px 9px;margin:2px 4px 0 0">${v(n)}</span>`).join("")}</div>` : ""}
      <div style="font-size:11.5px;color:${C.dim};margin-top:6px">${v(BOOK_NAME[r.book] || "DraftKings")}, opening line to now</div>`);
  }).join("");
  const movesBlock = section("Notable line moves", "Games where the spread or total has moved the most since it opened.", moveRows || card(P_("No big moves on this week's games so far.", "margin:0")));

  // ---- plug
  const plug = `<tr><td style="padding:22px 0 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.card2};border:1px solid ${C.bestLine};border-radius:14px"><tr><td style="padding:18px">
    <div style="font-size:16px;font-weight:800;color:${C.txt}">Track your bets free</div>
    ${P_("My Bets on LineSmart logs every bet you place at any sportsbook and shows your real profit, ROI and record by sport, bet type and book. No sportsbook login needed, and it stays private on your device unless you choose to sync.", "margin:6px 0 12px")}
    <a href="${site}/#/bets" style="display:inline-block;background:${C.blue};color:#00132e;font-weight:800;font-size:14px;text-decoration:none;padding:10px 18px;border-radius:10px">Open My Bets</a>
  </td></tr></table></td></tr>`;

  // ---- footer (CAN-SPAM + responsible gambling)
  const addrHTML = addr ? v(addr) : `<span style="color:${C.warn};font-weight:700">[MAILING ADDRESS NOT SET: sending to subscribers is blocked]</span>`;
  const footer = `<tr><td style="padding:26px 4px 8px;border-top:1px solid ${C.line};font-size:12px;line-height:1.65;color:${C.dim}">
    <p style="margin:0 0 8px;color:${C.mute};font-weight:700">21+ | Gambling problem? Call 1-800-GAMBLER</p>
    <p style="margin:0 0 8px">Florida: Hard Rock Bet is the only legal online sportsbook in Florida. DraftKings and FanDuel prices are shown for comparison where they're legal. In Florida you can also call or text 1-833-PLAYWISE.</p>
    <p style="margin:0 0 8px">LineSmart is an informational site and doesn't take bets. Odds change often; confirm with the sportsbook. Nothing here is betting advice. This email has no affiliate links.</p>
    <p style="margin:0 0 8px">You're getting this because you signed up at linesmart.app and confirmed your email. <a href="${escHTML(unsub)}" style="color:${C.cyan};font-weight:700">Unsubscribe</a> (one click) · <a href="${site}/privacy.html#newsletter" style="color:${C.cyan}">Privacy</a> · <a href="mailto:${escHTML(cfg.contact || "contact@linesmart.app")}" style="color:${C.cyan}">${escHTML(cfg.contact || "contact@linesmart.app")}</a></p>
    <p style="margin:0">LineSmart · ${addrHTML}</p>
  </td></tr>`;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">
<title>${escHTML(subject)}</title></head>
<body style="margin:0;padding:0;background:${C.bg};color:${C.txt};font-family:${FONT};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.bg}">${v(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
<tr><td style="padding:0 4px 6px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
  <td><a href="${site}/" style="text-decoration:none;font-size:22px;font-weight:800;letter-spacing:-.02em;color:${C.txt}"><img src="${site}/assets/brand/icon-192.png" width="28" height="28" alt="" style="vertical-align:-7px;border-radius:7px;margin-right:8px">Line<span style="color:${C.blue}">Smart</span></a></td>
  <td align="right" style="font-size:12px;color:${C.dim}">Weekly · ${v(issueDay)}</td></tr></table></td></tr>
<tr><td style="padding:14px 4px 0"><div style="font-size:24px;line-height:1.25;font-weight:800;color:${C.txt};letter-spacing:-.02em">Best lines, hot props and line moves for the week</div>
  <div style="font-size:14px;line-height:1.55;color:${C.mute};margin-top:8px">The biggest price differences across Hard Rock Bet, DraftKings and FanDuel, props on a 4-of-5 run, and where the numbers have moved. All from <a href="${site}/" style="color:${C.cyan}">linesmart.app</a>, free.</div></td></tr>
${pricesBlock}${propsBlock}${movesBlock}${plug}${footer}
</table></td></tr></table></body></html>`;

  // plain-text part
  const T = [];
  T.push(`LINESMART WEEKLY · ${issueDay}`, "Best lines, hot props and line moves for the week", "");
  T.push("BEST LINES THIS WEEK", `Odds as of ${kickoffET(d.asOf)}. Lines move; check the book before you bet.`);
  for (const r of d.prices) T.push(`- ${r.g.shortName} (${kickoffET(r.g.date)}): ${r.label}: ` + r.cells.map(c => `${BOOK_NAME[c.key]} ${c.off ? `(at ${r.market === "spread" ? fmtSpread(c.line) : fmtNum(c.line)}) ` : ""}${fmtOdds(c.price)}`).join(", ") + ` -> best ${r.bestKeys.map(k => BOOK_NAME[k]).join("/")} (${r.cents}c better)`);
  for (const r of d.numbers) T.push(`- ${r.g.shortName}: ${r.market === "spread" ? r.g.away.abbr + " spread" : "total"} ` + r.cells.map(c => `${BOOK_NAME[c.key]} ${r.market === "spread" ? fmtSpread(c.line) : fmtNum(c.line)} ${fmtOdds(c.price)}`).join(", "));
  if (!d.prices.length && !d.numbers.length) T.push("- No meaningful price differences right now.");
  T.push("", "HOT PROPS (over in 4+ of last 5 games; past results don't predict future ones)");
  for (const x of d.props) T.push(`- ${x.name} (${x.team}): ${x.mk === "anytime_td" ? "Anytime TD" : `${x.label} over ${fmtNum(x.line)}`}: ${x.r.o}/${x.r.n}${isNum(x.over) ? `, best over ${fmtOdds(x.over)} at ${x.overKeys.map(k => BOOK_NAME[k]).join("/")}` : ""} · ${x.g.shortName}`);
  if (!d.props.length) T.push("- None this week yet.");
  T.push("", "NOTABLE LINE MOVES (opening line to now)");
  for (const r of d.moves) T.push(`- ${r.g.shortName}: ` + [r.spread && `spread ${r.g.home.abbr} ${fmtSpread(r.spread.open)} -> ${fmtSpread(r.spread.cur)}`, r.total && `total ${fmtNum(r.total.open)} -> ${fmtNum(r.total.cur)}`].filter(Boolean).join(", ") + (r.notable.length ? ` (${r.notable.join("; ")})` : ""));
  if (!d.moves.length) T.push("- No big moves yet.");
  T.push("", `TRACK YOUR BETS FREE: ${site}/#/bets`, "", "21+ | Gambling problem? Call 1-800-GAMBLER",
    "Florida: Hard Rock Bet is the only legal online sportsbook in Florida. DraftKings and FanDuel are shown for comparison where legal.",
    "LineSmart is informational and doesn't take bets. No affiliate links.", `Unsubscribe (one click): ${unsub}`,
    `LineSmart · ${addr || "[MAILING ADDRESS NOT SET]"}`);
  const text = lint ? T.join("\n").replace(/[^\n]+/g, l => (/^- /.test(l) ? "- X" : l)) : T.join("\n");
  return { subject, preheader, html, text };
}

/** Per-recipient unsubscribe URL + headers. No List-Unsubscribe-Post: a static page can't accept the RFC 8058 POST. */
export function unsubFor(cfg, token) {
  const site = (cfg.siteUrl || "https://linesmart.app").replace(/\/$/, "");
  const url = `${site}/unsubscribe.html?t=${encodeURIComponent(token)}`;
  return { url, headers: { "List-Unsubscribe": `<${url}>, <mailto:${cfg.contact || "contact@linesmart.app"}?subject=unsubscribe>` } };
}

/** Why sending must stop, or "" if it may go ahead. */
export function sendBlockers({ cfg, mode, recipients = [], issue }) {
  const out = [];
  if (mode === "send" && !String(cfg.mailingAddress || "").trim()) out.push("mailing address is empty (set mailingAddress in scripts/newsletter.config.json or the NEWSLETTER_MAILING_ADDRESS variable)");
  if (mode === "send" && recipients.length > (cfg.maxRecipients || 80)) out.push(`${recipients.length} recipients is over maxRecipients=${cfg.maxRecipients || 80} (Resend free plan: 100 emails/day, shared with sign-in codes); move to Resend Broadcasts or a paid plan first`);
  if (issue && isEmptyIssue(issue)) out.push("no data for any section (data files empty or stale)");
  return out;
}
