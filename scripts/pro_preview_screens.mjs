// Screenshots for the private Pro preview. Serves nothing; point BASE at a local site.
// Geo is stubbed to Florida and Supabase / odds hosts are aborted. No Odds API key is read.
// Usage: BASE=http://127.0.0.1:8765/ node scripts/pro_preview_screens.mjs
import { chromium } from "playwright";
import fs from "fs";

const BASE = process.env.BASE || "http://127.0.0.1:8765/";
const OUT = process.env.OUT || "/opt/cursor/artifacts";
fs.mkdirSync(OUT, { recursive: true });
const shots = [
  ["landing", "#/pro-preview"],
  ["value", "#/pro-preview/value"],
  ["alerts", "#/pro-preview/alerts"],
  ["tracker", "#/pro-preview/tracker"],
  ["books", "#/pro-preview/books"],
  ["history", "#/pro-preview/history"],
  ["refresh", "#/pro-preview/refresh"],
];
const browser = await chromium.launch();
const errors = [];
async function page(width) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    localStorage.setItem("ls-age-ok", "1");
    localStorage.setItem("ls-state", "FL");
  });
  await ctx.route(/supabase\.co|the-odds-api|ipdata\.info|espncdn|site\.web\.api\.espn|site\.api\.espn|googleapis|gstatic|cloudflareinsights/, r => r.abort());
  const p = await ctx.newPage();
  p.on("pageerror", e => errors.push(`${width}: ${e.message}`));
  return { ctx, p };
}
async function settle(p, hash) {
  await p.goto(BASE + hash, { waitUntil: "domcontentloaded" });
  await p.waitForSelector(".ppv-ready .ppv-banner", { timeout: 20000 });
  await p.waitForTimeout(400);
}
const desk = await page(1440);
const phone = await page(390);
for (const [name, hash] of shots) {
  for (const [label, { p }, w] of [["desktop", desk, 1440], ["mobile", phone, 390]]) {
    await settle(p, hash);
    const banner = await p.locator(".ppv-banner").innerText();
    if (!/Pro preview, not live/.test(banner)) errors.push(`${name} ${label}: missing banner`);
    await p.screenshot({ path: `${OUT}/pro_preview_${name}_${label}.png`, fullPage: true });
    console.log("saved", name, label);
  }
}
// Hot props: apply the NFL filter, save a named filter, then shoot both widths.
for (const [label, { p }] of [["desktop", desk], ["mobile", phone]]) {
  await settle(p, "#/pro-preview/hot?lg=nfl");
  await p.locator("#ppvHotSave input").fill("NFL props");
  await p.locator("#ppvHotSave button").click();
  await p.waitForSelector(".ppv-saved-chip", { timeout: 10000 });
  const text = await p.locator(".ppv").innerText();
  if (!/NFL props/.test(text)) errors.push(`hot ${label}: saved filter missing`);
  if (!/Pro preview, not live/.test(text)) errors.push(`hot ${label}: banner missing`);
  if (!/21\+/.test(text)) errors.push(`hot ${label}: 21+ missing`);
  if (!/Hard Rock Bet is the only legal online sportsbook/.test(text)) errors.push(`hot ${label}: Florida line missing`);
  const books = await p.locator("[data-offers] [data-book]").evaluateAll(els => els.map(e => e.dataset.book));
  if (books.some(b => b !== "hardrockbet")) errors.push(`hot ${label}: offer books ${books.join(",")}`);
  const ads = await p.locator("[data-offers] [data-ad-label]").allInnerTexts();
  if (!ads.length || ads.some(t => t !== "Ad · We may earn a commission · 21+")) errors.push(`hot ${label}: ad labels ${ads.join("|")}`);
  await p.screenshot({ path: `${OUT}/pro_preview_hot_${label}.png`, fullPage: true });
  console.log("saved hot", label);
}
await desk.ctx.close();
await phone.ctx.close();
await browser.close();
console.log(errors.length ? "ERRORS\n" + errors.join("\n") : "errors: none");
process.exit(errors.length ? 1 : 0);
