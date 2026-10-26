#!/usr/bin/env python3
"""
LineSmart data builder.

Fetches REAL data from ESPN's free public JSON endpoints (no API key) and writes
static JSON files to site/data/ that the static front-end reads.

Optional: if the env var ODDS_API_KEY is set, also pulls Hard Rock Bet lines from The Odds API (v4)
(bookmakers=hardrockbet, 3 credits per league). The last pull is persisted in --odds-cache-dir and
merged into every build, so keyless runs keep showing it ("as of" the pull time).

Usage:
    python3 scripts/build_data.py                 # all leagues
    python3 scripts/build_data.py --leagues nfl,nba --days 7
    ODDS_API_KEY=xxxx python3 scripts/build_data.py

Only uses the Python standard library.
"""
import argparse, concurrent.futures as cf, datetime as dt, gzip, json, os, re, sys, time, unicodedata
import urllib.parse, urllib.request, urllib.error
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import line_history as LH
import search_index as SI
import matchups as MU

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.environ.get("DATA_OUT") or os.path.join(ROOT, "site", "data")   # DATA_OUT: build elsewhere (local testing)
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
TARGET_BOOKS = [("draftkings", "DraftKings"), ("hardrockbet", "Hard Rock Bet")]  # FanDuel: not tracked (no free source)
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
            ath = (top.get("athlete") or {}) if top else {}
            if top: leaders.append(dict(teamId=tid, cat=cat.get("displayName"), player=ath.get("displayName"), value=top.get("displayValue"),
                                        id=str(ath["id"]) if ath.get("id") else None, pos=(ath.get("position") or {}).get("abbreviation")))
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

ODDS_API = "https://api.the-odds-api.com"
ODDS_BOOK = "hardrockbet"            # only Hard Rock Bet is pulled (free plan); DraftKings comes from ESPN
ODDS_REGION = "us2"                  # hardrockbet's region (bookmakers= takes priority anyway; 1 book = 1 region)
ODDS_MARKETS = "h2h,spreads,totals"  # 3 markets x 1 region = 3 credits per league request (0 if no events)
ODDS_COST = 3
ODDS_MIN_CREDITS = int(os.environ.get("ODDS_MIN_CREDITS") or 35)  # skip the whole pull below this
ODDS_CACHE_FILE = f"{ODDS_BOOK}.json"

def _hdr(hdr, name):
    for k, v in (hdr or {}).items():
        if k.lower() == name:
            try: return int(float(v))
            except (TypeError, ValueError): return None
    return None

def odds_credits(key):
    """Remaining credits via GET /v4/sports, which costs 0 credits but still returns the x-requests-* headers."""
    _, hdr = get(f"{ODDS_API}/v4/sports/?apiKey={urllib.parse.quote(key)}")
    return _hdr(hdr, "x-requests-remaining"), _hdr(hdr, "x-requests-used")

# Odds API name -> ESPN name, for names token overlap can't bridge (normalized with team_tokens' folding)
TEAM_ALIASES = {"sporting lisbon": "sporting cp", "los angeles fc": "lafc", "new york red bulls": "red bull new york",
                "appalachian state mountaineers": "app state mountaineers", "inter milan": "internazionale"}
_GENERIC = {"fc", "cf", "sc", "afc", "cd", "ac", "the", "de", "and", "club"}

def _fold(s):
    s = unicodedata.normalize("NFKD", (s or "").replace("ø", "o").replace("Ø", "O").replace("&", " and "))
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()

def team_tokens(name):
    f = _fold(name); f = TEAM_ALIASES.get(f, f)
    return {("st" if t in ("state", "saint") else t.rstrip("s") if len(t) > 3 else t) for t in f.split()} - _GENERIC

def team_sim(a, b):
    """1.0 for same/contained compact names; else token overlap / smaller token set."""
    fa, fb = _fold(a).replace(" ", ""), _fold(b).replace(" ", "")
    if fa and fb and (fa == fb or fa in fb or fb in fa): return 1.0
    ta, tb = team_tokens(a), team_tokens(b)
    if not ta or not tb: return 0.0
    if ta == tb: return 1.0
    return len(ta & tb) / min(len(ta), len(tb))

