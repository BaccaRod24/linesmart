#!/usr/bin/env python3
"""backfill_results.py: ESPN scoreboard -> archive records, closing lines from a local git history. No network."""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
os.environ.pop("ODDS_API_KEY", None)
import backfill_results as BF  # noqa: E402

passed = failed = 0


def check(ok, msg):
    global passed, failed
    if ok:
        passed += 1
    else:
        failed += 1
        print("FAIL", msg)


def event(eid, date, away, home, hs, aws, detail="Final"):
    def comp(tid, name, abbr, score, winner, home_away):
        return {"homeAway": home_away, "score": str(score), "winner": winner,
                "team": {"id": tid, "abbreviation": abbr, "displayName": name, "shortDisplayName": name.split()[-1]}}
    return {"id": eid, "date": date, "name": f"{away[1]} at {home[1]}", "shortName": f"{away[2]} @ {home[2]}",
            "status": {"type": {"state": "post", "completed": True, "name": "STATUS_FINAL", "shortDetail": detail, "detail": detail}, "period": 4},
            "competitions": [{"competitors": [comp(*home, hs, hs > aws, "home"), comp(*away, aws, aws > hs, "away")],
                              "venue": {"fullName": "Test Arena", "address": {"city": "Boston", "state": "MA"}},
                              "odds": []}]}


# (id, name, abbr)
BOS = ("2", "Boston Celtics", "BOS")
DET = ("8", "Detroit Pistons", "DET")
NY = ("18", "New York Knicks", "NY")
SB = {"events": [
    event("401", "2026-10-26T23:30:00Z", BOS, DET, 121, 113),   # on/after the history window
    event("402", "2026-10-20T23:00:00Z", NY, BOS, 100, 110),    # before 2026-10-26: score only
]}


def fake_fetch(url):
    if "the-odds-api" in url or "api.the-odds-api" in url:
        raise AssertionError("backfill tried to call The Odds API")
    if "dates=20261026" in url:
        return {"events": [SB["events"][0]]}
    if "dates=20261020" in url:
        return {"events": [SB["events"][1]]}
    raise AssertionError("unexpected URL " + url)


def main():
    src = Path(BF.__file__).read_text()
    check("the-odds-api.com" not in src and "api.the-odds-api" not in src, "backfill never calls The Odds API")
    import tempfile
    tmp = Path(tempfile.mkdtemp(prefix="backfill-"))
    repo = tmp / "hist"
    repo.mkdir()
    subprocess.check_call(["git", "init", "-q"], cwd=repo)
    subprocess.check_call(["git", "-C", str(repo), "config", "user.email", "test@example.com"])
    subprocess.check_call(["git", "-C", str(repo), "config", "user.name", "test"])
    hist = repo / "history"
    hist.mkdir()
    point = {"hs": -6.5, "as": 6.5, "hml": -240, "aml": 198, "tot": 224.5, "ov": -110, "un": -110}
    (hist / "nba.json").write_text(json.dumps({"v": 1, "league": "nba", "games": {
        "401": {"date": "2026-10-26T23:30:00Z", "home": "DET", "away": "BOS",
                "books": {"draftkings": [["2026-10-26T18:00:00Z", point], ["2026-10-27T01:00:00Z", {"hs": -99}]]}},
        "402": {"date": "2026-10-20T23:00:00Z", "books": {"draftkings": [["2026-10-20T18:00:00Z", point]]}}}}))
    env = {**os.environ, "GIT_AUTHOR_DATE": "2026-10-26T18:00:00Z", "GIT_COMMITTER_DATE": "2026-10-26T18:00:00Z"}
    subprocess.check_call(["git", "-C", str(repo), "add", "history/nba.json"], env=env)
    subprocess.check_call(["git", "-C", str(repo), "commit", "-qm", "snapshot"], env=env)
    out = tmp / "pages"
    # an existing final with closing lines must be left alone
    out.mkdir()
    (out / "games-nba.json").write_text(json.dumps({"999": {"id": "999", "state": "post", "closing": {"books": {"draftkings": {"homeML": -110}}}}}))
    stats = BF.backfill(out, repo, ["nba"], ["2026-10-20", "2026-10-26"], fetch=fake_fetch, pause=0)
    saved = json.loads((out / "games-nba.json").read_text())
    check(saved["999"]["closing"]["books"]["draftkings"]["homeML"] == -110, "existing closing lines are not overwritten")
    g = saved.get("401") or {}
    check(g.get("state") == "post" and g.get("home", {}).get("name") == "Detroit Pistons", f"Oct 26 final stored ({g.get('home')})")
    check(isinstance(g.get("closing"), dict) and g["closing"]["books"]["draftkings"]["homeSpread"] == -6.5, "closing line is the last point before the start")
    check(g["closing"]["closedAt"] == "2026-10-26T18:00:00Z", "closedAt is that point's timestamp, not the in-game point")
    early = saved.get("402") or {}
    check(early.get("closing") is None, "a game before 2026-10-26 is closing: null even if history has a point")
    check(stats["nba"]["added"] == 2 and stats["nba"]["no_closing"] == 1 and stats["nba"]["closing"] == 1 and "999" in saved, f"stats ({stats['nba']})")
    # second run fills closing onto a row that had none, and does not duplicate
    early["closing"] = None
    saved["402"] = early
    (out / "games-nba.json").write_text(json.dumps(saved))
    # drop the Oct 20 game so the merge sees it as already closed and keeps it
    stats2 = BF.backfill(out, repo, ["nba"], ["2026-10-26"], fetch=fake_fetch, pause=0)
    saved2 = json.loads((out / "games-nba.json").read_text())
    check(saved2["401"]["closing"]["books"]["draftkings"]["homeSpread"] == -6.5 and stats2["nba"]["kept"] >= 1, "second run keeps the closing line")
    print(f"{'PASS' if not failed else 'FAIL'} backfill_results: {passed}/{passed + failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
