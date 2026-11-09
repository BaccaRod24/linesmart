#!/usr/bin/env python3
"""Retry merge for rosters, matchups, weather, advanced stats, and health.

A rejected data-history push used to copy this run's snapshot over the tip
with cp -f. The tip here is newer. The snapshot is this run's older copy, plus
a record the tip does not have yet. After the merge the tip's newer records
are still there and the snapshot's new records were added.

    env -u ODDS_API_KEY python3 scripts/merge_cache_snapshot_test.py
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "merge_pages_snapshot.py"
WF = ROOT / ".github" / "workflows" / "refresh-and-deploy.yml"
os.environ.pop("ODDS_API_KEY", None)

passed = failed = 0


def check(ok, msg):
    global passed, failed
    if ok:
        passed += 1
    else:
        failed += 1
        print("FAIL", msg)


def dump(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"))


def write(path: Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(dump(obj), encoding="utf-8")


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def run_merge(src: Path, dst: Path, health=False):
    env = dict(os.environ)
    env.pop("ODDS_API_KEY", None)
    cmd = [sys.executable, str(SCRIPT), "--src", str(src), "--dst", str(dst)]
    if health:
        cmd.append("--health")
    return subprocess.run(cmd, check=False, capture_output=True, text=True, env=env)


T0 = "2026-11-09T10:00:00Z"
T1 = "2026-11-09T11:00:00Z"
T2 = "2026-11-09T12:00:00Z"

with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)

    # --- rosters: file fetchedAt is the clock; each team is a record (a player list)
    tip_roster = {
        "league": "nfl",
        "fetchedAt": T2,
        "teams": {
            "1": [["10", "Newer Player", "QB", "1", 1]],
            "2": [["20", "Tip Only", "RB", "22", 0]],
        },
    }
    snap_roster = {
        "league": "nfl",
        "fetchedAt": T1,
        "teams": {
            "1": [["10", "Older Player", "QB", "1", 0]],
            "3": [["30", "Snapshot Only", "WR", "11", 1]],
        },
        "note": "filled from this run",
    }
    src, dst = root / "rosters-snap", root / "rosters"
    write(dst / "nfl.json", tip_roster)
    write(dst / "nba.json", {"league": "nba", "fetchedAt": T2, "teams": {"9": [["9", "Stay", "C", "5", 1]]}})
    write(src / "nfl.json", snap_roster)
    write(src / "nhl.json", {"league": "nhl", "fetchedAt": T1, "teams": {"7": [["7", "Added", "D", "4", 0]]}})
    (src / "mlb.json").write_text("{not json", encoding="utf-8")
    write(dst / "mlb.json", {"league": "mlb", "fetchedAt": T2, "teams": {"8": [["8", "Kept", "P", "1", 1]]}})
    first = run_merge(src, dst)
    check(first.returncode == 0, f"roster merge exits 0 ({first.returncode} {first.stderr})")
    nfl = load(dst / "nfl.json")
    check(nfl["fetchedAt"] == T2 and nfl["teams"]["1"] == [["10", "Newer Player", "QB", "1", 1]],
          "newer roster fetchedAt is not replaced by the stale team list")
    check(nfl["teams"]["2"][0][1] == "Tip Only", "tip-only roster team stays")
    check(nfl["teams"]["3"][0][1] == "Snapshot Only", "snapshot-only roster team is added")
    check(nfl.get("note") == "filled from this run", "roster file fills a field only the snapshot has")
    check(load(dst / "nba.json")["teams"]["9"][0][1] == "Stay", "a tip roster file the snapshot lacks stays")
    check(load(dst / "nhl.json")["teams"]["7"][0][1] == "Added", "a snapshot roster file the tip lacks is added")
    check(load(dst / "mlb.json")["teams"]["8"][0][1] == "Kept", "a broken roster snapshot does not wipe the tip file")

    # snapshot fetched later: its team list wins, tip-only team still added, None slot filled when lists align
    write(src / "nfl.json", {
        "league": "nfl", "fetchedAt": "2026-11-09T13:00:00Z",
        "teams": {"1": [["10", "Freshest", "QB", None, 1]]},
    })
    write(dst / "nfl.json", nfl)
    again_roster = run_merge(src, dst)
    check(again_roster.returncode == 0, "newer snapshot roster merge exits 0")
    nfl2 = load(dst / "nfl.json")
    check(nfl2["fetchedAt"] == "2026-11-09T13:00:00Z" and nfl2["teams"]["1"][0][1] == "Freshest",
          "a newer roster fetchedAt supplies that team's list")
    check(nfl2["teams"]["1"][0][3] == "1", "an aligned empty roster slot keeps the tip's value")
    check(nfl2["teams"]["2"][0][1] == "Tip Only" and nfl2["teams"]["3"][0][1] == "Snapshot Only",
          "a newer roster file still keeps tip-only teams and earlier snapshot-only teams")

    # --- matchups: file updated is the clock; games have no per-game stamp
    tip_mu = {
        "league": "nfl", "season": 2026, "updated": T2,
        "games": {
            "A": {"d": "2026-11-01T18:00Z", "h": "1", "a": "2", "s": {"1": 24, "2": 17}, "src": "tip"},
            "B": {"d": "2026-11-02T18:00Z", "h": "3", "a": "4", "s": {"3": 10, "4": 7}},
        },
    }
    snap_mu = {
        "league": "nfl", "season": 2026, "updated": T1,
        "games": {
            "A": {"d": "2026-11-01T18:00Z", "h": "1", "a": "2", "s": {"1": 0, "2": 0}, "note": "stale"},
            "C": {"d": "2026-10-26T18:00Z", "h": "5", "a": "6", "s": {"5": 21, "6": 14}},
        },
    }
    src, dst = root / "mu-snap", root / "matchups"
    write(dst / "nfl.json", tip_mu)
    write(dst / "nba.json", {"league": "nba", "season": 2026, "updated": T2, "games": {"9": {"s": {"1": 100}}}})
    write(src / "nfl.json", snap_mu)
    write(src / "nhl.json", {"league": "nhl", "season": 2026, "updated": T1, "games": {"7": {"s": {"1": 3}}}})
    ran = run_merge(src, dst)
    check(ran.returncode == 0, f"matchup merge exits 0 ({ran.returncode} {ran.stderr})")
    mu = load(dst / "nfl.json")
    check(mu["updated"] == T2 and mu["games"]["A"]["s"]["1"] == 24 and mu["games"]["A"].get("src") == "tip",
          "newer matchup updated keeps that game's score")
    check(mu["games"]["A"].get("note") == "stale", "matchup snapshot fills a field the tip game lacks")
    check(mu["games"]["B"]["s"]["3"] == 10, "tip-only matchup game stays")
    check(mu["games"]["C"]["s"]["5"] == 21, "snapshot-only matchup game is added")
    check(load(dst / "nba.json")["games"]["9"]["s"]["1"] == 100, "a tip matchup file the snapshot lacks stays")
    check(load(dst / "nhl.json")["games"]["7"]["s"]["1"] == 3, "a snapshot matchup file the tip lacks is added")

    # snapshot file is newer, but the tip still keeps a line the snapshot never had
    write(dst / "nfl.json", {
        "league": "nfl", "season": 2026, "updated": T1,
        "games": {"A": {"s": {"1": 24}, "sp": -3.5}},
    })
    write(src / "nfl.json", {
        "league": "nfl", "season": 2026, "updated": T2,
        "games": {"A": {"s": {"1": 27}, "note": "later run"}, "D": {"s": {"1": 1}}},
    })
    check(run_merge(src, dst).returncode == 0, "newer matchup snapshot merge exits 0")
    mu2 = load(dst / "nfl.json")
    check(mu2["updated"] == T2 and mu2["games"]["A"]["s"]["1"] == 27 and mu2["games"]["A"].get("sp") == -3.5,
          "a newer matchup file supplies the score and keeps the tip's line")
    check(mu2["games"]["D"]["s"]["1"] == 1, "a game only on the newer snapshot is added")

    # no stamps: tip wins the conflict, snapshot fills the gap
    write(dst / "nfl.json", {"league": "nfl", "season": 2026, "games": {"A": {"s": {"1": 24}}}})
    write(src / "nfl.json", {"league": "nfl", "season": 2026, "games": {"A": {"s": {"1": 0}, "note": "fill"}}})
    check(run_merge(src, dst).returncode == 0, "unstamped matchup merge exits 0")
    plain = load(dst / "nfl.json")["games"]["A"]
    check(plain["s"]["1"] == 24 and plain.get("note") == "fill", "without a matchup stamp the tip score stays and the snapshot field is kept")

    # different seasons are not mixed; the higher season wins even if its clock is older
    write(dst / "nfl.json", {"league": "nfl", "season": 2026, "updated": T0, "games": {"NEW": {"s": {"1": 9}}}})
    write(src / "nfl.json", {"league": "nfl", "season": 2025, "updated": T2, "games": {"OLD": {"s": {"1": 1}}}})
    check(run_merge(src, dst).returncode == 0, "season mismatch merge exits 0")
    seasoned = load(dst / "nfl.json")
    check(seasoned["season"] == 2026 and "NEW" in seasoned["games"] and "OLD" not in seasoned["games"],
          "an older season snapshot does not replace the tip's season or its games")

    # --- weather: forecasts use per-game fetchedAt; venues use the file updated
    src, dst = root / "wx-snap", root / "weather"
    write(dst / "forecasts.json", {
        "updated": T1,
        "games": {
            "A": {"kick": "2026-11-09T18:00:00Z", "lat": 25.7, "lon": -80.2, "fetchedAt": T2, "rows": [{"t": 1, "temp": 70}]},
            "B": {"kick": "2026-11-09T21:00:00Z", "lat": 40.0, "lon": -74.0, "fetchedAt": T0, "rows": [{"t": 1, "temp": 50}]},
            "C": {"kick": "2026-11-10T18:00:00Z", "fetchedAt": T1, "rows": [{"t": 1, "temp": 60}], "place": "tip"},
        },
    })
    write(src / "forecasts.json", {
        "updated": T2,
        "games": {
            "A": {"kick": "2026-11-09T18:00:00Z", "lat": 25.7, "lon": -80.2, "fetchedAt": T0, "rows": [{"t": 1, "temp": 40}], "note": "stale forecast"},
            "B": {"kick": "2026-11-09T21:00:00Z", "lat": 40.0, "lon": -74.0, "fetchedAt": T2, "rows": [{"t": 1, "temp": 55}]},
            "D": {"kick": "2026-11-11T18:00:00Z", "fetchedAt": T2, "rows": [{"t": 1, "temp": 48}]},
        },
    })
    write(dst / "venues.json", {
        "updated": T2,
        "venues": {
            "1": {"lat": 25.76, "lon": -80.19, "name": "Hard Rock Stadium"},
            "2": {"lat": 39.9, "lon": -75.1, "name": "Tip Venue"},
        },
    })
    write(src / "venues.json", {
        "updated": T1,
        "venues": {
            "1": {"lat": 0, "lon": 0, "name": "Stale", "tz": "America/New_York"},
            "3": {"lat": 41.8, "lon": -87.6, "name": "Snapshot Venue"},
        },
    })
    wx = run_merge(src, dst)
    check(wx.returncode == 0, f"weather merge exits 0 ({wx.returncode} {wx.stderr})")
    fc = load(dst / "forecasts.json")
    check(fc["games"]["A"]["fetchedAt"] == T2 and fc["games"]["A"]["rows"][0]["temp"] == 70,
          "a later forecast file does not replace a game whose fetchedAt is newer")
    check(fc["games"]["A"].get("note") == "stale forecast", "forecast snapshot fills a field the newer game lacks")
    check(fc["games"]["B"]["fetchedAt"] == T2 and fc["games"]["B"]["rows"][0]["temp"] == 55,
          "a game whose snapshot fetchedAt is newer supplies that forecast")
    check(fc["games"]["C"]["place"] == "tip", "tip-only forecast stays")
    check(fc["games"]["D"]["rows"][0]["temp"] == 48, "snapshot-only forecast is added")
    check(fc["updated"] == T2, "the newer forecast-file updated is kept")
    venues = load(dst / "venues.json")
    check(venues["updated"] == T2 and venues["venues"]["1"]["lat"] == 25.76 and venues["venues"]["1"]["name"] == "Hard Rock Stadium",
          "newer venue updated keeps that venue's coordinates")
    check(venues["venues"]["1"].get("tz") == "America/New_York", "venue snapshot fills a field the tip venue lacks")
    check(venues["venues"]["2"]["name"] == "Tip Venue", "tip-only venue stays")
    check(venues["venues"]["3"]["name"] == "Snapshot Venue", "snapshot-only venue is added")

    # venue stamps tie: tip coordinates stay
    write(dst / "venues.json", {"updated": T1, "venues": {"1": {"lat": 1, "lon": 2, "name": "Tip"}}})
    write(src / "venues.json", {"updated": T1, "venues": {"1": {"lat": 9, "lon": 9, "name": "Snap"}, "4": {"lat": 3, "name": "Added"}}})
    check(run_merge(src, dst).returncode == 0, "tied venue merge exits 0")
    tied = load(dst / "venues.json")["venues"]
    check(tied["1"]["lat"] == 1 and tied["1"]["name"] == "Tip" and tied["4"]["name"] == "Added",
          "tied venue updated keeps the tip venue and adds the snapshot venue")

    # --- advanced stats: ATS updated per file; nflverse fetched; sched/weeks union; scanned is its own clock
    src, dst = root / "adv-snap", root / "adv"
    write(dst / "ats_nfl.json", {
        "v": 1, "league": "nfl", "season": 2026, "updated": T2, "scanned": T0,
        "sched": ["A", "B"],
        "games": {
            "A": {"d": T0, "h": "1", "a": "2", "hs": 24, "as": 17, "sp": -3.5, "src": "tip"},
            "B": {"d": T0, "h": "3", "a": "4", "hs": 10, "as": 7},
        },
    })
    write(src / "ats_nfl.json", {
        "v": 1, "league": "nfl", "season": 2026, "updated": T1, "scanned": T2,
        "sched": ["A", "C"],
        "games": {
            "A": {"d": T0, "h": "1", "a": "2", "hs": 0, "as": 0, "sp": -7, "tot": 47.5, "src": "stale"},
            "C": {"d": T0, "h": "5", "a": "6", "hs": 21, "as": 14, "sp": 3},
        },
    })
    write(dst / "nfl_nflverse.json", {
        "season": 2026, "fetched": T2, "weeks": [1, 2], "qualQB": 100,
        "teams": {"KC": {"epa": 0.2}, "BUF": {"epa": 0.1}},
        "qbs": {"p1": {"db": 40}},
        "usage": {},
        "pmap": {"p1": ["10", "Patrick Mahomes", "QB"]},
        "lines": {"A": [-3.5, None, 24, 17], "B": [-1.5, 44.5, 10, 7]},
    })
    write(src / "nfl_nflverse.json", {
        "season": 2026, "fetched": T1, "weeks": [2, 3], "qualQB": 90,
        "teams": {"KC": {"epa": -1, "note": "old"}, "DAL": {"epa": 0.05}},
        "qbs": {"p9": {"db": 10}},
        "usage": {"p9": {"tgt": 0.2}},
        "pmap": {"p9": ["90", "Other", "WR"]},
        "lines": {"A": [-7, 47.5, 0, 0], "C": [3, 41, 21, 14]},
    })
    write(dst / "ats_nba.json", {"v": 1, "league": "nba", "season": 2026, "updated": T2, "games": {"9": {"hs": 110}}})
    adv = run_merge(src, dst)
    check(adv.returncode == 0, f"adv merge exits 0 ({adv.returncode} {adv.stderr})")
    ats = load(dst / "ats_nfl.json")
    check(ats["updated"] == T2 and ats["games"]["A"]["sp"] == -3.5 and ats["games"]["A"]["hs"] == 24 and ats["games"]["A"]["src"] == "tip",
          "newer ATS updated keeps that game's closing line and score")
    check(ats["games"]["A"].get("tot") == 47.5, "ATS snapshot fills a total the tip game lacks")
    check(ats["games"]["B"]["hs"] == 10, "tip-only ATS game stays")
    check(ats["games"]["C"]["sp"] == 3, "snapshot-only ATS game is added")
    check(ats["sched"] == ["A", "B", "C"], "ATS sched keeps tip order and adds snapshot-only ids")
    check(ats["scanned"] == T2, "a newer schedule scan is kept when the game file clock is older")
    check(load(dst / "ats_nba.json")["games"]["9"]["hs"] == 110, "a tip ATS file the snapshot lacks stays")
    nv = load(dst / "nfl_nflverse.json")
    check(nv["fetched"] == T2 and nv["teams"]["KC"]["epa"] == 0.2 and nv["teams"]["KC"].get("note") == "old",
          "newer nflverse fetched keeps the team and fills a field the snapshot has")
    check(nv["teams"]["BUF"]["epa"] == 0.1 and nv["teams"]["DAL"]["epa"] == 0.05, "tip-only and snapshot-only nflverse teams both stay")
    check(nv["qbs"]["p1"]["db"] == 40 and nv["qbs"]["p9"]["db"] == 10, "tip-only and snapshot-only QBs both stay")
    check(nv["usage"]["p9"]["tgt"] == 0.2 and nv["pmap"]["p9"][1] == "Other", "snapshot-only usage and pmap rows are added")
    check(nv["lines"]["A"] == [-3.5, 47.5, 24, 17], "a newer nflverse line keeps its numbers and fills a missing total")
    check(nv["lines"]["B"][0] == -1.5 and nv["lines"]["C"][0] == 3, "tip-only and snapshot-only nflverse lines both stay")
    check(nv["weeks"] == [1, 2, 3], "nflverse weeks keep tip order and add the snapshot week")
    check(nv["qualQB"] == 100, "newer nflverse fetched keeps qualQB")

    # newer snapshot ATS file must not drop a line that exists only on the tip
    write(dst / "ats_nfl.json", {
        "v": 1, "league": "nfl", "season": 2026, "updated": T1, "sched": ["A"],
        "games": {"A": {"hs": 24, "as": 17, "sp": -3.5}},
    })
    write(src / "ats_nfl.json", {
        "v": 1, "league": "nfl", "season": 2026, "updated": T2, "sched": ["A", "Z"],
        "games": {"A": {"hs": 27, "as": 20}, "Z": {"hs": 1, "as": 0}},
    })
    check(run_merge(src, dst).returncode == 0, "newer ATS snapshot merge exits 0")
    ats2 = load(dst / "ats_nfl.json")
    check(ats2["games"]["A"]["hs"] == 27 and ats2["games"]["A"]["sp"] == -3.5 and ats2["games"]["Z"]["hs"] == 1,
          "a newer ATS file supplies the score, keeps the tip line, and adds its own game")
    check(ats2["sched"] == ["A", "Z"], "sched still unions when the snapshot file is newer")

    # --- health log: one file per runId; findings deduped, tip order, cap 80
    src, dst = root / "reliability.json", root / "health"
    write(dst / "111.json", {
        "v": 1, "runId": "111", "at": T2, "generated": T2,
        "counts": {"findings": 1, "errors": 0},
        "findings": [{"level": "warn", "code": "kept_last_good", "detail": "tip"}],
        "level": "full",
    })
    write(dst / "222.json", {
        "v": 1, "runId": "222", "at": T2, "generated": T2, "counts": {"findings": 0}, "findings": [],
    })
    write(dst / "reliability.json", {
        "v": 1, "runId": "444", "at": T2, "generated": T2, "counts": {"findings": 0}, "findings": [],
        "who": "previous retry",
    })
    (dst / "broken.json").write_text("{not json", encoding="utf-8")
    write(dst / "notes.json", ["not", "a", "run"])
    write(src, {
        "v": 1, "runId": "111", "at": T1, "generated": T1,
        "counts": {"findings": 9, "errors": 4},
        "findings": [
            {"level": "warn", "code": "kept_last_good", "detail": "tip"},
            {"level": "warn", "code": "stale_league", "detail": "from this run"},
        ],
        "level": "stop",
        "note": "filled by this run",
    })
    health = run_merge(src, dst, health=True)
    check(health.returncode == 0, f"health merge exits 0 ({health.returncode} {health.stderr})")
    h111 = load(dst / "111.json")
    check(h111["at"] == T2 and h111["counts"]["findings"] == 1 and h111["level"] == "full",
          "a newer health at is not replaced by the stale snapshot")
    check(h111.get("note") == "filled by this run", "health snapshot fills a field the tip run lacks")
    check([f["code"] for f in h111["findings"]] == ["kept_last_good", "stale_league"],
          "health findings keep tip order and append a snapshot finding once")
    check(load(dst / "222.json")["runId"] == "222", "tip-only health run stays")
    check(load(dst / "reliability.json")["runId"] == "444" and load(dst / "reliability.json")["who"] == "previous retry",
          "reliability.json for a different run is not replaced")
    check((dst / "broken.json").read_text(encoding="utf-8") == "{not json", "an unreadable health file is not overwritten")
    check(load(dst / "notes.json") == ["not", "a", "run"], "a non-record health file is left untouched")

    # this run is new, and a second copy of run 111 on reliability.json folds in
    write(src, {
        "v": 1, "runId": "333", "at": T2, "generated": T2,
        "counts": {"findings": 0}, "findings": [{"level": "warn", "code": "new_run"}],
    })
    added = run_merge(src, dst, health=True)
    check(added.returncode == 0 and "333.json: added from snapshot" in added.stdout, "a new health run is added")
    check(load(dst / "333.json")["runId"] == "333" and load(dst / "222.json")["runId"] == "222",
          "adding a run does not drop the other runs")

    # same run stored only as reliability.json: merge in place, do not clobber it with a different run
    write(dst / "reliability.json", {
        "v": 1, "runId": "555", "at": T2, "generated": T2,
        "counts": {"errors": 0}, "findings": [{"level": "error", "code": "pull_rejected"}],
    })
    write(src, {
        "v": 1, "runId": "555", "at": T1, "generated": T1,
        "counts": {"errors": 5}, "findings": [{"level": "warn", "code": "kept_last_good"}],
        "checkedAt": T0,
    })
    folded = run_merge(src, dst, health=True)
    check(folded.returncode == 0, "reliability.json same-run merge exits 0")
    rel = load(dst / "reliability.json")
    check(rel["runId"] == "555" and rel["at"] == T2 and rel["counts"]["errors"] == 0,
          "reliability.json keeps the newer run instead of the stale snapshot")
    check(rel.get("checkedAt") == T0, "reliability.json fills a field only the snapshot has")
    check([f["code"] for f in rel["findings"]] == ["pull_rejected", "kept_last_good"],
          "reliability.json findings dedupe and keep tip order")
    check(not (dst / "555.json").exists(), "an existing reliability.json for that run is updated in place")

    # both names for one run end up as the same merged record
    write(dst / "555.json", {
        "v": 1, "runId": "555", "at": T2, "generated": T2, "counts": {"errors": 1},
        "findings": [{"level": "error", "code": "duplicate_game"}], "extra": "from the writer path",
    })
    write(dst / "reliability.json", {
        "v": 1, "runId": "555", "at": T1, "generated": T1, "counts": {"errors": 0},
        "findings": [{"level": "warn", "code": "incomplete_book"}],
    })
    write(src, {
        "v": 1, "runId": "555", "at": T0, "generated": T0, "counts": {"errors": 9},
        "findings": [{"level": "warn", "code": "stale_league"}], "note": "snap",
    })
    check(run_merge(src, dst, health=True).returncode == 0, "duplicate health filenames merge exits 0")
    a, b = load(dst / "555.json"), load(dst / "reliability.json")
    check(a == b and a["counts"]["errors"] == 1 and a.get("extra") == "from the writer path" and a.get("note") == "snap",
          "two files for one run fold together; the newer stamp wins and both copies match")
    check([f["code"] for f in a["findings"]] == ["duplicate_game", "incomplete_book", "stale_league"],
          "findings from both tip files and the snapshot stay, in tip order")

    # cap: a full tip list does not lose an entry to make room; a longer tip list keeps its tail
    full = [{"level": "warn", "code": f"f{i}"} for i in range(80)]
    write(dst / "777.json", {"v": 1, "runId": "777", "at": T2, "generated": T2, "findings": full})
    write(src, {"v": 1, "runId": "777", "at": T1, "generated": T1, "findings": [{"level": "warn", "code": "extra"}]})
    check(run_merge(src, dst, health=True).returncode == 0, "findings cap merge exits 0")
    capped = load(dst / "777.json")["findings"]
    check(len(capped) == 80 and capped[0]["code"] == "f0" and capped[-1]["code"] == "f79" and all(f["code"] != "extra" for f in capped),
          "findings stay capped at 80 and a full tip list is not evicted")
    long = [{"level": "warn", "code": f"f{i}"} for i in range(81)]
    write(dst / "777.json", {"v": 1, "runId": "777", "at": T2, "generated": T2, "findings": long})
    check(run_merge(src, dst, health=True).returncode == 0, "over-cap findings merge exits 0")
    tailed = [f["code"] for f in load(dst / "777.json")["findings"]]
    check(len(tailed) == 80 and tailed[0] == "f1" and tailed[-1] == "f80",
          "a tip findings list past 80 keeps its tail, same as the writer")

    # missing stamps: tip wins, snapshot fills
    write(dst / "888.json", {"v": 1, "runId": "888", "counts": {"errors": 1}})
    write(src, {"v": 1, "runId": "888", "counts": {"errors": 9}, "note": "only snap"})
    check(run_merge(src, dst, health=True).returncode == 0, "unstamped health merge exits 0")
    plain_h = load(dst / "888.json")
    check(plain_h["counts"]["errors"] == 1 and plain_h.get("note") == "only snap",
          "without health stamps the tip counts stay and the snapshot field is kept")

    # snapshot run is newer than the tip copy
    write(dst / "888.json", {"v": 1, "runId": "888", "at": T1, "generated": T1, "counts": {"errors": 1}, "kept": "tip"})
    write(src, {"v": 1, "runId": "888", "at": T2, "generated": T2, "counts": {"errors": 2}})
    check(run_merge(src, dst, health=True).returncode == 0, "newer health snapshot merge exits 0")
    newer_h = load(dst / "888.json")
    check(newer_h["at"] == T2 and newer_h["counts"]["errors"] == 2 and newer_h.get("kept") == "tip",
          "a newer health snapshot supplies the counts and keeps a tip-only field")

    second = run_merge(src, dst, health=True)
    check(second.returncode == 0 and "unchanged" in second.stdout, "a second health merge does not rewrite settled files")
    check(load(dst / "888.json") == newer_h, "merging the health record again leaves it the same")

src_text = SCRIPT.read_text(encoding="utf-8")
check("the-odds-api" not in src_text and "ODDS_API" not in src_text and "urlopen" not in src_text,
      "the merge script does not call the Odds API")
check("FINDINGS_CAP = 80" in src_text, "health findings use the writer's cap of 80")

wf = WF.read_text(encoding="utf-8")
step = wf.split("Save line history snapshot", 1)[1].split("\n      - name:", 1)[0]
check("git reset -q --hard origin/data-history" in step, "retry re-fetches the tip before merging")
check("cp -f" not in step, "retry does not copy a stale snapshot over the tip")
for flag, label in (
    ("--src ../.linehist-snap/_rosters --dst rosters", "rosters"),
    ("--src ../.linehist-snap/_matchups --dst matchups", "matchups"),
    ("--src ../.linehist-snap/_weather --dst weather", "weather"),
    ("--src ../.linehist-snap/_adv --dst advstats", "advanced stats"),
    ("--src ../.linehist-snap/_pages --dst pages", "pages"),
    ("--health --src ../.linehist-snap/reliability.json --dst health", "health"),
):
    check(f"merge_pages_snapshot.py {flag}" in step, f"retry merges the {label} snapshot onto the tip")
reset_at = step.find("git reset -q --hard origin/data-history")
order = [step.find(token) for token in (
    "--dst rosters", "--dst matchups", "--dst weather", "--dst advstats", "--dst pages", "--dst health",
)]
add_at = step.find("git add -A", max(order))
check(reset_at != -1 and order[0] > reset_at and order == sorted(order) and add_at > order[-1],
      "cache merges run after the tip reset and before the new commit")
pushes = [line.strip() for line in step.splitlines() if "git push" in line]
check(pushes and all("--force" not in line and "force-with-lease" not in line and " -f" not in line for line in pushes),
      f"data-history push is not a force push ({pushes})")

print(f"{'PASS' if not failed else 'FAIL'} merge_cache_snapshot: {passed}/{passed + failed}")
sys.exit(1 if failed else 0)
