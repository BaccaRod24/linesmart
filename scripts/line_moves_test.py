#!/usr/bin/env python3
"""Verified line-move selection. No network and no Odds API key.

Run: env -u ODDS_API_KEY python3 scripts/line_moves_test.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import line_history as LH
import line_moves as LM

ok = fail = 0


def check(c, msg):
    global ok, fail
    if c:
        ok += 1
    else:
        fail += 1
        print("FAIL:", msg)


def game(gid="1", date="2026-11-12T01:15:00Z"):
    return {"id": gid, "date": date, "away": {"abbr": "TEN", "name": "Tennessee Titans"},
            "home": {"abbr": "CIN", "name": "Cincinnati Bengals"}}


def hist(open_, points):
    return {"open": {"draftkings": dict(open_)}, "books": {"draftkings": [[f"2026-11-10T0{i}:00:00Z", p] for i, p in enumerate(points)]}}


def row(open_, points, **kw):
    g = game(**{k: kw[k] for k in ("gid", "date") if k in kw})
    return LM.row_for_game("nfl", g, hist(open_, points), "nfl/games/ten-at-cin/", "nfl/line-moves/week-11-2026/", "NFL Week 11")


# Spread of 1.0 counts. Half a point does not. Total of 1.5 counts. 1.0 does not.
base = dict(hs=-3.0, **{"as": 3.0}, hml=-150, aml=130, tot=44.0)
check(row(base, [dict(hs=-3.0, **{"as": 3.0}, tot=44.0), dict(hs=-4.0, **{"as": 4.0}, tot=44.0)])["market"] == "spread", "a 1-point spread is listed")
check(row(base, [dict(hs=-3.0, **{"as": 3.0}, tot=44.0), dict(hs=-3.5, **{"as": 3.5}, tot=44.0)]) is None, "a half-point spread is not listed")
check(row(base, [dict(hs=-3.0, **{"as": 3.0}, tot=44.0), dict(hs=-3.0, **{"as": 3.0}, tot=45.5)])["market"] == "total", "a 1.5-point total is listed")
check(row(base, [dict(hs=-3.0, **{"as": 3.0}, tot=44.0), dict(hs=-3.0, **{"as": 3.0}, tot=45.0)]) is None, "a 1-point total is not listed")

# Both markets clear: keep the larger move. A tie keeps the spread.
both = row(base, [dict(hs=-3.0, **{"as": 3.0}, tot=44.0), dict(hs=-6.0, **{"as": 6.0}, tot=46.0)])
check(both["market"] == "spread" and both["abs"] == 3.0, f"the larger move is the one row ({both})")
tie = row(base, [dict(hs=-3.0, **{"as": 3.0}, tot=44.0), dict(hs=-4.5, **{"as": 4.5}, tot=45.5)])
check(tie["market"] == "spread" and tie["abs"] == 1.5, f"an equal move keeps the spread ({tie})")

# No snapshots: doubtful, skipped. A stale ESPN open that the check replaces is listed.
check(row(dict(hs=-9.5, tot=55.5), []) is None, "an open with no snapshots is skipped")
stale = dict(hs=-9.5, **{"as": 9.5}, hml=-400, aml=320, tot=55.5)
pts = [dict(hs=3.0, **{"as": -3.0}, hml=140, aml=-165, tot=45.5), dict(hs=1.5, **{"as": -1.5}, hml=105, aml=-125, tot=44.5)]
fixed = row(stale, pts)
check(fixed and fixed["src"] == LH.OPEN_SRC_FIRST and abs(fixed["open"] - 3.0) < 0.01, f"a replaced open is the first recorded line ({fixed})")

# Rank: bigger move first, then earlier kickoff, then NFL before NBA.
rows = LM.rank_rows([
    {"abs": 1.0, "date": "2026-11-12T01:00:00Z", "lg": "nba", "gid": "b"},
    {"abs": 2.0, "date": "2026-11-13T01:00:00Z", "lg": "nfl", "gid": "a"},
    {"abs": 2.0, "date": "2026-11-12T01:00:00Z", "lg": "nba", "gid": "c"},
    {"abs": 2.0, "date": "2026-11-12T01:00:00Z", "lg": "nfl", "gid": "d"},
])
check([r["gid"] for r in rows] == ["d", "c", "a", "b"], f"rank is move, kickoff, league ({[r['gid'] for r in rows]})")

# Weekly pages need 3 verified rows. Two stay off the archive page and still merge.
fresh = {"nfl/line-moves/week-11-2026/": [
    {"gid": "1", "abs": 2, "date": "2026-11-12T01:00:00Z", "lg": "nfl", "weekPath": "nfl/line-moves/week-11-2026/"},
    {"gid": "2", "abs": 1, "date": "2026-11-13T01:00:00Z", "lg": "nfl", "weekPath": "nfl/line-moves/week-11-2026/"},
]}
stored = {"nfl/line-moves/week-10-2026/": [
    {"gid": "9", "abs": 3, "date": "2026-11-05T01:00:00Z", "lg": "nfl", "weekPath": "nfl/line-moves/week-10-2026/"},
]}
merged = LM.merge_weeks(stored, fresh, {"1", "2"})
check(set(merged) == {"nfl/line-moves/week-11-2026/", "nfl/line-moves/week-10-2026/"}, f"a game we did not see stays stored ({list(merged)})")
check("nfl/line-moves/week-11-2026/" not in LM.weeks_to_publish(merged) and "nfl/line-moves/week-10-2026/" not in LM.weeks_to_publish(merged),
      "a week with fewer than 3 moves is not a page")
merged["nfl/line-moves/week-11-2026/"].append({"gid": "3", "abs": 4, "date": "2026-11-11T01:00:00Z", "lg": "nfl", "weekPath": "nfl/line-moves/week-11-2026/"})
check(list(LM.weeks_to_publish(merged)) == ["nfl/line-moves/week-11-2026/"], "three verified moves publish the week")

# A game this run checked and rejected is not kept from the archive.
kept = LM.merge_weeks({"nfl/line-moves/week-11-2026/": [{"gid": "1", "abs": 5, "date": "2026-11-12T01:00:00Z", "lg": "nfl", "weekPath": "nfl/line-moves/week-11-2026/"}]}, {}, {"1"})
check(kept == {}, f"a rejected game leaves the week ({kept})")

week = {"number": 11, "start": "2026-11-10T05:00:00Z", "end": "2026-11-17T05:00:00Z", "games": [{"id": "1"}]}
path, label = LM.week_for("nfl", game(), week)
check(path == "nfl/line-moves/week-11-2026/" and label == "NFL Week 11", f"NFL uses the ESPN week ({path}, {label})")
nba_path, nba_label = LM.week_for("nba", {"id": "9", "date": "2026-11-12T00:00:00Z"}, None)
check(nba_path == "nba/line-moves/2026-11-09-to-11-15/", f"NBA uses the Monday-Sunday range ({nba_path}, {nba_label})")

print(f"line_moves_test: {ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
