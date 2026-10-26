"""Dev tool: run the real build (scripts/build_data.py main) with a FAKE Odds API, to preview the paid-plan site
(Hard Rock + FanDuel + DraftKings game lines and player props) without a key and without spending credits.

Every request to api.the-odds-api.com is answered locally from the ESPN games/props in a data mirror
(FIXTURE_MIRROR, default /tmp/ghroot/data): Hard Rock and FanDuel lines are DraftKings' nudged a little.
ESPN requests go out as normal (free). Nothing here can reach the paid API: the fake key is not a key and the
request is answered before any network call.

Usage:  env -u ODDS_API_KEY DATA_OUT=/tmp/paid/data python3 scripts/odds_fixture_build.py --leagues nfl,nba,nhl \
            --odds-cache-dir /tmp/paid/cache --no-weather"""
import datetime as dt, json, os, sys, urllib.parse, zlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
if os.environ.get("ODDS_API_KEY"): sys.exit("refusing to run with a real ODDS_API_KEY in the environment (use env -u ODDS_API_KEY)")
FAKE = "fixture-not-a-real-key"
os.environ["ODDS_API_KEY"] = FAKE
os.environ.setdefault("ODDS_FORCE", "1")
import build_data as BD, odds_props as OP

MIRROR = os.environ.get("FIXTURE_MIRROR", "/tmp/ghroot/data")
real_get = BD.get
STATE = dict(used=int(os.environ.get("FIXTURE_USED", "1840")))
SPORT = {l["odds_key"]: l["key"] for l in BD.LEAGUES if l.get("odds_key")}

def hdr(last):
    STATE["used"] += last
    return {"x-requests-remaining": str(100000 - STATE["used"]), "x-requests-used": str(STATE["used"]), "x-requests-last": str(last)}

def h(*a): return zlib.crc32("|".join(map(str, a)).encode()) % 1000   # deterministic jitter

def mirror_games(lg, to=None):
    try: idx = json.load(open(os.path.join(MIRROR, lg, "index.json")))
    except OSError: return []
    out = []
    for g in idx.get("games") or []:
        if g.get("state") != "pre": continue
        t = dt.datetime.fromisoformat(g["date"].replace("Z", "+00:00"))
        if to and t > to: continue
        out.append((g, t))
    return out

def ev_of(g, t):
    return dict(id=f"ev{g['id']}", sport_key="", commence_time=t.strftime("%Y-%m-%dT%H:%M:%SZ"),
                home_team=g["home"]["name"], away_team=g["away"]["name"])

def nudge_price(p, d):
    if p is None: return None
    q = p + d
    if -100 < q < 100: q = q + 200 if d > 0 or (d == 0 and q < 0) else q - 200
    return q

def game_book(g, bk):
    dk = (g.get("books") or {}).get("draftkings") or g.get("odds") or {}
    j = h(g["id"], bk)
    dsp = 0.5 if j % 3 == 0 else (-0.5 if j % 3 == 1 else 0)
    dtot = 0.5 if j % 4 == 0 else (-0.5 if j % 4 == 1 else 0)
    dml = (j % 21) - 10
    hn, an = g["home"]["name"], g["away"]["name"]
    m = []
    if dk.get("homeML") is not None:
        m.append(dict(key="h2h", outcomes=[dict(name=hn, price=nudge_price(dk["homeML"], dml)), dict(name=an, price=nudge_price(dk.get("awayML"), -dml))]))
    if dk.get("homeSpread") is not None:
        m.append(dict(key="spreads", outcomes=[dict(name=hn, price=-110 + (j % 7) - 3, point=dk["homeSpread"] + dsp),
                                               dict(name=an, price=-110 - (j % 7) + 3, point=-(dk["homeSpread"] + dsp))]))
    if dk.get("total") is not None:
        m.append(dict(key="totals", outcomes=[dict(name="Over", price=-110 + (j % 9) - 4, point=dk["total"] + dtot),
                                              dict(name="Under", price=-110 - (j % 9) + 4, point=dk["total"] + dtot)]))
    return dict(key=bk, title=bk, last_update=dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), markets=m)

def props_event(lg, gid, books, markets):
    try: P = json.load(open(os.path.join(MIRROR, "props", f"{lg}.json")))
    except OSError: return []
    rows = (P.get("games", {}).get(gid) or {}).get("props") or []
    rev = {mk: api for api, mk in OP.MARKETS.get(lg, [])}
    out = []
    for bk in books:
        mk_out = {}
        for r in rows:
            pid, mk, line = r[0], r[1], r[2]
            api = rev.get(mk)
            if not api or api not in markets or line is None: continue
            pl = P["players"].get(pid) or {}
            name = pl.get("n")
            if not name: continue
            j = h(gid, pid, mk, bk)
            if bk == "fanduel" and j % 5 == 0: continue        # FanDuel doesn't post every prop
            if bk == "draftkings" and j % 4 == 0: continue     # nor does DraftKings on the Odds API (site falls back to ESPN's line)
            if mk == "anytime_td":
                yes = 100 + j % 250
                oc = [dict(name="Yes", description=name, price=yes), dict(name="No", description=name, price=-(yes + 40))]
            else:
                step = 1.0 if line >= 20 else 0.5 if line >= 2 else 0
                d = step if j % 3 == 0 else (-step if j % 3 == 1 else 0)
                o = -110 + (j % 31) - 15
                oc = [dict(name="Over", description=name, price=nudge_price(o, 0), point=line + d),
                      dict(name="Under", description=name, price=nudge_price(-220 - o, 0), point=line + d)]
            mk_out.setdefault(api, []).extend(oc)
        if mk_out:
            out.append(dict(key=bk, title=bk, last_update=dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                            markets=[dict(key=k, outcomes=v) for k, v in mk_out.items()]))
    return out

def fake_get(url, tries=3):
    if "the-odds-api.com" not in url: return real_get(url, tries)
    u = urllib.parse.urlparse(url); q = urllib.parse.parse_qs(u.query)
    assert q.get("apiKey") == [FAKE], "fixture build must never send a real key"
    parts = u.path.strip("/").split("/")   # v4 / sports / {sport} / odds | events [/ {id} / odds]
    if parts == ["v4", "sports"]: return [], hdr(0)
    lg = SPORT.get(parts[2])
    to = dt.datetime.fromisoformat(q["commenceTimeTo"][0].replace("Z", "+00:00")) if q.get("commenceTimeTo") else None
    books = (q.get("bookmakers") or ["hardrockbet"])[0].split(",")
    markets = (q.get("markets") or [""])[0].split(",")
    if parts[3] == "events" and len(parts) == 4:
        return [ev_of(g, t) for g, t in mirror_games(lg, to)], hdr(0)
    if parts[3] == "odds":
        evs = [dict(ev_of(g, t), bookmakers=[game_book(g, b) for b in books]) for g, t in mirror_games(lg, to)]
        return evs, hdr(len(markets) * ((len(books) + 9) // 10) if evs else 0)
    if parts[3] == "events" and parts[5] == "odds":
        gid = parts[4][2:]
        bks = props_event(lg, gid, books, markets)
        n = len({m["key"] for b in bks for m in b["markets"]})
        return dict(id=parts[4], bookmakers=bks), hdr(n)
    raise AssertionError("unexpected fake Odds API path " + u.path)

BD.get = fake_get
if __name__ == "__main__":
    BD.main()
    os.environ.pop("ODDS_API_KEY", None)
