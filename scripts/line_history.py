#!/usr/bin/env python3
"""
LineSmart line-movement history (Python 3 stdlib only).

Storage: one JSON file per league, history/<league>.json, kept on the `data-history`
git branch (not main). Each refresh run appends a point for a book ONLY WHEN that
book's line changed since its last stored point (change-only encoding). The run
time is always recorded in `lastSeen`, so "unchanged since X" is still known and
the files stay small (a full NCAAB slate would otherwise be ~200 games x 48 runs/day).

File format (v1):
{
  "v": 1, "league": "nfl", "updated": "<UTC iso>",
  "games": {
    "<espn event id>": {
      "date": "<start UTC>", "home": "SEA", "away": "KC",
      "firstSeen": "<UTC>", "lastSeen": "<UTC>",
      "open":  {"draftkings": {..same keys as a point..}},      # opening line (ESPN, side-checked)
      "books": {"draftkings": [["<UTC>", {"hs": -3, "as": 3, "hso": -110, "aso": -110,
                                         "hml": -162, "aml": 136, "dml": null,
                                         "tot": 43.5, "ov": -110, "un": -110}], ...]}
    }
  }
}
Keys: hs/as = home/away spread, hso/aso = spread prices, hml/aml/dml = moneylines
(home/away/draw), tot = total, ov/un = over/under prices.

Pruning: games that started more than PRUNE_DAYS ago, or were last seen more than
PRUNE_DAYS ago (postponed / dropped from the window), are removed.

CLI (used by the workflow to re-apply a run's snapshot onto a freshly fetched
history branch if the first push lost a race):
    python3 scripts/line_history.py apply --snap-dir .linehist-snap --history-dir _history/history
"""
import argparse, datetime as dt, glob, json, os

PRUNE_DAYS = 3
FIELDS = {"hs": "homeSpread", "as": "awaySpread", "hso": "homeSpreadOdds", "aso": "awaySpreadOdds",
          "hml": "homeML", "aml": "awayML", "dml": "drawML", "tot": "total", "ov": "overOdds", "un": "underOdds"}
OPEN_FIELDS = {"hs": "homeSpreadOpen", "as": "awaySpreadOpen", "hml": "homeMLOpen", "aml": "awayMLOpen",
               "dml": "drawMLOpen", "tot": "totalOpen"}
BOOK_ORDER = ["draftkings", "hardrockbet", "fanduel"]
# ESPN's opening total for basketball is sometimes a stale number that never traded.
# Totals we actually record sit within 2 points of a real open. Farther than this, the
# ESPN figure is dropped for the first total the snapshots recorded.
BASKETBALL_TOTAL_OPEN_GAP = 4
# ESPN's DraftKings "open" is sometimes an early-season or futures price that never
# trades in the snapshots. The spread and the moneyline still agree with each other,
# so it looks like a favorite that really flipped.
# A spread more than a field goal from every recorded spread did not trade. Exactly
# 3 points with one snapshot is a normal move before tracking starts (Chiefs at
# Broncos, Knicks at Sixers). Exactly 3 across a longer series never showed up
# (Tulane at Rice). Football totals move that far before the first snapshot, so a
# total has to sit more than 6 points from every recorded total; 6 is still a real
# pre-snapshot move. Basketball totals stay at 4. Other leagues use 4.
# Michigan at Oregon got within 2 of the ESPN spread but the 53.5 total never came
# within 9. That pair is one stale open: the spread is more than a field goal off
# the first snapshot and never within a point and a half of a recorded spread.
STALE_SPREAD_GAP = 3.0
STALE_SPREAD_NEAR = 1.5
STALE_TOTAL_GAP = {"football": 6.0, "basketball": BASKETBALL_TOTAL_OPEN_GAP}
STALE_TOTAL_DEFAULT = 4.0
# An opening spread copied from an earlier game of the same team. If it sits at least
# this far from every spread recorded for this game, it never traded here.
CARRIED_OPEN_GAP = 1.0
# ESPN sometimes exchanges home and away on the whole opener. The swapped prices are
# the first recorded line, give or take a cent of juice (DAL @ SA: open +503 vs +502).
# Farther than this, the favorite really changed and the opener is left alone.
FLIPPED_OPEN_ML_CENTS = 2
# Game id -> opener (home spread, home ML, away ML, total) proven, from the history
# file, to be an earlier game's opener rather than a line this game traded.
# 401873037 (Jaguars at Ravens, Week 9) carried 401873028 (Colts at Jaguars, Week 8)
# from the first snapshot (745ee9329f, 2026-10-27T19:48:34Z). The source game is
# pruned 3 days after its Nov 1 kickoff, so the copy has to be recognizable without it.
PROVEN_CARRIED_OPEN = {
    "401873037": (-4.5, -218, 180, 49.5),
}
LEAGUE_KIND = {"nfl": "football", "ncaaf": "football", "nba": "basketball", "ncaab": "basketball",
               "nhl": "hockey", "mlb": "baseball", "epl": "soccer", "mls": "soccer", "ucl": "soccer", "ufc": "mma"}
