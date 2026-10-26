// Matchup screenshots. Serve a site whose data/ has matchups built (never commit live data), e.g.
//   mkdir -p /tmp/srv/linesmart && (link site/* there, data -> your DATA_OUT) && python3 -m http.server 8811 -d /tmp/srv
//   BASE=http://localhost:8811/linesmart/ NFL_P=4241389 NBA_P=4594268 GAME=nfl/401873009 node scripts/matchup_screens.mjs
import { chromium } from "playwright";
import fs from "fs";
const BASE = process.env.BASE || "http://localhost:8811/linesmart/";
const out = "screenshots"; fs.mkdirSync(out, { recursive: true });
const NFL_P = process.env.NFL_P || "4241389", NBA_P = process.env.NBA_P || "4594268", GAME = process.env.GAME || "nfl/401873009";
const shots = [
  ["matchup-nfl-player-mobile", `#/p/nfl/${NFL_P}/m`, 390, 844, "player"],
  ["matchup-nba-player-mobile", `#/p/nba/${NBA_P}/m`, 390, 844, "player"],
  ["matchup-game-mobile", `#/g/${GAME}`, 390, 844, "game"],
  ["matchup-nfl-player-desktop", `#/p/nfl/${NFL_P}/m`, 1280, 800, "player"],
];
const browser = await chromium.launch();
const errors = [];
for (const [name, hash, w, h, kind] of shots) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: w < 500 ? 2 : 1 });
  page.on("pageerror", e => errors.push(`${name}: ${e.message}`));
  page.on("console", m => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
  await page.goto(BASE + hash, { waitUntil: "networkidle" });
  if (kind === "player") {
    await page.waitForSelector("#muBox .mu-next", { timeout: 20000 });
    await page.waitForTimeout(800); await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(200);
    const r = await page.evaluate(() => { const a = document.querySelector(".phero").getBoundingClientRect(), b = document.getElementById("muBox").getBoundingClientRect(); return { y: a.top + scrollY - 8, h: b.bottom - a.top + 16 }; });
    await page.screenshot({ path: `${out}/${name}.png`, fullPage: true, clip: { x: 0, y: Math.max(0, r.y), width: w, height: r.h } });
  } else {
    await page.waitForSelector("#keyMu .mu-km", { timeout: 20000 });
    await page.waitForTimeout(600); await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(200);
    const r = await page.evaluate(() => { const k = document.getElementById("keyMu").getBoundingClientRect(), m = document.querySelector(".match").getBoundingClientRect(); return { y: k.top + scrollY - 12, h: k.height + 24, my: m.top + scrollY, mh: m.height }; });
    await page.screenshot({ path: `${out}/${name}.png`, fullPage: true, clip: { x: 0, y: r.y, width: w, height: r.h } });
  }
  console.log("saved", name, hash);
  await page.close();
}
await browser.close();
console.log("errors:", errors.length ? errors : "none");
