// Browser checks for the background player. Serves site/ locally. Never calls the Odds API.
// Usage: env -u ODDS_API_KEY node scripts/music_e2e.mjs
// Screenshots: SHOT_DIR=/tmp/music-shots env -u ODDS_API_KEY node scripts/music_e2e.mjs
import { chromium } from "playwright";
import fs from "fs";
import http from "http";
import path from "path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const site = path.join(root, "site");
const tracks = JSON.parse(fs.readFileSync(path.join(site, "assets/music/tracks.json"), "utf8"));
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"} music-e2e: ${msg}`); if (!ok) fails.push(msg); };
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webm": "audio/webm", ".m4a": "audio/mp4", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png", ".ico": "image/x-icon" };

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.normalize(path.join(site, rel));
  if (!file.startsWith(site)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    return res.end(fs.readFileSync(path.join(site, "404.html")));
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const shotDir = process.env.SHOT_DIR || "";
if (shotDir) fs.mkdirSync(shotDir, { recursive: true });

const chrome = process.env.CHROME_PATH || (fs.existsSync("/usr/bin/google-chrome-stable") ? "/usr/bin/google-chrome-stable" : "");
const browser = await chromium.launch({
  headless: true,
  executablePath: chrome || undefined,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

function trackReqs(page, bag) {
  page.on("request", req => {
    const u = req.url();
    if (/the-odds-api|api\.odds/i.test(u)) bag.odds.push(u);
    if (/\/assets\/music\//.test(u)) bag.music.push(u);
  });
}
async function openPage(width, height) {
  const bag = { music: [], odds: [] };
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: width < 500 ? 2 : 1,
    isMobile: width < 500,
    hasTouch: width < 500,
    serviceWorkers: "block",
  });
  await ctx.addInitScript(() => { try { localStorage.setItem("ls-age-ok", "1"); } catch (e) {} });
  const page = await ctx.newPage();
  await page.route("**/*", route => {
    const u = route.request().url();
    if (u.startsWith(base)) return route.continue();
    return route.abort();
  });
  trackReqs(page, bag);
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  return { ctx, page, bag, errors };
}
async function shot(page, name, height) {
  if (!shotDir) return;
  const box = page.viewportSize();
  await page.screenshot({
    path: path.join(shotDir, name + ".png"),
    clip: { x: 0, y: 0, width: box.width, height: Math.min(height, box.height) },
  });
  console.log("shot", name);
}
async function layout(page) {
  return page.evaluate(() => {
    const btn = document.querySelector("#musicBtn");
    if (!btn) return { missing: true };
    const b = btn.getBoundingClientRect();
    const hits = [];
    const off = [];
    const sel = ".topbar .brand, .topbar .brand-tag, .topbar .updated, .topbar a.search-btn, .topbar button.search-btn, .topbar .top-about, .topbar .legal-nav-a, .topbar .install-btn, #musicBtn";
    for (const el of document.querySelectorAll(sel)) {
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const name = (el.id || el.className || el.tagName).toString().slice(0, 80);
      if (el.id !== "musicBtn") {
        const overlap = b.left < r.right - 1 && b.right > r.left + 1 && b.top < r.bottom - 1 && b.bottom > r.top + 1;
        if (overlap) hits.push(name);
      }
      if (r.left < -1 || r.right > innerWidth + 1) off.push(name);
    }
    const pop = document.querySelector("#musicPop");
    const p = pop && !pop.hidden ? pop.getBoundingClientRect() : null;
    return {
      hits,
      off,
      inside: b.left >= -1 && b.top >= -1 && b.right <= innerWidth + 1 && b.bottom <= innerHeight + 1,
      width: Math.round(b.width),
      height: Math.round(b.height),
      pop: p ? { left: Math.round(p.left), right: Math.round(p.right), top: Math.round(p.top), bottom: Math.round(p.bottom), vw: innerWidth } : null,
    };
  });
}

try {
  // Fresh visit: button is off, and nothing under assets/music/ is fetched.
  {
    const { ctx, page, bag, errors } = await openPage(1280, 900);
    await page.goto(base + "about.html", { waitUntil: "load" });
    await page.waitForSelector("#musicBtn");
    await page.waitForTimeout(300);
    const label = await page.getAttribute("#musicBtn", "aria-label");
    const pressed = await page.getAttribute("#musicBtn", "aria-pressed");
    const api = await page.evaluate(() => ({ audio: window.LineSmartMusic && window.LineSmartMusic.audio, key: localStorage.getItem("ls-music") }));
    check(label === "Play background music" && pressed === "false", `starts off (${label}, pressed ${pressed})`);
    check(api.audio === false && !api.key, "no audio context and nothing saved until a click");
    check(bag.music.length === 0, `no music request before a click (${bag.music.length})`);
    check(bag.odds.length === 0 && errors.length === 0, `no odds call, no page error (${errors.join("; ")})`);
    await ctx.close();
  }

  // Click starts one webm, gapless loop point, pause / next / volume.
  {
    const { ctx, page, bag, errors } = await openPage(1280, 900);
    await page.goto(base + "about.html", { waitUntil: "load" });
    await page.click("#musicBtn");
    await page.waitForFunction(() => window.LineSmartMusic && window.LineSmartMusic.playing, null, { timeout: 20000 });
    const info = await page.evaluate(() => window.LineSmartMusic);
    const first = tracks.find(t => t.id === info.state.track) || tracks[0];
    const audioReqs = bag.music.filter(u => /\.(webm|m4a)(\?|$)/.test(u));
    check(info.format === "webm" && audioReqs.length === 1 && audioReqs[0].endsWith(first.files.webm), `plays one webm (${info.format}, ${audioReqs.join(" ")})`);
    check(Math.abs(info.loopEnd - first.loop_samples / first.sample_rate) < 0.02, `loop end ${info.loopEnd} vs ${first.loop_samples / first.sample_rate} (buffer ${info.duration})`);
    const pop = await page.locator("#musicPop");
    check(await pop.isVisible() && await page.locator("#musicToggle").innerText() === "Pause" && await page.locator("#musicNext").innerText() === "Next" && await page.locator("label[for=musicVol]").innerText() === "Volume", "popover has pause, next, and volume");
    await page.locator("#musicVol").fill("15");
    const vol = await page.evaluate(() => JSON.parse(localStorage.getItem("ls-music")).volume);
    check(vol === 0.15, `volume saved (${vol})`);
    const before = audioReqs.length;
    await page.click("#musicNext");
    await page.waitForFunction(id => window.LineSmartMusic && window.LineSmartMusic.state.track !== id && window.LineSmartMusic.playing, first.id, { timeout: 20000 });
    const audioAfter = bag.music.filter(u => /\.(webm|m4a)(\?|$)/.test(u));
    check(audioAfter.length === before + 1, `skip fetches the next file only (${audioAfter.length})`);
    await page.click("#musicToggle");
    await page.waitForFunction(() => window.LineSmartMusic && !window.LineSmartMusic.playing);
    const paused = await page.evaluate(() => JSON.parse(localStorage.getItem("ls-music")).on);
    check(paused === false, "pause turns the saved preference off");
    check(errors.length === 0 && bag.odds.length === 0, `play path stays quiet (${errors.join("; ")})`);
    await ctx.close();
  }

  // A later load shows the saved on state and does not start until a gesture.
  {
    const { ctx, page, bag } = await openPage(390, 844);
    await page.addInitScript(() => localStorage.setItem("ls-music", JSON.stringify({ on: true, track: "halftime", volume: 0.2, title: "Halftime" })));
    await page.goto(base + "about.html", { waitUntil: "load" });
    await page.waitForSelector("#musicBtn");
    await page.waitForTimeout(400);
    const armed = await page.evaluate(() => ({
      label: document.getElementById("musicBtn").getAttribute("aria-label"),
      pressed: document.getElementById("musicBtn").getAttribute("aria-pressed"),
      audio: window.LineSmartMusic.audio,
      vol: document.getElementById("musicVol").value,
    }));
    check(armed.pressed === "true" && armed.label === "Resume background music" && armed.audio === false && armed.vol === "20", `saved state is shown, not playing (${armed.label}, vol ${armed.vol})`);
    check(bag.music.length === 0, "reload does not fetch audio");
    const lay = await layout(page);
    check(lay.inside && lay.hits.length === 0 && lay.off.length === 0 && lay.width >= 36, `phone header button fits (${JSON.stringify(lay)})`);
    await shot(page, "header_phone", 220);
    await page.click("h1");
    await page.waitForFunction(() => window.LineSmartMusic && window.LineSmartMusic.playing && window.LineSmartMusic.state.track === "halftime", null, { timeout: 20000 });
    const resumed = bag.music.filter(u => /halftime\.webm/.test(u));
    check(resumed.length === 1, "the first gesture resumes the saved track");
    await ctx.close();
  }

  // Header button and open player, desktop and phone, on the real app header.
  for (const [name, w, h] of [["desktop", 1440, 900], ["phone", 390, 844]]) {
    const { ctx, page, bag, errors } = await openPage(w, h);
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#musicBtn");
    await page.waitForTimeout(600);
    const closed = await layout(page);
    check(closed.inside && closed.hits.length === 0 && closed.off.length === 0, `${name} button does not overlap header controls (${JSON.stringify(closed)})`);
    await shot(page, "header_" + name, name === "phone" ? 240 : 150);
    await page.click("#musicBtn");
    await page.waitForFunction(() => window.LineSmartMusic && (window.LineSmartMusic.playing || window.LineSmartMusic.open), null, { timeout: 20000 });
    await page.waitForFunction(() => {
      const s = document.getElementById("musicStatus");
      return s && !/Loading/.test(s.textContent);
    }, null, { timeout: 20000 });
    const openLay = await layout(page);
    const popOk = openLay.pop && openLay.pop.left >= 0 && openLay.pop.right <= openLay.pop.vw + 1 && openLay.pop.top >= 0;
    check(popOk, `${name} player stays on screen (${JSON.stringify(openLay.pop)})`);
    await shot(page, "player_" + name, name === "phone" ? 520 : 360);
    check(bag.odds.length === 0, `${name} did not call the odds API`);
    if (errors.length) console.log(name, "page errors", errors);
    await ctx.close();
  }

  // 404 keeps its own page and still has the button.
  {
    const { ctx, page, bag } = await openPage(390, 844);
    await page.goto(base + "no-such-page", { waitUntil: "load" });
    await page.waitForSelector("#musicBtn");
    const text = await page.locator("h1").innerText();
    const label = await page.getAttribute("#musicBtn", "aria-label");
    check(/not found|expired/i.test(text) && label === "Play background music", `404 still explains itself and has the button (${text})`);
    check(bag.music.length === 0, "404 does not fetch audio");
    await page.click("#musicBtn");
    await page.waitForFunction(() => window.LineSmartMusic && window.LineSmartMusic.playing, null, { timeout: 20000 });
    const box = await page.evaluate(() => {
      const p = document.getElementById("musicPop").getBoundingClientRect();
      return { left: Math.round(p.left), right: Math.round(p.right), vw: document.documentElement.clientWidth };
    });
    check(box.left >= 0 && box.right <= box.vw, `404 player stays on screen (${JSON.stringify(box)})`);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(fails.length ? `FAIL music-e2e: ${fails.length}` : "PASS music-e2e");
process.exit(fails.length ? 1 : 0);
