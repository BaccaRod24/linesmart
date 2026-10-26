"""Offline tests for the paid Odds API upgrade: budget/throttle (odds_budget.py), Hard Rock + FanDuel game-line pull,
props pull + parse (odds_props.py), props merge next to DraftKings (props.py), key scrubbing, apply-odds merge.
Never calls The Odds API: every request goes to a fake `get`. Usage: env -u ODDS_API_KEY python3 scripts/odds_paid_test.py"""
import datetime as dt, json, os, sys, tempfile, urllib.parse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.pop("ODDS_API_KEY", None)
import odds_budget as OB, odds_props as OP, props as PR, line_history as LH
import build_data as BD

fails = []
def check(ok, msg, tag="paid"):
    print(f"{'PASS' if ok else 'FAIL'} {tag}: {msg}")
    if not ok: fails.append(f"{tag}: {msg}")
UTC = dt.timezone.utc
T = lambda *a: dt.datetime(*a, tzinfo=UTC)

# ================================================================ throttle (odds_budget.plan)
s, e = OB.cycle_bounds(T(2026, 10, 26, 15), 26)
check(s == T(2026, 10, 26) and e == T(2026, 11, 26), f"cycle 26th->26th: {s} {e}", "budget")
s, e = OB.cycle_bounds(T(2026, 11, 3), 26)
check(s == T(2026, 10, 26) and e == T(2026, 11, 26), "before the billing day -> previous month's cycle", "budget")
s, e = OB.cycle_bounds(T(2027, 2, 10), 31)
check(s == T(2027, 1, 31) and e == T(2027, 2, 28), f"billing day 31 clamps to Feb 28: {s} {e}", "budget")
s, e = OB.cycle_bounds(T(2026, 12, 30), 26)
check(s == T(2026, 12, 26) and e == T(2027, 1, 26), "December rolls into January", "budget")

now = T(2026, 10, 26, 16)   # day 0 of the cycle (30.33 days left)
p = OB.plan(100000, 0, now, games_per_run=27, props_per_run=40, floor=300)
check(p["level"] == "full" and p["gameInterval"] == 30 and p["props"], f"fresh plan -> full {p['allowancePerDay']}/day", "budget")
check(p["needGamesPerDay"] == 1296 and p["needPropsPerDay"] == 480, "need = 27x48 games + 40x12 props per day", "budget")
# halfway through the month with 55K of the 80K budget used: 24.7K left / 15.3 days = 1612/day < 1296+480 -> props off
mid = T(2026, 11, 10, 16)
p = OB.plan(45000, 55000, mid, games_per_run=27, props_per_run=40, floor=300)
check(p["level"] == "no-props" and p["gameInterval"] == 30 and not p["props"], f"behind pace -> step 1: props paused ({p['reason']})", "budget")
p = OB.plan(30000, 70000, mid, games_per_run=27, props_per_run=40, floor=300)   # 9.7K / 15.3d = 634/day -> 27*1440/i <= 634 -> 90 min
check(p["level"] == "slow-games" and p["gameInterval"] == 90 and not p["props"], f"far behind -> step 2: game lines every {p['gameInterval']} min", "budget")
p = OB.plan(21000, 79000, mid, games_per_run=27, props_per_run=40, floor=300)  # 700 left -> 46/day -> slowest step
check(p["level"] == "slow-games" and p["gameInterval"] == 360, "nearly out -> slowest step (6 h)", "budget")
p = OB.plan(20100, 79900, mid, games_per_run=27, props_per_run=40, floor=300)
check(p["level"] == "stop" and not p["props"] and p["gameInterval"] is None, "budget minus floor exhausted -> stop", "budget")
p = OB.plan(250, 10000, mid, games_per_run=27, props_per_run=40, floor=300)
check(p["level"] == "stop", "remaining below the floor (even if 'used' looks low) -> stop", "budget")
check(OB.plan(None, None, now, games_per_run=27)["level"] == "stop", "unknown balance -> stop (no blind spending)", "budget")
p = OB.plan(100000, None, now, games_per_run=27, props_per_run=40)
check(p["level"] == "full" and p["used"] is None, "used header missing -> derived from plan size", "budget")
p = OB.plan(50000, 50000, T(2026, 11, 25, 23, 30), games_per_run=27, props_per_run=40)
check(p["level"] == "full" and p["daysLeft"] == round(1 / 24, 2), "last hour of the cycle: days_left floored at 1h, plenty left -> full", "budget")
check(OB.plan(100000, 0, now, games_per_run=0, props_per_run=0)["level"] == "full", "no events anywhere -> full (costs 0)", "budget")
check(OB.due(None, 30, now) and OB.due("2026-10-26T15:30:00+00:00", 30, now) and not OB.due("2026-10-26T15:45:00Z", 30, now),
      "interval gate: due after 30 min (2 min slack), not after 15", "budget")
