"""Offline tests for scripts/slate.py (home-page slate + ticker) and line_history sparklines. No network.
Run: python3 scripts/slate_test.py"""
import datetime as dt, json, os, random, subprocess, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import slate as SL, line_history as LH

ok = fail = 0
def check(c, msg):
    global ok, fail
    if c: ok += 1
    else: fail += 1; print("FAIL:", msg)

# ---- sparklines
check(LH.spark([1, 2, 3]) == [1, 2, 3], "short series unchanged")
s = LH.spark(list(range(100)))
check(len(s) == LH.SPARK_MAX and s[0] == 0 and s[-1] == 99, "downsample keeps first/last and caps length")
gh = dict(open=dict(draftkings=dict(hs=-3.0, tot=48.5)), books=dict(draftkings=[["2026-10-26T01:00:00Z", dict(hs=-4.5, tot=47.5)], ["2026-10-26T02:00:00Z", dict(hs=-5.0, tot=47.5)]]))
m = LH.summarize(gh, "football", "nfl")
check(m["spark"]["spread"] == [-3.0, -4.5, -5.0], "spread spark starts at the open line")
check(m["spark"]["total"] == [48.5, 47.5, 47.5], "total spark")
check(m["spread"]["delta"] == -2.0, "summary unchanged")
gh1 = dict(books=dict(draftkings=[["2026-10-26T01:00:00Z", dict(hs=-4.5)]]))
check("spark" not in (LH.summarize(gh1, "football", "nfl") or {}), "no spark with a single point")

# ---- is_hot parity with props-core.js
row = lambda v: ["2026-10-01", "X", "vs", {"rec_yds": v} if v is not None else {}]
check(SL.is_hot([row(v) for v in (80, 90, 70, 95, 60)], "rec_yds", 65.5), "4/5 over is hot")
check(not SL.is_hot([row(v) for v in (80, 90, 60, 50, 60)], "rec_yds", 65.5), "2/5 over not hot")
check(SL.is_hot([row(v) for v in (80, 90)], "rec_yds", 65.5), "2/2 is hot")
check(not SL.is_hot([row(80)], "rec_yds", 65.5), "1 game is not enough")
check(SL.is_hot([row(v) for v in (80, None, 90, 70, 99)], "rec_yds", 65.5), "DNP doesn't count")
random.seed(7); cases = []
for _ in range(300):
    log = [row(random.choice([None, random.randint(0, 120)])) for _ in range(random.randint(0, 10))]
    cases.append([log, "rec_yds", random.choice([0.5, 20.5, 55.5, 60, 80.5])])
js = ("const C=require('./site/assets/props-core.js');const cs=JSON.parse(require('fs').readFileSync(0,'utf8'));"
      "process.stdout.write(JSON.stringify(cs.map(([l,m,x])=>C.isHot(l,m,x))))")
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
try:
    r = subprocess.run(["node", "-e", js], input=json.dumps(cases), capture_output=True, text=True, cwd=root, timeout=30)
    check(json.loads(r.stdout) == [SL.is_hot(*c) for c in cases], "is_hot matches PropsCore.isHot on 300 random cases")
except FileNotFoundError:
    print("(node not found: skipped JS parity)")

# ---- build() over a fake data dir
now = dt.datetime(2026, 10, 26, 18, 0, tzinfo=dt.timezone.utc)   # 2 PM ET
T = lambda h: (now + dt.timedelta(hours=h)).isoformat().replace("+00:00", "Z")
team = lambda a, sc=None: dict(abbr=a, score=sc)
games = [dict(id="1", date=T(-3), state="post", statusDetail="Final", away=team("AAA", "3"), home=team("BBB", "1")),
         dict(id="2", date=T(-1), state="in", statusDetail="Q2 5:00", away=team("CCC", "7"), home=team("DDD", "10"), odds={"total": 40}),
         dict(id="3", date=T(5), state="pre", away=team("EEE"), home=team("FFF"), odds={"total": 44},
              weather=dict(kind="forecast", watch=[dict(k="wind", text="Wind 20 mph")])),
         dict(id="4", date=T(30), state="pre", away=team("GGG"), home=team("HHH"),
              weather=dict(kind="forecast", roof="retractable", watch=[dict(k="rain", text="Rain")])),
         dict(id="5", date=T(-30), state="post", away=team("III", "1"), home=team("JJJ", "2"))]
with tempfile.TemporaryDirectory() as d:
    os.makedirs(f"{d}/nfl"); os.makedirs(f"{d}/props")
    json.dump(dict(games=games), open(f"{d}/nfl/index.json", "w"))
    P = {"p1": dict(log=[row(v) for v in (80, 90, 70, 95, 60)]), "p2": dict(log=[row(10)])}
    json.dump(dict(players=P, games={"3": dict(props=[["p1", "rec_yds", 65.5, 60.5, [1, 0, 0, 1]], ["p2", "rec_yds", 5.5, 5.5, [1, 0, 0, 1]]])}), open(f"{d}/props/nfl.json", "w"))
    sl = SL.build(d, ["nfl", "nba"], now=now)
e = sl["leagues"]["nfl"]
check("nba" not in sl["leagues"], "missing league skipped")
check(e["today"] == 3, f"today = 3 (got {e['today']})")
check(e["live"] == 1 and e["upcoming"] == 2, "live / upcoming")
check(e["withOdds"] == 2, "with odds counts live/pre only")
check(e["wxWatch"] == 1, "weather watch ignores retractable roofs")
check(e["props"] == 2 and e["hot"] == 1, "props / hot")
check(sl["totals"]["hot"] == 1 and sl["totals"]["live"] == 1, "totals")
check([t["id"] for t in sl["ticker"]] == ["2", "1", "3", "4"], f"ticker order live, finals today, next ({[t['id'] for t in sl['ticker']]})")
check(sl["ticker"][0]["a"] == dict(a="CCC", s="7") and sl["ticker"][0]["lg"] == "nfl", "ticker item shape")
check(sl["day"] == "2026-10-26", "ET day")
print(f"slate_test: {ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