OPEN_TO_GAME = {"hs": "homeSpreadOpen", "as": "awaySpreadOpen", "hml": "homeMLOpen", "aml": "awayMLOpen",
                "dml": "drawMLOpen", "tot": "totalOpen"}

def league_kind(league):
    return LEAGUE_KIND.get(league or "", "")

def _spread_side(hs):
    """Which side is laying points. A pick'em (0) and a missing number have no side."""
    if hs is None or hs == 0: return None
    return "home" if hs < 0 else "away"

def _ml_side(hml, aml):
    """Which moneyline is the favorite. Even prices and a missing price have no side."""
    ih, ia = implied(hml), implied(aml)
    if ih is None or ia is None or abs(ih - ia) < 1e-9: return None
    return "home" if ih > ia else "away"

def _same_number(a, b):
    if a is None or b is None: return True
    return abs(float(a) - float(b)) < 0.001

def _swap_home_away_open(op):
    """Exchange the home and away opening spread and moneyline. The total stays."""
    out = dict(op)
    hs, as_ = out.get("hs"), out.get("as")
    if hs is not None and as_ is not None:
        out["hs"], out["as"] = as_, hs
    elif hs is not None:
        out["hs"] = -hs
    elif as_ is not None:
        out["as"] = -as_
    if out.get("hml") is not None or out.get("aml") is not None:
        out["hml"], out["aml"] = out.get("aml"), out.get("hml")
    return out

def _sides_flipped(op, first):
    """Both the spread sign and the moneyline favorite are opposite the first point."""
    sp, ml = _spread_side(op.get("hs")), _ml_side(op.get("hml"), op.get("aml"))
    fsp, fml = _spread_side(first.get("hs")), _ml_side(first.get("hml"), first.get("aml"))
    return bool(sp and ml and fsp and fml and sp != fsp and ml != fml)

def _open_matches(op, first):
    """Same spread and both moneylines, allowing FLIPPED_OPEN_ML_CENTS of juice."""
    if op.get("hs") is None or first.get("hs") is None: return False
    if not _same_number(op.get("hs"), first.get("hs")): return False
    if not _same_number(op.get("as"), first.get("as")): return False
    for k in ("hml", "aml"):
        if op.get(k) is None or first.get(k) is None: return False
        if abs(ml_cents(op[k], first[k])) > FLIPPED_OPEN_ML_CENTS: return False
    return True

def _still_inconsistent(op, first):
    """Spread and moneyline disagree, or either side is still opposite the first point."""
    sp, ml = _spread_side(op.get("hs")), _ml_side(op.get("hml"), op.get("aml"))
    fsp, fml = _spread_side(first.get("hs")), _ml_side(first.get("hml"), first.get("aml"))
    if sp and ml and sp != ml: return True
    if sp and fsp and sp != fsp: return True
    if ml and fml and ml != fml: return True
    return False

