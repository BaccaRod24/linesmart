"""Offline tests for the advanced-stats modules: line value (no-vig / edge / outliers / value spots), ATS + O/U grading,
NBA possessions / pace / ratings / usage / rest, and nflverse EPA aggregation. No network, no Odds API.
Run: env -u ODDS_API_KEY python3 scripts/adv_test.py"""
import datetime as dt, json, os, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import linevalue as LV, ats as ATS, adv_nba as NBA, adv_nfl as NFL

ok = fail = 0
def check(c, msg):
    global ok, fail
    if c: ok += 1
    else: fail += 1; print("FAIL:", msg)
near = lambda a, b, eps=1e-6: a is not None and b is not None and abs(a - b) < eps

# ---------------------------------------------------------------- implied / no-vig / edge
check(near(LV.implied(-110), 110 / 210), "implied -110")
check(near(LV.implied(150), 0.4), "implied +150")
check(LV.implied(0) is None and LV.implied(None) is None, "implied rejects 0/None")
check(near(LV.decimal(-200), 1.5) and near(LV.decimal(100), 2.0), "decimal odds")
nv = LV.no_vig([-110, -110])
check(near(nv[0], 0.5) and near(nv[1], 0.5), "-110/-110 de-vigs to 50/50")
nv = LV.no_vig([-150, 130])
check(near(sum(nv), 1.0) and nv[0] > nv[1], "no-vig sums to 1, favourite first")
check(near(nv[0], 0.6 / (0.6 + 100 / 230)), "multiplicative de-vig")
check(LV.no_vig([-110, None]) is None, "missing price -> None")
nv3 = LV.no_vig([250, 240, -105])
check(near(sum(nv3), 1.0), "3-way (soccer) no-vig sums to 1")
check(LV.to_american(0.5) == -100 and LV.to_american(0.6) == -150 and LV.to_american(0.4) == 150, "to_american")
check(near(LV.edge(0.5, 100), 0.0) and near(LV.edge(0.5, -110), 0.5 * (1 + 100 / 110) - 1), "edge = p*dec - 1")
check(LV.edge(0.5, -110) < 0 < LV.edge(0.5, 110), "edge sign")

# ---------------------------------------------------------------- analyze: consensus, fair, outliers
bk = lambda hs, hso, aso, hml, aml, tot, oo, uo: dict(homeSpread=hs, awaySpread=-hs if hs is not None else None, homeSpreadOdds=hso, awaySpreadOdds=aso,
                                                       homeML=hml, awayML=aml, total=tot, overOdds=oo, underOdds=uo)
books = dict(draftkings=bk(-3.5, -110, -110, -170, 145, 47.5, -110, -110),
             fanduel=bk(-3.5, -112, -108, -175, 150, 47.5, -108, -112),
             hardrockbet=bk(-1.5, -110, -110, -120, 150, 45.5, -110, -110))
A = LV.analyze(books, "football")
S = A["spread"]
check(S["line"] == -3.5 and S["n"] == 2, "spread consensus = the line two books hang")
check(near(S["fair"]["home"], (LV.no_vig([-110, -110])[1] + LV.no_vig([-108, -112])[1]) / 2), "fair = mean of no-vig on the consensus line")
check(S["books"]["hardrockbet"]["out"] == ["home"] and S["books"]["hardrockbet"]["edge"] is None, "home -1.5 vs -3.5 consensus -> home-side line outlier, no edge (different line)")
check(A["total"]["books"]["hardrockbet"]["out"] == ["over"], "total 45.5 vs 47.5 -> over-side outlier")
M = A["ml"]
check(M["n"] == 3, "moneyline: all books on the (null) line")
check(M["books"]["hardrockbet"]["out"] == ["home"], "HR -120 vs -170/-175: home price 3+ pp better -> price outlier")
check(M["books"]["draftkings"]["out"] == [] and M["books"]["fanduel"]["out"] == [], "others are not outliers")
check(M["books"]["hardrockbet"]["edge"]["home"] > 0, "outlier price shows a positive edge vs the consensus")
# 1-point gap is below the football threshold; 0.5 is enough in hockey
b2 = dict(draftkings=bk(-3.5, -110, -110, None, None, None, None, None), fanduel=bk(-3.5, -110, -110, None, None, None, None, None),
          hardrockbet=bk(-2.5, -110, -110, None, None, None, None, None))
