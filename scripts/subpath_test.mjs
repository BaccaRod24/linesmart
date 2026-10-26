// Serves nothing itself: expects the site to be reachable at $BASE (e.g. http://localhost:8799/linesmart/).
// Usage: mkdir -p /tmp/ghp && ln -sfn "$PWD/site" /tmp/ghp/linesmart && python3 -m http.server 8799 -d /tmp/ghp &
//        BASE=http://localhost:8799/linesmart/ node scripts/subpath_test.mjs
import { chromium } from "playwright";
import fs from "fs";
const BASE = process.env.BASE || "http://localhost:8799/linesmart/";
const meta = JSON.parse(fs.readFileSync("site/data/meta.json"));
const nfl = JSON.parse(fs.readFileSync("site/data/nfl/index.json"));
const gid = (nfl.games[0] || {}).id;
const routes = ["", ...meta.order.map(k => `#/l/${k}`), gid ? `#/g/nfl/${gid}` : null].filter(r => r !== null);
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [], bad = [], ok = new Set();
page.on("pageerror", e => errors.push(e.message));
page.on("console", m => m.type() === "error" && errors.push(m.text()));
page.on("response", r => { const u = r.url(); if (u.startsWith(new URL(BASE).origin)) { if (r.status() >= 400) bad.push(`${r.status()} ${u}`); else ok.add(new URL(u).pathname); } });
page.on("requestfailed", r => { if (r.url().startsWith(new URL(BASE).origin)) bad.push(`FAILED ${r.url()}`); });
for (const r of routes) {
  await page.goto(BASE + r, { waitUntil: "networkidle" });
  if (r) await page.evaluate(() => window.dispatchEvent(new HashChangeEvent("hashchange")));
  await page.waitForSelector(".game, .match, .empty, .back", { timeout: 15000 });
  const n = await page.$$eval(".game", els => els.length);
  const loading = await page.$(".loading");
  console.log(`route ${r || "(root)"}: .game=${n} loadingStuck=${!!loading}`);
}

// ---------- PWA checks
const pwaFail = [];
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"} pwa: ${msg}`); if (!ok) pwaFail.push(msg); };
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
await page.context().setOffline(false);
errors.length = errsOnline; // network errors while deliberately offline (e.g. ESPN logos) are expected
await browser.close();
if (pwaFail.length) console.log("PWA failures:", pwaFail);
const outside = [...ok].filter(p => !p.startsWith(new URL(BASE).pathname));
console.log("same-origin paths loaded:", ok.size, "| outside subpath:", outside.length ? outside : "none");
console.log("http errors:", bad.length ? bad : "none");
console.log("js errors:", errors.length ? errors : "none");
process.exit(errors.length || bad.length || outside.length || pwaFail.length ? 1 : 0);