def reconcile_open(op, points=None, kind=""):
    """Correct one book's opening line using that book's recorded snapshots.

    ESPN sometimes stores the opening spread on the wrong side: home gets the away
    number (the signs flip) while the opening moneyline stays with the right team.
    A team is not a spread favorite and a moneyline dog at the same open. When those
    disagree, and the first recorded spread agrees with the moneyline (or we have no
    recorded spread yet), the two opening spreads are swapped.

    ESPN also sometimes exchanges home and away on the whole opener, so the spread
    sign and the moneyline favorite are both the opposite of the first recorded
    point (DAL @ SA, 401909933: open SA +12.5 and +503/-700, first point SA -12.5
    and -700/+502). When the swapped prices are that first point, the home and away
    openers are exchanged. The same check runs for every sport. If the swap still
    leaves the spread and the moneyline inconsistent, the first recorded point is
    used instead. A favorite that really flipped, where the opener agrees with
    itself and the prices are not that first point on the other side, is left alone.

    A basketball opening total that is more than BASKETBALL_TOTAL_OPEN_GAP points
    from every recorded total never traded in the snapshots. It is replaced with the
    first total those snapshots recorded. The same check runs for every league.
    Football uses a wider gap (STALE_TOTAL_GAP), because a total can move 6 points
    before the first snapshot.

    An opening spread that never lands on a recorded spread is the same kind of
    stale number (Tennessee at Texas A&M: ESPN TA&M -9.5, first snapshot TENN -3).
    The first recorded snapshot replaces that open, including its moneyline and,
    when the spread itself never traded, its total. A spread the snapshots do
    trade is left alone even if the total on that open is replaced. A real move
    whose open matches the first snapshot (Oregon State at Boise State) is unchanged.
    """
    if not op: return op
    out = dict(op)
    points = [p for p in (points or []) if isinstance(p, dict)]
    sp, ml = _spread_side(out.get("hs")), _ml_side(out.get("hml"), out.get("aml"))
    if sp and ml and sp != ml:
        series_sp = next((s for s in (_spread_side(p.get("hs")) for p in points) if s), None)
        if series_sp is None or series_sp == ml:
            hs, as_ = out.get("hs"), out.get("as")
            if hs is not None and as_ is not None:
                out["hs"], out["as"] = as_, hs
            elif hs is not None:
                out["hs"] = -hs
            elif as_ is not None:
                out["as"] = -as_
    first = next((p for p in points if p.get("hs") is not None or p.get("hml") is not None), None)
    if first and _sides_flipped(out, first):
        swapped = _swap_home_away_open(out)
        if _open_matches(swapped, first):
            out = swapped
        elif _still_inconsistent(swapped, first):
            out = adopt_first_open(out, first)
    if _spread_is_stale(out, points, kind) and first:
        out = adopt_first_open(out, first)
    if _total_is_stale(out, points, kind):
        observed = [p["tot"] for p in points if p.get("tot") is not None]
        if observed:
            out["tot"] = observed[0]
    return out

def _num_gap(val, observed):
    """(distance to the nearest recorded value, distance to the first). None if either side is missing."""
    if val is None or not observed:
        return None
    dists = [abs(float(val) - float(v)) for v in observed]
    return min(dists), dists[0]

def _total_limit(kind):
    return STALE_TOTAL_GAP.get(kind, STALE_TOTAL_DEFAULT)

def _total_is_stale(op, points, kind):
    """True when the opening total never comes within the league gap of a recorded total."""
    gap = _num_gap(op.get("tot") if isinstance(op, dict) else None,
                   [p.get("tot") for p in points if isinstance(p, dict) and p.get("tot") is not None])
    return bool(gap) and gap[0] > _total_limit(kind)

