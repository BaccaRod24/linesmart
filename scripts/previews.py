#!/usr/bin/env python3
"""Static, crawlable game preview pages for LineSmart.

Reads the data build_data.py already wrote (site/data) and writes, with no network calls:

  site/preview/<league>/<away>-at-<home>-<yyyy-mm-dd>/index.html   one page per upcoming game
  site/preview/<league>/<red>-vs-<blue>-<yyyy-mm-dd>/index.html    UFC bouts (main card)
  site/preview/index.html                                          hub page listing every preview
  site/data/previews.json                                          {league: {gameId: path}} for app.js links
  site/sitemap.xml                                                 rewrites the block between the previews markers

Lifecycle: a game gets an indexable page while it's upcoming. Once it starts (live or final) its page becomes a
noindex stub that redirects to the live game page, and it leaves the sitemap. When the game drops out of the data
window the page is no longer generated; site/404.html sends any stale /preview/<league>/... URL to that league.
Every run rebuilds site/preview from scratch, so the page count tracks the data window (see LEAGUES for caps).

Summaries are written from the numbers only: neutral, descriptive, no picks or predictions.

Usage:  python3 scripts/previews.py [--site site] [--data-dir site/data] [--now 2026-10-27T00:00:00Z] [--base-url URL]
"""
from __future__ import annotations

import argparse
import html
import json
import os
import re
import shutil
import sys
import unicodedata
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_pages  # noqa: E402  (shared footer: 21+, 1-800-GAMBLER, legal links)

ROOT = Path(__file__).resolve().parent.parent
ET = ZoneInfo("America/New_York")
BASE_URL = build_pages.BASE_URL
MARK_START, MARK_END = "<!-- previews:start -->", "<!-- previews:end -->"

# Which games get a page. days = how far ahead (from now); odds = only games with a posted line;
# cap = hard ceiling per league (soonest games win). Soccer (epl/mls/ucl) is left out on purpose: add it here.
LEAGUES = {
    "nfl":   {"days": 8, "odds": False, "cap": 40},
    "nba":   {"days": 3, "odds": False, "cap": 50},
    "nhl":   {"days": 3, "odds": False, "cap": 50},
    "mlb":   {"days": 4, "odds": False, "cap": 20},
    "ncaaf": {"days": 7, "odds": True,  "cap": 80},
    "ncaab": {"days": 3, "odds": True,  "cap": 60},
    "ufc":   {"days": 8, "odds": False, "cap": 30, "mainCard": True},
}
STUB_HOURS = 72          # started/finished games keep a redirect stub this long after start (then 404 → league)
BOOKS = [("draftkings", "DraftKings"), ("hardrockbet", "Hard Rock Bet"), ("fanduel", "FanDuel")]
BOOK_NAME = dict(BOOKS)
SUMMARY_BOOK_ORDER = ["hardrockbet", "draftkings", "fanduel"]
MAX_PROPS, MAX_INJ = 10, 6
# Words a preview must never contain (tests enforce this on every generated page).
FORBIDDEN = re.compile(r"\b(lock|locks|guarantee[ds]?|guaranteed|sure thing|can't lose|cannot lose|free money|best bet|pick of the|our pick|we pick|take the|hammer|smash|must bet|risk[- ]free)\b", re.I)

esc = lambda s: html.escape("" if s is None else str(s), quote=True)
isnum = lambda v: isinstance(v, (int, float)) and not isinstance(v, bool)


# ---------------------------------------------------------------- formatting
def parse_dt(s):
    if not s:
        return None
    s = s.replace("Z", "+00:00")
    if re.match(r".*T\d\d:\d\d\+", s):
        s = s.replace("+", ":00+", 1)
    return datetime.fromisoformat(s).astimezone(timezone.utc)


def et(dt):
    return dt.astimezone(ET)


def fmt_et(dt, with_year=True):
    d = et(dt)
    h = d.strftime("%I").lstrip("0")
    return f"{d.strftime('%a, %b')} {d.day}{', ' + str(d.year) if with_year else ''} · {h}:{d.strftime('%M %p')} ET"


def am(v):
    if not isnum(v):
        return None
    v = int(round(v))
    return f"+{v}" if v > 0 else str(v)


def num(v):
    if not isnum(v):
        return None
    return str(int(v)) if float(v).is_integer() else f"{v:g}"


def line(v):
    if not isnum(v):
        return None
    if v == 0:
        return "PK"
    return ("+" if v > 0 else "") + num(v)


def slugify(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s.lower()).strip("-")
    return re.sub(r"-{2,}", "-", s) or "tbd"


def plural(n, word, pl=None):
    return f"{n} {word if n == 1 else (pl or word + 's')}"


# ---------------------------------------------------------------- data
def load_json(p):
    try:
        return json.loads(Path(p).read_text())
    except (OSError, ValueError):
        return None


def live_books(g):
    return {k: b for k, b in (g.get("books") or {}).items() if isinstance(b, dict) and not b.get("stale") and k in BOOK_NAME}


def has_line(g):
    o = g.get("odds") or {}
    return bool(live_books(g)) or any(isnum(o.get(k)) for k in ("homeML", "awayML", "homeSpread", "total"))


def page_path(lg, g, used):
    d = et(parse_dt(g["date"])).strftime("%Y-%m-%d")
    a, h = g.get("away") or {}, g.get("home") or {}
    if lg == "ufc":
        base = f"{slugify(a.get('name'))}-vs-{slugify(h.get('name'))}-{d}"
    else:
        sep = "vs" if g.get("neutral") else "at"
        base = f"{slugify(a.get('name') or a.get('abbr'))}-{sep}-{slugify(h.get('name') or h.get('abbr'))}-{d}"
    if base in used:
        base = f"{base}-{g['id']}"
    used.add(base)
    return f"preview/{lg}/{base}/"