check(LV.analyze(b2, "football")["spread"]["books"]["hardrockbet"]["out"] == [], "1-point gap is not a football outlier")
b3 = dict(draftkings=bk(-1.5, 150, -170, None, None, 6.5, -110, -110), fanduel=bk(-1.5, 155, -180, None, None, 6.5, -112, -108),
          hardrockbet=bk(-1.5, 150, -170, None, None, 6.0, -110, -110))
check(LV.analyze(b3, "hockey")["total"]["books"]["hardrockbet"]["out"] == ["over"], "0.5 total gap is a hockey outlier")
# two books on different lines -> no consensus, no fair line
b4 = dict(draftkings=bk(-3.5, -110, -110, None, None, None, None, None), fanduel=bk(-3.0, -110, -110, None, None, None, None, None))
check(LV.analyze(b4, "football")["spread"]["fair"] is None, "tie between lines -> no consensus")
check(LV.analyze(dict(draftkings=books["draftkings"]), "football")["spread"]["fair"] is None, "one book -> no fair line")
check("spread" not in LV.analyze(books, "mma") and "total" not in LV.analyze(books, "mma"), "mma: moneyline only")
check(LV.label({"away": {"abbr": "DAL"}, "home": {"abbr": "PHI"}}, "spread", "away", -3.5) == "DAL +3.5", "spread label flips for the away side")
check(LV.label({"away": {"abbr": "DAL"}, "home": {"abbr": "PHI"}}, "total", "under", 47.5) == "Under 47.5", "total label")

# ---------------------------------------------------------------- value_spots on a synthetic data dir
now = dt.datetime(2026, 10, 26, 16, 0, tzinfo=dt.timezone.utc)
with tempfile.TemporaryDirectory() as d:
    os.makedirs(os.path.join(d, "nfl"))
    g = lambda i, hrs, state="pre", bks=books: dict(id=i, date=(now + dt.timedelta(hours=hrs)).strftime("%Y-%m-%dT%H:%MZ"), state=state,
                                                     away=dict(abbr="DAL"), home=dict(abbr="PHI"), books=bks)
    idx = dict(league=dict(kind="football"), games=[g(1, 3), g(2, 60), g(3, -1, "in"), g(4, 5, "pre", {"draftkings": books["draftkings"]})])
    json.dump(idx, open(os.path.join(d, "nfl", "index.json"), "w"))
    V = LV.value_spots(d, ["nfl", "missing"], now=now)
    ids = {r["id"] for r in V["rows"]} | {r["id"] for r in V["lines"]}
    check(ids == {"1"}, "value spots: only pre-game games inside 36 h with 2+ books")
    check(any(r["mk"] == "ml" and r["o"] == "home" and "hardrockbet" in r["offers"] and r["offers"]["hardrockbet"][2] == 1 for r in V["rows"]), "HR outlier price listed with its flag")
    check(all(v[1] >= LV.VALUE_MIN_EDGE * 100 and v[0] <= LV.VALUE_MAX_PRICE for r in V["rows"] for v in r["offers"].values()), "rows respect min edge / max price")
    check(V["rows"] == sorted(V["rows"], key=lambda r: -max(v[1] for v in r["offers"].values())), "rows sorted by best edge")
    check({(x["mk"], x["bk"]) for x in V["lines"]} == {("spread", "hardrockbet"), ("total", "hardrockbet")}, "line outliers listed")
    check(V["lines"][0]["lbl"] == "PHI -1.5" and V["lines"][0]["cons"] == "PHI -3.5", "line outlier labels")