check(OB.due("2026-10-26T15:32:00Z", 30, now) and not OB.due("2026-10-26T15:33:00Z", 30, now), "gate slack is 2 minutes", "budget")
check(OB.detect_reset(70000, 12) and not OB.detect_reset(10, 40) and not OB.detect_reset(None, 5), "reset = used counter went down", "budget")
rows, tot = OB.monthly_estimate(props=[("NBA", 4, 7.2, 18), ("NFL", 5, 16 / 7, 18)])
check(round(rows[0][1]) == 39398 and 55000 < tot < 80000, f"monthly estimate worst case {tot:.0f} < 80K", "budget")

# ================================================================ key scrubbing
K = "sekret+Key/123"
msg = BD.scrub(f"HTTP 401 for https://api.the-odds-api.com/v4/sports/?apiKey={urllib.parse.quote(K)}&x=1 key={K}", K)
check(K not in msg and urllib.parse.quote(K) not in msg and "apiKey=***" in msg, f"scrub: {msg}", "scrub")
check("abc" not in BD.scrub("…?apiKey=abc&regions=us", None), "scrub masks apiKey= even without the key", "scrub")

# ================================================================ game lines: Hard Rock + FanDuel in ONE request
L = {l["key"]: l for l in BD.LEAGUES}
games = [dict(id="501", date="2026-10-27T00:15Z", state="pre", home=dict(name="Kansas City Chiefs", abbr="KC"), away=dict(name="Washington Commanders", abbr="WSH")),
         dict(id="502", date="2026-10-26T17:00Z", state="in", home=dict(name="Buffalo Bills", abbr="BUF"), away=dict(name="Miami Dolphins", abbr="MIA"))]
def bk(key, ml, sp, tot):
    return dict(key=key, last_update="2026-10-26T15:00:00Z", markets=[
        dict(key="h2h", outcomes=[dict(name="Kansas City Chiefs", price=ml[0]), dict(name="Washington Commanders", price=ml[1])]),
        dict(key="spreads", outcomes=[dict(name="Kansas City Chiefs", price=-110, point=sp), dict(name="Washington Commanders", price=-110, point=-sp)]),
        dict(key="totals", outcomes=[dict(name="Over", price=-108, point=tot), dict(name="Under", price=-112, point=tot)])])
EV = [dict(id="ev1", commence_time="2026-10-27T00:15:00Z", home_team="Kansas City Chiefs", away_team="Washington Commanders",
           bookmakers=[bk("hardrockbet", (-190, 160), -4.0, 47.5), bk("fanduel", (-180, 152), -3.5, 48.0), bk("betmgm", (-200, 170), -4.5, 47.0)])]
urls = []
def fake_get(url):
    urls.append(url)
    if "/odds/" in url: return EV, {"x-requests-remaining": "99970", "x-requests-used": "30", "x-requests-last": "3"}
    raise AssertionError(url)
