// Build pro/rankings-data.js from caches already on disk.
// No network and no Odds API call. Missing caches leave the current file alone.
// Usage:
//   node scripts/build_rankings.mjs --matchups _history/matchups --rosters _history/rosters --odds _history/odds --site site/data
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const R = require("../pro/rankings-core.js");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const matchDir = arg("--matchups", "");
const rosterDir = arg("--rosters", "");
const oddsDir = arg("--odds", "");
const siteDir = arg("--site", path.join(root, "site/data"));
const outPath = arg("--out", path.join(root, "pro/rankings-data.js"));

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch (e) { return null; }
}
function rosterMap(doc) {
  const out = {};
  for (const [tid, rows] of Object.entries((doc && doc.teams) || {})) {
    for (const row of rows || []) {
      if (!row || !row[0] || !row[1]) continue;
      out[String(row[0])] = { n: row[1], pos: row[2] || "", t: String(tid) };
    }
  }
  return out;
}
function abbrMap(index) {
  const abbr = {};
  for (const g of (index && index.games) || []) {
    for (const side of ["home", "away"]) {
      const t = g[side];
      if (t && t.id && t.abbr) abbr[String(t.id)] = t.abbr;
    }
  }
  return abbr;
}

if (!matchDir || !rosterDir) {
  console.log("[rankings] no cache dirs; left the current snapshot in place");
  process.exit(0);
}

const odds = oddsDir ? readJson(path.join(oddsDir, "props_oddsapi.json")) : null;
const leagues = {};
for (const lg of ["nfl", "nba"]) {
  const box = readJson(path.join(matchDir, `${lg}.json`));
  const ros = readJson(path.join(rosterDir, `${lg}.json`));
  if (!box || !box.games || !ros) {
    console.log(`[rankings] ${lg}: cache missing, skipped`);
    continue;
  }
  const index = readJson(path.join(siteDir, lg, "index.json")) || {};
  const abbr = abbrMap(index);
  const roster = rosterMap(ros);
  const players = R.aggregateSeason(lg, box.games, roster, abbr);
  const oddsLg = odds && odds.leagues && odds.leagues[lg];
  const props = oddsLg ? R.propRowsFromOdds(lg, box.games, roster, oddsLg.games || {}, index.games || [], abbr) : [];
  let through = "";
  for (const g of Object.values(box.games)) if ((g.d || "") > through) through = g.d || "";
  leagues[lg] = {
    season: box.season ?? null,
    boxGames: Object.keys(box.games).length,
    through,
    cacheUpdated: box.updated || null,
    propsPulledAt: (oddsLg && oddsLg.pulledAt) || null,
    propsGames: oddsLg ? Object.keys(oddsLg.games || {}).length : 0,
    players,
    props,
  };
  console.log(`[rankings] ${lg}: ${players.length} players, ${props.length} prop rows, ${leagues[lg].boxGames} box scores, ${leagues[lg].propsGames} prop games`);
}

if (!Object.keys(leagues).length) {
  console.log("[rankings] nothing to write");
  process.exit(0);
}

const data = { v: 1, leagues };
const body = `/* Pro rankings snapshot. Built by scripts/build_rankings.mjs from the box-score cache and the stored props pull. No live request. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RankingsData = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  return ${JSON.stringify(data)};
});
`;
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, body);
console.log("[rankings] wrote", outPath, Buffer.byteLength(body), "bytes");
