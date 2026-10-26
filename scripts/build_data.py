#!/usr/bin/env python3
"""
LineSmart data builder.

Fetches REAL data from ESPN's free public JSON endpoints (no API key) and writes
static JSON files to site/data/ that the static front-end reads.

Optional: if the env var ODDS_API_KEY is set, also pulls DraftKings / FanDuel /
Hard Rock Bet lines from The Odds API (v4) for the odds-comparison table.

Usage:
    python3 scripts/build_data.py                 # all leagues
    python3 scripts/build_data.py --leagues nfl,nba --days 7
    ODDS_API_KEY=xxxx python3 scripts/build_data.py

Only uses the Python standard library.
"""
import argparse, concurrent.futures as cf, datetime as dt, gzip, json, os, re, sys, time
import urllib.parse, urllib.request, urllib.error
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "site", "data")
ET = ZoneInfo("America/New_York")
SITE = "https://site.api.espn.com/apis/site/v2/sports/"
STANDINGS = "https://site.api.espn.com/apis/v2/sports/"

# key, display name, ESPN path, extra scoreboard params, sport type, Odds API sport key
LEAGUES = [
    dict(key="nfl",   name="NFL",   full="National Football League", path="football/nfl", params="", kind="football", odds_key="americanfootball_nfl"),
    dict(key="nba",   name="NBA",   full="National Basketball Association", path="basketball/nba", params="", kind="basketball", odds_key="basketball_nba"),
    dict(key="ncaaf", name="NCAAF", full="College Football (FBS)", path="football/college-football", params="&groups=80&limit=300", kind="football", odds_key="americanfootball_ncaaf"),
    dict(key="ncaab", name="NCAAB", full="Men's College Basketball (D-I)", path="basketball/mens-college-basketball", params="&groups=50&limit=300", kind="basketball", odds_key="basketball_ncaab"),
    dict(key="nhl",   name="NHL",   full="National Hockey League", path="hockey/nhl", params="", kind="hockey", odds_key="icehockey_nhl"),
    dict(key="mlb",   name="MLB",   full="Major League Baseball", path="baseball/mlb", params="", kind="baseball", odds_key="baseball_mlb"),
    dict(key="epl",   name="EPL",   full="English Premier League", path="soccer/eng.1", params="", kind="soccer", odds_key="soccer_epl"),
    dict(key="mls",   name="MLS",   full="Major League Soccer", path="soccer/usa.1", params="", kind="soccer", odds_key="soccer_usa_mls"),
    dict(key="ucl",   name="UCL",   full="UEFA Champions League", path="soccer/uefa.champions", params="", kind="soccer", odds_key="soccer_uefa_champs_league"),
]
TARGET_BOOKS = [("draftkings", "DraftKings"), ("fanduel", "FanDuel"), ("hardrockbet", "Hard Rock Bet")]
MAX_SUMMARIES = 150

LOG = []
def log(*a):
    s = " ".join(str(x) for x in a); print(s, flush=True); LOG.append(s)

def get(url, tries=3):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 LineSmart/1.0", "Accept-Encoding": "gzip"})
            with urllib.request.urlopen(req, timeout=30) as r:
                b = r.read()
                if b[:2] == b"\x1f\x8b": b = gzip.decompress(b)
                return json.loads(b), dict(r.headers)
        except urllib.error.HTTPError as e:
            last = e
            if e.code in (400, 401, 403, 404, 422): break
        except Exception as e:
            last = e
        time.sleep(0.8 * (i + 1))
    raise last

def getj(url):
    return get(url)[0]

# ---------------------------------------------------------------- helpers
def num(v):
    if v is None: return None
    if isinstance(v, (int, float)): return v
    s = str(v).strip().lower().replace("o", "").replace("u", "")
    if s in ("even", "ev"): return 100
    try: return float(s)
    except ValueError: return None

def american(v):
    n = num(v)
    if n is None: return None
    return int(round(n))