def select(lg, games, now, cfg=None):
    """Return [(game, mode)] with mode "index" (upcoming: full page) or "stub" (started: redirect)."""
    cfg = cfg or LEAGUES[lg]
    horizon = now + timedelta(days=cfg["days"])
    up, stubs = [], []
    for g in games:
        dt = parse_dt(g.get("date"))
        if not dt or not g.get("id") or not g.get("home") or not g.get("away"):
            continue
        if cfg.get("mainCard") and g.get("segment") not in (None, "main") and not g.get("mainEvent"):
            continue
        if cfg["odds"] and not has_line(g):
            continue
        st = g.get("state")
        if st == "pre" and now - timedelta(hours=6) <= dt <= horizon:
            up.append(g)
        elif st in ("in", "post") and dt >= now - timedelta(hours=STUB_HOURS):
            stubs.append(g)
    up.sort(key=lambda g: (g["date"], g["id"]))
    return [(g, "index") for g in up[: cfg["cap"]]] + [(g, "stub") for g in stubs]


# ---------------------------------------------------------------- lines
def best_side(books, fn):
    """fn(book) -> (display, score) or None. Returns {book: (disp, score)} and best score (None if <2 books)."""
    vals = {k: fn(b) for k, b in books.items()}
    vals = {k: v for k, v in vals.items() if v}
    best = max(v[1] for v in vals.values()) if len(vals) > 1 else None
    return vals, best


def markets(g, kind):
    a, h = g["away"].get("abbr") or "Away", g["home"].get("abbr") or "Home"
    sp = lambda s: lambda b: (f"{line(b[s + 'Spread'])} <span class=\"na\">{am(b.get(s + 'SpreadOdds')) or ''}</span>", b[s + "Spread"] * 1000 + (b.get(s + "SpreadOdds") if isnum(b.get(s + "SpreadOdds")) else -110)) if isnum(b.get(s + "Spread")) else None
    ml = lambda s: lambda b: (am(b[s + "ML"]), b[s + "ML"]) if isnum(b.get(s + "ML")) else None
    ov = lambda b: (f"O {num(b['total'])} <span class=\"na\">{am(b.get('overOdds')) or ''}</span>", -b["total"] * 1000 + (b.get("overOdds") if isnum(b.get("overOdds")) else -110)) if isnum(b.get("total")) else None
    un = lambda b: (f"U {num(b['total'])} <span class=\"na\">{am(b.get('underOdds')) or ''}</span>", b["total"] * 1000 + (b.get("underOdds") if isnum(b.get("underOdds")) else -110)) if isnum(b.get("total")) else None
    out = []
    if kind != "mma":
        lab = "puck line" if kind == "hockey" else "run line" if kind == "baseball" else "spread"
        out += [(f"{a} {lab}", sp("away")), (f"{h} {lab}", sp("home"))]
    out += [(f"{a} ML", ml("away")), (f"{h} ML", ml("home")), ("Over" + (" (rounds)" if kind == "mma" else ""), ov), ("Under" + (" (rounds)" if kind == "mma" else ""), un)]
    return out


def odds_table(g, kind):
    books = live_books(g)
    cols = [k for k, _ in BOOKS if k in books]
    if not cols:
        o = g.get("odds") or {}
        if not has_line(g):
            return '<div class="noline">Lines not posted yet. This page updates with every data refresh.</div>'
        books, cols = {"espn": o}, ["espn"]
    name = lambda k: BOOK_NAME.get(k) or (g.get("odds") or {}).get("provider") or "ESPN"
    head = "".join(f'<th data-book="{k}">{esc(name(k))}<span class="na-tag"></span><span class="src">{esc(("as of " + fmt_et(parse_dt(books[k]["asOf"]), False)) if books[k].get("asOf") else (books[k].get("source") or ""))}</span></th>' for k in cols)
    rows = []
    for label, fn in markets(g, kind):
        vals = {k: fn(books[k]) for k in cols}
        have = [v[1] for v in vals.values() if v]
        best = max(have) if len(have) > 1 else None
        cells = "".join(
            (f'<td class="num{" best" if best is not None and vals[k][1] == best else ""}" data-book="{k}" data-score="{vals[k][1]}"><span class="px">{vals[k][0]}</span></td>' if vals[k] else f'<td data-book="{k}">—</td>')
            for k in cols)
        if have:
            rows.append(f"<tr><td>{esc(label)}</td>{cells}</tr>")
    missing = [n for k, n in BOOKS if k not in books and "espn" not in books]
    note = f" No {' or '.join(missing)} line for this game at the last pull." if missing and cols != ["espn"] else ""
    return (f'<div class="tbl-wrap pv-tbl"><table class="books pv-books"><thead><tr><th>Market</th>{head}</tr></thead><tbody>{"".join(rows)}</tbody></table></div>'
            f'<div class="note">Highlighted = best price among books legal in your state (with your state set). Odds change; confirm with the sportsbook.{esc(note)}</div><p class="note pv-na" hidden></p>')


def ref_book(g):
    books = live_books(g)
    for k in SUMMARY_BOOK_ORDER:
        if k in books:
            return k, books[k]
    o = g.get("odds") or {}
    return (None, o) if has_line(g) else (None, None)


