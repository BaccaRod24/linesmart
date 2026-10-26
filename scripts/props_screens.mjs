// Player props screenshots (iPhone 13). Serve a site whose data/ was built with props (never commit live data), e.g.
//   BASE=http://localhost:8798/ NFL_G=401873009 NBA_G=401909868 node scripts/props_screens.mjs   (PLAYER=nba/<id> optional)
import { chromium, devices } from "playwright";
import fs from "fs";
const BASE = process.env.BASE || "http://localhost:8798/";
const NFL_G = process.env.NFL_G || "401873009", NBA_G = process.env.NBA_G || "401909868";
const out = "screenshots"; fs.mkdirSync(out, { recursive: true });
const phone = devices["iPhone 13"];
const browser = await chromium.launch();
const errors = [];
async function shot(name, hash, sel, maxH = 1500) {
  const ctx = await browser.newContext(phone);
  await ctx.addInitScript(() => { try { localStorage.setItem("ls-age-ok", new Date().toISOString()); } catch (e) {} });
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(`${name}: ${e.message}`));
  page.on("console", m => m.type() === "error" && !/favicon|Failed to load resource/.test(m.text()) && errors.push(`${name}: ${m.text()}`));
  if (typeof hash === "function") hash = await hash(page);
  await page.goto(BASE + hash, { waitUntil: "networkidle" });
  await page.waitForSelector(sel + " .pp-card", { timeout: 20000 });
  await page.waitForTimeout(500);
  const r = await page.evaluate(s => {
    const t = document.getElementById("props").getBoundingClientRect(), box = document.querySelector(s).getBoundingClientRect();
    return { y: t.top + scrollY - 8, bottom: box.bottom + scrollY + 8 };
  }, sel);
  const W = page.viewportSize().width;
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true, clip: { x: 0, y: r.y, width: W, height: Math.min(maxH, r.bottom - r.y) } });
  console.log(`${out}/${name}.png  ${hash}`);
  await ctx.close();
}
await shot("props-nfl-game-mobile", `#/g/nfl/${NFL_G}`, "#ppBox");
await shot("props-nba-game-mobile", `#/g/nba/${NBA_G}`, "#ppBox");
await shot("props-player-mobile", async page => {
  if (process.env.PLAYER) return `#/p/${process.env.PLAYER}`;
  const d = await (await page.request.get(BASE + "data/props/nba.json")).json();
  const rows = d.games[NBA_G].props, cnt = {};
  for (const r of rows) cnt[r[0]] = (cnt[r[0]] || 0) + 1;
  const pid = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a] || rows.find(r => r[0] === b)[2] - rows.find(r => r[0] === a)[2])[0];
  return `#/p/nba/${pid}`;
}, "#ppPlayer");
await browser.close();
console.log("js errors:", errors.length ? errors : "none");
process.exit(errors.length ? 1 : 0);