def team_brief(c):
    t = c.get("team", {})
    recs = {r.get("type") or r.get("name"): r.get("summary") for r in c.get("records", []) or []}
    rank = (c.get("curatedRank") or {}).get("current")
    return dict(
        id=t.get("id"), abbr=t.get("abbreviation"), name=t.get("displayName"), short=t.get("shortDisplayName"),
        logo=t.get("logo"), color=t.get("color"), alt=t.get("alternateColor"),
        record=recs.get("total") or recs.get("overall"), homeRecord=recs.get("home"), awayRecord=recs.get("road") or recs.get("away"),
        rank=rank if rank and rank < 99 else None,
        score=c.get("score"), winner=c.get("winner"),
    )

def norm_odds(o):
    """Normalize an ESPN odds/pickcenter object into one flat structure."""
    if not o: return None
    prov = (o.get("provider") or {})
    ml, ps, tot = o.get("moneyline") or {}, o.get("pointSpread") or {}, o.get("total") or {}
    def g(d, side, when, field):
        return ((d.get(side) or {}).get(when) or {}).get(field)
    hto, ato = o.get("homeTeamOdds") or {}, o.get("awayTeamOdds") or {}
    res = dict(
        provider=prov.get("displayName") or prov.get("name"),
        details=o.get("details"),
        homeML=american(g(ml, "home", "close", "odds")) if ml else american(hto.get("moneyLine")),
        awayML=american(g(ml, "away", "close", "odds")) if ml else american(ato.get("moneyLine")),
        drawML=american(g(ml, "draw", "close", "odds")) if ml.get("draw") else american((o.get("drawOdds") or {}).get("moneyLine")),
        homeMLOpen=american(g(ml, "home", "open", "odds")), awayMLOpen=american(g(ml, "away", "open", "odds")),
        drawMLOpen=american(g(ml, "draw", "open", "odds")),
        homeSpread=num(g(ps, "home", "close", "line")), awaySpread=num(g(ps, "away", "close", "line")),
        homeSpreadOdds=american(g(ps, "home", "close", "odds")) or american(hto.get("spreadOdds")),
        awaySpreadOdds=american(g(ps, "away", "close", "odds")) or american(ato.get("spreadOdds")),
        homeSpreadOpen=num(g(ps, "home", "open", "line")), awaySpreadOpen=num(g(ps, "away", "open", "line")),
        total=num(g(tot, "over", "close", "line")) if tot else num(o.get("overUnder")),
        overOdds=american(g(tot, "over", "close", "odds")) or american(o.get("overOdds")),
        underOdds=american(g(tot, "under", "close", "odds")) or american(o.get("underOdds")),
        totalOpen=num(g(tot, "over", "open", "line")),
    )
    if res["homeSpread"] is None and o.get("spread") is not None and not ps:
        # ESPN 'spread' is expressed from the home team's perspective
        res["homeSpread"] = num(o.get("spread")); res["awaySpread"] = -res["homeSpread"] if res["homeSpread"] is not None else None
    if res["total"] is None: res["total"] = num(o.get("overUnder"))
    if all(res[k] is None for k in ("homeML", "awayML", "homeSpread", "total")): return None
    return res

def book_key_for(provider):
    p = re.sub(r"[^a-z]", "", (provider or "").lower())
    if "draftkings" in p: return "draftkings"
    if "fanduel" in p: return "fanduel"
    if "hardrock" in p: return "hardrockbet"
    return None

# ---------------------------------------------------------------- per-league fetch
def fetch_scoreboards(lg, days):
    today = dt.datetime.now(ET).date()
    events, ok_days, err = {}, 0, []
    for i in range(days):
        d = (today + dt.timedelta(days=i)).strftime("%Y%m%d")
        url = f"{SITE}{lg['path']}/scoreboard?dates={d}{lg['params']}"
        try:
            sb = getj(url); ok_days += 1
            for e in sb.get("events", []): events[e["id"]] = e
        except Exception as ex:
            err.append(f"{d}: {ex}")
    return list(events.values()), ok_days, err

