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
      "open":  {"draftkings": {..same keys as a point..}},      # ESPN-reported opening line
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
    """Append changed points from one run's snapshot (taken at UTC time t). Returns #points appended."""
    added = 0
    for gid, s in snap.items():
        g = hist["games"].setdefault(gid, dict(date=s["date"], home=s.get("home"), away=s.get("away"), firstSeen=t, lastSeen=t, open={}, books={}))
        g.update(date=s["date"], home=s.get("home"), away=s.get("away"))
        if t > (g.get("lastSeen") or ""): g["lastSeen"] = t
        for bk, op in (s.get("open") or {}).items(): g["open"][bk] = op
        for bk, pt in s["books"].items():
            tb = (s.get("bt") or {}).get(bk) or t         # per-book observation time (e.g. Hard Rock pull time)
            pts = g["books"].setdefault(bk, [])
            if pts and pts[-1][0] >= tb:                  # already have this (or a newer) observation
                continue
            if not pts or pts[-1][1] != pt:
                pts.append([tb, pt]); added += 1
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
def _primary(gh):
    ks = list((gh.get("books") or {}).keys())
    for k in BOOK_ORDER:
        if k in ks: return k
    return ks[0] if ks else None

def _crossed(a, b, k):
    """True if |line| went across (or onto/off) key number k."""
    a, b = abs(a), abs(b)
    return (a - k) * (b - k) < 0 or (a != b and (a == k or b == k))

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
        big = max(series + [c], key=lambda v: abs(v - o))
        out[label] = dict(open=o, cur=c, delta=round(c - o, 2), maxMove=round(big - o, 2))
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
    """Merge a run's persisted-pull snapshot (e.g. hardrockbet.json) into the branch copy: newer pulledAt per league wins."""
    for f in sorted(glob.glob(os.path.join(src_dir, "*.json"))):
        src = json.load(open(f)); path = os.path.join(dst_dir, os.path.basename(f))
        try: dst = json.load(open(path))
        except (OSError, ValueError): dst = dict(v=1, book=src.get("book"), leagues={}, checks=[])
        for lg, e in (src.get("leagues") or {}).items():
            if (e.get("pulledAt") or "") > ((dst["leagues"].get(lg) or {}).get("pulledAt") or ""): dst["leagues"][lg] = e
        seen = {json.dumps(c, sort_keys=True) for c in dst.get("checks") or []}
        dst["checks"] = sorted((dst.get("checks") or []) + [c for c in src.get("checks") or [] if json.dumps(c, sort_keys=True) not in seen],
                               key=lambda c: c.get("t") or "")[-40:]
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
