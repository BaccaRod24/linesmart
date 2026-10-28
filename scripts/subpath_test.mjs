// Serves nothing itself: expects the site to be reachable at $BASE (e.g. http://localhost:8799/linesmart/).
// Usage: mkdir -p /tmp/ghp && ln -sfn "$PWD/site" /tmp/ghp/linesmart && python3 -m http.server 8799 -d /tmp/ghp &
//        BASE=http://localhost:8799/linesmart/ node scripts/subpath_test.mjs
//        Root path (like https://linesmart.app/): python3 -m http.server 8798 -d site & then BASE=http://localhost:8798/ node scripts/subpath_test.mjs
//        CHECK_LINKS=1 also fetches every external link on the Responsible Gambling page (expects HTTP 200).
//        Search/team/player checks need a data dir with search/ built: DATA_DIR=/path/to/data (e.g. DATA_OUT=... build_data.py --search-only)
import { chromium } from "playwright";
import fs from "fs";
const BASE = process.env.BASE || "http://localhost:8799/linesmart/";
const DATA = process.env.DATA_DIR || "site/data";   // point at a mirror of live data to test with current games
const meta = JSON.parse(fs.readFileSync(`${DATA}/meta.json`));
const nfl = JSON.parse(fs.readFileSync(`${DATA}/nfl/index.json`));
const gid = (nfl.games[0] || {}).id;
const routes = ["", ...meta.order.map(k => `#/l/${k}`), gid ? `#/g/nfl/${gid}` : null].filter(r => r !== null);
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [], bad = [], ok = new Set();
page.on("pageerror", e => errors.push(e.message));
page.on("console", m => m.type() === "error" && errors.push(m.text()));
page.on("response", r => { const u = r.url(); if (u.startsWith(new URL(BASE).origin)) { if (r.status() >= 400) bad.push(`${r.status()} ${u}`); else ok.add(new URL(u).pathname); } });
page.on("response", r => { if (!r.url().startsWith(new URL(BASE).origin) && r.status() >= 400) console.log(`  (external ${r.status()} ${r.url()})`); });
// analytics beacon / geo lookup must never be called by tests (beacon is host-gated to linesmart.app; geo too)
const thirdParty = [];
page.on("request", r => { if (/cloudflareinsights\.com|ipdata\.info/.test(r.url())) thirdParty.push(r.url()); });
page.on("requestfailed", r => { if (r.url().startsWith(new URL(BASE).origin)) bad.push(`FAILED ${r.url()}`); });
const pwaFail = [];
const check = (ok, msg, tag = "pwa") => { console.log(`${ok ? "PASS" : "FAIL"} ${tag}: ${msg}`); if (!ok) pwaFail.push(`${tag}: ${msg}`); };
const LEGAL = [["about.html", "About LineSmart"], ["responsible-gambling.html", "Responsible Gambling"], ["privacy.html", "Privacy Policy"], ["terms.html", "Terms of Use"], ["affiliate-disclosure.html", "Affiliate Disclosure"]];
const CONTACT = "contact@linesmart.app";
const window_token = () => (fs.readFileSync("site/assets/config.js", "utf8").match(/cfToken:\s*"([^"]*)"/) || [])[1];
// compliance footer: same block on every view (SPA routes and legal pages)
let footerRef = null;
const footerOk = async where => {
  const f = await page.$eval("#siteFooter", el => {
    const r = el.getBoundingClientRect();
    return { text: el.innerText.replace(/\s+/g, " "), html: el.outerHTML, shown: r.height > 0 && getComputedStyle(el).display !== "none",
      hrefs: [...el.querySelectorAll("a")].map(a => a.getAttribute("href")) };
  }).catch(() => null);
  if (!f) return check(false, `${where}: #siteFooter missing`, "footer");
  const need = ["tel:18004262537", "https://www.1800gambler.net", "tel:18337529947", "https://playwise.org/", "tel:18882364848", "https://gamblinghelp.org/", ...LEGAL.map(l => l[0])];
  const miss = need.filter(h => !f.hrefs.includes(h));
  const words = ["21+ only. Gambling problem? Call or text 1-800-GAMBLER", "is an informational site and does not accept wagers. Odds are for reference and may change; confirm with the sportsbook.", "1-888-ADMIT-IT", "Florida Council on Compulsive Gambling"];
  const missW = words.filter(w => !f.text.includes(w));
  footerRef ??= f.html;
  check(f.shown && !miss.length && !missW.length && f.html === footerRef, `${where}: footer ok${miss.length ? " missing links " + miss : ""}${missW.length ? " missing text " + JSON.stringify(missW) : ""}${f.html !== footerRef ? " (differs from first view)" : ""}`, "footer");
};

// ---------- 21+ notice: shown once on first visit, accessible, dismissible, remembered; not a gate
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForSelector("#ageNotice [role=dialog]", { timeout: 10000 }).catch(() => {});
const dlg = await page.evaluate(() => {
  const d = document.querySelector("#ageNotice [role=dialog]"); if (!d) return null;
  const lab = document.getElementById(d.getAttribute("aria-labelledby") || "");
  return { modal: d.getAttribute("aria-modal"), label: lab && lab.textContent, desc: !!document.getElementById(d.getAttribute("aria-describedby") || ""),
    focus: document.activeElement && document.activeElement.id, appInert: document.getElementById("app").closest("[inert]") !== null,
    appInDom: document.querySelectorAll("#app .game, #app .empty").length, tels: [...d.querySelectorAll('a[href^="tel:"]')].map(a => a.getAttribute("href")) };
});
check(!!dlg, "age notice shown on first visit", "age");
if (dlg) {
  check(dlg.modal === "true" && /21/.test(dlg.label || "") && dlg.desc, `dialog semantics: aria-modal=${dlg.modal} label="${dlg.label}"`, "age");
  check(dlg.focus === "ageOk" && dlg.appInert, `focus on confirm button (${dlg.focus}), background inert=${dlg.appInert}`, "age");
  check(dlg.appInDom > 0, `page content still rendered behind notice (${dlg.appInDom} items) — not a hard gate`, "age");
  check(dlg.tels.includes("tel:18004262537"), "notice links 1-800-GAMBLER", "age");
  await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); await page.keyboard.press("Tab");
  check(await page.evaluate(() => !!document.activeElement.closest("#ageNotice")), "Tab keeps focus inside the notice", "age");
  await page.click("#ageOk");
}
const aged = await page.evaluate(() => ({ gone: !document.getElementById("ageNotice"), stored: localStorage.getItem("ls-age-ok"), inert: document.querySelectorAll("[inert]").length }));
check(aged.gone && !!aged.stored && aged.inert === 0, `dismissed: removed=${aged.gone} ls-age-ok=${aged.stored ? "set" : "missing"} inert left=${aged.inert}`, "age");
await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(400);
check(!(await page.$("#ageNotice")), "not shown again after reload", "age");
{ // Esc dismisses too (fresh profile, landing directly on a legal page)
  const ctx2 = await browser.newContext(); const p2 = await ctx2.newPage();
  p2.on("pageerror", e => errors.push(e.message)); p2.on("console", m => m.type() === "error" && errors.push(m.text()));
  await p2.goto(BASE + "privacy.html", { waitUntil: "networkidle" });
  const shown = !!(await p2.waitForSelector("#ageNotice", { timeout: 5000 }).catch(() => null));
  const crawl = await p2.evaluate(() => document.querySelector("main h1").textContent);
  await p2.keyboard.press("Escape");
  const after = await p2.evaluate(() => ({ gone: !document.getElementById("ageNotice"), stored: !!localStorage.getItem("ls-age-ok") }));
  check(shown && after.gone && after.stored && crawl === "Privacy Policy", `legal page: notice shown, Esc dismisses + remembers, content in DOM ("${crawl}")`, "age");
  await ctx2.close();
}