def game_from_event(e):
    c = e["competitions"][0]
    comps = {x["homeAway"]: x for x in c["competitors"]}
    st = e.get("status") or c.get("status") or {}
    stype = st.get("type", {})
    bc = []
    for b in c.get("broadcasts", []) or []: bc += b.get("names", [])
    odds = norm_odds((c.get("odds") or [None])[0])
    return dict(
        id=e["id"], date=e["date"], name=e.get("name"), shortName=e.get("shortName"),
        state=stype.get("state"), statusDetail=stype.get("shortDetail") or stype.get("detail"), completed=stype.get("completed"),
        venue=(c.get("venue") or {}).get("fullName"), city=((c.get("venue") or {}).get("address") or {}).get("city"),
        neutral=c.get("neutralSite"), broadcasts=bc, note=((c.get("notes") or [{}])[0] or {}).get("headline"),
        home=team_brief(comps["home"]), away=team_brief(comps["away"]),
        odds=odds, oddsSource="ESPN scoreboard" if odds else None,
    )

def parse_summary(lg, g, m):
    det = {}
    # odds: pickcenter (more complete than scoreboard)
    pcs = [norm_odds(p) for p in (m.get("pickcenter") or [])]
    pcs = [p for p in pcs if p]
    if pcs:
        g["odds"] = pcs[0]; g["oddsSource"] = "ESPN pickcenter"
    det["allEspnOdds"] = pcs
    # team season stats (side by side)
    stats = {}
    for t in (m.get("boxscore") or {}).get("teams", []) or []:
        tid = (t.get("team") or {}).get("id")
        rows = [dict(name=s.get("name"), label=s.get("label") or s.get("abbreviation") or s.get("name"), value=s.get("displayValue"))
                for s in t.get("statistics", []) or [] if s.get("displayValue") not in (None, "")]
        stats[tid] = rows
    det["teamStats"] = stats
    # last five
    l5 = {}
    for blk in m.get("lastFiveGames", []) or []:
        tid = (blk.get("team") or {}).get("id"); rows = []
        for ev in blk.get("events", []) or []:
            opp = ev.get("opponent") or {}
            rows.append(dict(date=ev.get("gameDate"), atVs=ev.get("atVs"), opp=opp.get("abbreviation"), oppName=opp.get("displayName"),
                             oppLogo=ev.get("opponentLogo") or opp.get("logo"), result=ev.get("gameResult"), score=ev.get("score"),
                             homeScore=ev.get("homeTeamScore"), awayScore=ev.get("awayTeamScore"), homeTeamId=ev.get("homeTeamId")))
        l5[tid] = rows
    det["lastFive"] = l5
    # injuries
    inj = {}
    for blk in m.get("injuries", []) or []:
        tid = (blk.get("team") or {}).get("id"); rows = []
        for it in blk.get("injuries", []) or []:
            a = it.get("athlete") or {}
            rows.append(dict(player=a.get("displayName"), pos=(a.get("position") or {}).get("abbreviation"), status=it.get("status"),
                             type=(it.get("details") or {}).get("type"), detail=(it.get("details") or {}).get("detail"),
                             ret=(it.get("details") or {}).get("returnDate"), date=it.get("date")))
        inj[tid] = rows
    det["injuries"] = inj
    det["injuriesAvailable"] = "injuries" in m
    # ATS (ESPN usually returns empty records; kept so the UI can show it when present)
    ats = {}
    for blk in m.get("againstTheSpread", []) or []:
        tid = (blk.get("team") or {}).get("id")
        ats[tid] = [dict(type=r.get("type"), summary=r.get("summary"), display=r.get("displayName")) for r in blk.get("records", []) or []]
    det["ats"] = ats
    pr = m.get("predictor")
    if pr:
        det["predictor"] = dict(home=num((pr.get("homeTeam") or {}).get("gameProjection")), away=num((pr.get("awayTeam") or {}).get("gameProjection")))
    ss = m.get("seasonseries")
    if ss:
        det["seasonSeries"] = [dict(title=s.get("title"), summary=s.get("summary"),
                                    events=[dict(date=e.get("date"), score=" ".join(f"{c.get('team',{}).get('abbreviation')} {c.get('score')}" for c in e.get("competitors", []))) for e in s.get("events", []) or []])
                               for s in ss if isinstance(s, dict)]
    leaders = []
    for blk in m.get("leaders", []) or []:
        tid = (blk.get("team") or {}).get("id")
        for cat in blk.get("leaders", []) or []:
            top = (cat.get("leaders") or [{}])[0]
            if top: leaders.append(dict(teamId=tid, cat=cat.get("displayName"), player=(top.get("athlete") or {}).get("displayName"), value=top.get("displayValue")))
    det["leaders"] = leaders
    return det

