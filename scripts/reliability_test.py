#!/usr/bin/env python3
"""reliability.py: freshness, broken pulls, last-good clocks. No network."""
import datetime as dt
import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import reliability as R

passed = failed = 0


def check(ok, msg):
    global passed, failed
    if ok:
        passed += 1
    else:
        failed += 1
        print("FAIL:", msg)


NOW = dt.datetime(2026, 11, 9, 4, 0, tzinfo=dt.timezone.utc)


def iso(minutes_ago):
    return (NOW - dt.timedelta(minutes=minutes_ago)).strftime("%Y-%m-%dT%H:%M:%SZ")


def game(gid, home="BUF", away="KC", hid="2", aid="12"):
    return {"id": gid, "date": "2026-11-09T18:00:00Z", "state": "pre",
            "home": {"id": hid, "abbr": home, "name": home}, "away": {"id": aid, "abbr": away, "name": away}}


def line(ml=-150, spread=-3.5, total=47.5):
    return {"homeML": ml, "awayML": 130, "homeSpread": spread, "awaySpread": -spread if spread is not None else None,
            "homeSpreadOdds": -110, "awaySpreadOdds": -110, "total": total, "overOdds": -110, "underOdds": -110}


def rec(home, away, books):
    return {"date": "2026-11-09T18:00:00Z", "home": home, "away": away, "lines": books}


check(R.stale_after_min(30) == 90, "30 min cadence is stale after 90 min")
check(R.stale_after_min(120) == 360, "slowed cadence uses 3x the interval")
check(R.american_ok(-110) and R.american_ok(150) and not R.american_ok(50) and not R.american_ok(0) and not R.american_ok(25000),
      "American odds outside ±100..20000 are invalid")

cleaned, problems = R.line_sane({"homeML": -110, "awayML": 130, "homeSpread": 80, "total": 47.5, "overOdds": -110, "underOdds": -110}, "football")
check(cleaned and cleaned.get("homeSpread") is None and cleaned.get("homeML") == -110 and any("homeSpread" in p for p in problems),
      "a 80-point football spread is removed and the moneyline stays")
gone, _ = R.line_sane({"homeML": 40, "awayML": 40}, "football")
check(gone is None, "a line with only impossible prices is dropped")

prev = {"pulledAt": iso(120), "games": {
    "1": rec("KC", "BUF", {"hardrockbet": line(-150), "fanduel": line(-152), "draftkings": line(-148)}),
    "2": rec("DAL", "PHI", {"hardrockbet": line(-130), "fanduel": line(-128), "draftkings": line(-125)}),
    "3": rec("NYJ", "NE", {"hardrockbet": line(110), "fanduel": line(105), "draftkings": line(108)}),
}}
moved = {"pulledAt": iso(5), "matched": 3, "events": 3, "games": {
    "1": rec("KC", "BUF", {"hardrockbet": line(-160), "fanduel": line(-155), "draftkings": line(-158)}),
    "2": rec("DAL", "PHI", {"hardrockbet": line(-140), "fanduel": line(-138), "draftkings": line(-136)}),
    "3": rec("NYJ", "NE", {"hardrockbet": line(120), "fanduel": line(115), "draftkings": line(118)}),
}}
stored, findings = R.screen_pull(prev, moved, "football")
check(stored and stored["games"]["1"]["lines"]["hardrockbet"]["homeML"] == -160
      and stored["games"]["1"]["lines"]["hardrockbet"]["asOf"] == iso(5) and not findings,
      "same teams and a new price is a real move, stamped with the new pull")

bad_price = {"pulledAt": iso(5), "matched": 1, "events": 1, "games": {
    "1": rec("KC", "BUF", {"hardrockbet": {"homeML": 40, "awayML": 40}, "fanduel": line(-155), "draftkings": line(-148)}),
}}
stored, findings = R.screen_pull(prev, bad_price, "football")
kept = stored["games"]["1"]["lines"]["hardrockbet"]
check(kept["homeML"] == -150 and kept["asOf"] == iso(120) and any(f["code"] == "kept_last_good" for f in findings),
      "invalid Hard Rock prices keep the previous line and its pull time")
check(stored["games"]["1"]["lines"]["fanduel"]["asOf"] == iso(5), "a valid book on the same game gets the new pull time")

swapped = {"pulledAt": iso(5), "matched": 3, "events": 3, "games": {
    "1": rec("BUF", "KC", {"hardrockbet": line(150)}),
    "2": rec("PHI", "DAL", {"hardrockbet": line(130)}),
    "3": rec("NE", "NYJ", {"hardrockbet": line(-110)}),
}}
stored, findings = R.screen_pull(prev, swapped, "football")
check(stored is None and any(f["code"] == "pull_rejected" for f in findings),
      "teams flipped on most of the pull: keep the previous pull whole")

