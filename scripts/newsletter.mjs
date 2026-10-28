#!/usr/bin/env node
// LineSmart weekly email: build from the site's published data, render, and (only when explicitly enabled) send via Resend.
//
//   node scripts/newsletter.mjs                         # dry run (default): writes HTML + text, sends nothing
//   node scripts/newsletter.mjs --data-dir site/data    # use local data files instead of https://linesmart.app/data/
//   node scripts/newsletter.mjs --mode test --test-to you@example.com    # one copy to one address (needs RESEND_API_KEY)
//   NEWSLETTER_ENABLED=1 node scripts/newsletter.mjs --mode send        # all confirmed subscribers
//   node scripts/newsletter.mjs --state FL              # preview / test copy with a Florida recipient's helpline line
//
// Helplines: each email shows the recipient's state helpline when the state is known (a "state" field on the
// newsletter_recipients row; the table doesn't store one today), otherwise the compact multi-state line.
//
// Env: RESEND_API_KEY (test/send), NEWSLETTER_EXPORT_KEY (send: reads the confirmed list through the
// newsletter_recipients RPC), NEWSLETTER_MAILING_ADDRESS (overrides config), NEWSLETTER_ENABLED=1 (send).
// Never prints keys or subscriber addresses (only counts).
import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { buildIssue, renderEmail, bannedIn, unsubFor, sendBlockers, isEmptyIssue } from "./newsletter_lib.mjs";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NC = require(join(ROOT, "site/assets/news-core.js"));

function args(argv) {
  const a = { mode: "dry-run", out: "newsletter-out/preview.html", dataUrl: "https://linesmart.app/data/", dataDir: "", testTo: "", now: "", state: "", config: join(ROOT, "scripts/newsletter.config.json") };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], val = () => argv[++i];
    if (k === "--mode") a.mode = val();
    else if (k === "--out") a.out = val();
    else if (k === "--data-url") a.dataUrl = val();
    else if (k === "--data-dir") a.dataDir = val();
    else if (k === "--test-to") a.testTo = val();
    else if (k === "--now") a.now = val();
    else if (k === "--state") a.state = val();
    else if (k === "--config") a.config = val();
    else if (k === "-h" || k === "--help") { console.log("see header of scripts/newsletter.mjs"); process.exit(0); }
    else throw new Error(`unknown option ${k}`);
  }
  if (!["dry-run", "test", "send"].includes(a.mode)) throw new Error(`--mode must be dry-run, test or send`);
  return a;
}

