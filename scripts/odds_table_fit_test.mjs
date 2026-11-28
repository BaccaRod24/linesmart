// Odds comparison sits in the right half of .cols. At 1280px the three-book table (plus the fair
// line) must stay inside its card: fit, or scroll on the .tbl-wrap, and not paint past the viewport.
// Phone width keeps a single column and must not grow the page. No network, no Odds API.
// Usage: node scripts/odds_table_fit_test.mjs
import { chromium } from "playwright";
import fs from "fs";
import http from "http";
import path from "path";

let pass = 0, fail = 0;
const check = (ok, msg) => { if (ok) pass++; else { fail++; console.log("FAIL " + msg); } };
const cell = (book, px, best) => `<td class="num${best ? " best" : ""}" data-book="${book}"><span class="px">${px}</span><a class="trk" href="#/bets" aria-label="Track"></a><span class="lv">52.6% · <b class="lv-e neg">−3.0%</b></span></td>`;
const row = (label, fair) => `<tr><td>${label}<span class="lv-fair-m">Fair ${fair}<i>51.0%</i></span></td>${cell("hardrockbet", "+2.5 <span class=\"na\">-111</span>", true)}${cell("draftkings", "+2.5 <span class=\"na\">-115</span>", false)}${cell("fanduel", "+2.5 <span class=\"na\">-118</span>", false)}<td class="num lv-fair"><span class="px">${fair}</span><span class="lv">51.0% · 3 bks</span></td></tr>`;
const head = (name) => `<th data-book="${name.toLowerCase().replace(/\s+/g, "")}">${name}<span class="na-tag"></span><span class="src">as of Sat, Nov 28, 8:23 AM ET</span></th>`;
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="assets/styles.css"></head><body class="app">
<main class="wrap" id="app">
<div class="section-title">Betting lines</div>
<div class="cols">
<div class="card"><h3>Current line · Draft Kings</h3>
<table class="books"><thead><tr><th>Market</th><th>WSH</th><th>CHA</th></tr></thead><tbody>
<tr><td>Spread</td><td class="num">+2.5 <span class="na">-115</span></td><td class="num">-2.5 <span class="na">-105</span></td></tr>
<tr><td>Moneyline</td><td class="num">+110</td><td class="num">-130</td></tr>
<tr><td>Total</td><td class="num">O 229.5 <span class="na">-105</span></td><td class="num">U 229.5 <span class="na">-115</span></td></tr>
</tbody></table></div>
<div class="card"><h3>Odds comparison</h3>
<div class="tbl-wrap"><table class="books lv-on"><thead><tr><th>Market</th>${head("Hard Rock Bet")}${head("DraftKings")}${head("FanDuel")}<th class="lv-fair">Fair line<span class="src">no-vig consensus</span></th></tr></thead><tbody>
${row("WSH spread", "+2.5 -110")}${row("CHA spread", "-2.5 -110")}${row("WSH ML", "+118")}${row("CHA ML", "-130")}${row("Over", "O 229.5 -110")}${row("Under", "U 229.5 -110")}
</tbody></table></div>
<div class="note">Best available price highlighted in green. Hard Rock Bet, FanDuel and DraftKings via The Odds API.</div>
</div></div></main></body></html>`;

const root = "site";
const types = { ".css": "text/css", ".woff2": "font/woff2" };
const srv = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/fixture.html") { res.writeHead(200, { "content-type": "text/html" }); return res.end(html); }
  const f = path.join(root, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("no"); }
  res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
  res.end(fs.readFileSync(f));
}).listen(0);
const base = `http://127.0.0.1:${srv.address().port}/fixture.html`;
const browser = await chromium.launch();
const page = await browser.newPage();