def team_splits(lg, tid):
    """Compute record, scoring and home/away splits from the team's schedule (completed games only)."""
    s = getj(f"{SITE}{lg['path']}/teams/{tid}/schedule")
    season = (s.get("requestedSeason") or s.get("season") or {})
    games = []
    for e in s.get("events", []) or []:
        c = (e.get("competitions") or [{}])[0]
        if not ((c.get("status") or {}).get("type") or {}).get("completed"): continue
        me = next((x for x in c.get("competitors", []) if str(x.get("id") or x.get("team", {}).get("id")) == str(tid)), None)
        op = next((x for x in c.get("competitors", []) if x is not me), None)
        if not me or not op: continue
        def sc(x):
            v = x.get("score"); v = v.get("value") if isinstance(v, dict) else v
            try: return float(v)
            except (TypeError, ValueError): return None
        pf, pa = sc(me), sc(op)
        if pf is None or pa is None: continue
        res = "W" if me.get("winner") else ("L" if op.get("winner") else ("T" if pf == pa else ("W" if pf > pa else "L")))
        if lg["kind"] == "soccer" and pf == pa: res = "D"
        games.append(dict(date=e.get("date"), home=me.get("homeAway") == "home", pf=pf, pa=pa, res=res,
                          opp=(op.get("team") or {}).get("abbreviation")))
    games.sort(key=lambda x: x["date"])
    def agg(gs):
        if not gs: return None
        w = sum(1 for x in gs if x["res"] == "W"); l = sum(1 for x in gs if x["res"] == "L")
        d = sum(1 for x in gs if x["res"] in ("T", "D"))
        return dict(gp=len(gs), w=w, l=l, d=d, pf=round(sum(x["pf"] for x in gs) / len(gs), 2), pa=round(sum(x["pa"] for x in gs) / len(gs), 2))
    streak = None
    if games:
        last = games[-1]["res"]; n = 0
        for x in reversed(games):
            if x["res"] == last: n += 1
            else: break
        streak = f"{last}{n}"
    return dict(season=season.get("displayName") or season.get("year"), seasonType=season.get("name"),
                recordSummary=(s.get("team") or {}).get("recordSummary"), standingSummary=(s.get("team") or {}).get("standingSummary"),
                all=agg(games), homeSplit=agg([x for x in games if x["home"]]), awaySplit=agg([x for x in games if not x["home"]]),
                last10=agg(games[-10:]), streak=streak, recent=[dict(date=x["date"], res=x["res"], pf=x["pf"], pa=x["pa"], home=x["home"], opp=x["opp"]) for x in games[-5:]][::-1])

# ---------------------------------------------------------------- The Odds API (optional)
def norm_name(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower().replace("&", "and").replace("saint", "st").replace("state", "st"))

