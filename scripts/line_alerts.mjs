#!/usr/bin/env node
/* Line alerts checker. Runs in GitHub Actions after each successful "Refresh data and deploy" run (.github/workflows/line-alerts.yml).
 * It never calls The Odds API: it reads the odds JSON the site already published (https://linesmart.app/data/...).
 *
 *   node scripts/line_alerts.mjs --mode dry-run          # read alerts + data, print what would fire (counts and ids only)
 *   node scripts/line_alerts.mjs --mode send             # report matches to Postgres, which sends (needs DB setting enabled)
 *   node scripts/line_alerts.mjs --mode dry-run --alerts-file a.json --data path/to/data   # offline, no database
 *
 * Env: LINE_ALERTS_KEY (GitHub secret; never printed), SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY (public; default to the site's).
 * Emails, user ids and the Resend key never reach this script: Postgres looks up recipients and sends (see the migration). */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const AC = require("../site/assets/alerts-core.js");

export const DEFAULTS = {
  data: "https://linesmart.app/data",
  supabaseUrl: "https://ctklbryattbbsqdmteny.supabase.co",
  publishable: "sb_publishable_CP-WGhBFJnoN8exJRtCu2g_CPODay7V",
  maxMetaAgeMin: 90,        // refuse to check against a site build older than this (deploy broken)
  maxOddsAgeH: 6,           // skip a league whose last odds pull is older than this
  maxHits: 40,
};

function args(argv) {
  const o = { mode: process.env.ALERTS_MODE || "dry-run" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = () => argv[++i];
    if (a === "--mode") o.mode = v(); else if (a === "--data") o.data = v(); else if (a === "--alerts-file") o.alertsFile = v();
    else if (a === "--now") o.now = Date.parse(v()); else if (a === "--json") o.json = true;
  }
  return o;
}

async function readJSON(base, rel) {
  if (!/^https?:/.test(base)) return JSON.parse(fs.readFileSync(path.join(base, rel), "utf8"));
  const r = await fetch(`${base}/${rel}?cb=${Date.now()}`, { headers: { "cache-control": "no-cache" } });
  if (!r.ok) throw new Error(`GET ${rel}: HTTP ${r.status}`);
  return r.json();
}

async function rpc(fn, body, env) {
  const r = await fetch(`${env.url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: env.pub, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${fn}: HTTP ${r.status} ${/forbidden/.test(t) ? "forbidden (LINE_ALERTS_KEY doesn't match the hash in line_alert_settings)" : t.slice(0, 200)}`);
  return JSON.parse(t);
}

/** Load the published data for the alerts' leagues: {games: Map, props: {lg: doc}, stale: Set(lg)}. */
export async function loadData(base, alerts, nowMs, log = () => {}) {
  const meta = await readJSON(base, "meta.json");
  const age = (nowMs - Date.parse(meta.generated)) / 60000;
  if (!(age <= DEFAULTS.maxMetaAgeMin)) throw new Error(`site data is ${isFinite(age) ? Math.round(age) + " min" : "of unknown age"} old (max ${DEFAULTS.maxMetaAgeMin}); not checking against stale lines`);
  const lgs = [...new Set(alerts.map(a => a.league))].filter(l => /^[a-z0-9]{2,8}$/.test(l) && meta.leagues && meta.leagues[l]);
  const games = new Map(), props = {}, stale = new Set();
  const pulls = (meta.hardrock && meta.hardrock.leagues) || {};
  for (const lg of lgs) {
    const at = Date.parse(pulls[lg] || "");
    if (!(nowMs - at <= DEFAULTS.maxOddsAgeH * 3600e3)) { stale.add(lg); log(`skip ${lg}: last odds pull ${pulls[lg] || "never"}`); continue; }
    const idx = await readJSON(base, `${lg}/index.json`);
    for (const g of idx.games || []) games.set(`${lg}/${g.id}`, g);
    if (alerts.some(a => a.league === lg && a.kind === "prop_move")) {
      try { props[lg] = await readJSON(base, `props/${lg}.json`); } catch (e) { log(`no props file for ${lg}`); }
    }
  }
  return { games, props, stale, generated: meta.generated };
}

export async function run(o, env = process.env, out = console.log) {
  const mode = o.mode;
  if (!["dry-run", "send"].includes(mode)) { out(`mode ${mode}: nothing to do (alerts off)`); return { mode, hits: [] }; }
  const nowMs = o.now || Date.now();
  const db = { url: env.SUPABASE_URL || DEFAULTS.supabaseUrl, pub: env.SUPABASE_PUBLISHABLE_KEY || DEFAULTS.publishable, key: env.LINE_ALERTS_KEY || "" };
  let alerts;
  if (o.alertsFile) alerts = JSON.parse(fs.readFileSync(o.alertsFile, "utf8"));
  else {
    if (db.key.length < 32) { out("LINE_ALERTS_KEY is not set: skipping (see docs/line_alerts.md)"); return { mode, hits: [], skipped: "no-key" }; }
    alerts = await rpc("line_alerts_pending", { p_key: db.key }, db);
  }
  out(`mode ${mode}: ${alerts.length} active alert(s)`);
  if (!alerts.length) return { mode, hits: [] };
  const data = await loadData(o.data || DEFAULTS.data, alerts, nowMs, out);
  const live = alerts.filter(a => !data.stale.has(a.league));
  const { hits, skipped } = AC.checkAll(live, data.games, data.props, nowMs, DEFAULTS.maxHits);
  if (data.stale.size) skipped["stale-odds"] = alerts.length - live.length;
  out(`data built ${data.generated}; matched ${hits.length}; not matched: ${JSON.stringify(skipped)}`);
  const byId = new Map(alerts.map(a => [a.id, a]));
  for (const h of hits) { const a = byId.get(h.id); out(`  match ${String(h.id).slice(0, 8)} ${a.kind} ${a.league}/${a.game_id} ${h.book} ${h.value}${h.price != null ? " @ " + h.price : ""}`); }
  if (mode !== "send" || !hits.length) { if (mode !== "send") out("dry run: nothing sent"); return { mode, hits, skipped }; }
  if (o.alertsFile) { out("send needs the database; refusing with --alerts-file"); return { mode, hits, skipped }; }
  const res = await rpc("line_alerts_fire", { p_key: db.key, p_hits: hits }, db);
  out(`database: ${JSON.stringify(res)}`);
  if (res.status === "disabled") out("line_alert_settings.enabled is false in the database: nothing sent");
  return { mode, hits, skipped, res };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run(args(process.argv.slice(2))).catch(e => { console.error(`line alerts: ${e.message}`); process.exit(1); });
}
