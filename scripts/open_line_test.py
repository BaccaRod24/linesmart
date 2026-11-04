"""Opening lines stay on the right side, and a stale basketball total is not the opener.

ESPN sometimes reports the opening spread on the opposite side of the opening moneyline
(Pacers at Heat, Rockets at Mavericks on 2026-10-30) and an opening total that never
appears in the recorded snapshots (Hornets at Wizards, 234.5 vs a series at 219.5-223.5).
Week 9 Jaguars at Ravens carried the Week 8 Jaguars opener (-4.5, -218, +180, 49.5)
even though the recorded line was already Baltimore -2.5. DAL @ SA (401909933) has
both the spread and the moneyline on the wrong teams: the stored open is the first
recorded point with home and away exchanged. The shapes below are the stored history
rows. Offline: no network, no Odds API key.

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

print(f"open_line_test: {ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
