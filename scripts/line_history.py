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

def reconcile_open(op, points=None, kind=""):
    """Correct one book's opening line using that book's recorded snapshots.

    ESPN sometimes stores the opening spread on the wrong side: home gets the away
    number (the signs flip) while the opening moneyline stays with the right team.
    A team is not a spread favorite and a moneyline dog at the same open. When those
    disagree, and the first recorded spread agrees with the moneyline (or we have no
    recorded spread yet), the two opening spreads are swapped.

    A basketball opening total that is more than BASKETBALL_TOTAL_OPEN_GAP points
    from every recorded total never traded in the snapshots. It is replaced with the
    first total those snapshots recorded.
    """
    if not op: return op
    out = dict(op)
    points = list(points or [])
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
    if kind == "basketball" and out.get("tot") is not None:
        observed = [p["tot"] for p in points if p.get("tot") is not None]
        if observed and min(abs(out["tot"] - t) for t in observed) > BASKETBALL_TOTAL_OPEN_GAP:
            out["tot"] = observed[0]
    return out

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
    (spread on the wrong side, or a basketball total that never appears in the
    snapshots) is corrected from those snapshots on the way in. A later run that
    sends the same bad open is corrected again; it does not stick.
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
            g["open"][bk] = reconcile_open(op, series, kind)
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