async function measure(w, h) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(base, { waitUntil: "load" });
  return page.evaluate(() => {
    const h3 = [...document.querySelectorAll("h3")].find(e => e.textContent.includes("Odds comparison"));
    const card = h3.closest(".card");
    const wrap = card.querySelector(".tbl-wrap");
    const table = wrap.querySelector("table");
    const right = el => Math.round(el.getBoundingClientRect().right);
    const books = [...table.querySelectorAll("thead th")].filter(th => !th.classList.contains("lv-fair") && th.cellIndex > 0);
    const fair = table.querySelector("th.lv-fair");
    const inline = card.querySelector(".lv-fair-m");
    const cols = getComputedStyle(card.parentElement).gridTemplateColumns.split(" ").filter(Boolean);
    return {
      vw: window.innerWidth,
      doc: document.documentElement.scrollWidth,
      card: right(card),
      wrap: right(wrap),
      table: right(table),
      books: books.map(th => ({ name: th.childNodes[0].textContent.trim(), r: right(th) })),
      fairHidden: !fair || getComputedStyle(fair).display === "none",
      fairShown: !!(inline && getComputedStyle(inline).display !== "none" && inline.textContent.includes("Fair")),
      cols: cols.length,
      scroll: wrap.scrollWidth > wrap.clientWidth + 1,
      overflow: getComputedStyle(wrap).overflowX,
      thPx: parseFloat(getComputedStyle(books[0]).fontSize),
      cellH: Math.round(table.querySelector(".px").getBoundingClientRect().height),
      plus: getComputedStyle(table.querySelector("a.trk"), "::before").content,
    };
  });
}

const desk = await measure(1280, 900);
check(desk.card <= desk.vw && desk.wrap <= desk.card + 1, `1280: card stays in the viewport (card ${desk.card}, wrap ${desk.wrap}, vw ${desk.vw})`);
check(desk.doc <= desk.vw + 1, `1280: page does not grow sideways (scrollWidth ${desk.doc})`);
check(desk.books.length === 3 && desk.books.every(b => b.r <= desk.wrap + 1), `1280: Hard Rock, DraftKings and FanDuel sit inside the card (${JSON.stringify(desk.books)} wrap ${desk.wrap})`);
check(desk.table <= desk.vw, `1280: table edge is inside the viewport (table ${desk.table})`);
check(desk.fairHidden && desk.fairShown, `1280: fair line moves under the market name instead of a clipped column (hidden ${desk.fairHidden}, shown ${desk.fairShown})`);
check(desk.cols === 2, `1280: lines and odds stay side by side (${desk.cols} columns)`);

const phone = await measure(390, 844);
check(phone.card <= phone.vw + 1 && phone.wrap <= phone.card + 1, `390: card stays in the viewport (card ${phone.card}, wrap ${phone.wrap}, vw ${phone.vw})`);
check(phone.doc <= phone.vw + 1, `390: page does not grow sideways (scrollWidth ${phone.doc})`);
check(phone.cols === 1, `390: cards stack in one column (${phone.cols})`);
check(phone.fairShown, "390: fair line still shows under the market name");
check(phone.overflow === "auto" || phone.overflow === "scroll", `390: table wrapper can still scroll (${phone.overflow})`);
check(desk.thPx >= 11 && phone.thPx >= 11, `column headers are at least 11px (1280 ${desk.thPx}, 390 ${phone.thPx})`);
check(desk.cellH === 46 && phone.cellH === 46, `price cells are 46px tall (1280 ${desk.cellH}, 390 ${phone.cellH})`);
check(desk.plus === "none" && phone.plus === "none", "the separate + circle is gone; the cell itself is the control");
check(phone.books.length === 3 && phone.books.every(b => b.r <= phone.wrap + 1 && b.r > 0), `390: Hard Rock Bet, DraftKings and FanDuel are fully inside the card (${JSON.stringify(phone.books)} wrap ${phone.wrap})`);
check(!phone.scroll, `390: the three books fit without sideways scrolling (scrollWidth overflow ${phone.scroll})`);

await browser.close();
srv.close();
console.log(`${fail ? "FAIL" : "PASS"} odds table fit: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