def match_event(ev, games, min_sim=0.6):
    """Best ESPN game for an Odds API event: both teams must match (either orientation: neutral sites
    sometimes list home/away the other way round), kickoff within 6h. Returns (game, swapped) or (None, False)."""
    t0 = dt.datetime.fromisoformat(ev["commence_time"].replace("Z", "+00:00"))
    best, best_sc, swapped = None, 0.0, False
    for g in games:
        gt = dt.datetime.fromisoformat(g["date"].replace("Z", "+00:00"))
        dtsec = abs((gt - t0).total_seconds())
        if dtsec > 6 * 3600: continue
        gh, ga = g["home"]["name"], g["away"]["name"]
        for sw, (x, y) in ((False, (gh, ga)), (True, (ga, gh))):
            sh, sa = team_sim(ev.get("home_team"), x), team_sim(ev.get("away_team"), y)
            if min(sh, sa) < min_sim: continue
            sc = sh + sa - dtsec / 86400 - (0.01 if sw else 0)
            if sc > best_sc: best, best_sc, swapped = g, sc, sw
    return best, swapped

def odds_book_record(ev, bk, swapped=False):
    h, a = norm_name(ev.get("home_team")), norm_name(ev.get("away_team"))
    hk, ak = ("away", "home") if swapped else ("home", "away")   # map the event's sides onto ESPN's home/away
    r = dict(updated=bk.get("last_update"))
    for mk in bk.get("markets", []):
        for oc in mk.get("outcomes", []):
            nm = norm_name(oc.get("name"))
            side = hk if nm == h else (ak if nm == a else ("draw" if nm == "draw" else None))
            if mk.get("key") == "h2h" and side: r[f"{side}ML"] = american(oc.get("price"))
            elif mk.get("key") == "spreads" and side in ("home", "away"):
                r[f"{side}Spread"] = oc.get("point"); r[f"{side}SpreadOdds"] = american(oc.get("price"))
            elif mk.get("key") == "totals":
                r["total"] = oc.get("point")
                r["overOdds" if oc.get("name") == "Over" else "underOdds"] = american(oc.get("price"))
    return r

def odds_pull_league(lg, games, pull, t):
    """One Hard Rock pull for a league (3 credits, 0 if no events). Returns a cache entry, or None if skipped/failed."""
    rem = pull.get("remaining")
    if rem is None or rem < ODDS_COST:
        pull["skipped"].append(lg["key"]); return None, f"skipped (credits remaining {rem})"
    url = (f"{ODDS_API}/v4/sports/{lg['odds_key']}/odds/?apiKey={urllib.parse.quote(pull['key'])}"
           f"&regions={ODDS_REGION}&bookmakers={ODDS_BOOK}&markets={ODDS_MARKETS}&oddsFormat=american&dateFormat=iso")
    try:
        data, hdr = get(url)
    except Exception as ex:
        pull["errors"].append(lg["key"]); return None, f"error: {str(ex).replace(pull['key'], '***')}"
    r2, last = _hdr(hdr, "x-requests-remaining"), _hdr(hdr, "x-requests-last")
    if r2 is not None: pull["remaining"] = r2
    pull["spent"] += last or 0
    out, unmatched = {}, 0
    for ev in data or []:
        bk = next((b for b in ev.get("bookmakers", []) if b.get("key") == ODDS_BOOK), None)
        if not bk: continue
        g, sw = match_event(ev, games)
        if not g: unmatched += 1; log(f"[{lg['key']}] odds: no ESPN match for {ev.get('away_team')} @ {ev.get('home_team')} {ev.get('commence_time')}"); continue
        out[g["id"]] = dict(date=g["date"], home=g["home"]["abbr"], away=g["away"]["abbr"], line=odds_book_record(ev, bk, sw))
    pull["pulled"].append(lg["key"])
    entry = dict(pulledAt=t, events=len(data or []), matched=len(out), unmatched=unmatched, cost=last, remainingAfter=pull["remaining"], games=out)
    return entry, f"pulled {len(data or [])} events, {len(out)} matched, cost {last}, credits remaining {pull['remaining']}"

def odds_cache_load(d):
    try:
        with open(os.path.join(d, ODDS_CACHE_FILE)) as fh: c = json.load(fh)
        if c.get("v") == 1 and isinstance(c.get("leagues"), dict): return c
    except (OSError, ValueError, TypeError):
        pass
    return dict(v=1, book=ODDS_BOOK, leagues={}, checks=[])