one_bad = {"pulledAt": iso(5), "matched": 3, "events": 3, "games": {
    "1": rec("BUF", "KC", {"hardrockbet": line(150), "fanduel": line(150), "draftkings": line(150)}),
    "2": rec("DAL", "PHI", {"hardrockbet": line(-140), "fanduel": line(-138), "draftkings": line(-136)}),
    "3": rec("NYJ", "NE", {"hardrockbet": line(120), "fanduel": line(115), "draftkings": line(118)}),
}}
stored, findings = R.screen_pull(prev, one_bad, "football")
check(stored["games"]["1"]["lines"]["hardrockbet"]["asOf"] == iso(120)
      and stored["games"]["2"]["lines"]["hardrockbet"]["asOf"] == iso(5)
      and any(f["code"] == "team_mismatch" and f["game"] == "1" for f in findings),
      "one mismatched game keeps its old lines; the others update")

missing_book = {"pulledAt": iso(5), "matched": 3, "events": 3, "games": {
    "1": rec("KC", "BUF", {"hardrockbet": line(-160), "draftkings": line(-158)}),
    "2": rec("DAL", "PHI", {"hardrockbet": line(-140), "draftkings": line(-136)}),
    "3": rec("NYJ", "NE", {"hardrockbet": line(120), "draftkings": line(118)}),
}}
stored, findings = R.screen_pull(prev, missing_book, "football")
fd = stored["games"]["2"]["lines"]["fanduel"]
check(fd["homeML"] == -128 and fd["asOf"] == iso(120) and any(f["code"] == "incomplete_book" and f["book"] == "fanduel" for f in findings),
      "a book that vanished keeps its previous lines and pull time")

empty_league = {"pulledAt": iso(4000), "matched": 0, "events": 0, "games": {}}
stored, findings = R.screen_pull(empty_league, {"pulledAt": iso(5), "matched": 0, "events": 0, "games": {}}, "football")
check(stored is not None and not any(f["code"] == "incomplete_book" for f in findings),
      "a league that never had this book is not an incomplete feed")

kept_games, gfindings = R.clean_games([
    game("1"),
    game("1", "DAL", "PHI", "6", "21"),
    {"id": "9", "home": {"id": "1", "abbr": "A"}, "away": {"id": "1", "abbr": "A"}},
    {"id": "8", "home": {"abbr": "X"}, "away": {}},
])
check([g["id"] for g in kept_games] == ["1"] and any(f["code"] == "duplicate_game" for f in gfindings)
      and any(f["code"] == "invalid_game" for f in gfindings),
      "duplicate id keeps the first game; a teamless game is left out")

def meta(upcoming, pulled_min, active, interval=30, level="full"):
    return {
        "oddsApi": {"gameInterval": interval, "level": level, "checkedAt": iso(pulled_min)},
        "hardrock": {"leagues": {"nfl": iso(pulled_min), "mlb": iso(5000)}},
        "leagues": {"nfl": {"upcoming": upcoming}, "mlb": {"upcoming": 0}},
    }

fresh = R.assess(meta(14, 20, {"nfl": 14, "mlb": 0}), {"nfl": 14, "mlb": 0}, NOW)
check(fresh["staleAfterMin"] == 90 and fresh["leagues"]["nfl"]["stale"] is False and fresh["leagues"]["mlb"]["stale"] is False,
      "a 20 min pull is fresh, and an off-season league is not an outage")
old = R.assess(meta(14, 120, {"nfl": 14, "mlb": 0}), {"nfl": 14, "mlb": 0}, NOW)
check(old["leagues"]["nfl"]["stale"] is True and old["leagues"]["mlb"]["stale"] is False,
      "120 min with games in the window is stale; MLB with no games is not")
quiet = R.assess(meta(8, 4000, {"nfl": 0}), {"nfl": 0}, NOW)
check(quiet["leagues"]["nfl"]["stale"] is False and quiet["leagues"]["nfl"]["inWindow"] is False,
      "upcoming games outside the 7-day odds window are not an outage")

blob = meta(14, 120, {"nfl": 14})
blob["freshness"] = old
blob["generated"] = iso(1)
with tempfile.TemporaryDirectory() as d:
    path = os.path.join(d, "meta.json")
    json.dump(blob, open(path, "w"))
    code = R.check_meta(path, fail_if_stale=True, now=NOW)
    check(code == 1, "an in-window stale publish fails the check")
    blob["oddsApi"]["level"] = "stop"
    blob["freshness"]["level"] = "stop"
    json.dump(blob, open(path, "w"))
    code = R.check_meta(path, fail_if_stale=True, now=NOW)
    check(code == 0, "a budget stop records stale lines and does not fail the run")

root = Path(__file__).resolve().parent.parent
ui = (root / "site/assets/app.js").read_text(encoding="utf-8")
css = (root / "site/assets/styles.css").read_text(encoding="utf-8")
check("Odds are stale." in ui and "src-stale" in ui and "not a live board" in ui, "the odds view says when a pull is stale and that it is not a live board")
check(".books .src-stale" in css and "font-size:12px" in css, "the stale label stays 12px on a phone")

record = R.health_record({"generated": iso(1), "oddsApi": {"checkedAt": iso(20)}, "freshness": old}, findings, NOW, "99")
check(record["counts"]["staleLeagues"] == 1 and "sportsbook" in record["notVerified"] and record["runId"] == "99",
      "the run record counts stale leagues and says prices are not board-verified")

print(f"\n{passed} passed, {failed} failed" if failed else f"\nall {passed} reliability checks passed")
sys.exit(1 if failed else 0)