def odds_api(lg, games, key, report):
    url = (f"https://api.the-odds-api.com/v4/sports/{lg['odds_key']}/odds/?apiKey={urllib.parse.quote(key)}"
           f"&bookmakers={','.join(k for k, _ in TARGET_BOOKS)}&markets=h2h,spreads,totals&oddsFormat=american&dateFormat=iso")
    try:
        data, hdr = get(url)
    except Exception as ex:
        report["oddsApi"] = f"error: {ex}"; return
    report["oddsApi"] = f"{len(data)} events; credits remaining {hdr.get('x-requests-remaining') or hdr.get('X-Requests-Remaining')}"
    matched = 0
    for ev in data:
        h, a = norm_name(ev.get("home_team")), norm_name(ev.get("away_team"))
        t0 = dt.datetime.fromisoformat(ev["commence_time"].replace("Z", "+00:00"))
        best = None
        for g in games:
            gt = dt.datetime.fromisoformat(g["date"].replace("Z", "+00:00"))
            if abs((gt - t0).total_seconds()) > 6 * 3600: continue
            gh, ga = norm_name(g["home"]["name"]), norm_name(g["away"]["name"])
            if (h == gh or h in gh or gh in h) and (a == ga or a in ga or ga in a): best = g; break
        if not best: continue
        matched += 1
        books = best.setdefault("books", {})
        for bk in ev.get("bookmakers", []):
            r = dict(source="The Odds API", updated=bk.get("last_update"))
            for mk in bk.get("markets", []):
                for oc in mk.get("outcomes", []):
                    nm = norm_name(oc.get("name"))
                    side = "home" if nm == h else ("away" if nm == a else ("draw" if nm == "draw" else None))
                    if mk["key"] == "h2h" and side: r[f"{side}ML"] = american(oc.get("price"))
                    elif mk["key"] == "spreads" and side in ("home", "away"):
                        r[f"{side}Spread"] = oc.get("point"); r[f"{side}SpreadOdds"] = american(oc.get("price"))
                    elif mk["key"] == "totals":
                        r["total"] = oc.get("point")
                        r["overOdds" if oc.get("name") == "Over" else "underOdds"] = american(oc.get("price"))
                r["updated"] = mk.get("last_update") or r["updated"]
            books[bk["key"]] = r
    report["oddsApiMatched"] = matched

