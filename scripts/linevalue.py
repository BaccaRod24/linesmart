"""LineSmart line-value math (stdlib only). Mirrors site/assets/adv-core.js; scripts/adv_test.py checks both agree.

For every game we already have up to three books' prices (Hard Rock Bet, DraftKings, FanDuel; see build_data.py). Nothing
here calls The Odds API or any other network service: it only re-reads the odds the build already pulled.

  implied probability   p = 100 / (A + 100) for A > 0,  -A / (-A + 100) for A < 0  (includes the book's margin / vig)
  no-vig (per book)     each outcome's implied probability divided by the sum over the market's outcomes
                        (multiplicative / "proportional" method; 2-way markets, or 3-way for soccer moneylines)
  consensus fair prob   mean of the books' no-vig probabilities, using only books that hang the *consensus line*
                        (the spread / total most books agree on; moneylines always qualify). Needs 2+ books.
  edge %                fair_prob x decimal_odds - 1  (expected return per 1 unit staked at that price vs the fair price)
  outlier               needs 3+ books on the market. A book is an outlier when
                          * its spread/total differs from the consensus line by >= LINE_GAP[kind] points (1.5 football/basketball,
                            0.5 hockey/baseball/soccer), or
                          * on the consensus line its no-vig probability differs from the mean of the OTHER books
                            by >= PRICE_GAP (3 percentage points).
                        The badge goes on the side the outlier book makes cheaper to bet (better for the bettor).
Informational only: an edge vs a consensus is not a prediction and not a guarantee of anything.
"""
import datetime as dt, json, os

PRICE_GAP = 0.03
LINE_GAP = {"football": 1.5, "basketball": 1.5}
LINE_GAP_DEFAULT = 0.5                       # hockey / baseball / soccer totals and run/puck lines
BOOKS = ("hardrockbet", "draftkings", "fanduel")
VALUE_MIN_EDGE = -0.03                       # value spots: prices within 3% of the consensus fair price, or better
VALUE_MAX_PRICE = 400                        # skip long shots past +400: proportional de-vig overstates their fair odds
VALUE_MAX = 60

def implied(a):
    if a is None or a == 0: return None
    a = float(a)
    return 100.0 / (a + 100.0) if a > 0 else -a / (-a + 100.0)

def decimal(a):
    if a is None or a == 0: return None
    a = float(a)
    return 1 + a / 100.0 if a > 0 else 1 + 100.0 / -a

def to_american(p):
    if p is None or p <= 0 or p >= 1: return None
    return -round(100 * p / (1 - p)) if p >= 0.5 else round(100 * (1 - p) / p)

def no_vig(prices):
    """[american...] -> no-vig probabilities (same order) or None when any price is missing."""
    ps = [implied(x) for x in prices]
    if any(p is None for p in ps): return None
    s = sum(ps)
    return [p / s for p in ps] if s > 0 else None

def edge(fair_p, price):
    d = decimal(price)
    return None if fair_p is None or d is None else fair_p * d - 1

def markets(kind):
    """(market key, line field or None, [(outcome key, price field, line sign)])"""
    out = []
    if kind not in ("soccer", "mma"):
        out.append(("spread", "homeSpread", [("away", "awaySpreadOdds"), ("home", "homeSpreadOdds")]))
    ml = [("away", "awayML"), ("home", "homeML")]
    if kind == "soccer": ml = [("away", "awayML"), ("draw", "drawML"), ("home", "homeML")]
    out.append(("ml", None, ml))
    if kind != "mma": out.append(("total", "total", [("over", "overOdds"), ("under", "underOdds")]))
    return out

def _isnum(v): return isinstance(v, (int, float)) and not isinstance(v, bool)

def analyze(books, kind):
    """books: {bookKey: flat line dict} (stale books already removed). Returns
    {mk: {line, n, fair: {outcome: p}, fairAm: {outcome: american}, books: {bk: {line, nv: {o: p}, edge: {o: e}, out: [outcomes]}}}}"""
    res = {}
    gap = LINE_GAP.get(kind, LINE_GAP_DEFAULT)
    for mk, lf, outs in markets(kind):
        per = {}
        for bk, b in (books or {}).items():
            if not b: continue
            prices = [b.get(pf) for _, pf in outs]
            if not all(_isnum(x) for x in prices): continue
            ln = b.get(lf) if lf else None
            if lf and not _isnum(ln): continue
            nv = no_vig(prices)
            if not nv: continue
            per[bk] = dict(line=ln, prices=dict(zip([o for o, _ in outs], prices)), nv=dict(zip([o for o, _ in outs], nv)))
        if not per: continue
        # consensus line: most books; a tie means no consensus (fair stays None)
        cnt = {}
        for v in per.values(): cnt[v["line"]] = cnt.get(v["line"], 0) + 1
        top = sorted(cnt.items(), key=lambda x: -x[1])
        cline = top[0][0] if len(top) == 1 or top[0][1] > top[1][1] else None
        on = [bk for bk, v in per.items() if v["line"] == cline] if (len(top) == 1 or cline is not None) else []
        fair = None
        if len(on) >= 2:
            fair = {o: sum(per[bk]["nv"][o] for bk in on) / len(on) for o, _ in outs}
        M = dict(line=cline, n=len(on), fair=fair, fairAm={o: to_american(p) for o, p in fair.items()} if fair else None, books={})
        for bk, v in per.items():
            B = dict(line=v["line"], nv=v["nv"], prices=v["prices"], edge=None, out=[])
            if fair and v["line"] == cline: B["edge"] = {o: edge(fair[o], v["prices"][o]) for o, _ in outs}
            if len(per) >= 3:
                if lf and cline is not None and v["line"] != cline and cnt[cline] >= 2 and abs(v["line"] - cline) >= gap - 1e-9:
                    # spread: a higher home spread helps the home side; total: a lower total helps the over
                    if mk == "spread": B["out"] = ["home" if v["line"] > cline else "away"]
                    else: B["out"] = ["over" if v["line"] < cline else "under"]
                elif v["line"] == cline and len(on) >= 3:
                    others = [x for x in on if x != bk]
                    for o, _ in outs:
                        m = sum(per[x]["nv"][o] for x in others) / len(others)
                        if m - v["nv"][o] >= PRICE_GAP - 1e-9: B["out"].append(o)    # this book prices o cheaper -> better for o bettors
            M["books"][bk] = B
        res[mk] = M
    return res

