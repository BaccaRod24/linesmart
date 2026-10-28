"""Regression test: two games between the same teams on different dates (a playoff series) must each keep their own
final score and grade. Reproduces the Oct 27 2026 World Series bug: Game 4 (Rays 4, Brewers 3 in 12, total 7.5 -> UNDER)
was archived with Game 3's 10-1 score (graded OVER) because the final was matched by opponent within +-36h.
Offline, no API key. Usage: python3 scripts/series_results_test.py
"""
import json
import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
os.environ.pop("ODDS_API_KEY", None)
import seo_pages as SP  # noqa: E402

passed = failed = 0


def check(ok, msg):
    global passed, failed
    if ok:
        passed += 1
    else:
        failed += 1
        print("FAIL", msg)


MIL = {"id": "8", "abbr": "MIL", "name": "Milwaukee Brewers", "short": "Brewers"}
TB = {"id": "30", "abbr": "TB", "name": "Tampa Bay Rays", "short": "Rays"}
G3, G4 = "401908044", "401908045"
D3, D4 = "2026-10-27T00:00Z", "2026-10-28T00:00Z"   # Oct 26 and Oct 27, 8 PM ET
CLOSE = {"books": {"draftkings": {"homeML": -120, "awayML": 100, "total": 7.5, "overOdds": -110, "underOdds": -110}}}


def game(gid, date, state, hs=0, as_=0, closing=None):
    g = {"id": gid, "date": date, "state": state, "statusDetail": "Final" if state == "post" else "Bot 12th",
         "completed": state == "post", "home": dict(TB, score=hs), "away": dict(MIL, score=as_)}
    if closing:
        g["closing"] = closing
    return g


def recent(with_ids=True):
    """ESPN team-schedule rows (latest first), as build_data.team_splits writes them."""
    tb = [dict(id=G4, date=D4, res="W", pf=4.0, pa=3.0, home=True, opp="MIL"),
          dict(id=G3, date=D3, res="L", pf=1.0, pa=10.0, home=True, opp="MIL")]
    mil = [dict(id=G4, date=D4, res="L", pf=3.0, pa=4.0, home=False, opp="TB"),
           dict(id=G3, date=D3, res="W", pf=10.0, pa=1.0, home=False, opp="TB")]
    if not with_ids:
        for r in tb + mil:
            r.pop("id")
    return {"30": {"recent": tb}, "8": {"recent": mil}}


def teams_only_g3(with_ids=True):
    t = recent(with_ids)
    return {k: {"recent": v["recent"][1:]} for k, v in t.items()}   # Game 4 not in the schedule as completed yet


def arch_with(tmp, recs):
    a = SP.Archive(Path(tmp))
    a.games["mlb"] = {r["id"]: r for r in recs}
    return a


now = datetime(2026, 10, 28, 3, 16, tzinfo=timezone.utc)     # the run that wrote the bad final (11:16 PM ET)
later = datetime(2026, 10, 28, 9, 30, tzinfo=timezone.utc)

