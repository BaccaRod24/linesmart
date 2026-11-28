#!/usr/bin/env python3
"""Season-long futures (outright winner) prices from The Odds API.

One paid pull per ET day, after a set hour (default 6:00 AM America/New_York), and only
when the game-line budget guard still has room. The free /v4/sports catalog decides which
allowlisted keys are active and have outrights. Each of those keys is one request with the
same bookmakers filter as game lines (hardrockbet,fanduel,draftkings = one region), so
Hard Rock Bet shows up on its own if the feed ever returns it. That is 0 extra credits.

History lives on the data-history branch at history/futures/<sport key>.json. Points append
only when a book's price for that outcome changes. Open is the earliest recorded price.
Files stay for the season: they are not pruned with line_history.PRUNE_DAYS. A market is
dropped once its commence_time is more than RETAIN_DAYS in the past.

Published site files are site/data/futures/<league>.json. This module never calls the
network itself; build_data.py passes a `get`. Tests pass a fake get.
"""
import datetime as dt, glob, json, os, urllib.parse
from zoneinfo import ZoneInfo

import line_history as LH
import odds_budget as OB

ET = ZoneInfo("America/New_York")
ODDS_API = "https://api.the-odds-api.com"
BOOKS = ("hardrockbet", "fanduel", "draftkings")
BOOKS_Q = ",".join(BOOKS)
REGION = "us2"
HOUR_ET = 6
RETAIN_DAYS = 3          # after commence_time; not line_history.PRUNE_DAYS (that one is 3 days from lastSeen)
PRICE_BOOKS = ("draftkings", "fanduel")   # "best" is among these two, per the futures tab
HR_BOOK = "hardrockbet"

# Championship and golf-major winner keys from the 2026-11-28 discovery.
# MVP, awards, conference and division markets are not in this list: the feed
# did not have them, and a key that is not here is never requested.
# (sport key, league, subject, title used only when the catalog omits one)
ALLOW = (
    ("americanfootball_nfl_super_bowl_winner", "nfl", "team", "NFL Super Bowl Winner"),
    ("americanfootball_ncaaf_championship_winner", "ncaaf", "team", "NCAAF Championship Winner"),
    ("basketball_nba_championship_winner", "nba", "team", "NBA Championship Winner"),
    ("basketball_ncaab_championship_winner", "ncaab", "team", "NCAAB Championship Winner"),
    ("icehockey_nhl_championship_winner", "nhl", "team", "NHL Championship Winner"),
    ("baseball_mlb_world_series_winner", "mlb", "team", "MLB World Series Winner"),
    ("golf_masters_tournament_winner", "golf", "player", "Masters Tournament Winner"),
    ("golf_pga_championship_winner", "golf", "player", "PGA Championship Winner"),
    ("golf_the_open_championship_winner", "golf", "player", "The Open Winner"),
    ("golf_us_open_winner", "golf", "player", "US Open Winner"),
)
ALLOW_BY_KEY = {k: {"key": k, "league": lg, "subject": sub, "title": title} for k, lg, sub, title in ALLOW}
# A file is written for every hub, including leagues the feed does not cover, so the
# page can say so instead of looking like a failed load.
PUBLISH_LEAGUES = ("nfl", "nba", "ncaaf", "ncaab", "nhl", "mlb", "epl", "mls", "ucl", "ufc", "golf")

def monthly_credits(active_keys=9, days=30.4):
    """Credits per billing month at one request per active key per day. Catalog and Hard Rock are free."""
    return active_keys * days

def _utc(t):
    if t is None: return dt.datetime.now(dt.timezone.utc)
    return t if t.tzinfo else t.replace(tzinfo=dt.timezone.utc)

