"""Hard Rock Bet + FanDuel + DraftKings player props from The Odds API (paid plan) - NFL and NBA only.

Per-event endpoint: GET /v4/sports/{sport}/events/{eventId}/odds?bookmakers=hardrockbet,fanduel,draftkings&markets=...
Cost (v4 docs): unique markets RETURNED x regions; bookmakers= with up to 10 books = 1 region, so FanDuel and DraftKings are free on
top of Hard Rock; an event with no props posted costs 0. We keep a short list of popular markets per league and only
pull events starting within WINDOW_H hours, at most every PROPS_INTERVAL minutes (budget guard: scripts/odds_budget.py).

Lines are persisted by player NAME (props_oddsapi.json on the data-history branch); scripts/props.py maps names to
ESPN athlete ids at build time and merges them next to the DraftKings (ESPN) lines.

Cache entry per league (same shape as hardrockbet.json so line_history.py apply-odds merges it):
  {"pulledAt": iso, "events": n, "cost": credits, "games": {espnGameId: {"date": iso, "books": {book: {ourMarket: {name: [line, over, under]}}}}}}
"""
import datetime as dt, json, os, re, unicodedata, urllib.parse

CACHE_FILE = "props_oddsapi.json"
BOOKS = ("hardrockbet", "fanduel", "draftkings")
WINDOW_H = 36
PROPS_INTERVAL = 120
# Odds API market key -> props.py market key. Kept short on purpose: every market returned costs 1 credit per event.
MARKETS = {
    "nfl": [("player_pass_yds", "pass_yds"), ("player_rush_yds", "rush_yds"), ("player_reception_yds", "rec_yds"),
            ("player_receptions", "receptions"), ("player_anytime_td", "anytime_td")],
    "nba": [("player_points", "points"), ("player_rebounds", "rebounds"), ("player_assists", "assists"), ("player_threes", "threes")],
}
SUPPORTED = tuple(MARKETS)
ANYTIME_LINE = 0.5

def n_markets(lg_key): return len(MARKETS.get(lg_key, []))

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

def pull_league(lg, events, games, pull, t, get, match_event, note_headers, scrub, now, api, prev=None, log=print):
    """Per-event props for one league. events: Odds API /events list (free call); games: ESPN index games.
    Stops at the per-run cap or the reserve floor; games not refetched this run keep their previous pull (prev entry).
    Returns (entry or None, message)."""
    key = lg["key"]; mks = MARKETS.get(key)
    if not mks: return None, "not supported"
    horizon = now + dt.timedelta(hours=WINDOW_H)
    todo = []
    for ev in events or []:
        try: ct = dt.datetime.fromisoformat(str(ev.get("commence_time")).replace("Z", "+00:00"))
        except ValueError: continue
        if now < ct <= horizon: todo.append(ev)
    pre = [g for g in games if g.get("state") == "pre"]
    out, spent, n_ok, n_skip, errs, done = {}, 0, 0, 0, [], set()
    for ev in sorted(todo, key=lambda e: e.get("commence_time") or ""):
        g, _ = match_event(ev, pre)
        if not g: continue
        if pull["spent"] + len(mks) > pull.get("cap", 10 ** 9) or (pull.get("remaining") or 0) - len(mks) < pull.get("floor", 0):
            n_skip += 1; continue
        url = (f"{api}/v4/sports/{lg['odds_key']}/events/{urllib.parse.quote(str(ev.get('id')))}/odds?apiKey={urllib.parse.quote(pull['key'])}"
               f"&bookmakers={','.join(BOOKS)}&markets={','.join(m for m, _ in mks)}&oddsFormat=american&dateFormat=iso")
        try:
            data, hdr = get(url)
        except Exception as ex:
            errs.append(scrub(ex, pull["key"])[:160]); continue
        spent += note_headers(pull, hdr, "props") or 0
        books = parse_event_odds(key, data)
        n_ok += 1; done.add(str(g["id"]))
        if books: out[str(g["id"])] = dict(date=g["date"], at=t, books=books)
    for gid, v in ((prev or {}).get("games") or {}).items():
        if gid not in done and gid not in out: out[gid] = v
    if errs: pull["errors"].append(f"{key}-props")
    entry = dict(pulledAt=t, events=len(todo), fetched=n_ok, withProps=len(out), refreshed=sorted(done), skipped=n_skip, cost=spent, games=out)
    msg = (f"props: {n_ok}/{len(todo)} events in {WINDOW_H}h fetched, {len(out)} with Odds API (Hard Rock/FanDuel/DraftKings) props, cost {spent}"
           + (f", {n_skip} skipped (cap/floor)" if n_skip else "") + (f", errors {errs[:2]}" if errs else ""))
    return (entry if n_ok else None), msg
