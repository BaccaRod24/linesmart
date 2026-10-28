// Moneyline move across even money. Mirrors scripts/line_history.py. No network.
// Usage: node scripts/line_move_test.mjs
import { createRequire } from "module";
import fs from "fs";
const require = createRequire(import.meta.url);
const C = require("../site/assets/line-core.js");
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); if (!ok) fails.push(msg); };

check(C.cents(-110, 114) === 24, "-110 -> +114 is +24 cents");
check(C.cents(114, -110) === -24, "+114 -> -110 is -24 cents");
check(C.cents(-105, 105) === 10, "-105 -> +105 is +10 cents");
check(C.cents(105, -105) === -10, "+105 -> -105 is -10 cents");
check(C.cents(100, -100) === 0 && C.cents(-100, 100) === 0, "+100 <-> -100 is no change");
check(C.cents(-110, -135) === -25, "same-sign -110 -> -135 is -25");
check(C.cents(150, 180) === 30, "same-sign +150 -> +180 is +30");
check(Math.round(C.probPts(-110, 114) * 10) / 10 === -5.7, "-110 -> +114 is -5.7 implied-probability points");
check(C.probPts(100, -100) === 0, "+100 -> -100 is 0 implied-probability points");
check(C.biggest(-105, [-140, 100], true) === -140, "biggest move from -105 over [-140, +100] picks -140");
check(C.formatSigned(C.cents(-110, 114), true) === "+24", "game-page change text is +24");
check(C.formatSigned(C.cents(114, -110), true) === "-24", "game-page change text is -24");
check(C.formatSigned(C.cents(-105, 105), true) === "+10", "game-page change text is +10");
check(C.formatSigned(C.cents(100, -100), true) === "", "+100 -> -100 formats as no change");
check(C.formatSigned(C.cents(-110, -135), true) === "-25" && C.formatSigned(C.cents(150, 180), true) === "+30", "same-sign format");

// The app game page (lineMoveSection stats) prints this for the change and biggest columns.
const cell = (open, cur, series) => {
  const dlt = C.moveDelta(open, cur, true);
  const big = C.biggest(open, series, true);
  const ch = C.formatSigned(dlt, true);
  const bg = C.formatSigned(C.moveDelta(open, big, true), true);
  return { change: ch ? (dlt > 0 ? "▲ " : "▼ ") + ch : "—", biggest: bg ? `${big > 0 ? "+" : ""}${big} (${bg})` : "—" };
};
const sea = cell(-110, 114, [-110, -105, 100, 120, 114]);
check(sea.change === "▲ +24" && !sea.change.includes("224"), `Kraken change column is +24, not +224 (${sea.change})`);
check(sea.biggest === "+120 (+30)" && !sea.biggest.includes("230"), `Kraken biggest column is +120 (+30), not +230 (${sea.biggest})`);
check(cell(-105, 100, [-140, 100]).biggest.startsWith("-140"), "biggest column picks -140");

const app = fs.readFileSync(new URL("../site/assets/app.js", import.meta.url), "utf8");
const idx = fs.readFileSync(new URL("../site/index.html", import.meta.url), "utf8");
const sw = fs.readFileSync(new URL("../site/sw.js", import.meta.url), "utf8");
check(/window\.LineCore/.test(app) && /\.biggest\(/.test(app) && /\.moveDelta\(/.test(app) && /\.formatSigned\(/.test(app), "app.js game page uses the shared helper");
check(!/p\.v\[s\.key\] - open/.test(app), "app.js no longer subtracts raw moneyline prices");
check(idx.includes('src="assets/line-core.js"') && idx.indexOf("line-core.js") < idx.indexOf("assets/app.js"), "line-core.js loads before app.js");
check(sw.includes('"assets/line-core.js"'), "service worker caches line-core.js");

console.log(fails.length ? `\n${fails.length} FAILED` : "\nall line-move front-end tests passed");
process.exit(fails.length ? 1 : 0);