def movement(g, kind):
    m = g.get("move") or {}
    if not m:
        return "", []
    rows, facts = [], []
    a, h = g["away"].get("abbr"), g["home"].get("abbr")
    spl = "Puck line" if kind == "hockey" else "Run line" if kind == "baseball" else "Spread"
    for key, label, fmt in (("spread", f"{spl} ({h})", line), ("total", "Total", num), ("homeML", f"{h} moneyline", am), ("awayML", f"{a} moneyline", am)):
        x = m.get(key)
        if not isinstance(x, dict) or not isnum(x.get("open")) or not isnum(x.get("cur")):
            continue
        d = x.get("delta") if isnum(x.get("delta")) else x["cur"] - x["open"]
        dtxt = "no change" if not d else (("+" if d > 0 else "") + (num(d) if key in ("spread", "total") else str(int(d))))
        rows.append(f"<tr><td>{esc(label)}</td><td class=\"num\">{esc(fmt(x['open']))}</td><td class=\"num\">{esc(fmt(x['cur']))}</td><td class=\"num{' mv-up' if d and d > 0 else ' mv-dn' if d else ''}\">{esc(dtxt)}</td></tr>")
        if key in ("spread", "total") and d:
            facts.append((key, x["open"], x["cur"], d))
    if not rows:
        return "", []
    since = parse_dt(m.get("since")) if m.get("since") else None
    src = BOOK_NAME.get(m.get("book"), m.get("book") or "")
    spark = ""
    sp = ((m.get("spark") or {}).get("spread") or [])
    if len([v for v in sp if isnum(v)]) >= 2:
        vals = [v for v in sp if isnum(v)]
        lo, hi = min(vals), max(vals)
        rng = (hi - lo) or 1
        pts = " ".join(f"{i * 200 / (len(vals) - 1):.1f},{36 - (v - lo) / rng * 32 - 2:.1f}" for i, v in enumerate(vals))
        spark = f'<figure class="pv-spark"><svg viewBox="0 0 200 36" preserveAspectRatio="none" role="img" aria-label="{esc(spl)} history ({esc(h)}): {esc(line(vals[0]))} to {esc(line(vals[-1]))}"><polyline points="{pts}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"/></svg><figcaption>{esc(spl)} ({esc(h)}) since tracking began</figcaption></figure>'
    notable = "".join(f"<li>{esc(n if isinstance(n, str) else (n.get('text') or n.get('label') or ''))}</li>" for n in (m.get("notable") or [])[:4] if n)
    html_ = (f'<div class="card"><h3>Line movement{(" · " + esc(src)) if src else ""}</h3>'
             f'<table class="books pv-move"><thead><tr><th>Market</th><th>Open</th><th>Now</th><th>Move</th></tr></thead><tbody>{"".join(rows)}</tbody></table>{spark}'
             f'{"<ul class=pv-notes>" + notable + "</ul>" if notable else ""}'
             f'<div class="note">Open = first line we recorded{(" (" + fmt_et(since, False) + ")") if since else ""}. Spread shown from the {esc(h)} side.</div></div>')
    return html_, facts


# ---------------------------------------------------------------- summary (neutral, numbers only)
def side_name(t):
    return t.get("short") or t.get("name") or t.get("abbr") or "TBD"


def ref_name(lg, t, cap=False):
    """How the summary names a side: "the Packers" (pro), "Delaware Blue Hens" (college: nicknames repeat), full name (UFC)."""
    if lg in ("ncaaf", "ncaab", "ufc") or not t.get("short"):
        return t.get("name") or t.get("abbr") or "TBD"
    return ("The " if cap else "the ") + t["short"]


def team_form_sentence(lg, t, team_stats):
    ts = team_stats or {}
    rec = t.get("record") or ts.get("recordSummary")
    if not rec:
        return ""
    parts = [f"{ref_name(lg, t, True)} are {rec}"]
    sp = ts.get("homeSplit" if t.get("_side") == "home" else "awaySplit") or {}
    if sp.get("gp"):
        parts.append(f"{sp.get('w', 0)}-{sp.get('l', 0)} {'at home' if t.get('_side') == 'home' else 'on the road'}")
    st = ts.get("streak")
    if isinstance(st, str) and re.match(r"^[WL]\d+$", st) and int(st[1:]) >= 2:
        tail = f"{'won' if st[0] == 'W' else 'lost'} {int(st[1:])} straight"
        return f"{parts[0]} ({parts[1]}) and have {tail}." if len(parts) > 1 else f"{parts[0]} and have {tail}."
    return f"{parts[0]} ({parts[1]})." if len(parts) > 1 else parts[0] + "."


