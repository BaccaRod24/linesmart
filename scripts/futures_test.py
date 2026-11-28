#!/usr/bin/env python3
"""Futures pull, budget gate, once-per-day stamp, history and retention.

Offline. Fixtures are the 2026-11-28 discovery shapes (scripts/fixtures/futures_discovery.json),
trimmed from the real top-5 prices. Never calls The Odds API.

    env -u ODDS_API_KEY python3 scripts/futures_test.py
"""
import datetime as dt, json, os, subprocess, sys, tempfile, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.pop("ODDS_API_KEY", None)

def _no_network(*_a, **_k):
    raise SystemExit("refusing to call the network from futures_test")
urllib.request.urlopen = _no_network

import futures as FU
import line_history as LH
import odds_budget as OB

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIX = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "futures_discovery.json")))
fails = []
def check(ok, msg):
    print(("PASS " if ok else "FAIL ") + msg)
    if not ok: fails.append(msg)

UTC = dt.timezone.utc
def T(*a): return dt.datetime(*a, tzinfo=UTC)
# 2026-11-28 15:00 UTC = 10:00 AM EST, after the 6:00 AM ET futures hour.
DAY = T(2026, 11, 28, 15, 0)
BEFORE = T(2026, 11, 28, 10, 30)   # 5:30 AM EST
BOOK = {"DraftKings": "draftkings", "FanDuel": "fanduel", "Hard Rock Bet": "hardrockbet"}

def sport(key):
    return next(s for s in FIX["sports"] if s["key"] == key)

def catalog():
    rows = [dict(key=s["key"], title=s["title"], active=True, has_outrights=True) for s in FIX["sports"]]
    rows += [dict(key=s["key"], title=s["title"], active=False, has_outrights=s["has_outrights"]) for s in FIX["skipped"]]
    rows += [
        dict(key="basketball_nba_mvp", title="NBA MVP", active=True, has_outrights=True),
        dict(key="americanfootball_nfl_conference_winner", title="NFC Winner", active=True, has_outrights=True),
        dict(key="americanfootball_nfl_division_winner", title="AFC East", active=True, has_outrights=True),
        dict(key="politics_us_presidential_election_winner", title="Election", active=True, has_outrights=True),
        dict(key="soccer_fifa_world_cup_winner", title="World Cup", active=True, has_outrights=True),
    ]
    return rows

def event_of(s, price_for=None):
    bks = []
    for label, blob in (s.get("books") or {}).items():
        outs = []
        for o in blob.get("top5") or []:
            px = o["price"] if price_for is None else price_for(BOOK[label], o["name"], o["price"])
            outs.append(dict(name=o["name"], price=px))
        bks.append(dict(key=BOOK[label], title=label, last_update=blob.get("last_update"),
                        markets=[dict(key="outrights", outcomes=outs)]))
    ev = s["events"][0]
    return [dict(id=ev["id"], sport_key=s["key"], sport_title=s["title"], commence_time=ev["commence_time"], bookmakers=bks)]

# ---------------------------------------------------------------- budget gate
check(FU.ALLOW and all("mvp" not in k and "award" not in k and "conference" not in k and "division" not in k for k, *_r in FU.ALLOW),
      "allowlist is championship and golf-major keys only")
picked = FU.select_keys(catalog())
keys = [s["key"] for s in picked]
check(len(keys) == 9 and "baseball_mlb_world_series_winner" not in keys, f"inactive MLB is not called ({len(keys)} keys)")
check("basketball_nba_mvp" not in keys and "soccer_fifa_world_cup_winner" not in keys
      and "americanfootball_nfl_conference_winner" not in keys and "americanfootball_nfl_division_winner" not in keys,
      "MVP, conference, division, soccer and politics keys are not called")
check(keys[0] == "americanfootball_nfl_super_bowl_winner" and "golf_the_open_championship_winner" in keys,
      "NFL and The Open (event, no books) are both active")
