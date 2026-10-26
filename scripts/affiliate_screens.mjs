// Affiliate-review screenshots (iPhone 13). State comes from the manual override (localStorage ls-state), so no geo
// lookup runs; the analytics beacon is host-gated to linesmart.app and never loads here (also blocked below).
//   BASE=http://localhost:8798/ node scripts/affiliate_screens.mjs   (GAME=<nflGameId> optional)
import { chromium, devices } from "playwright";
import fs from "fs";
const BASE = process.env.BASE || "http://localhost:8798/";
const out = new URL("../screenshots/", import.meta.url).pathname; fs.mkdirSync(out, { recursive: true });
const nfl = await (await fetch(BASE + "data/nfl/index.json")).json();
const gid = process.env.GAME || (nfl.games.find(g => g.state === "pre" && g.books && g.books.hardrockbet && g.books.draftkings) || nfl.games[0]).id;
const browser = await chromium.launch();
const errors = [];
async function shot(name, path, { state = null, until = null, maxH = 4200, fn = null } = {}) {
  const ctx = await browser.newContext({ ...devices["iPhone 13"], serviceWorkers: "block" });
  await ctx.route(/cloudflareinsights|ipdata\.info/, r => r.abort());
  await ctx.addInitScript(st => { localStorage.setItem("ls-age-ok", new Date().toISOString()); if (st) localStorage.setItem("ls-state", st); }, state);
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(`${name}: ${e.message}`));
  await page.goto(BASE + path, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  if (fn) { await fn(page); await page.screenshot({ path: `${out}${name}.png`, animations: "disabled" }); }
  else {
    await page.addStyleTag({ content: ".bnav{display:none!important}" });
    const H = await page.evaluate(() => document.documentElement.scrollHeight);
    const end = until ? await page.$eval(until, e => e.getBoundingClientRect().bottom + scrollY + 16) : H;
    await page.screenshot({ path: `${out}${name}.png`, fullPage: true, animations: "disabled", clip: { x: 0, y: 0, width: page.viewportSize().width, height: Math.min(maxH, end, H) } });
  }
  console.log(`screenshots/${name}.png  ${path}${state ? "  (state " + state + ")" : ""}`);
  await ctx.close();
}
await shot("affiliate-about", "about.html");
await shot("affiliate-privacy", "privacy.html", { maxH: 6000 });
await shot("affiliate-home-fl", "", { state: "FL", until: "[data-offers]", maxH: 6000 });
await shot("affiliate-game-fl", `#/g/nfl/${gid}`, { state: "FL", until: "[data-offers]", maxH: 6000 });
await shot("affiliate-game-nj", `#/g/nfl/${gid}`, { state: "NJ", until: "[data-offers]", maxH: 6000 });
await shot("affiliate-state-picker", "", { state: "FL", fn: async p => { await p.click("#stateBtn"); await p.waitForSelector("#stateDlg[open]"); await p.waitForTimeout(300); } });
await browser.close();
console.log("js errors:", errors.length ? errors : "none");
process.exit(errors.length ? 1 : 0);