def _spread_is_stale(op, points, kind):
    """True when the opening spread never traded in this book's snapshots.

    More than STALE_SPREAD_GAP from every snapshot, or exactly that far across two
    or more snapshots. Also a futures pair: more than a field goal off the first
    snapshot, never within STALE_SPREAD_NEAR, and the total on that open never traded.
    """
    observed = [p.get("hs") for p in points if isinstance(p, dict) and p.get("hs") is not None]
    gap = _num_gap(op.get("hs") if isinstance(op, dict) else None, observed)
    if not gap:
        return False
    nearest, first_gap = gap
    if nearest > STALE_SPREAD_GAP:
        return True
    if nearest >= STALE_SPREAD_GAP and len(observed) >= 2:
        return True
    if first_gap > STALE_SPREAD_GAP and nearest > STALE_SPREAD_NEAR and _total_is_stale(op, points, kind):
        return True
    return False

def _open_sig(op):
    """Spread, both moneylines, and total. None unless all four are present."""
    if not isinstance(op, dict): return None
    keys = ("hs", "hml", "aml", "tot")
    if any(op.get(k) is None for k in keys): return None
    return tuple(op[k] for k in keys)

def _spread_near(op, series, gap):
    """True when the open spread is within gap of some recorded spread, or we cannot tell."""
    hs = op.get("hs") if isinstance(op, dict) else None
    obs = [p.get("hs") for p in series if isinstance(p, dict) and p.get("hs") is not None]
    if hs is None or not obs: return True
    return min(abs(float(hs) - float(s)) for s in obs) < gap

def adopt_first_open(op, first):
    """Opening numbers from the first recorded point. Spread prices are not part of the open."""
    out = dict(op or {})
    if not isinstance(first, dict): return out
    for k in ("hs", "as", "hml", "aml", "dml", "tot"):
        if first.get(k) is not None: out[k] = first[k]
    if out.get("hs") is not None and out.get("as") is None: out["as"] = -out["hs"]
    elif out.get("as") is not None and out.get("hs") is None: out["hs"] = -out["as"]
    return out

def keep_recorded_open(prev, new, series, gap=CARRIED_OPEN_GAP):
    """Keep a stored open that is the first recorded spread when the incoming one never traded.

    A carried opener is corrected once. Later refreshes send the same ESPN number again,
    including after prune() has dropped the earlier game the number was copied from.
    """
    if not prev or not series: return False
    first = series[0]
    if not isinstance(first, dict) or first.get("hs") is None or prev.get("hs") != first.get("hs"):
        return False
    return not _spread_near(new, series, gap)

def fix_carried_opens(hist, gap=CARRIED_OPEN_GAP):
    """Replace an opener that is an exact copy of an earlier game sharing a team.

    ESPN has left last week's opener (home spread, both moneylines, and total) on the
    next game. Week 9 Jaguars at Ravens carried Week 8 Colts at Jaguars: -4.5, -218,
    +180, 49.5, while every recorded Jaguars-Ravens spread was at least 1.5 points away.
    The first recorded line of this game is used instead. A copy that this game actually
    traded (within `gap` points) is left alone, and so is a matching number on a game
    that shares no team.

    Returns [(game id, book, before, after), ...] and updates hist in place.
    """
    games = hist.get("games") or {}
    changes = []
    for gid, g in games.items():
        teams = {g.get("home"), g.get("away")} - {None, ""}
        date = g.get("date") or ""
        if not teams or not date: continue
        for bk, op in list((g.get("open") or {}).items()):
            series = [p[1] for p in (g.get("books") or {}).get(bk) or []
                      if isinstance(p, list) and len(p) > 1 and isinstance(p[1], dict)]
            sig = _open_sig(op)
            if not series or sig is None or _spread_near(op, series, gap): continue
            carried = PROVEN_CARRIED_OPEN.get(gid) == sig
            if not carried:
                for oid, og in games.items():
                    if oid == gid or (og.get("date") or "") >= date: continue
                    oteams = {og.get("home"), og.get("away")} - {None, ""}
                    if not (teams & oteams): continue
                    if _open_sig((og.get("open") or {}).get(bk)) == sig:
                        carried = True
                        break
            if not carried: continue
            before, new = dict(op), adopt_first_open(op, series[0])
            if new == before: continue
            g["open"][bk] = new
            changes.append((gid, bk, before, new))
    return changes

