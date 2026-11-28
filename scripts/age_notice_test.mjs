// The static 21+ notice paints before deferred site.js. This proves the inline binder
// dismisses it on the first tap while site.js is still blocked, including the throttled
// phone case (390px, touch, 300ms latency, ~200KB/s, 6x CPU), and that a refresh after
// accepting stays hidden while a fresh profile still shows it.
// Usage: env -u ODDS_API_KEY node scripts/age_notice_test.mjs
import { chromium, webkit, devices } from "playwright";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";

delete process.env.ODDS_API_KEY;

const ART = process.env.ARTIFACTS || "/opt/cursor/artifacts/age-notice";
fs.mkdirSync(ART, { recursive: true });
const extra = fs.mkdtempSync(path.join(os.tmpdir(), "age-pages-"));
execFileSync("python3", ["-c", `
import os, sys
from pathlib import Path
os.environ.pop("ODDS_API_KEY", None)
sys.path.insert(0, "scripts")
import seo_pages as SP
sh = SP.Shell(Path("site/index.html").read_text(), SP.BASE_URL)
out = Path(${JSON.stringify(extra)})
pages = {
  "nfl/index.html": sh.page("nfl/", "NFL Odds", "NFL odds.", "<p>Hub</p>", kind="hub", lg="nfl"),
  "nfl/games/example/index.html": sh.page("nfl/games/example/", "Example Game", "Example game.", "<p>Game</p>", kind="game", lg="nfl"),
  "nfl/props/example/index.html": sh.page("nfl/props/example/", "Example Prop", "Example prop.", "<p>Prop</p>", kind="prop", lg="nfl"),
}
for rel, html in pages.items():
    p = out / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(html)
`], { env: { ...process.env, ODDS_API_KEY: "" } });
if (process.env.ODDS_API_KEY) delete process.env.ODDS_API_KEY;

const ROOT = path.resolve("site");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2", ".ico": "image/x-icon" };
const safe = (root, rel) => {
  const abs = path.resolve(root, rel);
  return (abs === root || abs.startsWith(root + path.sep)) && fs.existsSync(abs) && fs.statSync(abs).isFile() ? abs : null;
};
const srv = http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "");
  if (!rel || rel.endsWith("/")) rel = path.join(rel, "index.html");
  const file = safe(extra, rel) || safe(ROOT, rel);
  if (!file) { res.writeHead(404); return res.end("missing"); }
  res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
  res.end(fs.readFileSync(file));
}).listen(0);
const BASE = `http://127.0.0.1:${srv.address().port}/`;
const FLAG = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const PAGES = [["home", ""], ["league hub", "nfl/"], ["game", "nfl/games/example/"], ["props", "nfl/props/example/"]];
let fail = 0, pass = 0;
const check = (ok, msg) => { ok ? pass++ : (fail++, console.log("FAIL " + msg)); console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); };

const probe = page => page.evaluate(() => {
  const n = document.getElementById("ageNotice");
  const btn = document.getElementById("ageOk");
  let flag = null;
  try { flag = localStorage.getItem("ls-age-ok"); } catch (e) {}
  const cs = n ? getComputedStyle(n) : null;
  const r = n ? n.getBoundingClientRect() : null;
  const visible = !!(n && cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0);
  let top = null;
  if (btn) {
    const b = btn.getBoundingClientRect();
    const el = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
    top = el && (el.id || el.tagName);
  }
  return {
    ready: document.readyState, visible,
    notices: document.querySelectorAll("#ageNotice").length,
    oks: document.querySelectorAll("#ageOk").length,
    wired: n ? (n.dataset.wired || "") : "",
    lsAge: btn ? (btn.dataset.lsAge || "") : "",
    flag, htmlClass: document.documentElement.className,
    overflow: getComputedStyle(document.documentElement).overflow,
    siteJs: !!(window.LineSmart && window.LineSmart.showAgeNotice),
    top, text: n ? n.innerText.replace(/\s+/g, " ") : "",
  };
});

const blockNoise = page => page.route(/ipdata\.info|cloudflareinsights|espncdn|espn\.com|googleapis|gstatic|supabase/, r => r.abort());
const blockSiteJs = page => page.route(url => /\/assets\/site\.js(\?|$)/.test(url), r => r.abort());

