"""Unit tests for scripts/matchups.py (opponent defense vs position). Offline: ESPN responses are faked.
Usage: python3 scripts/matchups_test.py"""
import json, os, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import matchups as MU

fails = []
def check(ok, msg, tag="matchups"):
    print(f"{'PASS' if ok else 'FAIL'} {tag}: {msg}")
    if not ok: fails.append(f"{tag}: {msg}")

# ---------- fake ESPN NFL box score
def nfl_box(off):
    """off: {teamId: [(pid, cat, {key: value})]}"""
    keys = dict(passing=["completions/passingAttempts", "passingYards", "passingTouchdowns", "interceptions"],
                rushing=["rushingAttempts", "rushingYards", "rushingTouchdowns"],
                receiving=["receptions", "receivingYards", "receivingTouchdowns", "receivingTargets"])
    players = []
    for tid, rows in off.items():
        stats = []
        for cat in ("passing", "rushing", "receiving"):
            ath = [dict(athlete=dict(id=pid), stats=[str(v.get(k, 0)) for k in keys[cat]]) for pid, c, v in rows if c == cat]
            if ath: stats.append(dict(name=cat, keys=keys[cat], athletes=ath))
        players.append(dict(team=dict(id=tid), statistics=stats))
    return dict(boxscore=dict(players=players), header=dict(competitions=[dict(status=dict(period=4))]))

m = nfl_box({"1": [("qb1", "passing", {"completions/passingAttempts": "20/30", "passingYards": 250, "passingTouchdowns": 2, "interceptions": 1}),
                   ("wr1", "receiving", {"receptions": 7, "receivingYards": 100, "receivingTouchdowns": 1, "receivingTargets": 9}),
                   ("te1", "receiving", {"receptions": 3, "receivingYards": 30, "receivingTouchdowns": 0, "receivingTargets": 4}),
                   ("rb1", "rushing", {"rushingAttempts": 15, "rushingYards": 80, "rushingTouchdowns": 1}),
                   ("x9", "receiving", {"receptions": 2, "receivingYards": "1,020", "receivingTargets": 2})],
             "2": [("qb2", "passing", {"completions/passingAttempts": "10/25", "passingYards": 150, "interceptions": 3}),
                   ("wr2", "receiving", {"receptions": 4, "receivingYards": 50, "receivingTargets": 8})]})
c = MU.compact_nfl(m)
check(c["1"]["qb1"]["py"] == 250 and c["1"]["qb1"]["att"] == 30 and c["1"]["qb1"]["cmp"] == 20, "compact_nfl reads passing + splits cmp/att")
check(c["1"]["x9"]["recy"] == 1020, "numbers with thousands separators parse")
ev = dict(date="2026-09-10T00:00Z", home="1", away="2", hs="27", **{"as": "10"})
rec = MU.compact_game("nfl", m, ev)
check(rec["s"] == {"1": "27", "2": "10"} and rec["per"] == 4, "compact_game keeps score + period")

pos = {"qb1": "QB", "wr1": "WR", "te1": "TE", "rb1": "RB", "qb2": "QB", "wr2": "WR"}   # x9 not on a roster -> category fallback (WR)
agg = MU.aggregate("nfl", {"g1": rec}, pos)
check(set(agg) == {"1", "2"} and agg["2"]["gp"] == 1, "both teams get a defensive line")
d2 = agg["2"]   # team 2 defended against team 1's offense
check(d2["team"]["pts"] == 27 and d2["pos"]["QB"]["py"] == 250 and d2["pos"]["QB"]["int"] == 1, "offense credited to the defending team")
check(d2["pos"]["WR"]["recy"] == 1120 and d2["pos"]["TE"]["recy"] == 30, "WR bucket includes an unrostered receiver; TE separate")
check(d2["team"]["yds"] == 250 + 80, "team yards = pass + rush yds")
check(MU._nfl_bucket("K", {"_c": ["rece"]}) is None and MU._nfl_bucket(None, {"_c": ["pass"], "att": 2}) is None, "kickers and 2-attempt trick passes aren't bucketed")

# ---------- ranking
r = MU.rank({"a": dict(gp=1, team=dict(pts=20.0), pos=dict(QB=dict(py=200.0, int=2.0))),
             "b": dict(gp=1, team=dict(pts=30.0), pos=dict(QB=dict(py=300.0, int=0.0))),
             "c": dict(gp=1, team=dict(pts=20.0), pos=dict(QB=dict(py=250.0, int=1.0)))})
check(r["a"]["team"]["pts"] == [20.0, 1] and r["c"]["team"]["pts"] == [20.0, 1] and r["b"]["team"]["pts"] == [30.0, 3], "rank 1 = fewest allowed, ties share the better rank")
check(r["a"]["pos"]["QB"]["int"][1] == 1 and r["b"]["pos"]["QB"]["int"][1] == 3, "INTs: rank 1 = most forced (toughest)")
check(MU.rank({}) == {}, "rank of nothing")