BD.get = fake_get
pull = dict(key=K, remaining=100000, used=0, spent=0, pulled=[], skipped=[], errors=[], due={"nfl"}, floor=300, cap=250)
entry, msg = BD.odds_pull_league(L["nfl"], games, pull, "2026-10-26T16:00:00Z")
q = urllib.parse.parse_qs(urllib.parse.urlparse(urls[-1]).query)
check(q["bookmakers"] == ["hardrockbet,fanduel"] and q["markets"] == ["h2h,spreads,totals"] and "commenceTimeTo" in q, f"one request, both books: {sorted(q)}", "games")
g = entry["games"]["501"]
check(set(g["lines"]) == {"hardrockbet", "fanduel"} and g["line"] == g["lines"]["hardrockbet"], "both books stored; v1 'line' = Hard Rock", "games")
check(g["lines"]["fanduel"]["homeML"] == -180 and g["lines"]["fanduel"]["homeSpread"] == -3.5 and g["lines"]["fanduel"]["total"] == 48.0, "FanDuel prices parsed", "games")
check(pull["spent"] == 3 and pull["spentBy"] == {"games": 3} and pull["remaining"] == 99970 and pull["used"] == 30, "3 credits for both books, headers tracked", "games")
pull2 = dict(pull, due={"nba"}, spent=0, pulled=[], skipped=[])
e2, m2 = BD.odds_pull_league(L["nfl"], games, pull2, "t")
check(e2 is None and "not due" in m2 and len(urls) == 1, "interval gate: league not due -> no request", "games")
pull3 = dict(pull, spent=249, pulled=[], skipped=[])
e3, m3 = BD.odds_pull_league(L["nfl"], games, pull3, "t")
check(e3 is None and "cap" in m3 and len(urls) == 1, "per-run cap stops the request", "games")
pull4 = dict(pull, remaining=301, spent=0, pulled=[], skipped=[])
e4, m4 = BD.odds_pull_league(L["nfl"], games, pull4, "t")
check(e4 is None and len(urls) == 1, "reserve floor stops the request", "games")
def boom(url): raise RuntimeError(f"HTTP Error 401 for {url}")
BD.get = boom
pull5 = dict(pull, spent=0, pulled=[], skipped=[], errors=[])
e5, m5 = BD.odds_pull_league(L["nfl"], games, pull5, "t")
check(e5 is None and K not in m5 and urllib.parse.quote(K) not in m5 and pull5["errors"] == ["nfl"], f"error message scrubbed: {m5[:90]}", "games")
check(L["ufc"].get("odds_books") == "hardrockbet" and BD.ODDS_MMA is False, "UFC untouched: ODDS_MMA off, Hard Rock only if ever enabled", "games")

# apply: fresh game gets both books (overriding ESPN's FanDuel copy), started game gets stale markers; v1 cache still works
cache = dict(v=1, leagues={"nfl": dict(entry, games=dict(entry["games"], **{"502": dict(date=games[1]["date"], lines=g["lines"])}))})
gs = [dict(x, books={"fanduel": dict(homeML=-999, source="ESPN (FanDuel)")}) for x in games]
fresh, stale = BD.apply_cached_odds(L["nfl"], gs, cache, T(2026, 10, 26, 16))
check(fresh == 1 and stale == 1 and gs[0]["books"]["fanduel"]["homeML"] == -180 and gs[0]["books"]["fanduel"]["source"] == "The Odds API", "fresh: FanDuel from the Odds API", "apply")
check(gs[1]["books"]["hardrockbet"]["stale"] and gs[1]["books"]["fanduel"]["stale"] and "homeML" not in gs[1]["books"]["fanduel"], "started: stale markers, no numbers", "apply")
v1 = dict(v=1, leagues={"nfl": dict(pulledAt="2026-10-25T15:10:00Z", games={"501": dict(date=games[0]["date"], line=dict(homeML=-150))})})
gs = [dict(games[0], books={})]
BD.apply_cached_odds(L["nfl"], gs, v1, T(2026, 10, 26, 16))
check(gs[0]["books"] == {"hardrockbet": dict(homeML=-150, asOf="2026-10-25T15:10:00Z", source="The Odds API")}, "old v1 cache (Hard Rock only) still applies", "apply")