async function tapOk(page, touch) {
  const loc = page.locator("#ageOk");
  await loc.waitFor({ state: "visible", timeout: 25000 });
  if (!touch) { await loc.click(); return; }
  const box = await loc.boundingBox();
  if (!box) throw new Error("age button has no box");
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

function dismissedOk(s, label) {
  check(!!s.flag && FLAG.test(s.flag), `${label}: first tap set ls-age-ok to an ISO timestamp (${s.flag})`);
  check(!s.visible && s.notices === 0, `${label}: notice removed on that tap (visible=${s.visible} copies=${s.notices})`);
  check(!/\bage-open\b/.test(s.htmlClass) && !/\bage-locked\b/.test(s.htmlClass) && /\bage-dismissed\b/.test(s.htmlClass), `${label}: age-open/locked cleared (${s.htmlClass})`);
  check(s.overflow !== "hidden", `${label}: scroll restored (overflow=${s.overflow})`);
}

const iphone = devices["iPhone 13"];
check(iphone.viewport.width === 390 && iphone.hasTouch === true, `iPhone 13 descriptor is 390 wide with touch (${iphone.viewport.width})`);

const chrome = await chromium.launch();
const kit = await webkit.launch();
try {
  // Fresh storage shows the notice. site.js is blocked, so only the inline binder can dismiss it.
  for (const [browser, name, opts, touch] of [
    [chrome, "chromium 390", { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, true],
    [chrome, "chromium 1280", { viewport: { width: 1280, height: 800 }, hasTouch: false }, false],
    [kit, "webkit iPhone 13", iphone, true],
  ]) {
    for (const [label, rel] of PAGES) {
      const ctx = await browser.newContext(opts);
      const page = await ctx.newPage();
      await blockNoise(page);
      await blockSiteJs(page);
      const errors = [];
      page.on("pageerror", e => errors.push(String(e)));
      await page.goto(BASE + rel, { waitUntil: "commit" });
      await page.locator("#ageOk").waitFor({ state: "visible", timeout: 25000 });
      const before = await probe(page);
      check(before.visible && before.notices === 1 && before.oks === 1 && before.flag == null && before.siteJs === false && before.lsAge === "1",
        `${name} ${label}: fresh storage shows one notice before site.js (ready=${before.ready} top=${before.top} siteJs=${before.siteJs})`);
      if (label === "home" && name !== "webkit iPhone 13") {
        await page.screenshot({ path: path.join(ART, `after-fresh-${name.includes("1280") ? "1280" : "390"}.png`) });
      }
      if (label === "home" && name === "webkit iPhone 13") {
        await page.screenshot({ path: path.join(ART, "after-fresh-webkit-390.png") });
      }
      check(before.text.includes("I'm 21 or older") && before.text.includes("1-800-GAMBLER") && before.text.includes("1-833-PLAYWISE"),
        `${name} ${label}: notice wording and helplines unchanged`);
      await tapOk(page, touch);
      const after = await probe(page);
      dismissedOk(after, `${name} ${label} before site.js`);
      check(!errors.some(e => /ageOk|ageNotice|ls-age|__lsAge/.test(e)), `${name} ${label}: no age-notice page errors (${errors.filter(e => /ageOk|ageNotice|ls-age/.test(e)).join(" | ") || "none"})`);
      if (label === "home" && name === "chromium 390") await page.screenshot({ path: path.join(ART, "after-tap-390.png") });
      if (label === "home" && name === "chromium 1280") await page.screenshot({ path: path.join(ART, "after-tap-1280.png") });
      await ctx.close();
    }
  }

  // Click is swallowed (the throttled first-tap symptom). touchend/pointerup still dismisses. site.js never loads.
  {
    const ctx = await chrome.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await blockNoise(page);
    await blockSiteJs(page);
    await page.goto(BASE, { waitUntil: "commit" });
    await page.locator("#ageOk").waitFor({ state: "visible" });
    await page.evaluate(() => {
      document.getElementById("ageOk").addEventListener("click", e => { e.preventDefault(); e.stopImmediatePropagation(); }, true);
    });
    await tapOk(page, true);
    const s = await probe(page);
    dismissedOk(s, "chromium 390 click swallowed");
    await ctx.close();
  }

  // Throttled early tap: same CDP shape as the live failure. site.js is held so the tap lands
  // while the notice is already visible and deferred init has not run. One tap must be enough.
  {
    const ctx = await chrome.newContext({
      viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
      recordVideo: { dir: ART, size: { width: 390, height: 844 } },
    });
    const page = await ctx.newPage();
    await ctx.tracing.start({ screenshots: true, snapshots: true });
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false, latency: 300, downloadThroughput: 200 * 1024, uploadThroughput: 200 * 1024,
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
    await blockNoise(page);
    let release;
    const gate = new Promise(r => { release = r; });
    await page.route(url => /\/assets\/site\.js(\?|$)/.test(url), async route => { await gate; await route.continue(); });
    const errors = [];
    page.on("pageerror", e => errors.push(String(e)));
    await page.goto(BASE, { waitUntil: "commit" });
    await page.locator("#ageOk").waitFor({ state: "visible", timeout: 30000 });
    const before = await probe(page);
    await page.screenshot({ path: path.join(ART, "throttle-before-tap-390.png") });
    check(before.visible && before.siteJs === false && before.ready !== "complete" && before.notices === 1,
      `throttle: notice visible before site.js (ready=${before.ready} siteJs=${before.siteJs} top=${before.top})`);
    await tapOk(page, true);
    const tapped = await probe(page);
    dismissedOk(tapped, "throttle early tap");
    check(tapped.siteJs === false, "throttle: dismissed before site.js ran");
    release();
    await page.waitForLoadState("load", { timeout: 45000 });
    const loaded = await probe(page);
    check(!loaded.visible && loaded.notices === 0 && FLAG.test(loaded.flag || "") && loaded.siteJs === true,
      `throttle: after load the notice stays gone and site.js did not inject another (copies=${loaded.notices} siteJs=${loaded.siteJs})`);
    check(!errors.some(e => /ageOk|ageNotice|ls-age/.test(e)), `throttle: no age-notice page errors (${errors.join(" | ") || "none"})`);
    await page.screenshot({ path: path.join(ART, "throttle-after-load-390.png") });
    await ctx.tracing.stop({ path: path.join(ART, "throttle-early-tap.zip") });
    const video = page.video();
    await ctx.close();
    if (video) {
      const src = await video.path();
      fs.copyFileSync(src, path.join(ART, "throttle-early-tap.webm"));
    }
  }

  // Accept, then refresh with site.js still blocked: the head check hides it. A new profile shows it.
  {
    const ctx = await chrome.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await blockNoise(page);
    await blockSiteJs(page);
    await page.goto(BASE, { waitUntil: "commit" });
    await tapOk(page, true);
    await page.reload({ waitUntil: "commit" });
    await page.waitForSelector("#ageNotice", { state: "attached", timeout: 15000 });
    const again = await probe(page);
    check(!again.visible && FLAG.test(again.flag || "") && again.siteJs === false,
      `refresh after accept hides the notice before site.js (visible=${again.visible} ready=${again.ready})`);
    await page.screenshot({ path: path.join(ART, "after-refresh-390.png") });
    await ctx.close();
    const fresh = await chrome.newContext({ viewport: { width: 1280, height: 800 } });
    const p2 = await fresh.newPage();
    await blockNoise(p2);
    await blockSiteJs(p2);
    await p2.goto(BASE, { waitUntil: "commit" });
    await p2.locator("#ageOk").waitFor({ state: "visible", timeout: 15000 });
    const shown = await probe(p2);
    check(shown.visible && shown.flag == null, "fresh storage on 1280 still shows the notice");
    await fresh.close();
  }

  // site.js still dismisses on a normal click and does not bind a second button.
  {
    const ctx = await chrome.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await blockNoise(page);
    await page.goto(BASE, { waitUntil: "load" });
    await page.locator("#ageOk").waitFor({ state: "visible" });
    const before = await probe(page);
    check(before.notices === 1 && before.oks === 1 && before.siteJs === true && before.wired === "1" && before.lsAge === "1",
      `with site.js: one notice, inline flag kept, wired once (copies=${before.notices} wired=${before.wired})`);
    await page.locator("#ageOk").click();
    const after = await probe(page);
    dismissedOk(after, "chromium click after site.js");
    const inert = await page.evaluate(() => document.querySelectorAll("[inert]").length);
    check(inert === 0, `inert cleared after dismiss (${inert})`);
    await ctx.close();
  }
} finally {
  await chrome.close();
  await kit.close();
  srv.close();
}
console.log(`${fail ? "FAIL" : "PASS"} age notice: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