# ---------- NBA: positions from the box, possessions, pace with OT
def nba_box(tid_rows):
    box = dict(players=[], teams=[])
    for tid, (rows, t) in tid_rows.items():
        keys = ["points", "rebounds", "assists", "threePointFieldGoalsMade-threePointFieldGoalsAttempted"]
        box["players"].append(dict(team=dict(id=tid), statistics=[dict(keys=keys, athletes=[
            dict(athlete=dict(id=pid, position=dict(abbreviation=p)), stats=[str(x) for x in st], didNotPlay=dnp) for pid, p, st, dnp in rows])]))
        box["teams"].append(dict(team=dict(id=tid), statistics=[dict(name="fieldGoalsMade-fieldGoalsAttempted", displayValue=f"{t[0]}-{t[1]}"),
            dict(name="freeThrowsMade-freeThrowsAttempted", displayValue=f"0-{t[2]}"), dict(name="offensiveRebounds", displayValue=str(t[3])),
            dict(name="totalTurnovers", displayValue=str(t[4]))]))
    return dict(boxscore=box, header=dict(competitions=[dict(status=dict(period=5))]))
nm = nba_box({"10": ([("g1", "G", [30, 4, 8, "4-9"], False), ("c1", "C", [20, 12, 2, "0-1"], False), ("dnp", "F", [], True)], (40, 90, 25, 10, 12)),
              "20": ([("g2", "G", [25, 3, 6, "5-10"], False)], (38, 88, 20, 8, 14))})
nrec = MU.compact_game("nba", nm, dict(date="2026-10-22T00:00Z", home="10", away="20", hs="110", **{"as": "100"}))
check(len(nrec["b"]["10"]["p"]) == 2, "NBA DNP players skipped")
na = MU.aggregate("nba", {"x": nrec}, {})
d20 = na["20"]
check(d20["pos"]["G"]["pts"] == 30 and d20["pos"]["C"]["reb"] == 12 and d20["pos"]["G"]["tpm"] == 4, "NBA G/C allowed from box positions")
poss = ((90 - 10 + 12 + 0.44 * 25) + (88 - 8 + 14 + 0.44 * 20)) / 2
check(abs(d20["team"]["drtg"] - round(100 * 110 / poss, 1)) < 0.05, "def rating = pts allowed per 100 possessions")
check(abs(d20["team"]["pace"] - round(48 * poss / 53, 1)) < 0.05, "pace per 48 counts the overtime period")
check(d20["team"]["fgp"] == round(100 * 40 / 90, 1), "opp FG%")

# ---------- build_matchups end to end with a fake fetcher + cache
calls = []
def sched(tid, opp):
    return dict(season=dict(year=2026), events=[
        dict(id="e1", date="2026-09-10T00:00Z", seasonType=dict(type=2), competitions=[dict(status=dict(type=dict(completed=True)),
             competitors=[dict(id="1", homeAway="home", score=dict(value=27)), dict(id="2", homeAway="away", score=dict(value=10))])]),
        dict(id="pre", date="2026-08-10T00:00Z", seasonType=dict(type=1), competitions=[dict(status=dict(type=dict(completed=True)),
             competitors=[dict(id="1", homeAway="home", score="3"), dict(id="2", homeAway="away", score="0")])]),
        dict(id="fut", date="2026-12-10T00:00Z", seasonType=dict(type=2), competitions=[dict(status=dict(type=dict(completed=False)),
             competitors=[dict(id="1", homeAway="away"), dict(id="2", homeAway="home")])])])
def getj(url):
    calls.append(url)
    if "/schedule" in url: return sched(url.split("/teams/")[1].split("/")[0], None)
    if "summary?event=e1" in url: return m
    raise RuntimeError("unexpected " + url)
with tempfile.TemporaryDirectory() as tmp:
    out, cache, snap, sdir = (os.path.join(tmp, x) for x in ("out", "cache", "snap", "search"))
    os.makedirs(sdir); json.dump(dict(players=[[k, "n", 0, v] for k, v in pos.items()]), open(os.path.join(sdir, "nfl.json"), "w"))
    lg = dict(key="nfl", path="football/nfl")
    tl = lambda g, s, l: [dict(id="1"), dict(id="2")]
    rep = MU.build_matchups(lg, getj, "https://x/", out, sdir, cache, snap, log=lambda *_: None, teams_list=tl)
    doc = json.load(open(os.path.join(out, "nfl.json")))
    check(rep["games"] == 1 and doc["games"] == 1 and doc["nTeams"] == 2, "only completed regular-season games are used")
    check(doc["teams"]["2"]["pos"]["QB"]["py"] == [250.0, 2], "output carries [value, rank]")
    check(os.path.exists(os.path.join(cache, "nfl.json")) and os.path.exists(os.path.join(snap, "_matchups", "nfl.json")), "cache + push-race snapshot written")
    n1 = sum("summary" in u for u in calls)
    MU.build_matchups(lg, getj, "https://x/", out, sdir, cache, snap, log=lambda *_: None, teams_list=tl)
    check(sum("summary" in u for u in calls) == n1, "second run re-uses the cache (no box score refetch)")
    check(MU.build_matchups(dict(key="mlb", path="baseball/mlb"), getj, "https://x/", out, sdir) is None, "unsupported league is skipped")

print(f"\n{len(fails)} FAILED" if fails else "\nall matchups.py tests passed")
sys.exit(1 if fails else 0)
