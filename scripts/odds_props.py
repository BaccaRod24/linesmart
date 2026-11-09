"""Hard Rock Bet + FanDuel + DraftKings player props from The Odds API (paid plan) - NFL and NBA only.

Per-event endpoint: GET /v4/sports/{sport}/events/{eventId}/odds?bookmakers=hardrockbet,fanduel,draftkings&markets=...
Cost (v4 docs): unique markets RETURNED x regions; bookmakers= with up to 10 books = 1 region, so FanDuel and DraftKings are free on
top of Hard Rock; an event with no props posted costs 0. Every market the site shows (scripts/props.py) is requested.
A market returned costs 1 credit per event no matter how many of the three books posted it.

Cadence (the budget guard in scripts/odds_budget.py still sees one number, the average credits per 2 h pass):
  core markets, events inside NEAR_H: every PROPS_INTERVAL (2 h) — the markets we already priced
  extra markets, events inside NEAR_H: every EXTRA_INTERVAL (6 h) — the markets that were ESPN line-only
  NFL events between NEAR_H and the ESPN window (WINDOW_H["nfl"], 8 days): every FAR_INTERVAL (18 h), all markets
NBA stays on the 36 h window (books post NBA props about a day out). Pulling the full list every 2 h out to 8 days
would be about 2,900 extra credits/day and the guard would pause props; see credit_model().

Lines are persisted by player NAME (props_oddsapi.json on the data-history branch); scripts/props.py maps names to
ESPN athlete ids at build time and merges them next to the DraftKings (ESPN) lines.

Cache entry per league (same shape as hardrockbet.json so line_history.py apply-odds merges it):
  {"pulledAt": iso, "events": n, "cost": credits, "games": {espnGameId: {"date": iso, "at": iso, "atBy": {group: iso},
   "books": {book: {ourMarket: {name: [line, over, under]}}}}}}
"""
import datetime as dt, json, os, re, unicodedata, urllib.parse
import odds_budget as OB

CACHE_FILE = "props_oddsapi.json"
BOOKS = ("hardrockbet", "fanduel", "draftkings")
# Per league, hours ahead we price. NFL matches scripts/props.py WINDOW_H (the ESPN prop window).
WINDOW_H = {"nfl": 8 * 24, "nba": 36}
NEAR_H = 36                 # inside this, core markets refresh every PROPS_INTERVAL
PROPS_INTERVAL = 120        # minutes
EXTRA_INTERVAL = 360        # minutes: markets that were missing a Hard Rock price
FAR_INTERVAL = 18 * 60      # minutes: NFL games further out than NEAR_H (early-week slate)
# Odds API market key -> props.py market key. Core keys are the original short list; the rest are "extra".
MARKETS = {
    "nfl": [("player_pass_yds", "pass_yds"), ("player_rush_yds", "rush_yds"), ("player_reception_yds", "rec_yds"),
            ("player_receptions", "receptions"), ("player_anytime_td", "anytime_td"),
            ("player_pass_tds", "pass_tds"), ("player_pass_completions", "pass_cmp"),
            ("player_pass_attempts", "pass_att"), ("player_pass_interceptions", "pass_int"),
            ("player_pass_rush_yds", "pass_rush_yds"), ("player_rush_attempts", "rush_att"),
            ("player_rush_reception_yds", "rush_rec_yds")],
    "nba": [("player_points", "points"), ("player_rebounds", "rebounds"), ("player_assists", "assists"),
            ("player_threes", "threes"), ("player_points_rebounds", "pts_reb"), ("player_points_assists", "pts_ast"),
            ("player_rebounds_assists", "reb_ast"), ("player_points_rebounds_assists", "pra")],
}
CORE_KEYS = {
    "nfl": {"pass_yds", "rush_yds", "rec_yds", "receptions", "anytime_td"},
    "nba": {"points", "rebounds", "assists", "threes"},
}
SUPPORTED = tuple(MARKETS)
ANYTIME_LINE = 0.5
# Same assumptions as docs/odds_api_budget.md (worst case: every requested market is posted).
NFL_GAMES_PER_WEEK = 16
NBA_GAMES_PER_DAY = 7.2
MONTH_DAYS = 30.4

