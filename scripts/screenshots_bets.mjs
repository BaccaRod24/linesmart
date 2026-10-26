// Screenshots of the My Bets tracker using the EXAMPLE fixture (scripts/fixtures/demo-bets.json).
// The fixture is injected into localStorage for this headless browser only, with a flag that makes the page show an
// "Example data" banner. Nothing here ships in site/.
// Usage: serve site/ (see subpath_test.mjs), then BASE=http://localhost:8799/linesmart/ OUT=screenshots node scripts/screenshots_bets.mjs
import { chromium } from "playwright";
import fs from "fs";
const BASE = process.env.BASE || "http://localhost:8799/linesmart/";
const OUT = process.env.OUT || "screenshots";
fs.mkdirSync(OUT, { recursive: true });
const demo = JSON.parse(fs.readFileSync(new URL("./fixtures/demo-bets.json", import.meta.url))).bets;
const browser = await chromium.launch();
const errors = [];
async function ctx(viewport, mobile) {
  const c = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile, serviceWorkers: "block" });
  await c.addInitScript(d => {
    if (!localStorage.getItem("ls-bets-v1")) { localStorage.setItem("ls-bets-v1", JSON.stringify({ v: 1, bets: d })); localStorage.setItem("ls-bets-demo", "1"); }
  }, demo);
  const p = await c.newPage();
  p.on("pageerror", e => errors.push(e.message));
  p.on("console", m => m.type() === "error" && errors.push(m.text()));
  return p;
}
const shot = async (p, name, full = true) => { if (full) { await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(150); } const f = `${OUT}/${name}`; await p.screenshot({ path: f, fullPage: full }); console.log("wrote", f); };
const go = async (p, hash, sel) => { await p.goto(BASE + hash, { waitUntil: "networkidle" }); await p.waitForSelector(sel, { timeout: 15000 }); await p.waitForTimeout(400); };

const m = await ctx({ width: 390, height: 844 }, true);
await go(m, "#/bets", ".bt-svg");
await shot(m, "bets-mobile-dashboard.png");
await shot(m, "bets-mobile-dashboard-top.png", false);
await go(m, "#/bets/list", ".bt-card");
await shot(m, "bets-mobile-list.png");
await m.click('[data-settle="demo-12"]'); await m.waitForSelector("#btDlg[open]"); await m.click('.bt-rb[data-st="cashout"]'); await m.fill('#btDlg [name="co"]', "30");
await shot(m, "bets-mobile-settle.png", false);
await m.click("#btDlg [data-x]");
await go(m, "#/bets/add?lg=nfl&ev=401873009&mk=spread&side=home&ln=4.5&od=-112&bk=draftkings", ".bt-form");
await m.fill('[data-f="stake"]', "50");
await shot(m, "bets-mobile-add.png");
await go(m, "#/bets/add", ".bt-form");
await m.click('[data-a="type"][data-v="parlay"]');
await shot(m, "bets-mobile-add-parlay.png");
await go(m, "#/g/nfl/401873009", ".bt-track");
await m.$eval(".bt-track", e => e.scrollIntoView({ block: "center" }));
await shot(m, "bets-mobile-track-from-game.png", false);

const d = await ctx({ width: 1280, height: 800 }, false);
await go(d, "#/bets", ".bt-svg");
await shot(d, "bets-desktop-dashboard.png");
await shot(d, "bets-desktop-dashboard-top.png", false);
await browser.close();
console.log("js errors:", errors.length ? errors : "none");
process.exit(errors.length ? 1 : 0);