def stamp_open(game, op):
    """Copy a reconciled DraftKings open onto the odds objects the line card reads."""
    if not op: return
    targets = []
    books = game.get("books") or {}
    dk = books.get("draftkings")
    if isinstance(dk, dict): targets.append(dk)
    odds = game.get("odds")
    if isinstance(odds, dict):
        prov = "".join(c for c in (odds.get("provider") or "").lower() if c.isalpha())
        if "draftkings" in prov or dk is None: targets.append(odds)
    for t in targets:
        for k, src in OPEN_TO_GAME.items():
            if op.get(k) is not None: t[src] = op[k]

def now_iso():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

def _p(iso):
    return dt.datetime.fromisoformat(iso.replace("Z", "+00:00"))

def compact(o, fields=FIELDS):
    out = {k: o.get(src) for k, src in fields.items() if o.get(src) is not None}
    return out or None

def snapshot_from_games(games):
    """{game_id: {date, home, away, books:{book: point}, open:{book: openpoint}}} for pre-game lines."""
    snap = {}
    for g in games:
        if g.get("state") != "pre": continue          # in-play / final lines aren't line movement
        books, opens, bt = {}, {}, {}
        for bk, o in (g.get("books") or {}).items():
            if o.get("stale"): continue
            pt = compact(o)
            if pt: books[bk] = pt
            if pt and o.get("asOf"): bt[bk] = o["asOf"]      # persisted pull (Hard Rock): record at pull time, once
            op = compact(o, OPEN_FIELDS)
            if op: opens[bk] = op
        o = g.get("odds")
        if o and books:                                   # Odds API may have replaced the ESPN entry: keep ESPN's open
            pk = "".join(c for c in (o.get("provider") or "").lower() if c.isalpha())
            for bk in books:
                if bk not in opens and bk.replace("bet", "") in pk:
                    op = compact(o, OPEN_FIELDS)
                    if op: opens[bk] = op
        if not books and o:                               # ESPN provider that isn't a target book
            bk = "espn-" + "".join(c for c in (o.get("provider") or "unknown").lower() if c.isalnum())
            pt = compact(o)
            if pt: books[bk] = pt
            op = compact(o, OPEN_FIELDS)
            if op: opens[bk] = op
        if books:
            snap[g["id"]] = dict(date=g["date"], home=(g.get("home") or {}).get("abbr"), away=(g.get("away") or {}).get("abbr"),
                                 books=books, open=opens, **({"bt": bt} if bt else {}))
    return snap

def load(path, league):
    try:
        with open(path) as fh: h = json.load(fh)
        if h.get("v") == 1 and isinstance(h.get("games"), dict): return h
    except (OSError, ValueError):
        pass
    return dict(v=1, league=league, updated=None, games={})

def merge(hist, snap, t):
    """Append changed points from one run's snapshot (taken at UTC time t). Returns #points appended.

    The opening line is reconciled after the points are updated, so a bad ESPN open
    (spread on the wrong side, home and away exchanged together, a total that never
    appears in the snapshots, an opener copied from an earlier game of the same team,
    or an early-season spread that never trades) is corrected from those snapshots
    on the way in. A later run that sends the same bad open is corrected again; it
    does not stick, including after the source game has been pruned.
    """
    added = 0
    kind = league_kind(hist.get("league"))
    for gid, s in snap.items():
        g = hist["games"].setdefault(gid, dict(date=s["date"], home=s.get("home"), away=s.get("away"), firstSeen=t, lastSeen=t, open={}, books={}))
        g.update(date=s["date"], home=s.get("home"), away=s.get("away"))
        if t > (g.get("lastSeen") or ""): g["lastSeen"] = t
        for bk, pt in s["books"].items():
            tb = (s.get("bt") or {}).get(bk) or t         # per-book observation time (e.g. Hard Rock pull time)
            pts = g["books"].setdefault(bk, [])
            if pts and pts[-1][0] >= tb:                  # already have this (or a newer) observation
                continue
            if not pts or pts[-1][1] != pt:
                pts.append([tb, pt]); added += 1
        for bk, op in (s.get("open") or {}).items():
            series = [p[1] for p in g["books"].get(bk, [])]
            prev = g["open"].get(bk)
            new = reconcile_open(op, series, kind)
            if keep_recorded_open(prev, new, series): new = prev
            g["open"][bk] = new
    fix_carried_opens(hist)
    hist["updated"] = max(hist.get("updated") or "", t)
    return added

