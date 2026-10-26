// Unit tests for the game-day weather UI logic (site/assets/weather-core.js). No browser needed.
// Usage: node scripts/weather_test.mjs   (optional DATA_DIR=... also sanity-checks built weather data)
import { createRequire } from "module";
import fs from "fs";
const require = createRequire(import.meta.url);
const W = require("../site/assets/weather-core.js");
const fails = [];
const check = (ok, msg, tag = "wx") => { console.log(`${ok ? "PASS" : "FAIL"} ${tag}: ${msg}`); if (!ok) fails.push(`${tag}: ${msg}`); };
const fc = o => ({ kind: "forecast", temp: 55, feels: 53, pop: 10, precip: 0, wind: 6, gust: 10, dir: 270, dirTxt: "W", code: 2, label: "Partly cloudy",
                   max: { wind: 7, gust: 11, pop: 12 }, min: { temp: 54, feels: 52 }, precipType: "rain", roof: null, tz: "America/Chicago", ...o });

// ---------- icons
check(W.iconKind(0) === "sun" && W.iconKind(2) === "partly" && W.iconKind(3) === "cloud" && W.iconKind(45) === "fog", "clear / partly / overcast / fog", "icon");
check(W.iconKind(63, 80) === "rain" && W.iconKind(81, 60) === "rain" && W.iconKind(73, 70) === "snow" && W.iconKind(95, 60) === "storm" && W.iconKind(53, 40) === "drizzle", "precip families", "icon");
check(W.iconKind(51, 2) === "cloud" && W.iconKind(61, 24) === "cloud" && W.iconKind(61, 25) === "rain", "precip code with <25% chance drawn as cloud", "icon");
check(W.iconKind(undefined) === "cloud" && W.iconKind(null, 50) === "cloud", "missing code -> cloud", "icon");

// ---------- watch thresholds (game window max/min)
check(W.watchFlags(fc()).length === 0 && W.watchLevel(fc()) === "", "calm -> no watch", "watch");
check(W.watchFlags(fc({ max: { wind: 15, gust: 24, pop: 10 } }))[0].text === "Wind 15 mph, gusts 24", "wind 15 mph in window -> watch", "watch");
check(W.watchFlags(fc({ max: { wind: 14.9, gust: 30, pop: 10 } })).length === 0, "wind 14.9 -> none (gusts alone don't trigger)", "watch");
check(W.watchFlags(fc({ temp: 34, min: { temp: 32, feels: 25 } }))[0].text === "Cold 32°F (feels 25°F)", "32°F in window -> cold watch", "watch");
check(W.watchFlags(fc({ min: { temp: 33, feels: 28 } })).length === 0, "33°F -> none", "watch");
check(W.watchFlags(fc({ max: { wind: 5, pop: 50 } }))[0].k === "rain", "50% rain -> rain watch", "watch");
check(W.watchFlags(fc({ max: { wind: 5, pop: 49 } })).length === 0, "49% -> none", "watch");
check(W.watchFlags(fc({ precipType: "snow", max: { wind: 5, pop: 70 } }))[0].text === "Snow 70% chance", "snow wording", "watch");
check(W.watchFlags(fc({ max: undefined, min: undefined, wind: 18, temp: 30, pop: 60 })).length === 3, "falls back to kickoff hour when window extremes missing", "watch");
check(W.watchLevel(fc({ roof: "retractable", max: { wind: 20, pop: 0 } })) === "roof", "retractable roof -> muted 'roof' level", "watch");
check(W.watchFlags({ kind: "indoor" }).length === 0 && W.watchFlags(null).length === 0, "indoor/null -> none", "watch");
check(W.totalsNote(fc(), "football") && W.totalsNote(fc(), "baseball") && !W.totalsNote(fc(), "soccer") && !W.totalsNote({ kind: "indoor" }, "football"), "totals note only football/baseball forecasts", "watch");

// ---------- card chip
let c = W.chipModel(fc({ temp: 47.6, wind: 12.2, pop: 30 }));
check(c.text === "48° · 12 mph · 30%" && c.icon === "partly" && c.cls === "fc", `forecast chip "${c.text}"`, "chip");
c = W.chipModel(fc({ max: { wind: 22, pop: 0 } }));
check(/\bwatch\b/.test(c.cls) && /Weather watch: Wind 22 mph/.test(c.title), "watch chip class + tooltip", "chip");
c = W.chipModel(fc({ roof: "retractable", max: { wind: 22, pop: 0 } }));
check(c.cls === "fc roof rr" && /retractable roof/.test(c.title), "retractable chip muted", "chip");
check(W.chipModel({ kind: "indoor", roof: "arena" }).text === "Indoor" && W.chipModel({ kind: "indoor", roof: "dome" }).title.startsWith("Dome"), "indoor chip", "chip");
check(W.chipModel({ kind: "pending" }).text === "Forecast soon", "pending chip", "chip");
check(W.chipModel({ kind: "unavailable" }) === null && W.chipModel(undefined) === null, "unavailable -> no chip", "chip");
check(W.chipModel(fc({ pop: null })).parts.length === 2, "no rain chance -> two parts", "chip");

// ---------- helpers
const ts = Date.UTC(2026, 10, 1, 18, 0) / 1000;   // Sun Nov 1 2026 18:00Z (after US DST ends)
check(/^12:00\sPM CST$/.test(W.localTime(ts, "America/Chicago")), `local kickoff CT: ${W.localTime(ts, "America/Chicago")}`, "time");
check(/^7:00\sPM/.test(W.localTime(ts, "Europe/Paris")), `local kickoff Paris: ${W.localTime(ts, "Europe/Paris")}`, "time");
check(/^6:00\sPM UTC$/.test(W.localTime(ts, "Not/AZone")) && W.localTime(null) === "", "bad tz -> UTC, missing ts -> ''", "time");
check(W.windArrowDeg(270) === 90 && W.windArrowDeg(90) === 270 && W.windArrowDeg(null) === null, "arrow points downwind", "time");
check(W.deg(31.5) === "32°" && W.mph(undefined) === "–" && W.pct(49.6) === "50%", "formatters", "time");

// ---------- optional: built data sanity (DATA_DIR)
const DATA = process.env.DATA_DIR;
if (DATA && fs.existsSync(`${DATA}/meta.json`)) {
  const meta = JSON.parse(fs.readFileSync(`${DATA}/meta.json`));
  check(meta.weather && meta.weather.source === "Open-Meteo.com", "meta.weather credits Open-Meteo", "data");
  for (const lg of meta.order) {
    const f = `${DATA}/${lg}/index.json`; if (!fs.existsSync(f)) continue;
    const idx = JSON.parse(fs.readFileSync(f)), kind = (meta.leagues[lg] || {}).kind;
    const up = idx.games.filter(g => g.state === "pre");
    const n = k => up.filter(g => (g.weather || {}).kind === k).length;
    const bad = up.filter(g => !g.weather || (["basketball", "hockey"].includes(kind) && g.weather.kind !== "indoor"));
    check(!bad.length, `${up.length} upcoming: ${n("forecast")} forecast, ${n("indoor")} indoor, ${n("pending")} pending, ${n("unavailable")} unavailable`, `data-${lg}`);
  }
}

console.log(fails.length ? `\n${fails.length} failure(s)` : "\nall weather UI tests passed");
process.exit(fails.length ? 1 : 0);
