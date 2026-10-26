"""Unit tests for scripts/props.py (DraftKings player props via ESPN + last-game history). Offline: ESPN is faked.
Usage: python3 scripts/props_test.py"""
import datetime as dt, json, os, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import props as PR

fails = []
def check(ok, msg, tag="props"):
    print(f"{'PASS' if ok else 'FAIL'} {tag}: {msg}")
    if not ok: fails.append(f"{tag}: {msg}")

ATH = "http://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2026/athletes/{}?lang=en"
def item(pid, typ, cur, opn=None, upd="2026-10-26T12:00Z", team=False):
    it = dict(athlete={"$ref": ATH.format(pid)}, type=dict(id="1", name=typ), current=dict(target=dict(value=cur) if cur is not None else {}),
              open=dict(target=dict(value=opn)) if opn is not None else {}, lastUpdated=upd)
    if team: it["team"] = {"$ref": "x/teams/1"}
    return it

# ---------- parse_items
items = [item("10", "Total Passing Yards", 250.5, 245.5), item("10", "Total Passing Yards", 250.5, 245.5),   # over/under duplicates
         item("10", "Total Passing Yards", 252.5, 245.5, upd="2026-10-26T13:00Z"),                         # newer line wins
         item("20", "Anytime Touchdown Scorer", None), item("20", "Total Receiving Yards (incl. overtime)", 60.5),
         item("20", "Total Receiving Yards 75+", 74.5), item("30", "Total Rushing Yards", 40.5, team=True),
         dict(type=dict(name="Total Passing Yards"), current=dict(target=dict(value=1)))]
P = PR.parse_items("nfl", items)
check(set(P) == {("10", "pass_yds"), ("20", "anytime_td"), ("20", "rec_yds")}, f"dedupes, skips milestone/team/no-athlete items: {sorted(P)}")
check(P[("10", "pass_yds")]["line"] == 252.5 and P[("10", "pass_yds")]["open"] == 245.5, "newest lastUpdated line kept, opening line kept")
check(P[("20", "anytime_td")]["line"] == 0.5 and P[("20", "anytime_td")]["open"] is None, "anytime TD graded as 0.5")
check(PR.norm_type("Total Points (incl. Overtime)") == "total points", "norm_type strips overtime suffix")
check(PR._et_day("2026-10-25T00:30Z") == "2026-10-24" and PR._et_day("2026-10-25T23:30Z") == "2026-10-25", "log dates are ET calendar days")
check(PR.grade(3, 2.5) == "o" and PR.grade(2, 2.5) == "u" and PR.grade(25, 25) == "p" and PR.grade(None, 1) is None, "grade o/u/p/None")

# ---------- NBA history + full build
def nba_game(d, h, a, rows_h, rows_a):
    return dict(d=d, h=h, a=a, b={h: dict(p=rows_h), a: dict(p=rows_a)})
games = {
    "g1": nba_game("2026-10-22T23:00Z", "1", "2", [["100", "G", 30, 5, 8, 4]], [["200", "C", 10, 12, 2, 0]]),
    "g2": nba_game("2026-10-24T23:00Z", "3", "1", [], [["100", "G", 20, 4, 6, 2]]),
    "g3": nba_game("2026-10-25T23:00Z", "1", "4", [], []),                                # 100 DNP
    "g4": nba_game("2026-10-23T23:00Z", "2", "5", [["200", "C", 18, 9, 1, 1]], []),
}
hist = PR.player_games("nba", games, "100", "1")
check([h[1]["d"][:10] for h in hist] == ["2026-10-25", "2026-10-24", "2026-10-22"] and hist[0][2] is None, "player_games newest first, DNP kept as None")
log, hist = PR.build_player("nba", games, "100", "1", {"points", "pra"}, {"1": "AAA", "2": "BBB", "3": "CCC", "4": "DDD"})
check(log[0] == ["2026-10-25", "DDD", "vs", None] and log[1] == ["2026-10-24", "CCC", "@", {"points": 20, "pra": 30}], f"log rows: {log[:2]}")
check(PR.season_tally("nba", hist, "points", 24.5) == [1, 1, 0, 2], "season tally skips DNP")
check(PR.season_tally("nba", hist, "points", 20) == [1, 0, 1, 2], "push counted")

now = dt.datetime(2026, 10, 26, 18, tzinfo=dt.timezone.utc)
idx = dict(games=[dict(id="901", state="pre", date="2026-10-26T23:30Z", home=dict(id="1", abbr="AAA"), away=dict(id="2", abbr="BBB")),
                  dict(id="902", state="pre", date="2026-10-27T23:30Z", home=dict(id="3", abbr="CCC"), away=dict(id="4", abbr="DDD")),
                  dict(id="903", state="pre", date="2026-10-30T23:30Z", home=dict(id="5", abbr="EEE"), away=dict(id="1", abbr="AAA")),   # outside 36h
                  dict(id="904", state="post", date="2026-10-25T23:30Z", home=dict(id="1", abbr="AAA"), away=dict(id="4", abbr="DDD"))])
