// Advanced-stats screenshots (iPhone 13). Serve a site whose data/ was built with adv stats (never commit live data), e.g.
//   BASE=http://localhost:8799/ NFL_G=401873009 NBA_G=401909875 node scripts/adv_screens.mjs
// Writes screenshots/adv-*.png. Team/player pages also call ESPN live, like the real site.
import { chromium, devices } from "playwright";
import fs from "fs";
const BASE = process.env.BASE || "http://localhost:8799/";
const NFL_G = process.env.NFL_G || "401873009", NBA_G = process.env.NBA_G || "401909875";
const TEAM = process.env.TEAM || "nfl/21", PLAYER = process.env.PLAYER || "nfl/4426515";
const out = "screenshots"; fs.mkdirSync(out, { recursive: true });
const phone = devices["iPhone 13"];
const browser = await chromium.launch();
const errors = [];
// clip from the section title before `sel` (or `sel` itself) down to the bottom of `sel` (or `endSel`)
async function shot(name, hash, sel, { wait, state, maxH = 1700, endSel, act, titleBefore = true } = {}) {
  const ctx = await browser.newContext(phone);
  await ctx.addInitScript(st => { try { localStorage.setItem("ls-age-ok", new Date().toISOString()); if (st) localStorage.setItem("ls-state", st); } catch (e) {} }, state || "");
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(`${name}: ${e.message}`));
  page.on("console", m => m.type() === "error" && !/favicon|Failed to load resource/.test(m.text()) && errors.push(`${name}: ${m.text()}`));
  await page.goto(BASE + hash, { waitUntil: "networkidle" });
  await page.waitForSelector(wait || sel, { timeout: 25000 });
  if (act) await act(page);
  // the game/team views re-render once live data and geo settle; wait for the slot to be filled again before measuring
  await page.waitForTimeout(2500);
  await page.waitForSelector(wait || sel, { timeout: 25000 });
  await page.waitForTimeout(400);
  const r = await page.evaluate(([s, e, tb]) => {
    const el = document.querySelector(s); let top = el;
    if (tb) { const p = el.previousElementSibling; if (p && p.classList.contains("section-title")) top = p; }
    const end = e ? document.querySelector(e) : el;
    return { y: Math.max(0, top.getBoundingClientRect().top + scrollY - 8), bottom: end.getBoundingClientRect().bottom + scrollY + 8 };
  }, [sel, endSel || null, titleBefore]);
  const W = page.viewportSize().width;
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true, clip: { x: 0, y: r.y, width: W, height: Math.min(maxH, r.bottom - r.y) } });
  console.log(`${out}/${name}.png  ${hash}${state ? "  state=" + state : ""}`);
  await ctx.close();
}
await shot("adv-nfl-game", `#/g/nfl/${NFL_G}`, "#advGame", { wait: "#advGame .cmp", maxH: 2200 });
await shot("adv-nba-game", `#/g/nba/${NBA_G}`, "#advGame", { wait: "#advGame .av-proj", maxH: 2000 });
await shot("adv-team", `#/t/${TEAM}`, "#advTeam", { wait: "#advTeam .stat", maxH: 2000 });
await shot("adv-player", `#/p/${PLAYER}`, "#advPlayer", { wait: "#advPlayer .av-tbl" });
await shot("adv-odds", `#/g/nba/${NBA_G}`, ".cols .card:has(table.lv-on)", { wait: "table.books.lv-on", titleBefore: false });
await shot("adv-odds-fl", `#/g/nba/${NBA_G}`, ".cols .card:has(table.lv-on)", { wait: "table.books.lv-on", state: "FL", titleBefore: false });
await shot("adv-slate", `#/`, ".vspots", { titleBefore: false });
await shot("adv-slate-fl", `#/`, ".vspots", { state: "FL", titleBefore: false });
await shot("adv-props-usage", `#/g/nfl/${NFL_G}`, "#ppBox .pp-card:has(.av-chips)", { wait: "#ppBox .av-chips", titleBefore: false, maxH: 900 });
await browser.close();
console.log("js errors:", errors.length ? errors : "none");
process.exit(errors.length ? 1 : 0);