# ================================================================ run planning (free calls only) with a fake API
def fake_plan_get(evmap, rem="99000", used="1000"):
    def _get(url):
        urls.append(url)
        if "/v4/sports/?" in url: return [], {"x-requests-remaining": rem, "x-requests-used": used}
        for sk, evs in evmap.items():
            if f"/sports/{sk}/events?" in url: return evs, {"x-requests-remaining": rem, "x-requests-used": used, "x-requests-last": "0"}
        return [], {"x-requests-remaining": rem, "x-requests-used": used, "x-requests-last": "0"}
    return _get
nowz = dt.datetime.now(UTC)
soon = (nowz + dt.timedelta(hours=5)).strftime("%Y-%m-%dT%H:%M:%SZ"); later = (nowz + dt.timedelta(days=3)).strftime("%Y-%m-%dT%H:%M:%SZ")
urls.clear()
BD.get = fake_plan_get({"americanfootball_nfl": [dict(id="a", commence_time=soon), dict(id="b", commence_time=later)],
                        "basketball_nba": [dict(id="c", commence_time=soon)]})
cache = dict(v=1, leagues={"nba": dict(pulledAt=(nowz - dt.timedelta(minutes=10)).isoformat())}, checks=[])
pull, chk, budget, pev = BD.odds_plan_run(K, ["nfl", "nba", "mlb", "ufc"], cache, None, "t0")
check(all("/events?" in u or "/v4/sports/?" in u for u in urls), "planning makes only free calls (/sports, /events)", "plan")
check(not any("mma" in u for u in urls), "planning never touches MMA while ODDS_MMA is off", "plan")
check(budget["level"] == "full" and budget["gamesPerRun"] == 6 and budget["propsPerRun"] == 5 + 4, f"estimates from live events: {budget['gamesPerRun']} game, {budget['propsPerRun']} props credits/run", "plan")
check(pull["due"] == {"nfl"} and "not due" in pull["why"]["nba"] and "no events" in pull["why"]["mlb"], f"due {pull['due']} why {pull['why']}", "plan")
check([e["id"] for e in pev["nfl"]] == ["a"] and [e["id"] for e in pev["nba"]] == ["c"], "props candidates: events within 36h only", "plan")
check(cache["quota"]["remaining"] == 99000 and cache["quota"]["level"] == "full", "quota persisted in the cache", "plan")
check(K not in json.dumps(cache) and K not in json.dumps(chk), "key never stored", "plan")
os.environ["ODDS_PAUSE"] = "1"; urls.clear()
pull, chk, budget, pev = BD.odds_plan_run(K, ["nfl"], cache, None, "t1")
check(pull is None and not urls and "paused" in chk["action"], "ODDS_PAUSE=1 kill switch: no calls at all", "plan")
del os.environ["ODDS_PAUSE"]
BD.get = fake_plan_get({}, rem="250", used="99750")
pull, chk, budget, pev = BD.odds_plan_run(K, ["nfl"], dict(v=1, leagues={}, checks=[]), None, "t2")
check(pull is None and budget["level"] == "stop", "below floor -> stop, no paid calls", "plan")
u = dict(v=1, leagues={}, checks=[])
BD.odds_usage_update(u, dict(t="t", used=100, usedAfter=130, spent=30, spentBy=dict(games=18, props=12)))
BD.odds_usage_update(u, dict(t="t2", used=130, usedAfter=133, spent=3, spentBy=dict(games=3)))
check(u["usage"]["games"] == 21 and u["usage"]["props"] == 12 and u["usage"]["runs"] == 2 and u["usage"]["paidRuns"] == 2, "usage tally per cycle", "plan")
BD.odds_usage_update(u, dict(t="t3", used=5, usedAfter=5, spent=0, spentBy={}))
check(u["usage"]["games"] == 0 and u["usage"]["runs"] == 1, "usage resets when the used counter drops", "plan")