def summary(lg, kind, g, detail, teams, props_count, move_facts):
    a, h = dict(g["away"], _side="away"), dict(g["home"], _side="home")
    A, H = ref_name(lg, a), ref_name(lg, h)
    when = fmt_et(parse_dt(g["date"]))
    s = []
    if kind == "mma":
        ev = (g.get("event") or {}).get("name")
        s.append(f"{a.get('name')} ({a.get('record') or 'record n/a'}) meets {h.get('name')} ({h.get('record') or 'record n/a'})"
                 f"{' in a ' + g['weightClass'].lower() + ' bout' if g.get('weightClass') else ''}{' on ' + ev if ev else ''}, {when}.")
    else:
        where = f" at {g['venue']}" if g.get("venue") else ""
        s.append(f"{a.get('name')} {'face' if g.get('neutral') else 'visit'} {h.get('name')}{where} on {when}.")
    bk, b = ref_book(g)
    if b:
        src = BOOK_NAME.get(bk) or (g.get("odds") or {}).get("provider") or "the listed book"
        hs = b.get("homeSpread")
        if kind in ("football", "basketball") and isnum(hs):
            if hs == 0:
                s.append(f"{src} has the game as a pick'em on the spread.")
            else:
                fav, dog = (H, A) if hs < 0 else (A, H)
                s.append(f"{src} has {fav} as a {num(abs(hs))}-{'goal' if kind == 'hockey' else 'run' if kind == 'baseball' else 'point'} favorite over {dog}.")
        elif isnum(b.get("homeML")) and isnum(b.get("awayML")):
            if b["homeML"] == b["awayML"]:
                s.append(f"{src} prices both sides the same on the moneyline ({am(b['homeML'])}).")
            else:
                fav, dog = (H, A) if b["homeML"] < b["awayML"] else (A, H)
                s.append(f"{src} has {fav} as the moneyline favorite ({am(min(b['homeML'], b['awayML']))}), with {dog} at {am(max(b['homeML'], b['awayML']))}.")
        if isnum(b.get("total")):
            s.append(f"The total is {num(b['total'])}{' rounds' if kind == 'mma' else ''}.")
        lb = live_books(g)
        tots = sorted({x["total"] for x in lb.values() if isnum(x.get("total"))})
        if len(tots) > 1:
            s.append(f"Across the books we track, the total ranges from {num(tots[0])} to {num(tots[-1])}.")
    else:
        s.append("Betting lines haven't been posted yet; this page updates with each data refresh.")
    for key, op, cur, d in move_facts:
        if key == "spread" and abs(d) >= (1 if kind in ("football", "basketball") else 0.5):
            s.append(f"{ref_name(lg, h, True)} spread has moved from {line(op)} to {line(cur)} since we started tracking it.")
        if key == "total" and abs(d) >= (1 if kind in ("football", "basketball") else 0.5):
            s.append(f"The total has moved {'up' if d > 0 else 'down'} from {num(op)} to {num(cur)}.")
    if kind != "mma":
        for t in (a, h):
            f = team_form_sentence(lg, t, teams.get(str(t.get("id"))))
            if f:
                s.append(f)
    inj = (detail or {}).get("injuries") or {}
    outs = []
    for t in (a, h):
        o = [p for p in inj.get(str(t.get("id")), []) if (p.get("status") or "").lower() == "out"]
        if o:
            outs.append(f"{len(o)} for {ref_name(lg, t)}")
    if outs:
        s.append("Players listed as out: " + ", ".join(outs) + ".")
    wx = g.get("weather") or {}
    if wx.get("kind") == "forecast" and isnum(wx.get("temp")):
        s.append(f"Forecast near start: {round(wx['temp'])}°F{', wind ' + str(round(wx['wind'])) + ' mph' if isnum(wx.get('wind')) else ''}.")
    if props_count:
        s.append(f"{plural(props_count, 'player prop line')} {'is' if props_count == 1 else 'are'} posted; the main ones are below.")
    return " ".join(s)


# ---------------------------------------------------------------- sections
def records_card(g, teams, detail):
    rows = []
    for t in (g["away"], g["home"]):
        ts = teams.get(str(t.get("id"))) or {}
        split = ts.get("homeSplit" if t is g["home"] else "awaySplit") or {}
        l10 = ts.get("last10") or {}
        rec = lambda x: f"{x.get('w', 0)}-{x.get('l', 0)}{'-' + str(x['d']) if x.get('d') else ''}" if x.get("gp") else "—"
        five = ((detail or {}).get("lastFive") or {}).get(str(t.get("id"))) or []
        form = "".join(f'<span class="pv-f pv-{esc((r.get("result") or "").upper()[:1] or "x")}" title="{esc((r.get("atVs") or "") + " " + (r.get("oppName") or r.get("opp") or "") + " " + (r.get("score") or ""))}">{esc((r.get("result") or "?")[:1])}</span>' for r in five[:5]) \
            or "".join(f'<span class="pv-f pv-{esc(c)}">{esc(c)}</span>' for c in (t.get("form") or "")[:5])
        rows.append(f"<tr><td>{esc(t.get('abbr'))}</td><td class=\"num\">{esc(t.get('record') or ts.get('recordSummary') or '—')}</td>"
                    f"<td class=\"num\">{esc(rec(split))}</td><td class=\"num\">{esc(rec(l10))}</td><td class=\"num\">{esc(ts.get('streak') or '—')}</td><td class=\"pv-form\">{form or '—'}</td></tr>")
    stand = " · ".join(f"{esc(t.get('abbr'))}: {esc((teams.get(str(t.get('id'))) or {}).get('standingSummary'))}" for t in (g["away"], g["home"]) if (teams.get(str(t.get("id"))) or {}).get("standingSummary"))
    return (f'<div class="card"><h3>Records &amp; recent form</h3><div class="tbl-wrap pv-tbl"><table class="books pv-rec"><thead><tr><th>Team</th><th>Record</th><th>Home/Away</th><th>Last 10</th><th>Streak</th><th>Last 5</th></tr></thead>'
            f'<tbody>{"".join(rows)}</tbody></table></div>{"<div class=note>" + stand + "</div>" if stand else ""}<div class="note">Home/Away = {esc(g["away"].get("abbr"))} on the road, {esc(g["home"].get("abbr"))} at home.</div></div>')


def last_five_card(g, detail):
    lf = (detail or {}).get("lastFive") or {}
    blocks = []
    for t in (g["away"], g["home"]):
        games = lf.get(str(t.get("id"))) or []
        if not games:
            continue
        li = "".join(f"<li><span class=\"pv-f pv-{esc((r.get('result') or 'x')[:1])}\">{esc((r.get('result') or '?')[:1])}</span> {esc(r.get('atVs') or '')} {esc(r.get('oppName') or r.get('opp') or '')} <span class=\"na\">{esc(r.get('score') or '')}</span></li>" for r in games[:5])
        blocks.append(f"<div><h4>{esc(side_name(t))}</h4><ul class=\"pv-list\">{li}</ul></div>")
    return f'<div class="card"><h3>Last five games</h3><div class="pv-two">{"".join(blocks)}</div></div>' if blocks else ""