def window_hours(lg_key):
    return WINDOW_H.get(lg_key, 0)

def market_rows(lg_key, group="all"):
    rows = list(MARKETS.get(lg_key) or [])
    if group == "all": return rows
    core = CORE_KEYS.get(lg_key) or set()
    if group == "core": return [r for r in rows if r[1] in core]
    if group == "extra": return [r for r in rows if r[1] not in core]
    raise ValueError(group)

def n_markets(lg_key, group="all"): return len(market_rows(lg_key, group))

def _commence(ev):
    try: return dt.datetime.fromisoformat(str((ev or {}).get("commence_time")).replace("Z", "+00:00"))
    except (TypeError, ValueError): return None

def groups_for(lg_key, commence, now):
    """[(name, interval_min, rows)] for one start time. Empty outside the league window."""
    if commence is None or not (now < commence <= now + dt.timedelta(hours=window_hours(lg_key))): return []
    if commence <= now + dt.timedelta(hours=NEAR_H):
        out = []
        core, extra = market_rows(lg_key, "core"), market_rows(lg_key, "extra")
        if core: out.append(("core", PROPS_INTERVAL, core))
        if extra: out.append(("extra", EXTRA_INTERVAL, extra))
        return out
    rows = market_rows(lg_key)
    return [("far", FAR_INTERVAL, rows)] if rows else []

def due_groups(lg_key, commence, now, at_by):
    return [(name, rows) for name, interval, rows in groups_for(lg_key, commence, now)
            if OB.due((at_by or {}).get(name), interval, now)]

def event_credits(lg_key, commence, now):
    """Average credits this event adds to one 2 h props pass. odds_budget.plan multiplies the sum by 12."""
    if commence is None or not (now < commence <= now + dt.timedelta(hours=window_hours(lg_key))): return 0
    if commence <= now + dt.timedelta(hours=NEAR_H):
        return n_markets(lg_key, "core") + n_markets(lg_key, "extra") * (PROPS_INTERVAL / EXTRA_INTERVAL)
    return n_markets(lg_key) * (PROPS_INTERVAL / FAR_INTERVAL)

def run_credits(lg_key, events, now):
    return sum(event_credits(lg_key, _commence(ev), now) for ev in events or [])

def credit_model(days=MONTH_DAYS, nfl_per_week=NFL_GAMES_PER_WEEK, nba_per_day=NBA_GAMES_PER_DAY):
    """Upper-bound credits for the props cadence above. A game is counted once for each zone it sits in
    (NEAR_H hours at the near cadence, then the rest of the NFL window at the far cadence)."""
    epd = nfl_per_week / 7
    near_pulls = NEAR_H / (PROPS_INTERVAL / 60)
    extra_pulls = NEAR_H / (EXTRA_INTERVAL / 60)
    far_pulls = (window_hours("nfl") - NEAR_H) / (FAR_INTERVAL / 60)
    rows = [
        ("NFL core markets", n_markets("nfl", "core"), epd, near_pulls),
        ("NFL added markets", n_markets("nfl", "extra"), epd, extra_pulls),
        ("NFL early-week", n_markets("nfl"), epd, far_pulls),
        ("NBA core markets", n_markets("nba", "core"), nba_per_day, near_pulls),
        ("NBA added markets", n_markets("nba", "extra"), nba_per_day, extra_pulls),
    ]
    per_day = [(name, mk * ev * pulls) for name, mk, ev, pulls in rows]
    new = sum(v for _, v in per_day)
    old = 5 * epd * near_pulls + 4 * nba_per_day * near_pulls   # previous 36 h window, 5 NFL + 4 NBA markets, every 2 h
    naive = (n_markets("nfl") * epd * (window_hours("nfl") / (PROPS_INTERVAL / 60))
             + n_markets("nba") * nba_per_day * near_pulls)     # every market, every 2 h, NFL out to 8 days
    return dict(rows=per_day, perDay=new, oldPerDay=old, extraPerDay=new - old, perMonth=new * days,
                oldPerMonth=old * days, extraPerMonth=(new - old) * days, naivePerDay=naive, naiveExtraPerDay=naive - old)

