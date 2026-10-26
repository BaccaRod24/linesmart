"""LineSmart UFC (MMA) data: event cards, bouts, DraftKings fighter moneylines and fighter form.

All sources are ESPN's free public JSON (no key):
  calendar   site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard            leagues[0].calendar (event ids, approx dates)
  card       sports.core.api.espn.com/v2/sports/mma/leagues/ufc/events/{eid}     bouts: cardSegment (Main Card / Prelims / Early Prelims),
                                                                                 matchNumber (1 = main event), weight class, rounds, start time
  names      site scoreboard ?dates=YYYYMMDD                                     fighter names, flags, records, status, broadcasts, judges' totals
  results    core .../competitions/{cid}/status                                  method (KO/TKO, Submission, Decision...), round, time
  odds       core .../competitions/{cid}/odds                                    DraftKings fighter moneylines (open + current) and total rounds O/U
  form       core /v2/sports/mma/athletes/{id}/eventlog + competition + status   each upcoming fighter's last 5 fights (cached by fight id)
ESPN has no free fight props (method of victory / round betting): .../odds/100/propBets returns 404, so none are shown.

Each bout becomes a LineSmart "game": away = the fighter ESPN lists first (order 1, the red corner), home = order 2, so the
existing line history, Hard Rock merge and bet tracker work unchanged. Weather, matchups and player props don't apply.
"""
import concurrent.futures as cf
import datetime as dt
import json
import os
import re
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
SITE_SB = "https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard"
CORE = "https://sports.core.api.espn.com/v2/sports/mma"
CORE_EV = CORE + "/leagues/ufc/events"
Q = "lang=en&region=us"
HEADSHOTS = "https://a.espncdn.com/i/headshots/mma/players/full/"
UPCOMING_EVENTS, UPCOMING_DAYS = 4, 45      # next 4 cards within 45 days
RECENT_EVENTS, RECENT_DAYS = 2, 21          # last 2 finished cards within 21 days (results)
FORM_DAYS, FORM_N = 21, 5                   # last-5 form for fighters on cards within 21 days (and recent cards)
CACHE_FILE = "ufc_fights.json"
SEGMENTS = {"main": "Main Card", "prelims1": "Prelims", "prelims2": "Early Prelims"}
SEG_ORDER = {"main": 0, "prelims1": 1, "prelims2": 2}

def _https(u): return re.sub(r"^http://", "https://", u or "")
def _q(u): return u + ("&" if "?" in u else "?") + Q if "lang=" not in u else u
def _iso(s):
    try: return dt.datetime.fromisoformat((s or "").replace("Z", "+00:00"))
    except ValueError: return None
def _ref_id(ref, kind):
    m = re.search(rf"/{kind}/(\d+)", ref or ""); return m.group(1) if m else None
def _num(v):
    try: return float(v)
    except (TypeError, ValueError): return None
def american(v):
    if v is None: return None
    s = str(v).strip().upper()
    if s in ("EVEN", "EV", "PK"): return 100
    try: return int(round(float(s)))
    except ValueError: return None

def rounds_of(desc, fmt=None):
    """'5 Rnd (5-5-5-5-5)' -> 5"""
    m = re.match(r"\s*(\d+)\s*Rnd", desc or "")
    if m: return int(m.group(1))
    return ((fmt or {}).get("regulation") or {}).get("periods")

def clock_secs(s):
    try: m, sec = str(s).split(":"); return int(m) * 60 + int(sec)
    except (ValueError, AttributeError): return None

def elapsed_rounds(rnd, clock, method=None, scheduled=None):
    """Fight length in rounds for total-rounds bets: 2:30 into round 2 = 1.5. Decisions go the distance."""
    if method and re.search(r"decision", method, re.I) and scheduled: return float(scheduled)
    c = clock_secs(clock)
    if not rnd or c is None: return None
    return round((int(rnd) - 1) + min(c, 300) / 300.0, 3)

