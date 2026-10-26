// Game-day weather screenshots. Serve a site whose data/ was built with weather (never commit live data), e.g.
//   cp -r site /tmp/ghroot && cp -r $DATA_OUT /tmp/ghroot/data && python3 -m http.server 8798 -d /tmp/ghroot
//   BASE=http://localhost:8798/ NFL_G=401873028 WATCH_G=ncaaf/401862816 node scripts/weather_screens.mjs
import { chromium, devices } from "playwright";
import fs from "fs";
const BASE = process.env.BASE || "http://localhost:8798/";
const NFL_G = process.env.NFL_G || "401873028", WATCH_G = process.env.WATCH_G || "ncaaf/401862816";
const out = "screenshots"; fs.mkdirSync(out, { recursive: true });
const phone = devices["iPhone 13"];
// [name, hash, viewport ctx, mode]  mode: "list" = top of the league page, "wx" = game header + weather section
const shots = [
  ["weather-nfl-day-mobile", "#/l/nfl", phone, "list"],
  ["weather-nfl-game-mobile", `#/g/nfl/${NFL_G}`, phone, "wx"],
  ["weather-watch-game-mobile", `#/g/${WATCH_G}`, phone, "wx"],
  ["weather-watch-day-mobile", `#/l/${WATCH_G.split("/")[0]}`, phone, "watchlist"],
  ["weather-nba-indoor-mobile", "#/l/nba", phone, "list"],
  ["weather-nba-indoor-game-mobile", "#/g/nba/", phone, "wx-first-nba"],
  ["weather-desktop", `#/g/nfl/${NFL_G}`, { viewport: { width: 1280, height: 900 } }, "wx"],
];
const browser = await chromium.launch();
const errors = [];
for (const [name, hash0, ctxOpts, mode] of shots) {
  const ctx = await browser.newContext(ctxOpts);
  await ctx.addInitScript(() => { try { localStorage.setItem("ls-age-ok", new Date().toISOString()); } catch (e) {} });
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(`${name}: ${e.message}`));
  page.on("console", m => m.type() === "error" && !/favicon|Failed to load resource/.test(m.text()) && errors.push(`${name}: ${m.text()}`));
  let hash = hash0;
  if (mode === "wx-first-nba") {
    const idx = await (await page.request.get(BASE + "data/nba/index.json")).json();
    hash += idx.games.find(g => g.state === "pre").id;
  }
  await page.goto(BASE + hash, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  const W = page.viewportSize().width;
  if (mode === "list" || mode === "watchlist") {
    await page.waitForSelector(".game .wx", { timeout: 20000 });
    if (process.env.SCROLL_DAY && mode === "list" && hash.includes("/nfl")) await page.evaluate(d => { const h = [...document.querySelectorAll("h2,h3,.day,.day-head,div")].find(e => e.children.length < 4 && new RegExp(d).test(e.textContent) && e.getBoundingClientRect().height < 60); if (h) scrollTo(0, h.getBoundingClientRect().top + scrollY - 70); }, process.env.SCROLL_DAY);
    if (mode === "watchlist") await page.evaluate(() => { const t = document.querySelector(".game:has(.wx.watch)"); if (t) t.scrollIntoView({ block: "center" }); });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/${name}.png` });
  } else {
    await page.waitForSelector(".wx-card", { timeout: 20000 });
    const r = await page.evaluate(() => {
      const m = document.querySelector(".match").getBoundingClientRect(), c = document.querySelector(".wx-card").getBoundingClientRect();
      const t = c.top - 50;   // include the section title
      return { my: m.top + scrollY, mh: m.height, ty: t + scrollY, bottom: c.bottom + scrollY };
    });
    // header, then jump to the weather section (lines/move sections in between are skipped via two clips stitched by viewport)
    await page.screenshot({ path: `${out}/${name}.png`, fullPage: true, clip: { x: 0, y: Math.max(0, r.ty), width: W, height: r.bottom - r.ty + 12 } });
    await page.screenshot({ path: `${out}/${name.replace(/-(mobile|desktop)$/, "-header-$1")}.png`, fullPage: true, clip: { x: 0, y: Math.max(0, r.my - 8), width: W, height: r.mh + 16 } });
  }
  console.log("saved", name, hash);
  await ctx.close();
}
await browser.close();
console.log("errors:", errors.length ? errors : "none");
