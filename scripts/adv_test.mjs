// Unit tests for the advanced-stats math (site/assets/adv-core.js) plus parity with scripts/linevalue.py / ats.py / adv_nba.py.
// No browser, no network, no Odds API. Usage: env -u ODDS_API_KEY node scripts/adv_test.mjs
import { createRequire } from "module";
import { execFileSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
const require = createRequire(import.meta.url);
const C = require("../site/assets/adv-core.js");
const here = path.dirname(fileURLToPath(import.meta.url));

let fails = 0, n = 0;
const check = (ok, msg) => { n++; if (!ok) { fails++; console.log(`FAIL adv-core: ${msg}`); } };
const near = (a, b, e = 1e-9) => a != null && b != null && Math.abs(a - b) < e;

// ---- implied / no-vig / edge
check(near(C.implied(-110), 110 / 210) && near(C.implied(150), 0.4) && C.implied(0) === null, "implied");
const nv = C.noVig([-110, -110]);
check(near(nv[0], 0.5) && near(nv[1], 0.5), "-110/-110 -> 50/50");
const nv2 = C.noVig([-150, 130]);
check(near(nv2[0] + nv2[1], 1) && nv2[0] > nv2[1], "no-vig sums to 1");
check(C.noVig([-110, null]) === null, "missing price -> null");
check(C.toAmerican(0.5) === -100 && C.toAmerican(0.6) === -150 && C.toAmerican(0.4) === 150, "toAmerican");
check(near(C.edge(0.5, 100), 0) && C.edge(0.5, -110) < 0 && C.edge(0.5, 110) > 0, "edge sign");
check(near(C.hold([-110, -110]), 2 * 110 / 210 - 1), "hold = overround");

// ---- outliers
const bk = (hs, hso, aso, hml, aml, tot, oo, uo) => ({ homeSpread: hs, awaySpread: hs == null ? null : -hs, homeSpreadOdds: hso, awaySpreadOdds: aso, homeML: hml, awayML: aml, total: tot, overOdds: oo, underOdds: uo });
const books = { draftkings: bk(-3.5, -110, -110, -170, 145, 47.5, -110, -110), fanduel: bk(-3.5, -112, -108, -175, 150, 47.5, -108, -112), hardrockbet: bk(-1.5, -110, -110, -120, 150, 45.5, -110, -110) };
const A = C.analyze(books, "football");
check(A.spread.line === -3.5 && A.spread.n === 2 && A.spread.books.hardrockbet.out[0] === "home" && A.spread.books.hardrockbet.outKind === "line", "spread line outlier");
check(A.total.books.hardrockbet.out[0] === "over", "total line outlier favours the over");
check(A.ml.books.hardrockbet.out[0] === "home" && A.ml.books.hardrockbet.outKind === "price", "moneyline price outlier");
check(A.ml.books.draftkings.out.length === 0, "consensus books are not outliers");

// ---- ATS / O-U with pushes
check(C.gradeATS(7, -3.5) === "W" && C.gradeATS(3, -3.5) === "L" && C.gradeATS(3, -3) === "P" && C.gradeATS(-3, 3) === "P", "ATS incl. pushes");
check(C.gradeOU(48, 47.5) === "O" && C.gradeOU(47, 47.5) === "U" && C.gradeOU(47, 47) === "P", "O/U incl. push");
check(C.recStr([5, 3, 1]) === "5-3-1" && C.recStr([5, 3, 0]) === "5-3" && near(C.recPct([3, 1, 2]), 0.75), "record strings / pct ignore pushes");

// ---- pace / ratings / usage
check(near(C.possessions(88, 10, 14, 25), 103), "possessions");
check(C.gameMinutes(4) === 48 && C.gameMinutes(6) === 58 && near(C.pace(106, 53), 48 * 106 / 53), "pace with OT");
check(near(C.rating(110, 100), 110) && C.rating(1, 0) === null, "rating per 100");
check(near(C.projPace(102, 98, 100), 99.96) && C.projPace(null, 98, 100) === null, "projected pace");
check(C.trend(20, 24, 3) === "up" && C.trend(20, 22, 3) === "flat" && C.trend(30, 26, 3) === "down" && C.trend(null, 2, 1) === null, "trend");

// ---- parity with the Python build (random books, every sport kind)
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const price = () => { const v = Math.round(-250 + rnd() * 450); return Math.abs(v) < 100 ? (v < 0 ? -105 : 105) : v; };
const kinds = ["football", "basketball", "hockey", "baseball", "soccer"], cases = [];
for (let i = 0; i < 300; i++) {
  const kind = kinds[i % kinds.length], base = Math.round(rnd() * 8) / 2, tot = 40 + Math.round(rnd() * 20) / 2, B = {};
  for (const k of ["draftkings", "fanduel", "hardrockbet"]) {
    if (rnd() < 0.1) continue;
    const ln = rnd() < 0.7 ? base : base + (rnd() < 0.5 ? -1 : 1) * (Math.round(rnd() * 4) / 2);
    const t = rnd() < 0.7 ? tot : tot + (rnd() < 0.5 ? -1 : 1) * (Math.round(rnd() * 4) / 2);
    B[k] = { ...bk(-ln, price(), price(), price(), price(), t, price(), price()), drawML: price() };
  }
  cases.push({ kind, books: B });
}
const py = JSON.parse(execFileSync("python3", ["-c", `
import json, sys; sys.path.insert(0, ${JSON.stringify(here)})
import linevalue as LV, ats as A, adv_nba as N
c = json.load(sys.stdin)
out = dict(an=[LV.analyze(x["books"], x["kind"]) for x in c["cases"]],
           ats=[A.grade_ats(m, s) for m, s in c["ats"]], ou=[A.grade_ou(p, t) for p, t in c["ou"]],
           poss=[N.possessions(*r) for r in c["poss"]])
print(json.dumps(out))`], { input: JSON.stringify({ cases, ats: [[3, -3], [7, -3.5], [-1, 1.5], [0, 0]], ou: [[47, 47], [50, 47.5], [40, 44]], poss: [[88, 10, 14, 25], [95.0, 11, 13, 25]] }) }).toString());
let mism = 0;
cases.forEach((c, i) => {
  const js = C.analyze(c.books, c.kind), p = py.an[i];
  const mk = new Set([...Object.keys(js), ...Object.keys(p)]);
  for (const m of mk) {
    const a = js[m], b = p[m];
    if (!a || !b) { mism++; continue; }
    if (a.line !== b.line || a.n !== b.n || (a.fair == null) !== (b.fair == null)) { mism++; continue; }
    if (a.fair) for (const o of Object.keys(a.fair)) if (!near(a.fair[o], b.fair[o], 1e-12) || a.fairAm[o] !== b.fairAm[o]) mism++;
    for (const k of Object.keys(a.books)) {
      const x = a.books[k], y = b.books[k];
      if (!y || JSON.stringify(x.out) !== JSON.stringify(y.out)) { mism++; continue; }
      if ((x.edge == null) !== (y.edge == null)) mism++;
      else if (x.edge) for (const o of Object.keys(x.edge)) if (!near(x.edge[o], y.edge[o], 1e-12)) mism++;
    }
  }
});
check(mism === 0, `analyze() parity JS vs Python over ${cases.length} random markets (${mism} mismatches)`);
const outs = cases.reduce((a, c) => a + Object.values(C.analyze(c.books, c.kind)).reduce((s, m) => s + Object.values(m.books).filter(b => b.out.length).length, 0), 0);
check(outs > 0, `random sample exercises outliers (${outs})`);
check(JSON.stringify(py.ats) === JSON.stringify([[3, -3], [7, -3.5], [-1, 1.5], [0, 0]].map(([m, s]) => C.gradeATS(m, s))), "ATS parity");
check(JSON.stringify(py.ou) === JSON.stringify([[47, 47], [50, 47.5], [40, 44]].map(([p, t]) => C.gradeOU(p, t))), "O/U parity");
check(near(py.poss[0], C.possessions(88, 10, 14, 25)) && near(py.poss[1], C.possessions(95, 11, 13, 25)), "possessions parity");

console.log(`adv_test.mjs: ${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);
