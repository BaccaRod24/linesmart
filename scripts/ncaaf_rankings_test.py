"""Parser tests for the college football AP Top 25 (and CFP, when ESPN publishes it).

Offline. No Odds API. Usage: env -u ODDS_API_KEY python3 scripts/ncaaf_rankings_test.py
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
os.environ.pop("ODDS_API_KEY", None)
import ncaaf_rankings as NR  # noqa: E402

passed = failed = 0


def check(ok, msg):
    global passed, failed
    if ok:
        passed += 1
    else:
        failed += 1
        print("FAIL", msg)


def entry(rank, prev, tid, name, record="6-1", trend="-"):
    loc, *rest = name.split(" ", 1)
    return {
        "current": rank, "previous": prev, "trend": trend, "recordSummary": record,
        "team": {"id": tid, "location": loc, "name": rest[0] if rest else "", "abbreviation": name[:3].upper(), "displayName": name},
    }


DOC = {
    "rankings": [
        {
            "name": "AP Top 25", "shortName": "AP Poll", "type": "ap", "date": "2026-10-25T07:00Z",
            "ranks": [
                entry(1, 1, "2390", "Miami Hurricanes", "7-0"),
                entry(2, 3, "194", "Ohio State Buckeyes"),
                entry(8, 2, "252", "BYU Cougars"),
                entry(20, 21, "68", "Boise State Broncos"),
                entry(20, 24, "77", "Northwestern Wildcats"),
                entry(24, 0, "197", "Oklahoma State Cowboys"),
                entry(26, 25, "999", "Dropped Out"),
                {"current": 3, "previous": 3, "team": {}},
            ],
        },
        {"name": "FCS Coaches Poll", "type": "fcs", "date": "2026-10-26T07:00Z", "ranks": [entry(1, 1, "2627", "Tarleton State Texans")]},
        {
            "name": "College Football Playoff", "shortName": "CFP", "type": "cfp", "date": "2026-11-04T07:00Z",
            "ranks": [entry(1, 0, "194", "Ohio State Buckeyes", "9-0")],
        },
    ]
}

parsed = NR.parse_rankings(DOC)
ap = parsed["ap"]
check(ap and ap["name"] == "AP Top 25" and ap["date"] == "2026-10-25T07:00Z", "AP poll name and date")
ids = [t["id"] for t in ap["teams"]]
check(ids == ["2390", "194", "252", "68", "77", "197"], f"AP teams stay in rank order and drop a rank past 25 ({ids})")
by = {t["id"]: t for t in ap["teams"]}
check(by["2390"]["movement"] == "unchanged" and by["2390"]["previous"] == 1 and by["2390"]["record"] == "7-0", "unchanged team keeps its record")
check(by["194"]["movement"] == "up" and by["194"]["rank"] == 2, "a better rank is up")
check(by["252"]["movement"] == "down", "a worse rank is down")
check(by["197"]["movement"] == "new" and by["197"]["previous"] is None, "previous 0 is new, not a rank")
check(by["68"]["rank"] == 20 and by["77"]["rank"] == 20, "a tie keeps both teams")
check(parsed["cfp"]["teams"][0]["id"] == "194" and parsed["cfp"]["teams"][0]["movement"] == "new", "CFP poll is kept when ESPN publishes it")
check(NR.parse_rankings({"rankings": [DOC["rankings"][1]]})["ap"] is None, "an FCS poll is not the AP Top 25")
check(NR.parse_rankings(None) == {"ap": None, "cfp": None} and NR.parse_rankings({})["ap"] is None, "a missing feed has no poll")
check(NR.poll_key({"type": "ap"}) == "ap" and NR.poll_key({"name": "AP Top 25"}) == "ap", "AP is recognized by type or name")
check(NR.movement(5, "nope") == "new" and NR.movement("x", 4) is None, "bad numbers do not become a rank change")

body = NR.file_body(parsed, "2026-10-31T12:00:00+00:00")
check(body["league"] == "ncaaf" and body["source"] == "ESPN" and body["ap"]["teams"][0]["id"] == "2390" and body["cfp"]["name"] == "College Football Playoff", "file body carries AP and CFP")
empty = NR.file_body(NR.parse_rankings({}), "2026-10-31T12:00:00+00:00")
check(empty["ap"] is None and "cfp" not in empty, "a missing poll is null, not an invented ranking")

src = Path("scripts/ncaaf_rankings.py").read_text()
build = Path("scripts/build_data.py").read_text()
check("the-odds-api" not in src and "ODDS_API" not in src, "rankings parser does not call the Odds API")
check("college-football/rankings" in build and "write_ncaaf_rankings" in build, "the data build fetches the ESPN rankings feed")
check("the-odds-api" not in build[build.find("def write_ncaaf_rankings"):build.find("def _refresh_rankings")], "the rankings writer does not call the Odds API")

print(f"PASS ncaaf_rankings: {passed} passed, {failed} failed" if not failed else f"FAIL ncaaf_rankings: {failed} failed, {passed} passed")
sys.exit(1 if failed else 0)