# ================================================================ props: parse + pull
def oc(name, who, price, point=None):
    d = dict(name=name, description=who, price=price)
    if point is not None: d["point"] = point
    return d
PEV = dict(id="pe1", bookmakers=[
    dict(key="hardrockbet", markets=[
        dict(key="player_points", outcomes=[oc("Over", "Luka Dončić", -115, 31.5), oc("Under", "Luka Dončić", -105, 31.5),
                                            oc("Over", "Luka Dončić", +150, 35.5), oc("Under", "Luka Dončić", -190, 35.5),   # alt line: dropped
                                            oc("Over", "Jaren Jackson Jr.", -110, 18.5), oc("Under", "Jaren Jackson Jr.", -110, 18.5)]),
        dict(key="player_rebounds", outcomes=[oc("Over", "Luka Dončić", -120, 8.5)]),                                          # one side only
        dict(key="player_blocks", outcomes=[oc("Over", "Jaren Jackson Jr.", -110, 1.5)])]),                                      # market we don't use
    dict(key="fanduel", markets=[dict(key="player_points", outcomes=[oc("Over", "Luka Doncic", -112, 32.5), oc("Under", "Luka Doncic", -108, 32.5)])]),
    dict(key="draftkings", markets=[dict(key="player_points", outcomes=[oc("Over", "Luka Doncic", -110, 30.5)])])])
P = OP.parse_event_odds("nba", PEV)
check(set(P) == {"hardrockbet", "fanduel"}, "only Hard Rock + FanDuel kept", "props")
check(P["hardrockbet"]["points"]["Luka Dončić"] == [31.5, -115, -105], "main line = most balanced over/under pair", "props")
check(P["hardrockbet"]["rebounds"]["Luka Dončić"] == [8.5, -120, None] and "blocks" not in P["hardrockbet"], "one-sided line kept, unused market ignored", "props")
TD = dict(bookmakers=[dict(key="fanduel", markets=[dict(key="player_anytime_td", outcomes=[oc("Yes", "Kenneth Walker III", +120), oc("No", "Kenneth Walker III", -160)])])])
check(OP.parse_event_odds("nfl", TD) == {"fanduel": {"anytime_td": {"Kenneth Walker III": [0.5, 120, -160]}}}, "anytime TD yes/no -> 0.5 line", "props")
check(OP.norm_player("Kenneth Walker III") == "kenneth walker" and OP.norm_player("Luka Dončić") == "luka doncic" and OP.norm_player("D'Andre Swift") == "dandre swift", "name normalization", "props")

idx_games = [dict(id="901", state="pre", date=soon, home=dict(id="1", name="Dallas Mavericks", abbr="DAL"), away=dict(id="2", name="Memphis Grizzlies", abbr="MEM")),
             dict(id="902", state="pre", date=later, home=dict(id="3", name="A", abbr="AAA"), away=dict(id="4", name="B", abbr="BBB"))]
pev = [dict(id="pe1", commence_time=soon, home_team="Dallas Mavericks", away_team="Memphis Grizzlies"),
       dict(id="pe2", commence_time=later, home_team="A", away_team="B")]
urls.clear()
def fake_props_get(url):
    urls.append(url); return PEV, {"x-requests-remaining": "98996", "x-requests-used": "1004", "x-requests-last": "3"}
pull = dict(key=K, remaining=99000, used=1000, spent=0, pulled=[], skipped=[], errors=[], floor=300, cap=250)
prev = dict(pulledAt="old", games={"900": dict(date=soon, at="old", books={}), "901": dict(date=soon, at="old", books={"fanduel": {}})})
ent, msg = OP.pull_league(dict(key="nba", odds_key="basketball_nba"), pev, idx_games, pull, "t9", fake_props_get, BD.match_event,
                          BD.odds_note_headers, BD.scrub, nowz, BD.ODDS_API, prev=prev)
