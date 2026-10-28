// Bot filter for the visits-by-state count. No network, no database, no browser.
// Prints which sample page views the old counter accepted and which the filter keeps.
// Usage: env -u ODDS_API_KEY node scripts/visit_filter_test.mjs
import { createRequire } from "module";
import fs from "fs";
const require = createRequire(import.meta.url);
const G = require("../site/assets/geo-core.js");

let pass = 0, fail = 0;
const check = (ok, msg) => { if (ok) pass++; else { fail++; console.log("FAIL " + msg); } };

const CHROME_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const CHROME_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const CHROME_LINUX = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const CHROME_ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36";
const CHROME_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0.6261.89 Mobile/15E148 Safari/604.1";
const SAFARI_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const SAFARI_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const SAFARI_IPAD = "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const FIREFOX_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0";
const FIREFOX_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:123.0) Gecko/20100101 Firefox/123.0";
const FIREFOX_ANDROID = "Mozilla/5.0 (Android 14; Mobile; rv:123.0) Gecko/123.0 Firefox/123.0";
const FIREFOX_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/123.0 Mobile/15E148 Safari/605.1.15";
const EDGE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0";
const SAMSUNG = "Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36";
const DUCK = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1 DuckDuckGo/7";
const YANDEX_BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 YaBrowser/24.1.0.0 Safari/537.36";
const CUBOT = "Mozilla/5.0 (Linux; Android 11; CUBOT NOTE 20) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/89.0.4389.105 Mobile Safari/537.36";
const FB_APP = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/450.0.0.32.109;]";
const WHATSAPP = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36 WhatsApp/2.24.1";

