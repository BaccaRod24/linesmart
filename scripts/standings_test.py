"""Parser and cache tests for ESPN standings. Offline. No Odds API.

Usage: env -u ODDS_API_KEY python3 scripts/standings_test.py
"""
import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
os.environ.pop("ODDS_API_KEY", None)
import standings as ST  # noqa: E402

passed = failed = 0
FIX = json.loads((ROOT / "scripts" / "fixtures" / "standings" / "espn_level3.json").read_text())
NOW = datetime(2026, 11, 3, tzinfo=timezone.utc)


def check(ok, msg):
    global passed, failed
    if ok:
        passed += 1
    else:
        failed += 1
        print("FAIL", msg)


def lg(key, kind):
    path = {"nfl": "football/nfl", "nhl": "hockey/nhl", "ncaab": "basketball/mens-college-basketball", "mlb": "baseball/mlb"}[key]
    return {"key": key, "name": key.upper(), "path": path, "kind": kind}


nfl = ST.parse_standings(lg("nfl", "football"), FIX["nfl"])
check(nfl["season"] == "2026", "NFL season label")
check([g["abbr"] for g in nfl["groups"]] == ["AFC", "NFC"], f"NFL conferences ({[g['abbr'] for g in nfl['groups']]})")
east = nfl["groups"][0]["divisions"][0]
check(east["name"] == "AFC East" and [t["id"] for t in east["teams"]] == ["2", "15"], "AFC East keeps ESPN order")
bills = east["teams"][0]
check(bills["record"] == "6-1" and bills["t"] == 0 and bills["pct"] == ".857" and bills["gb"] == "—", "Bills record, tie, win% and games-back leader")
check(bills["pf"] == 233 and bills["pa"] == 181 and bills["pd"] == 52 and bills["home"] == "3-1" and bills["div"] == "1-0" and bills["streak"] == "W3", "Bills scoring, home, division, streak")
check(bills["w"] == 6 and bills["gp"] == 7 and bills["ppg"] == round(233 / 7, 2), "games played and per-game points are derived when ESPN omits them")
check("l10" not in nfl["columns"] and "otl" not in nfl["columns"] and "pts" not in nfl["columns"], f"NFL hides last 10, OTL and points ({nfl['columns']})")
check("t" in nfl["columns"] and "pct" in nfl["columns"] and "gb" in nfl["columns"] and "pd" in nfl["columns"], f"NFL keeps ties, win%, games back and differential ({nfl['columns']})")
check(east["teams"][1]["record"] == "1-5" and east["teams"][1]["t"] == 1 and east["teams"][1]["pct"] == ".214" and east["teams"][1]["gb"] == "4.5" and east["teams"][1]["pd"] == -59, "a tie is its own column and win% counts it as half a win")
check(bills["logo"].endswith("/buf.png"), "team logo is kept")

nhl = ST.parse_standings(lg("nhl", "hockey"), FIX["nhl"])
bruins = nhl["groups"][0]["divisions"][0]["teams"][0]
check(nhl["groups"][0]["divisions"][0]["name"] == "Atlantic", "NHL division name")
check(bruins["record"] == "12-2" and bruins["otl"] == 2 and bruins["pts"] == 26 and bruins["gp"] == 16, "NHL W-L omits overtime losses; points are 2*W+OTL")
check(bruins["l10"] == "8-1-1" and bruins["div"] == "4-1-0" and bruins["pf"] == 63 and bruins["pa"] == 36, "NHL last 10, division and goals")
check("otl" in nhl["columns"] and "pts" in nhl["columns"] and "pct" not in nhl["columns"] and "l10" in nhl["columns"], f"NHL shows points and OTL, not win% ({nhl['columns']})")

ncaab = ST.parse_standings(lg("ncaab", "basketball"), FIX["ncaab"])
names = [g["abbr"] for g in ncaab["groups"]]
check(names == ["sec", "acc"] and ncaab["scope"] == "Major conferences", f"college basketball keeps the major conferences in order ({names})")
check(all(t["id"] != "999" for g in ncaab["groups"] for d in g["divisions"] for t in d["teams"]), "America East is left off the college basketball page")
check(ncaab["groups"][1]["divisions"][0]["teams"][0]["name"] == "Duke Blue Devils", "a conference with no divisions is one table")