# ---------------------------------------------------------------- parsing (pure; unit-tested with fixtures)
def pick_events(calendar, now, up_n=UPCOMING_EVENTS, up_days=UPCOMING_DAYS, past_n=RECENT_EVENTS, past_days=RECENT_DAYS):
    """calendar: scoreboard leagues[0].calendar -> [(event_id, label, startDate)] newest past first then upcoming soonest first."""
    rows = []
    for c in calendar or []:
        eid = _ref_id((c.get("event") or {}).get("$ref"), "events"); d = _iso(c.get("startDate"))
        if eid and d: rows.append((d, eid, c.get("label") or ""))
    rows.sort()
    # an event "starts" at its early prelims and runs ~7h: keep it in "upcoming" until then
    past = [r for r in rows if r[0] + dt.timedelta(hours=8) < now and r[0] >= now - dt.timedelta(days=past_days)][-past_n:]
    up = [r for r in rows if r[0] + dt.timedelta(hours=8) >= now and r[0] <= now + dt.timedelta(days=up_days)][:up_n]
    return [(eid, lab, d.isoformat()) for d, eid, lab in past + up]

def fighter_brief(c):
    """site-scoreboard competitor -> LineSmart team-like fighter record"""
    a = c.get("athlete") or {}
    flag = a.get("flag") or {}
    rec = next((r.get("summary") for r in c.get("records") or [] if r.get("name") in ("overall", "total") or r.get("type") == "total"), None)
    nm = a.get("displayName") or a.get("fullName") or ""
    last = nm.split(" ")[-1] if nm else ""
    short = a.get("shortName") or nm
    tot = None
    for ls in c.get("linescores") or []:
        if ls.get("value") is not None: tot = ls.get("value")
    return dict(id=str(c.get("id") or ""), abbr=last.upper()[:12] if last else "", name=nm, short=short, last=last,
                logo=flag.get("href"), country=flag.get("alt"), color=None, record=rec, winner=bool(c.get("winner")),
                order=c.get("order"), judges=tot)

def parse_odds(o, away_id, home_id):
    """core odds item (DraftKings) -> flat LineSmart odds; ESPN's home/away athlete odds are mapped by athlete id."""
    if not o: return None
    sides = {}
    for k in ("homeAthleteOdds", "awayAthleteOdds"):
        x = o.get(k) or {}
        aid = _ref_id((x.get("athlete") or {}).get("$ref"), "athletes")
        cur = american((((x.get("current") or {}).get("moneyLine")) or {}).get("american")) or american(x.get("moneyLine"))
        op = american((((x.get("open") or {}).get("moneyLine")) or {}).get("american"))
        if aid: sides[aid] = (cur, op)
    if away_id not in sides and home_id not in sides: return None
    a, h = sides.get(away_id, (None, None)), sides.get(home_id, (None, None))
    cur, op = o.get("current") or {}, o.get("open") or {}
    res = dict(provider=(o.get("provider") or {}).get("name") or "DraftKings", details=None,
               awayML=a[0], homeML=h[0], awayMLOpen=a[1], homeMLOpen=h[1],
               total=_num(o.get("overUnder")) if o.get("overUnder") is not None else _num(((cur.get("total") or {}).get("american"))),
               overOdds=american(o.get("overOdds")) or american(((cur.get("over") or {}).get("american"))),
               underOdds=american(o.get("underOdds")) or american(((cur.get("under") or {}).get("american"))),
               totalOpen=_num(((op.get("total") or {}).get("american"))),
               overOddsOpen=american(((op.get("over") or {}).get("american"))), underOddsOpen=american(((op.get("under") or {}).get("american"))))
    if res["awayML"] is None and res["homeML"] is None and res["total"] is None: return None
    return res

