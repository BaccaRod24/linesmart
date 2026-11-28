// The phone 21+ sheet is shorter, with the same words and the same helplines.
// Desktop type and padding stay as they were. Does not set ls-age-ok. Never calls the Odds API.
// Usage: env -u ODDS_API_KEY node scripts/age_notice_test.mjs
import { chromium } from "playwright";
import fs from "fs";
import http from "http";
import path from "path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const site = path.join(root, "site");
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"} age-notice: ${msg}`); if (!ok) fails.push(msg); };
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

const WORDS = {
  title: "For adults 21 and over",
  body: "LineSmart shows sports betting odds and stats for people 21+ where sports betting is legal. We don't take bets. Odds are for reference only.",
  help: "Gambling problem? Call or text 1-800-GAMBLER. In Florida: 1-833-PLAYWISE.",
  ok: "I'm 21 or older",
  more: "Responsible gambling",
  fine: "If you're under 21, please leave this site.",
};

async function open(w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const odds = [];
  page.on("request", req => { if (/the-odds-api|api\.odds/i.test(req.url())) odds.push(req.url()); });
  await page.route(/the-odds-api|api\.odds|ipdata\.info/i, r => r.abort());
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".age-sheet", { timeout: 5000 });
  await page.waitForTimeout(300);
  return { page, odds };
}

async function read(page) {
  return page.evaluate(() => {
    const sheet = document.querySelector(".age-sheet");
    const cs = getComputedStyle(sheet);
    const h2 = sheet.querySelector("h2");
    const help = sheet.querySelector(".age-help");
    const fine = sheet.querySelector(".age-fine");
    const r = sheet.getBoundingClientRect();
    const norm = s => (s || "").replace(/\s+/g, " ").trim();
    return {
      h: r.height,
      top: r.top,
      vh: window.innerHeight,
      pad: cs.padding,
      h2: h2.textContent.trim(),
      h2fs: getComputedStyle(h2).fontSize,
      body: norm(sheet.querySelector("#ageDesc p").textContent),
      pfs: getComputedStyle(sheet.querySelector("#ageDesc p")).fontSize,
      help: norm(help.textContent),
      helpfs: getComputedStyle(help).fontSize,
      fine: norm(fine.textContent),
      finefs: getComputedStyle(fine).fontSize,
      ok: sheet.querySelector("#ageOk").textContent.trim(),
      okH: sheet.querySelector("#ageOk").getBoundingClientRect().height,
      more: sheet.querySelector(".age-more").textContent.trim(),
      tels: [...sheet.querySelectorAll("a[href^='tel:']")].map(a => a.getAttribute("href")),
      stored: localStorage.getItem("ls-age-ok"),
      foot: document.querySelector(".footer .rg.fl") ? document.querySelector(".footer .rg.fl").textContent : "",
    };
  });
}

{
  const { page, odds } = await open(390, 844);
  const m = await read(page);
  console.log("phone", JSON.stringify({ h: Math.round(m.h), top: Math.round(m.top), pct: +(m.h / m.vh).toFixed(3), h2fs: m.h2fs, pfs: m.pfs, helpfs: m.helpfs, finefs: m.finefs, pad: m.pad, okH: Math.round(m.okH) }));
  check(odds.length === 0, "no Odds API request");
  check(m.stored == null, "notice is showing (ls-age-ok not set)");
  check(m.h < 280 && m.h / m.vh < 0.34, `phone sheet is under a third of the screen (${Math.round(m.h)}px, ${(100 * m.h / m.vh).toFixed(0)}%)`);
  check(m.h2 === WORDS.title && m.body === WORDS.body && m.help === WORDS.help && m.ok === WORDS.ok && m.more === WORDS.more && m.fine === WORDS.fine, "phone wording unchanged");
  check(m.tels[0] === "tel:18004262537" && m.tels[1] === "tel:18337529947", `helpline links unchanged (${m.tels})`);
  check(parseFloat(m.helpfs) >= 13 && parseFloat(m.helpfs) <= 13.5, `helpline type stays readable (${m.helpfs})`);
  check(parseFloat(m.finefs) >= 12.5, `leave-site line stays readable (${m.finefs})`);
  check(m.okH >= 44, `confirm button stays a 44px tap target (${Math.round(m.okH)}px)`);
  check(/1-888-ADMIT-IT/.test(m.foot) && /1-833-PLAYWISE/.test(m.foot), "footer Florida helplines unchanged");
  await page.close();
}

{
  const { page } = await open(1280, 800);
  const m = await read(page);
  console.log("desk", JSON.stringify({ h: Math.round(m.h), h2fs: m.h2fs, helpfs: m.helpfs, finefs: m.finefs, pad: m.pad, pfs: m.pfs }));
  check(m.h2fs === "21px" && m.pad === "26px 24px 20px", `desktop card type and padding unchanged (${m.h2fs}, ${m.pad})`);
  check(m.helpfs === "15px" && m.finefs === "15px", `desktop helpline stays body size (${m.helpfs} / ${m.finefs})`);
  check(m.h2 === WORDS.title && m.body === WORDS.body && m.help === WORDS.help && m.fine === WORDS.fine, "desktop wording unchanged");
  check(m.h >= 340 && m.h <= 420, `desktop sheet height stays in the old range (${Math.round(m.h)}px)`);
  await page.close();
}

await browser.close();
server.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nage notice ok");