college = {"children": [{"name": "Sun Belt", "abbreviation": "belt", "standings": {"entries": [{"team": {"id": "2638", "displayName": "UTSA Roadrunners", "abbreviation": "UTSA"}, "stats": [
    {"type": "wins", "value": 7, "displayValue": "7"},
    {"type": "total", "displayValue": "7-1"},
    {"type": "homerecord", "displayValue": "4-0"},
    {"type": "awayrecord", "displayValue": "3-1"},
    {"type": "vsdivision", "displayValue": "2-0"},
    {"type": "pointdifferential", "value": 60, "displayValue": "+60"},
    {"type": "streak", "displayValue": "W5"},
]}]}}, {"name": "America East", "abbreviation": "aeast", "standings": {"entries": [{"team": {"id": "1", "displayName": "Skip"}, "stats": [{"type": "total", "displayValue": "1-0"}]}]}}]}
cf = ST.parse_standings({"key": "ncaaf", "kind": "football"}, college)
utsa = cf["groups"][0]["divisions"][0]["teams"][0]
check(utsa["record"] == "7-1" and utsa["l"] == 1 and utsa["pct"] == ".875" and utsa["home"] == "4-0" and utsa["away"] == "3-1" and utsa["div"] == "2-0" and utsa["gp"] == 8, "college football fills the missing loss from the same record and derives win%")
for label, parsed, kind in (("fixture NFL", nfl, "football"), ("fixture NHL", nhl, "hockey"), ("fixture NCAAB", ncaab, "basketball"), ("fixture NCAAF", cf, "football")):
    errs = ST.consistency_errors(parsed, kind)
    check(not errs, f"{label} win%, GP and games back match the same entry ({errs[:3]})")
for key, kind in (("nfl", "football"), ("nba", "basketball"), ("nhl", "hockey"), ("mlb", "baseball"), ("ncaaf", "football"), ("ncaab", "basketball")):
    path = ROOT / "site" / "data" / key / "standings.json"
    doc = json.loads(path.read_text())
    errs = ST.consistency_errors(doc, kind)
    check(doc.get("source") == "ESPN" and not errs, f"cached {key} standings are internally consistent ({errs[:3]})")
check(ST.parse_standings(lg("nfl", "football"), None)["groups"] == [] and ST.parse_standings(lg("nfl", "football"), {})["groups"] == [], "a missing feed has no groups")
check(ST.season_not_started(FIX["future"], NOW) and not ST.season_not_started(FIX["nfl"], NOW), "a season that has not started is detected")

urls = []


def fake_fetch(url):
    urls.append(url)
    if "baseball/mlb" in url and "season=2026" in url:
        return FIX["nfl"]
    if "baseball/mlb" in url:
        return FIX["future"]
    if "hockey/nhl" in url:
        return FIX["nhl"]
    return FIX["nfl"]


doc = ST.fetch_doc(lg("mlb", "baseball"), fake_fetch, NOW)
check(any("season=2026" in u for u in urls) and doc.get("name") == "National Football League", "a future season is refetched as the previous year")
check(ST.standings_url(lg("nfl", "football")) == "https://site.api.espn.com/apis/v2/sports/football/nfl/standings?level=3", "NFL standings URL uses level=3")
check("group=80" in ST.standings_url({"key": "ncaaf", "path": "football/college-football"}) and "group=50" in ST.standings_url({"key": "ncaab", "path": "basketball/mens-college-basketball"}), "college standings stay on the FBS and Division I groups")

with tempfile.TemporaryDirectory() as tmp:
    report = ST.write_standings(lg("nhl", "hockey"), fake_fetch, tmp, NOW, log=lambda *_: None)
    path = Path(tmp) / "nhl" / "standings.json"
    saved = json.loads(path.read_text())
    check(report["teams"] == 1 and saved["source"] == "ESPN" and saved["groups"][0]["divisions"][0]["teams"][0]["pts"] == 26, "cache file is the parsed standings")
    previous = path.read_text()

    def boom(url):
        raise RuntimeError("standings down")

    again = ST.write_standings(lg("nhl", "hockey"), boom, tmp, NOW, log=lambda *_: None)
    check(again["kept"] is True and path.read_text() == previous, "a failed fetch keeps the previous cache file")
    missing = ST.write_standings(lg("nfl", "football"), boom, tmp, NOW, log=lambda *_: None)
    check(missing["kept"] is False and not (Path(tmp) / "nfl" / "standings.json").exists(), "a failed first fetch does not invent a file")

body = ST.file_body(lg("nfl", "football"), nfl, "2026-11-03T12:00:00+00:00")
check(body["v"] == 1 and body["league"] == "nfl" and body["columns"] == nfl["columns"] and body["generated"].startswith("2026-11-03"), "file body carries the parsed columns")

src = (ROOT / "scripts" / "standings.py").read_text()
build = (ROOT / "scripts" / "build_data.py").read_text()
check("ODDS_API" not in src and "the-odds-api" not in src, "standings module does not call The Odds API")
check("write_standings" in build and "standings" in build, "the data build writes standings")

print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