def parse_result(st, away, home, scheduled):
    """core status -> result dict for a finished bout (None while pre/live)."""
    t = (st or {}).get("type") or {}
    if not t.get("completed"): return None
    r = (st or {}).get("result") or {}
    method, detail = r.get("displayName") or r.get("shortDisplayName"), r.get("description") or r.get("displayDescription")
    if detail and method and detail.lower() == method.lower(): detail = None
    win = "away" if away.get("winner") else "home" if home.get("winner") else None
    rnd, clk = st.get("period"), st.get("displayClock")
    outcome = "win" if win else ("draw" if re.search(r"draw", f"{method} {t.get('name')}", re.I) else "nc")
    return dict(winner=win, outcome=outcome, method=method, detail=detail, round=rnd, clock=clk,
                status=t.get("name"), rounds=elapsed_rounds(rnd, clk, method, scheduled))

def bout_game(ev, comp, sb_comp, status, odds_item):
    """One bout -> LineSmart game dict. ev: core event; comp: core competition; sb_comp: site scoreboard competition (or None)."""
    order = {}
    for c in (sb_comp or {}).get("competitors") or []: order[c.get("order")] = fighter_brief(c)
    if not order:   # names unknown (scoreboard missing): ids only
        for c in comp.get("competitors") or []: order[c.get("order")] = dict(id=str(c.get("id")), abbr="", name="TBA", short="TBA", winner=bool(c.get("winner")), order=c.get("order"))
    away, home = order.get(1) or {}, order.get(2) or {}
    seg = (comp.get("cardSegment") or {}).get("name") or ""
    segName = SEGMENTS.get(seg) or (comp.get("cardSegment") or {}).get("description") or "Card"
    sched = rounds_of(comp.get("description"), comp.get("format"))
    sst = (sb_comp or {}).get("status") or {}
    stt = ((status or {}).get("type")) or sst.get("type") or {}
    v = comp.get("venue") or (sb_comp or {}).get("venue") or {}
    addr = v.get("address") or {}
    bc = []
    for b in (sb_comp or {}).get("broadcasts") or []: bc += b.get("names", [])
    wc = (comp.get("type") or {}).get("text") or ((sb_comp or {}).get("type") or {}).get("abbreviation")
    title = bool(re.search(r"title", " ".join(n.get("headline", "") for n in (sb_comp or {}).get("notes") or []), re.I))
    res = parse_result(status or sst, away, home, sched)
    state = stt.get("state") or "pre"
    detail = stt.get("shortDetail") or stt.get("detail")
    if state == "in": detail = f"R{(status or sst).get('period') or ''} {(status or sst).get('displayClock') or ''}".strip()
    odds = parse_odds(odds_item, away.get("id"), home.get("id"))
    for f in (away, home): f.setdefault("score", None)
    if res:  # 1/0 "score" so finished-bout moneylines grade like any other game
        away["score"], home["score"] = (1 if res["winner"] == "away" else 0), (1 if res["winner"] == "home" else 0)
    return dict(
        id=str(comp["id"]), date=comp.get("date") or ev.get("date"), name=f"{away.get('name')} vs. {home.get('name')}",
        shortName=f"{away.get('last') or away.get('short')} vs {home.get('last') or home.get('short')}",
        state=state, statusDetail=detail, completed=bool(stt.get("completed")),
        venue=v.get("fullName"), city=addr.get("city"), venueId=v.get("id"), venueState=addr.get("state"), venueCountry=addr.get("country"),
        indoor=True, neutral=False, broadcasts=bc, note=wc,
        away=away, home=home, odds=odds, oddsSource="ESPN core odds (DraftKings)" if odds else None,
        event=dict(id=str(ev.get("id")), name=ev.get("name"), short=ev.get("shortName")),
        segment=seg, segmentName=segName, matchNo=comp.get("matchNumber"), weightClass=wc, rounds=sched,
        mainEvent=comp.get("matchNumber") == 1, title=title, result=res,
    )

