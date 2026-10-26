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
page.on("requestfailed", r => { if (r.url().startsWith(new URL(BASE).origin)) bad.push(`FAILED ${r.url()}`); });
const pwaFail = [];
const check = (ok, msg, tag = "pwa") => { console.log(`${ok ? "PASS" : "FAIL"} ${tag}: ${msg}`); if (!ok) pwaFail.push(`${tag}: ${msg}`); };
const LEGAL = [["responsible-gambling.html", "Responsible Gambling"], ["privacy.html", "Privacy Policy"], ["terms.html", "Terms of Use"], ["affiliate-disclosure.html", "Affiliate Disclosure"]];
const CONTACT = "contact@linesmart.app";
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
  if (file !== "responsible-gambling.html") check(info.note === "This is a general template, not legal advice.", `${file}: template note`, "legal");
  if (file === "privacy.html") check(info.text.includes(CONTACT) && info.text.includes("Effective date: October 26, 2026") && ["ls-recent", "ls-age-ok", "site.web.api.espn.com", "a.espncdn.com", "GitHub Pages"].every(w => info.text.includes(w)), "privacy: contact, date, storage keys, ESPN hosts, GitHub", "legal");
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
  const pid = pd.games[gidP].props[0][0];
  await page.goto(BASE + `#/p/${lg}/${pid}`, { waitUntil: "networkidle" });
  await page.waitForSelector("#ppPlayer .pp-card", { timeout: 15000 }).catch(() => {});
  const pp = await page.evaluate(() => ({ rows: document.querySelectorAll("#ppPlayer .pp-row").length, game: document.querySelector("#ppPlayer .pp-game")?.getAttribute("href") || "" }));
  check(pp.rows > 0 && pp.game.includes(`/${lg}/`), `${lg} player ${pid} page: ${pp.rows} prop rows linking to ${pp.game}`, "props");
}
await browser.close();
if (pwaFail.length) console.log("PWA failures:", pwaFail);
const outside = [...ok].filter(p => !p.startsWith(new URL(BASE).pathname));
console.log("same-origin paths loaded:", ok.size, "| outside subpath:", outside.length ? outside : "none");
console.log("http errors:", bad.length ? bad : "none");
console.log("js errors:", errors.length ? errors : "none");
process.exit(errors.length || bad.length || outside.length || pwaFail.length ? 1 : 0);
