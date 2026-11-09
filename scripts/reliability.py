#!/usr/bin/env python3
"""Structural checks for a LineSmart refresh. No network and no Odds API calls.

What a refresh can check:
  * each league's Odds API pull clock (hardrock.leagues[league], not the build clock)
  * whether that league has upcoming games and had events inside the 7-day odds window
  * duplicate game ids, games with no teams, and home/away that are the same team
  * a new odds pull whose teams don't match the previous pull for that game id
  * American odds, spreads and totals outside a wide plausible range
  * a book that had lines on the previous pull and has none on this one

What it cannot check: the price on Hard Rock Bet, DraftKings or FanDuel's own
site. A passing run is not a confirmation that a number matches the sportsbook.

A bad pull does not replace the last good lines, and it does not move their asOf.
Off-season leagues and leagues with zero events in the odds window are not outages.
Lines are snapshots on the current cadence (about every 30 min unless the budget
guard slows or stops them), not a live board.

Stale means: in-window league, at least one upcoming game, and the last game-line
pull is older than max(90 minutes, 3x the current interval). Budget level "stop"
is recorded but does not fail the workflow; pulls are paused on purpose.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys

BOOKS = ("hardrockbet", "fanduel", "draftkings")
PRICE_KEYS = ("homeML", "awayML", "drawML", "homeSpreadOdds", "awaySpreadOdds", "overOdds", "underOdds")
# Absolute spread / (min total, max total). Wide on purpose: a real posted number should pass;
# a zero, a 200-point football spread, or a moneyline of 50 should not.
LIMITS = {
    "football": (70, (15, 95)),
    "basketball": (60, (80, 280)),
    "hockey": (8, (1.5, 12)),
    "baseball": (8, (2, 22)),
    "soccer": (5, (0.5, 9)),
    "mma": (15, (0.5, 6)),
}
FINDINGS: list = []


def note(finding):
    FINDINGS.append(finding)
    return finding


def take_findings():
    out = list(FINDINGS)
    FINDINGS.clear()
    return out


def parse(s):
    if not s:
        return None
    try:
        t = dt.datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        return t if t.tzinfo else t.replace(tzinfo=dt.timezone.utc)
    except ValueError:
        return None


def age_min(stamp, now):
    t = parse(stamp)
    if not t:
        return None
    return int((now - t).total_seconds() // 60)


def stale_after_min(interval):
    """How old a game-line pull can be before an in-season league is stale."""
    try:
        interval = int(interval or 30)
    except (TypeError, ValueError):
        interval = 30
    if interval < 1:
        interval = 30
    return max(90, interval * 3)


def american_ok(v):
    if v is None:
        return True
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return False
    n = int(round(v))
    return abs(n) >= 100 and abs(n) <= 20000


def _num(v):
    if isinstance(v, bool) or v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def line_sane(line, kind):
    """Return a copy with impossible markets removed, plus a list of problem strings.

    None means the book line has no usable price left.
    """
    if not isinstance(line, dict):
        return None, ["line is not an object"]
    out = dict(line)
    problems = []
    for key in PRICE_KEYS:
        if key in out and not american_ok(out.get(key)):
            problems.append(f"{key}={out.get(key)}")
            out.pop(key, None)
    spread_max, (tmin, tmax) = LIMITS.get(kind) or LIMITS["football"]
    for side in ("home", "away"):
        sp = _num(out.get(f"{side}Spread"))
        if sp is not None and abs(sp) > spread_max:
            problems.append(f"{side}Spread={sp}")
            out.pop(f"{side}Spread", None)
            out.pop(f"{side}SpreadOdds", None)
    total = _num(out.get("total"))
    if total is not None and not (tmin <= total <= tmax):
        problems.append(f"total={total}")
        out.pop("total", None)
        out.pop("overOdds", None)
        out.pop("underOdds", None)
    if not any(out.get(k) is not None for k in ("homeML", "awayML", "homeSpread", "total")):
        return None, problems or ["no price"]
    return out, problems


def _sides(rec):
    if not isinstance(rec, dict):
        return None
    home, away = rec.get("home"), rec.get("away")
    if not home or not away:
        return None
    return (str(home), str(away))


def _priced(line):
    return isinstance(line, dict) and any(line.get(k) is not None for k in ("homeML", "awayML", "homeSpread", "total"))


def screen_pull(prev, entry, kind):
    """Decide what to store for one league's odds pull.

    Returns (entry or None, findings). None means keep the previous pull unchanged,
    including its pulledAt. Kept lines carry the previous pull's asOf.
    """
    prev = prev or {}
    prev_games = prev.get("games") or {}
    new_games = {str(k): dict(v) for k, v in (entry.get("games") or {}).items()}
    findings = []
    old_at = prev.get("pulledAt")
    new_at = entry.get("pulledAt")
    mismatches = []
    for gid, rec in new_games.items():
        old = prev_games.get(gid) or prev_games.get(str(gid))
        if _sides(old) and _sides(rec) and _sides(old) != _sides(rec):
            mismatches.append(gid)
    if mismatches and len(mismatches) >= max(3, int(0.5 * max(1, len(new_games)))):
        findings.append({"level": "error", "code": "pull_rejected", "detail": f"{len(mismatches)} games changed teams; kept the previous pull from {old_at}"})
        return None, findings
    for gid in mismatches:
        old = prev_games.get(gid) or {}
        kept = dict(old)
        lines = {}
        for bk, line in (old.get("lines") or {}).items():
            if isinstance(line, dict):
                lines[bk] = dict(line, asOf=(line.get("asOf") or old_at))
        kept["lines"] = lines
        new_games[gid] = kept
        findings.append({"level": "warn", "code": "team_mismatch", "game": gid, "detail": f"teams changed; kept lines from {old_at}"})
    for gid, rec in list(new_games.items()):
        if gid in mismatches:
            continue
        old_lines = ((prev_games.get(gid) or {}).get("lines") or {})
        lines = dict(rec.get("lines") or ({"hardrockbet": rec["line"]} if rec.get("line") else {}))
        for bk, line in list(lines.items()):
            cleaned, problems = line_sane(line, kind)
            if problems:
                findings.append({"level": "warn", "code": "invalid_odds", "game": gid, "book": bk, "detail": ", ".join(problems)})
            if cleaned is None:
                old = old_lines.get(bk)
                if _priced(old):
                    lines[bk] = dict(old, asOf=(old.get("asOf") or old_at))
                    findings.append({"level": "warn", "code": "kept_last_good", "game": gid, "book": bk, "detail": f"invalid line replaced with the pull from {old_at}"})
                else:
                    lines.pop(bk, None)
            else:
                lines[bk] = dict(cleaned, asOf=(cleaned.get("asOf") or new_at))
        rec = dict(rec, lines=lines)
        if "hardrockbet" in lines:
            rec["line"] = {k: v for k, v in lines["hardrockbet"].items() if k != "asOf"}
        new_games[gid] = rec
    shared = [gid for gid in new_games if gid in prev_games]
    for bk in BOOKS:
        prev_n = sum(1 for gid in shared if _priced((prev_games[gid].get("lines") or {}).get(bk)))
        new_n = sum(1 for gid in shared if _priced((new_games[gid].get("lines") or {}).get(bk)))
        if prev_n >= 3 and new_n == 0:
            kept_n = 0
            for gid in shared:
                old = (prev_games[gid].get("lines") or {}).get(bk)
                if not _priced(old):
                    continue
                lines = dict(new_games[gid].get("lines") or {})
                lines[bk] = dict(old, asOf=(old.get("asOf") or old_at))
                new_games[gid] = dict(new_games[gid], lines=lines)
                kept_n += 1
            findings.append({"level": "warn", "code": "incomplete_book", "book": bk, "detail": f"{bk} missing on this pull; kept {kept_n} lines from {old_at}"})
    return dict(entry, games=new_games), findings


def clean_games(games):
    """Drop games that cannot be shown (no teams, home is away). Keep the first copy of a duplicate id."""
    findings, seen, out = [], {}, []
    for g in games or []:
        gid = str(g.get("id") or "")
        home, away = g.get("home") or {}, g.get("away") or {}
        hid, aid = str(home.get("id") or ""), str(away.get("id") or "")
        if not gid or not hid or not aid or hid == aid or not (home.get("abbr") or home.get("name")) or not (away.get("abbr") or away.get("name")):
            findings.append({"level": "warn", "code": "invalid_game", "game": gid, "detail": "missing teams or home and away are the same team; left out of this publish"})
            continue
        if gid in seen:
            findings.append({"level": "error", "code": "duplicate_game", "game": gid, "detail": "same game id appeared twice; kept the first"})
            continue
        seen[gid] = True
        out.append(g)
    return out, findings


def assess(meta, active, now):
    """Per-league freshness from pull clocks. active is league -> event count in the odds window (0 = off-season or empty)."""
    odds = meta.get("oddsApi") or {}
    interval = odds.get("gameInterval") or 30
    level = odds.get("level") or "full"
    limit = stale_after_min(interval)
    pulled = (meta.get("hardrock") or {}).get("leagues") or {}
    leagues = {}
    for key, info in (meta.get("leagues") or {}).items():
        if not isinstance(info, dict):
            continue
        upcoming = info.get("upcoming") or 0
        at = pulled.get(key)
        in_window = None
        if isinstance(active, dict) and key in active:
            in_window = bool(active.get(key))
        age = age_min(at, now)
        stale = bool(in_window and upcoming and age is not None and age > limit)
        leagues[key] = {"pulledAt": at, "ageMin": age, "upcoming": upcoming, "inWindow": in_window, "stale": stale}
    return {
        "staleAfterMin": limit,
        "gameInterval": interval,
        "level": level,
        "leagues": leagues,
        "note": "Odds are the last successful pull, refreshed about every "
                f"{interval} min, not a live board. A league with no upcoming games, or no Odds API "
                "events in the next 7 days, is not an outage.",
    }


def health_record(meta, findings, now, run_id):
    fr = meta.get("freshness") or {}
    leagues = fr.get("leagues") or {}
    kept = sum(1 for f in findings if f.get("code") in ("kept_last_good", "incomplete_book", "team_mismatch", "pull_rejected"))
    return {
        "v": 1,
        "runId": str(run_id or "local"),
        "at": now.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "generated": meta.get("generated"),
        "checkedAt": (meta.get("oddsApi") or {}).get("checkedAt"),
        "level": fr.get("level"),
        "gameInterval": fr.get("gameInterval"),
        "staleAfterMin": fr.get("staleAfterMin"),
        "notVerified": "Prices are not compared to the sportsbook's own site.",
        "counts": {
            "findings": len(findings),
            "errors": sum(1 for f in findings if f.get("level") == "error"),
            "warnings": sum(1 for f in findings if f.get("level") == "warn"),
            "keptLastGood": kept,
            "staleLeagues": sum(1 for row in leagues.values() if row.get("stale")),
        },
        "leagues": leagues,
        "findings": findings[-80:],
    }


def write_health(record, site_dir, log_dir=None, snap_path=None):
    os.makedirs(site_dir, exist_ok=True)
    with open(os.path.join(site_dir, "health.json"), "w", encoding="utf-8") as fh:
        json.dump(record, fh, indent=1)
    if log_dir:
        os.makedirs(log_dir, exist_ok=True)
        with open(os.path.join(log_dir, f"{record['runId']}.json"), "w", encoding="utf-8") as fh:
            json.dump(record, fh, indent=1)
    if snap_path:
        os.makedirs(os.path.dirname(snap_path) or ".", exist_ok=True)
        with open(snap_path, "w", encoding="utf-8") as fh:
            json.dump(record, fh, indent=1)


def stale_now(meta, now=None):
    """Re-evaluate stored freshness against `now`. Returns (stale rows, limit, level)."""
    now = now or dt.datetime.now(dt.timezone.utc)
    fr = meta.get("freshness") or {}
    limit = fr.get("staleAfterMin") or stale_after_min(fr.get("gameInterval"))
    level = fr.get("level") or (meta.get("oddsApi") or {}).get("level") or "full"
    rows = []
    for key, row in (fr.get("leagues") or {}).items():
        if not row.get("inWindow") or not row.get("upcoming"):
            continue
        age = age_min(row.get("pulledAt"), now)
        if age is not None and age > limit:
            rows.append({"league": key, "ageMin": age, "pulledAt": row.get("pulledAt")})
    return rows, limit, level


def check_meta(path, fail_if_stale=False, now=None):
    meta = json.loads(open(path, encoding="utf-8").read())
    rows, limit, level = stale_now(meta, now)
    print(f"freshness: level={level} staleAfterMin={limit} staleLeagues={len(rows)}")
    for row in rows:
        print(f"  {row['league']}: last pull {row['pulledAt']} ({row['ageMin']} min old)")
    if not rows:
        print("No in-window league is past the freshness limit.")
        return 0
    if level == "stop":
        print("::warning title=LineSmart odds paused::Budget guard has stopped Odds API pulls. "
              "In-window lines are old and the site should say so. This is not a failed refresh.")
        return 0
    message = "Published odds are stale for " + ", ".join(f"{r['league']} ({r['ageMin']} min, pull {r['pulledAt']})" for r in rows)
    print(f"::error title=LineSmart stale odds::{message}")
    return 1 if fail_if_stale else 0


def main(argv):
    p = argparse.ArgumentParser(description="Check published odds freshness from data/meta.json")
    p.add_argument("--meta", required=True)
    p.add_argument("--fail-if-stale", action="store_true")
    args = p.parse_args(argv)
    return check_meta(args.meta, args.fail_if_stale)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