def event_summary(ev, bouts):
    states = {g["state"] for g in bouts}
    st = "in" if "in" in states else ("post" if states == {"post"} else "pre")
    segs = {}
    for g in bouts: segs.setdefault(g["segment"], g["date"])
    v = next((g for g in bouts if g.get("venue")), {})
    main = min(bouts, key=lambda g: g.get("matchNo") or 99) if bouts else None
    return dict(id=str(ev.get("id")), name=ev.get("name"), short=ev.get("shortName"), date=min((g["date"] for g in bouts), default=ev.get("date")),
                state=st, venue=v.get("venue"), city=v.get("city"), venueState=v.get("venueState"), venueCountry=v.get("venueCountry"),
                broadcasts=sorted({b for g in bouts for b in g.get("broadcasts") or []}),
                segments=[dict(key=k, name=SEGMENTS.get(k, k), start=segs[k]) for k in sorted(segs, key=lambda k: SEG_ORDER.get(k, 9))],
                bouts=[g["id"] for g in sorted(bouts, key=lambda g: (SEG_ORDER.get(g["segment"], 9), g.get("matchNo") or 99))],
                mainEvent=main["id"] if main else None, withOdds=sum(1 for g in bouts if g.get("odds")))

def form_entry(fid, comp, status, names):
    """core competition (+status) -> one fight in a fighter's history, from that fighter's point of view."""
    cs = comp.get("competitors") or []
    me = next((c for c in cs if str(c.get("id")) == str(fid)), None)
    op = next((c for c in cs if str(c.get("id")) != str(fid)), None)
    if not me: return None
    t = (status or {}).get("type") or {}
    if not t.get("completed"): return None
    r = (status or {}).get("result") or {}
    method = r.get("displayName") or r.get("shortDisplayName")
    if me.get("winner"): res = "W"
    elif op and op.get("winner"): res = "L"
    elif re.search(r"draw", f"{method}", re.I): res = "D"
    else: res = "NC"
    oid = str(op.get("id")) if op else None
    return dict(id=str(comp.get("id")), date=comp.get("date"), res=res, oppId=oid, opp=names.get(oid) if oid else None,
                method=method, detail=r.get("description"), round=(status or {}).get("period"), clock=(status or {}).get("displayClock"),
                wc=(comp.get("type") or {}).get("text"), event=_ref_id(comp.get("$ref"), "events"))

def search_doc(lg, games, gen):
    """data/search/ufc.json in the shared search format: 'teams' are weight classes, 'players' are fighters (pos = record)."""
    wcs, T, P, seen = {}, [], [], set()
    for g in sorted(games, key=lambda g: g["date"], reverse=True):
        wc = g.get("weightClass") or "MMA"
        if wc not in wcs:
            wcs[wc] = len(T); T.append([re.sub(r"[^a-z0-9]+", "-", wc.lower()), wc, wc, wc, "", "", "", "", 0])
        for s in ("away", "home"):
            f = g[s]
            if not f.get("id") or f["id"] in seen or not f.get("name") or f.get("name") == "TBA": continue
            seen.add(f["id"]); P.append([f["id"], f["name"], wcs[wc], f.get("record") or "", "", 1])
    return dict(v=1, lg=lg["key"], name=lg["name"], kind=lg["kind"], path=lg["path"], gen=gen, rostersAsOf=gen,
                scope="Fighters on the UFC cards in the data window", hs=HEADSHOTS, teams=T, players=P)

# ---------------------------------------------------------------- fetching
def _cache_load(d):
    try:
        with open(os.path.join(d, CACHE_FILE)) as fh: c = json.load(fh)
        if c.get("v") == 1: return c
    except (OSError, ValueError, TypeError): pass
    return dict(v=1, fights={}, names={})

def _cache_save(d, c):
    os.makedirs(d, exist_ok=True); p = os.path.join(d, CACHE_FILE); tmp = p + ".tmp"
    with open(tmp, "w") as fh: json.dump(c, fh, separators=(",", ":"))
    os.replace(tmp, p)

