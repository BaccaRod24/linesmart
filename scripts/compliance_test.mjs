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
// every page with the shared footer loads the state scripts, so the footer helpline follows the chosen state
for (const f of FOOTER_PAGES) {
  const h = read(f);
  check(["assets/books-by-state.js", "assets/geo-core.js", "assets/geo.js"].every(s => new RegExp(`<script src="${s}"( defer)?></script>`).test(h)), `${f}: loads the state scripts (footer helpline follows the state)`);
  check(/<noscript><p class="rg fl">New York: call <a href="tel:18778467369">1-877-8-HOPENY<\/a> or text <a href="sms:467369">HOPENY \(467369\)<\/a>/.test(h), `${f}: no-JS footer also lists New York's line`);
}
// promo wording: none of the restricted phrases in site copy, templates or emails (disclaimers like "not a guarantee" are fine;
// slip-core.js's parser still recognises what a sportsbook prints on the user's own slip)
const PROMO = /\b(free bets?|risk[- ]free|no[- ]risk|guaranteed|bonus bets?|no[- ]sweat|free plays?)\b/i;
const copyFiles = [...fs.readdirSync("site").filter(f => f.endsWith(".html")), ...fs.readdirSync("site/assets").filter(f => f.endsWith(".js") && f !== "slip-core.js").map(f => "assets/" + f)];
for (const f of copyFiles) { const m = read(f).match(PROMO); check(!m, `${f}: no promo wording (${m && m[0]})`); }
for (const f of ["scripts/newsletter_lib.mjs", "scripts/build_pages.py", "scripts/previews.py", "scripts/seo_pages.py", ...fs.readdirSync("supabase/migrations").map(f => "supabase/migrations/" + f)]) {
  const t = fs.readFileSync(f, "utf8").split("\n").filter(l => !/BANNED|FORBIDDEN|PROMO/.test(l)).join("\n"), m = t.match(PROMO);
  check(!m, `${f}: no promo wording (${m && m[0]})`);
}
const slip = read("assets/slip-core.js").split("\n").filter(l => !/\.test\(|replace\(|= \/\^?\(/.test(l)).join("\n");
check(!PROMO.test(slip), "slip-core.js: user-facing text has no promo wording (only the slip parser's regexes do)");
// privacy page explains the visits-by-state count
const priv = text(read("privacy.html"));
check(/Visits by state \(aggregate count\)/.test(priv) && /two-letter/.test(priv) && /don't store your IP address/.test(priv) && /ls-sv/.test(priv), "privacy: visits-by-state count explained");
check(/Last updated: October 28, 2026/.test(priv), "privacy: date bumped");

// ---- browser: offers card + footer per state
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((req, res) => {
  let f = path.join("site", decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
  if (!fs.existsSync(f)) { res.writeHead(404, { "content-type": "text/html" }); return res.end(fs.readFileSync("site/404.html")); }   // like GitHub Pages
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
      ads: c ? [...c.querySelectorAll("a[data-book]")].map(a => (a.querySelector("[data-ad-label]") || {}).innerText || "") : [],
      footHTML: f ? f.innerHTML : "", footPx: f ? parseFloat(getComputedStyle(f).fontSize) : 0,
      foot: f ? { hidden: f.hidden && getComputedStyle(f).display === "none", t: f.innerText } : null }; });
  await ctx.close(); return r;
};
try {
  const fl = await visit("FL");
  check(JSON.stringify(fl.books) === '["hardrockbet"]', `FL: Hard Rock Bet only (${fl.books})`);
  check(/21\+/.test(fl.text) && fl.tels[0] === "tel:18337529947" && fl.tels.includes("tel:18004262537"), `FL offer: 21+, 1-833-PLAYWISE first then 1-800-GAMBLER (${fl.tels})`);
  check(fl.disc && /may earn a commission from sportsbook links/.test(fl.text) && /never changes the odds/.test(fl.text) && /state-specific/.test(fl.text), "FL offer: short affiliate disclosure");
  check(fl.foot && !fl.foot.hidden && /PLAYWISE/.test(fl.foot.t), "FL footer: Florida helpline");
  check(!fl.books.some(b => /draftkings|fanduel/.test(b)) && !/DraftKings|FanDuel/.test(fl.text), `FL: no DraftKings/FanDuel offer or sign-up link (${fl.books})`);
  check(fl.ads.length === fl.books.length && fl.ads.every(t => t === "Ad · We may earn a commission · 21+"), `FL: "Ad · We may earn a commission · 21+" on every sportsbook link (${fl.ads})`);
  check(fl.footPx >= 14, `footer helpline at body-text size (${fl.footPx}px)`);
  const nj = await visit("NJ");
  check(nj.books.includes("betmgm") && nj.books.includes("hardrockbet"), `NJ: four books (${nj.books})`);
  check(JSON.stringify(nj.tels) === '["tel:18004262537"]' && /21\+/.test(nj.text) && nj.disc, `NJ offer: 21+, 1-800-GAMBLER only, disclosure (${nj.tels})`);
  check(nj.foot && nj.foot.hidden, "NJ footer: no Florida line");
  check(nj.ads.length === nj.books.length && nj.ads.length >= 2 && nj.ads.every(t => /^Ad · We may earn a commission · 21\+$/.test(t)), `NJ: ad label on every sportsbook link (${nj.ads.length}/${nj.books.length})`);
  const nv = await visit("NV");
  check(!nv.books.includes("betmgm"), `NV: BetMGM hidden (${nv.books})`);
  const ny = await visit("NY");
  check(ny.tels[0] === "tel:18778467369" && ny.foot && !ny.foot.hidden && /New York: call 1-877-8-HOPENY/.test(ny.foot.t), `NY: HOPEline in offer and footer (${ny.tels})`);
  check(/or text HOPENY \(467369\)/.test(ny.foot.t) && /href="sms:467369"/.test(ny.footHTML), "NY footer: call or text HOPENY");
  const mi = await visit("MI");
  check(mi.tels[0] === "tel:18004262537" && mi.foot.hidden, "MI: 1-800-GAMBLER (MGCB's chosen line)");
  const ca = await visit("CA");
  check(ca.status === "notlegal" && /21\+/.test(ca.text) && ca.tels.includes("tel:18004262537") && !ca.books.length, `CA (not legal): no books, 21+ and helpline (${ca.status})`);
  const none = await visit(null);
  check(none.foot && !none.foot.hidden && /PLAYWISE/.test(none.foot.t), "unknown state: static footer kept (GAMBLER + Florida)");

  // ---- state helpline outside the offers card: 404, Pro, Value, alert sheet, homepage intro (all via GeoCore.rgCallHTML)
  const spots = async (st, url, sel, prep) => {
    const ctx = await browser.newContext();
    await ctx.addInitScript(s => { localStorage.setItem("ls-age-ok", "1"); if (s) localStorage.setItem("ls-state", s); else localStorage.removeItem("ls-state"); }, st);
    await ctx.route(/ipdata\.info|cloudflareinsights|cdn-cgi\/rum|espncdn|site\.web\.api\.espn|site\.api\.espn|googleapis|gstatic|supabase/, r => r.abort());
    const p = await ctx.newPage(); await p.goto(url, { waitUntil: "domcontentloaded" });
    if (prep) await p.evaluate(prep);
    await p.waitForSelector(sel, { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(400);
    const r = await p.evaluate(s => { const el = document.querySelector(s); return el ? { t: el.innerText, tels: [...el.querySelectorAll("a[href^='tel:']")].map(a => a.getAttribute("href")) } : null; }, sel);
    await ctx.close(); return r || { t: "", tels: [] };
  };
  const openAlert = async () => {   // alert sheet without Supabase: pretend signed in, open it for the first NFL game in the data
    const idx = await (await fetch("data/nfl/index.json")).json();
    window.LSAccount.signedIn = () => true;
    window.LSAlerts.open({ lg: "nfl", gid: idx.games[0].id });
  };
  const SPOTS = [["404", BASE + "nfl/games/gone-1/", "#rgCall"], ["pro", BASE + "#/pro", ".pro-rg [data-rg-call]"], ["value", BASE + "#/value", ".of-rg [data-rg-call]"],
    ["alerts", BASE, ".al-rg [data-rg-call]", openAlert], ["intro", BASE, ".intro-rg [data-rg-call]"]];
  const FL = "tel:18337529947", NY = "tel:18778467369", GAM = "tel:18004262537";
  for (const [name, url, sel, prep] of SPOTS) {
    const fl = await spots("FL", url, sel, prep), ny = await spots("NY", url, sel, prep), nj = await spots("NJ", url, sel, prep), un = await spots(null, url, sel, prep);
    check(fl.tels[0] === FL && fl.tels[1] === GAM && /Florida/.test(fl.t), `${name} FL: 1-833-PLAYWISE first, then 1-800-GAMBLER (${fl.tels})`);
    check(ny.tels[0] === NY && ny.tels[1] === GAM && !ny.tels.includes(FL), `${name} NY: 1-877-8-HOPENY first, then 1-800-GAMBLER (${ny.tels})`);
    check(JSON.stringify(nj.tels) === JSON.stringify([GAM]), `${name} NJ: 1-800-GAMBLER only (${nj.tels})`);
    check(un.tels[0] === GAM && un.tels.includes(FL), `${name} unknown state: 1-800-GAMBLER plus Florida's line (${un.tels})`);
  }
  // legal pages: the footer helpline follows the chosen state too
  for (const f of ["privacy.html", "terms.html", "responsible-gambling.html", "subscribed.html"]) {
    const ny = await spots("NY", BASE + f, "[data-rg-local]"), fl = await spots("FL", BASE + f, "[data-rg-local]");
    check(/New York: call 1-877-8-HOPENY or text HOPENY/.test(ny.t) && !/PLAYWISE/.test(ny.t), `${f} NY footer: HOPENY (${ny.t.slice(0, 60)})`);
    check(/PLAYWISE/.test(fl.t), `${f} FL footer: PLAYWISE`);
  }
  // visits-by-state count: on the live host only, once a day, just {"p_state": "NY"} (served locally; Supabase never contacted)
  {
    const ctx = await browser.newContext(), calls = [];
    await ctx.addInitScript(() => { localStorage.setItem("ls-age-ok", "1"); localStorage.setItem("ls-state", "NY"); });
    await ctx.route(/ipdata\.info|cloudflareinsights|cdn-cgi\/rum|espncdn|espn\.com|googleapis|gstatic/, r => r.abort());
    await ctx.route(/supabase\.co/, r => { const q = r.request(); calls.push({ url: q.url(), body: q.postData(), h: q.headers() }); r.fulfill({ status: 204, body: "" }); });
    await ctx.route(/^https:\/\/linesmart\.app\//, r => { const f = path.join("site", new URL(r.request().url()).pathname.replace(/\/$/, "/index.html"));
      fs.existsSync(f) ? r.fulfill({ status: 200, contentType: types[path.extname(f)] || "application/octet-stream", body: fs.readFileSync(f) }) : r.fulfill({ status: 404, body: "" }); });
    const p = await ctx.newPage();
    await p.goto("https://linesmart.app/privacy.html", { waitUntil: "load" }); await p.waitForTimeout(800);
    const sv = calls.filter(c => /rpc\/state_visit_bump$/.test(c.url));
    check(sv.length === 1 && sv[0].body === '{"p_state":"NY"}' && !sv[0].h.cookie && !sv[0].h.authorization, `state count: one call, state code only (${sv.length} ${sv[0] && sv[0].body})`);
    await p.goto("https://linesmart.app/terms.html", { waitUntil: "load" }); await p.waitForTimeout(800);
    check(calls.filter(c => /state_visit_bump/.test(c.url)).length === 1, "state count: once a day per browser");
    await ctx.close();
    const ctx2 = await browser.newContext(); const c2 = [];
    await ctx2.addInitScript(() => { localStorage.setItem("ls-age-ok", "1"); localStorage.setItem("ls-state", "NY"); });
    await ctx2.route(/supabase\.co/, r => { c2.push(r.request().url()); r.abort(); });
    await ctx2.route(/ipdata\.info|cloudflareinsights|espn|googleapis|gstatic/, r => r.abort());
    const p2 = await ctx2.newPage(); await p2.goto(BASE + "privacy.html", { waitUntil: "load" }); await p2.waitForTimeout(800);
    check(!c2.some(u => /state_visit_bump/.test(u)), "state count: not sent off the live host (localhost)");
    await ctx2.close();
  }
  // static spots with no state JS keep the national line plus Florida's
  const nf = read("404.html");
  check(/data-rg-call>Call or text <a href="tel:18004262537">1-800-GAMBLER<\/a>\. In Florida: <a href="tel:18337529947">1-833-PLAYWISE/.test(nf), "404.html: no-JS helpline fallback");
  check(/intro-rg[^\n]*data-rg-call/.test(read("index.html")), "index.html: homepage intro helpline follows state");
  for (const f of ["assets/pro.js", "assets/value.js", "assets/alerts.js", "assets/bets.js", "assets/site.js"])
    check(!/Call(?: or text)? (?:<a href="tel:18004262537">)?1-800-GAMBLER/.test(read(f).replace(/window\.LSGeo \? [^\n]*/g, "")), `${f}: no hardcoded 1-800-GAMBLER sentence`);
} finally { await browser.close(); srv.close(); }
console.log(`${fail ? "FAIL" : "PASS"} compliance: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
