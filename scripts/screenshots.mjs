// Usage: (serve site on :8765) node scripts/screenshots.mjs
import { chromium } from "playwright";
import fs from "fs";
const BASE = process.env.BASE || "http://localhost:8765/";
const out = "screenshots"; fs.mkdirSync(out, { recursive: true });
const pick = (lg, needDraw) => {
  const d = JSON.parse(fs.readFileSync(`site/data/${lg}/index.json`));
  const g = d.games.find(g => g.state === "pre" && g.odds && (!needDraw || g.odds.drawML != null)) || d.games[0];
  return g && g.id;
};
const shots = [
  ["home-desktop", "#/l/nfl", 1440, 900, false],
  ["home-desktop-full", "#/l/nfl", 1440, 900, true],
  ["game-detail-desktop", `#/g/nfl/${pick("nfl")}`, 1440, 900, true],
  ["game-detail-soccer-desktop", `#/g/epl/${pick("epl", true)}`, 1440, 900, true],
  ["league-ncaaf-desktop", "#/l/ncaaf", 1440, 900, false],
  ["league-nba-desktop", "#/l/nba", 1440, 900, false],
  ["league-mlb-desktop", "#/l/mlb", 1440, 900, false],
  ["league-ucl-desktop", "#/l/ucl", 1440, 900, false],
  ["home-mobile", "#/l/nfl", 390, 844, false],
  ["game-detail-mobile", `#/g/nfl/${pick("nfl")}`, 390, 844, true],
];
const browser = await chromium.launch();
const errors = [];
for (const [name, hash, w, h, full] of shots) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: w < 500 ? 2 : 1 });
  page.on("pageerror", e => errors.push(`${name}: ${e.message}`));
  page.on("console", m => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
  await page.goto(BASE + hash, { waitUntil: "networkidle" });
  await page.waitForSelector(".game, .match, .empty", { timeout: 15000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: full });
  console.log("saved", name, hash);
  await page.close();
}
await browser.close();
console.log("errors:", errors.length ? errors : "none");
