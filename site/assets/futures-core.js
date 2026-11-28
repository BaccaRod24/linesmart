/* Futures tab: outright winner prices. Pure render (no DOM, no network).
 * Browser: window.FuturesCore. Node tests: require("./futures-core.js").
 * Prices are reference data. This file never says DraftKings or FanDuel are legal in Florida,
 * and it never marks a DraftKings or FanDuel price as the bettable best for a Florida visitor. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FuturesCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const BOOKS = [["draftkings", "DraftKings"], ["fanduel", "FanDuel"]];

  function am(n) {
    if (n == null || n === "" || isNaN(n)) return null;
    const v = Number(n);
    return (v > 0 ? "+" : "") + v;
  }
  function implied(a) {
    if (a == null || a === "" || isNaN(a) || Number(a) === 0) return null;
    const n = Number(a);
    return n > 0 ? 100 / (n + 100) : -n / (-n + 100);
  }
  // Lower implied probability pays the bettor more.
  function better(a, b) {
    const ia = implied(a), ib = implied(b);
    if (ia == null) return false;
    if (ib == null) return true;
    return ia < ib - 1e-12;
  }

  // Unknown state: same rule as GeoCore.isAvailable (no state yet, so books are not hidden).
  function legal(ev, key) {
    if (!ev || !ev.state || ev.status === "unknown") return true;
    return (ev.available || []).indexOf(key) >= 0;
  }
  function isFL(ev) {
    return !!(ev && ev.state === "FL" && ev.status && ev.status !== "unknown");
  }
  function hardrockPosted(doc) {
    return (doc && doc.markets || []).some(m => m && (m.hardrock || (m.outcomes || []).some(r => r && r.hardrockbet != null)));
  }

  // The bettable column, or null when nothing we show can be bet in this state.
  // Florida never treats DraftKings or FanDuel as that column.
  function bettableBook(row, ev) {
    if (!row || isFL(ev)) return null;
    let book = null, px = null;
    for (const [key] of BOOKS) {
      if (!legal(ev, key) || row[key] == null) continue;
      if (px == null || better(row[key], px)) { book = key; px = row[key]; }
    }
    return book;
  }

  function flNote(doc) {
    const rest = hardrockPosted(doc)
      ? "DraftKings and FanDuel prices are shown for reference only."
      : "Hard Rock Bet futures aren't in our odds feed yet, so DraftKings and FanDuel prices are shown for reference only.";
    return `<div class="fu-fl" role="note"><strong>Florida:</strong> Hard Rock Bet is the only legal online sportsbook in Florida. ${rest}</div>`;
  }

  function stateNote(ev, doc) {
    if (isFL(ev)) return flNote(doc);
    if (!ev || !ev.state || ev.status === "unknown") {
      return `<p class="note">The highlighted price is the better of DraftKings and FanDuel. Implied percent includes the book's margin. Move is the change since the first recorded price. Pick your state to see which books you can use.</p>`;
    }
    if (ev.status === "nonus") {
      return `<p class="note">These DraftKings and FanDuel prices are for reference only.</p>`;
    }
    if (ev.status === "notlegal") {
      return `<p class="note">Online sports betting isn't legal in ${esc(ev.stateName)}, so we don't show a bettable price. DraftKings and FanDuel prices are shown for reference only.</p>`;
    }
    if (ev.status === "nobooks") {
      return `<p class="note">We don't show sportsbook offers in ${esc(ev.stateName)}. DraftKings and FanDuel prices are shown for reference only.</p>`;
    }
    const missing = BOOKS.filter(([k]) => !legal(ev, k)).map(([, n]) => n);
    const tail = " Implied percent includes the book's margin. Move is the change since the first recorded price.";
    if (!missing.length) {
      return `<p class="note">The highlighted price is the better of DraftKings and FanDuel in ${esc(ev.stateName)}.${tail}</p>`;
    }
    const who = missing.join(" and ");
    const verb = missing.length > 1 ? "aren't" : "isn't";
    return `<p class="note">${esc(who)} ${verb} available in ${esc(ev.stateName)}; ${missing.length > 1 ? "their" : "its"} odds are shown for price comparison only.${tail}</p>`;
  }

  function referenceMode(ev) {
    if (isFL(ev)) return true;
    if (!ev || !ev.state || ev.status === "unknown") return false;
    if (ev.status === "notlegal" || ev.status === "nobooks" || ev.status === "nonus") return true;
    return !BOOKS.some(([k]) => legal(ev, k));
  }

  function moveCell(move) {
    if (move == null || Number(move) === 0) return `<span class="flat">—</span>`;
    const n = Number(move);
    const up = n > 0;
    const abs = Math.abs(n);
    const txt = Math.abs(abs - Math.round(abs)) < 1e-6 ? String(Math.round(abs)) : String(abs);
    return `<span class="${up ? "up" : "dn"}">${up ? "↑" : "↓"} ${txt}</span>`;
  }

  function priceCell(row, key, ev) {
    const px = row[key];
    if (px == null) return `<td class="num">—</td>`;
    const ok = legal(ev, key) && !isFL(ev);
    const bet = bettableBook(row, ev);
    const best = ok && bet === key;
    const na = ok ? "" : " na-col";
    return `<td class="num${na}${best ? " best" : ""}"><span class="px">${esc(am(px))}</span></td>`;
  }

  function cents(open, cur) {
    if (open == null || cur == null || isNaN(open) || isNaN(cur)) return null;
    const flat = x => (Number(x) < 0 ? Number(x) + 100 : Number(x) - 100);
    const d = flat(cur) - flat(open);
    const r = Math.round(d);
    return Math.abs(d - r) < 1e-6 ? r : Math.round(d * 100) / 100;
  }
  // The price this visitor is looking at: the legal book, or the DK/FD reference price.
  function focus(row, ev) {
    if (referenceMode(ev)) return { book: row.bestBook, price: row.best, open: row.open, move: row.move, implied: row.implied, first: row.firstRecorded };
    const book = bettableBook(row, ev);
    if (!book) return { book: row.bestBook, price: row.best, open: row.open, move: row.move, implied: row.implied, first: row.firstRecorded };
    const open = book === "draftkings" ? row.openDraftkings : row.openFanduel;
    const first = book === "draftkings" ? row.firstDraftkings : row.firstFanduel;
    const price = row[book];
    const p = implied(price);
    return {
      book, price,
      open: open == null ? price : open,
      move: open == null ? 0 : cents(open, price),
      implied: p == null ? null : Math.round(p * 1000) / 10,
      first: first || row.firstRecorded,
    };
  }
  function bestCell(row, ev) {
    const f = focus(row, ev);
    if (f.price == null) return `<td class="num">—</td>`;
    if (referenceMode(ev)) return `<td class="num fu-ref"><span class="px">${esc(am(f.price))}</span></td>`;
    return `<td class="num best"><span class="px">${esc(am(f.price))}</span></td>`;
  }

  const EMPTY = "No futures odds available for this league in our feed right now.";

  function marketTable(market, ev, formatWhen) {
    const who = market.subject === "player" ? "Player" : "Team";
    const ref = referenceMode(ev);
    const headBest = ref ? "Reference" : "Best";
    const rows = market.outcomes || [];
    if (!rows.length) {
      const title = market.title ? ` for ${market.title}` : "";
      return `<div class="empty"><h3>No futures odds available${esc(title)} in our feed right now.</h3></div>`;
    }
    const body = rows.map(r => {
      const f = focus(r, ev);
      const when = f.first && formatWhen ? formatWhen(f.first) : (f.first ? String(f.first).slice(0, 10) : "—");
      const pct = f.implied == null ? "—" : Number(f.implied).toFixed(1) + "%";
      return `<tr>
        <td class="who">${esc(r.name)}</td>
        ${bestCell(r, ev)}
        ${priceCell(r, "draftkings", ev)}
        ${priceCell(r, "fanduel", ev)}
        <td class="num">${esc(pct)}</td>
        <td class="num">${moveCell(f.move)}</td>
        <td class="num">${esc(when)}</td>
      </tr>`;
    }).join("");
    return `<div class="card fu-card"><h2>${esc(market.title || "Futures")}</h2>
      <div class="tbl-wrap fu-scroll"><table class="books fu-tbl">
        <thead><tr>
          <th class="who">${who}</th>
          <th>${headBest}</th>
          <th class="${legal(ev, "draftkings") && !isFL(ev) ? "" : "na-col"}">DraftKings</th>
          <th class="${legal(ev, "fanduel") && !isFL(ev) ? "" : "na-col"}">FanDuel</th>
          <th>Implied</th><th>Move</th><th>First recorded</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table></div></div>`;
  }

  function updatedLine(doc, formatWhen) {
    const stamps = (doc.markets || []).map(m => m.lastUpdate).filter(Boolean).sort();
    const iso = stamps.length ? stamps[stamps.length - 1] : doc.updated;
    if (!iso) return "";
    const shown = formatWhen ? formatWhen(iso) : String(iso) + " ET";
    return `<p class="note">Last updated ${esc(shown)}.</p>`;
  }

  // Full #app body for one league, or the golf section (league "golf").
  function page(doc, ctx) {
    const ev = (ctx && ctx.geo) || null;
    const formatDate = ctx && (ctx.formatDate || ctx.formatWhen);
    const formatWhen = ctx && ctx.formatWhen;
    const league = (doc && doc.league) || (ctx && ctx.league) || "";
    const golf = league === "golf";
    const markets = (doc && doc.markets) || [];
    const live = markets.filter(m => (m.outcomes || []).length);
    const name = (ctx && ctx.full) || (ctx && ctx.name) || league.toUpperCase();
    const seg = (ctx && ctx.seg) || "";
    let html = `<div class="page-head"><div><h1>${esc(golf ? "Golf majors" : name)}</h1>`;
    if (golf) {
      html += `<div class="sub">Winner prices for the four majors. Golf isn't a league hub on LineSmart, so this page is linked from each sport's Futures tab.</div></div></div>`;
    } else {
      html += `<div class="sub">Title-winner futures · DraftKings and FanDuel</div></div>${seg}</div>`;
    }
    html += stateNote(ev, doc || {});
    if (golf) {
      html += `<p class="note"><a href="#/l/nfl/futures">NFL</a> · <a href="#/l/nba/futures">NBA</a> · <a href="#/l/ncaaf/futures">NCAAF</a> · <a href="#/l/ncaab/futures">NCAAB</a> · <a href="#/l/nhl/futures">NHL</a> · <a href="#/l/mlb/futures">MLB</a></p>`;
    } else {
      html += `<p class="note"><a href="#/l/golf/futures">Golf majors</a> (Masters, PGA Championship, U.S. Open, The Open) live on their own page. There is no golf hub.</p>`;
    }
    if (!live.length) {
      html += `<div class="empty" style="margin-top:16px"><h3>${esc(EMPTY)}</h3></div>`;
      return html;
    }
    html += updatedLine(doc, formatWhen);
    for (const m of markets) {
      if ((m.outcomes || []).length) html += marketTable(m, ev, formatDate);
      else if (m.title) html += `<div class="empty"><h3>No futures odds available for ${esc(m.title)} in our feed right now.</h3></div>`;
    }
    return html;
  }

  return { esc, am, implied, better, legal, isFL, bettableBook, referenceMode, flNote, stateNote, marketTable, page, EMPTY, BOOKS };
});
