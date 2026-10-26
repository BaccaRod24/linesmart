// Visual polish before/after screenshots. Serve a site whose data/ has NFL props + UFC (never commit live data):
//   PREFIX=polish-after BASE=http://localhost:8798/ node scripts/polish_screens.mjs   (GAME=<nflGameId> PLAYER=<athleteId> optional)
// Writes screenshots/<PREFIX>-{home,home-mobile-fold(viewport only),nfl-game,ufc-event,player}-mobile.png (iPhone 13) and <PREFIX>-home-desktop.png (1440 wide).
import { chromium, devices } from "playwright";
import fs from "fs";
const BASE = process.env.BASE || "http://localhost:8798/";
const PREFIX = process.env.PREFIX || "polish-after";
const out = new URL("../screenshots/", import.meta.url).pathname; fs.mkdirSync(out, { recursive: true });
const props = await (await fetch(BASE + "data/props/nfl.json")).json();
const gid = process.env.GAME || Object.entries(props.games).sort((a, b) => b[1].props.length - a[1].props.length)[0][0];
const pid = process.env.PLAYER || props.games[gid].props[0][0];
const browser = await chromium.launch();
const errors = [];
async function shot(name, hash, sel, ctxOpts, maxH = 2200, fold = false) {
  const ctx = await browser.newContext(ctxOpts);
  await ctx.addInitScript(() => { try { localStorage.setItem("ls-age-ok", new Date().toISOString()); } catch (e) {} });
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(`${name}: ${e.message}`));
  page.on("console", m => m.type() === "error" && !/favicon/.test(m.text()) && errors.push(`${name}: ${m.text()}`));
  await page.goto(BASE + hash, { waitUntil: "networkidle" });
  await page.waitForSelector(sel, { timeout: 25000 });
  await page.waitForTimeout(1200);
  const H = await page.evaluate(() => document.documentElement.scrollHeight);
  if (fold) await page.screenshot({ path: `${out}${name}.png`, animations: "disabled" });  // viewport only: shows fixed header + bottom nav as on the phone
  else { await page.addStyleTag({ content: ".bnav{display:none!important}" });  // fixed nav would float mid-image in a full-page capture; see -fold
    await page.screenshot({ path: `${out}${name}.png`, fullPage: true, animations: "disabled", clip: { x: 0, y: 0, width: page.viewportSize().width, height: Math.min(maxH, H) } }); }
  console.log(`screenshots/${name}.png  ${hash}`);
  await ctx.close();
}
const phone = devices["iPhone 13"], desk = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
await shot(`${PREFIX}-home-mobile`, "", ".game", phone);
await shot(`${PREFIX}-home-mobile-fold`, "", ".game", phone, 0, true);
await shot(`${PREFIX}-nfl-game-mobile`, `#/g/nfl/${gid}`, "#ppBox .pp-card", phone, 3200);
await shot(`${PREFIX}-ufc-event-mobile`, "#/l/ufc", ".uf-ev .bout", phone);
await shot(`${PREFIX}-player-mobile`, `#/p/nfl/${pid}`, "#ppPlayer", phone);
await shot(`${PREFIX}-home-desktop`, "", ".game", desk, 1800);
await browser.close();
console.log("js errors:", errors.length ? errors : "none");
process.exit(errors.length ? 1 : 0);