def odds_cache_prune(c, now):
    for e in c["leagues"].values():
        e["games"] = {k: v for k, v in (e.get("games") or {}).items()
                      if v.get("date") and dt.datetime.fromisoformat(v["date"].replace("Z", "+00:00")) >= now - dt.timedelta(days=1)}
    c["checks"] = (c.get("checks") or [])[-40:]

def odds_cache_save(d, c):
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, ODDS_CACHE_FILE); tmp = p + ".tmp"
    with open(tmp, "w") as fh: json.dump(c, fh, indent=1, sort_keys=True)
    os.replace(tmp, p)

def apply_cached_odds(lg, games, cache, now):
    """Put the last Hard Rock pull into each game's books; started games get a stale marker without numbers."""
    e = (cache or {}).get("leagues", {}).get(lg["key"])
    if not e: return 0, 0
    fresh = stale = 0
    for g in games:
        c = (e.get("games") or {}).get(g["id"])
        if not c: continue
        started = g.get("state") != "pre" or dt.datetime.fromisoformat(g["date"].replace("Z", "+00:00")) <= now
        if started:
            g.setdefault("books", {})[ODDS_BOOK] = dict(stale=True, asOf=e["pulledAt"], source="The Odds API", reason="game started")
            stale += 1
        else:
            g.setdefault("books", {})[ODDS_BOOK] = dict(c["line"], asOf=e["pulledAt"], source="The Odds API")
            fresh += 1
    return fresh, stale