def injuries_card(g, detail):
    inj = (detail or {}).get("injuries") or {}
    if not (detail or {}).get("injuriesAvailable", bool(inj)):
        return ""
    blocks = []
    for t in (g["away"], g["home"]):
        ps = inj.get(str(t.get("id"))) or []
        order = {"out": 0, "doubtful": 1, "questionable": 2}
        ps = sorted(ps, key=lambda p: order.get((p.get("status") or "").lower(), 3))
        li = "".join(f"<li><b>{esc(p.get('player'))}</b> <span class=\"na\">{esc(p.get('pos') or '')}</span> <span class=\"badge{' out' if (p.get('status') or '').lower() == 'out' else ' q'}\">{esc(p.get('status'))}</span>{(' <span class=na>' + esc(p.get('type') or p.get('detail')) + '</span>') if (p.get('type') or p.get('detail')) else ''}</li>" for p in ps[:MAX_INJ])
        more = f"<li class=\"na\">+{len(ps) - MAX_INJ} more on the game page</li>" if len(ps) > MAX_INJ else ""
        blocks.append(f"<div><h4>{esc(side_name(t))}</h4><ul class=\"pv-list\">{li + more if ps else '<li class=na>No injuries listed</li>'}</ul></div>")
    return f'<div class="card"><h3>Injuries</h3><div class="pv-two">{"".join(blocks)}</div><div class="note">Source: ESPN injury reports at the last data refresh.</div></div>'


def props_card(lg, g, props):
    if not props:
        return "", 0
    gp = (props.get("games") or {}).get(str(g["id"])) or {}
    rows = gp.get("props") or []
    if not rows:
        return "", 0
    mk = props.get("markets") or {}
    players = props.get("players") or {}
    def sort_key(r):
        books = r[5] if len(r) > 5 and isinstance(r[5], dict) else {}
        return (-len(books), str(r[1]))
    seen, out = set(), []
    for r in sorted(rows, key=sort_key):
        pid, m = r[0], r[1]
        if pid in seen:
            continue
        seen.add(pid)
        out.append(r)
        if len(out) >= MAX_PROPS:
            break
    trs = []
    for r in out:
        pid, m, ln = r[0], r[1], r[2]
        p = players.get(str(pid)) or {}
        books = r[5] if len(r) > 5 and isinstance(r[5], dict) else {}
        cells = "".join(
            f'<td class="num" data-book="{k}">' + (f'<span class="px">{esc(num(books[k][0]))} <span class="na">o{esc(am(books[k][1]) or "")}/u{esc(am(books[k][2]) or "")}</span></span>' if k in books and isinstance(books[k], list) and books[k] and isnum(books[k][0]) else "—") + "</td>"
            for k, _ in BOOKS)
        tally = r[4] if len(r) > 4 and isinstance(r[4], list) and len(r[4]) >= 4 else None
        hit = f"{tally[0]}-{tally[1]}" if tally and tally[3] else "—"
        trs.append(f"<tr><td><b>{esc(p.get('n') or pid)}</b> <span class=\"na\">{esc(p.get('ta') or '')} {esc(p.get('pos') or '')}</span></td><td>{esc((mk.get(m) or [m])[0])}</td><td class=\"num\">{esc(num(ln))}</td>{cells}<td class=\"num\">{esc(hit)}</td></tr>")
    head = "".join(f'<th data-book="{k}">{esc(n)}<span class="na-tag"></span></th>' for k, n in BOOKS)
    return (f'<div class="card"><h3>Key player props</h3><div class="tbl-wrap pv-tbl"><table class="books pv-props"><thead><tr><th>Player</th><th>Market</th><th>Line</th>{head}<th>Over-under this season</th></tr></thead><tbody>{"".join(trs)}</tbody></table></div>'
            f'<div class="note">Showing {len(out)} of {len(rows)} prop lines. "Over-under this season" counts how often the player cleared the current line; it describes the past, not what will happen. All props are on the game page.</div></div>'), len(rows)


def leaders_card(detail):
    L = (detail or {}).get("leaders") or []
    if not L:
        return ""
    li = "".join(f"<li><span class=\"na\">{esc(x.get('cat'))}</span> <b>{esc(x.get('player'))}</b> {esc(x.get('value'))}</li>" for x in L[:8])
    return f'<div class="card"><h3>Team leaders</h3><ul class="pv-list">{li}</ul></div>'


# ---------------------------------------------------------------- page shell
HEAD_LINKS = """<link rel="icon" href="favicon.ico" sizes="any">
<link rel="icon" href="assets/brand/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="assets/brand/apple-touch-icon.png" sizes="180x180">
<link rel="manifest" href="manifest.webmanifest">
<link rel="preload" href="assets/fonts/inter-latin-var.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="assets/styles.css">
<script src="assets/theme.js"></script>
<script src="assets/config.js"></script>
<script src="assets/site.js" defer></script>
<script src="assets/books-by-state.js" defer></script>
<script src="assets/geo-core.js" defer></script>
<script src="assets/geo.js" defer></script>
<script src="assets/news-core.js" defer></script>
<script src="assets/news.js" defer></script>
<script src="assets/preview.js" defer></script>"""

STATE_BTN = '<button class="search-btn state-btn" id="stateBtn" type="button" aria-label="Pick your state" title="Pick your state: sets which sportsbooks we show"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg><span class="st-l">State</span></button>'


def shell(depth, path, title, desc, body, jsonld=None, og_type="article", base_url=BASE_URL):
    base = "../" * depth
    url = base_url + path
    ld = "".join(f'\n<script type="application/ld+json">{json.dumps(x, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")}</script>' for x in (jsonld or []))
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<base href="{base}">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#050b1c">
<title>{esc(title)}</title>
<meta name="description" content="{esc(desc)}">
<link rel="canonical" href="{esc(url)}">
<meta property="og:type" content="{og_type}">
<meta property="og:site_name" content="LineSmart">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(desc)}">
<meta property="og:url" content="{esc(url)}">
<meta property="og:image" content="{base_url}assets/brand/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{esc(title)}">
<meta name="twitter:description" content="{esc(desc)}">
{HEAD_LINKS}{ld}
</head>
<body class="legal-page preview-page">
<!-- generated by scripts/previews.py from site/data: edit the generator, not this file -->
<header class="topbar">
  <div class="wrap topbar-inner">
    <a class="brand" href="./" title="LineSmart — home"><img class="brand-logo" src="assets/brand/logo.svg" alt="LineSmart" width="277" height="64"></a>
    <a class="legal-nav-a" href="preview/">Previews</a>
    {STATE_BTN}
    <a class="search-btn" href="./#/search" aria-label="Search teams and players" title="Search teams and players"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><span class="sb-l">Search</span></a>
  </div>
