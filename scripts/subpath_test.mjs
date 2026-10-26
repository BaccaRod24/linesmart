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
await browser.close();
const outside = [...ok].filter(p => !p.startsWith(new URL(BASE).pathname));
console.log("same-origin paths loaded:", ok.size, "| outside subpath:", outside.length ? outside : "none");
console.log("http errors:", bad.length ? bad : "none");
console.log("js errors:", errors.length ? errors : "none");
process.exit(errors.length || bad.length || outside.length ? 1 : 0);