with tempfile.TemporaryDirectory() as tmp:
    # 1) Game 4 still live in the data window, Game 3 final in the teams' recent results: must NOT take Game 3's score
    a = arch_with(tmp, [game(G3, D3, "post", 1, 10)])
    SP.merge_archive(a, "mlb", [game(G4, D4, "in", 2, 2)], teams_only_g3(False), now)
    r4 = a.games["mlb"][G4]
    check(r4["state"] == "in" and (r4["home"]["score"], r4["away"]["score"]) == (2, 2), f"live game in the window keeps ESPN's live copy ({r4['state']} {r4['home']['score']}-{r4['away']['score']})")

    # 2) Game 4 left the window before ESPN marked it final; only Game 3 (previous day) is in recent -> stays unresolved
    a = arch_with(tmp, [game(G3, D3, "post", 1, 10), game(G4, D4, "in", 2, 2, CLOSE)])
    SP.merge_archive(a, "mlb", [], teams_only_g3(False), now + timedelta(hours=1))
    r4 = a.games["mlb"][G4]
    check(r4["state"] != "post" and r4["home"]["score"] != 1 and r4["away"]["score"] != 10, "previous day's game of the series is never used as this game's final (no id)")
    a = arch_with(tmp, [game(G3, D3, "post", 1, 10), game(G4, D4, "in", 2, 2, CLOSE)])
    SP.merge_archive(a, "mlb", [], teams_only_g3(True), now + timedelta(hours=1))
    check(a.games["mlb"][G4]["state"] != "post", "previous day's game of the series is never used as this game's final (with ids)")

    # 3) Later run: recent has Game 4 -> filled by event id, Game 3 untouched
    for ids in (True, False):
        a = arch_with(tmp, [game(G3, D3, "post", 1, 10, CLOSE), game(G4, D4, "in", 2, 2, CLOSE)])
        SP.merge_archive(a, "mlb", [], recent(ids), later)
        r3, r4 = a.games["mlb"][G3], a.games["mlb"][G4]
        how = "event id" if ids else "team pair + ET date"
        check(r4["state"] == "post" and (r4["home"]["score"], r4["away"]["score"]) == (4, 3) and r4["home"]["winner"] and not r4["away"]["winner"],
              f"Game 4 final by {how}: TB 4, MIL 3 ({r4['home']['score']}-{r4['away']['score']})")
        check((r3["home"]["score"], r3["away"]["score"]) == (1, 10), f"Game 3 keeps its own final by {how}")

    # 4) Repair: an archive that already holds Game 3's score on Game 4 is corrected from the id-matched recent row
    bad = game(G4, D4, "post", 1, 10, CLOSE)
    bad["home"]["winner"], bad["away"]["winner"] = False, True
    a = arch_with(tmp, [game(G3, D3, "post", 1, 10, CLOSE), bad])
    SP.merge_archive(a, "mlb", [], recent(True), later)
    r4 = a.games["mlb"][G4]
    check((r4["home"]["score"], r4["away"]["score"]) == (4, 3) and r4["home"]["winner"], f"bad archived final repaired by event id ({r4['home']['score']}-{r4['away']['score']})")
    # a no-id recent row never rewrites an existing final (only an exact event id may)
    a = arch_with(tmp, [game(G4, D4, "post", 4, 3, CLOSE)])
    t = recent(False)
    t["30"]["recent"][0].update(pf=9.0, pa=9.0)
    SP.merge_archive(a, "mlb", [], t, later)
    check(a.games["mlb"][G4]["home"]["score"] == 4, "existing final is not rewritten from a row without an event id")

    # 5) Full build: the Game 4 and Game 3 pages each show their own score and grade
    site = Path(tmp) / "site"
    import shutil
    shutil.copytree(ROOT / "site", site, ignore=shutil.ignore_patterns("nfl", "nba", "mlb", "nhl", "ncaaf", "ncaab", "ufc", "preview"))
    data = site / "data"
    (data / "mlb").mkdir(parents=True, exist_ok=True)
    ix = {"league": {"key": "mlb", "name": "MLB", "kind": "baseball"}, "generated": later.isoformat(), "games": [], "teams": recent(True)}
    (data / "mlb" / "index.json").write_text(json.dumps(ix))
    arch_dir = Path(tmp) / "arch"
    arch_dir.mkdir()
    g3, g4 = game(G3, D3, "post", 1, 10, CLOSE), game(G4, D4, "post", 1, 10, CLOSE)   # g4 starts out with the bad score
    g3["home"]["winner"] = False; g3["away"]["winner"] = True
    (arch_dir / "games-mlb.json").write_text(json.dumps({G3: g3, G4: g4}))
    SP.build(site, data, later, archive_dir=arch_dir)
    man = json.loads((data / "pages.json").read_text())["g"]["mlb"]
    p4, p3 = man.get(G4), man.get(G3)
    check(p4 == "mlb/games/milwaukee-brewers-at-tampa-bay-rays-2026-10-27/", f"Game 4 page path ({p4})")
    check(p3 == "mlb/games/milwaukee-brewers-at-tampa-bay-rays-2026-10-26/", f"Game 3 page path ({p3})")
    h4 = (site / p4 / "index.html").read_text() if p4 else ""
    h3 = (site / p3 / "index.html").read_text() if p3 else ""
    check("Final: Milwaukee Brewers 3, Tampa Bay Rays 4." in h4 and "7 total runs vs a closing total of 7.5: under." in h4, "Game 4 page: Rays 4, Brewers 3, UNDER 7.5")
    check("Brewers 10" not in h4 and "over." not in h4.split('class="card sx-result"')[1][:400] if 'sx-result' in h4 else False, "Game 4 page has no 10-1 / over")
    check("Final: Milwaukee Brewers 10, Tampa Bay Rays 1." in h3 and "11 total runs vs a closing total of 7.5: over." in h3, "Game 3 page keeps 10-1, OVER")
    hub = (site / "mlb" / "index.html").read_text()
    check("MIL 3, TB 4" in hub and "MIL 10, TB 1" in hub, "MLB hub recent results list each game's own score")
    saved = json.loads((arch_dir / "games-mlb.json").read_text())
    check((saved[G4]["home"]["score"], saved[G4]["away"]["score"]) == (4, 3), "repaired final saved to the archive")

print(f"{'PASS' if not failed else 'FAIL'} series_results: {passed}/{passed + failed}")
sys.exit(1 if failed else 0)