def fighter_form(fids, getj, cache, log=print, workers=12):
    """{fighter_id: [last FORM_N finished fights, newest first]} via eventlog -> competition + status (finished fights cached)."""
    calls = dict(n=0, err=0)
    def gj(u):
        calls["n"] += 1; return getj(u)
    def logs(fid):
        try: d = gj(f"{CORE}/athletes/{fid}/eventlog?{Q}")
        except Exception: calls["err"] += 1; return fid, []
        items = ((d.get("events") or {}).get("items")) or d.get("items") or []
        return fid, [_https((i.get("competition") or {}).get("$ref")) for i in items if i.get("played")]
    with cf.ThreadPoolExecutor(workers) as ex: refs = dict(ex.map(logs, fids))
    need = {}
    for fid, rs in refs.items():
        for r in rs[:FORM_N + 2]:   # a couple spare in case one has no result
            cid = _ref_id(r, "competitions")
            if cid and cid not in cache["fights"]: need[cid] = r
    def comp(cid_ref):
        cid, ref = cid_ref
        try:
            c = gj(_q(ref)); st = gj(_q(ref.split("?")[0] + "/status"))
            return cid, dict(c={k: c.get(k) for k in ("$ref", "id", "date", "type")} | {"competitors": [dict(id=str(x.get("id")), winner=x.get("winner")) for x in c.get("competitors") or []]},
                             s={k: st.get(k) for k in ("period", "displayClock", "type", "result")})
        except Exception: calls["err"] += 1; return cid, None
    with cf.ThreadPoolExecutor(workers) as ex:
        for cid, v in ex.map(comp, need.items()):
            if v and ((v["s"].get("type") or {}).get("completed")): cache["fights"][cid] = v
    opp = {x["id"] for v in cache["fights"].values() for x in v["c"]["competitors"]} - set(cache["names"])
    want_opp = set()
    for fid, rs in refs.items():
        for r in rs[:FORM_N + 2]:
            v = cache["fights"].get(_ref_id(r, "competitions"))
            if v: want_opp |= {x["id"] for x in v["c"]["competitors"] if x["id"] != str(fid)}
    def nm(aid):
        try: a = gj(f"{CORE}/athletes/{aid}?{Q}"); return aid, a.get("displayName") or a.get("fullName")
        except Exception: calls["err"] += 1; return aid, None
    with cf.ThreadPoolExecutor(workers) as ex:
        for aid, n in ex.map(nm, sorted(want_opp & opp)):
            if n: cache["names"][aid] = n
    out = {}
    for fid, rs in refs.items():
        h = []
        for r in rs:
            v = cache["fights"].get(_ref_id(r, "competitions"))
            if not v: continue
            e = form_entry(fid, v["c"], v["s"], cache["names"])
            if e: h.append(e)
            if len(h) >= FORM_N: break
        out[fid] = sorted(h, key=lambda e: e.get("date") or "", reverse=True)
    return out, calls

def fetch_card(eid, getj, log=print):
    """core event + matching site scoreboard + per-bout status and DraftKings odds -> (event, [game])"""
    ev = getj(f"{CORE_EV}/{eid}?{Q}")
    comps = ev.get("competitions") or []
    sb = {}
    d0 = _iso(min((c.get("date") or ev.get("date") for c in comps), default=ev.get("date")))
    tried = []
    for off in (0, -1, 1):   # ESPN keys the scoreboard by the card's local date
        if not d0: break
        day = (d0.astimezone(ET) + dt.timedelta(days=off)).strftime("%Y%m%d"); tried.append(day)
        try: data = getj(f"{SITE_SB}?dates={day}")
        except Exception: continue
        e = next((x for x in data.get("events") or [] if str(x.get("id")) == str(eid)), None)
        if e:
            sb = {str(c["id"]): c for c in e.get("competitions") or []}; break
    def per(c):
        base = f"{CORE_EV}/{eid}/competitions/{c['id']}"
        st = od = None
        try: st = getj(f"{base}/status?{Q}")
        except Exception: pass
        try:
            o = getj(f"{base}/odds?{Q}")
            od = next((i for i in o.get("items") or [] if str((i.get("provider") or {}).get("id")) == "100"), None) or (o.get("items") or [None])[0]
        except Exception: pass
        return c, st, od
    with cf.ThreadPoolExecutor(8) as ex: rows = list(ex.map(per, comps))
    games = [bout_game(ev, c, sb.get(str(c["id"])), st, od) for c, st, od in rows]
    return ev, games, dict(scoreboard="ok" if sb else f"missing (tried {tried})", bouts=len(games))