// Old counter: any of these, once it had a US state on linesmart.app, was counted. No UA or visibility check.
const real = [
  ["Chrome Windows", CHROME_WIN],
  ["Chrome Mac", CHROME_MAC],
  ["Chrome Linux", CHROME_LINUX],
  ["Chrome Android", CHROME_ANDROID],
  ["Chrome iPhone", CHROME_IOS],
  ["Safari Mac", SAFARI_MAC],
  ["Safari iPhone", SAFARI_IPHONE],
  ["Safari iPad", SAFARI_IPAD],
  ["Firefox Windows", FIREFOX_WIN],
  ["Firefox Mac", FIREFOX_MAC],
  ["Firefox Android", FIREFOX_ANDROID],
  ["Firefox iPhone", FIREFOX_IOS],
  ["Edge Windows", EDGE],
  ["Samsung Internet", SAMSUNG],
  ["DuckDuckGo browser", DUCK],
  ["Yandex Browser", YANDEX_BROWSER],
  ["Cubot phone", CUBOT],
  ["Facebook in-app", FB_APP],
  ["WhatsApp in-app", WHATSAPP],
];
const bots = [
  ["Googlebot", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"],
  ["Googlebot smartphone", "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.71 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"],
  ["AdsBot-Google", "AdsBot-Google (+http://www.google.com/adsbot.html)"],
  ["Google-InspectionTool", "Mozilla/5.0 (compatible; Google-InspectionTool/1.0;)"],
  ["Bingbot", "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)"],
  ["BingPreview", "Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/534+ (KHTML, like Gecko) BingPreview/1.0b"],
  ["DuckDuckBot", "DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)"],
  ["Applebot", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15 (Applebot/0.1)"],
  ["YandexBot", "Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)"],
  ["AhrefsBot", "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)"],
  ["SemrushBot", "Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)"],
  ["Bytespider", "Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)"],
  ["GPTBot", "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot"],
  ["ClaudeBot", "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ClaudeBot/1.0; +frank.g@example.org"],
  ["Amazonbot", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_1) AppleWebKit/600.2.5 (KHTML, like Gecko) Version/8.0.2 Safari/600.2.5 (Amazonbot/0.1)"],
  ["facebookexternalhit", "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"],
  ["Twitterbot", "Twitterbot/1.0"],
  ["Slackbot", "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)"],
  ["Discordbot", "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)"],
  ["UptimeRobot", "Mozilla/5.0 (compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)"],
  ["Pingdom", "Pingdom.com_bot_version_1.4_(http://www.pingdom.com/)"],
  ["StatusCake", "StatusCake"],
  ["Site24x7", "Site24x7"],
  ["Checkly", "Checkly/1.0 (https://www.checklyhq.com)"],
  ["Datadog Synthetics", "Datadog/Synthetics"],
  ["HeadlessChrome", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/122.0.0.0 Safari/537.36"],
  ["Playwright UA", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Playwright"],
  ["Puppeteer UA", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Puppeteer"],
  ["Selenium", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Selenium"],
  ["PhantomJS", "Mozilla/5.0 (Unknown; Linux x86_64) AppleWebKit/538.1 (KHTML, like Gecko) PhantomJS/2.1.1 Safari/538.1"],
  ["Lighthouse", "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse"],
  ["curl", "curl/8.5.0"],
  ["wget", "Wget/1.21.4"],
  ["python-requests", "python-requests/2.32.3"],
  ["Python-urllib", "Python-urllib/3.12"],
  ["Go-http-client", "Go-http-client/2.0"],
  ["LineSmart script", "LineSmart/1.0 (+https://linesmart.app)"],
  ["cron-job.org", "cron-job.org (https://cron-job.org)"],
  ["Scrapy", "Scrapy/2.11.0 (+https://scrapy.org)"],
  ["Screaming Frog", "Screaming Frog SEO Spider/19.0"],
  ["standalone Bot token", "SomeMonitor-Bot/1.0"],
];

const sql = fs.readFileSync("supabase/migrations/20261028_state_visits_bot_filter.sql", "utf8");
const geoJs = fs.readFileSync("site/assets/geo.js", "utf8");
const priv = fs.readFileSync("site/privacy.html", "utf8");
const m = sql.match(/if ua ~ \$re\$(.*)\$re\$ then/);
check(!!m && m[1] === G.BOT_UA_RE, "migration embeds GeoCore.BOT_UA_RE exactly");
const sqlRe = m ? new RegExp(m[1]) : null;
const serverSkipUa = ua => !!(sqlRe && sqlRe.test(String(ua || "").toLowerCase()));

// New server rule, mirroring the migration: missing headers fail open; a readable bot UA or
// prefetch/prerender/preview purpose does not increment. The UA is not stored.
function serverAfter(sample) {
  if (!sample.headers) return "count";
  const purpose = `${sample.headers["sec-purpose"] || ""} ${sample.headers.purpose || ""} ${sample.headers["x-purpose"] || ""} ${sample.headers["x-moz"] || ""}`.toLowerCase();
  if (/prefetch|prerender|preview/.test(purpose)) return "skip";
  if (serverSkipUa(sample.ua)) return "skip";
  return "count";
}

const rows = [];
const push = (name, env, extra = {}) => {
  const after = G.visitDecision(env);
  const sample = { name, ua: env.userAgent, headers: extra.headers === undefined ? {
    "user-agent": env.userAgent || "", "sec-purpose": env.secPurpose || "", purpose: env.purpose || "", "x-purpose": env.xPurpose || "",
  } : extra.headers };
  rows.push({ name, beforeClient: "count", afterClient: after, beforeServer: "count", afterServer: serverAfter(sample) });
};

for (const [name, ua] of real) push(name, { userAgent: ua, webdriver: false, visibilityState: "visible", prerendering: false });
for (const [name, ua] of bots) push(name, { userAgent: ua, webdriver: false, visibilityState: "visible", prerendering: false });
push("webdriver + normal Chrome", { userAgent: CHROME_WIN, webdriver: true, visibilityState: "visible" });
push("webdriver 1 + Safari", { userAgent: SAFARI_IPHONE, webdriver: 1, visibilityState: "visible" });
push("hidden tab, Chrome", { userAgent: CHROME_WIN, webdriver: false, visibilityState: "hidden" });
push("prerendering, Chrome", { userAgent: CHROME_MAC, webdriver: false, prerendering: true, visibilityState: "hidden" });
push("visibility prerender, Firefox", { userAgent: FIREFOX_WIN, webdriver: false, visibilityState: "prerender" });
push("sec-purpose prefetch;prerender", { userAgent: CHROME_WIN, webdriver: false, visibilityState: "visible", secPurpose: "prefetch;prerender" });
push("purpose prefetch", { userAgent: SAFARI_MAC, webdriver: false, visibilityState: "visible", purpose: "prefetch" });
push("x-purpose preview", { userAgent: SAFARI_IPHONE, webdriver: false, visibilityState: "visible", xPurpose: "preview" });
push("empty UA, visible", { userAgent: "", webdriver: false, visibilityState: "visible" });
push("Googlebot + webdriver", { userAgent: bots[0][1], webdriver: true, visibilityState: "visible" });

const pad = (s, n) => String(s).padEnd(n);
console.log("\nBefore (no filter) vs after. Legacy counted every sample that had a US state on linesmart.app.");
console.log("Client 'wait' does not send until the page is actually visible. Server has no visibility signal.");
console.log(pad("sample", 32) + pad("client before", 15) + pad("client after", 15) + pad("server before", 15) + "server after");
for (const r of rows) console.log(pad(r.name, 32) + pad(r.beforeClient, 15) + pad(r.afterClient, 15) + pad(r.beforeServer, 15) + r.afterServer);

for (const [name, ua] of real) {
  check(G.visitDecision({ userAgent: ua, webdriver: false, visibilityState: "visible" }) === "count", `accept real browser: ${name}`);
  check(!serverSkipUa(ua), `server accepts real browser: ${name}`);
}
for (const [name, ua] of bots) {
  check(G.isBotUserAgent(ua) && G.visitDecision({ userAgent: ua, webdriver: false, visibilityState: "visible" }) === "skip", `reject bot UA: ${name}`);
  check(serverSkipUa(ua), `server rejects bot UA: ${name}`);
}
check(G.visitDecision({ userAgent: CHROME_WIN, webdriver: true, visibilityState: "visible" }) === "skip", "webdriver rejected even with a normal Chrome UA");
check(G.visitDecision({ userAgent: SAFARI_IPHONE, webdriver: 1, visibilityState: "visible" }) === "skip", "webdriver 1 rejected");
check(!serverSkipUa(CHROME_WIN), "server cannot see webdriver; a normal Chrome UA still passes the UA check");
check(G.visitDecision({ userAgent: CHROME_WIN, visibilityState: "hidden" }) === "wait", "hidden tab waits instead of counting");
check(G.visitDecision({ userAgent: CHROME_WIN, prerendering: true, visibilityState: "hidden" }) === "wait", "prerender waits so activation can still count");
check(G.visitDecision({ userAgent: FIREFOX_ANDROID, visibilityState: "prerender" }) === "wait", "visibilityState prerender waits");
check(G.visitDecision({ userAgent: CHROME_WIN, visibilityState: "visible", secPurpose: "prefetch;prerender" }) === "skip", "sec-purpose prerender skipped");
check(G.visitDecision({ userAgent: CHROME_WIN, visibilityState: "visible", purpose: "prefetch" }) === "skip", "purpose prefetch skipped");
check(G.visitDecision({ userAgent: SAFARI_IPHONE, visibilityState: "visible", xPurpose: "preview" }) === "skip", "x-purpose preview skipped");
check(rows.find(r => r.name === "sec-purpose prefetch;prerender").afterServer === "skip", "server skips sec-purpose prerender");
check(rows.find(r => r.name === "purpose prefetch").afterServer === "skip", "server skips purpose prefetch");
check(rows.find(r => r.name === "x-purpose preview").afterServer === "skip", "server skips x-purpose preview");
check(rows.find(r => r.name === "webdriver + normal Chrome").afterClient === "skip" && rows.find(r => r.name === "webdriver + normal Chrome").afterServer === "count", "webdriver is a client-only signal; the server still requires the UA");
check(G.visitDecision({ userAgent: "", visibilityState: "visible", webdriver: false }) === "count", "empty UA is not itself a known bot");
check(G.isBotUserAgent(null) === false && G.isBotUserAgent(undefined) === false, "missing UA is not a bot");
check(G.visitDecision({ userAgent: bots[0][1], prerendering: true }) === "skip", "a bot prerender is skip, not wait");
check(!G.isBotUserAgent("both of these are fine") && !G.isBotUserAgent(CUBOT), "Cubot and the word both are not bots");

const countedBefore = rows.length;
const countedAfter = rows.filter(r => r.afterClient === "count").length;
const botsAfter = rows.filter(r => bots.some(b => b[0] === r.name) && r.afterClient === "count").length;
check(botsAfter === 0, `no listed bot is counted (${botsAfter})`);
check(countedAfter < countedBefore, `filter drops some of the samples the old counter kept (${countedAfter} of ${countedBefore})`);
const realAfter = rows.filter(r => real.some(b => b[0] === r.name) && r.afterClient !== "count");
check(realAfter.length === 0, `every real browser sample is still counted (${realAfter.map(r => r.name).join(", ")})`);

check(sql.includes("create or replace function public.state_visit_bump(p_state text)"), "migration replaces state_visit_bump");
check(sql.includes("insert into public.state_visits as v (day, state, visits)"), "migration still writes only day, state, visits");
check(!/user_agent|user-agent text|insert into [^;]*user/i.test(sql.replace(/hdr->>'user-agent'/g, "")), "migration does not store a user agent");
check(!/raise notice|raise log|raise warning/i.test(sql), "migration does not log the user agent");
check(sql.includes("sec-purpose") && sql.includes("%prefetch%") && sql.includes("%prerender%") && sql.includes("%preview%"), "migration rejects prefetch, prerender and preview purpose headers");
check(sql.includes("current_setting('request.headers', true)"), "migration reads request headers only as a GUC");
check(/revoke all on function public\.state_visit_bump\(text\) from public/.test(sql), "migration keeps the function off the public role");

const fn = geoJs.slice(geoJs.indexOf("function countState"), geoJs.indexOf("ready.then(countState)"));
check(fn.includes("G.visitDecision(visitEnv())") && fn.indexOf("visitDecision") < fn.indexOf("ls.set(K_SV"), "geo.js filters before it remembers the day or sends");
check(fn.includes('decision === "skip"') && fn.includes('decision === "wait"') && fn.includes("armVisible"), "geo.js skips bots and waits out hidden or prerendered loads");
check(/navigator\.webdriver/.test(geoJs) && /document\.prerendering/.test(geoJs) && /visibilityState/.test(geoJs), "geo.js looks at webdriver, prerendering and visibility");
check(priv.includes("Automated visits aren't counted either") && priv.includes("The user agent is not stored") && priv.includes("don't store your IP address"), "privacy page describes the filter and still says the user agent and IP are not stored");
check(fs.readFileSync("scripts/build_pages.py", "utf8").includes("The user agent is not stored"), "privacy source in build_pages.py matches");

console.log(`\nSamples the old counter would have stored: ${countedBefore}. Still sent immediately: ${countedAfter}. Held until visible: ${rows.filter(r => r.afterClient === "wait").length}. Not counted: ${rows.filter(r => r.afterClient === "skip").length}.`);
console.log(`${fail ? "FAIL" : "PASS"} visit filter: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
