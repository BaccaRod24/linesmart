// Screenshots of the bet tracker's stats dashboard using the EXAMPLE fixture (scripts/fixtures/stats-bets.json, built by
// gen_stats_fixture.mjs). The bets go into this headless browser's localStorage only, with the "Example data" banner flag
// and NO Supabase session (ls-sb-auth is never set), and every request that isn't to the local preview server is aborted,
// so nothing can reach Supabase, ESPN or any other service.
// Usage: serve site/ (see subpath_test.mjs), then
//        BASE=http://localhost:8799/linesmart/ OUT=/path/to/screenshots node scripts/screenshots_stats.mjs
import { chromium } from "playwright";
import fs from "fs";
const BASE = process.env.BASE || "http://localhost:8799/linesmart/";
const OUT = process.env.OUT || "screenshots";
const HOST = new URL(BASE).host;
fs.mkdirSync(OUT, { recursive: true });
const demo = JSON.parse(fs.readFileSync(new URL("./fixtures/stats-bets.json", import.meta.url))).bets;
const NOW = new Date("2026-10-26T14:00:00-04:00").getTime();   // fixed clock so 7D/30D/heatmap are reproducible
const browser = await chromium.launch();
const errors = [], blocked = new Set();
async function ctx(viewport, mobile, { bets = demo, prefs = null } = {}) {
  const c = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile, serviceWorkers: "block" });
  await c.route("**/*", r => { const u = new URL(r.request().url()); if (u.host === HOST) return r.continue(); blocked.add(u.host); return r.abort(); });
  await c.addInitScript(({ d, now, prefs }) => {
    const _D = Date; const off = now - _D.now();
    // shift the clock to the fixture's "today" (keeps time moving)
    globalThis.Date = class extends _D { constructor(...a) { super(...(a.length ? a : [_D.now() + off])); } static now() { return _D.now() + off; } };
    localStorage.removeItem("ls-sb-auth");
    localStorage.setItem("ls-age-ok", "2026-10-26T00:00:00Z"); localStorage.setItem("ls-state", "NJ");
    if (!sessionStorage.getItem("seeded")) {
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("ls-bets-v1", JSON.stringify({ v: 1, bets: d }));
      if (d.length) localStorage.setItem("ls-bets-demo", "1"); else localStorage.removeItem("ls-bets-demo");
      if (prefs) localStorage.setItem("ls-bets-prefs", JSON.stringify(prefs)); else localStorage.removeItem("ls-bets-prefs");
    }
  }, { d: bets, now: NOW, prefs });
  const p = await c.newPage();
  p.on("pageerror", e => errors.push(e.message));
  p.on("console", m => m.type() === "error" && !/ERR_FAILED|net::/.test(m.text()) && errors.push(m.text()));
  return p;
}
const shot = async (p, name, opt = {}) => { const f = `${OUT}/${name}`; await p.screenshot({ path: f, ...opt }); console.log("wrote", f); };
const go = async (p, hash, sel) => { await p.goto(BASE + hash, { waitUntil: "load" }); await p.waitForSelector(sel, { timeout: 15000 }); await p.waitForTimeout(500); };
// element shots: clip a full-page capture to the element (avoids cut-offs when the element is taller than the viewport)
const el = async (p, sel, name, pad = 12) => {
  const box = await p.$eval(sel, e => { const r = e.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height }; });
  const clip = { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + pad * 2, height: box.height + pad * 2 };
  await shot(p, name, { fullPage: true, clip });
};

// ---- desktop 1440
const d = await ctx({ width: 1440, height: 900 }, false);
await go(d, "#/bets", ".bt-svg");
await shot(d, "stats-desktop-full.png", { fullPage: true });
await shot(d, "stats-desktop-top.png");
// chart tooltip
await d.$eval(".bt-chart", e => e.scrollIntoView({ block: "center" })); await d.waitForTimeout(150);
const svg = await d.$(".bt-svg"), bb = await svg.boundingBox();
await d.mouse.move(bb.x + bb.width * 0.72, bb.y + bb.height / 2); await d.waitForTimeout(200);
await shot(d, "stats-desktop-chart-tooltip.png", { clip: await d.$eval(".bt-chart", e => { const r = e.getBoundingClientRect(); return { x: r.left - 12, y: Math.max(0, r.top - 12), width: r.width + 24, height: r.height + 24 }; }) });
await d.click('[data-crange="30d"]'); await d.waitForTimeout(200);
await el(d, ".bt-chart", "stats-desktop-chart-30d.png");
await el(d, ".bt-bd-grid", "stats-desktop-breakdowns.png");
await d.click('[data-bd="book"] [data-sort="roi"]'); await d.click('[data-bd="sport"] [data-dim="league"]'); await d.waitForTimeout(150);
await el(d, ".bt-bd-grid", "stats-desktop-breakdowns-sorted.png");
await el(d, ".bt-act-card", "stats-desktop-activity.png");
// units view
await d.click('[data-units="1"]'); await d.waitForSelector("[data-unit-size]"); await d.fill("[data-unit-size]", "25"); await d.press("[data-unit-size]", "Enter"); await d.waitForTimeout(300);
await shot(d, "stats-desktop-units.png");
await d.click('[data-units="0"]'); await d.waitForTimeout(200);

// ---- mobile 390
const m = await ctx({ width: 390, height: 844 }, true);
await go(m, "#/bets", ".bt-svg");
await shot(m, "stats-mobile-full.png", { fullPage: true });
await shot(m, "stats-mobile-top.png");
await el(m, ".bt-chart", "stats-mobile-chart.png");
await el(m, '[data-bd="sport"]', "stats-mobile-breakdown-sport.png");
await el(m, '[data-bd="prop"]', "stats-mobile-breakdown-props.png");
await el(m, ".bt-act-card", "stats-mobile-activity.png");
const ow = await m.evaluate(() => document.documentElement.scrollWidth);
if (ow > 390) errors.push(`mobile page overflows horizontally: ${ow}px`);

// ---- empty states
const e = await ctx({ width: 390, height: 844 }, true, { bets: [] });
await go(e, "#/bets", ".bt-empty");
await shot(e, "stats-mobile-empty.png");
const f = await ctx({ width: 1440, height: 900 }, false);
await go(f, "#/bets", ".bt-svg");
await f.selectOption('[data-filt="book"]', "hardrock"); await f.selectOption('[data-filt="type"]', "parlay").catch(() => {});
await f.click('[data-range="7d"]'); await f.waitForTimeout(300);
await shot(f, "stats-desktop-filtered.png");

await browser.close();
console.log("blocked external hosts:", [...blocked].join(", ") || "none");
console.log("js errors:", errors.length ? errors : "none");
process.exit(errors.length ? 1 : 0);