check(round(FU.monthly_credits(9), 1) == 273.6 and round(FU.monthly_credits(10), 1) == 304.0, "9 to 10 credits/day is 274 to 304/month")

ok, why = OB.futures_gate(dict(level="stop", allowancePerDay=5000, needGamesPerDay=100, needPropsPerDay=10),
                          cost=9, run_spent=0, remaining=50000)
check(ok is False and "game lines" in why, f"stop: futures wait ({why})")
ok, why = OB.futures_gate(dict(level="slow-games", allowancePerDay=5000, needGamesPerDay=100),
                          cost=9, run_spent=0, remaining=50000)
check(ok is False, f"slow-games: futures wait ({why})")
ok, why = OB.futures_gate(dict(level="full", allowancePerDay=2000, needGamesPerDay=1296, needPropsPerDay=480),
                          cost=9, run_spent=0, remaining=305, floor=300, cap=250)
check(ok is False and "floor" in why, f"305 - 9 crosses the 300 floor ({why})")
ok, why = OB.futures_gate(dict(level="full", allowancePerDay=5000, needGamesPerDay=100, needPropsPerDay=10),
                          cost=9, run_spent=245, remaining=50000, floor=300, cap=250)
check(ok is False and "cap" in why, f"245 + 9 passes the 250 cap ({why})")
ok, why = OB.futures_gate(dict(level="full", allowancePerDay=1776, needGamesPerDay=1296, needPropsPerDay=480),
                          cost=9, run_spent=0, remaining=50000)
check(ok is False and "allowance" in why, f"full allowance with no room for futures ({why})")
ok, why = OB.futures_gate(dict(level="no-props", allowancePerDay=1300, needGamesPerDay=1296, needPropsPerDay=480),
                          cost=9, run_spent=0, remaining=50000)
check(ok is False and "game lines" in why, f"no-props allowance must still cover game lines ({why})")
plan = OB.plan(50000, 20000, DAY, games_per_run=27, props_per_run=40)
ok, why = OB.futures_gate(plan, cost=9, run_spent=27, remaining=50000)
check(plan["level"] == "full" and ok, f"a comfortable full plan allows the once-a-day 9 ({why}, allowance {plan.get('allowancePerDay')})")
ok, why = OB.futures_gate(dict(level="full", allowancePerDay=5000, needGamesPerDay=100, needPropsPerDay=10),
                          cost=0, run_spent=0, remaining=None)
check(ok and "0 credits" in why, "no active keys does not need a balance")
check(not FU.due(None, BEFORE) and FU.due(None, DAY), "missing stamp waits until 6:00 AM ET, then pulls")
check(not FU.due(dict(lastDateET="2026-11-28"), DAY) and FU.due(dict(lastDateET="2026-11-27"), DAY),
      "one pull per ET date, including a later run the same day")
check(not FU.due(dict(lastDateET="2026-11-28"), T(2026, 11, 28, 23, 0)), "a force-time evening run does not pull twice")

# ---------------------------------------------------------------- history: change-only, open, merge, retention
nfl = sport("americanfootball_nfl_super_bowl_winner")
spec = FU.ALLOW_BY_KEY[nfl["key"]]
obs = FU.observe_event(FU.pick_event(event_of(nfl)))
check(set(obs["books"]) == {"draftkings", "fanduel"} and obs["books"]["draftkings"]["outcomes"]["San Francisco 49ers"] == 430
      and obs["books"]["fanduel"]["outcomes"]["San Francisco 49ers"] == 460, "discovery prices land on the right book")
