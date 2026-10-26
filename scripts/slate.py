"""LineSmart "Today's slate" summary for the home page (written into data/meta.json as meta["slate"]).

Reads the per-league files the build just wrote (data/<lg>/index.json, data/props/<lg>.json) - no network:
  * per league: games today (US Eastern), live now, upcoming, with lines, Weather-watch games,
  * props tracked and "Hot" props (same rule as assets/props-core.js isHot: over the CURRENT line in at
    least 80% of his last 5 games played, needing 2+ games),
  * a short scores ticker (live first, then today's finals, then the next games), at most TICKER_MAX items.
Standard library only. CLI (refresh a data dir's meta.json in place):  python3 scripts/slate.py site/data
"""
import datetime as dt, json, math, os, sys
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
TICKER_MAX = 24
HOT_SHARE, HOT_MIN = 0.8, 2

def _load(path):
    try:
        with open(path) as fh: return json.load(fh)
    except (OSError, ValueError): return None

def _et_day(iso):
    return dt.datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(ET).date()

def is_hot(log, mk, line):
    """Mirror of PropsCore.isHot (assets/props-core.js)."""
    if not isinstance(line, (int, float)): return False
    vals = [(row[3] or {}).get(mk) if len(row) > 3 and isinstance(row[3], dict) else None for row in (log or [])[:5]]
    played = [v for v in vals if isinstance(v, (int, float))]
    o = sum(1 for v in played if v > line)
    return len(played) >= HOT_MIN and o >= math.ceil(HOT_SHARE * len(played) - 1e-9)

def props_summary(doc):
    if not doc: return None
    P = doc.get("players") or {}
    n = hot = 0
    for g in (doc.get("games") or {}).values():
        for row in g.get("props") or []:
            pid, mk, line = row[0], row[1], row[2]
            n += 1
            if is_hot((P.get(pid) or {}).get("log"), mk, line): hot += 1
    return dict(props=n, hot=hot, games=len(doc.get("games") or {}))

def _wx_watch(g):
    w = g.get("weather") or {}
    return w.get("kind") == "forecast" and bool(w.get("watch")) and w.get("roof") != "retractable"

def _tick(lg, g):
    t = lambda s: dict(a=(g.get(s) or {}).get("abbr") or (g.get(s) or {}).get("short") or "", s=(g.get(s) or {}).get("score"))
    return dict(lg=lg, id=g["id"], st=g.get("state"), d=g.get("date"), det=g.get("statusDetail") or "", a=t("away"), h=t("home"))

def build(out_dir, order, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    today = now.astimezone(ET).date()
    leagues, live, fin, nxt = {}, [], [], []
    for lg in order:
        idx = _load(os.path.join(out_dir, lg, "index.json"))
        if not idx: continue
        games = idx.get("games") or []
        tg = [g for g in games if g.get("date") and _et_day(g["date"]) == today]
        e = dict(today=len(tg), live=sum(1 for g in games if g.get("state") == "in"),
                 upcoming=sum(1 for g in games if g.get("state") == "pre"),
                 withOdds=sum(1 for g in games if g.get("odds") and g.get("state") != "post"),
                 wxWatch=sum(1 for g in games if g.get("state") != "post" and _wx_watch(g)))
        ps = props_summary(_load(os.path.join(out_dir, "props", f"{lg}.json")))
        if ps: e["props"], e["hot"] = ps["props"], ps["hot"]
        leagues[lg] = e
        live += [_tick(lg, g) for g in games if g.get("state") == "in"]
        fin += [_tick(lg, g) for g in tg if g.get("state") == "post"]
        nxt += [_tick(lg, g) for g in sorted((g for g in games if g.get("state") == "pre"), key=lambda g: g["date"])[:3]]
    nxt.sort(key=lambda x: x["d"] or "")
    tot = lambda k: sum(e.get(k) or 0 for e in leagues.values())
    return dict(generated=now.isoformat(), day=today.isoformat(), leagues=leagues,
                totals=dict(today=tot("today"), live=tot("live"), upcoming=tot("upcoming"), props=tot("props"), hot=tot("hot"), wxWatch=tot("wxWatch")),
                ticker=(live + fin + nxt)[:TICKER_MAX])

if __name__ == "__main__":
    d = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site", "data")
    mp = os.path.join(d, "meta.json"); meta = json.load(open(mp))
    meta["slate"] = build(d, meta.get("order") or list(meta.get("leagues") or {}))
    with open(mp, "w") as fh: json.dump(meta, fh, indent=1)
    print("slate:", json.dumps(meta["slate"]["totals"]), f"ticker {len(meta['slate']['ticker'])}")