def label(g, mk, o, line):
    a, h = (g.get("away") or {}).get("abbr") or "Away", (g.get("home") or {}).get("abbr") or "Home"
    f = lambda v: ("+" if v > 0 else "") + (str(int(v)) if float(v).is_integer() else str(v)) if v else "PK"
    if mk == "ml": return {"away": f"{a} ML", "home": f"{h} ML", "draw": "Draw"}[o]
    if mk == "spread": return f"{h} {f(line)}" if o == "home" else f"{a} {f(-line)}"
    return f"{'Over' if o == 'over' else 'Under'} {line:g}"

def value_spots(out_dir, order, now=None, hours=36):
    """Prices closest to / better than the no-vig consensus for today's pre-game games (ET day) plus anything starting in the next `hours`.
    Each row keeps every qualifying book's edge so the browser can show only books legal in the visitor's state."""
    from zoneinfo import ZoneInfo
    ET = ZoneInfo("America/New_York")
    now = now or dt.datetime.now(dt.timezone.utc)
    rows, lines = [], []
    for lg in order:
        try:
            with open(os.path.join(out_dir, lg, "index.json")) as fh: idx = json.load(fh)
        except (OSError, ValueError): continue
        kind = (idx.get("league") or {}).get("kind")
        if kind == "mma": continue
        for g in idx.get("games") or []:
            if g.get("state") != "pre" or not g.get("date"): continue
            t = dt.datetime.fromisoformat(g["date"].replace("Z", "+00:00"))
            if t < now or (t - now).total_seconds() > hours * 3600: continue
            books = {k: v for k, v in (g.get("books") or {}).items() if v and not v.get("stale") and k in BOOKS}
            if len(books) < 2: continue
            for mk, M in analyze(books, kind).items():
                if not M["fair"] or M["n"] < 2: continue
                for bk, B in M["books"].items():           # line outliers: one book hangs a clearly better number than the consensus
                    if B["out"] and B["line"] != M["line"]:
                        o = B["out"][0]
                        lines.append(dict(lg=lg, id=str(g["id"]), d=g["date"], m=f"{(g.get('away') or {}).get('abbr')} @ {(g.get('home') or {}).get('abbr')}",
                                          mk=mk, o=o, bk=bk, lbl=label(g, mk, o, B["line"]), cons=label(g, mk, o, M["line"]), price=B["prices"][o],
                                          gap=abs(B["line"] - M["line"]), today=t.astimezone(ET).date() == now.astimezone(ET).date()))
                for o, p in M["fair"].items():
                    offers = {}
                    for bk, B in M["books"].items():
                        e = (B.get("edge") or {}).get(o)
                        pr = B["prices"][o]
                        if e is not None and e >= VALUE_MIN_EDGE and -1000 <= pr <= VALUE_MAX_PRICE: offers[bk] = [B["prices"][o], round(e * 100, 1), 1 if o in B["out"] else 0]
                    if not offers: continue
                    rows.append(dict(lg=lg, id=str(g["id"]), d=g["date"], m=f"{(g.get('away') or {}).get('abbr')} @ {(g.get('home') or {}).get('abbr')}",
                                     mk=mk, o=o, lbl=label(g, mk, o, M["line"]), fair=round(p, 4), fairAm=M["fairAm"][o], n=M["n"], offers=offers,
                                     today=t.astimezone(ET).date() == now.astimezone(ET).date()))
    rows.sort(key=lambda r: -max(v[1] for v in r["offers"].values()))
    lines.sort(key=lambda r: (-r["gap"], r["d"]))
    return dict(generated=now.isoformat(), minEdge=VALUE_MIN_EDGE, maxPrice=VALUE_MAX_PRICE, priceGap=PRICE_GAP, hours=hours,
                rows=rows[:VALUE_MAX], lines=lines[:30])