_SUFFIX = {"jr", "sr", "ii", "iii", "iv", "v"}
def norm_player(name):
    """'Kenneth Walker III' / 'kenneth walker' / 'Luka Dončić' -> comparable key."""
    s = unicodedata.normalize("NFKD", str(name or ""))
    s = "".join(c for c in s if not unicodedata.combining(c)).lower().replace(".", "").replace("'", "").replace("’", "")
    toks = [t for t in re.split(r"[^a-z0-9]+", s) if t and t not in _SUFFIX]
    return " ".join(toks)

def _implied(p):
    if not isinstance(p, (int, float)) or p == 0: return None
    return 100 / (p + 100) if p > 0 else -p / (-p + 100)

def merge_books(old, new, requested):
    """Keep markets we did not ask for on this pull; replace the ones we did (a missing line is a pull, not a stale price)."""
    req = set(requested or [])
    out = {}
    for bk in set(old or {}) | set(new or {}):
        kept = {k: v for k, v in ((old or {}).get(bk) or {}).items() if k not in req}
        kept.update((new or {}).get(bk) or {})
        if kept: out[bk] = kept
    return out

def parse_event_odds(lg_key, ev):
    """One per-event odds response -> {book: {ourMarket: {playerName: [line, overPrice, underPrice]}}}.
    When a book lists several lines for one player, keep the most balanced over/under pair (the main line)."""
    mk_map = dict(MARKETS.get(lg_key, []))
    out = {}
    for bk in (ev or {}).get("bookmakers") or []:
        if bk.get("key") not in BOOKS: continue
        for m in bk.get("markets") or []:
            ours = mk_map.get(m.get("key"))
            if not ours: continue
            pairs = {}
            for oc in m.get("outcomes") or []:
                who = oc.get("description") or ""
                nm = str(oc.get("name") or "").lower()
                if not who: continue
                if ours == "anytime_td":
                    if nm not in ("yes", "no", "over", "under"): continue
                    line, side = ANYTIME_LINE, "o" if nm in ("yes", "over") else "u"
                else:
                    line = oc.get("point")
                    if not isinstance(line, (int, float)) or nm not in ("over", "under"): continue
                    side = "o" if nm == "over" else "u"
                pairs.setdefault((who, float(line)), {})[side] = oc.get("price")
            best = {}
            for (who, line), p in pairs.items():
                io, iu = _implied(p.get("o")), _implied(p.get("u"))
                score = abs(io - iu) if io is not None and iu is not None else 9   # both sides posted beats one side
                if who not in best or score < best[who][0]: best[who] = (score, [line, p.get("o"), p.get("u")])
            if best: out.setdefault(bk["key"], {})[ours] = {w: v[1] for w, v in best.items()}
    return out

def cache_load(d):
    try:
        with open(os.path.join(d, CACHE_FILE)) as fh: c = json.load(fh)
        if c.get("v") == 1 and isinstance(c.get("leagues"), dict): return c
    except (OSError, ValueError, TypeError, AttributeError):
        pass
    return dict(v=1, book="props", leagues={}, checks=[])

def cache_prune(c, now):
    for e in c["leagues"].values():
        e["games"] = {k: v for k, v in (e.get("games") or {}).items()
                      if v.get("date") and dt.datetime.fromisoformat(v["date"].replace("Z", "+00:00")) >= now - dt.timedelta(hours=12)}
    c["checks"] = (c.get("checks") or [])[-60:]

def cache_save(d, c):
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, CACHE_FILE); tmp = p + ".tmp"
    with open(tmp, "w") as fh: json.dump(c, fh, indent=1, sort_keys=True)
    os.replace(tmp, p)