hist = FU.empty_hist(spec)
n = FU.apply_observation(hist, spec, obs, DAY)
n_pts = sum(len(pts) for oc in hist["outcomes"].values() for pts in oc["books"].values())
check(n == n_pts == 10, f"first pull records each top-5 price once (+{n})")
niners = hist["outcomes"]["San Francisco 49ers"]
check(niners["open"]["draftkings"] == 430 and niners["open"]["fanduel"] == 460, "open is the first recorded price per book")
check(niners["openAt"]["fanduel"] == "2026-11-28T14:42:45Z", "first recorded time is the book's last_update")
n2 = FU.apply_observation(hist, spec, obs, DAY + dt.timedelta(hours=1))
check(n2 == 0 and len(niners["books"]["fanduel"]) == 1, "an unchanged price does not append")
bumped = FU.observe_event(FU.pick_event(event_of(nfl, lambda bk, name, px: 500 if bk == "fanduel" and name == "San Francisco 49ers" else px)))
# Keep the original last_update on the bumped book so the test controls time. The helper copies last_update from the fixture.
bumped["books"]["fanduel"]["at"] = "2026-11-29T15:00:00Z"
n3 = FU.apply_observation(hist, spec, bumped, T(2026, 11, 29, 15))
check(n3 >= 1 and niners["books"]["fanduel"] == [["2026-11-28T14:42:45Z", 460], ["2026-11-29T15:00:00Z", 500]],
      f"only the changed FanDuel price is appended ({niners['books']['fanduel']})")
check(niners["open"]["fanduel"] == 460, "open stays the first price after a move")
mkt = FU.publish_market(hist)
row = next(r for r in mkt["outcomes"] if r["name"] == "San Francisco 49ers")
check(row["draftkings"] == 430 and row["fanduel"] == 500 and row["best"] == 500 and row["bestBook"] == "fanduel",
      f"best is the better of DraftKings and FanDuel ({row['best']} {row['bestBook']})")
check(row["implied"] == FU.implied_pct(500) and row["open"] == 460 and row["move"] == LH.ml_cents(460, 500) == 40,
      f"implied, open and move since open ({row['implied']}, {row['open']}, {row['move']})")
check(row["firstRecorded"] == "2026-11-28T14:42:45Z", "first recorded date is the open timestamp")
check(mkt["outcomes"][0]["name"] == "San Francisco 49ers", "favorites (shortest price) sort first")
check(LH.implied is FU.LH.implied if False else FU.implied_pct(460) == round(LH.implied(460) * 1000) / 10, "implied() is the line-history helper")

# An older snapshot arriving after a race becomes the open. The newer board stays.
tip = json.loads(json.dumps(hist))
older = json.loads(json.dumps(obs))
older["books"]["fanduel"]["at"] = "2026-11-27T12:00:00Z"
older["books"]["fanduel"]["outcomes"]["San Francisco 49ers"] = 440
FU.apply_observation(tip, spec, older, T(2026, 11, 27, 12))
check(tip["outcomes"]["San Francisco 49ers"]["open"]["fanduel"] == 440, "a late older point becomes the open")
check(tip["board"]["books"]["fanduel"]["San Francisco 49ers"] == 500, "an older snapshot does not replace the current board")

# Retention follows commence_time, not PRUNE_DAYS / lastSeen.
live = json.loads(json.dumps(hist))
check(not FU.expired(live, T(2026, 12, 20)) and FU.expired(live, T(2027, 2, 20)),
      "kept through the season; dropped a few days after commence_time")
old_seen = json.loads(json.dumps(hist))
for oc in old_seen["outcomes"].values():
    oc["lastSeen"] = "2026-11-01T00:00:00Z"
check(not FU.expired(old_seen, DAY), "a quiet outcome is not dropped after 3 days (PRUNE_DAYS does not apply)")
check("LH.prune(" not in open(os.path.join(ROOT, "scripts", "futures.py")).read(), "futures does not call the 3-day game prune")
gone = json.loads(json.dumps(hist))
FU.apply_observation(gone, spec, obs, T(2027, 2, 20))
check(gone.get("dropped") is True and gone["outcomes"] == {}, "a pull after commence_time + 3 days clears the market")

