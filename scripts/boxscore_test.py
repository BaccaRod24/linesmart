#!/usr/bin/env python3
"""Compact box score parsing. No network and no Odds API.

Run: env -u ODDS_API_KEY python3 scripts/boxscore_test.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.pop("ODDS_API_KEY", None)
import boxscore as BX  # noqa: E402

passed = failed = 0


def check(ok, msg):
    global passed, failed
    print(("PASS" if ok else "FAIL"), msg)
    if ok:
        passed += 1
    else:
        failed += 1


def ath(pid, name, stats, dnp=False):
    return {"didNotPlay": dnp, "athlete": {"id": pid, "shortName": name}, "stats": stats}


def summary():
    return {
        "header": {"competitions": [{
            "status": {"type": {"state": "post", "completed": True, "shortDetail": "Final"}, "period": 4},
            "competitors": [
                {"id": "33", "homeAway": "away", "score": "10", "team": {"id": "33", "abbreviation": "BAL"},
                 "linescores": [{"displayValue": "3"}, {"displayValue": "0"}, {"displayValue": "7"}, {"displayValue": "0"}]},
                {"id": "2", "homeAway": "home", "score": "36", "team": {"id": "2", "abbreviation": "BUF"},
                 "linescores": [{"displayValue": "14"}, {"displayValue": "3"}, {"displayValue": "10"}, {"displayValue": "9"}]},
            ],
        }]},
        "boxscore": {
            "teams": [
                {"team": {"id": "33"}, "statistics": [
                    {"name": "totalYards", "label": "Total Yards", "displayValue": "210"},
                    {"name": "firstDowns", "label": "1st Downs", "displayValue": "12"},
                    {"name": "possessionTime", "label": "Possession", "displayValue": "24:10"},
                    {"name": "notWanted", "label": "Ignored", "displayValue": "9"},
                ]},
                {"team": {"id": "2"}, "statistics": [
                    {"name": "firstDowns", "label": "1st Downs", "displayValue": "24"},
                    {"name": "totalYards", "label": "Total Yards", "displayValue": "420"},
                ]},
            ],
            "players": [
                {"team": {"id": "33"}, "statistics": [
                    {"name": "passing", "text": "Passing", "labels": ["C/ATT", "YDS", "AVG", "TD", "INT", "SACKS", "QBR", "RTG"],
                     "athletes": [ath("1", "L.Jackson", ["18/25", "210", "8.4", "1", "1", "2-12", "40", "80"]),
                                  ath("99", "Sit", ["0/0"], dnp=True)],
                     "totals": ["18/25", "210", "8.4", "1", "1", "2-12", "40", "80"]},
                    {"name": "receiving", "labels": ["REC", "YDS", "AVG", "TD", "LONG", "TGTS"],
                     "athletes": [ath(str(i), f"W{i}", ["1", str(10 + i), "10", "0", "10", "2"]) for i in range(12)],
                     "totals": []},
                    {"name": "fumbles", "labels": ["FUM", "LOST", "REC"],
                     "athletes": [ath("9", "Fumbler", ["1", "1", "0"])]},
                ]},
                {"team": {"id": "2"}, "statistics": [
                    {"name": "rushing", "labels": ["CAR", "YDS", "AVG", "TD", "LONG"],
                     "athletes": [ath("7", "J.Cook", ["20", "110", "5.5", "1", "30"])]},
                ]},
            ],
        },
    }


box = BX.compact("football", summary())
check(box and box["away"]["abbr"] == "BAL" and box["home"]["abbr"] == "BUF", "sides and abbreviations")
check(box["away"]["lines"] == ["3", "0", "7", "0"] and box["home"]["lines"] == ["14", "3", "10", "9"], "quarter lines")
check([s["label"] for s in box["away"]["stats"]] == ["1st Downs", "Total Yards", "Possession"], "football team stats stay on the short list, in order")
names = [g["name"] for g in box["away"]["players"]]
check(names == ["passing", "receiving"] and "fumbles" not in names, "passing and receiving kept; fumbles dropped")
passing = box["away"]["players"][0]
check(passing["labels"] == ["C/ATT", "YDS", "AVG", "TD", "INT", "SACKS", "QBR", "RTG"], "passing columns")
check(passing["rows"][0]["name"] == "L.Jackson" and passing["rows"][0]["id"] == "1" and len(passing["rows"]) == 1, "DNP passer is left out")
rec = box["away"]["players"][1]
check(len(rec["rows"]) == 10 and rec["more"] == 2, "receiving capped, with a more count")
check(box["home"]["players"][0]["title"] == "Rushing" and box["home"]["players"][0]["rows"][0]["stats"][1] == "110", "home rushing line")
raw = json.dumps(box, separators=(",", ":"))
check(len(raw) < 8000, f"compact football box stays small ({len(raw)} bytes)")

nba = {
    "header": {"competitions": [{"competitors": [
        {"id": "1", "homeAway": "away", "team": {"id": "1", "abbreviation": "BOS"}, "linescores": [{"displayValue": "30"}] * 4},
        {"id": "2", "homeAway": "home", "team": {"id": "2", "abbreviation": "NYK"}, "linescores": [{"displayValue": "28"}] * 4},
    ]}]},
    "boxscore": {"players": [
        {"team": {"id": "1"}, "statistics": [{"name": "athletes", "labels": ["MIN", "PTS", "FG", "3PT", "FT", "REB", "AST", "STL", "BLK", "TO", "PF", "+/-", "FGM"],
            "athletes": [ath("10", "J.Tatum", ["34", "28", "10-18", "3-7", "5-6", "8", "4", "1", "0", "2", "2", "+6", "10"])]}]},
        {"team": {"id": "2"}, "statistics": []},
    ]},
}
nb = BX.compact("basketball", nba)
check(nb and nb["away"]["players"][0]["labels"][:4] == ["MIN", "PTS", "FG", "3PT"] and "FGM" not in nb["away"]["players"][0]["labels"], "NBA keeps the standard line and drops extra columns")

nhl = {
    "header": {"competitions": [{"competitors": [
        {"id": "a", "homeAway": "away", "team": {"id": "a", "abbreviation": "TOR"}},
        {"id": "h", "homeAway": "home", "team": {"id": "h", "abbreviation": "BOS"}},
    ]}]},
    "boxscore": {"players": [
        {"team": {"id": "a"}, "statistics": [
            {"name": "forwards", "labels": ["G", "A", "SOG", "+/-", "TOI", "HT", "BS", "PIM"], "athletes": [ath("3", "A.Matthews", ["1", "1", "4", "1", "18:02", "2", "1", "0"])]},
            {"name": "goalies", "labels": ["SA", "GA", "SV", "SV%", "TOI"], "athletes": [ath("4", "J.Woll", ["28", "2", "26", ".929", "60:00"])]},
        ]},
        {"team": {"id": "h"}, "statistics": []},
    ]},
}
nh = BX.compact("hockey", nhl)
check(nh and [g["title"] for g in nh["away"]["players"]] == ["Forwards", "Goalies"], "NHL skaters and goalies")
check(nh["away"]["players"][1]["rows"][0]["stats"][3] == ".929", "goalie save percentage")

mlb = {
    "header": {"competitions": [{"competitors": [
        {"id": "n", "homeAway": "away", "team": {"id": "n", "abbreviation": "NYM"}},
        {"id": "l", "homeAway": "home", "team": {"id": "l", "abbreviation": "LAD"}},
    ]}]},
    "boxscore": {
        "teams": [{"team": {"id": "n"}, "statistics": [
            {"name": "batting", "stats": [{"abbreviation": "H", "displayValue": "9"}, {"abbreviation": "R", "displayValue": "5"}, {"abbreviation": "WAR", "displayValue": "1.2"}]},
        ]}],
        "players": [{"team": {"id": "n"}, "statistics": [
            {"name": "batting", "labels": ["AB", "R", "H", "RBI", "HR", "BB", "K", "AVG"], "athletes": [ath("8", "F.Lindor", ["4", "1", "2", "1", "0", "1", "1", ".270"])]},
            {"name": "pitching", "labels": ["IP", "H", "R", "ER", "BB", "K", "HR", "PC-ST", "ERA"], "athletes": [ath("5", "K.Senga", ["6.0", "4", "2", "2", "1", "8", "1", "92-60", "3.10"])]},
        ]}],
    },
}
mb = BX.compact("baseball", mlb)
check(mb and [g["title"] for g in mb["away"]["players"]] == ["Batting", "Pitching"], "MLB batting and pitching")
check(mb["away"]["stats"] and mb["away"]["stats"][0]["label"] == "Runs" and all(s["label"] != "WAR" for s in mb["away"]["stats"]), "MLB team line is tonight's batting, not season WAR")

check(BX.compact("mma", {"boxscore": {"players": [{"team": {"id": "1"}, "statistics": []}]}}) is None, "UFC is skipped")
check(BX.compact("football", {}) is None and BX.compact("football", {"boxscore": {}}) is None, "empty summary has no box")
soc = BX.compact("soccer", {
    "header": {"competitions": [{"competitors": [
        {"id": "c", "homeAway": "away", "team": {"id": "c", "abbreviation": "CHE"}},
        {"id": "m", "homeAway": "home", "team": {"id": "m", "abbreviation": "MCI"}},
    ]}]},
    "boxscore": {"players": [{"team": {"id": "c"}, "statistics": [
        {"name": "players", "labels": ["G", "A", "SH", "ST", "FC", "NOISE"], "athletes": [ath("11", "C.Palmer", ["1", "0", "3", "2", "1", "99"])]},
    ]}]},
})
check(soc and soc["away"]["players"][0]["labels"] == ["G", "A", "SH", "ST", "FC"], "soccer keeps the short line")

print(f"\nboxscore_test: {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
