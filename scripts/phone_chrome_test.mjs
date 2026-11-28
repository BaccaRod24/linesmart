// Phone header and bottom nav stay usable at 360–390px: all eight tabs, 11px labels fully
// inside the bar, a shorter sticky header, and the league chips hide on scroll down / return
// on scroll up. Desktop header height stays the previous 60px row + 50px chip row.
// Serves site/ locally. Never calls the Odds API.
// Usage: env -u ODDS_API_KEY node scripts/phone_chrome_test.mjs
import { chromium } from "playwright";
import fs from "fs";
import http from "http";
import path from "path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const site = path.join(root, "site");
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"} phone-chrome: ${msg}`); if (!ok) fails.push(msg); };
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.normalize(path.join(site, rel));
  if (!file.startsWith(site) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end("no"); }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const chrome = process.env.CHROME_PATH || (fs.existsSync("/usr/local/bin/google-chrome") ? "/usr/local/bin/google-chrome" : "");
const browser = await chromium.launch({ headless: true, executablePath: chrome || undefined, args: ["--no-sandbox", "--disable-dev-shm-usage"] });

const TABS = ["home", "props", "stats", "live", "search", "bets", "value", "account"];

async function open(w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.addInitScript(() => localStorage.setItem("ls-age-ok", "2026-01-01T00:00:00.000Z"));
  const odds = [];
  page.on("request", req => { if (/the-odds-api|api\.odds/i.test(req.url())) odds.push(req.url()); });
  await page.route(/the-odds-api|api\.odds/i, r => r.abort());
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#leagueTabs .tab", { timeout: 8000 });
  await page.waitForTimeout(200);
  return { page, odds };
}

async function measure(page) {
  return page.evaluate(() => {
    const bar = document.querySelector(".topbar");
    const inner = document.querySelector(".topbar-inner");
    const lnav = document.querySelector(".lnav");
    const bnav = document.querySelector("#bnav");
    const br = bnav.getBoundingClientRect();
    const items = [...bnav.querySelectorAll("a")].map(a => {
      const label = [...a.querySelectorAll("span")].find(s => !s.classList.contains("ic-wrap") && !s.classList.contains("lv-badge"));
      const lr = label.getBoundingClientRect();
      const ar = a.getBoundingClientRect();
      const cs = getComputedStyle(a);
      return {
        nav: a.dataset.nav,
        text: label.textContent.trim(),
        fs: parseFloat(cs.fontSize),
        tf: cs.textTransform,
        w: ar.width,
        h: ar.height,
        clipped: lr.right > ar.right + 0.6 || lr.left < ar.left - 0.6 || lr.width < 1,
        pastBar: ar.right > br.right + 0.6 || ar.left < br.left - 0.6,
      };
    });
    return {
      headerH: bar.getBoundingClientRect().height,
      innerH: inner.getBoundingClientRect().height,
      lnavH: lnav.getBoundingClientRect().height,
      bnavH: br.height,
      bnavDisplay: getComputedStyle(bnav).display,
      chipsAway: bar.classList.contains("chips-away"),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      bnavOverflow: bnav.scrollWidth - bnav.clientWidth,
      items,
    };
  });
}

for (const w of [360, 390]) {
  const { page, odds } = await open(w, 800);
  const m = await measure(page);
  check(odds.length === 0, `${w}: no Odds API request`);
  check(m.headerH <= 96 && m.headerH >= 80, `${w}: header ${m.headerH.toFixed(1)}px (logo row + chips, under 96)`);
  check(m.innerH <= 48.5 && m.innerH >= 46, `${w}: logo row ${m.innerH.toFixed(1)}px`);
  check(m.lnavH <= 44 && m.lnavH >= 36, `${w}: chip row ${m.lnavH.toFixed(1)}px while at the top`);
  check(m.items.map(i => i.nav).join() === TABS.join(), `${w}: all eight tabs (${m.items.map(i => i.nav).join()})`);
  check(m.items.every(i => i.fs >= 11 && i.tf === "none"), `${w}: labels are 11px+ sentence case (${m.items.map(i => i.fs + i.tf).join(" ")})`);
  check(m.items.every(i => !i.clipped && !i.pastBar), `${w}: every label sits inside its tab (${m.items.map(i => i.text + ":" + Math.round(i.w) + (i.clipped || i.pastBar ? " CLIP" : "")).join(" ")})`);
  check(m.bnavH >= 44 && m.bnavH <= 56, `${w}: bottom bar ${m.bnavH.toFixed(1)}px`);
  check(m.overflow <= 1 && m.bnavOverflow <= 1, `${w}: no sideways overflow (page ${m.overflow}, bar ${m.bnavOverflow})`);
  await page.evaluate(() => window.scrollTo(0, 640));
  await page.waitForTimeout(500);
  const down = await measure(page);
  check(down.chipsAway && down.lnavH <= 1, `${w}: chips hide on scroll down (away ${down.chipsAway}, row ${down.lnavH.toFixed(1)}px, header ${down.headerH.toFixed(1)}px)`);
  await page.evaluate(() => window.scrollTo(0, 120));
  await page.waitForTimeout(500);
  const up = await measure(page);
  check(!up.chipsAway && up.lnavH >= 36, `${w}: chips return on scroll up (away ${up.chipsAway}, row ${up.lnavH.toFixed(1)}px)`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(450);
  await page.evaluate(() => window.scrollTo(0, 720));
  await page.waitForTimeout(80);
  await page.evaluate(() => window.scrollTo(0, 160));
  await page.waitForTimeout(450);
  const flick = await measure(page);
  check(!flick.chipsAway && flick.lnavH >= 36, `${w}: a quick scroll back up shows the chips again (away ${flick.chipsAway}, row ${flick.lnavH.toFixed(1)}px)`);
  await page.evaluate(() => { document.querySelector(".topbar").classList.add("chips-away"); document.querySelector("#leagueTabs .tab").focus(); });
  await page.waitForTimeout(300);
  const focused = await page.evaluate(() => document.querySelector(".lnav").getBoundingClientRect().height);
  check(focused >= 36, `${w}: focusing a chip shows the row while it is collapsed (${focused.toFixed(1)}px)`);
  await page.close();
}

{
  const { page } = await open(1280, 800);
  const m = await measure(page);
  check(m.bnavDisplay === "none", "1280: bottom nav stays hidden");
  check(m.innerH >= 58 && m.innerH <= 62, `1280: logo row stays ${m.innerH.toFixed(1)}px`);
  check(m.lnavH >= 48 && m.lnavH <= 54, `1280: chip row stays ${m.lnavH.toFixed(1)}px`);
  await page.evaluate(() => window.scrollTo(0, 800));
  await page.waitForTimeout(200);
  const down = await measure(page);
  check(!down.chipsAway && down.lnavH >= 48, `1280: chips stay put while scrolling (row ${down.lnavH.toFixed(1)}px)`);
  await page.close();
}

await browser.close();
server.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nphone chrome ok");