</header>
<main class="wrap" id="app">
{body}
</main>
{build_pages.FOOTER}
</body>
</html>
"""


def stub_page(lg, g, path):
    """Started or finished game: noindex, redirect to the live game page (no base tag: explicit relative URLs)."""
    target = f"../../../#/g/{lg}/{g['id']}"
    t = f"{g['away'].get('name')} vs {g['home'].get('name')}"
    st = "is live" if g.get("state") == "in" else "has finished"
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,follow">
<title>{esc(t)} · LineSmart</title>
<meta http-equiv="refresh" content="0; url={esc(target)}">
<link rel="stylesheet" href="../../../assets/styles.css">
<script>location.replace({json.dumps(target)});</script>
</head><body class="legal-page preview-page"><main class="wrap" id="app"><article class="legal">
<h1>{esc(t)}</h1><p>This game {st}. <a href="{esc(target)}">Go to the live game page</a> for scores and closing lines.</p>
<p class="rg"><span class="age-pill">21+</span> 21+ only. Gambling problem? {build_pages.RG_CALL_STATIC}</p>
</article></main></body></html>
"""


def jsonld(lg, lgname, kind, g, url, desc, base_url):
    a, h = g["away"], g["home"]
    dt = et(parse_dt(g["date"]))
    team = lambda t: {"@type": "Person" if kind == "mma" else "SportsTeam", "name": t.get("name")} | ({"sport": SPORT[kind]} if kind != "mma" else {})
    ev = {
        "@context": "https://schema.org", "@type": "SportsEvent",
        "name": g.get("name") or f"{a.get('name')} at {h.get('name')}",
        "description": desc, "url": url,
        "startDate": dt.isoformat(timespec="minutes"),
        "eventStatus": "https://schema.org/EventScheduled",
        "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
        "sport": SPORT[kind],
        "image": [base_url + "assets/brand/og-image.png"],
        "organizer": {"@type": "SportsOrganization", "name": lgname},
        "competitor": [team(a), team(h)],
    }
    if kind != "mma":
        ev["homeTeam"], ev["awayTeam"] = team(h), team(a)
    if g.get("venue"):
        addr = {"@type": "PostalAddress", "addressLocality": g.get("city") or ""}
        if g.get("venueState"):
            addr["addressRegion"] = g["venueState"]
        addr["addressCountry"] = g.get("venueCountry") or "US"
        ev["location"] = {"@type": "Place", "name": g["venue"], "address": addr}
    else:
        ev["location"] = {"@type": "Place", "name": "TBD"}
    crumbs = {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "LineSmart", "item": base_url},
        {"@type": "ListItem", "position": 2, "name": "Game previews", "item": base_url + "preview/"},
        {"@type": "ListItem", "position": 3, "name": f"{lgname}: {a.get('abbr')} vs {h.get('abbr')}" if kind != "mma" else g.get("name"), "item": url}]}
    return [ev, crumbs]


SPORT = {"football": "American football", "basketball": "Basketball", "hockey": "Ice hockey", "baseball": "Baseball", "mma": "Mixed martial arts", "soccer": "Soccer"}