q = urllib.parse.parse_qs(urllib.parse.urlparse(urls[0]).query)
check(len(urls) == 1 and "/events/pe1/odds" in urls[0] and q["bookmakers"] == ["hardrockbet,fanduel"] and q["markets"] == ["player_points,player_rebounds,player_assists,player_threes"],
      "per-event endpoint, 36h window, both books, 4 NBA markets", "props")
check(pull["spentBy"] == {"props": 3} and ent["cost"] == 3, "cost tracked from x-requests-last", "props")
check(ent["games"]["901"]["at"] == "t9" and ent["games"]["900"]["at"] == "old", "refreshed game replaced, others kept from previous pull", "props")
check(K not in json.dumps(ent) and K not in msg, "key not in props entry/message", "props")
pull_cap = dict(pull, spent=248)
urls.clear()
ent2, msg2 = OP.pull_league(dict(key="nba", odds_key="basketball_nba"), pev, idx_games, pull_cap, "t10", fake_props_get, BD.match_event,
                            BD.odds_note_headers, BD.scrub, nowz, BD.ODDS_API)
check(not urls and ent2 is None and "skipped" in msg2, "per-run cap: props skipped before any request", "props")

# ================================================================ props merge next to DraftKings
def item(pid, typ, cur, opn=None):
    return dict(athlete={"$ref": f"http://x/athletes/{pid}"}, type=dict(name=typ), current=dict(target=dict(value=cur)),
                open=dict(target=dict(value=opn)) if opn is not None else {}, lastUpdated="2026-10-26T12:00Z")
hist_games = {"g1": dict(d="2026-10-22T23:00Z", h="1", a="5", b={"1": dict(p=[["100", "G", 33, 9, 8, 4]]), "5": dict(p=[])}),
              "g2": dict(d="2026-10-24T23:00Z", h="2", a="6", b={"2": dict(p=[["200", "F", 20, 5, 1, 2]]), "6": dict(p=[])})}
def getj(url):
    if "/events/901/" in url: return dict(pageCount=1, items=[item("100", "Total Points", 30.5, 29.5)])
    raise RuntimeError("404")
extra = dict(pulledAt="t9", games={"901": dict(date=soon, at="2026-10-26T16:00:00Z", books={
    "hardrockbet": {"points": {"Luka Dončić": [31.5, -115, -105], "Jaren Jackson Jr.": [18.5, -110, -110], "Nobody Here": [5.5, -110, -110]},
                    "rebounds": {"Luka Doncic": [8.5, -120, None]}},
    "fanduel": {"points": {"Luka Doncic": [30.5, -112, -108]}}}),
    "902": dict(date=later, at="x", books={"fanduel": {"points": {"Luka Doncic": [1.5, 100, 100]}}})})
with tempfile.TemporaryDirectory() as td:
    sd = os.path.join(td, "search"); os.makedirs(sd)
    json.dump(dict(teams=[["1", "Mavericks", "DAL"], ["2", "Grizzlies", "MEM"]],
                   players=[["100", "Luka Dončić", 0, "G"], ["200", "Jaren Jackson Jr.", 1, "F"], ["300", "Bench Guy", 1, "G"]]), open(os.path.join(sd, "nba.json"), "w"))
    rep = PR.build_props(dict(key="nba", path="basketball/nba"), getj, os.path.join(td, "props"), sd, games=hist_games,
                         index=dict(games=idx_games), now=nowz, log=lambda *a: None, extra=extra)
    doc = json.load(open(os.path.join(td, "props", "nba.json")))