# ---------------------------------------------------------------- main
def build_league(lg, days, odds_key):
    t0 = time.time()
    report = dict(league=lg["key"], endpoints={})
    events, ok_days, errs = fetch_scoreboards(lg, days)
    report["endpoints"]["scoreboard"] = f"ok {ok_days}/{days} days" + (f"; errors: {errs[:2]}" if errs else "")
    games = sorted((game_from_event(e) for e in events), key=lambda g: g["date"])
    # summaries
    details, sum_ok, sum_err = {}, 0, 0
    targets = [g for g in games if g["state"] in ("pre", "in")][:MAX_SUMMARIES]
    with cf.ThreadPoolExecutor(12) as ex:
        futs = {ex.submit(getj, f"{SITE}{lg['path']}/summary?event={g['id']}"): g for g in targets}
        for f in cf.as_completed(futs):
            g = futs[f]
            try: details[g["id"]] = parse_summary(lg, g, f.result()); sum_ok += 1
            except Exception: sum_err += 1
    report["endpoints"]["summary"] = f"ok {sum_ok}, failed {sum_err}"
    # team splits
    tids = sorted({g[s]["id"] for g in games for s in ("home", "away") if g[s]["id"]})
    teams, t_ok, t_err = {}, 0, 0
    with cf.ThreadPoolExecutor(12) as ex:
        futs = {ex.submit(team_splits, lg, t): t for t in tids}
        for f in cf.as_completed(futs):
            try: teams[futs[f]] = f.result(); t_ok += 1
            except Exception: t_err += 1
    report["endpoints"]["teamSchedule"] = f"ok {t_ok}, failed {t_err}"
    for g in games:
        for s in ("home", "away"):
            ts = teams.get(g[s]["id"]) or {}
            g[s]["form"] = "".join(x["res"] for x in ts.get("recent", []))
    # ESPN line -> comparison column when the provider is one of the target books
    for g in games:
        books = {}
        for o in (details.get(g["id"], {}).get("allEspnOdds") or ([g["odds"]] if g.get("odds") else [])):
            k = book_key_for(o.get("provider"))
            if k and k not in books: books[k] = dict(o, source=f"ESPN ({o.get('provider')})")
        g["books"] = books
    if odds_key:
        odds_api(lg, games, odds_key, report)
    else:
        report["oddsApi"] = "skipped (no ODDS_API_KEY)"
    # write
    ldir = os.path.join(OUT, lg["key"]); os.makedirs(os.path.join(ldir, "games"), exist_ok=True)
    for fn in os.listdir(os.path.join(ldir, "games")): os.remove(os.path.join(ldir, "games", fn))
    for g in games:
        d = details.get(g["id"], {})
        d = {k: v for k, v in d.items() if k != "allEspnOdds"} | {"espnOddsProviders": [o.get("provider") for o in d.get("allEspnOdds", [])]}
        gt = {g["home"]["id"]: teams.get(g["home"]["id"]), g["away"]["id"]: teams.get(g["away"]["id"])}
        with open(os.path.join(ldir, "games", f"{g['id']}.json"), "w") as fh:
            json.dump(dict(league=lg["key"], game=g, detail=d, teams=gt, hasSummary=g["id"] in details), fh, separators=(",", ":"))
    with_odds = sum(1 for g in games if g.get("odds"))
    upcoming = sum(1 for g in games if g["state"] == "pre")
    providers = sorted({g["odds"]["provider"] for g in games if g.get("odds") and g["odds"].get("provider")})
    report.update(games=len(games), upcoming=upcoming, withOdds=with_odds, providers=providers, seconds=round(time.time() - t0, 1))
    idx = dict(league={k: lg[k] for k in ("key", "name", "full", "kind")}, generated=dt.datetime.now(dt.timezone.utc).isoformat(),
               windowDays=days, games=games, teams=teams, report=report)
    with open(os.path.join(ldir, "index.json"), "w") as fh: json.dump(idx, fh, separators=(",", ":"))
    log(f"[{lg['key']}] games={len(games)} upcoming={upcoming} withOdds={with_odds} providers={providers} {report['endpoints']} oddsApi={report['oddsApi']} ({report['seconds']}s)")
    return report

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--leagues", default=",".join(l["key"] for l in LEAGUES))
    ap.add_argument("--days", type=int, default=10, help="days ahead (including today, ET) to include")
    a = ap.parse_args()
    want = a.leagues.split(",")
    key = os.environ.get("ODDS_API_KEY", "").strip() or None
    os.makedirs(OUT, exist_ok=True)
    meta_path = os.path.join(OUT, "meta.json")
    meta = json.load(open(meta_path)) if os.path.exists(meta_path) else {"leagues": {}}
    for lg in LEAGUES:
        if lg["key"] not in want: continue
        try:
            rep = build_league(lg, a.days, key)
            meta["leagues"][lg["key"]] = dict(name=lg["name"], full=lg["full"], games=rep["games"], upcoming=rep["upcoming"],
                                              withOdds=rep["withOdds"], providers=rep["providers"], updated=dt.datetime.now(dt.timezone.utc).isoformat(), report=rep)
        except Exception as ex:
            log(f"[{lg['key']}] FAILED: {ex}")
            meta["leagues"].setdefault(lg["key"], dict(name=lg["name"], full=lg["full"], games=0, upcoming=0, withOdds=0, providers=[]))["error"] = str(ex)
    meta["order"] = [l["key"] for l in LEAGUES]
    meta["generated"] = dt.datetime.now(dt.timezone.utc).isoformat()
    meta["oddsApiEnabled"] = bool(key)
    meta["targetBooks"] = [dict(key=k, name=n) for k, n in TARGET_BOOKS]
    with open(meta_path, "w") as fh: json.dump(meta, fh, indent=1)
    log("done ->", OUT)

if __name__ == "__main__":
    main()