for (const r of routes) {
  await page.goto(BASE + r, { waitUntil: "networkidle" });
  if (r) await page.evaluate(() => window.dispatchEvent(new HashChangeEvent("hashchange")));
  await page.waitForSelector(".game, .match, .empty, .back", { timeout: 15000 });
  const n = await page.$$eval(".game", els => els.length);
  const loading = await page.$(".loading");
  console.log(`route ${r || "(root)"}: .game=${n} loadingStuck=${!!loading}`);
  await footerOk(`route ${r || "(root)"}`);
  if (r.startsWith("#/g/")) check(!(await page.$(".aff-disc:not([hidden])")) && (await page.$$(".books")).length > 0, "game page: affiliate disclosure hidden (affiliate.enabled=false)", "affiliate");
}

// ---------- search + team + player pages (ESPN client-side; needs DATA_DIR with search/ built by build_data.py)
const sx = lg => { try { return JSON.parse(fs.readFileSync(`${DATA}/search/${lg}.json`)); } catch { return null; } };
const txt = sel => page.$eval(sel, e => e.textContent.trim()).catch(() => "");
const waitView = () => page.waitForSelector(".phero, .empty", { timeout: 20000 }).then(() => page.waitForLoadState("networkidle")).catch(() => {});
check(!!(await page.$('#searchBtn[href="#/search"]')), "header search button present", "search");
await page.goto(BASE + "#/search", { waitUntil: "networkidle" });
await page.waitForSelector("#q", { timeout: 15000 });
await page.fill("#q", "Eagles");
await page.waitForSelector(".sr", { timeout: 15000 }).catch(() => {});
const first = await txt(".sr .sr-t b");
await footerOk("search view");
check(/Eagles/.test(first), `type-ahead "Eagles" -> first result "${first}" (${(await page.$$(".sr")).length} results)`, "search");
check(decodeURIComponent(await page.evaluate(() => location.hash)) === "#/search/Eagles", "query kept in hash", "search");
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".sr", { timeout: 15000 }).catch(() => {});
check((await page.$eval("#q", i => i.value).catch(() => "")) === "Eagles" && (await page.$$(".sr")).length > 0, "search deep link survives reload", "search");
// top result is pre-selected: Enter opens it; ArrowDown moves the highlight to the next row
await page.focus("#q"); await page.keyboard.press("Enter"); await waitView();
check((await txt(".phero h1")).includes(first) && /^#\/t\/nfl\//.test(await page.evaluate(() => location.hash)), `Enter opens top result (${first})`, "search");
await page.goto(BASE + "#/search/Philadelphia", { waitUntil: "networkidle" }); await page.waitForSelector(".sr", { timeout: 15000 }).catch(() => {});
const second = await page.$$eval(".sr", a => a[1] && a[1].getAttribute("href"));
await page.focus("#q"); await page.keyboard.press("ArrowDown");
check(await page.$eval("#q", i => i.getAttribute("aria-activedescendant")) === "sr1", "ArrowDown highlights 2nd result", "search");
await page.keyboard.press("Enter"); await waitView();
check(await page.evaluate(() => location.hash) === second && !!(await page.$(".phero")), `ArrowDown+Enter opens ${second}`, "search");
for (const lg of ["nfl", "nba", "epl"]) {
  const d = sx(lg);
  if (!d) { check(false, `${DATA}/search/${lg}.json missing`, lg); continue; }
  check(d.v === 1 && d.teams.length > 0 && d.players.length > 0, `index ${d.teams.length} teams / ${d.players.length} players`, lg);
  const ti = d.teams.findIndex(t => t[8] && d.players.some(p => p[2] === d.teams.indexOf(t)));
  const t = d.teams[ti], pl = d.players.find(p => p[2] === ti);
  // search finds the player by name, scoped to the league chip
  await page.goto(BASE + "#/search", { waitUntil: "networkidle" });
  await page.waitForSelector("#q");
  await page.click(`.sfilt [data-lg="${lg}"]`).catch(() => {});
  await page.fill("#q", pl[1]);
  await page.waitForSelector(".sr", { timeout: 15000 }).catch(() => {});
  const hrefs = await page.$$eval(".sr", a => a.map(x => x.getAttribute("href")));
  check(hrefs.includes(`#/p/${lg}/${pl[0]}`), `search "${pl[1]}" finds player`, lg);
  // team page
  await page.goto(BASE + `#/t/${lg}/${t[0]}`, { waitUntil: "domcontentloaded" }); await waitView();
  const tn = await txt(".phero h1"), nRost = (await page.$$(".roster .pl")).length, nStat = (await page.$$(".stat")).length;
  if (lg === "nfl") await footerOk("team view");
  check(tn.includes(t[1]) && nRost > 0, `team ${t[1]}: h1="${tn}" roster=${nRost} stats=${nStat} games=${(await page.$$(".grow")).length}`, lg);
  // roster -> player page
  await page.click(`.roster a[href="#/p/${lg}/${pl[0]}"]`).catch(() => page.goto(BASE + `#/p/${lg}/${pl[0]}`));
  await page.waitForFunction(n => (document.querySelector(".phero h1") || {}).textContent?.includes(n), pl[1], { timeout: 20000 }).catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
  const pn = await txt(".phero h1");
  if (lg === "nfl") { await footerOk("team→player view"); }
  check(pn.includes(pl[1]), `player ${pl[1]}: h1="${pn}" stats=${(await page.$$(".stat")).length} gamelog=${(await page.$$(".glog tbody tr")).length} na=${(await page.$$(".na-card")).length}`, lg);
  // deep link reload of the player page
  await page.reload({ waitUntil: "domcontentloaded" }); await waitView();
  check((await txt(".phero h1")).includes(pl[1]), "player deep link survives reload", lg);
}

// ---------- player matchups (NFL/NBA): game-page key matchups -> player matchup section (needs DATA_DIR with matchups/ built)
for (const lg of ["nfl", "nba"]) {
  if (!fs.existsSync(`${DATA}/matchups/${lg}.json`)) { console.log(`SKIP matchups ${lg}: ${DATA}/matchups/${lg}.json not built`); continue; }
  const mu = JSON.parse(fs.readFileSync(`${DATA}/matchups/${lg}.json`));
  check(mu.v === 1 && mu.nTeams >= 20 && Object.values(mu.teams).every(t => t.gp > 0), `matchups data: ${mu.games} games, ${mu.nTeams} teams`, `mu-${lg}`);
  const li = JSON.parse(fs.readFileSync(`${DATA}/${lg}/index.json`));
  const g = li.games.find(x => x.state === "pre" && fs.existsSync(`${DATA}/${lg}/games/${x.id}.json`) && (JSON.parse(fs.readFileSync(`${DATA}/${lg}/games/${x.id}.json`)).detail || {}).leaders?.length);
  if (!g) { console.log(`SKIP matchups ${lg}: no upcoming game with leaders`); continue; }
  await page.goto(BASE + `#/g/${lg}/${g.id}`, { waitUntil: "networkidle" });
  await page.waitForSelector("#keyMu .mu-km", { timeout: 15000 }).catch(() => {});
  const km = await page.$$eval("#keyMu .mu-km", a => a.map(x => x.getAttribute("href")));
  check(km.length > 0 && km.every(h => new RegExp(`^#/p/${lg}/\\d+/m$`).test(h)), `game ${g.shortName}: ${km.length} key matchups linking to #/p/${lg}/{id}/m`, `mu-${lg}`);
  if (!km.length) continue;
  await page.click("#keyMu .mu-km");
  await page.waitForSelector("#muBox .mu-next", { timeout: 20000 }).catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
  const nx = await txt("#muBox .mu-next");
  const vsOpp = [g.home.name, g.away.name].some(n => nx.includes(n));
  check(vsOpp && /ET/.test(nx), `player matchup header names the opponent: "${nx.replace(/\s+/g, " ").slice(0, 80)}"`, `mu-${lg}`);
  const inView = await page.$eval("#matchup", e => { const r = e.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; }).catch(() => false);
  check(inView, "/m deep link scrolls the matchup section into view", `mu-${lg}`);
  const hasForm = await page.$("#muBox .mu-tbl"), hasDef = /defense/i.test(await txt("#muBox"));
  check(!!hasForm && hasDef, `form table + opponent defense rendered (${(await page.$$("#muBox table")).length} tables)`, `mu-${lg}`);
  if (await page.$("#muBox .mu-x")) {
    const before = await txt("#muBox .mu-hit-sum");
    await page.fill("#muBox .mu-x", "0");
    const after = await txt("#muBox .mu-hit-sum");
    check(before !== after && /^Over 0 /.test(after), `hit-rate threshold is adjustable ("${after}")`, `mu-${lg}`);
  }
  check(!/\b(lock|bet now|guaranteed|best bet)\b/i.test(await txt("#muBox")), "no betting-encouragement wording", `mu-${lg}`);
}
// ---------- legal pages (static HTML, subpath-relative, same footer)
for (const [file, title] of LEGAL) {
  const res = await page.goto(BASE + file, { waitUntil: "networkidle" });
  const info = await page.evaluate(() => ({ h1: document.querySelector("main h1")?.textContent, note: document.querySelector(".legal-note")?.textContent || "",
    text: document.querySelector("main").innerText, hrefs: [...document.querySelectorAll("main a")].map(a => a.href), robots: document.querySelector('meta[name="robots"]')?.content || "" }));
  check(res.status() === 200 && info.h1 === title && !/noindex/.test(info.robots), `${file}: HTTP ${res.status()} h1="${info.h1}" indexable`, "legal");
  check(info.note === "" && !/general template|not legal advice/i.test(info.text), `${file}: no template / "not legal advice" banner`, "legal");
  { const pub = await page.evaluate(f => [document.querySelector("#siteFooter")?.innerText || "", document.querySelector('meta[name="description"]')?.content || "", document.querySelector('meta[property="og:description"]')?.content || "", f === "about.html" ? document.querySelector("main").innerText : ""].join(" | ").replace(/\s+/g, " "), file);
    check(!/Florida-based|based in |Riverview|Tampa|Rodney|Copenhaver|Big_Rod|\bRod\b/i.test(pub) && /contact@linesmart\.app/.test(pub), `${file}: footer/meta/about carry no owner name or business location; contact@ only`, "privacy"); }
  if (file === "privacy.html") { const need = ["Last updated: October 28, 2026", CONTACT, "Cloudflare Web Analytics", "does not use cookies", "ipdata.info", "ls-geo", "ls-state", "ls-sv", "ls-bets-v1", "ls-recent", "ls-age-ok", "site.web.api.espn.com", "a.espncdn.com", "GitHub Pages", "affiliate tracking links", "may then set cookies", "LineSmart does not set cookies"]; const miss = need.filter(w => !info.text.includes(w));
    check(!miss.length && !/we don't use analytics/i.test(info.text), `privacy: analytics, location, device storage, affiliate cookies, contact, date${miss.length ? " missing " + JSON.stringify(miss) : ""}`, "legal"); }
  if (file === "about.html") { const need = ["LineSmart is an independent site", "ESPN", "DraftKings", "Hard Rock Bet", "The Odds API", "Open-Meteo", "affiliate links", "21 and older", "1-800-GAMBLER", "1-833-PLAYWISE", CONTACT]; const miss = need.filter(w => !info.text.includes(w));
    check(!miss.length, `about: owner, data sources, money, 21+, helplines, contact${miss.length ? " missing " + JSON.stringify(miss) : ""}`, "legal"); }
  if (file === "terms.html") check(/Florida/.test(info.text) && /does not accept wagers/.test(info.text) && /21 or older/.test(info.text) && /Limitation of liability/i.test(info.text), "terms: Florida law, no wagers, 21+, liability", "legal");
  if (file === "affiliate-disclosure.html") check(/no affiliate relationships/.test(info.text) && /at no extra cost to you/.test(info.text) && /won't change the odds shown/.test(info.text), "affiliate page: none now; commission/no cost/odds unchanged", "legal");
  if (file === "responsible-gambling.html") {
    const need = ["https://rg.hardrock.bet/", "https://www.1800gambler.net/", "https://www.ncpgambling.org/", "https://gamblersanonymous.org/", "https://playwise.org/", "https://gamblinghelp.org/"];
    const miss = need.filter(h => !info.hrefs.includes(h));
    check(!miss.length && /Self-exclusion/.test(info.text) && /Setting limits/.test(info.text), `responsible gambling: resources + limits + self-exclusion${miss.length ? " missing " + miss : ""}`, "legal");
    if (process.env.CHECK_LINKS) for (const h of [...new Set(info.hrefs.filter(h => /^https:/.test(h) && !h.startsWith(BASE)))]) {
      const r = await page.request.get(h, { timeout: 25000, headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", accept: "text/html" } }).catch(e => ({ status: () => e.message }));
      check(r.status() === 200, `external ${h} -> ${r.status()}`, "links");
    }
  }
  await footerOk(file);
  check(await page.$eval("[data-aff-disclosure]", e => e.hidden), `${file}: affiliate slot hidden`, "affiliate");
}
// the disclosure component appears only when config.js turns it on
const affOn = await page.evaluate(() => {
  const C = window.SITE_CONFIG.affiliate, was = C.enabled, off = window.LineSmart.affDisclosure();
  C.enabled = true; window.LineSmart.applyAffSlots();
  const el = document.querySelector("[data-aff-disclosure]"), on = window.LineSmart.affDisclosure();
  const r = { off, slotShown: !el.hidden && el.textContent.includes("commission"), on: /commission/.test(on) && /affiliate-disclosure\.html/.test(on) };
  C.enabled = was; window.LineSmart.applyAffSlots(); r.backHidden = el.hidden; return r;
});
check(affOn.off === "" && affOn.slotShown && affOn.on && affOn.backHidden, `config flag drives disclosure (off="" → on shows line → off hides)`, "affiliate");
await page.click('.legal-links a[href="terms.html"]'); await page.waitForLoadState("networkidle");
check(await page.evaluate(() => document.querySelector("main h1").textContent) === "Terms of Use", "footer link navigates between legal pages", "legal");
await page.click('a.back'); await page.waitForSelector(".game, .empty", { timeout: 15000 });
check(new URL(page.url()).pathname === new URL(BASE).pathname, "legal page back link returns to the app under the subpath", "legal");

// ---------- SEO: robots.txt, sitemap.xml, static homepage intro (no JS)
{
  const rb = await page.request.get(BASE + "robots.txt"), rt = await rb.text();
  check(rb.status() === 200 && /User-agent: \*/.test(rt) && /Allow: \//.test(rt) && /Sitemap: https:\/\/linesmart\.app\/sitemap\.xml/.test(rt), "robots.txt: allow all + sitemap line", "seo");
  const sm = await page.request.get(BASE + "sitemap.xml"), st = await sm.text();
  const locs = [...st.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  const want = ["", "about.html", "responsible-gambling.html", "privacy.html", "terms.html", "affiliate-disclosure.html"].map(f => "https://linesmart.app/" + f);
  check(sm.status() === 200 && want.every(u => locs.includes(u)) && !locs.some(u => u.includes("#")), `sitemap.xml: ${locs.length} pages, no hash routes`, "seo");
  const nctx = await browser.newContext({ javaScriptEnabled: false }); const np = await nctx.newPage();
  await np.goto(BASE, { waitUntil: "load" });
  const nj = await np.evaluate(() => { const i = document.getElementById("intro"); const r = i && i.getBoundingClientRect();
    return { h1: document.querySelector("h1")?.textContent || "", text: i ? i.innerText : "", vis: !!r && r.height > 0, desc: document.querySelector('meta[name="description"]')?.content || "" }; });
  check(nj.vis && /odds comparison/i.test(nj.h1) && ["DraftKings", "Hard Rock Bet", "player props", "hit rates", "matchups", "weather", "UFC", "bet tracker", "21+", "1-800-GAMBLER"].every(w => nj.text.includes(w)), "no-JS homepage: H1 + intro text visible", "seo");
  check(nj.desc.length > 50 && !/fanduel/i.test(nj.desc + nj.text), "meta description present; intro/meta make no FanDuel odds claim", "seo");
  await nctx.close();
  await page.goto(BASE + "#/search", { waitUntil: "networkidle" });
  check(await page.$eval("#intro", e => e.hidden), "intro hidden off the home route (JS)", "seo");
  await page.goto(BASE + "#/", { waitUntil: "networkidle" });
  check(!(await page.$eval("#intro", e => e.hidden)), "intro shown on the home route (JS)", "seo");
}
// ---------- PWA checks
await page.goto(BASE, { waitUntil: "networkidle" });
const manHref = await page.$eval('link[rel="manifest"]', l => l.href).catch(() => null);
check(!!manHref, `manifest linked (${manHref})`);
const manRes = manHref ? await page.request.get(manHref) : null;
check(manRes && manRes.status() === 200, `manifest HTTP ${manRes && manRes.status()}`);
const man = manRes ? await manRes.json().catch(() => null) : null;
check(man && man.name === "LineSmart" && man.short_name === "LineSmart" && man.display === "standalone" && man.start_url === "./" && man.scope === "./", "manifest fields (name/short_name/display/start_url/scope)");
for (const ic of (man && man.icons) || []) {
  const u = new URL(ic.src, manHref).href, r = await page.request.get(u), b = await r.body();
  const [w, h] = r.status() === 200 ? [b.readUInt32BE(16), b.readUInt32BE(20)] : [0, 0];
  check(r.status() === 200 && `${w}x${h}` === ic.sizes && u.startsWith(BASE), `icon ${ic.purpose} ${ic.sizes} HTTP ${r.status()} actual ${w}x${h}`);
}
check(man && man.icons.some(i => i.purpose === "maskable"), "maskable icon present");
for (const name of ["theme-color", "apple-mobile-web-app-capable", "apple-mobile-web-app-status-bar-style", "apple-mobile-web-app-title"])
  check(!!(await page.$(`meta[name="${name}"]`)), `meta ${name}`);
check(!!(await page.$('link[rel="apple-touch-icon"]')), "apple-touch-icon kept");
const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return { scope: r.scope, script: r.active && r.active.scriptURL }; });
check(sw.scope === BASE && sw.script === BASE + "sw.js", `SW registered scope=${sw.scope}`);
await page.reload({ waitUntil: "networkidle" });
check(await page.evaluate(() => !!navigator.serviceWorker.controller), "SW controls page after reload");
const shellKeys = await page.evaluate(async () => { const k = await caches.keys(); const out = {}; for (const n of k) out[n] = (await (await caches.open(n)).keys()).length; return out; });
check(Object.keys(shellKeys).some(k => k.startsWith("linesmart-shell-")) && Object.keys(shellKeys).includes("linesmart-data-v1"), `caches ${JSON.stringify(shellKeys)}`);
const cdp = await page.context().newCDPSession(page);
try {
  const inst = await cdp.send("Page.getInstallabilityErrors");
  check(inst.installabilityErrors.length === 0, `installability errors: ${JSON.stringify(inst.installabilityErrors.map(e => e.errorId))}`);
} catch (e) { console.log("SKIP pwa: installability check unavailable:", e.message); }
check(await page.$eval("#installBtn", b => b.hidden), "install button hidden until beforeinstallprompt");
check(await page.$eval("#offlineNote", b => b.hidden), "offline note hidden while online");
// offline: shell + cached data still render, with the note
const errsOnline = errors.length;
await page.context().setOffline(true);
await page.reload({ waitUntil: "load" });
await page.waitForSelector(".game, .match, .empty", { timeout: 15000 });
const offNote = await page.$eval("#offlineNote", b => b.hidden ? "" : b.textContent);
check((await page.$$(".game")).length > 0 && /offline/i.test(offNote), `offline render: .game=${(await page.$$(".game")).length} note="${offNote}"`);
const ofTeam = (sx("nfl") || { teams: [] }).teams.find(t => t[8]);
if (ofTeam) {
  await page.context().setOffline(false);
  await page.goto(BASE + `#/t/nfl/${ofTeam[0]}`, { waitUntil: "networkidle" }); await waitView();
  await page.context().setOffline(true);
  await page.reload({ waitUntil: "load" }); await waitView();
  check((await txt(".phero h1")).includes(ofTeam[1]) && (await page.$$(".roster .pl")).length > 0, `offline team page from SW cache (${ofTeam[1]})`);
}
await page.goto(BASE + "responsible-gambling.html", { waitUntil: "load" }).catch(() => {});
check((await txt("main h1")) === "Responsible Gambling" && !!(await page.$("#siteFooter")), "offline: responsible-gambling.html from SW cache", "legal");
await page.goto(BASE + "privacy.html", { waitUntil: "load" }).catch(() => {});
check((await txt("main h1")) === "Privacy Policy", "offline: privacy.html from SW cache", "legal");
await page.goto(BASE + "#/l/nfl", { waitUntil: "load" }).catch(() => {});
await page.waitForSelector(".game, .empty", { timeout: 15000 }).catch(() => {});
check((await page.$$(".game, .empty")).length > 0 && !(await page.$("main .legal")), "offline: app shell not overwritten by a legal page", "legal");
// back online → soft refresh: note clears, view re-renders, no full reload. Own context: Chromium skips the
// "online" event for pages that have an extra CDP session attached (the installability check above).
{
  const c3 = await browser.newContext(); const p3 = await c3.newPage();
  await c3.addInitScript(() => { try { localStorage.setItem("ls-age-ok", new Date().toISOString()); } catch (e) {} });
  await p3.goto(BASE, { waitUntil: "networkidle" }); await p3.evaluate(() => navigator.serviceWorker.ready);
  await p3.reload({ waitUntil: "networkidle" });
  await c3.setOffline(true); await p3.reload({ waitUntil: "load" }); await p3.waitForSelector(".game, .empty", { timeout: 15000 });
  const wasOff = await p3.$eval("#offlineNote", b => !b.hidden);
  await p3.evaluate(() => { window.__sameDoc = 1; });
  await c3.setOffline(false);
  const cleared = await p3.waitForFunction(() => document.getElementById("offlineNote").hidden, null, { timeout: 8000 }).then(() => true, () => false);
  await p3.waitForSelector(".game, .empty", { timeout: 15000 }).catch(() => {});
  const same = await p3.evaluate(() => window.__sameDoc === 1).catch(() => false);
  check(wasOff && cleared && same && (await p3.$$(".game, .empty")).length > 0, `back online: offline note cleared by soft refresh, same document (wasOff=${wasOff} cleared=${cleared} sameDoc=${same})`);
  await c3.close();
}
// My Bets: on-device tracker (still offline here, so this also proves the route works from the SW cache)
const shellUrls = await page.evaluate(async () => { for (const n of await caches.keys()) if (n.startsWith("linesmart-shell-")) return (await (await caches.open(n)).keys()).map(r => r.url); return []; });
check(["assets/bets.js", "assets/bets-core.js"].every(f => shellUrls.includes(BASE + f)), "SW shell cache includes bets.js + bets-core.js", "bets");
check(["assets/matchup.js", "assets/matchup-core.js"].every(f => shellUrls.includes(BASE + f)), "SW shell cache includes matchup.js + matchup-core.js", "matchup");
await page.goto(BASE + "#/bets", { waitUntil: "load" });
await page.waitForSelector(".bt-empty, .bt-stats", { timeout: 15000 }).catch(() => {});
check(!!(await page.$(".bt-empty")), "offline: #/bets renders the empty state", "bets");
await page.context().setOffline(false);
check(!!(await page.$('#betsBtn[href="#/bets"]')) && await page.$eval("#betsBtn", b => b.classList.contains("on")), "header My Bets button present and active on #/bets", "bets");
const upGid = (nfl.games.find(g => g.state === "pre") || nfl.games[0] || {}).id;
if (upGid) {
  await page.goto(BASE + `#/g/nfl/${upGid}`, { waitUntil: "networkidle" }); await waitView();
  const quick = await page.$(".bt-track a.bt-q") || await page.$(".bt-track a[href^='#/bets/add']");
  check(!!quick, `game page has a Track a bet card (${upGid})`, "bets");
  const gid = upGid;
  if (quick) {
    await quick.click(); await page.waitForSelector(".bt-form", { timeout: 10000 });
    check(await page.$eval('[data-f="game"]', s => s.value) === String(gid), "track link prefills the game", "bets");
    if (!(await page.$eval('[data-f="odds"]', i => i.value))) await page.fill('[data-f="odds"]', "-110");
    if (await page.$('[data-f="line"]') && !(await page.$eval('[data-f="line"]', i => i.value))) await page.fill('[data-f="line"]', "-3.5");
    await page.fill('[data-f="stake"]', "25");
    await page.click('.bt-form button[type="submit"]');
    await page.waitForFunction(() => location.hash === "#/bets/list", null, { timeout: 5000 }).catch(() => {});
    const saved = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem("ls-bets-v1")).bets; } catch { return []; } });
    check(saved.length === 1 && saved[0].stake === 25 && String((saved[0].event || {}).id) === String(gid) && saved[0].status === "pending", `saved bet in localStorage (${saved.length})`, "bets");
    await page.waitForSelector(".bt-list .bt-card", { timeout: 5000 }).catch(() => {});
    check((await page.$$(".bt-list .bt-card")).length === 1, "saved bet shows in the list", "bets");
    await page.reload({ waitUntil: "networkidle" });
    check((await page.$$(".bt-list .bt-card")).length === 1, "bet survives reload", "bets");
    page.once("dialog", d => d.accept());
    await page.click(".bt-card [data-del]");
    await page.waitForTimeout(300);
    check(await page.evaluate(() => JSON.parse(localStorage.getItem("ls-bets-v1")).bets.length) === 0, "delete removes it", "bets");
  }
}
await page.context().setOffline(false);
errors.length = errsOnline; // network errors while deliberately offline (e.g. ESPN logos) are expected
// ---------- game-day weather (chip on cards, section on game pages, Indoor for arenas)
{
  const up = nfl.games.filter(g => g.state === "pre" && g.weather);
  const fg = up.find(g => g.weather.kind === "forecast"), ig = up.find(g => g.weather.kind === "indoor");
  if (!up.length) check(false, "no NFL weather data in DATA_DIR (build without --no-weather)", "weather");
  else {
    await page.goto(BASE + "#/l/nfl", { waitUntil: "networkidle" });
    await page.waitForSelector(".game", { timeout: 15000 });
    const chips = await page.$$eval(".game .wx", els => els.map(e => e.textContent.trim()));
    check(chips.length >= up.length - 2 && chips.some(t => /\d+°/.test(t)), `NFL cards show weather chips (${chips.length}; e.g. "${chips.find(t => /°/.test(t)) || ""}")`, "weather");
    if (ig) check(chips.includes("Indoor"), `dome game chip says Indoor (${ig.venue})`, "weather");
    if (fg) {
      await page.goto(BASE + `#/g/nfl/${fg.id}`, { waitUntil: "networkidle" });
      await page.waitForSelector(".wx-card", { timeout: 15000 }).catch(() => {});
      const s = await page.evaluate(() => { const c = document.querySelector(".wx-card"); const a = c && c.querySelector(".wx-credit");
        return c && { big: c.querySelector(".wx-big")?.textContent, stats: c.querySelectorAll(".wx-stat").length, hours: c.querySelectorAll(".wx-h").length, credit: a?.textContent, href: a?.href }; });
      check(!!s && /\d+°/.test(s.big || "") && s.stats === 3 && s.hours >= 1, `game page weather section: ${s ? `${s.big} · ${s.stats} stats · ${s.hours} hours` : "missing"}`, "weather");
      check(!!s && s.credit === "Weather data by Open-Meteo.com" && /^https:\/\/open-meteo\.com/.test(s.href || ""), "Open-Meteo credit link", "weather");
    }
    if (ig) {
      await page.goto(BASE + `#/g/nfl/${ig.id}`, { waitUntil: "networkidle" });
      await page.waitForSelector(".wx-card", { timeout: 15000 }).catch(() => {});
      check(/Indoor/.test(await txt(".wx-card .wx-big")), "dome game page: Indoor, no forecast", "weather");
    }
  }
  const nba = JSON.parse(fs.readFileSync(`${DATA}/nba/index.json`)).games.filter(g => g.state === "pre");
  if (nba.length) {
    await page.goto(BASE + "#/l/nba", { waitUntil: "networkidle" });
    await page.waitForSelector(".game", { timeout: 15000 });
    const c = await page.$$eval(".game .wx", els => els.map(e => e.textContent.trim()));
    check(c.length > 0 && c.every(t => t === "Indoor"), `NBA cards all Indoor (${c.length})`, "weather");
  }
}
// ---------- player props (DraftKings via ESPN): section on game pages, last-5 strip, player-page card
for (const lg of ["nfl", "nba"]) {
  let pd = null;
  try { pd = JSON.parse(fs.readFileSync(`${DATA}/props/${lg}.json`)); } catch (e) {}
  if (!pd) { check(false, `no ${DATA}/props/${lg}.json (build without --no-props)`, "props"); continue; }
  const gidP = Object.keys(pd.games).find(k => pd.games[k].props.some(r => (pd.players[r[0]].log || []).some(x => x[3])));
  if (!gidP) { console.log(`  (props: no ${lg} game with player lines right now - skipped)`); continue; }
  const want = new Set(pd.games[gidP].props.map(r => r[0])).size;
  await page.goto(BASE + `#/g/${lg}/${gidP}`, { waitUntil: "networkidle" });
  await page.waitForSelector("#ppBox .pp-card", { timeout: 15000 }).catch(() => {});   // #ppBox: not a leftover card from the previous player page
  const s = await page.evaluate(() => ({ cards: document.querySelectorAll(".pp-card").length, shown: [...document.querySelectorAll(".pp-card")].filter(c => !c.hidden).length,
    boxes: [...document.querySelectorAll(".pp-card:not([hidden]) .pp-b")].map(b => b.className.replace("pp-b ", "")), sum: document.querySelector(".pp-xs")?.textContent || "",
    more: document.querySelector(".pp-more:not([hidden])")?.textContent || "", note: document.querySelector(".pp-note")?.textContent || "", title: document.getElementById("props")?.textContent || "" }));
  check(s.cards === want && /Player props/.test(s.title), `${lg} game ${gidP}: Player props section, ${s.cards}/${want} players`, "props");
  check(s.boxes.length > 0 && s.boxes.every(c => /^pp-[oupx]$/.test(c)) && s.boxes.some(c => c === "pp-o" || c === "pp-u"), `${lg} last-5 boxes coloured (${s.boxes.length}: ${[...new Set(s.boxes)]})`, "props");
  check(/^\d+\/\d+ over$|^No recent games$/.test(s.sum) && /DraftKings/.test(s.note), `${lg} summary "${s.sum}" + DraftKings source note`, "props");
  if (s.cards > 6) {
    check(s.shown === 6 && /Show all/.test(s.more), `${lg} collapsed to 6 with "${s.more}"`, "props");
    await page.click(".pp-more");
    check(await page.$$eval(".pp-card", e => e.filter(c => !c.hidden).length) === s.cards, `${lg} Show all expands`, "props");
  }
  // Hot filter (4/5+ over, or same share with fewer games), combined with the prop-type chips and the team filter
  const vis = () => page.evaluate(() => {
    const rows = [...document.querySelectorAll("#ppBox .pp-card:not([hidden]) .pp-row:not([hidden])")];
    return { rows: rows.length, hot: rows.filter(r => r.dataset.hot === "1").length, mks: [...new Set(rows.map(r => r.dataset.mk))],
      teams: [...new Set(rows.map(r => r.closest(".pp-card").dataset.team))],
      overs: rows.map(r => [r.querySelectorAll(".pp-o").length, r.querySelectorAll(".pp-o,.pp-u,.pp-p").length]),
      label: document.querySelector("#ppBox .pp-hot")?.textContent || "", empty: !document.querySelector("#ppBox .pp-empty").hidden };
  });
  const expHot = pd.games[gidP].props.filter(r => {
    const g5 = (pd.players[r[0]].log || []).slice(0, 5).map(x => x[3] && typeof x[3][r[1]] === "number" ? x[3][r[1]] : null).filter(v => v !== null);
    return g5.length >= 2 && g5.filter(v => v > r[2]).length >= Math.ceil(0.8 * g5.length - 1e-9);
  }).length;
  if (await page.$("#ppBox .pp-more:not([hidden])")) await page.click("#ppBox .pp-more");
  await page.click("#ppBox .pp-hot");
  const h = await vis();
  check(/Hot: 4\/5\+ over/.test(h.label) && h.label.includes(String(expHot)), `${lg} Hot toggle "${h.label.trim()}" (expected ${expHot})`, "props");
  check(h.rows === h.hot && h.overs.every(([o, n]) => n >= 2 && o >= Math.ceil(0.8 * n - 1e-9)) && (h.rows > 0 || h.empty), `${lg} Hot shows only 4/5+ (or 3/3) props: ${h.rows} rows`, "props");
  const hotMk = pd.games[gidP].props.find(r => { const g5 = (pd.players[r[0]].log || []).slice(0, 5).map(x => x[3] && x[3][r[1]]).filter(v => typeof v === "number"); return g5.length >= 2 && g5.filter(v => v > r[2]).length >= Math.ceil(0.8 * g5.length - 1e-9); });
  if (hotMk) {
    const short = pd.markets[hotMk[1]][1];
    await page.click(`#ppBox .pp-chips [data-m="${hotMk[1]}"]`);
    const hm = await vis();
    check(hm.rows > 0 && hm.mks.join() === hotMk[1] && hm.rows === hm.hot, `${lg} Hot + "${short}" chip: ${hm.rows} hot ${short} rows`, "props");
    const team = pd.players[hotMk[0]].t;
    await page.click(`#ppBox .pp-tabs [data-f="${team}"]`);
    const ht = await vis();
    check(ht.rows > 0 && ht.teams.join() === String(team) && ht.mks.join() === hotMk[1] && ht.rows === ht.hot, `${lg} Hot + chip + team ${team}: ${ht.rows} rows`, "props");
    await page.click("#ppBox .pp-hot");
    const off = await vis();
    check(off.rows >= ht.rows && off.mks.join() === hotMk[1] && off.teams.join() === String(team), `${lg} Hot off keeps chip + team (${off.rows} rows)`, "props");
  }
  const pid = pd.games[gidP].props[0][0];
  await page.goto(BASE + `#/p/${lg}/${pid}`, { waitUntil: "networkidle" });
  await page.waitForSelector("#ppPlayer .pp-card", { timeout: 15000 }).catch(() => {});
  const pp = await page.evaluate(() => ({ rows: document.querySelectorAll("#ppPlayer .pp-row").length, game: document.querySelector("#ppPlayer .pp-game")?.getAttribute("href") || "" }));
  check(pp.rows > 0 && pp.game.includes(`/${lg}/`), `${lg} player ${pid} page: ${pp.rows} prop rows linking to ${pp.game}`, "props");
}
// ---------- UFC: league tab, fight cards, fight page with lines, fighter page with last-5 strip, fighter search
{
  let ui = null, fx = null;
  try { ui = JSON.parse(fs.readFileSync(`${DATA}/ufc/index.json`)); fx = JSON.parse(fs.readFileSync(`${DATA}/ufc/fighters.json`)).fighters; } catch (e) {}
  if (!ui) check(false, `no ${DATA}/ufc/index.json`, "ufc");
  else {
    await page.goto(BASE, { waitUntil: "networkidle" });
    check(!!(await page.$('a[href="#/l/ufc"]')), "UFC league tab in the nav", "ufc");
    await page.goto(BASE + "#/l/ufc", { waitUntil: "networkidle" });
    await page.waitForSelector(".uf-ev .bout, .empty", { timeout: 15000 }).catch(() => {});
    const L = await page.evaluate(() => ({ ev: document.querySelectorAll(".uf-ev").length, bouts: document.querySelectorAll(".uf-ev .bout").length,
      segs: [...document.querySelectorAll(".uf-ev .day")].map(e => e.textContent.trim()), weather: document.querySelectorAll(".wx, .wx-card").length }));
    const upEv = ui.events.filter(e => e.state !== "post");
    check(L.ev === upEv.length && L.bouts > 0 && L.segs.some(t => /Main card/i.test(t)), `#/l/ufc: ${L.ev} upcoming cards, ${L.bouts} bouts, segments ${[...new Set(L.segs)].slice(0, 3)}`, "ufc");
    check(L.weather === 0, "no weather on UFC cards", "ufc");
    await footerOk("ufc league");
    const g = ui.games.find(x => x.state === "pre" && x.odds && x.odds.awayML != null && fx && fx[x.away.id] && (fx[x.away.id].hist || []).length) || ui.games.find(x => x.odds);
    if (g) {
      await page.goto(BASE + `#/g/ufc/${g.id}`, { waitUntil: "networkidle" });
      await page.waitForSelector(".uf-match", { timeout: 15000 }).catch(() => {});
      const F = await page.evaluate(() => ({ hero: document.querySelector(".uf-match")?.textContent || "", books: document.querySelectorAll(".books").length,
        links: [...document.querySelectorAll(".uf-match a[href^='#/p/ufc/']")].map(a => a.getAttribute("href")), lines: document.body.textContent }));
      check(F.hero.includes(g.away.name) && F.hero.includes(g.home.name), `fight page ${g.id}: ${g.away.name} vs ${g.home.name}`, "ufc");
      check(F.books > 0 && /DraftKings/.test(F.lines) && F.lines.includes((g.odds.awayML > 0 ? "+" : "") + g.odds.awayML), `fight page lines card with DraftKings ML ${g.odds.awayML}`, "ufc");
      check(F.links.includes(`#/p/ufc/${g.away.id}`) && F.links.includes(`#/p/ufc/${g.home.id}`), "fight page links both fighters", "ufc");
      check(!/Key matchups|Player props for/.test(F.lines) && /Fight props/.test(F.lines), "matchups / props skipped (fight props noted unavailable)", "ufc");
      await footerOk("ufc fight");
      await page.goto(BASE + `#/p/ufc/${g.away.id}`, { waitUntil: "networkidle" });
      await page.waitForSelector(".phero .av + .ph-t h1", { timeout: 20000 }).catch(() => {});   // the fighter view, not the fight page's last-5 cards
      const P = await page.evaluate(() => ({ h1: document.querySelector(".phero h1")?.textContent || "", boxes: [...(document.querySelector(".phero ~ .card .uf-l5")?.querySelectorAll(".pp-b") || [])].map(b => b.className.split(" ").find(c => /^pp-[oup]$/.test(c))) }));
      const want = Math.min(5, (fx[g.away.id].hist || []).length);
      check(P.h1.includes(g.away.name) && P.boxes.length === want && P.boxes.every(Boolean), `fighter page ${g.away.name}: last-5 strip ${P.boxes.length}/${want} (${P.boxes})`, "ufc");
      await footerOk("ufc fighter");
    } else check(false, "no UFC bout with odds in the data", "ufc");
    const sd = sx("ufc");
    if (sd && sd.players.length) {
      const pl = sd.players[0];
      await page.goto(BASE + "#/search", { waitUntil: "networkidle" });
      await page.waitForSelector("#q");
      await page.click('.sfilt [data-lg="ufc"]').catch(() => {});
      await page.fill("#q", pl[1]);
      await page.waitForSelector(".sr", { timeout: 15000 }).catch(() => {});
      const hrefs = await page.$$eval(".sr", a => a.map(x => x.getAttribute("href")));
      check(hrefs.includes(`#/p/ufc/${pl[0]}`), `search "${pl[1]}" finds the fighter`, "ufc");
    } else check(false, "no search/ufc.json", "ufc");
  }
}
// ---------- state-aware offers (geo lookup stubbed; never reaches ipdata.info) + analytics host gate
{
  const FL_RESP = { country_code: "US", region_code: "FL", ip: "203.0.113.7" };
  const mk = async (geo, extra = {}) => {
    const ctx = await browser.newContext({ serviceWorkers: "block", ...extra });
    const seen = [];
    await ctx.route(/ipdata\.info/, r => { seen.push(r.request().url()); return geo === "fail" ? r.abort() : r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(geo) }); });
    await ctx.route(/cloudflareinsights\.com/, r => { seen.push(r.request().url()); return r.fulfill({ status: 200, contentType: "text/javascript", body: "" }); });
    // This context can spoof the linesmart.app host (analytics beacon check). Never let that reach the
    // visits-by-state RPC, even if the bot filter is bypassed. Playwright is also webdriver, which geo.js skips.
    await ctx.route(/supabase\.co/, r => r.abort());
    await ctx.addInitScript(() => { localStorage.setItem("ls-age-ok", "1"); localStorage.setItem("ls-geo-force", "1"); });
    const p = await ctx.newPage();
    p.on("pageerror", e => errors.push("geo: " + e.message));
    return { ctx, p, seen };
  };
  const offers = p => p.evaluate(() => { const c = document.querySelector("[data-offers]"); return c ? { status: c.dataset.status || "ok", books: [...c.querySelectorAll("[data-book]")].map(a => a.dataset.book), text: c.innerText, hrefs: [...c.querySelectorAll("a[data-book]")].map(a => a.href) } : null; });
  // any link to DraftKings/FanDuel/BetMGM: sportsbook URLs or bet-tracker quick-log shortcuts (bk=draftkings)
  const dkfdLinks = p => p.$$eval("a[href]", as => as.map(a => a.href).filter(h => /draftkings|fanduel|betmgm/i.test(h)));
  { // Florida visitor via (stubbed) geo-IP lookup
    const { ctx, p, seen } = await mk(FL_RESP);
    await p.goto(BASE, { waitUntil: "networkidle" }); await p.waitForSelector("[data-offers]", { timeout: 15000 }).catch(() => {});
    const o = await offers(p);
    check(o && JSON.stringify(o.books) === '["hardrockbet"]' && /Hard Rock Bet/.test(o.text), `FL home: only Hard Rock Bet offer (${o && o.books})`, "geo");
    check(o && /21\+/.test(o.text) && /Gambling problem\? Call 1-833-PLAYWISE \(Florida\) or 1-800-GAMBLER/.test(o.text), "FL offer shows 21+, 1-833-PLAYWISE first, then 1-800-GAMBLER", "geo");
    check(o && /may earn a commission from sportsbook links/.test(o.text) && /never changes the odds/.test(o.text) && /state-specific/.test(o.text), "FL offer: short affiliate disclosure", "geo");
    const flFoot = await p.$eval("[data-rg-local]", e => ({ hidden: e.hidden, t: e.innerText }));
    check(!flFoot.hidden && /PLAYWISE/.test(flFoot.t), "FL footer: Florida helpline line shown", "geo");
    check(o && o.hrefs[0] === "https://www.hardrock.bet/" && !/\$\d|bonus|promo/i.test(o.text), "FL offer: official site, no bonus/promo claims", "geo");
    check(!(await dkfdLinks(p)).length, "FL home: no DraftKings/FanDuel/BetMGM links", "geo");
    check((await p.$eval("#stateBtn .st-l", e => e.textContent)) === "FL" && seen.some(u => /ipdata/.test(u)), "FL: lookup used (stubbed) and header shows FL", "geo");
    const cached = await p.evaluate(() => JSON.parse(localStorage.getItem("ls-geo") || "{}"));
    check(cached.country === "US" && cached.region === "FL" && !cached.ip, "lookup cached as country/state only (no IP stored)", "geo");
    if (gid) {
      await p.goto(BASE + `#/g/nfl/${gid}`, { waitUntil: "networkidle" }); await p.waitForSelector(".match", { timeout: 15000 }).catch(() => {});
      const g = await p.evaluate(() => ({ heads: [...document.querySelectorAll(".books thead th")].map(t => t.textContent.replace(/\s+/g, " ")), naCols: document.querySelectorAll(".books th.na-col").length,
        bestNa: document.querySelectorAll(".books td.na-col.best").length, offer: [...document.querySelectorAll("[data-offers] [data-book]")].map(a => a.dataset.book) }));
      const dkHead = g.heads.find(h => /DraftKings/.test(h)) || "";
      check(/Not available in FL/.test(dkHead) && g.naCols >= 1 && g.bestNa === 0, `FL game: DraftKings column labeled "Not available in FL", never highlighted best (${dkHead})`, "geo");
      check(g.heads.findIndex(h => /Hard Rock/.test(h)) < g.heads.findIndex(h => /DraftKings/.test(h)), "FL game: Hard Rock Bet column first", "geo");
      check(JSON.stringify(g.offer) === '["hardrockbet"]' && !(await dkfdLinks(p)).length, "FL game: Hard Rock offer only, no DK/FD links", "geo");
      // manual override through the picker: New Jersey
      await p.click("#stateBtn"); await p.waitForSelector("#stateDlg[open] #stSel");
      await p.selectOption("#stSel", "NJ"); await p.click("#stSave"); await p.waitForTimeout(600);
      const nj = await offers(p);
      check(nj && JSON.stringify([...nj.books].sort()) === '["betmgm","draftkings","fanduel","hardrockbet"]', `override NJ: all four offers incl. BetMGM (${nj && nj.books})`, "geo");
      check(nj && nj.hrefs.includes("https://sports.betmgm.com/") && /21\+/.test(nj.text) && /1-800-GAMBLER/.test(nj.text) && !/\$\d|bonus|promo/i.test(nj.text), "NJ: BetMGM official link, 21+ and helpline, no bonus claims", "geo");
      check(!(await p.$$eval(".books thead th", ths => ths.filter(t => /BetMGM/i.test(t.innerText)).length)), "NJ game: no BetMGM odds column", "geo");
      check(nj && /Call or text 1-800-GAMBLER/.test(nj.text) && !/PLAYWISE/.test(nj.text) && /may earn a commission/.test(nj.text), "NJ offer: 1-800-GAMBLER only + affiliate disclosure", "geo");
      check(await p.$eval("[data-rg-local]", e => e.hidden && getComputedStyle(e).display === "none"), "NJ footer: Florida helpline line hidden", "geo");
      check(await p.evaluate(() => localStorage.getItem("ls-state")) === "NJ" && (await p.$$(".books th.na-col")).length === 0, "override NJ saved; no columns marked unavailable", "geo");
      await p.reload({ waitUntil: "networkidle" }); await p.waitForSelector("[data-offers]", { timeout: 15000 }).catch(() => {});
      check(((await offers(p)) || {}).books?.length === 4, "override persists over the FL lookup after reload", "geo");
      // non-legal state
      await p.click("#stateBtn"); await p.selectOption("#stSel", "TX"); await p.click("#stSave"); await p.waitForTimeout(600);
      const tx = await offers(p);
      check(tx && tx.status === "notlegal" && !tx.books.length && /isn't legal in Texas/.test(tx.text) && !(await dkfdLinks(p)).length && !(await p.$$("a[href*='hardrock.bet']")).length, "TX: no offers, neutral note, no sportsbook links", "geo");
      // Nevada: BetMGM hidden by choice -> neutral note, no sportsbook links
      await p.click("#stateBtn"); await p.selectOption("#stSel", "NV"); await p.click("#stSave"); await p.waitForTimeout(600);
      const nv = await offers(p);
      check(nv && nv.status === "nobooks" && !nv.books.length && /don't show sportsbook offers in Nevada/.test(nv.text) && !(await dkfdLinks(p)).length, `NV: no offers (no BetMGM), neutral note (${nv && nv.status})`, "geo");
      // back to automatic
      await p.click("#stateBtn"); await p.selectOption("#stSel", ""); await p.click("#stSave"); await p.waitForTimeout(600);
      check(((await offers(p)) || {}).books?.join() === "hardrockbet", "picker 'Automatic' returns to the FL lookup", "geo");
    }
    await ctx.close();
  }
  { // lookup fails -> unknown: no offers until a state is picked
    const { ctx, p } = await mk("fail");
    await p.goto(BASE, { waitUntil: "networkidle" }); await p.waitForSelector("[data-offers]", { timeout: 15000 }).catch(() => {});
    const o = await offers(p);
    check(o && o.status === "unknown" && !o.books.length && !(await dkfdLinks(p)).length, "lookup failure: no offers, prompt to pick a state", "geo");
    await ctx.close();
  }
  { // non-US visitor
    const { ctx, p } = await mk({ country_code: "CA", region_code: "ON" });
    await p.goto(BASE, { waitUntil: "networkidle" }); await p.waitForSelector("[data-offers]", { timeout: 15000 }).catch(() => {});
    const o = await offers(p);
    check(o && o.status === "nonus" && !o.books.length, "non-US visitor: no offers", "geo");
    await ctx.close();
  }
  { // production host: the beacon is injected (stubbed here, never sent to Cloudflare), with the configured token
    const { ctx, p, seen } = await mk(FL_RESP);
    await ctx.route(/^https:\/\/linesmart\.app\//, async r => { const u = new URL(r.request().url()); const res = await ctx.request.get(BASE + u.pathname.slice(1) + u.search); return r.fulfill({ status: res.status(), headers: res.headers(), body: await res.body() }); });
    for (const path of ["", "privacy.html"]) {
      await p.goto("https://linesmart.app/" + path, { waitUntil: "load" }); await p.waitForTimeout(500);
      const b = await p.evaluate(() => { const s = document.querySelector("script[data-cf-beacon]"); return s ? { src: s.src, type: s.type, cfg: s.getAttribute("data-cf-beacon"), last: s.parentElement === document.body } : null; });
      check(b && b.src === "https://static.cloudflareinsights.com/beacon.min.js" && b.type === "module" && JSON.parse(b.cfg).token === window_token() && b.last, `linesmart.app/${path}: beacon injected before </body> with token`, "analytics");
    }
    check(seen.some(u => /static\.cloudflareinsights\.com/.test(u)), "beacon request intercepted by the stub (not sent)", "analytics");
    await ctx.close();
  }
}
// the local/test hosts must never have loaded the beacon or called the geo service
check(!thirdParty.length, `no requests to cloudflareinsights.com / ipdata.info from the test host${thirdParty.length ? ": " + thirdParty : ""}`, "analytics");
check(!(await page.$("script[data-cf-beacon]")), "no beacon script on the test host", "analytics");
await browser.close();
if (pwaFail.length) console.log("PWA failures:", pwaFail);
const outside = [...ok].filter(p => !p.startsWith(new URL(BASE).pathname));
console.log("same-origin paths loaded:", ok.size, "| outside subpath:", outside.length ? outside : "none");
console.log("http errors:", bad.length ? bad : "none");
console.log("js errors:", errors.length ? errors : "none");
process.exit(errors.length || bad.length || outside.length || pwaFail.length ? 1 : 0);
