#!/usr/bin/env python3
"""
LineSmart data builder.

Fetches REAL data from ESPN's free public JSON endpoints (no API key) and writes
static JSON files to site/data/ that the static front-end reads.

Optional: if the env var ODDS_API_KEY is set (paid 100K plan), also pulls Hard Rock Bet + FanDuel game lines from
The Odds API (v4) - bookmakers=hardrockbet,fanduel,draftkings is ONE region (up to 10 books = 1 region), so 3 credits per league
request (h2h,spreads,totals), 0 when no events - every ~30 min, and Hard Rock + FanDuel + DraftKings NFL/NBA player props every ~2 h
(scripts/odds_props.py). A budget guard (scripts/odds_budget.py) paces spending against an 80K/month budget.
Every pull is persisted in --odds-cache-dir and merged into every build, so keyless runs keep showing it ("as of" the
pull time). See docs/odds_api_budget.md for the cadence and credit math.

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
import slate as SL
import ufc as UF
import search_index as SI
import matchups as MU
import weather as WX
import props as PR
import odds_budget as OB
import odds_props as OP
import adv as ADV
import linevalue as LV
import lastgood as LG
import final_label as FL

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
    # UFC: built by scripts/ufc.py from ESPN's MMA endpoints (cards, bouts, DraftKings fighter moneylines). The Odds API pull is
    # OFF unless ODDS_MMA=1: h2h only = 1 credit per pull (0 when no MMA events are listed).
    dict(key="ufc",   name="UFC",   full="UFC (Mixed Martial Arts)", path="mma/ufc", params="", kind="mma", odds_key="mma_mixed_martial_arts",
         odds_markets="h2h", odds_cost=1, odds_books="hardrockbet"),
]
ODDS_MMA = os.environ.get("ODDS_MMA", "").strip() == "1"   # off by default: never spend Odds API credits on UFC unless asked
# DraftKings comes from ESPN (free); Hard Rock Bet + FanDuel from The Odds API (paid plan, one request per league)
TARGET_BOOKS = [("draftkings", "DraftKings"), ("hardrockbet", "Hard Rock Bet"), ("fanduel", "FanDuel")]
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

def fetch_scoreboard(lg, ymd, fetch=None):
    """One date's public ESPN scoreboard.

    A bare ``?dates=YYYYMMDD`` has come back as HTTP 200 with a 0-byte body (NBA
    2026-10-26 and 2026-10-27, checked 2026-10-29). The same date with ``&limit=100``
    returns the games. That is not a timezone shift: those events are on that ET
    date once a body is returned. Retry once with ``limit=100`` when the bare URL
    is not JSON. A real off day is JSON with no events and is not retried.
    ``fetch`` is ``getj`` or a test double ``(url) -> dict``.
    """
    fetch = fetch or getj
    url = f"{SITE}{lg['path']}/scoreboard?dates={ymd}{lg.get('params') or ''}"
    try:
        sb = fetch(url)
    except Exception as ex:
        if "limit=" in url:
            raise
        alt = url + "&limit=100"
        try:
            sb = fetch(alt)
        except Exception:
            raise ex
        log(f"{lg.get('key')} {ymd}: bare scoreboard was empty; used limit=100")
        return sb
    if not isinstance(sb, dict):
        raise ValueError(f"{lg.get('key')} scoreboard {ymd} was not a JSON object")
    return sb

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
        try:
            sb = fetch_scoreboard(lg, d); ok_days += 1
            for e in sb.get("events", []) or []: events[e["id"]] = e
        except Exception as ex:
            err.append(f"{d}: {ex}")
    return list(events.values()), ok_days, err

def game_from_event(e, lg=None):
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
        finalLabel=FL.label((lg or {}).get("kind"), stype, st.get("period"), (lg or {}).get("key")),   # "Final/OT", "Final/12"... (None until final)
        venue=(c.get("venue") or {}).get("fullName"), city=((c.get("venue") or {}).get("address") or {}).get("city"),
        venueId=(c.get("venue") or {}).get("id"), venueState=((c.get("venue") or {}).get("address") or {}).get("state"),
        venueCountry=((c.get("venue") or {}).get("address") or {}).get("country"), indoor=(c.get("venue") or {}).get("indoor"),
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
        cst = c.get("status") or {}
        if not (cst.get("type") or {}).get("completed"): continue
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
        games.append(dict(id=str(e["id"]) if e.get("id") else None, date=e.get("date"), home=me.get("homeAway") == "home", pf=pf, pa=pa, res=res,
                          opp=(op.get("team") or {}).get("abbreviation"), fin=FL.label(lg["kind"], cst.get("type"), cst.get("period"), lg.get("key"))))
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
                last10=agg(games[-10:]), streak=streak, recent=[dict(id=x["id"], date=x["date"], res=x["res"], pf=x["pf"], pa=x["pa"], home=x["home"], opp=x["opp"], fin=x["fin"]) for x in games[-5:]][::-1])

# ---------------------------------------------------------------- The Odds API (optional)
def norm_name(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower().replace("&", "and").replace("saint", "st").replace("state", "st"))

ODDS_API = "https://api.the-odds-api.com"
ODDS_BOOK = "hardrockbet"            # primary pulled book (cache file name kept for the data-history branch)
ODDS_BOOKS = ("hardrockbet", "fanduel", "draftkings")  # pulled together: bookmakers= with <=10 books counts as ONE region (v4 docs)
ODDS_REGION = "us2"                  # ignored when bookmakers= is given (bookmakers takes priority); kept as a fallback
ODDS_MARKETS = "h2h,spreads,totals"  # 3 markets x 1 region = 3 credits per league request (0 if no events)
ODDS_COST = 3
ODDS_MIN_CREDITS = int(os.environ.get("ODDS_MIN_CREDITS") or 300)  # reserve floor: never spend below this
ODDS_BUDGET = int(os.environ.get("ODDS_BUDGET") or 80000)          # credits we plan to use per billing month (plan: 100K)
ODDS_PLAN_CREDITS = int(os.environ.get("ODDS_PLAN_CREDITS") or 100000)
ODDS_BILLING_DAY = int(os.environ.get("ODDS_BILLING_DAY") or 26)   # credits reset on the subscription day (2026-10-26)
ODDS_RUN_MAX = int(os.environ.get("ODDS_RUN_MAX_CREDITS") or 250)  # hard cap per build run (games + props)
ODDS_GAME_WINDOW_DAYS = 7            # only leagues with events in the next 7 days are pulled (free /events check)
ODDS_FORCE = os.environ.get("ODDS_FORCE", "").strip() == "1"       # manual run: ignore the interval gate (budget still applies)
ODDS_CACHE_FILE = f"{ODDS_BOOK}.json"   # holds Hard Rock AND FanDuel lines (games[id].lines[book]) + quota/usage

def _hdr(hdr, name):
    for k, v in (hdr or {}).items():
        if k.lower() == name:
            try: return int(float(v))
            except (TypeError, ValueError): return None
    return None

def scrub(s, key):
    """Never let the API key reach a log, an error message or a file."""
    s = str(s)
    if key: s = s.replace(key, "***").replace(urllib.parse.quote(key), "***")
    return re.sub(r"apiKey=[^&\s'\"]+", "apiKey=***", s)

def odds_credits(key):
    """Remaining credits via GET /v4/sports, which costs 0 credits but still returns the x-requests-* headers."""
    _, hdr = get(f"{ODDS_API}/v4/sports/?apiKey={urllib.parse.quote(key)}")
    return _hdr(hdr, "x-requests-remaining"), _hdr(hdr, "x-requests-used")

def _iso_z(t): return t.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def odds_events(lg, key, now, hours):
    """Free call (GET /v4/sports/{sport}/events costs 0 credits): events starting before now+hours. Returns (events, headers)."""
    url = (f"{ODDS_API}/v4/sports/{lg['odds_key']}/events?apiKey={urllib.parse.quote(key)}&dateFormat=iso"
           f"&commenceTimeTo={_iso_z(now + dt.timedelta(hours=hours))}")
    return get(url)

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

def odds_note_headers(pull, hdr, kind):
    """Track x-requests-remaining / -used / -last from every paid call; returns the credits this call cost."""
    r2, used, last = _hdr(hdr, "x-requests-remaining"), _hdr(hdr, "x-requests-used"), _hdr(hdr, "x-requests-last")
    if r2 is not None: pull["remaining"] = r2
    if used is not None: pull["used"] = used
    pull["spent"] += last or 0
    pull.setdefault("spentBy", {}).setdefault(kind, 0); pull["spentBy"][kind] += last or 0
    return last

def odds_pull_league(lg, games, pull, t):
    """One game-line pull for a league: Hard Rock Bet + FanDuel + DraftKings in ONE request (3 credits, 0 if no events).
    Returns (cache entry, message); entry None if skipped/failed. pull["due"] (if set) limits which leagues pull."""
    rem, cost, markets = pull.get("remaining"), lg.get("odds_cost", ODDS_COST), lg.get("odds_markets", ODDS_MARKETS)
    books = lg.get("odds_books", ",".join(ODDS_BOOKS))
    if "due" in pull and lg["key"] not in pull["due"]:
        return None, pull.get("why", {}).get(lg["key"]) or "not due (interval gate)"
    if rem is None or rem - cost < pull.get("floor", 0):
        pull["skipped"].append(lg["key"]); return None, f"skipped (credits remaining {rem})"
    if pull["spent"] + cost > pull.get("cap", 10 ** 9):
        pull["skipped"].append(lg["key"]); return None, f"skipped (per-run cap {pull.get('cap')} reached)"
    now = dt.datetime.now(dt.timezone.utc)
    url = (f"{ODDS_API}/v4/sports/{lg['odds_key']}/odds/?apiKey={urllib.parse.quote(pull['key'])}"
           f"&regions={ODDS_REGION}&bookmakers={books}&markets={markets}&oddsFormat=american&dateFormat=iso"
           f"&commenceTimeTo={_iso_z(now + dt.timedelta(days=ODDS_GAME_WINDOW_DAYS))}")
    try:
        data, hdr = get(url)
    except Exception as ex:
        pull["errors"].append(lg["key"]); return None, f"error: {scrub(ex, pull['key'])}"
    last = odds_note_headers(pull, hdr, "games")
    out, unmatched = {}, 0
    for ev in data or []:
        bks = {b.get("key"): b for b in ev.get("bookmakers", []) if b.get("key") in books.split(",")}
        if not bks: continue
        g, sw = match_event(ev, games)
        if not g: unmatched += 1; log(f"[{lg['key']}] odds: no ESPN match for {ev.get('away_team')} @ {ev.get('home_team')} {ev.get('commence_time')}"); continue
        lines = {k: odds_book_record(ev, b, sw) for k, b in bks.items()}
        rec = dict(date=g["date"], home=g["home"]["abbr"], away=g["away"]["abbr"], lines=lines)
        if ODDS_BOOK in lines: rec["line"] = lines[ODDS_BOOK]      # v1 field, read by older builds
        out[g["id"]] = rec
    pull["pulled"].append(lg["key"])
    entry = dict(pulledAt=t, events=len(data or []), matched=len(out), unmatched=unmatched, cost=last, remainingAfter=pull["remaining"],
                 books=books.split(","), games=out)
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
    c["checks"] = (c.get("checks") or [])[-200:]

def odds_cache_save(d, c):
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, ODDS_CACHE_FILE); tmp = p + ".tmp"
    with open(tmp, "w") as fh: json.dump(c, fh, indent=1, sort_keys=True)
    os.replace(tmp, p)

def odds_cache_put(lg, cache, entry, msg):
    """Store a fresh pull in the cache, except a pull that matched nothing while the previous pull matched games (ESPN
    games missing this run): the previous lines stay, so a feed hiccup can't wipe them. A failed pull (entry None) never
    touches the cache either; the last persisted pull keeps being used."""
    if cache is None: return msg
    prev = cache["leagues"].get(lg["key"]) or {}
    if entry is None:
        if msg and msg.startswith("error") and prev.get("pulledAt"):
            log(f"[{lg['key']}] FALLBACK odds: The Odds API pull failed -> using the last persisted pull from {prev['pulledAt']}")
            msg += f" (using the last persisted pull from {prev['pulledAt']})"
        return msg
    if entry.get("events") and not entry.get("matched") and prev.get("matched"):
        log(f"[{lg['key']}] FALLBACK odds: pull matched 0 of {entry['events']} events to ESPN games -> kept the previous pull from {prev.get('pulledAt')}")
        prev.update(checkedAt=entry.get("pulledAt"), remainingAfter=entry.get("remainingAfter"))
        return msg + f" (0 matched: kept the previous pull from {prev.get('pulledAt')})"
    cache["leagues"][lg["key"]] = entry
    return msg

ESPN_OPEN_BOOKS = ("draftkings",)   # books ESPN also reports (with the opening line): paid entry is a price overlay

def apply_cached_odds(lg, games, cache, now):
    """Put the last Hard Rock / FanDuel / DraftKings pull into each game's books (overrides ESPN's copy of the same book);
    started games get a stale marker without numbers. Counts are per game (Hard Rock or FanDuel present)."""
    e = (cache or {}).get("leagues", {}).get(lg["key"])
    if not e: return 0, 0
    fresh = stale = 0
    for g in games:
        c = (e.get("games") or {}).get(g["id"])
        if not c: continue
        lines = c.get("lines") or ({ODDS_BOOK: c["line"]} if c.get("line") else {})
        if not lines: continue
        started = g.get("state") != "pre" or dt.datetime.fromisoformat(g["date"].replace("Z", "+00:00")) <= now
        for bk, line in lines.items():
            if started and bk in ESPN_OPEN_BOOKS:
                continue                      # DraftKings: leave ESPN's entry as it was before the paid feed
            if started:
                g.setdefault("books", {})[bk] = dict(stale=True, asOf=e["pulledAt"], source="The Odds API", reason="game started")
            elif bk in ESPN_OPEN_BOOKS:
                # DraftKings: paid prices replace ESPN's copy, but ESPN's opening line (line movement) is kept
                esp = (g.get("books") or {}).get(bk) or {}
                opn = {k: v for k, v in esp.items() if k.endswith("Open") and v is not None}
                g.setdefault("books", {})[bk] = dict(line, **opn, asOf=e["pulledAt"], source="The Odds API",
                                                     **({"openSource": esp.get("source")} if opn else {}))
            else:
                g.setdefault("books", {})[bk] = dict(line, asOf=e["pulledAt"], source="The Odds API")
        if started: stale += 1
        else: fresh += 1
    return fresh, stale

# ---------------------------------------------------------------- paid-plan run planning (budget guard)
def odds_plan_run(key, want, cache, pcache, run_t):
    """Free calls only: quota (/sports) + upcoming events per league (/events). Decide the budget level, which leagues'
    game lines are due (interval gate) and which NFL/NBA events are props candidates. Returns (pull, check, budget, prop_events)."""
    now = dt.datetime.now(dt.timezone.utc)
    if os.environ.get("ODDS_PAUSE", "").strip() == "1":
        log("[odds] ODDS_PAUSE=1: no Odds API calls this run (kill switch)")
        return None, dict(t=run_t, action="paused (ODDS_PAUSE)"), None, {}
    if cache is None:   # without the persisted cache there is no interval gate or quota history -> never spend blind
        log("[odds] no --odds-cache-dir: paid pulls disabled (the interval gate and budget guard need the persisted cache)")
        return None, None, None, {}
    try:
        rem, used = odds_credits(key)
    except Exception as ex:
        rem, used = None, None; log(f"[odds] credit check failed: {scrub(ex, key)}")
    q = (cache or {}).get("quota") or {}
    if OB.detect_reset(q.get("used"), used): log(f"[odds] credits reset detected (used {q.get('used')} -> {used})")
    pl = [l for l in LEAGUES if l["key"] in want and (l["kind"] != "mma" or ODDS_MMA)]
    active, prop_events, ev_err = {}, {}, []
    if rem is not None:
        for lg in pl:
            try:
                evs, _ = odds_events(lg, key, now, ODDS_GAME_WINDOW_DAYS * 24)
                active[lg["key"]] = len(evs or [])
                if lg["key"] in OP.SUPPORTED:
                    soon = now + dt.timedelta(hours=OP.WINDOW_H)
                    prop_events[lg["key"]] = [e for e in evs or [] if now < dt.datetime.fromisoformat(str(e.get("commence_time")).replace("Z", "+00:00")) <= soon]
            except Exception as ex:
                active[lg["key"]] = None; ev_err.append(f"{lg['key']}: {scrub(ex, key)[:120]}")   # unknown: assume active
    live = [l for l in pl if active.get(l["key"]) != 0]
    games_per_run = sum(l.get("odds_cost", ODDS_COST) for l in live)
    props_per_run = sum(len(v) * OP.n_markets(k) for k, v in prop_events.items())
    budget = OB.plan(rem, used, now, billing_day=ODDS_BILLING_DAY, budget=ODDS_BUDGET, plan_credits=ODDS_PLAN_CREDITS,
                     floor=ODDS_MIN_CREDITS, games_per_run=games_per_run, props_per_run=props_per_run)
    log(f"[odds] credits remaining {rem} (used {used}); budget level {budget['level']}: {budget.get('reason')}; "
        f"allowance {budget.get('allowancePerDay')}/day for {budget['daysLeft']} days; game lines every {budget['gameInterval']} min; "
        f"props {'on' if budget['props'] else 'off'}; events in 7d {active}" + (f"; events errors {ev_err}" if ev_err else ""))
    if cache is not None:
        cache["quota"] = dict(t=run_t, remaining=rem, used=used, level=budget["level"], gameInterval=budget["gameInterval"], props=budget["props"],
                              reason=budget.get("reason"), allowancePerDay=budget.get("allowancePerDay"), cycleEnd=budget.get("cycleEnd"))
    check = dict(t=run_t, remainingBefore=rem, used=used, level=budget["level"], gameInterval=budget["gameInterval"], props=budget["props"])
    if budget["level"] == "stop":
        log(f"[odds] budget guard: no paid calls this run ({budget.get('reason')})")
        check["action"] = "skipped (budget guard)"
        return None, check, budget, {}
    due, why = [], {}
    for l in live:
        last = ((cache or {}).get("leagues", {}).get(l["key"]) or {}).get("pulledAt")
        if ODDS_FORCE or OB.due(last, budget["gameInterval"], now): due.append(l["key"])
        else: why[l["key"]] = f"not due (last pull {last}, every {budget['gameInterval']} min)"
    for l in pl:
        if active.get(l["key"]) == 0: why[l["key"]] = f"no events in the next {ODDS_GAME_WINDOW_DAYS} days (free /events check; 0 credits)"
    pull = dict(key=key, remaining=rem, used=used, spent=0, pulled=[], skipped=[], errors=[], due=set(due), why=why,
                floor=ODDS_MIN_CREDITS, cap=ODDS_RUN_MAX)
    log(f"[odds] game lines due: {due or 'none'} (~{sum(l.get('odds_cost', ODDS_COST) for l in pl if l['key'] in due)} credits); per-run cap {ODDS_RUN_MAX}")
    check.update(action="pull", due=due)
    return pull, check, budget, prop_events

def odds_usage_update(cache, check):
    """Per-billing-cycle spend tally (games vs props) next to the authoritative quota headers."""
    now = dt.datetime.now(dt.timezone.utc)
    start, end = OB.cycle_bounds(now, ODDS_BILLING_DAY)
    u = cache.get("usage") or {}
    if u.get("cycleStart") != start.isoformat() or OB.detect_reset(u.get("usedAtLastRun"), check.get("used")):
        u = dict(cycleStart=start.isoformat(), cycleEnd=end.isoformat(), games=0, props=0, runs=0, paidRuns=0, days={})
    sb = check.get("spentBy") or {}
    u["games"] = u.get("games", 0) + sb.get("games", 0); u["props"] = u.get("props", 0) + sb.get("props", 0)
    u["runs"] = u.get("runs", 0) + 1; u["paidRuns"] = u.get("paidRuns", 0) + (1 if check.get("spent") else 0)
    day = now.astimezone(ZoneInfo("America/New_York")).date().isoformat()
    d = u.setdefault("days", {}).setdefault(day, [0, 0]); d[0] += sb.get("games", 0); d[1] += sb.get("props", 0)
    u["days"] = dict(sorted(u["days"].items())[-40:])
    u["usedAtLastRun"] = check.get("usedAfter", check.get("used")); u["t"] = check.get("t")
    cache["usage"] = u

# ---------------------------------------------------------------- main
def _err_tail(errs):
    """'20261027: HTTP Error 403: Forbidden' -> 'HTTP Error 403: Forbidden' (first error only)."""
    return (errs[0].split(": ", 1)[-1] if errs else "")[:80]

def lastgood_games(lg, games, ok_days, errs, days, lgsrc, now):
    """Decide whether this league's scoreboard fetch failed and, if so, which last good games to carry over.
    Returns (restored games marked stale, fallback info or None, last good index or None)."""
    if not lgsrc: return [], None, None
    fresh_ids = {str(g["id"]) for g in games}
    reason, only_days = None, None
    if errs and ok_days == 0:
        reason = f"ESPN scoreboard failed ({_err_tail(errs)})"
    elif errs:
        reason = f"ESPN scoreboard failed for {len(errs)} of {days} days ({_err_tail(errs)})"
        only_days = {e.split(":", 1)[0] for e in errs}
    elif not games:
        n = LG.suspicious_empty(lgsrc.index(lg["key"]), now, days)
        if n: reason = f"ESPN returned an empty schedule, but the last good data had {n} upcoming games"
    if not reason: return [], None, None
    idx0 = lgsrc.index(lg["key"])
    kept, asof, why = LG.pick(idx0, now, days=only_days, tz=ET, exclude=fresh_ids)
    if not kept:
        log(f"[{lg['key']}] {reason}; no fallback: {why}")
        return [], dict(used=False, reason=reason, why=why), idx0
    LG.note(log, lg["key"], reason, len(kept), asof)
    return [LG.mark(g, asof, reason) for g in kept], dict(used=True, reason=reason, asOf=asof, games=len(kept), partial=only_days is not None), idx0

def build_league(lg, days, pull=None, odds_cache=None, hist_dir=None, snap_dir=None, run_t=None, weather_dir=None, weather=True, lgsrc=None):
    t0 = time.time()
    report = dict(league=lg["key"], endpoints={})
    events, ok_days, errs = fetch_scoreboards(lg, days)
    report["endpoints"]["scoreboard"] = f"ok {ok_days}/{days} days" + (f"; errors: {errs[:2]}" if errs else "")
    games = sorted((game_from_event(e, lg) for e in events), key=lambda g: g["date"])
    # ESPN failed (or came back suspiciously empty): carry over the last good games (marked stale) instead of showing none
    restored, fb, idx0 = lastgood_games(lg, games, ok_days, errs, days, lgsrc, dt.datetime.now(dt.timezone.utc))
    if fb: report["fallback"] = fb
    lg_docs = LG.game_docs(lgsrc, lg["key"], restored) if restored else {}
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
    if sum_err and lgsrc:   # summaries failed: reuse the last good detail (injuries, leaders, last five) for those games
        if idx0 is None: idx0 = lgsrc.index(lg["key"])
        lgids = {str(x.get("id")) for x in (idx0 or {}).get("games") or []}
        miss = [g for g in targets if g["id"] not in details and str(g["id"]) in lgids]
        reused = 0
        for gid, doc in (LG.game_docs(lgsrc, lg["key"], miss) if miss else {}).items():
            if doc.get("hasSummary") and isinstance(doc.get("detail"), dict):
                details[gid] = dict(doc["detail"], stale=dict(asOf=LG.as_of(idx0)), allEspnOdds=[]); reused += 1
        if reused:
            report["endpoints"]["summary"] += f"; reused last good detail for {reused}"
            log(f"[{lg['key']}] FALLBACK: {sum_err} game summaries failed -> reused the last good detail for {reused}")
    # team splits
    tids = sorted({g[s]["id"] for g in games for s in ("home", "away") if g[s]["id"]})
    teams, t_ok, t_err = {}, 0, 0
    with cf.ThreadPoolExecutor(12) as ex:
        futs = {ex.submit(team_splits, lg, t): t for t in tids}
        for f in cf.as_completed(futs):
            try: teams[futs[f]] = f.result(); t_ok += 1
            except Exception: t_err += 1
    report["endpoints"]["teamSchedule"] = f"ok {t_ok}, failed {t_err}"
    if (t_err or restored) and lgsrc:   # team splits that failed (and the teams of carried-over games): last good copy
        if idx0 is None: idx0 = lgsrc.index(lg["key"])
        lgt = (idx0 or {}).get("teams") or {}
        need = {g[s]["id"] for g in games + restored for s in ("home", "away") if g[s].get("id")} - set(teams)
        got = {t: lgt[t] for t in need if lgt.get(t)}
        if got:
            teams.update(got)
            if t_err: report["endpoints"]["teamSchedule"] += f"; reused last good splits for {len(got)}"
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
    fresh_games = games
    if restored:   # carried-over games join before the odds step, so a paid pull still matches them (and the cache keeps their lines)
        games = sorted(games + restored, key=lambda g: g["date"])
    # Hard Rock Bet + FanDuel + DraftKings: pull from The Odds API when this league is due (interval gate + budget); every run merges the last persisted pull
    run_t = run_t or LH.now_iso()
    if pull:
        entry, msg = odds_pull_league(lg, games, pull, run_t)
        msg = odds_cache_put(lg, odds_cache, entry, msg)
        report["oddsApi"] = msg
    else:
        report["oddsApi"] = "no paid pull this run (using last persisted Hard Rock/FanDuel/DraftKings pull)"
    fresh, stale = apply_cached_odds(lg, games, odds_cache, dt.datetime.now(dt.timezone.utc))
    le = (odds_cache or {}).get("leagues", {}).get(lg["key"]) or {}
    report["hardrock"] = dict(asOf=le.get("pulledAt"), shown=fresh, stale=stale)
    # line movement: snapshot this run's pre-game lines, merge into persistent history (if any), summarize
    snap = LH.snapshot_from_games([g for g in games if not g.get("stale")])   # stale copies add no line-history points
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
        if gh: g["move"] = LH.summarize(gh, lg["kind"], lg["key"])
        elif not g.get("stale"): g["move"] = None        # a stale copy keeps the movement it was saved with
    # game-day weather (Open-Meteo); fail soft: WX.attach never raises. Stale copies keep their saved forecast.
    if weather:
        try:
            wx = WX.attach(lg, fresh_games, weather_dir, snap_dir, log)
        except Exception as ex:
            wx = dict(errors=[f"weather failed: {str(ex)[:120]}"])
        report["weather"] = wx
    # write
    ldir = os.path.join(OUT, lg["key"]); os.makedirs(os.path.join(ldir, "games"), exist_ok=True)
    for fn in os.listdir(os.path.join(ldir, "games")): os.remove(os.path.join(ldir, "games", fn))
    for g in games:
        gt = {g["home"]["id"]: teams.get(g["home"]["id"]), g["away"]["id"]: teams.get(g["away"]["id"])}
        if g.get("stale") and str(g["id"]) in lg_docs:   # carried over: the last good file, with this run's game record
            doc = lg_docs[str(g["id"])]
            out = dict(doc, game=g, teams=doc.get("teams") or gt, history=hist["games"].get(g["id"]) or doc.get("history"))
        else:
            d = details.get(g["id"], {})
            d = {k: v for k, v in d.items() if k != "allEspnOdds"} | {"espnOddsProviders": d.get("espnOddsProviders") or [o.get("provider") for o in d.get("allEspnOdds", [])]}
            out = dict(league=lg["key"], game=g, detail=d, teams=gt, hasSummary=g["id"] in details, history=hist["games"].get(g["id"]))
        with open(os.path.join(ldir, "games", f"{g['id']}.json"), "w") as fh:
            json.dump(out, fh, separators=(",", ":"))
    with_odds = sum(1 for g in games if g.get("odds"))
    upcoming = sum(1 for g in games if g["state"] == "pre")
    providers = sorted({g["odds"]["provider"] for g in games if g.get("odds") and g["odds"].get("provider")})
    report.update(games=len(games), upcoming=upcoming, withOdds=with_odds, providers=providers, seconds=round(time.time() - t0, 1))
    idx = dict(league={k: lg[k] for k in ("key", "name", "full", "kind")}, generated=dt.datetime.now(dt.timezone.utc).isoformat(),
               windowDays=days, games=games, teams=teams, report=report)
    if restored:
        prev = (idx0 or {}).get("stale") or {}
        idx["stale"] = dict(asOf=fb["asOf"], reason=fb["reason"], since=prev.get("since") or idx["generated"], games=len(restored),
                            partial=fb["partial"])
    with open(os.path.join(ldir, "index.json"), "w") as fh: json.dump(idx, fh, separators=(",", ":"))
    wxr = report.get("weather") or {}
    wxs = f" weather=forecast {wxr.get('forecast', 0)}, indoor {wxr.get('indoor', 0)}, pending {wxr.get('pending', 0)}, n/a {wxr.get('unavailable', 0)}, calls {wxr.get('calls', 0)}{(' errors ' + str(wxr['errors'])) if wxr.get('errors') else ''}" if wxr else ""
    fbs = f" FALLBACK(stale {len(restored)} as of {fb['asOf']})" if restored else ""
    log(f"[{lg['key']}] games={len(games)}{fbs} upcoming={upcoming} withOdds={with_odds} providers={providers} {report['endpoints']} oddsApi={report['oddsApi']} history={report['history']}{wxs} ({report['seconds']}s)")
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
    ap.add_argument("--weather-cache-dir", default=os.environ.get("WEATHER_CACHE_DIR") or None,
                    help="dir caching venue coordinates and recent forecasts (data-history branch); omit to fetch every forecast each run")
    ap.add_argument("--adv-cache-dir", default=os.environ.get("ADV_CACHE_DIR") or None,
                    help="persistent dir for advanced stats (nflverse aggregate, ATS/O-U closing-line store)")
    ap.add_argument("--no-adv", action="store_true", help="skip advanced stats (data/adv: NFL EPA, NBA ratings, ATS/O-U, usage)")
    ap.add_argument("--no-weather", action="store_true", help="skip game-day weather (Open-Meteo)")
    ap.add_argument("--no-matchups", action="store_true", help="skip the opponent defense-vs-position data (data/matchups)")
    ap.add_argument("--no-props", action="store_true", help="skip player prop lines + hit history (data/props)")
    ap.add_argument("--no-search", action="store_true", help="skip the team/player search index")
    ap.add_argument("--search-only", action="store_true", help="only (re)build the search index and matchups (opponent defense); leave game data and odds untouched")
    a = ap.parse_args()
    run_t = LH.now_iso()
    want = a.leagues.split(",")
    key = None if a.search_only else (os.environ.get("ODDS_API_KEY", "").strip() or None)
    cache = odds_cache_load(a.odds_cache_dir) if a.odds_cache_dir else None
    pcache = OP.cache_load(a.odds_cache_dir) if a.odds_cache_dir else None
    pull, check, budget, prop_events = None, None, None, {}
    if key:
        pull, check, budget, prop_events = odds_plan_run(key, want, cache, pcache, run_t)
    else:
        log("[odds] no ODDS_API_KEY for this run; using the last persisted Hard Rock/FanDuel/DraftKings pull" + ("" if cache is not None else " - none available"))
    os.makedirs(OUT, exist_ok=True)
    meta_path = os.path.join(OUT, "meta.json")
    meta = json.load(open(meta_path)) if os.path.exists(meta_path) else {"leagues": {}}
    src = LG.default_src(ROOT)
    lgsrc = LG.Source(src, getj, log, bust=run_t) if src else None
    log(f"[lastgood] fallback source: {src or 'off'} (max age {LG.MAX_H:g}h)")
    fallbacks = {}
    def fallback_meta(lg, rep):
        fb = rep.get("fallback") or {}
        if fb.get("used", True) and fb.get("asOf"):
            fallbacks[lg["key"]] = fb
            return dict(asOf=fb["asOf"], reason=fb.get("reason"), games=fb.get("games"))
        return None
    def restore_whole(lg, reason):
        if not lgsrc: return None
        apply = (lambda gs: apply_cached_odds(lg, gs, cache, dt.datetime.now(dt.timezone.utc))) if cache else None
        return LG.restore_league(lgsrc, lg["key"], OUT, dt.datetime.now(dt.timezone.utc), reason, log=log, apply_odds=apply)
    for lg in LEAGUES:
        if lg["key"] not in want or a.search_only: continue
        try:
            if lg["kind"] == "mma":   # UFC cards (scripts/ufc.py): no weather, team splits, matchups or props
                rep = UF.build_ufc(lg, getj, OUT, os.path.join(OUT, "search"), LH, pull=pull if ODDS_MMA else None, odds_pull=odds_pull_league,
                                   odds_cache=cache, apply_cached=apply_cached_odds, hist_dir=a.history_dir, snap_dir=a.snap_dir, run_t=run_t,
                                   cache_dir=a.matchup_cache_dir, log=log,
                                   odds_off_reason=None if ODDS_MMA else "off (set ODDS_MMA=1 to pull Hard Rock MMA moneylines, 1 credit per pull)")
                if rep.get("search"): meta.setdefault("search", {})[lg["key"]] = rep["search"]
                if not rep.get("games") and lgsrc:   # every card failed, or a suspiciously empty calendar
                    ee = (rep.get("endpoints") or {}).get("eventErrors")
                    n = LG.suspicious_empty(lgsrc.index(lg["key"]), dt.datetime.now(dt.timezone.utc), UF.UPCOMING_DAYS)
                    why = (f"ESPN fight cards failed ({str(ee[0])[:80]})" if ee else
                           f"ESPN returned no fight cards, but the last good data had {n} upcoming bouts" if n else None)
                    r2 = restore_whole(lg, why) if why else None
                    if r2: rep = dict(r2, endpoints=rep.get("endpoints"))
            else:
                rep = build_league(lg, a.days, pull, cache, a.history_dir, a.snap_dir, run_t, a.weather_cache_dir, not a.no_weather, lgsrc)
            meta["leagues"][lg["key"]] = dict(name=lg["name"], full=lg["full"], games=rep["games"], upcoming=rep["upcoming"],
                                              withOdds=rep["withOdds"], providers=rep["providers"], updated=dt.datetime.now(dt.timezone.utc).isoformat(), report=rep)
            st = fallback_meta(lg, rep)
            if st: meta["leagues"][lg["key"]]["stale"] = st
        except Exception as ex:
            log(f"[{lg['key']}] FAILED: {ex}")
            m = meta["leagues"].setdefault(lg["key"], dict(name=lg["name"], full=lg["full"], games=0, upcoming=0, withOdds=0, providers=[]))
            m["error"] = str(ex)
            m.pop("stale", None)
            try:
                rep = restore_whole(lg, f"ESPN fetch failed ({str(ex)[:80]})")
            except Exception as ex2:
                rep = None; log(f"[{lg['key']}] fallback FAILED: {ex2}")
            if rep:
                m.update(games=rep["games"], upcoming=rep["upcoming"], withOdds=rep["withOdds"], providers=rep["providers"],
                         updated=dt.datetime.now(dt.timezone.utc).isoformat(), report=rep)
                m["stale"] = fallback_meta(lg, rep)
    # Hard Rock + FanDuel + DraftKings player props (NFL/NBA): after the league builds, so events match the fresh ESPN games
    props_pulled = []
    if pull and budget and budget.get("props") and not a.no_props and pcache is not None:
        for lg in LEAGUES:
            if lg["key"] not in want or lg["key"] not in OP.SUPPORTED: continue
            prev = (pcache or {}).get("leagues", {}).get(lg["key"])
            if not (ODDS_FORCE or OB.due((prev or {}).get("pulledAt"), OP.PROPS_INTERVAL, dt.datetime.now(dt.timezone.utc))):
                log(f"[{lg['key']}] odds props: not due (last {(prev or {}).get('pulledAt')})"); continue
            if not prop_events.get(lg["key"]):
                log(f"[{lg['key']}] odds props: no events in the next {OP.WINDOW_H}h"); continue
            try:
                idx = json.load(open(os.path.join(OUT, lg["key"], "index.json")))
                entry, msg = OP.pull_league(lg, prop_events[lg["key"]], idx.get("games") or [], pull, run_t, get, match_event,
                                            odds_note_headers, scrub, dt.datetime.now(dt.timezone.utc), ODDS_API, prev=prev, log=log)
            except Exception as ex:
                entry, msg = None, f"props pull failed: {scrub(ex, key)[:200]}"
            log(f"[{lg['key']}] odds {msg}")
            if entry is not None and pcache is not None: pcache["leagues"][lg["key"]] = entry; props_pulled.append(lg["key"])
    elif pull and budget:
        log(f"[odds] props paused this run: budget level {budget['level']} ({budget.get('reason')})")
    if check is not None and pull:
        check.update(remainingAfter=pull["remaining"], usedAfter=pull.get("used"), spent=pull["spent"], spentBy=pull.get("spentBy") or {},
                     pulled=pull["pulled"], props=props_pulled, skipped=pull["skipped"], errors=pull["errors"])
        log(f"[odds] run done: spent {pull['spent']} credits {pull.get('spentBy') or {}}, remaining {pull['remaining']}; "
            f"game lines={pull['pulled']} props={props_pulled} skipped={pull['skipped']} errors={pull['errors']}")
    if cache is not None and not a.search_only:
        if check is not None:
            cache.setdefault("checks", []).append(check)
            odds_usage_update(cache, check)
        odds_cache_prune(cache, dt.datetime.now(dt.timezone.utc))
        pulls = [e.get("pulledAt") for e in cache["leagues"].values() if e.get("pulledAt")]
        cache["updated"] = max(pulls) if pulls else None
        odds_cache_save(a.odds_cache_dir, cache)
        if pull and a.snap_dir:     # this run's fresh leagues + quota, for re-applying after a push race
            odds_cache_save(os.path.join(a.snap_dir, "_odds"), dict(cache, leagues={k: cache["leagues"][k] for k in pull["pulled"]}))
    if pcache is not None and not a.search_only:
        OP.cache_prune(pcache, dt.datetime.now(dt.timezone.utc))
        if props_pulled: OP.cache_save(a.odds_cache_dir, pcache)
        if props_pulled and a.snap_dir:
            OP.cache_save(os.path.join(a.snap_dir, "_odds"), dict(pcache, leagues={k: pcache["leagues"][k] for k in props_pulled}))
    if not a.no_search:
        meta.setdefault("search", {})
        for lg in LEAGUES:
            if lg["key"] not in want or lg["kind"] == "mma": continue   # UFC's fighter index is written by build_ufc
            try:
                meta["search"][lg["key"]] = SI.build_search(lg, getj, SITE, STANDINGS, os.path.join(OUT, "search"),
                                                            a.roster_cache_dir, a.roster_max_age_hours, a.snap_dir, log)
            except Exception as ex:
                log(f"[{lg['key']}] search index FAILED: {ex}")   # the previous file (if any) stays in place
                meta["search"].setdefault(lg["key"], {})["error"] = str(ex)[:200]
                if lgsrc and LG.restore_file(lgsrc, OUT, f"search/{lg['key']}.json", log):
                    meta["search"][lg["key"]]["stale"] = True; fallbacks.setdefault(f"{lg['key']} search", {"reason": "search index fetch failed"})
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
                if lgsrc and LG.restore_file(lgsrc, OUT, f"matchups/{lg['key']}.json", log): meta["matchups"][lg["key"]]["stale"] = True
    if not a.no_props and not a.search_only:
        meta.setdefault("props", {})
        for lg in LEAGUES:
            if lg["key"] not in want or lg["key"] not in PR.SUPPORTED: continue
            try:
                meta["props"][lg["key"]] = PR.build_props(lg, getj, os.path.join(OUT, "props"), os.path.join(OUT, "search"),
                                                          games=MU.LAST_GAMES.get(lg["key"]), matchup_cache_dir=a.matchup_cache_dir, log=log,
                                                          extra=(pcache or {}).get("leagues", {}).get(lg["key"]))
            except Exception as ex:
                log(f"[{lg['key']}] props FAILED: {ex}")   # the previous file (if any) stays in place
                meta["props"].setdefault(lg["key"], {})["error"] = str(ex)[:200]
                if lgsrc and LG.restore_file(lgsrc, OUT, f"props/{lg['key']}.json", log): meta["props"][lg["key"]]["stale"] = True
    if not a.no_adv and not a.search_only:
        meta.setdefault("adv", {})
        for lg in LEAGUES:
            k = lg["key"]
            if k not in want or k not in ADV.ATS_LEAGUES: continue
            t0 = time.time()
            try:
                meta["adv"][k] = ADV.build(lg, getj, SITE, OUT, a.adv_cache_dir, history_dir=a.history_dir, games=MU.LAST_GAMES.get(k),
                                           events=MU.LAST_EVENTS.get(k), log=log)
                meta["adv"][k]["seconds"] = round(time.time() - t0, 1)
            except Exception as ex:
                log(f"[{k}] advanced stats FAILED: {ex}")   # the previous file (if any) stays in place
                meta["adv"][k] = dict(error=str(ex)[:200])
            if a.snap_dir and a.adv_cache_dir:            # re-applied after a push race, like the other caches
                import shutil
                os.makedirs(os.path.join(a.snap_dir, "_adv"), exist_ok=True)
                for fn in (f"ats_{k}.json", "nfl_nflverse.json" if k == "nfl" else None):
                    if fn and os.path.exists(os.path.join(a.adv_cache_dir, fn)):
                        shutil.copy(os.path.join(a.adv_cache_dir, fn), os.path.join(a.snap_dir, "_adv", fn))
    if a.search_only:
        with open(meta_path, "w") as fh: json.dump(meta, fh, indent=1)
        return log("search index done ->", os.path.join(OUT, "search"))
    meta["fallback"] = dict(source=src, maxAgeHours=LG.MAX_H, leagues=fallbacks)
    if fallbacks:
        log(f"[lastgood] leagues on last good data this run: {', '.join(sorted(fallbacks))}")
    else:
        log("[lastgood] no league needed the fallback this run")
    meta["order"] = [l["key"] for l in LEAGUES]
    meta["generated"] = dt.datetime.now(dt.timezone.utc).isoformat()
    lgs = (cache or {}).get("leagues", {})
    q = (cache or {}).get("quota") or {}
    meta["hardrock"] = dict(book=ODDS_BOOK, books=list(ODDS_BOOKS), schedule="game lines about every 30 min; NFL/NBA props about every 2 h",
                            pulledThisRun=bool(pull and pull["pulled"]), asOf=(cache or {}).get("updated"),
                            leagues={k: v.get("pulledAt") for k, v in lgs.items()},
                            props={k: v.get("pulledAt") for k, v in ((pcache or {}).get("leagues") or {}).items()},
                            lastCheck=((cache or {}).get("checks") or [None])[-1])
    # budget state for the site footer note (never includes the key)
    meta["oddsApi"] = dict(books=list(ODDS_BOOKS), level=q.get("level"), gameInterval=q.get("gameInterval"), props=q.get("props"),
                           checkedAt=q.get("t"), cadence=dict(games=OB.GAME_STEPS[0], props=OP.PROPS_INTERVAL))
    meta["oddsApiEnabled"] = bool(lgs)
    meta["historyEnabled"] = bool(a.history_dir)
    meta["weather"] = dict(source="Open-Meteo.com", license="CC BY 4.0", enabled=not a.no_weather, cached=bool(a.weather_cache_dir))
    meta["targetBooks"] = [dict(key=k, name=n) for k, n in TARGET_BOOKS]
    meta["untrackedBooks"] = []
    try: meta["slate"] = SL.build(OUT, meta["order"])   # home-page "Today's slate" + scores ticker (reads the files just written)
    except Exception as ex: log(f"[slate] FAILED: {ex}")
    try:   # "Value spots": prices that beat the 3-book no-vig consensus (reuses this run's odds; no extra API calls)
        if isinstance(meta.get("slate"), dict): meta["slate"]["value"] = LV.value_spots(OUT, meta["order"])
    except Exception as ex: log(f"[value spots] FAILED: {ex}")
    with open(meta_path, "w") as fh: json.dump(meta, fh, indent=1)
    log("done ->", OUT)

if __name__ == "__main__":
    main()
