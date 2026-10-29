#!/usr/bin/env python3
"""One-time backfill of finished games played before the archive started (2026-10-27).

Reads ESPN's public scoreboard (?dates=YYYYMMDD) from each league's season start through 2026-10-27 and writes
games-<lg>.json records in the same shape as the SEO archive. Closing lines come from git history of
history/<lg>.json on a data-history checkout, which exists from 2026-10-26 02:46 UTC. Games before that are stored
with "closing": null; the page then says "Closing lines not recorded".

This script never calls The Odds API, and it never commits or pushes. Point --out at a scratch directory first.
Point it at data-history's pages/ only when you mean to update that checkout, then commit and push data-history
yourself. Do not run it from CI.

    env -u ODDS_API_KEY python3 scripts/backfill_results.py --probe
    env -u ODDS_API_KEY python3 scripts/backfill_results.py --league nba --dates 2026-10-20,2026-10-23,2026-10-26 --out /tmp/linesmart-backfill
    env -u ODDS_API_KEY python3 scripts/backfill_results.py --out /path/to/data-history/pages --history /path/to/data-history --through 2026-10-27

ESPN depth (checked 2026-10-28, a light sample, not every day): scoreboards return real events back to at least
October 2010 for nfl, nba, ncaaf, ncaab, nhl, mlb and ufc. The day before each current season's calendarStartDate
was an empty 200, not an error. Current season starts from the scoreboard: NFL 2026-08-06, NBA 2026-09-30
(first listed game 2026-10-03), NCAAF 2026-02-01, NCAAB 2026-07-13, NHL 2026-09-15, MLB 2026-02-19, UFC 2026-01-01.
Oct 20 / 23 / 26 2026 NBA scoreboards include the Celtics games (BOS @ DET, NY @ BOS, CHI @ BOS) and do not include odds.

NBA 2026-10-26 (and 2026-10-27) are a separate failure: the bare URL
``basketball/nba/scoreboard?dates=20261026`` is HTTP 200 with a 0-byte body, so an earlier backfill
recorded no games that day. ``?dates=20261026&limit=100`` returns the nine Oct 26 ET finals. Dates around
them (Oct 25, Oct 24, Oct 23) return JSON with no extra parameter, so this is not the scoreboard date
rolling on UTC. ``build_data.fetch_scoreboard`` retries once with ``limit=100`` when the bare URL is not JSON.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_data as BD  # noqa: E402
import line_history as LH  # noqa: E402
import seo_pages as SP  # noqa: E402
import ufc as UF  # noqa: E402

THROUGH = "2026-10-27"
CLOSING_FROM = "2026-10-26T02:46:00Z"   # first data-history snapshot that can hold a closing line
HISTORY_UNTIL = "2026-10-28T18:00:00Z"  # late Oct 27 ET games tip into Oct 28 UTC
OUR_BOOKS = ("draftkings", "hardrockbet", "fanduel")
# Dates used by --probe. 2010 dates returned events on 2026-10-28; the 2026 dates bracket this season's start.
PROBE = {
    "nfl": ["20101003", "20260805", "20260806"],
    "nba": ["20101026", "20260929", "20261003", "20261020"],
    "ncaaf": ["20100904", "20260131", "20260905"],
    "ncaab": ["20101108", "20260712", "20261103"],
    "nhl": ["20101007", "20260914", "20261007"],
    "mlb": ["20100404", "20260218", "20260401"],
    "ufc": ["20101023", "20251231", "20260124"],
}


def leagues(keys=None):
    want = set(keys or SP.ORDER)
    return [lg for lg in BD.LEAGUES if lg["key"] in want and lg["key"] in SP.ORDER]


def scoreboard_url(lg, ymd=None):
    base = f"{BD.SITE}{lg['path']}/scoreboard?" + (f"dates={ymd}" if ymd else "limit=1")
    return base + (lg.get("params") or "")


def et_day(value):
    dt = SP.parse_dt(value) if not hasattr(value, "tzinfo") else value
    if dt is None:
        return None
    return SP.day_et(dt)


def daterange(start, end):
    cur = datetime.strptime(start, "%Y-%m-%d").date()
    stop = datetime.strptime(end, "%Y-%m-%d").date()
    while cur <= stop:
        yield cur.strftime("%Y%m%d"), cur.strftime("%Y-%m-%d")
        cur += timedelta(days=1)


def finished(g, lg):
    if SP.abnormal(g):
        return True
    if g.get("state") != "post" and not g.get("completed"):
        return False
    if lg == "ufc":
        return bool(g.get("result")) or any((g.get(s) or {}).get("winner") for s in ("home", "away"))
    h, a = g.get("home") or {}, g.get("away") or {}
    return BD.num(h.get("score")) is not None and BD.num(a.get("score")) is not None


def ufc_games(ev):
    """One site-scoreboard card -> bout games. Order 1 is away, order 2 is home, matching scripts/ufc.py."""
    out = []
    for comp in ev.get("competitions") or []:
        order = {}
        for c in comp.get("competitors") or []:
            order[c.get("order")] = UF.fighter_brief(c)
        away, home = order.get(1) or {}, order.get(2) or {}
        if not away.get("name") or not home.get("name"):
            continue
        st = comp.get("status") or ev.get("status") or {}
        stt = st.get("type") or {}
        detail = stt.get("shortDetail") or stt.get("detail")
        raw = st.get("result") or {}
        res = None
        if stt.get("completed") and not SP.abnormal({"statusDetail": detail}):
            win = "home" if home.get("winner") else "away" if away.get("winner") else None
            res = {"winner": win, "method": raw.get("displayName") or raw.get("name"), "detail": raw.get("description"),
                   "round": st.get("period"), "clock": st.get("displayClock")}
        v = comp.get("venue") or {}
        addr = v.get("address") or {}
        out.append(dict(
            id=str(comp.get("id") or ""), date=comp.get("date") or ev.get("date"),
            name=f"{away.get('name')} vs. {home.get('name')}", state=stt.get("state") or "pre", statusDetail=detail,
            completed=bool(stt.get("completed")), venue=v.get("fullName"), city=addr.get("city"),
            venueState=addr.get("state"), venueCountry=addr.get("country"),
            away=away, home=home, result=res,
            event={"id": str(ev.get("id") or ""), "name": ev.get("name") or "UFC", "short": ev.get("shortName")},
        ))
    return [g for g in out if g.get("id")]


def games_from_scoreboard(lg, sb):
    out = []
    for ev in sb.get("events") or []:
        if lg["key"] == "ufc":
            out.extend(ufc_games(ev))
            continue
        try:
            g = BD.game_from_event(ev, lg)
        except (KeyError, IndexError, TypeError):
            continue
        if g and g.get("id") and g.get("home") and g.get("away"):
            out.append(g)
    return out


def book_from_point(pt):
    if not isinstance(pt, dict):
        return {}
    return {src: pt[k] for k, src in LH.FIELDS.items() if pt.get(k) is not None}


def history_commits(repo: Path, lg):
    try:
        out = subprocess.check_output(
            ["git", "-C", str(repo), "log", f"--since={CLOSING_FROM}", f"--until={HISTORY_UNTIL}",
             "--pretty=format:%H", "--", f"history/{lg}.json"],
            text=True, stderr=subprocess.DEVNULL)
    except (subprocess.CalledProcessError, FileNotFoundError):
        return []
    return [line for line in out.splitlines() if line.strip()]


def show_history(repo: Path, commit, lg):
    try:
        raw = subprocess.check_output(["git", "-C", str(repo), "show", f"{commit}:history/{lg}.json"], text=True, stderr=subprocess.DEVNULL)
        data = json.loads(raw)
    except (subprocess.CalledProcessError, FileNotFoundError, json.JSONDecodeError):
        return {}
    return (data or {}).get("games") or {}


def closing_for(records, repo: Path | None, lg):
    """Fill records[gid]['closing'] from history when the game starts on or after CLOSING_FROM. Others stay null."""
    wanted = {}
    for gid, rec in records.items():
        start = rec.get("date") or ""
        if repo and start >= CLOSING_FROM:
            wanted[gid] = start
    best = {gid: {} for gid in wanted}
    if wanted and repo:
        for commit in history_commits(repo, lg):
            games = show_history(repo, commit, lg)
            for gid, start in wanted.items():
                g = games.get(gid) or games.get(str(gid))
                if not g:
                    continue
                for bk, pts in (g.get("books") or {}).items():
                    if bk not in OUR_BOOKS or not isinstance(pts, list):
                        continue
                    before = [p for p in pts if isinstance(p, list) and len(p) >= 2 and isinstance(p[0], str) and p[0] < start]
                    if not before:
                        continue
                    ts, pt = before[-1]
                    prev = best[gid].get(bk)
                    if prev is None or ts >= prev[0]:
                        best[gid][bk] = (ts, pt if isinstance(pt, dict) else {})
    for gid, rec in records.items():
        books, times = {}, []
        for bk, (ts, pt) in best.get(gid, {}).items():
            row = book_from_point(pt)
            if row:
                books[bk] = row
                times.append(ts)
        rec["closing"] = {"books": books, "odds": None, "closedAt": max(times)} if books else None


def to_record(g, lg):
    if not finished(g, lg):
        return None
    day = et_day(g.get("date"))
    if not day:
        return None
    rec = SP.compact(g)
    rec["id"] = str(g.get("id"))
    return day, rec


def merge_file(path: Path, records):
    """Add new games. An existing game that already has closing lines is left completely alone."""
    cur = {}
    if path.is_file():
        try:
            loaded = json.loads(path.read_text())
            if isinstance(loaded, dict):
                cur = loaded
        except (OSError, json.JSONDecodeError):
            cur = {}
    added = updated = kept = 0
    for gid, rec in records.items():
        old = cur.get(gid)
        if isinstance(old, dict) and isinstance(old.get("closing"), dict):
            kept += 1
            continue
        if isinstance(old, dict):
            if isinstance(rec.get("closing"), dict):
                old["closing"] = rec["closing"]
                updated += 1
            elif "closing" not in old:
                old["closing"] = None
                updated += 1
            continue
        cur[gid] = rec
        added += 1
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cur, sort_keys=True))
    return {"added": added, "updated": updated, "kept": kept, "total": len(cur)}


def backfill(out: Path, history: Path | None = None, keys=None, dates=None, through=THROUGH, fetch=None, pause=0.2):
    """Write games-<lg>.json under `out`. `fetch(url) -> dict`. Returns {lg: stats}."""
    fetch = fetch or BD.getj
    summary = {}
    for lg in leagues(keys):
        records = {}
        if dates:
            days = []
            for d in dates:
                ymd = d.replace("-", "")
                days.append((ymd, f"{ymd[:4]}-{ymd[4:6]}-{ymd[6:8]}"))
        else:
            try:
                sb = fetch(scoreboard_url(lg))
            except Exception as ex:
                print(f"{lg['key']}: season lookup failed ({ex})", flush=True)
                continue
            if pause:
                time.sleep(pause)
            league = (sb.get("leagues") or [{}])[0]
            start = et_day((league.get("season") or {}).get("startDate") or league.get("calendarStartDate")) or "2026-01-01"
            if start > through:
                print(f"{lg['key']}: season start {start} is after {through}; nothing to backfill", flush=True)
                continue
            print(f"{lg['key']}: {start} through {through}", flush=True)
            days = list(daterange(start, through))
        for ymd, day in days:
            if day > through:
                continue
            try:
                sb = BD.fetch_scoreboard(lg, ymd, fetch)
            except Exception as ex:
                print(f"  {lg['key']} {day}: {ex}", flush=True)
                continue
            if pause:
                time.sleep(pause)
            n = 0
            for g in games_from_scoreboard(lg, sb):
                got = to_record(g, lg["key"])
                if not got or got[0] > through:
                    continue
                records[str(g["id"])] = got[1]
                n += 1
            if n:
                print(f"  {lg['key']} {day}: {n} final(s)", flush=True)
        closing_for(records, history, lg["key"])
        stats = merge_file(out / f"games-{lg['key']}.json", records)
        stats["closing"] = sum(1 for r in records.values() if isinstance(r.get("closing"), dict))
        stats["no_closing"] = sum(1 for r in records.values() if r.get("closing") is None)
        summary[lg["key"]] = stats
        print(f"{lg['key']}: {stats}", flush=True)
    return summary


def probe(fetch=None, pause=0.2):
    """Print how far back each league's scoreboard goes. Writes nothing."""
    fetch = fetch or BD.getj
    for lg in leagues():
        try:
            sb = fetch(scoreboard_url(lg))
            league = (sb.get("leagues") or [{}])[0]
            start = (league.get("season") or {}).get("startDate") or league.get("calendarStartDate")
            print(f"{lg['key']}: season start {start}", flush=True)
        except Exception as ex:
            print(f"{lg['key']}: season lookup failed ({ex})", flush=True)
            start = None
        if pause:
            time.sleep(pause)
        for ymd in PROBE.get(lg["key"], []):
            try:
                sb = BD.fetch_scoreboard(lg, ymd, fetch)
                ev = sb.get("events") or []
                sample = (ev[0].get("shortName") or ev[0].get("name")) if ev else ""
                print(f"  {ymd}: {len(ev)} events {sample}", flush=True)
            except Exception as ex:
                print(f"  {ymd}: {type(ex).__name__}: {ex}", flush=True)
            if pause:
                time.sleep(pause)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", help="directory for games-<lg>.json. Merges into files that are already there. Never commits.")
    ap.add_argument("--history", help="data-history checkout; reads git history of history/<lg>.json. Omit for scores only.")
    ap.add_argument("--league", action="append", help="one league (repeatable). Default: all 7")
    ap.add_argument("--dates", help="comma-separated YYYY-MM-DD instead of season start through --through")
    ap.add_argument("--through", default=THROUGH, help="last ET date to include (default 2026-10-27)")
    ap.add_argument("--probe", action="store_true", help="print ESPN scoreboard depth and exit")
    ap.add_argument("--sleep", type=float, default=0.2, help="seconds between ESPN requests")
    a = ap.parse_args(argv)
    if a.probe:
        probe(pause=a.sleep)
        return 0
    if not a.out:
        ap.error("--out is required (use a scratch directory unless you mean to update a data-history checkout)")
    dates = [d.strip() for d in a.dates.split(",")] if a.dates else None
    backfill(Path(a.out), Path(a.history) if a.history else None, a.league, dates, a.through, pause=a.sleep)
    return 0


if __name__ == "__main__":
    sys.exit(main())
