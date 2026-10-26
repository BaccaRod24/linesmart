// FanDuel column check + screenshots (iPhone 13). Serve a site root (e.g. a mirror of the live data/):
//   python3 -m http.server 8811 -d /tmp/livesite &   then   BASE=http://localhost:8811/ TAG=before node scripts/fd_screens.mjs
// For each game: reports the Odds comparison header columns and any column whose cells are all "—" or "N/A", and writes
// screenshots/fd-<TAG>-<lg>-<id>-<state>.png. Exits 1 on JS errors, or (CHECK=1) if any all-dash book column renders.
import { chromium, devices } from "playwright";
import fs from "fs";
const BASE = process.env.BASE || "http://localhost:8811/", TAG = process.env.TAG || "after";
const GAMES = (process.env.GAMES || "nfl/401873009,nfl/401873036,ncaab/401920409,ucl/401915310,mls/761923,ufc/401931615").split(",");
const STATES = (process.env.STATES || "FL,NJ").split(",");
const out = "screenshots/"; fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const errors = [], empties = [];
for (const gk of GAMES) for (const st of STATES) {
  const [lg, id] = gk.split("/"), name = `fd-${TAG}-${lg}-${id}-${st.toLowerCase()}`;
  const ctx = await browser.newContext({ ...devices["iPhone 13"], serviceWorkers: "block" });
  await ctx.route(/cloudflareinsights|ipdata\.info|ipapi|ipwho/, r => r.abort());
  await ctx.addInitScript(s => { localStorage.setItem("ls-age-ok", new Date().toISOString()); localStorage.setItem("ls-state", s); }, st);
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(`${name}: ${e.message}`));
  await page.goto(`${BASE}#/${lg === "ufc" ? "ufc/" : "g/" + lg + "/"}${id}`.replace("#/ufc/", "#/g/ufc/"), { waitUntil: "networkidle" });
  try { await page.waitForSelector(".section-title + .cols", { timeout: 15000 }); } catch (e) { console.log(name, "no Betting lines section"); await ctx.close(); continue; }
  await page.waitForTimeout(800);
  await page.addStyleTag({ content: ".bnav{display:none!important}" });
  const info = await page.evaluate(() => {
    const card = [...document.querySelectorAll(".card")].find(c => c.querySelector("h3")?.textContent.trim() === "Odds comparison");
    if (!card) return null;
    const tbl = card.querySelector("table.books");
    const heads = tbl ? [...tbl.querySelectorAll("thead th")].map(th => th.childNodes[0]?.textContent.trim()) : [];
    const rows = tbl ? [...tbl.querySelectorAll("tbody tr")].map(tr => [...tr.children].map(td => td.textContent.trim())) : [];
    const empty = heads.map((h, i) => (i > 0 && !/Fair line/.test(h) && rows.length && rows.every(r => !r[i] || /^([—–-]|N\/A)$/.test(r[i])) ? h : null)).filter(Boolean);
    const fd = heads.indexOf("FanDuel"), fdVals = fd > 0 ? rows.map(r => r[fd]) : [];
    const y = document.querySelector(".section-title + .cols").getBoundingClientRect();
    return { heads: heads.slice(1), empty, fdVals, note: card.querySelector(".note")?.textContent.trim().slice(0, 260), top: y.top + scrollY - 40, bottom: y.bottom + scrollY + 8 };
  });
  if (!info) { console.log(name, "no Odds comparison card"); await ctx.close(); continue; }
  console.log(`${name}: cols=${JSON.stringify(info.heads)} empty=${JSON.stringify(info.empty)} FanDuel=${JSON.stringify(info.fdVals)}\n   note: ${info.note}`);
  if (info.empty.length) empties.push(`${name}: ${info.empty.join(", ")}`);
  await page.screenshot({ path: `${out}${name}.png`, fullPage: true, animations: "disabled", clip: { x: 0, y: Math.max(0, info.top), width: page.viewportSize().width, height: Math.min(2400, info.bottom - info.top) } });
  await ctx.close();
}
await browser.close();
console.log("all-dash columns:", empties.length ? empties : "none");
console.log("js errors:", errors.length ? errors : "none");
process.exit(errors.length || (process.env.CHECK === "1" && empties.length) ? 1 : 0);
