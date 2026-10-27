// Affiliate-compliance checks: 21+ notices, state-matched helplines, affiliate disclosure near offers and on the legal
// pages, licensed-sportsbooks-only (no offshore) policy, Florida = Hard Rock Bet only, Nevada hides BetMGM.
// Serves site/ locally and drives Chromium; offline apart from the local server (geo-IP and analytics aborted; state is
// picked via localStorage). Usage: node scripts/compliance_test.mjs   (needs playwright)
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import http from "http";

let fail = 0, pass = 0;
const check = (ok, msg) => { ok ? pass++ : (fail++, console.log(`FAIL ${msg}`)); };
const read = f => fs.readFileSync(path.join("site", f), "utf8");
const text = h => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

// ---- static pages
const FOOTER_PAGES = ["index.html", "about.html", "terms.html", "privacy.html", "affiliate-disclosure.html", "responsible-gambling.html", "subscribed.html", "unsubscribe.html"];
for (const f of FOOTER_PAGES) {
  const h = read(f), foot = h.slice(h.indexOf('<footer class="footer"'));
  check(/age-pill">21\+</.test(foot) && /1-800-GAMBLER/.test(foot), `${f}: footer 21+ and 1-800-GAMBLER`);
  check(/<p class="rg fl" data-rg-local>Florida: call or text <a href="tel:18337529947">1-833-PLAYWISE/.test(foot), `${f}: footer state helpline slot (Florida default)`);
  check(!/Florida-based|based in Florida/i.test(h), `${f}: no "Florida-based"`);
  check(/LineSmart · <a href="mailto:contact@linesmart.app">contact@linesmart.app<\/a>/.test(foot), `${f}: footer contact line`);
}
const about = text(read("about.html")), terms = text(read("terms.html")), aff = text(read("affiliate-disclosure.html")), rg = text(read("responsible-gambling.html"));
const NO_OFFSHORE = /only lists state-licensed, legal US sportsbooks.*never list, link to or promote offshore or unlicensed sportsbooks/;
check(NO_OFFSHORE.test(about), "about: licensed-sportsbooks-only / no offshore policy");
check(NO_OFFSHORE.test(terms), "terms: licensed-sportsbooks-only / no offshore policy");
check(NO_OFFSHORE.test(aff), "affiliate disclosure: no offshore policy");
check(/may earn a commission from sportsbook links/.test(terms) && /never change the odds we show/.test(terms) && /state-specific/.test(terms), "terms: affiliate links section (commission, odds unchanged, state-specific)");
check(/may earn a commission/.test(about) && /never change the odds/.test(about) && /state-specific/.test(about), "about: commission, odds unchanged, state-specific");
check(/may earn a commission/.test(aff) && /won't change the odds shown/.test(aff) && /Offers are state-specific/.test(aff), "affiliate disclosure: commission, odds unchanged, state-specific");
check(/These terms are governed by the laws of the State of Florida/.test(terms), "terms: Florida governing-law line kept");
check(/Effective date: October 27, 2026/.test(terms) && /Effective date: October 27, 2026/.test(aff), "terms + affiliate disclosure dates bumped");
check(["1-800-NEXT-STEP", "1-800-9-WITH-IT", "1-800-BETS-OFF", "1-877-8-HOPENY", "1-833-PLAYWISE", "1-800-GAMBLER"].every(n => rg.includes(n)), "responsible gambling page: state helplines listed");
check(!/\$\d|bonus code|promo code/i.test(read("assets/geo.js")), "geo.js: no bonus/promo claims");

// ---- browser: offers card + footer per state
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((req, res) => {
  let f = path.join("site", decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end("nf"); }
  res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" }); res.end(fs.readFileSync(f));
}).listen(0);
const BASE = `http://localhost:${srv.address().port}/`;
const browser = await chromium.launch();
const visit = async (st, url = BASE) => {
  const ctx = await browser.newContext();
  await ctx.addInitScript(s => { localStorage.setItem("ls-age-ok", "1"); if (s) localStorage.setItem("ls-state", s); else localStorage.removeItem("ls-state"); }, st);
  await ctx.route(/ipdata\.info|cloudflareinsights|cdn-cgi\/rum|espncdn|site\.web\.api\.espn|site\.api\.espn|googleapis|gstatic/, r => r.abort());
  const p = await ctx.newPage(); await p.goto(url, { waitUntil: "domcontentloaded" });
  await p.waitForSelector("[data-offers]", { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(300);
  const r = await p.evaluate(() => { const c = document.querySelector("[data-offers]"), f = document.querySelector("[data-rg-local]");
    return { status: c ? c.dataset.status || "ok" : null, books: c ? [...c.querySelectorAll("[data-book]")].map(a => a.dataset.book) : [], text: c ? c.innerText : "",
      tels: c ? [...c.querySelectorAll("a[href^='tel:']")].map(a => a.getAttribute("href")) : [], disc: !!(c && c.querySelector(".of-disc a[href='affiliate-disclosure.html']")),
      foot: f ? { hidden: f.hidden && getComputedStyle(f).display === "none", t: f.innerText } : null }; });
  await ctx.close(); return r;
};
try {
  const fl = await visit("FL");
  check(JSON.stringify(fl.books) === '["hardrockbet"]', `FL: Hard Rock Bet only (${fl.books})`);
  check(/21\+/.test(fl.text) && fl.tels[0] === "tel:18337529947" && fl.tels.includes("tel:18004262537"), `FL offer: 21+, 1-833-PLAYWISE first then 1-800-GAMBLER (${fl.tels})`);
  check(fl.disc && /may earn a commission from sportsbook links/.test(fl.text) && /never changes the odds/.test(fl.text) && /state-specific/.test(fl.text), "FL offer: short affiliate disclosure");
  check(fl.foot && !fl.foot.hidden && /PLAYWISE/.test(fl.foot.t), "FL footer: Florida helpline");
  const nj = await visit("NJ");
  check(nj.books.includes("betmgm") && nj.books.includes("hardrockbet"), `NJ: four books (${nj.books})`);
  check(JSON.stringify(nj.tels) === '["tel:18004262537"]' && /21\+/.test(nj.text) && nj.disc, `NJ offer: 21+, 1-800-GAMBLER only, disclosure (${nj.tels})`);
  check(nj.foot && nj.foot.hidden, "NJ footer: no Florida line");
  const nv = await visit("NV");
  check(!nv.books.includes("betmgm"), `NV: BetMGM hidden (${nv.books})`);
  const ny = await visit("NY");
  check(ny.tels[0] === "tel:18778467369" && ny.foot && !ny.foot.hidden && /New York: call 1-877-8-HOPENY/.test(ny.foot.t), `NY: HOPEline in offer and footer (${ny.tels})`);
  const mi = await visit("MI");
  check(mi.tels[0] === "tel:18004262537" && mi.foot.hidden, "MI: 1-800-GAMBLER (MGCB's chosen line)");
  const ca = await visit("CA");
  check(ca.status === "notlegal" && /21\+/.test(ca.text) && ca.tels.includes("tel:18004262537") && !ca.books.length, `CA (not legal): no books, 21+ and helpline (${ca.status})`);
  const none = await visit(null);
  check(none.foot && !none.foot.hidden && /PLAYWISE/.test(none.foot.t), "unknown state: static footer kept (GAMBLER + Florida)");
} finally { await browser.close(); srv.close(); }
console.log(`${fail ? "FAIL" : "PASS"} compliance: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