def _rows_for(lg_key, due):
    """Due groups -> markets in MARKETS order, plus the group names to stamp."""
    want = {mk for _, rows in due for _, mk in rows}
    rows = [(api, mk) for api, mk in market_rows(lg_key) if mk in want]
    return rows, [name for name, _ in due]

def pull_league(lg, events, games, pull, t, get, match_event, note_headers, scrub, now, api, prev=None, log=print):
    """Per-event props for one league. events: Odds API /events list (free call); games: ESPN index games.
    Stops at the per-run cap or the reserve floor. Near games (inside NEAR_H) are fetched before early-week games.
    Within a band the stalest due group goes first, so a run that hits the cap rotates instead of starving the tail.
    Games not refetched this run keep their previous pull (prev entry). A far pull stamps core and extra too
    (it already requested every market). Returns (entry or None, message)."""
    key = lg["key"]
    if not MARKETS.get(key): return None, "not supported"
    horizon_h = window_hours(key)
    near_cut = now + dt.timedelta(hours=NEAR_H)
    todo = []
    for ev in events or []:
        ct = _commence(ev)
        if ct is not None and now < ct <= now + dt.timedelta(hours=horizon_h): todo.append((ct, ev))
    pre = [g for g in games if g.get("state") == "pre"]
    prev_games = (prev or {}).get("games") or {}
    out, spent, n_ok, n_skip, n_held, errs, done = {}, 0, 0, 0, 0, [], set()
    ranked = []
    for ct, ev in todo:
        g, _ = match_event(ev, pre)
        if not g: continue
        gid = str(g["id"])
        at_by = (prev_games.get(gid) or {}).get("atBy") or {}
        due = due_groups(key, ct, now, at_by)
        if not due: n_held += 1; continue
        oldest = min((at_by.get(name) or "") for name, _ in due)
        ranked.append((0 if ct <= near_cut else 1, oldest, ct.isoformat(), str(ev.get("id") or ""), ev, g, due))
    for _, _, _, _, ev, g, due in sorted(ranked):
        rows, names = _rows_for(key, due)
        if pull["spent"] + len(rows) > pull.get("cap", 10 ** 9) or (pull.get("remaining") or 0) - len(rows) < pull.get("floor", 0):
            n_skip += 1; continue
        url = (f"{api}/v4/sports/{lg['odds_key']}/events/{urllib.parse.quote(str(ev.get('id')))}/odds?apiKey={urllib.parse.quote(pull['key'])}"
               f"&bookmakers={','.join(BOOKS)}&markets={','.join(m for m, _ in rows)}&oddsFormat=american&dateFormat=iso")
        try:
            data, hdr = get(url)
        except Exception as ex:
            errs.append(scrub(ex, pull["key"])[:160]); continue
        spent += note_headers(pull, hdr, "props") or 0
        gid = str(g["id"])
        prev_g = prev_games.get(gid) or {}
        books = merge_books(prev_g.get("books"), parse_event_odds(key, data), [mk for _, mk in rows])
        at_by = dict(prev_g.get("atBy") or {})
        for name in names: at_by[name] = t
        if "far" in names: at_by["core"] = at_by["extra"] = t
        n_ok += 1; done.add(gid)
        out[gid] = dict(date=g["date"], at=t, atBy=at_by, books=books)
    for gid, v in prev_games.items():
        if gid not in done and gid not in out: out[gid] = v
    if errs: pull["errors"].append(f"{key}-props")
    entry = dict(pulledAt=t, events=len(todo), fetched=n_ok, withProps=len(out), refreshed=sorted(done),
                 skipped=n_skip, held=n_held, cost=spent, games=out)
    msg = (f"props: {n_ok}/{len(todo)} events in {horizon_h}h fetched, {len(out)} with Odds API (Hard Rock/FanDuel/DraftKings) props, cost {spent}"
           + (f", {n_held} not due" if n_held else "") + (f", {n_skip} skipped (cap/floor)" if n_skip else "")
           + (f", errors {errs[:2]}" if errs else ""))
    return (entry if n_ok or (n_held and not errs and not n_skip) else None), msg