# New event id starts a new season instead of mixing prices.
nxt = json.loads(json.dumps(obs))
nxt["eventId"] = "next-season"
nxt["commence"] = "2028-02-13T23:30:00Z"
fresh = json.loads(json.dumps(hist))
FU.apply_observation(fresh, spec, nxt, T(2027, 11, 1))
check(fresh["eventId"] == "next-season" and fresh["outcomes"]["San Francisco 49ers"]["open"]["fanduel"] == 460
      and len(fresh["outcomes"]["San Francisco 49ers"]["books"]["fanduel"]) == 1
      and all(len(pts) == 1 for oc in fresh["outcomes"].values() for pts in oc["books"].values()),
      "a new event starts over; the old season's open is not kept")

# Hard Rock Bet price, if it ever shows up, is stored but is not the DK/FD best.
hr = json.loads(json.dumps(obs))
hr["books"]["hardrockbet"] = dict(at="2026-11-28T14:42:40Z", outcomes={"San Francisco 49ers": 800, "Buffalo Bills": 450})
hrhist = FU.empty_hist(spec)
FU.apply_observation(hrhist, spec, hr, DAY)
hrow = next(r for r in FU.publish_market(hrhist)["outcomes"] if r["name"] == "San Francisco 49ers")
check(hrow["hardrockbet"] == 800 and hrow["best"] == 460 and hrow["bestBook"] == "fanduel", "best stays among DraftKings and FanDuel")
check(FU.hardrock_seen([hr]) and not FU.hardrock_seen([obs]), "weekly check sees hardrockbet only when the response includes it")
msg, st = FU.note_hardrock({}, False, DAY)
msg2, st2 = FU.note_hardrock(st, False, DAY + dt.timedelta(days=1))
msg3, _st3 = FU.note_hardrock(st, True, DAY + dt.timedelta(days=8))
check(msg and "0 extra credits" in msg and "was not in any futures response" in msg and msg2 is None, "Hard Rock log is once per ISO week and costs nothing")
check(msg3 and "appeared" in msg3, "the next week logs again when the book shows up")

# ---------------------------------------------------------------- once per day, behind the guard, no live HTTP
def budget_full():
    return OB.plan(50000, 20000, DAY, games_per_run=27, props_per_run=40)

def new_pull(remaining=50000, spent=30):
    return dict(remaining=remaining, used=20000, spent=spent, spentBy={"games": spent} if spent else {},
                pulled=[], skipped=[], errors=[])

def note(pull, hdr, kind):
    last = int(hdr.get("x-requests-last") or 0)
    pull["spent"] = pull.get("spent", 0) + last
    pull.setdefault("spentBy", {})[kind] = pull["spentBy"].get(kind, 0) + last
    if hdr.get("x-requests-remaining") is not None: pull["remaining"] = int(hdr["x-requests-remaining"])
    return last

def make_get(price_for=None, remaining=50000):
    urls = []
    def get(url):
        urls.append(url)
        q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
        if "/v4/sports/?" in url or url.rstrip("/").endswith("/v4/sports"):
            return catalog(), {"x-requests-remaining": str(remaining), "x-requests-used": "20000", "x-requests-last": "0"}
        key = url.split("/v4/sports/")[1].split("/odds")[0]
        body = event_of(sport(key), price_for)
        return body, {"x-requests-remaining": str(remaining - 1), "x-requests-used": "20001", "x-requests-last": "1"}
    return urls, get