# ---------------------------------------------------------------- main
def build_league(lg, days, pull=None, odds_cache=None, hist_dir=None, snap_dir=None, run_t=None):
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
    # Hard Rock Bet: pull from The Odds API only on pull runs; every run merges the last persisted pull
    run_t = run_t or LH.now_iso()
    if pull:
        entry, msg = odds_pull_league(lg, games, pull, run_t)
        if entry is not None and odds_cache is not None: odds_cache["leagues"][lg["key"]] = entry
        report["oddsApi"] = msg
    else:
        report["oddsApi"] = "not a pull run (using last persisted Hard Rock pull)"
    fresh, stale = apply_cached_odds(lg, games, odds_cache, dt.datetime.now(dt.timezone.utc))
    le = (odds_cache or {}).get("leagues", {}).get(lg["key"]) or {}
    report["hardrock"] = dict(asOf=le.get("pulledAt"), shown=fresh, stale=stale)
    # line movement: snapshot this run's pre-game lines, merge into persistent history (if any), summarize
    snap = LH.snapshot_from_games(games)
    if snap_dir:
        os.makedirs(snap_dir, exist_ok=True)
        with open(os.path.join(snap_dir, f"{lg['key']}.json"), "w") as fh: json.dump(dict(league=lg["key"], t=run_t, games=snap), fh)
    if hist_dir:
        hpath = os.path.join(hist_dir, f"{lg['key']}.json")
        hist = LH.load(hpath, lg["key"]); added = LH.merge(hist, snap, run_t); pruned = LH.prune(hist); LH.save(hpath, hist)
        report["history"] = f"+{added} points, pruned {pruned}, tracking {len(hist['games'])} games"
    else:
        hist = dict(games={}); LH.merge(hist, snap, run_t)
        report["history"] = "no history dir (ESPN open line only)"
    for g in games:
        gh = hist["games"].get(g["id"])
        g["move"] = LH.summarize(gh, lg["kind"], lg["key"]) if gh else None
    # write
    ldir = os.path.join(OUT, lg["key"]); os.makedirs(os.path.join(ldir, "games"), exist_ok=True)
    for fn in os.listdir(os.path.join(ldir, "games")): os.remove(os.path.join(ldir, "games", fn))
    for g in games:
        d = details.get(g["id"], {})
        d = {k: v for k, v in d.items() if k != "allEspnOdds"} | {"espnOddsProviders": [o.get("provider") for o in d.get("allEspnOdds", [])]}
        gt = {g["home"]["id"]: teams.get(g["home"]["id"]), g["away"]["id"]: teams.get(g["away"]["id"])}
        with open(os.path.join(ldir, "games", f"{g['id']}.json"), "w") as fh:
            json.dump(dict(league=lg["key"], game=g, detail=d, teams=gt, hasSummary=g["id"] in details,
                           history=hist["games"].get(g["id"])), fh, separators=(",", ":"))
    with_odds = sum(1 for g in games if g.get("odds"))
    upcoming = sum(1 for g in games if g["state"] == "pre")
    providers = sorted({g["odds"]["provider"] for g in games if g.get("odds") and g["odds"].get("provider")})
    report.update(games=len(games), upcoming=upcoming, withOdds=with_odds, providers=providers, seconds=round(time.time() - t0, 1))
    idx = dict(league={k: lg[k] for k in ("key", "name", "full", "kind")}, generated=dt.datetime.now(dt.timezone.utc).isoformat(),
               windowDays=days, games=games, teams=teams, report=report)
    with open(os.path.join(ldir, "index.json"), "w") as fh: json.dump(idx, fh, separators=(",", ":"))
    log(f"[{lg['key']}] games={len(games)} upcoming={upcoming} withOdds={with_odds} providers={providers} {report['endpoints']} oddsApi={report['oddsApi']} history={report['history']} ({report['seconds']}s)")
    return report

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--leagues", default=",".join(l["key"] for l in LEAGUES))
    ap.add_argument("--days", type=int, default=10, help="days ahead (including today, ET) to include")
    ap.add_argument("--history-dir", default=os.environ.get("LINE_HISTORY_DIR") or None,
                    help="dir with <league>.json line history (data-history branch checkout); omit to skip persistence")
    ap.add_argument("--snap-dir", default=os.environ.get("LINE_SNAP_DIR") or None,
                    help="also write this run's raw line snapshot per league here (for re-applying after a push race)")
    ap.add_argument("--odds-cache-dir", default=os.environ.get("ODDS_CACHE_DIR") or None,
                    help="dir holding the last Hard Rock pull (hardrockbet.json, data-history branch); merged into every build")
    ap.add_argument("--roster-cache-dir", default=os.environ.get("ROSTER_CACHE_DIR") or None,
                    help="dir caching team rosters for the search index (data-history branch); omit to fetch fresh every run")
    ap.add_argument("--roster-max-age-hours", type=float, default=float(os.environ.get("ROSTER_MAX_AGE_H") or 20),
                    help="re-fetch rosters when the cached copy is older than this")
    ap.add_argument("--matchup-cache-dir", default=os.environ.get("MATCHUP_CACHE_DIR") or None,
                    help="dir caching compact box scores for defense-vs-position (data-history branch); omit to fetch every game each run")
    ap.add_argument("--no-matchups", action="store_true", help="skip the opponent defense-vs-position data (data/matchups)")
    ap.add_argument("--no-search", action="store_true", help="skip the team/player search index")
    ap.add_argument("--search-only", action="store_true", help="only (re)build the search index and matchups (opponent defense); leave game data and odds untouched")
    a = ap.parse_args()
    run_t = LH.now_iso()
    want = a.leagues.split(",")
    key = None if a.search_only else (os.environ.get("ODDS_API_KEY", "").strip() or None)
    cache = odds_cache_load(a.odds_cache_dir) if a.odds_cache_dir else None
    pull, check = None, None
    if key:
        # credit guard: free call first; skip the whole pull if remaining credits are low or unknown
        try:
            rem, used = odds_credits(key)
        except Exception as ex:
            rem, used = None, None; log(f"[odds] credit check failed: {str(ex).replace(key, '***')}")
        if rem is not None and rem >= ODDS_MIN_CREDITS:
            pull = dict(key=key, remaining=rem, spent=0, pulled=[], skipped=[], errors=[])
            log(f"[odds] credits remaining {rem} (used {used}); pulling Hard Rock Bet for {len(want)} leagues (~{len(want) * ODDS_COST} credits max)")
        else:
            log(f"[odds] credit guard: remaining={rem} (< {ODDS_MIN_CREDITS} or unknown); skipping Hard Rock pull")
        check = dict(t=run_t, remainingBefore=rem, used=used, action="pull" if pull else "skipped (credit guard)")
    else:
        log("[odds] no ODDS_API_KEY for this run (not a pull run); using last persisted Hard Rock pull" + ("" if cache is not None else " - none available"))
    os.makedirs(OUT, exist_ok=True)
    meta_path = os.path.join(OUT, "meta.json")
    meta = json.load(open(meta_path)) if os.path.exists(meta_path) else {"leagues": {}}
    for lg in LEAGUES:
        if lg["key"] not in want or a.search_only: continue
        try:
            rep = build_league(lg, a.days, pull, cache, a.history_dir, a.snap_dir, run_t)
            meta["leagues"][lg["key"]] = dict(name=lg["name"], full=lg["full"], games=rep["games"], upcoming=rep["upcoming"],
                                              withOdds=rep["withOdds"], providers=rep["providers"], updated=dt.datetime.now(dt.timezone.utc).isoformat(), report=rep)
        except Exception as ex:
            log(f"[{lg['key']}] FAILED: {ex}")
            meta["leagues"].setdefault(lg["key"], dict(name=lg["name"], full=lg["full"], games=0, upcoming=0, withOdds=0, providers=[]))["error"] = str(ex)
    if check is not None and pull:
        check.update(remainingAfter=pull["remaining"], spent=pull["spent"], pulled=pull["pulled"], skipped=pull["skipped"], errors=pull["errors"])
        log(f"[odds] pull done: spent {pull['spent']} credits, remaining {pull['remaining']}; pulled={pull['pulled']} skipped={pull['skipped']} errors={pull['errors']}")
    if cache is not None and not a.search_only:
        if check is not None: cache.setdefault("checks", []).append(check)
        odds_cache_prune(cache, dt.datetime.now(dt.timezone.utc))
        pulls = [e.get("pulledAt") for e in cache["leagues"].values() if e.get("pulledAt")]
        cache["updated"] = max(pulls) if pulls else None
        odds_cache_save(a.odds_cache_dir, cache)
        if pull and pull["pulled"] and a.snap_dir:     # this run's fresh leagues, for re-applying after a push race
            odds_cache_save(os.path.join(a.snap_dir, "_odds"), dict(cache, leagues={k: cache["leagues"][k] for k in pull["pulled"]}))
    if not a.no_search:
        meta.setdefault("search", {})
        for lg in LEAGUES:
            if lg["key"] not in want: continue
            try:
                meta["search"][lg["key"]] = SI.build_search(lg, getj, SITE, STANDINGS, os.path.join(OUT, "search"),
                                                            a.roster_cache_dir, a.roster_max_age_hours, a.snap_dir, log)
            except Exception as ex:
                log(f"[{lg['key']}] search index FAILED: {ex}")   # the previous file (if any) stays in place
                meta["search"].setdefault(lg["key"], {})["error"] = str(ex)[:200]
    if not a.no_matchups:
        meta.setdefault("matchups", {})
        for lg in LEAGUES:
            if lg["key"] not in want or lg["key"] not in MU.SUPPORTED: continue
            try:
                meta["matchups"][lg["key"]] = MU.build_matchups(lg, getj, SITE, os.path.join(OUT, "matchups"), os.path.join(OUT, "search"),
                                                                a.matchup_cache_dir, a.snap_dir, log, teams_list=SI._teams_list)
            except Exception as ex:
                log(f"[{lg['key']}] matchups FAILED: {ex}")   # the previous file (if any) stays in place
                meta["matchups"].setdefault(lg["key"], {})["error"] = str(ex)[:200]
    if a.search_only:
        with open(meta_path, "w") as fh: json.dump(meta, fh, indent=1)
        return log("search index done ->", os.path.join(OUT, "search"))
    meta["order"] = [l["key"] for l in LEAGUES]
    meta["generated"] = dt.datetime.now(dt.timezone.utc).isoformat()
    lgs = (cache or {}).get("leagues", {})
    meta["hardrock"] = dict(book=ODDS_BOOK, schedule="every other day (odd dates) ~11:10 AM ET + manual", pulledThisRun=bool(pull and pull["pulled"]),
                            asOf=(cache or {}).get("updated"), leagues={k: v.get("pulledAt") for k, v in lgs.items()},
                            lastCheck=((cache or {}).get("checks") or [None])[-1])
    meta["oddsApiEnabled"] = bool(lgs)
    meta["historyEnabled"] = bool(a.history_dir)
    meta["targetBooks"] = [dict(key=k, name=n) for k, n in TARGET_BOOKS]
    meta["untrackedBooks"] = [dict(key="fanduel", name="FanDuel", why="not tracked (free plan)")]
    with open(meta_path, "w") as fh: json.dump(meta, fh, indent=1)
    log("done ->", OUT)

if __name__ == "__main__":
    main()
