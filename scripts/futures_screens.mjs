// Futures tab screenshots. Fixture prices are the Nov 28 discovery top 5 (not a full board).
// Serves must already be up:
//   BEFORE=http://127.0.0.1:8791/  (hub before the Futures segment)
//   AFTER=http://127.0.0.1:8792/   (this branch, with site/data/futures fixture files)
//   env -u ODDS_API_KEY node scripts/futures_screens.mjs
import { chromium } from "playwright";
import fs from "fs";

const BEFORE = process.env.BEFORE || "http://127.0.0.1:8791/";
const AFTER = process.env.AFTER || "http://127.0.0.1:8792/";
const out = process.env.OUT || "/opt/cursor/artifacts/futures";
fs.mkdirSync(out, { recursive: true });

const shots = [
  { name: "before-nfl-390", base: BEFORE, hash: "#/l/nfl", w: 390, h: 844, state: "NJ", wait: ".page-head h1", full: false },
  { name: "before-nfl-1280", base: BEFORE, hash: "#/l/nfl", w: 1280, h: 800, state: "NJ", wait: ".page-head h1", full: false },
  { name: "after-nfl-fl-390", base: AFTER, hash: "#/l/nfl/futures", w: 390, h: 1200, state: "FL", wait: ".fu-fl", full: true },
  { name: "after-nfl-fl-1280", base: AFTER, hash: "#/l/nfl/futures", w: 1280, h: 900, state: "FL", wait: ".fu-fl", full: true },
  { name: "after-nfl-nj-390", base: AFTER, hash: "#/l/nfl/futures", w: 390, h: 1200, state: "NJ", wait: ".fu-tbl", full: true },
  { name: "after-nfl-nj-1280", base: AFTER, hash: "#/l/nfl/futures", w: 1280, h: 900, state: "NJ", wait: ".fu-tbl", full: true },
  { name: "after-mls-empty-390", base: AFTER, hash: "#/l/mls/futures", w: 390, h: 844, state: "NJ", wait: ".empty", full: true },
  { name: "after-golf-nj-1280", base: AFTER, hash: "#/l/golf/futures", w: 1280, h: 900, state: "NJ", wait: ".fu-tbl", full: true },
];

const browser = await chromium.launch();
const errors = [];
for (const s of shots) {
  const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, serviceWorkers: "block", deviceScaleFactor: 1 });
  await ctx.route(/cloudflareinsights|ipdata\.info|the-odds-api\.com/, r => r.abort());
  await ctx.addInitScript(st => { localStorage.setItem("ls-age-ok", new Date().toISOString()); localStorage.setItem("ls-state", st); }, s.state);
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(`${s.name}: ${e.message}`));
  await page.goto(s.base + s.hash, { waitUntil: "networkidle" });
  await page.waitForSelector(s.wait, { timeout: 20000 });
  await page.waitForTimeout(400);
  const text = await page.locator("#app").innerText();
  if (s.name.startsWith("before") && /\bFutures\b/.test(text)) errors.push(`${s.name}: Futures segment is already on the before page`);
  if (s.name.startsWith("after-nfl") && !text.includes("Futures")) errors.push(`${s.name}: Futures segment missing`);
  if (s.name.includes("-fl-") && !text.includes("only legal online sportsbook in Florida")) errors.push(`${s.name}: Florida note missing`);
  if (s.name.includes("-nj-") && text.includes("only legal online sportsbook in Florida")) errors.push(`${s.name}: Florida note shown to a non-FL visitor`);
  if (s.name.startsWith("after-nfl") && !text.includes("San Francisco 49ers")) errors.push(`${s.name}: discovery prices missing`);
  if (s.name.includes("mls") && !text.includes("No futures odds available for this league")) errors.push(`${s.name}: empty state missing`);
  const nav = await page.locator("#bnav [data-nav]").count();
  if (s.w < 800 && nav !== 8) errors.push(`${s.name}: bottom nav has ${nav} items`);
  await page.screenshot({ path: `${out}/${s.name}.png`, fullPage: s.full, animations: "disabled" });
  console.log(`${out}/${s.name}.png`);
  await ctx.close();
}
await browser.close();
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("screenshots ok");