async function loadJSON(a, rel) {
  try {
    if (a.dataDir) return JSON.parse(await readFile(join(a.dataDir, rel), "utf8"));
    const r = await fetch(new URL(rel, a.dataUrl.endsWith("/") ? a.dataUrl : a.dataUrl + "/"), { headers: { "cache-control": "no-cache" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) { console.warn(`warn: ${rel}: ${e.message}`); return null; }
}

async function resend(path, body, key, idem) {
  const r = await fetch(`https://api.resend.com${path}`, { method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...(idem ? { "Idempotency-Key": idem } : {}) }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(`Resend ${r.status} ${j.name || ""}: ${j.message || ""}`.trim()); e.status = r.status; throw e; }
  return j;
}

async function recipients(exportKey) {
  const r = await fetch(NC.RPC("newsletter_recipients"), { method: "POST",
    headers: { apikey: NC.SB_KEY, authorization: `Bearer ${NC.SB_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ p_key: exportKey }) });
  if (!r.ok) throw new Error(`newsletter_recipients failed: HTTP ${r.status}`);
  const rows = await r.json();
  return rows.filter(x => x && NC.validEmail(x.email) && x.unsub_token);
}

async function main() {
  const a = args(process.argv.slice(2));
  const cfg = JSON.parse(await readFile(a.config, "utf8"));
  if (process.env.NEWSLETTER_MAILING_ADDRESS) cfg.mailingAddress = process.env.NEWSLETTER_MAILING_ADDRESS;
  const now = a.now ? new Date(a.now).toISOString() : new Date().toISOString();

  const meta = await loadJSON(a, "meta.json");
  const indexes = [], props = [];
  for (const lg of cfg.leagues) { const index = await loadJSON(a, `${lg}/index.json`); if (index) indexes.push({ lg, index }); }
  for (const lg of cfg.propLeagues) { const doc = await loadJSON(a, `props/${lg}.json`); if (doc) props.push({ lg, doc }); }
  const issue = buildIssue({ meta, indexes, props, now, cfg });
  console.log(`issue ${issue.issueDate}: ${issue.gamesInWindow} games in window · ${issue.prices.length} price gaps · ${issue.numbers.length} number diffs · ${issue.props.length} hot props · ${issue.moves.length} moves · odds as of ${issue.asOf}`);

  const lintHits = bannedIn(renderEmail(issue, cfg, { lint: true }).html + renderEmail(issue, cfg, { lint: true }).text);
  if (lintHits.length) throw new Error(`banned wording in template: ${lintHits.join(", ")}`);

  const preview = renderEmail(issue, cfg, { unsubUrl: `${cfg.siteUrl}/unsubscribe.html?t=PREVIEW`, state: a.state || null });
  await mkdir(dirname(resolve(a.out)), { recursive: true });
  await writeFile(a.out, preview.html);
  await writeFile(a.out.replace(/\.html?$/, "") + ".txt", `Subject: ${preview.subject}\nPreheader: ${preview.preheader}\n\n${preview.text}\n`);
  console.log(`wrote ${a.out} (+ .txt) · subject: ${preview.subject}`);
  if (a.mode === "dry-run") { if (isEmptyIssue(issue)) console.warn("warn: every section is empty"); return; }

  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  const ageH = meta && meta.generated ? (Date.parse(now) - Date.parse(meta.generated)) / 36e5 : Infinity;
  if (!(ageH < 36)) throw new Error(`site data is stale (meta.generated ${meta && meta.generated}); not sending`);
  const tag = `weekly-${issue.issueDate}`;

  if (a.mode === "test") {
    const to = a.testTo || process.env.NEWSLETTER_TEST_TO;
    if (!NC.validEmail(to || "")) throw new Error("--test-to needs one valid address");
    const block = sendBlockers({ cfg, mode: "test", issue });
    if (block.length) throw new Error(`not sending: ${block.join("; ")}`);
    const u = unsubFor(cfg, "TEST");
    const m = renderEmail(issue, cfg, { unsubUrl: u.url, state: a.state || null });
    const r = await resend("/emails", { from: cfg.from, to: [to], reply_to: cfg.replyTo, subject: `[TEST] ${m.subject}`, html: m.html, text: m.text,
      headers: u.headers, tags: [{ name: "campaign", value: `${tag}-test` }] });
    console.log(`test email sent (id ${r.id})`);
    return;
  }

  // ---- send to confirmed subscribers
  if (process.env.NEWSLETTER_ENABLED !== "1") throw new Error("NEWSLETTER_ENABLED is not 1; refusing to send");
  const exportKey = process.env.NEWSLETTER_EXPORT_KEY;
  if (!exportKey) throw new Error("NEWSLETTER_EXPORT_KEY is not set");
  const list = await recipients(exportKey);
  const block = sendBlockers({ cfg, mode: "send", recipients: list, issue });
  if (block.length) throw new Error(`not sending: ${block.join("; ")}`);
  if (!list.length) { console.log("no confirmed subscribers; nothing to send"); return; }
  let sent = 0;
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100).map(rcp => {
      const u = unsubFor(cfg, rcp.unsub_token), m = renderEmail(issue, cfg, { unsubUrl: u.url, state: rcp.state || null });
      return { from: cfg.from, to: [rcp.email], reply_to: cfg.replyTo, subject: m.subject, html: m.html, text: m.text, headers: u.headers, tags: [{ name: "campaign", value: tag }] };
    });
    try { await resend("/emails/batch", chunk, key, `linesmart-${tag}-${i / 100}`); sent += chunk.length; }
    catch (e) { console.error(`stopped after ${sent} of ${list.length}: ${e.message}`); process.exitCode = 1; break; }
  }
  console.log(`sent ${sent} of ${list.length}`);
}

main().catch(e => { console.error(`error: ${e.message}`); process.exit(1); });
