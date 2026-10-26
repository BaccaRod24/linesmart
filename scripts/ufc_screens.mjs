// UFC screenshots (iPhone 13). Serve a site whose data/ includes a UFC build (never commit live data), e.g.
//   BASE=http://localhost:8798/ node scripts/ufc_screens.mjs   (FIGHT=<boutId> FIGHTER=<athleteId> optional)
// Writes screenshots/ufc-event-mobile.png (card list), ufc-fight-mobile.png (fight page with odds), ufc-fighter-mobile.png.
import { chromium, devices } from "playwright";
import fs from "fs";
const BASE = process.env.BASE || "http://localhost:8798/";
const out = "screenshots"; fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const errors = [];
const idx = await (await fetch(BASE + "data/ufc/index.json")).json();
const ev = idx.events.find(e => e.state === "pre" && e.withOdds) || idx.events.find(e => e.state === "pre");
const byId = Object.fromEntries(idx.games.map(g => [g.id, g]));
const fightId = process.env.FIGHT || (ev.bouts.map(id => byId[id]).find(g => g.mainEvent && g.odds) || ev.bouts.map(id => byId[id]).find(g => g.odds)).id;
const fighterId = process.env.FIGHTER || byId[fightId].away.id;
async function shot(name, hash, sel, maxH = 2200) {
  const ctx = await browser.newContext(devices["iPhone 13"]);
  await ctx.addInitScript(() => { try { localStorage.setItem("ls-age-ok", new Date().toISOString()); } catch (e) {} });
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(`${name}: ${e.message}`));
  page.on("console", m => m.type() === "error" && !/favicon|Failed to load resource/.test(m.text()) && errors.push(`${name}: ${m.text()}`));
  await page.goto(BASE + hash, { waitUntil: "networkidle" });
  await page.waitForSelector(sel, { timeout: 20000 });
  await page.waitForTimeout(800);
  const H = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true, clip: { x: 0, y: 0, width: page.viewportSize().width, height: Math.min(maxH, H) } });
  console.log(`${out}/${name}.png  ${hash}`);
  await ctx.close();
}
await shot("ufc-event-mobile", "#/l/ufc", ".uf-ev .bout");
await shot("ufc-fight-mobile", `#/g/ufc/${fightId}`, ".uf-match");
await shot("ufc-fighter-mobile", `#/p/ufc/${fighterId}`, ".phero .uf-l5, .uf-l5");
await browser.close();
console.log("js errors:", errors.length ? errors : "none");
process.exit(errors.length ? 1 : 0);