# ---------------------------------------------------------------- ATS / O-U grading with pushes
check(ATS.grade_ats(7, -3.5) == "W" and ATS.grade_ats(3, -3.5) == "L", "favourite covers / fails")
check(ATS.grade_ats(3, -3) == "P", "push on the number")
check(ATS.grade_ats(-2, 3) == "W" and ATS.grade_ats(-3, 3) == "P" and ATS.grade_ats(-4, 3) == "L", "underdog grading incl. push")
check(ATS.grade_ou(48, 47.5) == "O" and ATS.grade_ou(47, 47.5) == "U" and ATS.grade_ou(47, 47) == "P", "O/U incl. push")
games = {
    "1": dict(d="2026-09-10", h="A", a="B", hs=24, **{"as": 20}, sp=-3.0, tot=44.0),   # A covers by 1, total 44 push
    "2": dict(d="2026-09-17", h="B", a="A", hs=27, **{"as": 24}, sp=-3.0, tot=50.5),   # B wins by 3 = push, 51 = over
    "3": dict(d="2026-09-24", h="A", a="C", hs=10, **{"as": 17}, sp=-6.5, tot=40.0),   # A fails, under
    "4": dict(d="2026-10-01", h="C", a="A", hs=None, **{"as": None}, sp=-1.0, tot=40.0),  # not final -> skipped
    "5": dict(d="2026-10-08", h="A", a="B", hs=30, **{"as": 28}, sp=None, tot=55.0),   # no spread: O/U only
}
R = ATS.team_records(games)
check(R["A"]["ats"]["all"] == [1, 1, 1], "A ATS 1-1-1")
check(R["A"]["ats"]["home"] == [1, 1, 0] and R["A"]["ats"]["away"] == [0, 0, 1], "A home/away split")
check(R["A"]["ou"]["all"] == [2, 1, 1], "A O/U 2-1-1 (push on 44)")
check(R["A"]["last"] == "WPL" and R["A"]["lastOU"] == "POUO", "recent strings in date order")
check(R["B"]["ats"]["all"] == [0, 1, 1] and R["C"]["ats"]["all"] == [1, 0, 0], "opponents graded from their side")
many = {str(i): dict(d=f"2026-09-{i:02d}", h="A", a="Z", hs=10 + i % 2, **{"as": 10}, sp=-0.5, tot=30.0) for i in range(1, 14)}
R2 = ATS.team_records(many)
check(sum(R2["A"]["ats"]["l10"]) == 10 and sum(R2["A"]["ats"]["all"]) == 13, "last-10 bucket holds 10 games")

# ---------------------------------------------------------------- NBA possessions / pace / ratings / usage
check(near(NBA.possessions(88, 10, 14, 25), 88 - 10 + 14 + 11), "possessions formula")
check(NBA.game_minutes(4) == 48 and NBA.game_minutes(5) == 53 and NBA.game_minutes(6) == 58, "overtime minutes")
check(near(NBA.pace(100, 48), 100) and near(NBA.pace(106, 53), 48 * 106 / 53), "pace per 48")
u = NBA.usage(20, 6, 3, 36, 88, 25, 14, 240)
check(near(u, 100 * (20 + 0.44 * 6 + 3) * 48 / (36 * (88 + 11 + 14))), "usage formula")
check(NBA.usage(1, 0, 0, 0, 88, 25, 14, 240) is None, "zero minutes -> no usage")
# t = [pts?, fga, fta, oreb, tov] per matchups compact box (index 1..4 used)
mk = lambda d, h, a, sh, sa, th, ta, per=4: dict(d=d, h=h, a=a, s={h: sh, a: sa}, per=per, b={h: dict(t=th), a: dict(t=ta)})
G = {"1": mk("2026-10-21T23:00Z", "H", "V", 110, 100, [0, 88, 20, 10, 12], [0, 90, 22, 12, 14]),
     "2": mk("2026-10-23T23:00Z", "V", "H", 120, 118, [0, 95, 25, 11, 13], [0, 92, 24, 9, 15], per=5)}
T, L = NBA.team_ratings(G)
p1h, p1v = NBA.possessions(88, 10, 12, 20), NBA.possessions(90, 12, 14, 22)
p2v, p2h = NBA.possessions(95, 11, 13, 25), NBA.possessions(92, 9, 15, 24)
poss = (p1h + p1v) / 2 + (p2v + p2h) / 2
check(near(T["H"]["ortg"], round(100 * (110 + 118) / poss, 1)), "offensive rating per 100 possessions")
check(near(T["H"]["drtg"], round(100 * (100 + 120) / poss, 1)), "defensive rating")
check(near(T["H"]["pace"], round(48 * poss / (48 + 53), 1)), "team pace with OT")
check(T["H"]["l10"] == [1, 1] and T["V"]["l10"] == [1, 1], "last-10 record")
check(near(L["pace"], round(48 * poss / (48 + 53), 1)), "league pace")
check(T["H"]["rk"]["net"] in (1, 2), "ranks attached")
check(NBA.rest_days("2026-10-25T23:00Z", "2026-10-26T23:30Z") == 0, "played yesterday (ET) -> 0 rest days")
check(NBA.rest_days("2026-10-24T02:00Z", "2026-10-26T23:30Z") == 2, "late tip converts to ET date")
ctx = NBA.game_context([dict(id=9, state="pre", date="2026-10-24T23:30Z", home=dict(id="H"), away=dict(id="V"))], T, L, G)
check(ctx["9"]["h"]["b2b"] is True and ctx["9"]["h"]["rest"] == 0, "back-to-back flag")
check(near(ctx["9"]["pace"], round(T["H"]["pace"] * T["V"]["pace"] / L["pace"], 1)), "projected pace = pH*pA/lg")

