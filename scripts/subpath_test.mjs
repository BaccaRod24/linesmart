// Serves nothing itself: expects the site to be reachable at $BASE (e.g. http://localhost:8799/linesmart/).
// Usage: mkdir -p /tmp/ghp && ln -sfn "$PWD/site" /tmp/ghp/linesmart && python3 -m http.server 8799 -d /tmp/ghp &
//        BASE=http://localhost:8799/linesmart/ node scripts/subpath_test.mjs
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
for (const r of routes) {
  await page.goto(BASE + r, { waitUntil: "networkidle" });
  if (r) await page.evaluate(() => window.dispatchEvent(new HashChangeEvent("hashchange")));
  await page.waitForSelector(".game, .match, .empty, .back", { timeout: 15000 });
  const n = await page.$$eval(".game", els => els.length);
  const loading = await page.$(".loading");
  console.log(`route ${r || "(root)"}: .game=${n} loadingStuck=${!!loading}`);
}

// ---------- search + team + player pages (ESPN client-side; needs DATA_DIR with search/ built by build_data.py)
const pwaFail = [];
const check = (ok, msg, tag = "pwa") => { console.log(`${ok ? "PASS" : "FAIL"} ${tag}: ${msg}`); if (!ok) pwaFail.push(`${tag}: ${msg}`); };
const sx = lg => { try { return JSON.parse(fs.readFileSync(`${DATA}/search/${lg}.json`)); } catch { return null; } };
const txt = sel => page.$eval(sel, e => e.textContent.trim()).catch(() => "");
const waitView = () => page.waitForSelector(".phero, .empty", { timeout: 20000 }).then(() => page.waitForLoadState("networkidle")).catch(() => {});
check(!!(await page.$('#searchBtn[href="#/search"]')), "header search button present", "search");
await page.goto(BASE + "#/search", { waitUntil: "networkidle" });
await page.waitForSelector("#q", { timeout: 15000 });
await page.fill("#q", "Eagles");
await page.waitForSelector(".sr", { timeout: 15000 }).catch(() => {});
const first = await txt(".sr .sr-t b");
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
  check(tn.includes(t[1]) && nRost > 0, `team ${t[1]}: h1="${tn}" roster=${nRost} stats=${nStat} games=${(await page.$$(".grow")).length}`, lg);
  // roster -> player page
  await page.click(`.roster a[href="#/p/${lg}/${pl[0]}"]`).catch(() => page.goto(BASE + `#/p/${lg}/${pl[0]}`));
  await page.waitForFunction(n => (document.querySelector(".phero h1") || {}).textContent?.includes(n), pl[1], { timeout: 20000 }).catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
  const pn = await txt(".phero h1");
  check(pn.includes(pl[1]), `player ${pl[1]}: h1="${pn}" stats=${(await page.$$(".stat")).length} gamelog=${(await page.$$(".glog tbody tr")).length} na=${(await page.$$(".na-card")).length}`, lg);
  // deep link reload of the player page
  await page.reload({ waitUntil: "domcontentloaded" }); await waitView();
  check((await txt(".phero h1")).includes(pl[1]), "player deep link survives reload", lg);
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
// My Bets: on-device tracker (still offline here, so this also proves the route works from the SW cache)
const shellUrls = await page.evaluate(async () => { for (const n of await caches.keys()) if (n.startsWith("linesmart-shell-")) return (await (await caches.open(n)).keys()).map(r => r.url); return []; });
check(["assets/bets.js", "assets/bets-core.js"].every(f => shellUrls.includes(BASE + f)), "SW shell cache includes bets.js + bets-core.js", "bets");
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
await browser.close();
if (pwaFail.length) console.log("PWA failures:", pwaFail);
const outside = [...ok].filter(p => !p.startsWith(new URL(BASE).pathname));
console.log("same-origin paths loaded:", ok.size, "| outside subpath:", outside.length ? outside : "none");
console.log("http errors:", bad.length ? bad : "none");
console.log("js errors:", errors.length ? errors : "none");
process.exit(errors.length || bad.length || outside.length || pwaFail.length ? 1 : 0);