def prune(hist, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    cut = now - dt.timedelta(days=PRUNE_DAYS)
    drop = [gid for gid, g in hist["games"].items()
            if _p(g["date"]) < cut or _p(g.get("lastSeen") or g["date"]) < cut]
    for gid in drop: del hist["games"][gid]
    return len(drop)

def save(path, hist):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as fh: json.dump(hist, fh, separators=(",", ":"), sort_keys=True)
    os.replace(tmp, path)

# ---------------------------------------------------------------- movement summary for the site
# American odds jump from -100 to +100, so cur - open inflates any move across even money by 200
# (-110 -> +114 is +24 cents, not +224). flat() puts both sides on one cent scale.
ML_MIN_CENTS = 15   # same bar the "what to watch" note uses: smaller than this is noise around even money

def flat(x):
    """American odds on a continuous cent scale. -110 and +110 are 20 apart, not 220."""
    return x + 100 if x < 0 else x - 100

def ml_cents(open_, cur):
    """Signed moneyline move in cents. -110 -> +114 is +24; +100 and -100 are the same price."""
    d = flat(cur) - flat(open_)
    r = round(d)
    return int(r) if abs(d - r) < 1e-6 else round(d, 2)

def implied(a):
    """Implied win probability of an American price (includes the book's margin). None for a missing price."""
    if a is None or a == 0:
        return None
    a = float(a)
    return 100.0 / (a + 100.0) if a > 0 else -a / (-a + 100.0)

def ml_prob_pts(open_, cur):
    """Change in implied win probability, in percentage points. -110 -> +114 is about -5.7."""
    po, pc = implied(open_), implied(cur)
    if po is None or pc is None:
        return None
    return (pc - po) * 100.0

def move_delta(open_, cur, ml=False):
    """Signed move. Moneyline uses cents; spreads and totals use the raw number."""
    return ml_cents(open_, cur) if ml else cur - open_

def biggest(open_, values, ml=False):
    """The price farthest from open. Moneyline distance is cents, so +100 doesn't beat -140 off a -105 open."""
    return max(values, key=lambda v: abs(move_delta(open_, v, ml)))

def _primary(gh):
    ks = list((gh.get("books") or {}).keys())
    for k in BOOK_ORDER:
        if k in ks: return k
    return ks[0] if ks else None

def _crossed(a, b, k):
    """True if |line| went across (or onto/off) key number k."""
    a, b = abs(a), abs(b)
    return (a - k) * (b - k) < 0 or (a != b and (a == k or b == k))

SPARK_MAX = 24   # points per sparkline series in index.json (tiles); the full series stays in the game file

def spark(series, n=SPARK_MAX):
    """Down-sample a value series to at most n points (first and last kept) for the tile sparklines."""
    if len(series) <= n: return list(series)
    step = (len(series) - 1) / (n - 1)
    return [series[round(i * step)] for i in range(n)]

def summarize(gh, kind, league):
    """Open / current / biggest-move summary for the primary book. gh: history entry (may be just this run)."""
    bk = _primary(gh)
    if not bk: return None
    pts = gh["books"][bk]; op = (gh.get("open") or {}).get(bk) or {}
    cur = pts[-1][1]
    out = dict(book=bk, since=pts[0][0], points=len(pts))
    for key, label in (("hs", "spread"), ("tot", "total"), ("hml", "homeML"), ("aml", "awayML")):
        series = [p[1].get(key) for p in pts if p[1].get(key) is not None]
        o = op.get(key)
        o = o if o is not None else (series[0] if series else None)
        c = cur.get(key)
        if o is None or c is None: continue
        ml = key in ("hml", "aml")
        big = biggest(o, series + [c], ml)          # raw |cur-open| picks the even-money crossing, not the real move
        delta = ml_cents(o, c) if ml else round(c - o, 2)
        out[label] = dict(open=o, cur=c, delta=delta, maxMove=ml_cents(o, big) if ml else round(big - o, 2))
        if label in ("spread", "total"):   # opening line first (ESPN's open can predate the tracked points), then the tracked series
            sp = ([o] if series and series[0] != o else []) + series
            if len(sp) >= 2: out.setdefault("spark", {})[label] = spark(sp)
    notes = []
    sp, tt = out.get("spread"), out.get("total")
    if sp and kind in ("football", "basketball"):
        if abs(sp["delta"]) >= 1.5: notes.append(f"Spread moved {abs(sp['delta']):g} pts")
        if league in ("nfl", "ncaaf"):
            for k in (3, 7):
                if _crossed(sp["open"], sp["cur"], k): notes.append(f"Crossed key number {k}"); break
    if tt:
        thr = {"football": 2, "basketball": 3}.get(kind, 0.5)
        if abs(tt["delta"]) >= thr: notes.append(f"Total moved {abs(tt['delta']):g}")
    out["notable"] = notes
    return out

def apply_dir(snap_dir, history_dir):
    for f in sorted(glob.glob(os.path.join(snap_dir, "*.json"))):
        s = json.load(open(f)); lg = s["league"]
        path = os.path.join(history_dir, f"{lg}.json")
        h = load(path, lg); n = merge(h, s["games"], s["t"]); pr = prune(h); save(path, h)
        print(f"[{lg}] +{n} points, pruned {pr}, games {len(h['games'])}")

def apply_odds(src_dir, dst_dir):
    """Merge a run's persisted-pull snapshot (hardrockbet.json game lines, props_oddsapi.json props) into the branch copy:
    newer pulledAt per league wins; quota/usage: newer t wins."""
    for f in sorted(glob.glob(os.path.join(src_dir, "*.json"))):
        src = json.load(open(f)); path = os.path.join(dst_dir, os.path.basename(f))
        try: dst = json.load(open(path))
        except (OSError, ValueError): dst = dict(v=1, book=src.get("book"), leagues={}, checks=[])
        for lg, e in (src.get("leagues") or {}).items():
            if (e.get("pulledAt") or "") > ((dst["leagues"].get(lg) or {}).get("pulledAt") or ""): dst["leagues"][lg] = e
        seen = {json.dumps(c, sort_keys=True) for c in dst.get("checks") or []}
        dst["checks"] = sorted((dst.get("checks") or []) + [c for c in src.get("checks") or [] if json.dumps(c, sort_keys=True) not in seen],
                               key=lambda c: c.get("t") or "")[-200:]
        for k in ("quota", "usage"):   # paid-plan budget state: the newer run's copy wins
            if isinstance(src.get(k), dict) and (src[k].get("t") or "") > ((dst.get(k) or {}).get("t") or ""): dst[k] = src[k]
        pulls = [e.get("pulledAt") for e in dst["leagues"].values() if e.get("pulledAt")]
        dst["updated"] = max(pulls) if pulls else None
        os.makedirs(dst_dir, exist_ok=True); tmp = path + ".tmp"
        with open(tmp, "w") as fh: json.dump(dst, fh, indent=1, sort_keys=True)
        os.replace(tmp, path); print(f"[odds] merged {os.path.basename(f)}: leagues {sorted(src.get('leagues') or {})}")

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("apply"); a.add_argument("--snap-dir", required=True); a.add_argument("--history-dir", required=True)
    o = sub.add_parser("apply-odds"); o.add_argument("--src", required=True); o.add_argument("--dst", required=True)
    args = ap.parse_args()
    if args.cmd == "apply": apply_dir(args.snap_dir, args.history_dir)
    elif args.cmd == "apply-odds": apply_odds(args.src, args.dst)