rows = {(r[0], r[1]): r for r in doc["games"]["901"]["props"]}
r = rows[("100", "points")]
check(r[2] == 30.5 and r[3] == 29.5 and r[5]["draftkings"] == [30.5, None, None, None], "DraftKings line stays the row line (with its open)", "merge")
check(r[5]["hardrockbet"][:3] == [31.5, -115, -105] and r[5]["hardrockbet"][3] == [1, 0, 0, 1], "Hard Rock line + prices + its own tally (33 > 31.5)", "merge")
check(r[5]["fanduel"] == [30.5, -112, -108, None], "FanDuel same line as DraftKings -> tally null (reuse row's)", "merge")
r = rows[("200", "points")]
check(r[2] == 18.5 and r[3] is None and "draftkings" not in r[5] and r[4] == [1, 0, 0, 1], "Hard Rock-only player: row uses Hard Rock's line, accents/Jr. matched", "merge")
check(rows[("100", "rebounds")][5] == {"hardrockbet": [8.5, -120, None, None]}, "Hard Rock-only market added", "merge")
check("902" not in doc["games"] or all(len(x) < 6 for x in doc["games"]["902"]["props"]), "games outside the props window aren't invented (902 not in index window)", "merge")
check(rep["altUnmatchedNames"] == 2 and rep["hardrockFanduelRows"] == 3, f"unmatched names counted (Nobody Here + Luka listed under a game he is not in): {rep['altUnmatchedNames']}", "merge")
check(doc["books"] == ["draftkings", "hardrockbet", "fanduel"] and doc["altAt"] == "2026-10-26T16:00:00Z" and "Hard Rock Bet" in doc["book"], f"doc books {doc['books']}", "merge")
check("200" in doc["players"] and doc["players"]["200"]["ta"] == "MEM", "Hard Rock-only player gets his history", "merge")
# no extra -> identical to the DraftKings-only format
with tempfile.TemporaryDirectory() as td:
    sd = os.path.join(td, "search"); os.makedirs(sd)
    json.dump(dict(teams=[["1", "Mavericks", "DAL"], ["2", "Grizzlies", "MEM"]], players=[["100", "Luka Dončić", 0, "G"]]), open(os.path.join(sd, "nba.json"), "w"))
    PR.build_props(dict(key="nba", path="basketball/nba"), getj, os.path.join(td, "props"), sd, games=hist_games, index=dict(games=idx_games), now=nowz, log=lambda *a: None)
    d0 = json.load(open(os.path.join(td, "props", "nba.json")))
check(all(len(r) == 5 for r in d0["games"]["901"]["props"]) and d0["books"] == ["draftkings"] and d0["altAt"] is None, "keyless/no-cache build: DraftKings-only rows", "merge")

# ================================================================ apply-odds (push-race merge) keeps quota/usage + props file
with tempfile.TemporaryDirectory() as td:
    src, dst = os.path.join(td, "s"), os.path.join(td, "d"); os.makedirs(src); os.makedirs(dst)
    json.dump(dict(v=1, leagues={"nfl": dict(pulledAt="2026-10-26T16:00Z")}, checks=[dict(t="b")], quota=dict(t="2026-10-26T16:00Z", remaining=5)), open(os.path.join(src, "hardrockbet.json"), "w"))
    json.dump(dict(v=1, leagues={"nfl": dict(pulledAt="2026-10-26T15:30Z"), "nba": dict(pulledAt="x")}, checks=[dict(t="a")], quota=dict(t="2026-10-26T15:30Z", remaining=9)), open(os.path.join(dst, "hardrockbet.json"), "w"))
    json.dump(dict(v=1, book="props", leagues={"nba": dict(pulledAt="2026-10-26T16:00Z", games={})}, checks=[]), open(os.path.join(src, "props_oddsapi.json"), "w"))
    LH.apply_odds(src, dst)
    m = json.load(open(os.path.join(dst, "hardrockbet.json"))); pp = json.load(open(os.path.join(dst, "props_oddsapi.json")))
check(m["leagues"]["nfl"]["pulledAt"] == "2026-10-26T16:00Z" and "nba" in m["leagues"] and m["quota"]["remaining"] == 5 and len(m["checks"]) == 2, "apply-odds: newer league + quota win", "apply")
check(pp["leagues"]["nba"]["pulledAt"] == "2026-10-26T16:00Z", "apply-odds: props cache merged too", "apply")

print(f"\nodds_paid_test: {'ALL PASS' if not fails else str(len(fails)) + ' FAILED'}")
sys.exit(1 if fails else 0)
