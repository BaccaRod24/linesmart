"""Opening lines stay on the right side, and a stale open is not the opener.

ESPN sometimes reports the opening spread on the opposite side of the opening moneyline
(Pacers at Heat, Rockets at Mavericks on 2026-10-30) and an opening total that never
appears in the recorded snapshots (Hornets at Wizards, 234.5 vs a series at 219.5-223.5).
Week 9 Jaguars at Ravens carried the Week 8 Jaguars opener (-4.5, -218, +180, 49.5)
even though the recorded line was already Baltimore -2.5. DAL @ SA (401909933) has
both the spread and the moneyline on the wrong teams: the stored open is the first
recorded point with home and away exchanged. An ESPN DraftKings open can also be an
early-season number that never trades: the spread and the moneyline agree, so it
looks like a real flip, but it sits more than a field goal from every snapshot
(Tennessee at Texas A&M) or the total sits more than 6 points off (football). A real
move whose open matches the first snapshot (Oregon State at Boise State) stays.
The shapes below are the stored history rows. Offline: no network, no Odds API key.

Run: env -u ODDS_API_KEY python3 scripts/open_line_test.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import line_history as LH

ok = fail = 0


def check(c, msg):
    global ok, fail
    if c:
        ok += 1
    else:
        fail += 1
        print("FAIL:", msg)


# Pacers at Heat. Miami is home. ESPN open: Miami +3.5 and -155. First recorded line: Miami -4.5 and -180.
mia_open = dict(hs=3.5, **{"as": -3.5}, hml=-155, aml=130, tot=240.5)
mia_pts = [dict(hs=-4.5, **{"as": 4.5}, hml=-180, aml=150, tot=239.5),
           dict(hs=-8.5, **{"as": 8.5}, hml=-325, aml=260, tot=237.5)]
mia = LH.reconcile_open(mia_open, mia_pts, "basketball")
check(mia["hs"] == -3.5 and mia["as"] == 3.5, f"Heat opening spread swaps onto the favorite ({mia['hs']}/{mia['as']})")
check(mia["hml"] == -155 and mia["aml"] == 130, "Heat opening moneyline stays -155/+130")
check(mia["tot"] == 240.5, "Heat total 240.5 is within a point of the series and stays")

# Rockets at Mavericks. Dallas is home. ESPN open: Dallas -4.5 and +145. First recorded: Dallas +5.5 and +154.
dal_open = dict(hs=-4.5, **{"as": 4.5}, hml=145, aml=-175, tot=225.5)
dal_pts = [dict(hs=5.5, **{"as": -5.5}, hml=154, aml=-185, tot=227.5),
           dict(hs=6.5, **{"as": -6.5}, hml=195, aml=-238, tot=223.5)]
dal = LH.reconcile_open(dal_open, dal_pts, "basketball")
check(dal["hs"] == 4.5 and dal["as"] == -4.5, f"Mavericks opening spread swaps onto the dog ({dal['hs']}/{dal['as']})")
check(dal["hml"] == 145 and dal["aml"] == -175, "Mavericks opening moneyline stays +145/-175")
check(dal["tot"] == 225.5, "Mavericks total 225.5 is next to the series and stays")

# Hornets at Wizards. Spread and moneyline agree. Total 234.5 never appears; series is 223.5 then 219.5.
cha_open = dict(hs=1.5, **{"as": -1.5}, hml=-105, aml=-115, tot=234.5)
cha_pts = [dict(hs=1.5, **{"as": -1.5}, hml=-105, aml=-115, tot=223.5),
           dict(hs=-1.5, **{"as": 1.5}, hml=-118, aml=-102, tot=219.5)]
cha = LH.reconcile_open(cha_open, cha_pts, "basketball")
check(cha["hs"] == 1.5 and cha["as"] == -1.5, "Wizards opening spread already matches the moneyline")
check(cha["tot"] == 223.5, f"Wizards stale total 234.5 becomes the first recorded total ({cha['tot']})")

# A favorite that really flipped is left alone: opening spread and moneyline agree with each other.
# Knicks at Sixers opened Philadelphia -1.5 / -125; the first snapshot had already moved to +1.5.
phi_open = dict(hs=-1.5, **{"as": 1.5}, hml=-125, aml=105, tot=231.5)
phi_pts = [dict(hs=1.5, **{"as": -1.5}, hml=-108, aml=-112, tot=230.5)]
phi = LH.reconcile_open(phi_open, phi_pts, "basketball")
check(phi["hs"] == -1.5 and phi["hml"] == -125 and phi["tot"] == 231.5, "a real flip, spread and moneyline agreeing, is not rewritten")

# Consistent opener, one point of total movement: unchanged. Running it twice is stable.
tor_open = dict(hs=-3.5, **{"as": 3.5}, hml=-155, aml=130, tot=226.5)
tor_pts = [dict(hs=-4.5, **{"as": 4.5}, hml=-175, aml=145, tot=222.5)]
tor = LH.reconcile_open(tor_open, tor_pts, "basketball")
check(tor == tor_open and LH.reconcile_open(tor, tor_pts, "basketball") == tor, "a consistent opener is unchanged and idempotent")

# Football totals move before the first snapshot. A 6-point gap is not treated as the basketball bug.
fb = LH.reconcile_open(dict(hs=-3.5, **{"as": 3.5}, hml=-160, aml=140, tot=46.5),
                       [dict(hs=-3.0, **{"as": 3.0}, hml=-150, aml=130, tot=40.5)], "football")
check(fb["tot"] == 46.5 and fb["hs"] == -3.5, "football opening total is left as ESPN reported it")

# A 3-point basketball gap is normal movement, not a stale total.
near = LH.reconcile_open(dict(hs=-7.5, **{"as": 7.5}, hml=-230, aml=190, tot=226.5),
                         [dict(hs=-7.5, **{"as": 7.5}, hml=-230, aml=190, tot=223.5)], "basketball")
check(near["tot"] == 226.5, "a basketball total 3 points from the series stays")

# merge stores the corrected open and does not undo it when the next run sends the same bad ESPN open.
hist = dict(v=1, league="nba", games={})
snap = lambda t, pt, op: {"401909282": dict(date="2026-10-31T00:00Z", home="MIA", away="IND",
                                            books={"draftkings": pt}, open={"draftkings": op})}
LH.merge(hist, snap("2026-10-29T15:45:24Z", mia_pts[0], mia_open), "2026-10-29T15:45:24Z")
got = hist["games"]["401909282"]["open"]["draftkings"]
check(got["hs"] == -3.5 and got["as"] == 3.5 and got["hml"] == -155, f"merge corrects the Heat open on the way in ({got})")
n = LH.merge(hist, snap("2026-10-30T13:45:21Z", mia_pts[1], mia_open), "2026-10-30T13:45:21Z")
got = hist["games"]["401909282"]["open"]["draftkings"]
check(n == 1 and got["hs"] == -3.5 and len(hist["games"]["401909282"]["books"]["draftkings"]) == 2,
      "a later run that sends the same bad open stays corrected and keeps both points")

# The line card reads homeSpreadOpen off the odds object, not the history compact keys.
game = dict(odds=dict(provider="DraftKings", homeSpread=-8.5, awaySpread=8.5, homeSpreadOpen=3.5, awaySpreadOpen=-3.5,
                      homeML=-325, awayML=260, homeMLOpen=-155, awayMLOpen=130, total=237.5, totalOpen=240.5),
            books={"draftkings": dict(homeSpreadOpen=3.5, awaySpreadOpen=-3.5, homeMLOpen=-155, totalOpen=240.5)})
LH.stamp_open(game, mia)
check(game["odds"]["homeSpreadOpen"] == -3.5 and game["odds"]["awaySpreadOpen"] == 3.5, "line card home/away opening spreads follow the swap")
check(game["books"]["draftkings"]["homeSpreadOpen"] == -3.5 and game["odds"]["homeMLOpen"] == -155, "DraftKings book open and the moneyline open follow along")
game["odds"]["totalOpen"] = 234.5
LH.stamp_open(game, cha)
check(game["odds"]["totalOpen"] == 223.5 and game["books"]["draftkings"]["totalOpen"] == 223.5, "line card total opener becomes the first recorded total")

# Week 9 Jaguars at Ravens. The ESPN opener is the Week 8 Colts at Jaguars opener,
# copied onto the shared team. The first recorded Week 9 line was Baltimore -2.5.
fx = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "opens", "week9_jax_bal.json")
carried = json.load(open(fx))
n = LH.fix_carried_opens(carried)
by_id = {gid: after for gid, bk, before, after in n}
check(len(n) == 1 and "401873037" in by_id, f"only the Jaguars-Ravens opener is carried ({n})")
jax = carried["games"]["401873037"]["open"]["draftkings"]
check(jax["hs"] == -2.5 and jax["as"] == 2.5 and jax["hml"] == -148 and jax["aml"] == 124 and jax["tot"] == 48.5,
      f"Jaguars-Ravens open becomes the first recorded line ({jax})")
ind = carried["games"]["401873028"]["open"]["draftkings"]
check(ind["hs"] == -4.5 and ind["hml"] == -218 and ind["tot"] == 49.5, "Week 8 Jaguars opener is left as stored")
tb = carried["games"]["401873050"]["open"]["draftkings"]
check(tb["hs"] == -3.5 and tb["tot"] == 48.5, "same opener on two games that share no team is not a carryover")

# merge keeps the correction when ESPN sends the copy again, and after the source game is pruned.
def snap(gid, date, home, away, pt, op, t):
    return {gid: dict(date=date, home=home, away=away, books={"draftkings": pt}, open={"draftkings": op})}

w8_op = dict(hs=-4.5, **{"as": 4.5}, hml=-218, aml=180, tot=49.5)
w8_pt = dict(hs=-7.5, **{"as": 7.5}, hml=-355, aml=280, tot=46.5)
w9_pt = dict(hs=-2.5, **{"as": 2.5}, hml=-148, aml=124, tot=48.5)
hist = dict(v=1, league="nfl", games={})
LH.merge(hist, snap("401873028", "2026-11-01T18:00Z", "JAX", "IND", w8_pt, w8_op, "2026-10-26T02:46:21Z"), "2026-10-26T02:46:21Z")
LH.merge(hist, snap("401873037", "2026-11-06T01:15Z", "BAL", "JAX", w9_pt, dict(w8_op), "2026-10-27T19:48:34Z"), "2026-10-27T19:48:34Z")
got = hist["games"]["401873037"]["open"]["draftkings"]
check(got["hs"] == -2.5 and got["hml"] == -148 and got["tot"] == 48.5, f"merge drops the carried Jaguars opener ({got})")
check(hist["games"]["401873028"]["open"]["draftkings"]["hs"] == -4.5, "merge leaves the Week 8 source opener")
LH.merge(hist, snap("401873037", "2026-11-06T01:15Z", "BAL", "JAX",
                    dict(hs=9.5, **{"as": -9.5}, hml=370, aml=-485, tot=42.5), dict(w8_op), "2026-11-03T14:15:21Z"),
         "2026-11-03T14:15:21Z")
got = hist["games"]["401873037"]["open"]["draftkings"]
check(got["hs"] == -2.5 and got["tot"] == 48.5 and len(hist["games"]["401873037"]["books"]["draftkings"]) == 2,
      f"a later run that resends the carried open stays on the first recorded line ({got})")
del hist["games"]["401873028"]
LH.merge(hist, snap("401873037", "2026-11-06T01:15Z", "BAL", "JAX",
                    dict(hs=9.5, **{"as": -9.5}, hml=370, aml=-485, tot=42.5), dict(w8_op), "2026-11-04T20:00:00Z"),
         "2026-11-04T20:00:00Z")
got = hist["games"]["401873037"]["open"]["draftkings"]
check(got["hs"] == -2.5 and got["hml"] == -148, f"pruning the Week 8 game does not put its opener back ({got})")

# The same correction when the Week 8 game is already gone and the bad open is still stored.
late = json.load(open(fx))
del late["games"]["401873028"]
n = LH.fix_carried_opens(late)
jax = late["games"]["401873037"]["open"]["draftkings"]
check(len(n) == 1 and jax["hs"] == -2.5 and jax["tot"] == 48.5, f"the copy is still dropped after the source game is gone ({jax})")
untouched = json.load(open(fx))
del untouched["games"]["401873037"]
check(LH.fix_carried_opens(untouched) == [], "the Week 8 game keeps the opener that actually belongs to it")

# DAL @ SA, 401909933. ESPN's DraftKings open is the first recorded line (12:15 AM ET
# Nov 3) with home and away exchanged: SA +12.5 and +503/-700 instead of SA -12.5 and -700/+502.
fx = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "opens", "dal_sas_401909933.json")
sas = json.load(open(fx))
sas_op = sas["open"]["draftkings"]
sas_pts = [p[1] for p in sas["books"]["draftkings"]]
sas_fix = LH.reconcile_open(sas_op, sas_pts, "basketball")
check(sas_fix["hs"] == -12.5 and sas_fix["as"] == 12.5, f"Spurs opening spread swaps onto the favorite ({sas_fix})")
check(sas_fix["hml"] == -700 and sas_fix["aml"] == 503, f"Spurs opening moneyline swaps with the spread ({sas_fix})")
check(sas_fix["tot"] == 229.5, "Spurs total 229.5 is the recorded open and stays")
check(LH.reconcile_open(sas_fix, sas_pts, "basketball") == sas_fix, "the corrected Spurs open is stable")
check(LH.reconcile_open(sas_op, sas_pts, "football")["hs"] == -12.5, "the same home/away flip is corrected for football")
check(LH.reconcile_open(sas_op, sas_pts, "hockey")["aml"] == 503, "the same home/away flip is corrected for hockey")
drawn = dict(sas_op, dml=240)
check(LH.reconcile_open(drawn, sas_pts, "soccer")["dml"] == 240 and LH.reconcile_open(drawn, sas_pts, "soccer")["hs"] == -12.5,
      "a draw price stays put while home and away are swapped")

# The away spread is not the other side of the home spread, so exchanging home and away
# still leaves the favorite on the wrong side. Use the first recorded point.
broken = dict(hs=12.5, **{"as": 12.5}, hml=503, aml=-700, tot=229.5)
fell = LH.reconcile_open(broken, sas_pts[:1], "basketball")
check(fell["hs"] == -12.5 and fell["as"] == 12.5 and fell["hml"] == -700 and fell["aml"] == 502 and fell["tot"] == 229.5,
      f"a swap that is still inconsistent becomes the first recorded point ({fell})")

# Chiefs at Broncos really moved through the number. The opener is not the first point swapped
# (moneyline is 7 cents off), so it stays. Same shape the backfill must leave alone.
den_open = dict(hs=-1.5, **{"as": 1.5}, hml=-118, aml=-102, tot=43.5)
den_pts = [dict(hs=1.5, **{"as": -1.5}, hml=105, aml=-125, tot=41.5)]
den = LH.reconcile_open(den_open, den_pts, "football")
check(den == den_open, f"a real flip whose prices are not the first point swapped is left alone ({den})")

def sas_snap(pt, op):
    return {sas["id"]: dict(date=sas["date"], home=sas["home"], away=sas["away"],
                            books={"draftkings": pt}, open={"draftkings": dict(op)})}

hist = dict(v=1, league="nba", games={})
for t, pt in sas["books"]["draftkings"]:
    LH.merge(hist, sas_snap(pt, sas_op), t)
got = hist["games"]["401909933"]["open"]["draftkings"]
check(got["hs"] == -12.5 and got["hml"] == -700 and got["aml"] == 503 and len(hist["games"]["401909933"]["books"]["draftkings"]) == 22,
      f"merge corrects the Spurs open while keeping every recorded point ({got})")
LH.merge(hist, sas_snap(sas_pts[-1], sas_op), "2026-11-04T21:15:20Z")
got = hist["games"]["401909933"]["open"]["draftkings"]
check(got["hs"] == -12.5 and got["aml"] == 503 and len(hist["games"]["401909933"]["books"]["draftkings"]) == 22,
      f"a later run that resends the flipped ESPN open stays corrected ({got})")
move = LH.summarize(hist["games"]["401909933"], "basketball", "nba")
check(move["spread"]["open"] == -12.5 and move["spread"]["cur"] == sas_pts[-1]["hs"] and move["spread"]["delta"] == 0,
      f"Spurs spread movement is no longer a 25 point swing ({move['spread']})")
check(move["homeML"]["open"] == -700 and move["awayML"]["open"] == 503, "Spurs moneyline open is SA -700 / DAL +503")
check(abs(move["homeML"]["delta"]) < 200 and abs(move["awayML"]["delta"]) < 200, f"Spurs moneyline move is cents, not ~950 ({move['homeML']['delta']}/{move['awayML']['delta']})")
check(all("Spread moved" not in n for n in move["notable"]), f"the 25 point spread note is gone ({move['notable']})")

# The line card and the DraftKings book were stamped with the flipped ESPN open.
game = dict(odds=dict(sas["odds"]), books={"draftkings": dict(sas["draftkings"])})
LH.stamp_open(game, sas_fix)
check(game["odds"]["homeSpreadOpen"] == -12.5 and game["odds"]["awaySpreadOpen"] == 12.5, "line card opening spreads follow the Spurs swap")
check(game["odds"]["homeMLOpen"] == -700 and game["odds"]["awayMLOpen"] == 503, "line card opening moneylines follow the Spurs swap")
check(game["books"]["draftkings"]["homeSpreadOpen"] == -12.5 and game["books"]["draftkings"]["homeMLOpen"] == -700,
      "DraftKings book open follows the Spurs swap")
check(game["odds"]["homeSpread"] == -12.5 and game["odds"]["homeML"] == -620, "current Spurs prices are not rewritten")

# A shared team whose recorded line really is that opener is not rewritten.
same = dict(v=1, league="nfl", games={})
LH.merge(same, snap("a", "2026-11-01T18:00Z", "JAX", "IND", w8_pt, w8_op, "2026-10-26T02:46:21Z"), "2026-10-26T02:46:21Z")
LH.merge(same, snap("b", "2026-11-08T18:00Z", "JAX", "HOU", w8_op, dict(w8_op), "2026-10-30T04:15:16Z"), "2026-10-30T04:15:16Z")
check(same["games"]["b"]["open"]["draftkings"]["hs"] == -4.5, "an opener this game actually showed is kept")

# Stale ESPN opens. The spread and the moneyline agree, so the favorite-flip check
# leaves them alone. They never show up in the snapshots. The first recorded line
# becomes the open. Current prices in the snapshots are not rewritten.
# Thresholds: a spread more than 3 points from every snapshot (exactly 3 is a normal
# key-number move when we only have one snapshot). A football total more than 6
# (a 6-point gap still happens before the first snapshot). Michigan's spread got
# within 2 of -13.5, but the 53.5 total never traded, so the pair is one stale open.

def gh(op, pts, league="ncaaf"):
    return dict(open={"draftkings": dict(op)},
                books={"draftkings": [[f"2026-11-0{i+5}T05:15:24Z", dict(p)] for i, p in enumerate(pts)]})

def corrected(op, pts, kind="football"):
    return LH.reconcile_open(dict(op), [dict(p) for p in pts], kind)

# Tennessee at Texas A&M. ESPN TA&M -9.5 / 55.5. First snapshot (Nov 8, 12:15 AM ET) TENN -3 / 45.5.
tenn_op = dict(hs=-9.5, **{"as": 9.5}, hml=-355, aml=280, tot=55.5)
tenn_pts = [dict(hs=3.0, **{"as": -3.0}, hml=130, aml=-155, tot=45.5),
            dict(hs=3.5, **{"as": -3.5}, hml=146, aml=-175, tot=44.5),
            dict(hs=1.5, **{"as": -1.5}, hml=114, aml=-135, tot=44.5)]
tenn_raw = [dict(p) for p in tenn_pts]
tenn = corrected(tenn_op, tenn_pts)
check(tenn["hs"] == 3.0 and tenn["as"] == -3.0 and tenn["hml"] == 130 and tenn["aml"] == -155 and tenn["tot"] == 45.5,
      f"Tennessee stale open becomes the first snapshot ({tenn})")
check(tenn_raw[0]["hs"] == 3.0 and tenn_raw[-1]["hs"] == 1.5 and tenn_raw[-1]["tot"] == 44.5,
      "correcting the Tennessee open does not rewrite the recorded line")
check(corrected(tenn, tenn_pts) == tenn, "the corrected Tennessee open is stable")
tenn_move = LH.summarize(gh(tenn, tenn_pts), "football", "ncaaf")
check(tenn_move["spread"]["open"] == 3.0 and tenn_move["spread"]["delta"] == -1.5, f"Tennessee spread move is the recorded 1.5 ({tenn_move['spread']})")
check(tenn_move["total"]["open"] == 45.5 and tenn_move["total"]["delta"] == -1.0, f"Tennessee total move is the recorded 1 ({tenn_move['total']})")
check(all("11" not in n for n in tenn_move["notable"]), f"the 11 point Tennessee notes are gone ({tenn_move['notable']})")
check(tenn_move["spark"]["spread"][0] == 3.0 and -9.5 not in tenn_move["spark"]["spread"],
      f"Tennessee spread sparkline does not start at the stale -9.5 ({tenn_move['spark']['spread']})")
check(tenn_move["spark"]["total"][0] == 45.5 and 55.5 not in tenn_move["spark"]["total"],
      f"Tennessee total sparkline does not start at the stale 55.5 ({tenn_move['spark']['total']})")

# The line card takes the corrected open. The current spread and total stay.
card = dict(odds=dict(provider="DraftKings", homeSpread=1.5, awaySpread=-1.5, homeSpreadOpen=-9.5, awaySpreadOpen=9.5,
                      homeML=114, awayML=-135, homeMLOpen=-355, awayMLOpen=280, total=44.5, totalOpen=55.5),
            books={"draftkings": dict(homeSpread=1.5, awaySpread=-1.5, total=44.5, homeSpreadOpen=-9.5, totalOpen=55.5)})
LH.stamp_open(card, tenn)
check(card["odds"]["homeSpreadOpen"] == 3.0 and card["odds"]["totalOpen"] == 45.5 and card["odds"]["homeMLOpen"] == 130,
      "line card opening numbers follow the first Tennessee snapshot")
check(card["odds"]["homeSpread"] == 1.5 and card["odds"]["total"] == 44.5 and card["books"]["draftkings"]["homeSpread"] == 1.5,
      "current Tennessee prices are not rewritten")

# Texas Tech at Oklahoma State. Tech -15.5 / 61.5 never trades. First snapshot is Tech -1.5 / 63.5.
ttu = corrected(dict(hs=15.5, **{"as": -15.5}, hml=455, aml=-625, tot=61.5),
                [dict(hs=1.5, **{"as": -1.5}, hml=-102, aml=-118, tot=63.5),
                 dict(hs=-3.5, **{"as": 3.5}, hml=-180, aml=150, tot=73.5)])
check(ttu["hs"] == 1.5 and ttu["aml"] == -118 and ttu["tot"] == 63.5, f"Texas Tech open becomes the first snapshot ({ttu})")

# Texas at LSU. ESPN Texas -3 / 54.5. First snapshot LSU -5.5 / 46.5. The open never trades.
tex = corrected(dict(hs=3.0, **{"as": -3.0}, hml=130, aml=-155, tot=54.5),
                [dict(hs=-5.5, **{"as": 5.5}, hml=-192, aml=160, tot=46.5),
                 dict(hs=-4.5, **{"as": 4.5}, hml=-180, aml=150, tot=46.5)])
check(tex["hs"] == -5.5 and tex["tot"] == 46.5 and tex["hml"] == -192, f"Texas at LSU open becomes the first snapshot ({tex})")

# Michigan at Oregon. The spread later got within 2 of Ore -13.5, but 53.5 never traded
# (closest total is 9 points away). The first snapshot, Ore -5.5 / 44.5, is the open.
mich = corrected(dict(hs=-13.5, **{"as": 13.5}, hml=-575, aml=425, tot=53.5),
                 [dict(hs=-5.5, **{"as": 5.5}, hml=-205, aml=170, tot=44.5),
                  dict(hs=-11.5, **{"as": 11.5}, hml=-470, aml=360, tot=40.5),
                  dict(hs=-10.5, **{"as": 10.5}, hml=-425, aml=330, tot=38.5)])
check(mich["hs"] == -5.5 and mich["hml"] == -205 and mich["tot"] == 44.5, f"Michigan at Oregon open becomes the first snapshot ({mich})")
mich_move = LH.summarize(gh(mich, [dict(hs=-5.5, tot=44.5), dict(hs=-11.5, tot=40.5), dict(hs=-10.5, tot=38.5)]), "football", "ncaaf")
check(mich_move["spread"]["delta"] == -5.0 and mich_move["total"]["delta"] == -6.0 and "15" not in " ".join(mich_move["notable"]),
      f"Oregon move is the recorded 5 and 6, not 15 ({mich_move['notable']})")

# USC at Indiana. The spread later traded at -10, half a point from the ESPN -10.5, so the
# spread open stays. The total 58.5 never comes within 8 of a recorded total.
usc_pts = [dict(hs=-7.0, **{"as": 7.0}, hml=-285, aml=230, tot=50.5),
           dict(hs=-10.0, **{"as": 10.0}, hml=-380, aml=300, tot=50.5),
           dict(hs=-9.5, **{"as": 9.5}, hml=-345, aml=275, tot=50.5)]
usc = corrected(dict(hs=-10.5, **{"as": 10.5}, hml=-410, aml=320, tot=58.5), usc_pts)
check(usc["hs"] == -10.5 and usc["hml"] == -410 and usc["tot"] == 50.5, f"Indiana spread open stayed; the stale total became 50.5 ({usc})")
usc_move = LH.summarize(gh(usc, usc_pts), "football", "ncaaf")
check(all("Total moved" not in n for n in usc_move["notable"]) and usc_move["spark"]["total"][0] == 50.5,
      f"Indiana total sparkline no longer starts at 58.5 ({usc_move['notable']})")

# Duke at Miami. Miami -20.5 never comes within 5 of the recorded spreads.
duke = corrected(dict(hs=-20.5, **{"as": 20.5}, hml=-1650, aml=950, tot=55.5),
                 [dict(hs=-15.5, **{"as": 15.5}, hml=-750, aml=525, tot=56.5),
                  dict(hs=-14.0, **{"as": 14.0}, hml=-600, aml=440, tot=54.5)])
check(duke["hs"] == -15.5 and duke["hml"] == -750 and duke["tot"] == 56.5, f"Duke at Miami open becomes the first snapshot ({duke})")

# Tulane at Rice is a 3-point flip, and the +1.5 never appears across the series.
# One snapshot at exactly 3 stays (Chiefs at Broncos, above). Two or more means it never traded.
tul = corrected(dict(hs=1.5, **{"as": -1.5}, hml=-108, aml=-112, tot=46.5),
                [dict(hs=-1.5, **{"as": 1.5}, hml=-115, aml=-105, tot=46.5),
                 dict(hs=-3.0, **{"as": 3.0}, hml=-166, aml=140, tot=48.5)])
check(tul["hs"] == -1.5 and tul["tot"] == 46.5 and tul["hml"] == -115, f"Tulane at Rice open becomes the first snapshot ({tul})")
one = corrected(dict(hs=1.5, **{"as": -1.5}, hml=-108, aml=-112, tot=46.5),
                [dict(hs=-1.5, **{"as": 1.5}, hml=-115, aml=-105, tot=46.5)])
check(one["hs"] == 1.5 and one["tot"] == 46.5, "the same 3-point flip with one snapshot is left alone")

# Oregon State at Boise State. The ESPN open matches the first snapshot, then the
# spread moves 12 points. That move stays, including the sparkline and the note.
orst_op = dict(hs=-4.5, **{"as": 4.5}, hml=-180, aml=150, tot=62.5)
orst_pts = [dict(hs=-4.5, **{"as": 4.5}, hml=-180, aml=150, tot=62.5),
            dict(hs=-9.5, **{"as": 9.5}, hml=-350, aml=280, tot=63.5),
            dict(hs=-16.5, **{"as": 16.5}, hml=-900, aml=600, tot=63.5)]
orst = corrected(orst_op, orst_pts)
check(orst == orst_op, f"Boise State open matches the first snapshot and stays ({orst})")
orst_move = LH.summarize(gh(orst, orst_pts), "football", "ncaaf")
check(orst_move["spread"]["open"] == -4.5 and orst_move["spread"]["delta"] == -12.0 and orst_move["spread"]["cur"] == -16.5,
      f"Boise State keeps the real 12 point move ({orst_move['spread']})")
check(any(n.startswith("Spread moved 12") for n in orst_move["notable"]), f"Boise State spread note stays ({orst_move['notable']})")
check(orst_move["spark"]["spread"][0] == -4.5 and orst_move["spark"]["spread"][-1] == -16.5,
      f"Boise State sparkline still runs from the real open to the current line ({orst_move['spark']['spread']})")

# The line came back to the ESPN spread (Seahawks at Raiders, 7 down to 3.5 and back to 6.5).
# That open traded. It is not replaced just because the first snapshot was 3.5 points away.
sea = corrected(dict(hs=7.0, **{"as": -7.0}, hml=270, aml=-340, tot=43.5),
                [dict(hs=3.5, **{"as": -3.5}, hml=145, aml=-175, tot=43.5),
                 dict(hs=6.5, **{"as": -6.5}, hml=230, aml=-285, tot=40.5)])
check(sea["hs"] == 7.0 and sea["tot"] == 43.5, f"a spread the series comes back to within a point stays ({sea})")

# Rams at Cardinals. The total open 47.5 is the first snapshot, then the total falls to 39.5.
# That is a recorded move, not a stale open.
lar_op = dict(hs=10.5, **{"as": -10.5}, hml=400, aml=-535, tot=47.5)
lar_pts = [dict(hs=7.5, **{"as": -7.5}, hml=280, aml=-355, tot=47.5),
           dict(hs=9.5, **{"as": -9.5}, hml=330, aml=-425, tot=39.5)]
lar = corrected(lar_op, lar_pts)
check(lar == lar_op, f"Rams total open matches the first snapshot and stays ({lar})")
lar_move = LH.summarize(gh(lar, lar_pts, "nfl"), "football", "nfl")
check(lar_move["total"]["open"] == 47.5 and lar_move["total"]["delta"] == -8.0,
      f"Rams at Cardinals keeps the recorded 8 point total move ({lar_move['total']})")

# Chargers at Ravens. The spread open trades. The total 48.5 never comes within 10 of the series.
lac = corrected(dict(hs=-2.5, **{"as": 2.5}, hml=-142, aml=120, tot=48.5),
                [dict(hs=-1.5, **{"as": 1.5}, hml=-118, aml=-102, tot=37.5),
                 dict(hs=-2.5, **{"as": 2.5}, hml=-142, aml=120, tot=38.5)])
check(lac["hs"] == -2.5 and lac["hml"] == -142 and lac["tot"] == 37.5,
      f"Ravens spread open stays and the stale total becomes the first total ({lac})")

# Same rule on a basketball spread that never trades. The total, which does, stays.
ny = corrected(dict(hs=2.5, **{"as": -2.5}, hml=110, aml=-130, tot=221.5),
               [dict(hs=6.5, **{"as": -6.5}, hml=210, aml=-258, tot=221.5),
                dict(hs=7.5, **{"as": -7.5}, hml=240, aml=-298, tot=219.5)], "basketball")
check(ny["hs"] == 6.5 and ny["tot"] == 221.5, f"a basketball spread 4 points off every snapshot becomes the first spread ({ny})")

# merge stores the corrected Tennessee open and does not put the ESPN number back.
hist = dict(v=1, league="ncaaf", games={})
def tenn_snap(pt, op, t):
    return {"401856888": dict(date="2026-11-14T20:00Z", home="TA&M", away="TENN",
                              books={"draftkings": pt}, open={"draftkings": dict(op)})}
LH.merge(hist, tenn_snap(tenn_pts[0], tenn_op, "2026-11-08T05:15:24Z"), "2026-11-08T05:15:24Z")
got = hist["games"]["401856888"]["open"]["draftkings"]
check(got["hs"] == 3.0 and got["tot"] == 45.5, f"merge drops the stale Tennessee open on the way in ({got})")
LH.merge(hist, tenn_snap(tenn_pts[-1], tenn_op, "2026-11-14T12:15:18Z"), "2026-11-14T12:15:18Z")
got = hist["games"]["401856888"]["open"]["draftkings"]
check(got["hs"] == 3.0 and got["tot"] == 45.5 and len(hist["games"]["401856888"]["books"]["draftkings"]) == 2,
      f"a later run that resends the stale Tennessee open stays corrected ({got})")
check(hist["games"]["401856888"]["books"]["draftkings"][-1][1]["hs"] == 1.5, "the later Tennessee snapshot is stored as the current line")

# SEO copy and the static line-move card read summarize(), so they follow the corrected open.
import seo_pages as SP
class _Lg:
    kind = "football"
    lg = "ncaaf"
tenn_g = {"away": {"abbr": "TENN", "name": "Tennessee Volunteers", "short": "Tennessee"},
          "home": {"abbr": "TA&M", "name": "Texas A&M Aggies", "short": "Texas A&M"},
          "move": tenn_move}
wtw = SP.wtw_move(_Lg, tenn_g)
intro = SP._intro_move(_Lg, tenn_g)
card_html, _facts = __import__("previews").movement(dict(tenn_g, move=dict(tenn_move, book="draftkings", since="2026-11-08T05:15:24Z")), "football")
check(wtw and "55.5" not in wtw and "9.5" not in wtw and "-3" in wtw, f"SEO move sentence uses the first Tennessee snapshot ({wtw})")
check(intro and "55.5" not in intro and "9.5" not in intro, f"SEO intro uses the first Tennessee snapshot ({intro})")
check("55.5" not in card_html and "9.5" not in card_html and "+3" in card_html and "45.5" in card_html,
      f"static line-move card does not show the stale Tennessee open ({card_html})")
orst_g = {"away": {"abbr": "ORST", "name": "Oregon State Beavers", "short": "Oregon St"},
          "home": {"abbr": "BOIS", "name": "Boise State Broncos", "short": "Boise St"},
          "move": orst_move}
orst_wtw = SP.wtw_move(_Lg, orst_g)
check(orst_wtw and "-4.5" in orst_wtw and "-16.5" in orst_wtw, f"Boise State SEO copy keeps the real move ({orst_wtw})")

print(f"open_line_test: {ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