def build_ufc(lg, getj, out_dir, search_dir, LH, pull=None, odds_pull=None, odds_cache=None, apply_cached=None,
              hist_dir=None, snap_dir=None, run_t=None, cache_dir=None, log=print, now=None, odds_off_reason=None):
    import time
    t0 = time.time(); now = now or dt.datetime.now(dt.timezone.utc)
    report = dict(league=lg["key"], endpoints={})
    sb = getj(SITE_SB)
    cal = ((sb.get("leagues") or [{}])[0]).get("calendar") or []
    picks = pick_events(cal, now)
    report["endpoints"]["calendar"] = f"ok ({len(cal)} events listed, {len(picks)} in window)"
    events, games, errs = [], [], []
    with cf.ThreadPoolExecutor(3) as ex:
        futs = {ex.submit(fetch_card, eid, getj, log): eid for eid, _, _ in picks}
        for f in cf.as_completed(futs):
            try:
                ev, gs, rep = f.result()
                if gs: events.append(event_summary(ev, gs)); games += gs
                report["endpoints"][f"event {futs[f]}"] = rep
            except Exception as e: errs.append(f"{futs[f]}: {str(e)[:80]}")
    if errs: report["endpoints"]["eventErrors"] = errs[:4]
    events.sort(key=lambda e: e["date"]); games.sort(key=lambda g: (g["date"], -(g.get("matchNo") or 0)))
    for g in games:
        g["books"] = {"draftkings": dict(g["odds"], source="ESPN (DraftKings)")} if g.get("odds") else {}
    # The Odds API (Hard Rock Bet): only when the ODDS_MMA flag is on; otherwise no credits are ever spent on UFC
    run_t = run_t or LH.now_iso()
    if pull and odds_pull:
        entry, msg = odds_pull(lg, games, pull, run_t)
        if entry is not None and odds_cache is not None: odds_cache["leagues"][lg["key"]] = entry
        report["oddsApi"] = msg
    else:
        report["oddsApi"] = odds_off_reason or "not a pull run (using last persisted Hard Rock pull)"
    if apply_cached:
        fresh, stale = apply_cached(lg, games, odds_cache, now)
        report["hardrock"] = dict(shown=fresh, stale=stale)
    # line movement (DraftKings moneylines / total rounds) through the shared line-history store
    snap = LH.snapshot_from_games(games)
    if snap_dir:
        os.makedirs(snap_dir, exist_ok=True)
        with open(os.path.join(snap_dir, f"{lg['key']}.json"), "w") as fh: json.dump(dict(league=lg["key"], t=run_t, games=snap), fh)
    if hist_dir:
        hpath = os.path.join(hist_dir, f"{lg['key']}.json")
        hist = LH.load(hpath, lg["key"]); added = LH.merge(hist, snap, run_t); pruned = LH.prune(hist); LH.save(hpath, hist)
        report["history"] = f"+{added} points, pruned {pruned}, tracking {len(hist['games'])} bouts"
    else:
        hist = dict(games={}); LH.merge(hist, snap, run_t); report["history"] = "no history dir (ESPN open line only)"
    for g in games:
        gh = hist["games"].get(g["id"])
        g["move"] = LH.summarize(gh, lg["kind"], lg["key"]) if gh else None
    # fighter form: last 5 for everyone on a card in the next FORM_DAYS days, plus the recent (finished) cards
    cache = _cache_load(cache_dir) if cache_dir else dict(v=1, fights={}, names={})
    soon = now + dt.timedelta(days=FORM_DAYS)
    fids = sorted({g[s]["id"] for g in games if g["state"] == "post" or (_iso(g["date"]) or now) <= soon for s in ("away", "home") if g[s].get("id")})
    try:
        form, calls = fighter_form(fids, getj, cache, log)
        report["endpoints"]["fighterForm"] = f"{len(form)} fighters, {calls['n']} calls, {calls['err']} errors, {len(cache['fights'])} fights cached"
    except Exception as e:
        form = {}; report["endpoints"]["fighterForm"] = f"failed: {str(e)[:100]}"
    if cache_dir:
        try: _cache_save(cache_dir, cache)
        except OSError as e: log(f"[ufc] fight cache not saved: {e}")
    for g in games:
        for s in ("away", "home"):
            h = form.get(g[s].get("id"))
            g[s]["form"] = "".join(e["res"][0] for e in reversed(h)) if h else ""   # oldest -> newest, like team form
    fighters = {}
    for g in sorted(games, key=lambda g: g["date"]):
        for s in ("away", "home"):
            f = g[s]
            if not f.get("id"): continue
            e = fighters.setdefault(f["id"], dict(id=f["id"], name=f.get("name"), short=f.get("short"), flag=f.get("logo"), country=f.get("country"), bouts=[]))
            e.update(record=f.get("record") or e.get("record"), wc=g.get("weightClass"))
            e["bouts"].append(g["id"])
            if f["id"] in form: e["hist"] = form[f["id"]]
    # write
    ldir = os.path.join(out_dir, lg["key"]); gdir = os.path.join(ldir, "games"); os.makedirs(gdir, exist_ok=True)
    for fn in os.listdir(gdir): os.remove(os.path.join(gdir, fn))
    by_ev = {e["id"]: e for e in events}
    for g in games:
        ev = by_ev.get(g["event"]["id"]) or {}
        fx = {g[s]["id"]: fighters.get(g[s]["id"]) for s in ("away", "home") if g[s].get("id")}
        with open(os.path.join(gdir, f"{g['id']}.json"), "w") as fh:
            json.dump(dict(league=lg["key"], game=g, detail={}, teams={}, fighters=fx, event=ev, hasSummary=False,
                           history=hist["games"].get(g["id"])), fh, separators=(",", ":"))
    with open(os.path.join(ldir, "fighters.json"), "w") as fh:
        json.dump(dict(generated=now.isoformat(), formDays=FORM_DAYS, fighters=fighters), fh, separators=(",", ":"))
    upcoming = sum(1 for g in games if g["state"] == "pre"); with_odds = sum(1 for g in games if g.get("odds"))
    providers = sorted({g["odds"]["provider"] for g in games if g.get("odds")})
    report.update(games=len(games), upcoming=upcoming, withOdds=with_odds, providers=providers, events=len(events),
                  fightProps="none (ESPN has no free method/round props)", seconds=round(time.time() - t0, 1))
    idx = dict(league={k: lg[k] for k in ("key", "name", "full", "kind")}, generated=now.isoformat(), windowDays=UPCOMING_DAYS,
               games=games, teams={}, events=events, report=report)
    with open(os.path.join(ldir, "index.json"), "w") as fh: json.dump(idx, fh, separators=(",", ":"))
    # search: fighters on these cards
    try:
        doc = search_doc(lg, games, now.isoformat()); os.makedirs(search_dir, exist_ok=True)
        raw = json.dumps(doc, separators=(",", ":"), ensure_ascii=False)
        with open(os.path.join(search_dir, f"{lg['key']}.json"), "w") as fh: fh.write(raw)
        report["search"] = dict(teams=len(doc["teams"]), players=len(doc["players"]), bytes=len(raw.encode()))
    except Exception as e:
        report["search"] = dict(error=str(e)[:200])
    log(f"[{lg['key']}] events={len(events)} bouts={len(games)} upcoming={upcoming} withOdds={with_odds} providers={providers} "
        f"oddsApi={report['oddsApi']} history={report['history']} form={report['endpoints'].get('fighterForm')} ({report['seconds']}s)")
    return report