def _iso(t):
    return _utc(t).astimezone(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

def _et(t):
    return _utc(t).astimezone(ET)

def _parse(iso):
    if not iso: return None
    try: t = dt.datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except ValueError: return None
    return t if t.tzinfo else t.replace(tzinfo=dt.timezone.utc)

def price_of(v):
    """American odds as an int. Zero and booleans are not prices."""
    if isinstance(v, bool) or not isinstance(v, (int, float)): return None
    if v == 0: return None
    return int(v)

def better_price(a, b):
    """True when `a` pays the bettor more than `b` (lower implied probability)."""
    ia, ib = LH.implied(a), LH.implied(b)
    if ia is None: return False
    if ib is None: return True
    return ia < ib - 1e-12

def implied_pct(a):
    """Implied win probability in percent, one decimal. Includes the book's margin."""
    p = LH.implied(a)
    if p is None: return None
    return round(p * 1000) / 10

def select_keys(catalog):
    """Active allowlisted keys that have outrights. Inactive keys (MLB off-season) are not called.

    Anything outside ALLOW is ignored, including MVP, awards, conference, division,
    soccer and politics keys, even when the catalog marks them active.
    """
    rows = catalog if isinstance(catalog, list) else []
    by = {r.get("key"): r for r in rows if isinstance(r, dict) and r.get("key")}
    out = []
    for spec in ALLOW_BY_KEY.values():
        row = by.get(spec["key"])
        if not row or not row.get("active") or not row.get("has_outrights"): continue
        out.append(dict(spec, title=row.get("title") or spec["title"]))
    return out

def due(stamp, now, hour_et=HOUR_ET):
    """True on the first run of an ET date at or after hour_et.

    A missing stamp is due once the hour has passed (so a deploy in the afternoon
    still pulls that day). Before the hour, it waits. A stamp for today's ET date
    blocks every later run, including a manual force pull: futures are once per day.
    """
    local = _et(now)
    if local.hour < int(hour_et): return False
    last = (stamp or {}).get("lastDateET")
    return last != local.date().isoformat()

def week_key(now):
    y, w, _ = _et(now).isocalendar()
    return f"{y}-W{w:02d}"

def load_json(path, default):
    try:
        with open(path) as fh: doc = json.load(fh)
        if isinstance(doc, dict): return doc
    except (OSError, ValueError, TypeError):
        pass
    return default

def save_json(path, doc):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as fh: json.dump(doc, fh, indent=1, sort_keys=True)
    os.replace(tmp, path)

def empty_hist(spec):
    return dict(v=1, key=spec["key"], league=spec["league"], title=spec.get("title"),
                subject=spec.get("subject") or "team", eventId=None, commence=None,
                updated=None, outcomes={}, board=None)

def load_hist(path, spec):
    h = load_json(path, None)
    if not h or h.get("v") != 1 or not isinstance(h.get("outcomes"), dict):
        return empty_hist(spec)
    h.setdefault("outcomes", {})
    return h

def expired(hist, now, days=RETAIN_DAYS):
    """True once commence_time plus `days` has passed. No commence time is kept."""
    t = _parse((hist or {}).get("commence"))
    if not t: return False
    return _utc(now) > t + dt.timedelta(days=days)

def _collapse(points):
    """Time-sorted points with consecutive duplicate prices removed. The earliest price stays."""
    rows = []
    for p in points or []:
        if not isinstance(p, (list, tuple)) or len(p) < 2: continue
        when, price = str(p[0]), price_of(p[1])
        if not when or price is None: continue
        rows.append([when, price])
    rows.sort(key=lambda r: r[0])
    out = []
    for when, price in rows:
        if out and out[-1][1] == price: continue
        if out and out[-1][0] == when: out[-1][1] = price; continue
        out.append([when, price])
    return out

def _refresh_open(oc):
    """Open is the earliest recorded price for that book, recomputed so a late older point can land."""
    opens, ats = {}, {}
    for bk, pts in (oc.get("books") or {}).items():
        if pts:
            opens[bk] = pts[0][1]
            ats[bk] = pts[0][0]
    oc["open"] = opens
    oc["openAt"] = ats
    seen = [p[0] for pts in (oc.get("books") or {}).values() for p in pts]
    if seen: oc["lastSeen"] = max(seen)

def observe_event(ev):
    """One Odds API outright event -> {eventId, commence, title, books:{key:{at, outcomes}}}."""
    if not isinstance(ev, dict): return None
    books = {}
    for bk in ev.get("bookmakers") or []:
        key = bk.get("key")
        if key not in BOOKS: continue
        outcomes = {}
        for mk in bk.get("markets") or []:
            if mk.get("key") not in (None, "outrights"): continue
            for oc in mk.get("outcomes") or []:
                name = (oc.get("name") or "").strip()
                price = price_of(oc.get("price"))
                if name and price is not None: outcomes[name] = price
        # An empty Hard Rock Bet block still counts as "appeared" for the weekly check.
        if outcomes or key == HR_BOOK:
            books[key] = dict(at=bk.get("last_update") or "", outcomes=outcomes)
    return dict(eventId=ev.get("id"), commence=ev.get("commence_time"),
                title=ev.get("sport_title"), books=books)

def pick_event(events):
    """The outright with the latest commence_time. An empty list is not an event."""
    evs = [e for e in events or [] if isinstance(e, dict)]
    if not evs: return None
    return max(evs, key=lambda e: e.get("commence_time") or "")

def apply_observation(hist, spec, obs, now):
    """Merge one pull into history. Returns how many new price points were stored.

    A different event id starts a new season (previous outcomes are dropped).
    An event past commence_time + RETAIN_DAYS is cleared and not extended.
    An empty book set does not wipe prices already recorded for this event.
    """
    if not obs: return 0
    if obs.get("eventId") and hist.get("eventId") and obs["eventId"] != hist["eventId"]:
        hist["outcomes"] = {}
        hist.pop("dropped", None)
    if obs.get("eventId"): hist["eventId"] = obs["eventId"]
    if obs.get("commence"): hist["commence"] = obs["commence"]
    if obs.get("title"): hist["title"] = obs["title"]
    hist["league"] = spec.get("league") or hist.get("league")
    hist["subject"] = spec.get("subject") or hist.get("subject") or "team"
    hist["key"] = spec["key"]
    if expired(hist, now):
        hist["outcomes"] = {}
        hist["board"] = None
        hist["dropped"] = True
        hist["updated"] = _iso(now)
        return 0
    added = 0
    board_books = {}
    book_ats = []
    for bk, blob in (obs.get("books") or {}).items():
        if bk not in BOOKS: continue
        when = blob.get("at") or _iso(now)
        if blob.get("at"): book_ats.append(blob["at"])
        outcomes = blob.get("outcomes") or {}
        if outcomes:
            board_books[bk] = dict(outcomes)
        for name, price in outcomes.items():
            oc = hist["outcomes"].setdefault(name, {"books": {}})
            pts = _collapse((oc.get("books") or {}).get(bk, []) + [[when, price]])
            prev = (oc.get("books") or {}).get(bk) or []
            if pts != prev:
                added += len(pts) - len(prev) if len(pts) >= len(prev) else 1
            oc.setdefault("books", {})[bk] = pts
            _refresh_open(oc)
    # Board is the prices currently posted. A later book update replaces it; an older one does not.
    prev_board = hist.get("board") or {}
    priced = any(board_books.values())
    at = max(book_ats) if book_ats else _iso(now)
    if board_books and at >= (prev_board.get("at") or ""):
        hist["board"] = dict(at=at, books=board_books)
    if obs.get("eventId") and not priced:
        hist["noBooks"] = True
    elif priced:
        hist.pop("noBooks", None)
    hist["updated"] = at
    hist.pop("dropped", None)
    return added

def apply_snap(hist, snap, now):
    """Race merge: this run's observation onto the tip. Opens stay the earliest price."""
    if not isinstance(snap, dict): return 0
    spec = dict(ALLOW_BY_KEY.get(snap.get("key")) or {}, key=snap.get("key"),
                league=snap.get("league"), title=snap.get("title"), subject=snap.get("subject"))
    obs = dict(eventId=snap.get("eventId"), commence=snap.get("commence"), title=snap.get("title"),
               books=snap.get("books") or {})
    return apply_observation(hist, spec, obs, _parse(snap.get("t")) or now)

def hardrock_seen(obs_list):
    """True when any response included the hardrockbet bookmaker."""
    for obs in obs_list or []:
        if HR_BOOK in ((obs or {}).get("books") or {}): return True
    return False

def note_hardrock(stamp, present, now):
    """One log line per ISO week. The book is already in the daily request, so this costs 0.

    Returns (message or None, stamp). The message is None when this week was already logged.
    """
    stamp = dict(stamp or {})
    week = week_key(now)
    prev = stamp.get("hardrock") or {}
    stamp["hardrock"] = dict(week=week, present=bool(present), loggedAt=_iso(now))
    if prev.get("week") == week:
        stamp["hardrock"] = prev
        return None, stamp
    if present:
        msg = ("[futures] weekly Hard Rock check: hardrockbet appeared in a futures response "
               "(0 extra credits; it is already in the daily bookmakers filter)")
    else:
        msg = ("[futures] weekly Hard Rock check: hardrockbet was not in any futures response "
               "(0 extra credits; it is already in the daily bookmakers filter)")
    return msg, stamp

def merge_stamp(tip, snap):
    """Later pull wins. A newer weekly Hard Rock note wins over an older one."""
    tip, snap = dict(tip or {}), dict(snap or {})
    if (snap.get("lastAt") or "") > (tip.get("lastAt") or ""):
        out = dict(tip, **{k: snap[k] for k in ("lastAt", "lastDateET", "hourET") if k in snap})
    else:
        out = dict(snap, **tip)
        out.setdefault("v", 1)
    a, b = tip.get("hardrock") or {}, snap.get("hardrock") or {}
    if (b.get("loggedAt") or "") > (a.get("loggedAt") or ""): out["hardrock"] = b
    elif a: out["hardrock"] = a
    elif b: out["hardrock"] = b
    out["v"] = 1
    return out

def _best(prices):
    """Best DraftKings/FanDuel price for the bettor, and which book posted it.

    Tie goes to DraftKings, then FanDuel, so the column is stable.
    """
    best_bk, best_px = None, None
    for bk in PRICE_BOOKS:
        px = prices.get(bk)
        if px is None: continue
        if best_px is None or better_price(px, best_px):
            best_bk, best_px = bk, px
    return best_bk, best_px

def outcome_row(name, oc, board_books):
    """One published outcome. Current prices come from the latest board, not a stale point."""
    prices = {}
    for bk in BOOKS:
        px = price_of(((board_books or {}).get(bk) or {}).get(name))
        if px is not None: prices[bk] = px
    if not prices: return None
    best_bk, best_px = _best(prices)
    if best_px is None: return None
    opens = (oc or {}).get("open") or {}
    open_at = (oc or {}).get("openAt") or {}
    open_px = price_of(opens.get(best_bk))
    if open_px is None: open_px = best_px
    return dict(name=name,
                draftkings=prices.get("draftkings"),
                fanduel=prices.get("fanduel"),
                hardrockbet=prices.get("hardrockbet"),
                best=best_px, bestBook=best_bk,
                implied=implied_pct(best_px),
                open=open_px, openBook=best_bk,
                move=LH.ml_cents(open_px, best_px),
                firstRecorded=open_at.get(best_bk) or (oc or {}).get("lastSeen"))

def publish_market(hist):
    """Site market object, or None when this file has nothing to show."""
    if not hist or hist.get("dropped"): return None
    board = hist.get("board") or {}
    books = board.get("books") or {}
    if not books and not hist.get("noBooks"): return None
    names = []
    for bk in BOOKS:
        for name in (books.get(bk) or {}):
            if name not in names: names.append(name)
    rows = []
    for name in names:
        row = outcome_row(name, (hist.get("outcomes") or {}).get(name), books)
        if row: rows.append(row)
    rows.sort(key=lambda r: (-(max([LH.implied(r.get(b)) or 0 for b in PRICE_BOOKS])), r["name"]))
    present = [bk for bk in BOOKS if books.get(bk)]
    return dict(key=hist.get("key"), title=hist.get("title"), subject=hist.get("subject") or "team",
                eventId=hist.get("eventId"), commence=hist.get("commence"),
                lastUpdate=board.get("at") or hist.get("updated"),
                books=present, hardrock=HR_BOOK in present,
                outcomes=rows)

def publish_league(league, hists, now):
    markets = []
    for h in hists:
        if expired(h, now): continue
        m = publish_market(h)
        if m: markets.append(m)
    updated = max((m.get("lastUpdate") or "" for m in markets), default="") or None
    return dict(v=1, league=league, updated=updated, markets=markets)

def write_site(out_dir, by_league, now):
    """Write data/futures/<league>.json for every hub. Leagues with no feed get markets: []."""
    base = os.path.join(out_dir, "futures")
    os.makedirs(base, exist_ok=True)
    written = {}
    for lg in PUBLISH_LEAGUES:
        doc = publish_league(lg, by_league.get(lg) or [], now)
        save_json(os.path.join(base, f"{lg}.json"), doc)
        written[lg] = len(doc["markets"])
    return written

def _hist_path(history_dir, key):
    return os.path.join(history_dir, "futures", f"{key}.json")

def _stamp_path(history_dir):
    return os.path.join(history_dir, "futures", "_stamp.json")

def load_all(history_dir, now):
    """Every stored market, grouped by league. Expired files are cleared on disk."""
    by = {lg: [] for lg in PUBLISH_LEAGUES}
    if not history_dir: return by
    d = os.path.join(history_dir, "futures")
    for path in sorted(glob.glob(os.path.join(d, "*.json"))):
        if os.path.basename(path).startswith("_"): continue
        h = load_json(path, None)
        if not h or h.get("v") != 1: continue
        spec = ALLOW_BY_KEY.get(h.get("key")) or {}
        if expired(h, now) and h.get("outcomes"):
            h["outcomes"] = {}
            h["board"] = None
            h["dropped"] = True
            h["updated"] = _iso(now)
            save_json(path, h)
        lg = h.get("league") or spec.get("league")
        if lg in by: by[lg].append(h)
    return by

def _q(api_key):
    return urllib.parse.quote(api_key or "", safe="")

def catalog_url(api_key):
    return f"{ODDS_API}/v4/sports/?apiKey={_q(api_key)}&all=true"

def odds_url(api_key, sport_key):
    return (f"{ODDS_API}/v4/sports/{sport_key}/odds/?apiKey={_q(api_key)}"
            f"&regions={REGION}&bookmakers={BOOKS_Q}&markets=outrights&oddsFormat=american&dateFormat=iso")

def _snap_observation(spec, obs, now):
    return dict(v=1, key=spec["key"], league=spec["league"], title=obs.get("title") or spec.get("title"),
                subject=spec.get("subject"), eventId=obs.get("eventId"), commence=obs.get("commence"),
                t=_iso(now), books=obs.get("books") or {})

def run(*, pull, budget, history_dir, snap_dir, out_dir, get, now, log=print, api_key=None,
        note_headers=None, scrub=None, floor=300, cap=250, hour_et=HOUR_ET):
    """Publish site JSON from history, and pull outright odds when today is due and the guard allows.

    Returns a small summary dict. Never raises on a single key's failure.
    Without history_dir the paid pull is skipped (there is nowhere to persist the once-a-day stamp).
    """
    now = _utc(now)
    summary = dict(pulled=False, skipped=None, keys=[], spent=0, hardrock=None)
    if history_dir:
        by = load_all(history_dir, now)
    else:
        by = {lg: [] for lg in PUBLISH_LEAGUES}
    if out_dir and history_dir:
        summary["published"] = write_site(out_dir, by, now)
    elif out_dir:
        summary["published"] = None
        log("[futures] no history dir: left site/data/futures untouched")

    if not api_key or pull is None or not history_dir:
        why = "no Odds API key" if not api_key else "no paid session" if pull is None else "no history dir"
        summary["skipped"] = why
        log(f"[futures] not pulled ({why}); site files follow the stored history")
        return summary
    stamp_path = _stamp_path(history_dir)
    stamp = load_json(stamp_path, dict(v=1, hourET=hour_et))
    if not due(stamp, now, hour_et):
        summary["skipped"] = f"already pulled for {stamp.get('lastDateET')} (once per ET day, after {hour_et}:00)"
        log(f"[futures] {summary['skipped']}")
        return summary
    level = (budget or {}).get("level")
    if level in (None, "stop", "slow-games"):
        summary["skipped"] = "game lines come first"
        log(f"[futures] skipped: budget level {level} (futures never run ahead of game lines)")
        return summary
    try:
        catalog, hdr = get(catalog_url(api_key))
    except Exception as ex:
        msg = scrub(ex, api_key) if scrub else str(ex)[:160]
        summary["skipped"] = "catalog failed"
        log(f"[futures] catalog failed (free call, 0 credits): {msg}")
        return summary
    if note_headers and hdr is not None:
        note_headers(pull, hdr, "futures")
    keys = select_keys(catalog if isinstance(catalog, list) else [])
    ok, why = OB.futures_gate(budget, cost=len(keys), run_spent=pull.get("spent") or 0,
                              remaining=pull.get("remaining"), floor=floor, cap=cap)
    if not ok:
        summary["skipped"] = why
        log(f"[futures] skipped: {why} ({len(keys)} active keys)")
        return summary
    if not keys:
        stamp = dict(stamp, v=1, hourET=hour_et, lastDateET=_et(now).date().isoformat(), lastAt=_iso(now))
        save_json(stamp_path, stamp)
        summary["skipped"] = "no active outright keys"
        log("[futures] no active allowlisted outright keys (0 credits)")
        _write_stamp_snap(snap_dir, stamp)
        return summary
    observations = []
    any_ok = False
    for spec in keys:
        if pull.get("remaining") is None or pull["remaining"] - 1 < floor:
            log(f"[futures] {spec['key']}: skipped (would cross the {floor} floor)")
            continue
        if (pull.get("spent") or 0) + 1 > cap:
            log(f"[futures] {spec['key']}: skipped (per-run cap {cap})")
            continue
        try:
            data, hdr = get(odds_url(api_key, spec["key"]))
        except Exception as ex:
            msg = scrub(ex, api_key) if scrub else str(ex)[:160]
            log(f"[futures] {spec['key']}: error: {msg}")
            continue
        last = note_headers(pull, hdr, "futures") if note_headers else 0
        summary["spent"] += last or 0
        ev = pick_event(data if isinstance(data, list) else [])
        obs = observe_event(ev) if ev else None
        if obs is None:
            log(f"[futures] {spec['key']}: empty response, cost {last}; kept stored prices")
            any_ok = True
            continue
        path = _hist_path(history_dir, spec["key"])
        hist = load_hist(path, spec)
        n = apply_observation(hist, spec, obs, now)
        save_json(path, hist)
        if snap_dir:
            save_json(os.path.join(snap_dir, "_futures", f"{spec['key']}.json"), _snap_observation(spec, obs, now))
        observations.append(obs)
        any_ok = True
        summary["keys"].append(spec["key"])
        log(f"[futures] {spec['key']}: {sum(len((b.get('outcomes') or {})) for b in obs['books'].values())} prices, "
            f"+{n} history points, cost {last}")
    if not any_ok:
        summary["skipped"] = "every outright request failed"
        log("[futures] no key succeeded; stamp left alone so a later run today can retry")
        return summary
    present = hardrock_seen(observations)
    summary["hardrock"] = present
    msg, stamp = note_hardrock(stamp, present, now)
    stamp.update(v=1, hourET=hour_et, lastDateET=_et(now).date().isoformat(), lastAt=_iso(now))
    save_json(stamp_path, stamp)
    _write_stamp_snap(snap_dir, stamp)
    if msg: log(msg)
    summary["pulled"] = True
    if out_dir:
        summary["published"] = write_site(out_dir, load_all(history_dir, now), now)
    return summary

def _write_stamp_snap(snap_dir, stamp):
    if not snap_dir: return
    save_json(os.path.join(snap_dir, "_futures", "_stamp.json"), stamp)

def apply_dir(snap_dir, history_dir, now=None):
    """Re-apply this run's futures snapshot onto a freshly fetched history/futures directory.

    Used when the data-history push loses a race. The tip's earlier prices stay;
    this run's points are appended only when they changed. The later stamp wins.
    """
    now = _utc(now)
    os.makedirs(history_dir, exist_ok=True)
    nfiles = 0
    for path in sorted(glob.glob(os.path.join(snap_dir, "*.json"))):
        name = os.path.basename(path)
        snap = load_json(path, None)
        if not snap: continue
        if name == "_stamp.json":
            dest = os.path.join(history_dir, "_stamp.json")
            save_json(dest, merge_stamp(load_json(dest, {}), snap))
            nfiles += 1
            continue
        key = snap.get("key") or name[:-5]
        spec = dict(ALLOW_BY_KEY.get(key) or {}, key=key, league=snap.get("league"),
                    title=snap.get("title"), subject=snap.get("subject"))
        dest = os.path.join(history_dir, f"{key}.json")
        hist = load_hist(dest, spec)
        apply_snap(hist, snap, now)
        if expired(hist, now):
            hist["outcomes"] = {}
            hist["board"] = None
            hist["dropped"] = True
        save_json(dest, hist)
        nfiles += 1
        print(f"[futures] merged {key}: outcomes {len(hist.get('outcomes') or {})}")
    print(f"[futures] apply merged {nfiles} file(s)")
    return nfiles
