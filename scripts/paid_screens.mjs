// Paid Odds API (Hard Rock + FanDuel) screenshots, iPhone 13, from FIXTURE data (scripts/odds_fixture_build.py; never live data).
// Serve the site with that data/:  python3 -m http.server 8797 -d /tmp/paidroot &   then
//   BASE=http://localhost:8797/ G=401909868 node scripts/paid_screens.mjs
// Writes screenshots/paid-odds-nj.png, paid-odds-fl.png (same game, state override ls-state), paid-props.png (+ paid-props-fl.png).
import { chromium, devices } from "playwright";
import fs from "fs";
const BASE = process.env.BASE || "http://localhost:8797/", G = process.env.G || "401909868", LG = process.env.LG || "nba";
const out = "screenshots/"; fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const errors = [];
async function shot(name, hash, state, from, to, maxH = 2400) {
  const ctx = await browser.newContext({ ...devices["iPhone 13"], serviceWorkers: "block" });
  await ctx.route(/cloudflareinsights|ipdata\.info/, r => r.abort());
  await ctx.addInitScript(st => { localStorage.setItem("ls-age-ok", new Date().toISOString()); if (st) localStorage.setItem("ls-state", st); }, state);
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(`${name}: ${e.message}`));
  page.on("console", m => m.type() === "error" && !/favicon|Failed to load resource/.test(m.text()) && errors.push(`${name}: ${m.text()}`));
  await page.goto(BASE + hash, { waitUntil: "networkidle" });
  await page.waitForSelector(to, { timeout: 20000 });
  await page.waitForTimeout(1000);
  await page.addStyleTag({ content: ".bnav{display:none!important}" });
  const r = await page.evaluate(([f, t]) => {
    const a = typeof f === "string" ? [...document.querySelectorAll(".section-title")].find(e => e.textContent.trim().startsWith(f)) || document.querySelector(f) : null;
    const b = document.querySelector(t);
    return { y: Math.max(0, a.getBoundingClientRect().top + scrollY - 8), bottom: b.getBoundingClientRect().bottom + scrollY + 8 };
  }, [from, to]);
  await page.screenshot({ path: `${out}${name}.png`, fullPage: true, animations: "disabled", clip: { x: 0, y: r.y, width: page.viewportSize().width, height: Math.min(maxH, r.bottom - r.y) } });
  console.log(`${out}${name}.png  #/g/${LG}/${G}  state ${state}`);
  await ctx.close();
}
await shot("paid-odds-nj", `#/g/${LG}/${G}`, "NJ", "Betting lines", ".section-title + .cols");
await shot("paid-odds-fl", `#/g/${LG}/${G}`, "FL", "Betting lines", ".section-title + .cols");
await shot("paid-props", `#/g/${LG}/${G}`, "NJ", "#props", "#ppBox .pp-card", 1250);
await shot("paid-props-fl", `#/g/${LG}/${G}`, "FL", "#props", "#ppBox .pp-card", 1250);
await browser.close();
console.log("js errors:", errors.length ? errors : "none");
process.exit(errors.length ? 1 : 0);