# ---------------------------------------------------------------- nflverse EPA aggregation (synthetic play-by-play)
def play(**k):
    base = dict(game_id="G1", posteam="KC", defteam="BUF", week="1", epa="0", success="0", yardline_100="50", down="1",
                fixed_drive="1", fixed_drive_result="Punt", id="NA", qb_epa="NA", cpoe="NA", qb_dropback="0")
    base.update({kk: str(v) for kk, v in k.items()}); return base
rows = [
    play(**{"pass": 1}, epa=0.5, success=1, qb_dropback=1, id="QB1", qb_epa=0.5, cpoe=10, pass_attempt=1, receiver_player_id="WR1", complete_pass=1),
    play(**{"pass": 1}, epa=-1.0, success=0, qb_dropback=1, id="QB1", qb_epa=-1.0, cpoe=-20, pass_attempt=1, receiver_player_id="WR2", third_down_failed=1),
    play(rush=1, epa=0.25, success=1, play_type="run", rush_attempt=1, rusher_player_id="RB1", third_down_converted=1),
    play(rush=1, epa=1.0, success=1, play_type="run", rush_attempt=1, rusher_player_id="RB1", yardline_100=5, fixed_drive=2, fixed_drive_result="Touchdown"),
    play(rush=1, epa=-0.5, success=0, play_type="run", rush_attempt=1, rusher_player_id="RB2", yardline_100=15, fixed_drive=3, fixed_drive_result="Field goal"),
    play(posteam="BUF", defteam="KC", **{"pass": 1}, epa=2.0, success=1, qb_dropback=1, id="QB2", qb_epa=2.0, cpoe=5, pass_attempt=1, receiver_player_id="WR3", fixed_drive=4),
    play(**{"pass": 0}, rush=0, epa=3.0, play_type="punt", fixed_drive=5),          # special teams: not counted in EPA/play
]
Tm, Q, U, TG = NFL.aggregate_pbp(rows)
F = NFL.finish_teams(Tm)
check(F["KC"]["off"]["plays"] == 5, "only pass/rush plays count")
check(near(F["KC"]["off"]["epa"], round((0.5 - 1.0 + 0.25 + 1.0 - 0.5) / 5, 3)), "offensive EPA/play")
check(near(F["KC"]["off"]["sr"], 0.6), "success rate")
check(near(F["KC"]["off"]["pepa"], -0.25) and near(F["KC"]["off"]["repa"], round(0.75 / 3, 3)), "pass / rush EPA split")
check(near(F["BUF"]["dfn"]["epa"], F["KC"]["off"]["epa"]), "defense EPA allowed mirrors the opponent's offense")
check(near(F["KC"]["off"]["rz"], 0.5), "red-zone TD rate: 1 TD in 2 red-zone drives")
check(near(F["KC"]["off"]["td3"], 0.5) and near(F["BUF"]["dfn"]["td3"], 0.5), "3rd-down conversion")
check(F["BUF"]["off"]["rk"]["epa"] == 1 and F["KC"]["off"]["rk"]["epa"] == 2, "offense rank: higher EPA is better")
check(F["KC"]["dfn"]["rk"]["epa"] == 2 and F["BUF"]["dfn"]["rk"]["epa"] == 1, "defense rank: lower EPA allowed is better")
QQ, nq = NFL.finish_qbs(Q)
check(near(QQ["QB1"]["epa"], -0.25) and near(QQ["QB1"]["cpoe"], -5.0) and QQ["QB1"]["db"] == 2, "QB EPA/dropback and CPOE")
check(nq == 0 and QQ["QB1"]["qual"] is False, "QBs under 100 dropbacks are unranked")
Us = NFL.finish_usage(U, TG, snaps={"WR1": {"G1": (0.8, "KC", 1)}, "RB1": {"G1": (0.6, "KC", 1)}})
check("WR2" not in Us, "tiny samples without snap data are dropped")
check(near(Us["WR1"]["snap"][0], 0.8), "snap share from snap counts")
check(near(Us["WR1"]["tgt"][0], 0.5) and near(Us["RB1"]["car"][0], round(2 / 3, 3)), "target / carry share of team totals")
check(near(Us["RB1"]["rz"][0], 1.0), "red-zone touches per game")
check(NFL.trend(0.20, 0.24) == "up" and NFL.trend(0.20, 0.22) == "flat" and NFL.trend(0.80, 0.74, "snap") == "down", "trend thresholds")

print(f"adv_test: {ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