calls = []
class E404(Exception): pass
def getj(url):
    calls.append(url)
    assert "api.the-odds-api.com" not in url
    if "/events/901/" in url:
        return dict(pageCount=1, items=[item("100", "Total Points", 24.5, 23.5), item("100", "Total Points", 24.5, 23.5),
                                        item("200", "Total Rebounds", 10.5), item("300", "Total Assists", 4.5), item("999", "Total Points", 9.5)])
    if "/events/902/" in url: raise E404("404")
    if "/athletes/300" in url: return dict(displayName="New Guy", position=dict(abbreviation="F"), team={"$ref": "x/teams/2?lang=en"})
    if "/athletes/999" in url: return dict(displayName="Other Team", team={"$ref": "x/teams/7"})
    raise AssertionError("unexpected " + url)
with tempfile.TemporaryDirectory() as td:
    sd = os.path.join(td, "search"); os.makedirs(sd)
    json.dump(dict(teams=[["1", "Alphas", "AAA"], ["2", "Betas", "BBB"]], players=[["100", "Star Guard", 0, "G"], ["200", "Big Man", 1, "C"]]), open(os.path.join(sd, "nba.json"), "w"))
    rep = PR.build_props(dict(key="nba", path="basketball/nba"), getj, os.path.join(td, "props"), sd, games=games, index=idx, now=now, log=lambda *a: None)
    doc = json.load(open(os.path.join(td, "props", "nba.json")))
check(not any("/events/903/" in u or "/events/904/" in u for u in calls), "only pre games inside the window are fetched")
check(all(u.startswith("https://") for u in calls) and all("/odds/100/propBets" in u for u in calls if "/events/" in u), "https + DraftKings provider 100")
check(rep["gamesInWindow"] == 2 and rep["gamesWithProps"] == 1 and rep["noProps"] == 1, f"report counts {rep}")
rows = doc["games"]["901"]["props"]
check([r[:4] for r in rows] == [["100", "points", 24.5, 23.5], ["200", "rebounds", 10.5, None], ["300", "assists", 4.5, None]], f"rows ordered by market: {rows}")
check(rows[0][4] == [1, 1, 0, 2], "season tally shipped per prop")
check(doc["players"]["300"]["n"] == "New Guy" and doc["players"]["300"]["ta"] == "BBB", "missing player name looked up from athlete ref")
check("999" not in doc["players"], "player whose team isn't in the game is dropped")
check(doc["players"]["100"]["log"][0][3] is None and len(doc["players"]["100"]["log"]) == 3, "log keeps the DNP game")
check(doc["book"] == "DraftKings" and doc["markets"]["points"] == ["Points", "Pts"] and doc["v"] == 1, "doc header")
check(doc["games"]["901"]["upd"] == "2026-10-26T12:00Z", "upd = newest lastUpdated")

# ---------- NFL history: zero for categories he didn't appear in; anytime TD = rush + rec TDs
ng = {"n1": dict(d="2026-10-19T17:00Z", h="1", a="2", b={"1": {"rb": dict(ry=80, rtd=1, car=15, rec=3, recy=20, rectd=1)}, "2": {}}),
      "n2": dict(d="2026-10-12T17:00Z", h="3", a="1", b={"1": {"rb": dict(ry=40, car=10)}, "3": {}})}
log, hist = PR.build_player("nfl", ng, "rb", "1", {"anytime_td", "receptions", "rush_rec_yds"}, {"2": "BBB", "3": "CCC"})
check(log[0][3] == {"anytime_td": 2, "receptions": 3, "rush_rec_yds": 100} and log[1][3] == {"anytime_td": 0, "receptions": 0, "rush_rec_yds": 40}, f"nfl log {log}")
check(PR.season_tally("nfl", hist, "anytime_td", 0.5) == [1, 1, 0, 2], "anytime TD tally")
with tempfile.TemporaryDirectory() as td:   # first run: props/ doesn't exist yet, index comes from the sibling <lg>/index.json
    os.makedirs(os.path.join(td, "nba")); json.dump(idx, open(os.path.join(td, "nba", "index.json"), "w"))
    calls.clear()
    rep = PR.build_props(dict(key="nba", path="basketball/nba"), getj, os.path.join(td, "props"), None, games=games, now=now, log=lambda *a: None)
check(rep["gamesInWindow"] == 2, "index found before props/ exists (fresh build)")
check(PR.build_props(dict(key="mlb", path="baseball/mlb"), getj, "/nonexistent", None) is None, "unsupported league -> None")

print(f"\n{'ALL PASS' if not fails else str(len(fails)) + ' FAILED'}")
sys.exit(1 if fails else 0)