def game_page(lg, league, g, detail, teams, props, path, siblings, base_url):
    kind = league.get("kind") or "football"
    lgname = league.get("name") or lg.upper()
    a, h = g["away"], g["home"]
    dt = parse_dt(g["date"])
    url = base_url + path
    pc, n_props = props_card(lg, g, props) if lg in ("nfl", "nba") else ("", 0)
    mv_html, mv_facts = movement(g, kind)
    summ = summary(lg, kind, g, detail, teams, n_props, mv_facts)
    sep = "vs." if kind == "mma" or g.get("neutral") else "at"
    day = f"{et(dt).strftime('%b')} {et(dt).day}"
    title = f"{a.get('name')} {sep} {h.get('name')} odds & preview, {day} · LineSmart"
    if len(title) > 65 and kind != "mma":   # keep titles short enough not to be cut off in search results
        title = f"{side_name(a)} {sep} {side_name(h)} odds & preview, {day} · LineSmart"
    _, rb = ref_book(g)
    lines_bit = ""
    if rb:
        bits = []
        if kind != "mma" and isnum(rb.get("homeSpread")):
            bits.append(f"{h.get('abbr')} {line(rb['homeSpread'])}")
        if isnum(rb.get("total")):
            bits.append(f"total {num(rb['total'])}")
        lines_bit = (" Current line: " + ", ".join(bits) + ".") if bits else ""
    tail = f" Compare DraftKings, Hard Rock Bet and FanDuel odds, line movement, {'props, ' if n_props else ''}records and injuries."
    desc = f"{lgname} {a.get('name')} {sep} {h.get('name')}, {fmt_et(dt)}.{lines_bit}{tail}"
    if len(desc) > 160:
        desc = f"{lgname}: {side_name(a)} {sep} {side_name(h)}, {fmt_et(dt, False)}.{lines_bit} Odds across books, line moves, {'props, ' if n_props else ''}form and injuries."
    if len(desc) > 160:
        desc = desc[:157].rsplit(" ", 1)[0] + "…"
    game_href = f"#/g/{lg}/{g['id']}"
    team_link = lambda t: f'<a class="tlink" href="#/p/ufc/{esc(t.get("id"))}">{esc(t.get("name"))}</a>' if kind == "mma" else f'<a class="tlink" href="#/t/{lg}/{esc(t.get("id"))}">{esc(t.get("name"))}</a>'
    logo = lambda t: f'<img src="{esc(t.get("logo"))}" alt="" width="56" height="56" loading="lazy" class="pv-logo">' if t.get("logo") else ""
    meta_bits = [x for x in [g.get("venue"), ", ".join(x for x in [g.get("city"), g.get("venueState")] if x), ", ".join(g.get("broadcasts") or [])] if x]
    if kind == "mma":
        meta_bits = [x for x in [(g.get("event") or {}).get("name"), " · ".join(x for x in [g.get("weightClass"), f"{g.get('rounds')} rounds" if g.get("rounds") else ""] if x)] if x] + meta_bits
    wx = g.get("weather") or {}
    wx_line = f'<div class="where">Weather: {esc(wx.get("label") or "")}</div>' if wx.get("label") else ""
    ca, ch = (a.get("color") or "334155"), (h.get("color") or "475569")
    hero = f"""<div class="match pv-match" style="--ca:#{esc(ca.lstrip('#'))};--ch:#{esc(ch.lstrip('#'))}">
  <div class="mteam">{logo(a)}<div><div class="nm">{team_link(a)}</div><div class="rec">{esc(a.get('record') or '—')}</div></div></div>
  <div class="mmid"><div class="vs">{'VS' if sep == 'vs.' else '@'}</div><div class="when"><time datetime="{esc(et(dt).isoformat(timespec='minutes'))}">{esc(fmt_et(dt))}</time></div>{''.join(f'<div class="where">{esc(x)}</div>' for x in meta_bits)}{wx_line}</div>
  <div class="mteam home">{logo(h)}<div><div class="nm">{team_link(h)}</div><div class="rec">{esc(h.get('record') or '—')}</div></div></div>
</div>"""
    sib = "".join(f'<li><a href="{esc(p)}">{esc(t)}</a> <span class="na">{esc(w)}</span></li>' for p, t, w in siblings[:8])
    # keep-last-good fallback (scripts/lastgood.py): ESPN didn't load on the latest refresh, this game is the last good copy
    st = g.get("stale") or {}
    st_t = parse_dt(st.get("asOf"))
    stale_html = (f'<div class="stale-note" role="status"><b>Delayed data.</b> The ESPN feed didn\'t load on the latest refresh, so this '
                  f'preview uses the last good update ({esc(fmt_et(st_t))}). Times, records and lines may be out of date.</div>\n') if st_t else ""
    upd = (f"Preview built from the last good LineSmart data ({esc(fmt_et(st_t))}); the latest refresh couldn't reach the ESPN feed" if st_t
           else f"Preview built from LineSmart data refreshed {esc(fmt_et(parse_dt(league.get('_generated')) or dt))}")
    body = f"""<article class="pv">
<nav class="pv-crumbs" aria-label="Breadcrumb"><a href="./">LineSmart</a> › <a href="preview/">Game previews</a> › <a href="#/l/{lg}">{esc(lgname)}</a></nav>
<h1 class="pv-h1">{esc(a.get('name'))} {sep} {esc(h.get('name'))}: odds &amp; preview</h1>
{hero}
{stale_html}<p class="pv-cta"><a class="pv-live" href="{esc(game_href)}">Open the live game page →</a> <span class="na">Live odds, every prop and alerts. Updated about every 30 minutes; this preview reflects the last build.</span></p>
<section aria-labelledby="pvSum"><h2 class="section-title" id="pvSum">Preview</h2><div class="card pv-summary"><p>{esc(summ)}</p><p class="note">Written automatically from the numbers on this page: a description of the market, not a prediction or betting advice.</p></div></section>
<section aria-labelledby="pvOdds"><h2 class="section-title" id="pvOdds">Best lines across books</h2>{odds_table(g, kind)}<div id="pvOffers" data-offers-slot="preview"></div></section>
{f'<section aria-labelledby="pvMove"><h2 class="section-title" id="pvMove">Line movement</h2>{mv_html}</section>' if mv_html else ''}
{f'<section aria-labelledby="pvProps"><h2 class="section-title" id="pvProps">Player props</h2>{pc}</section>' if pc else ''}
{'' if kind == 'mma' else f'<section aria-labelledby="pvForm"><h2 class="section-title" id="pvForm">Form &amp; injuries</h2>{records_card(g, teams, detail)}<div class="cols pv-cols">{last_five_card(g, detail)}{injuries_card(g, detail)}</div>{leaders_card(detail)}</section>'}
{f'<section aria-labelledby="pvMore"><h2 class="section-title" id="pvMore">More {esc(lgname)} previews</h2><ul class="pv-list pv-more">{sib}</ul></section>' if sib else ''}
<p class="note pv-upd">{upd}. Odds are for reference and may change; confirm with the sportsbook.</p>
</article>"""
    return shell(path.count("/"), path, title, desc, body, jsonld(lg, lgname, kind, g, url, desc, base_url), base_url=base_url), title, desc


def hub_page(entries, generated, base_url):
    """entries: [(lg, lgname, [(path, label, when)])]"""
    secs = "".join(f'<section aria-labelledby="h-{lg}"><h2 class="section-title" id="h-{lg}">{esc(n)}</h2><ul class="pv-list pv-more">'
                   + "".join(f'<li><a href="{esc(p)}">{esc(t)}</a> <span class="na">{esc(w)}</span></li>' for p, t, w in items) + "</ul></section>"
                   for lg, n, items in entries if items)
    total = sum(len(i) for _, _, i in entries)
    body = f"""<article class="pv">
<nav class="pv-crumbs" aria-label="Breadcrumb"><a href="./">LineSmart</a> › Game previews</nav>
<h1 class="pv-h1">Game previews: odds, line movement and form</h1>
<p class="pv-lead">{total} upcoming games with odds from DraftKings, Hard Rock Bet and FanDuel, line movement, records, injuries and key player props. Pages update with each data refresh and redirect to the live game page once a game starts.</p>
{secs or '<div class="empty">No upcoming previews right now. Check back after the next data refresh.</div>'}
<p class="note pv-upd">Updated {esc(fmt_et(generated))}. For adults 21 and older; odds are for reference only.</p>
</article>"""
    ld = [{"@context": "https://schema.org", "@type": "CollectionPage", "name": "LineSmart game previews", "url": base_url + "preview/"}]
    return shell(1, "preview/", "Game previews: odds, line movement & form · LineSmart",
                 "Previews for upcoming NFL, NBA, NHL, MLB, college and UFC games: odds across DraftKings, Hard Rock Bet and FanDuel, line movement, records and injuries.",
                 body, ld, og_type="website", base_url=base_url)