with tempfile.TemporaryDirectory() as td:
    hist_dir, snap, out = os.path.join(td, "history"), os.path.join(td, "snap"), os.path.join(td, "data")
    urls, get = make_get()
    logs = []
    pull = new_pull()
    rep = FU.run(pull=pull, budget=budget_full(), history_dir=hist_dir, snap_dir=snap, out_dir=out,
                 get=get, now=DAY, log=logs.append, api_key="test-key", note_headers=note, scrub=lambda s, k: str(s).replace(k, "***"),
                 floor=300, cap=250)
    odds_urls = [u for u in urls if "/odds/" in u]
    check(rep["pulled"] and len(odds_urls) == 9, f"one odds call per active key ({len(odds_urls)})")
    check(all("bookmakers=hardrockbet,fanduel,draftkings" in u and "markets=outrights" in u and "regions=us2" in u for u in odds_urls),
          "same bookmakers filter as game lines, outrights market, us2 region")
    check(all("commenceTimeTo" not in u for u in odds_urls), "futures are not cut to the 7-day game window")
    check(all("basketball_nba_mvp" not in u and "world_series" not in u for u in odds_urls), "MVP and inactive MLB were not requested")
    check(not any("test-key" in line for line in logs), "the API key is not logged")
    check(any("weekly Hard Rock check" in line and "0 extra credits" in line for line in logs), "weekly Hard Rock line is logged")
    check(pull["spent"] == 30 + 9 and pull["spentBy"].get("futures") == 9, f"9 credits on top of game lines already spent ({pull['spentBy']})")
    doc = json.load(open(os.path.join(out, "futures", "nfl.json")))
    top = doc["markets"][0]["outcomes"][0]
    check(doc["markets"][0]["key"] == nfl["key"] and top["name"] == "San Francisco 49ers"
          and top["draftkings"] == 430 and top["fanduel"] == 460 and top["best"] == 460
          and top["implied"] == FU.implied_pct(460) and top["open"] == 460 and top["move"] == 0,
          f"published NFL row uses the discovery prices ({top['name']} {top['draftkings']}/{top['fanduel']})")
    nba = json.load(open(os.path.join(out, "futures", "nba.json")))
    spurs = nba["markets"][0]["outcomes"][0]
    check(spurs["name"] == "San Antonio Spurs" and spurs["fanduel"] == 270 and spurs["draftkings"] is None and spurs["best"] == 270,
          "NBA is FanDuel only, matching the discovery")
    golf = json.load(open(os.path.join(out, "futures", "golf.json")))
    gkeys = [m["key"] for m in golf["markets"]]
    check("golf_masters_tournament_winner" in gkeys and "golf_the_open_championship_winner" in gkeys, f"golf majors published ({gkeys})")
    open_m = next(m for m in golf["markets"] if m["key"] == "golf_the_open_championship_winner")
    check(open_m["outcomes"] == [] and open_m["books"] == [], "The Open event with no books publishes an empty market")
    scheff = next(r for m in golf["markets"] if m["key"] == "golf_masters_tournament_winner" for r in m["outcomes"] if r["name"] == "Scottie Scheffler")
    check(scheff["draftkings"] == 400 and scheff["fanduel"] == 370 and scheff["best"] == 400, "Masters best is DraftKings +400 over FanDuel +370")
    for lg in ("epl", "mls", "ucl", "ufc", "mlb"):
        empty = json.load(open(os.path.join(out, "futures", f"{lg}.json")))
        check(empty["markets"] == [] and empty["league"] == lg, f"{lg} publishes an honest empty file")
    # same ET day: no second paid call
    urls2, get2 = make_get()
    rep2 = FU.run(pull=new_pull(), budget=budget_full(), history_dir=hist_dir, snap_dir=snap, out_dir=out,
                  get=get2, now=T(2026, 11, 28, 22), log=logs.append, api_key="test-key", note_headers=note)
    check(rep2["pulled"] is False and not any("/odds/" in u for u in urls2), f"second run the same ET day makes no odds call ({rep2['skipped']})")
    # before the hour the next morning: still no call
    urls3, get3 = make_get()
    rep3 = FU.run(pull=new_pull(), budget=budget_full(), history_dir=hist_dir, snap_dir=snap, out_dir=out,
                  get=get3, now=T(2026, 11, 29, 10, 30), log=logs.append, api_key="test-key", note_headers=note)
    check(not any("/odds/" in u for u in urls3), "before 6:00 AM ET the next day waits")
    # slow-games: no odds call even though the stamp is a previous day
    urls4, get4 = make_get()
    stamp = json.load(open(os.path.join(hist_dir, "futures", "_stamp.json")))
    stamp["lastDateET"] = "2026-11-27"
    json.dump(stamp, open(os.path.join(hist_dir, "futures", "_stamp.json"), "w"))
    slow = dict(level="slow-games", allowancePerDay=100, needGamesPerDay=1296, needPropsPerDay=0)
    rep4 = FU.run(pull=new_pull(), budget=slow, history_dir=hist_dir, snap_dir=snap, out_dir=out,
                  get=get4, now=DAY, log=logs.append, api_key="test-key", note_headers=note)
    check(rep4["pulled"] is False and not any("/odds/" in u for u in urls4) and "game lines" in (rep4["skipped"] or ""),
          f"slow-games does not spend on futures ({rep4['skipped']})")
    # floor: catalog is free, odds calls are not made
    urls5, get5 = make_get(remaining=304)
    near = OB.plan(304, 1000, DAY, games_per_run=0, props_per_run=0)
    pull5 = new_pull(remaining=304, spent=0)
    rep5 = FU.run(pull=pull5, budget=near, history_dir=hist_dir, snap_dir=snap, out_dir=out,
                  get=get5, now=DAY, log=logs.append, api_key="test-key", note_headers=note, floor=300, cap=250)
    check(not any("/odds/" in u for u in urls5) and any("/v4/sports/" in u for u in urls5),
          "near the floor: the free catalog runs, the paid keys do not")
    # race merge keeps the tip's later price and takes an older open from the snapshot
    snap_fut = os.path.join(snap, "_futures")
    tip_dir = os.path.join(td, "tip")
    os.makedirs(tip_dir, exist_ok=True)
    # run a real apply against a copy of history that already has today's pull, plus a snapshot with an older price
    subprocess.run([sys.executable, os.path.join(ROOT, "scripts", "line_history.py"), "apply-futures",
                    "--snap-dir", snap_fut, "--history-dir", tip_dir],
                   check=True, env={k: v for k, v in os.environ.items() if k != "ODDS_API_KEY"},
                   cwd=ROOT)
    merged = json.load(open(os.path.join(tip_dir, nfl["key"] + ".json")))
    check(merged["outcomes"]["San Francisco 49ers"]["open"]["draftkings"] == 430, "apply-futures writes the snapshot onto an empty tip")
    # second apply is stable
    subprocess.run([sys.executable, os.path.join(ROOT, "scripts", "line_history.py"), "apply-futures",
                    "--snap-dir", snap_fut, "--history-dir", tip_dir],
                   check=True, env={k: v for k, v in os.environ.items() if k != "ODDS_API_KEY"}, cwd=ROOT)
    merged2 = json.load(open(os.path.join(tip_dir, nfl["key"] + ".json")))
    check(merged2["outcomes"]["San Francisco 49ers"]["books"]["draftkings"] == merged["outcomes"]["San Francisco 49ers"]["books"]["draftkings"],
          "applying the same snapshot again does not duplicate points")

wf = open(os.path.join(ROOT, ".github", "workflows", "refresh-and-deploy.yml")).read()
check("line_history.py apply-futures --snap-dir ../.linehist-snap/_futures --history-dir history/futures" in wf,
      "the data-history retry merges futures instead of copying over the tip")
check("git push -f" not in wf and "--force" not in wf.split("Save line history snapshot", 1)[1].split("- name:", 1)[0],
      "the history push is still not a force push")
src = open(os.path.join(ROOT, "scripts", "futures.py")).read()
check("the-odds-api.com" in src and "urlopen" not in src, "futures builds URLs and does not open them itself")

print(f"\n{'PASS' if not fails else 'FAIL'} futures: {len(fails)} failed")
sys.exit(1 if fails else 0)