def update_sitemap(path, urls, lastmod):
    txt = path.read_text()
    block = MARK_START + "\n" + "".join(f"  <url><loc>{esc(u)}</loc><lastmod>{lastmod}</lastmod><changefreq>hourly</changefreq></url>\n" for u in urls) + "  " + MARK_END
    if MARK_START in txt and MARK_END in txt:
        txt = re.sub(re.escape(MARK_START) + r".*?" + re.escape(MARK_END), lambda _: block, txt, flags=re.S)
    else:
        txt = txt.replace("</urlset>", "  " + block + "\n</urlset>")
    path.write_text(txt)


# ---------------------------------------------------------------- build
def build(site: Path, data_dir: Path, now: datetime, base_url=BASE_URL, leagues=None, write_sitemap=True):
    meta = load_json(data_dir / "meta.json") or {}
    generated = parse_dt(meta.get("generated")) or now
    out_tmp = site / ".preview.tmp"
    shutil.rmtree(out_tmp, ignore_errors=True)
    manifest = {"generated": now.isoformat(timespec="seconds").replace("+00:00", "Z"), "leagues": {}}
    hub, sitemap_urls, stats = [], [base_url + "preview/"], {}
    for lg in (leagues or LEAGUES):
        ix = load_json(data_dir / lg / "index.json")
        if not ix:
            continue
        league = dict(ix.get("league") or {})
        league["_generated"] = ix.get("generated") or meta.get("generated")
        teams = ix.get("teams") or {}
        props = load_json(data_dir / "props" / f"{lg}.json") if lg in ("nfl", "nba") else None
        chosen = select(lg, ix.get("games") or [], now)
        used, paths = set(), {}
        for g, _ in chosen:
            paths[g["id"]] = page_path(lg, g, used)
        listing = [(paths[g["id"]], f"{g['away'].get('name')} {'vs.' if lg == 'ufc' or g.get('neutral') else 'at'} {g['home'].get('name')}", fmt_et(parse_dt(g["date"]), False)) for g, m in chosen if m == "index"]
        n_idx = n_stub = 0
        for g, mode in chosen:
            p = paths[g["id"]]
            dest = out_tmp / p[len("preview/"):] / "index.html"
            dest.parent.mkdir(parents=True, exist_ok=True)
            if mode == "stub":
                dest.write_text(stub_page(lg, g, p))
                n_stub += 1
                continue
            gf = load_json(data_dir / lg / "games" / f"{g['id']}.json") or {}
            detail = gf.get("detail") or {}
            sibs = [x for x in listing if x[0] != p]
            page, _, _ = game_page(lg, league, g, detail, teams, props, p, sibs, base_url)
            dest.write_text(page)
            manifest["leagues"].setdefault(lg, {})[str(g["id"])] = p
            sitemap_urls.append(base_url + p)
            n_idx += 1
        hub.append((lg, league.get("full") or league.get("name") or lg.upper(), listing))
        stats[lg] = {"pages": n_idx, "redirects": n_stub}
    out_tmp.mkdir(parents=True, exist_ok=True)
    (out_tmp / "index.html").write_text(hub_page(hub, generated, base_url))
    # swap in atomically-ish: old tree out, new tree in
    final = site / "preview"
    old = site / ".preview.old"
    shutil.rmtree(old, ignore_errors=True)
    if final.exists():
        final.rename(old)
    out_tmp.rename(final)
    shutil.rmtree(old, ignore_errors=True)
    (data_dir / "previews.json").write_text(json.dumps(manifest, separators=(",", ":")))
    # flag in meta.json so the app only requests previews.json when it exists (no 404s on builds without previews)
    if meta:
        meta["previews"] = {"generated": manifest["generated"], "pages": sum(len(v) for v in manifest["leagues"].values())}
        (data_dir / "meta.json").write_text(json.dumps(meta, indent=1))
    if write_sitemap and (site / "sitemap.xml").exists():
        update_sitemap(site / "sitemap.xml", sitemap_urls, et(generated).strftime("%Y-%m-%d"))
    stats["total"] = {"pages": sum(v["pages"] for v in stats.values()), "redirects": sum(v["redirects"] for v in stats.values())}
    return stats


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--site", default=str(ROOT / "site"))
    ap.add_argument("--data-dir", default=None, help="data directory (default: <site>/data)")
    ap.add_argument("--now", default=None, help="ISO time to treat as now (tests)")
    ap.add_argument("--base-url", default=BASE_URL)
    ap.add_argument("--no-sitemap", action="store_true")
    a = ap.parse_args(argv)
    site = Path(a.site)
    data_dir = Path(a.data_dir) if a.data_dir else site / "data"
    now = parse_dt(a.now) if a.now else datetime.now(timezone.utc)
    stats = build(site, data_dir, now, a.base_url, write_sitemap=not a.no_sitemap)
    print("previews: " + ", ".join(f"{k} {v['pages']}" + (f" (+{v['redirects']} redirects)" if v["redirects"] else "") for k, v in stats.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
