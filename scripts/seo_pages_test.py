"""Tests for scripts/seo_pages.py (crawlable league hub / game / props / team / UFC pages, sitemap, redirects, archive).

Builds from the committed site/data snapshot into a temp copy of site/ (never touches site/), offline, no API key.
Checks every generated page (unique titles + canonicals, og/description, app JS, 21+ / 1-800-GAMBLER / footer, no
'Florida-based', no hard-coded sportsbook offers, no pick language), that every internal link resolves to a file, the
sitemap (valid XML, unique, only real pages, lastmod), robots.txt, /preview/ redirects, the homepage cards, and the
finished-games archive: closing lines captured before the start, the final filled in after the game left the window,
the past-game page, and that a finished game is never pruned.
Usage: python3 scripts/seo_pages_test.py        (DATA_DIR=/path/to/data to test with fresher data)
"""
import html
import json
import os
import re
import shutil
import sys
import tempfile
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
os.environ.pop("ODDS_API_KEY", None)
import previews as pv  # noqa: E402
import seo_pages as SP  # noqa: E402

passed = failed = 0


def check(ok, msg):
    global passed, failed
    if ok:
        passed += 1
    else:
        failed += 1
        print("FAIL", msg)


class Doc(HTMLParser):
    def __init__(self):
        super().__init__()
        self.title, self.meta, self.links, self.hrefs, self.scripts, self.body = None, {}, {}, [], [], {}
        self._t = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "title":
            self._t = ""
        elif tag == "meta":
            k = a.get("name") or a.get("property") or a.get("http-equiv")
            if k:
                self.meta[k.lower()] = a.get("content") or ""
        elif tag == "link" and a.get("rel"):
            self.links[a["rel"]] = a.get("href") or ""
        elif tag == "a" and a.get("href") is not None:
            self.hrefs.append(a["href"])
        elif tag == "script" and a.get("src"):
            self.scripts.append(a["src"])
        elif tag == "body":
            self.body = a
        elif tag == "base":
            self.meta["_base"] = a.get("href") or ""

    def handle_data(self, d):
        if self._t is not None:
            self._t += d

    def handle_endtag(self, tag):
        if tag == "title" and self._t is not None:
            self.title, self._t = self._t.strip(), None


def parse(html):
    d = Doc()
    d.feed(html)
    return d


def ld_scripts(h):
    return [json.loads(raw.replace("<\\/", "</")) for raw in re.findall(r'<script type="application/ld\+json">(.*?)</script>', h, re.S)]


def walk_nodes(o, acc=None):
    acc = [] if acc is None else acc
    if isinstance(o, dict):
        acc.append(o)
        for v in o.values():
            walk_nodes(v, acc)
    elif isinstance(o, list):
        for v in o:
            walk_nodes(v, acc)
    return acc


def node_types(nodes):
    types = set()
    for n in nodes:
        t = n.get("@type")
        if isinstance(t, str):
            types.add(t)
        elif isinstance(t, list):
            types.update(x for x in t if isinstance(x, str))
    return types


GAME_HREF = re.compile(r"(?:^|/)(?:games|fights)/")
RESULT_HREF = re.compile(r"(?:^|/)(?:games|fights|events)/")
LD_TYPES = {
    "hub": {"CollectionPage", "BreadcrumbList"},
    "team": {"SportsTeam", "CollectionPage", "BreadcrumbList"},
    "fighter": {"Person", "CollectionPage", "BreadcrumbList"},
    "game": {"SportsEvent", "BreadcrumbList"},
    "player": {"ProfilePage", "Person", "BreadcrumbList"},
    "event": {"SportsEvent", "BreadcrumbList"},
    "results": {"CollectionPage", "ItemList", "BreadcrumbList"},
    "state": {"WebPage", "BreadcrumbList", "FAQPage"},
    "states": {"CollectionPage", "BreadcrumbList", "ItemList"},
}


def _listed_paths(hrefs, pat):
    """Matching URLs in document order, first time each path appears."""
    out, seen = [], set()
    for href in hrefs:
        if not href or href.startswith(("#", "http:", "https:", "mailto:", "tel:", "sms:", "javascript:", "//")):
            continue
        path = href.split("#", 1)[0].split("?", 1)[0]
        if not pat.search(path):
            continue
        if not path.endswith("/"):
            path += "/"
        if path not in seen:
            seen.add(path)
            out.append(path)
    return out


def visible_game_paths(hrefs):
    """Game and fight URLs in document order, first time each path appears."""
    return _listed_paths(hrefs, GAME_HREF)


def check_item_list(rel, il):
    els = il.get("itemListElement") or []
    check(il.get("@type") == "ItemList" and els and il.get("numberOfItems") == len(els), f"{rel}: ItemList has entries ({il.get('numberOfItems')})")
    ok = all(isinstance(e, dict) and e.get("@type") == "ListItem" and e.get("position") == i and e.get("name") and str(e.get("url") or "").startswith(SP.BASE_URL) for i, e in enumerate(els, 1))
    check(ok, f"{rel}: ItemList positions, names and absolute urls")
    return [e.get("url", "")[len(SP.BASE_URL):] if str(e.get("url") or "").startswith(SP.BASE_URL) else e.get("url") for e in els]


def check_page_ld(rel, h, hrefs, kind):
    """Every generated page: JSON-LD parses and carries the types that page should. Hubs and team pages: ItemList matches the game links."""
    try:
        tops = ld_scripts(h)
    except json.JSONDecodeError as e:
        check(False, f"{rel}: JSON-LD does not parse ({e})")
        return
    nodes = walk_nodes(tops)
    types = node_types(nodes)
    check(bool(tops) and bool(types), f"{rel}: JSON-LD present")
    missing = LD_TYPES.get(kind, set()) - types
    check(not missing, f"{rel}: JSON-LD types {sorted(types)} missing {sorted(missing)}")
    check("SearchAction" not in types, f"{rel}: no SearchAction")
    games = visible_game_paths(hrefs)
    lists = [n for n in nodes if n.get("@type") == "ItemList"]
    if kind in ("hub", "team", "fighter"):
        if not games:
            check(not lists, f"{rel}: no ItemList when the page links no games")
            return
        check(len(lists) == 1, f"{rel}: one ItemList ({len(lists)})")
        if not lists:
            return
        paths = check_item_list(rel, lists[0])
        check(paths == games, f"{rel}: ItemList matches visible game links ({len(paths)} vs {len(games)}; extra {paths[:2] if paths != games else ''})")
        pages = [n for n in nodes if n.get("@type") == "CollectionPage"]
        check(pages and (pages[0].get("mainEntity") or {}).get("@type") == "ItemList", f"{rel}: ItemList is the CollectionPage mainEntity")
        if kind == "hub":
            check(any(n.get("@type") == "CollectionPage" for n in tops), f"{rel}: hub CollectionPage is top-level")
        else:
            want = "Person" if kind == "fighter" else "SportsTeam"
            ents = [n for n in nodes if n.get("@type") == want]
            about = (pages[0].get("about") or {}).get("@id") if pages else ""
            check(ents and ents[0].get("@id") and ents[0].get("@id") == about, f"{rel}: page about the {want}")
    elif kind == "results":
        pages = [n for n in nodes if n.get("@type") == "CollectionPage"]
        check(pages and any(n.get("@type") == "CollectionPage" for n in tops), f"{rel}: CollectionPage is top-level")
        check(pages and (pages[0].get("mainEntity") or {}).get("@type") == "ItemList", f"{rel}: ItemList is the CollectionPage mainEntity")
        want = _listed_paths(hrefs, RESULT_HREF)
        check(len(lists) == 1, f"{rel}: one ItemList ({len(lists)})")
        if lists and want:
            paths = check_item_list(rel, lists[0])
            check(paths == want, f"{rel}: ItemList matches result links ({len(paths)} vs {len(want)})")
        elif lists:
            check(lists[0].get("numberOfItems") == 0, f"{rel}: empty results page has an empty ItemList")
    elif kind == "state":
        pages = [n for n in nodes if n.get("@type") == "WebPage"]
        about = (pages[0].get("about") or {}) if pages else {}
        check(pages and about.get("@type") == "State" and about.get("name"), f"{rel}: WebPage about a State")
        faqs = [n for n in nodes if n.get("@type") == "FAQPage"]
        check(len(faqs) == 1, f"{rel}: one FAQPage")
        ents = (faqs[0].get("mainEntity") or []) if faqs else []
        check(4 <= len(ents) <= 6, f"{rel}: FAQ has 4-6 questions ({len(ents)})")
        visible = html.unescape(h)
        for ent in ents:
            q, a = ent.get("name") or "", ((ent.get("acceptedAnswer") or {}).get("text") or "")
            check(bool(q and a) and q in visible and a in visible, f"{rel}: FAQ schema matches the visible text ({q[:48]})")
        book_lists = [n for n in lists if str(n.get("name") or "").startswith("Books we compare")]
        if book_lists:
            els = book_lists[0].get("itemListElement") or []
            check(book_lists[0].get("numberOfItems") == len(els) and els, f"{rel}: book ItemList has entries")
            check(all(e.get("@type") == "ListItem" and e.get("position") == i and str(e.get("url") or "").startswith("https://") for i, e in enumerate(els, 1)), f"{rel}: book ItemList positions and https urls")
    elif kind == "states":
        check(any(n.get("@type") == "CollectionPage" for n in tops), f"{rel}: CollectionPage is top-level")
        check(len(lists) == 1, f"{rel}: one ItemList ({len(lists)})")
        if lists:
            paths = check_item_list(rel, lists[0])
            want = [p for p in _listed_paths(hrefs, re.compile(r"^[a-z0-9-]+/$")) if p.split("/")[0] not in SP.LEAGUE_DIRS and p != "states/"]
            check(paths == want, f"{rel}: ItemList matches state links ({len(paths)} vs {len(want)})")
    else:
        check(not lists, f"{rel}: ItemList only on hubs, team, results and state pages")


def title_limit_tests():
    """Title cap includes the brand suffix; descriptions stop at 155; dedupe cannot push a title back over."""
    check(SP.TITLE_MAX == 60 and SP.DESC_MAX == 155 and len(SP.SUFFIX) == 12, "title 60 including suffix, description 155")
    check(SP.short_person("Christopher Rodriguez Jr.") == "Rodriguez" and SP.short_person("Alan Alpha") == "Alpha", "short person name skips Jr/Sr")
    check(SP.fit("x" * 70, "Short") == "Short" + SP.SUFFIX, "fit(): first candidate that fits with the suffix")
    check(SP.fit("y" * 50, "z" * 55) == "y" * 50, "fit(): drop the suffix rather than exceed 60")
    check(SP.fit("z" * 55, "y" * 50) == "z" * 55, "fit(): first candidate that fits without the suffix")
    long = "North Carolina State Wolfpack versus Appalachian State Mountaineers Odds"
    out = SP.fit(long)
    bare = SP.bare_title(out)
    check(len(out) <= SP.TITLE_MAX and long.startswith(bare) and (bare == long or long[len(bare):].startswith(" ")), f"fit(): word boundary, never mid-word ({out})")
    check(SP.fit("x" * 70) == "x" * SP.TITLE_MAX, "fit(): a single over-long token still stays within 60")
    dated = SP.with_extra("A" * 48, ", Oct 27")
    check(len(dated) <= SP.TITLE_MAX and dated.endswith(", Oct 27") and not dated.endswith(SP.SUFFIX), f"with_extra(): date kept by dropping the suffix ({dated})")
    kept = SP.with_extra("Rays vs Brewers Odds", ", Oct 27")
    check(kept == "Rays vs Brewers Odds, Oct 27" + SP.SUFFIX and len(kept) <= SP.TITLE_MAX, f"with_extra(): suffix stays when the dated title fits ({kept})")
    slug = SP.with_extra("M" * 40, " (" + "n" * 80 + ")")
    check(len(slug) <= SP.TITLE_MAX and "n" in slug, f"with_extra(): long slug stays inside the cap ({len(slug)})")
    clipped = SP.cut("word " * 80)
    check(len(clipped) <= SP.DESC_MAX and clipped.endswith("…") and not clipped[:-1].endswith(" "), f"cut(): descriptions end on a word ({len(clipped)})")
    check(SP.cut("Short description.") == "Short description.", "cut(): short text unchanged")
    sample = "Free NFL odds comparison: spreads, totals and moneylines from DraftKings, Hard Rock Bet and FanDuel, line movement and final scores."
    check(len(sample) <= SP.DESC_MAX and not PROMO_RE.search(sample) and "Florida" not in sample, "comparison description: no promo wording and no Florida availability claim")


OFFER = re.compile(r'class="of-book|Bet on (DraftKings|FanDuel|Hard Rock|BetMGM|Caesars|Fanatics)|href="https?://[^"]*(draftkings|fanduel|hardrock|betmgm|caesars|fanatics)[^"]*"', re.I)


def mask_official(h):
    """Official book URLs from the data file are not offers. Any other book-domain href still fails."""
    for url in (SP.load_books().get("urls") or {}).values():
        h = h.replace(f'href="{url}"', 'href="https://example.com/book"')
    return h
PROMO_RE = re.compile(r"\b(free bets?|risk[- ]free|no[- ]risk|guaranteed|bonus bets?|no[- ]sweat|free plays?)\b", re.I)   # same list as compliance_test.mjs
BAD_NAME = re.compile(r"\bRod\b|Rodney", re.I)


EV_DUR = {"nfl": 3.5, "ncaaf": 3.5, "nba": 2.5, "ncaab": 2.5, "nhl": 2.5, "mlb": 3, "ufc": 3}
ISO_OFF = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?[+-]\d\d:\d\d$")


def event_ld_ok(rel, h, lg, kind):
    """Google Event structured data on a game / fight / UFC event page: parses, has the required fields (name, startDate,
    location + address) and the ones Search Console flagged (endDate, performer, organizer.url), no invented offers."""
    lds = [json.loads(x.replace("<\\/", "</")) for x in re.findall(r'<script type="application/ld\+json">(.*?)</script>', h, re.S)]
    evs = [x for x in lds if x.get("@type") == "SportsEvent"]
    check(len(evs) == 1, f"{rel}: one SportsEvent JSON-LD ({len(evs)})")
    if not evs:
        return None
    ev = evs[0]
    st, en = pv.parse_dt(ev.get("startDate")), pv.parse_dt(ev.get("endDate"))
    check(ev.get("name") and ev.get("url") == SP.BASE_URL + rel and ISO_OFF.match(ev.get("startDate") or ""), f"{rel}: name, url, startDate with offset")
    check(ISO_OFF.match(ev.get("endDate") or "") and st and en and en > st, f"{rel}: endDate with offset after startDate ({ev.get('startDate')} -> {ev.get('endDate')})")
    if kind != "event":
        check(bool(st and en) and en - st == timedelta(hours=EV_DUR[lg]), f"{rel}: endDate = start + {EV_DUR[lg]}h for {lg}")
    loc = ev.get("location") or {}
    check(loc.get("@type") == "Place" and (loc.get("address") or {}).get("@type") == "PostalAddress" and (loc.get("address") or {}).get("addressCountry"), f"{rel}: location Place + PostalAddress")
    check(loc.get("name") not in ("TBD", ""), f"{rel}: no placeholder venue name")
    org = ev.get("organizer") or {}
    check(org.get("name") and str(org.get("url") or "").startswith("https://") and org.get("url") == SP.ORGANIZER[lg][2], f"{rel}: organizer name + official url ({org})")
    perf = ev.get("performer") or []
    want = "Person" if lg == "ufc" else "SportsTeam"
    check(len(perf) >= 2 and (kind == "event" or len(perf) == 2) and all(p.get("@type") == want and p.get("name") for p in perf), f"{rel}: performer {want}s with names")
    check(all(str(p.get("url", SP.BASE_URL)).startswith(SP.BASE_URL) for p in perf) and any(p.get("url") for p in perf), f"{rel}: performers link LineSmart team/fighter pages")
    check(ev.get("eventStatus", "").startswith("https://schema.org/Event") and ev.get("eventAttendanceMode") == "https://schema.org/OfflineEventAttendanceMode", f"{rel}: eventStatus + attendance mode")
    check("offers" not in ev, f"{rel}: no offers (LineSmart sells no tickets)")
    if lg != "ufc":
        check(ev.get("homeTeam", {}).get("name") and ev.get("awayTeam", {}).get("name") and len(ev.get("competitor") or []) == 2, f"{rel}: homeTeam / awayTeam / competitor kept")
    return ev


def ufc_fixture(now):
    """Small UFC card (upcoming, two segments) + a finished one, in the shape scripts/ufc.py writes."""
    def f(i, name, rec="10-2-0", win=None):
        return {"id": str(i), "abbr": name.split()[-1].upper(), "name": name, "short": name, "last": name.split()[-1], "record": rec, "country": "USA", "winner": win}
    def ev(eid, name, d0, segs, state, venue):
        return {"id": eid, "name": name, "short": name.split(":")[0], "date": d0, "state": state, **venue, "segments": segs, "broadcasts": ["Paramount+"]}
    now = now.replace(minute=0, second=0, microsecond=0)   # JSON-LD times are to the minute
    vx = {"venue": "Meta APEX", "city": "Las Vegas", "venueState": "NV", "venueCountry": "USA"}
    d_pre, d_main = SP.iso(now + timedelta(days=2)), SP.iso(now + timedelta(days=2, hours=3))
    d_past = SP.iso(now - timedelta(days=2))
    def bout(i, d, a, h, e, seg, state="pre", main=False):
        return {"id": str(i), "date": d, "name": f"{a['name']} vs. {h['name']}", "state": state, "statusDetail": "Final" if state == "post" else "Sat",
                "completed": state == "post", **vx, "away": a, "home": h, "event": {"id": e["id"], "name": e["name"]}, "segment": seg,
                "segmentName": "Main Card" if seg == "main" else "Prelims", "matchNo": 1 if main else 5, "weightClass": "Lightweight", "rounds": 5 if main else 3,
                "mainEvent": main, "result": ({"winner": a["id"], "method": "Decision"} if state == "post" else None), "books": {}, "odds": None}
    e1 = ev("900001", "UFC Fight Night: Alpha vs. Bravo", d_pre, [{"key": "main", "name": "Main Card", "start": d_main}, {"key": "prelims1", "name": "Prelims", "start": d_pre}], "pre", vx)
    e2 = ev("900002", "UFC 999: Charlie vs. Delta", d_past, [{"key": "main", "name": "Main Card", "start": d_past}], "post", vx)
    games = [bout(1, d_main, f(11, "Alan Alpha"), f(12, "Bob Bravo"), e1, "main", main=True), bout(2, d_pre, f(13, "Carl Echo"), f(14, "Dan Fox"), e1, "prelims1"),
             bout(3, d_past, f(15, "Cal Charlie", win=True), f(16, "Don Delta", win=False), e2, "main", state="post", main=True)]
    return {"generated": SP.iso(now), "league": {"key": "ufc", "name": "UFC", "full": "UFC (Mixed Martial Arts)", "kind": "mma"}, "teams": {}, "events": [e1, e2], "games": games}


def page_dirs(site):
    for d in SP.GEN_DIRS:
        if (site / d).exists():
            yield from sorted((site / d).rglob("index.html"))


def resolve(site, page_rel, base, href):
    """File a relative href points to (or None for anchors / external / app routes)."""
    if not href or href.startswith(("#", "http:", "https:", "mailto:", "tel:", "sms:", "javascript:", "//")):
        return None
    href = href.split("#", 1)[0].split("?", 1)[0]
    root = Path(os.path.normpath(str(Path("/") / page_rel / base))) if base is not None else Path("/") / page_rel
    t = Path(os.path.normpath(str(root / href))) if href else root
    f = site / str(t).lstrip("/")
    if href.endswith("/") or href == "" or f.is_dir():
        return f / "index.html"
    return f


def build_copy(tmp, name="site"):
    site = tmp / name
    top = str(ROOT / "site")

    def ign(d, names):   # generated output only at the top of site/ (site/data/nfl/ is input)
        if d == top:
            return [n for n in names if n in SP.GEN_DIRS or n == ".seo.tmp" or (n.startswith(".") and n.endswith(".old"))]
        return ["pages.json"] if d.endswith("data") else []
    shutil.copytree(ROOT / "site", site, ignore=ign)
    if os.environ.get("DATA_DIR"):     # test against fresher data (e.g. a deployed snapshot with props and UFC)
        shutil.rmtree(site / "data")
        shutil.copytree(os.environ["DATA_DIR"], site / "data", ignore=shutil.ignore_patterns("pages.json"))
    return site


WTW_ADVICE = re.compile(r"\b(cents?|bet this|lean|value play|sharp|juice|vig|hook|steam|chalk|fade|hammer|lock)\b", re.I)


def wtw_league(lg, kind, games, props=None):
    ix = {"league": {"kind": kind}, "games": games, "generated": "2026-10-26T00:00:00Z"}
    L = SP.League(lg, ix, props, None, pv.parse_dt("2026-10-26T00:00:00Z"), SP.BASE_URL)
    L.current = {g["id"] for g in games}
    return L


def wtw_game(**kw):
    g = {"id": "9001", "state": "pre", "date": "2026-11-01T17:00Z",
         "away": {"id": "6", "name": "Dallas Cowboys", "short": "Cowboys", "abbr": "DAL"},
         "home": {"id": "21", "name": "Philadelphia Eagles", "short": "Eagles", "abbr": "PHI"}}
    g.update(kw)
    return g


def wtw_clean(notes, what):
    for k, t in notes:
        bad = pv.FORBIDDEN.search(t) or PROMO_RE.search(t) or WTW_ADVICE.search(t)
        check(not bad, f"wtw {what}/{k}: no pick, promo or slang words ({bad and bad.group(0)})")


def wtw_tests():
    """'What to watch' notes: real data only, plain dollars, skipped when missing."""
    books = {"draftkings": {"homeML": -162, "awayML": 136, "homeSpread": -3.5, "awaySpread": 3.5, "homeSpreadOdds": -110, "awaySpreadOdds": -110,
                            "total": 44.5, "overOdds": -110, "underOdds": -110},
             "hardrockbet": {"homeML": -150, "awayML": 134, "homeSpread": -3.5, "awaySpread": 3.5, "homeSpreadOdds": -112, "awaySpreadOdds": -108,
                             "total": 44.5, "overOdds": -108, "underOdds": -112},
             "fanduel": {"homeML": -158, "awayML": 134, "homeSpread": -4, "awaySpread": 4, "homeSpreadOdds": -105, "awaySpreadOdds": -115,
                         "total": 45, "overOdds": -110, "underOdds": -110}}
    move = {"book": "draftkings", "since": "2026-10-20T12:00:00Z", "spread": {"open": 3, "cur": -3.5, "delta": -6.5}, "total": {"open": 48.5, "cur": 44.5, "delta": -4}}
    wx = {"kind": "forecast", "label": "Light rain", "temp": 41, "wind": 18, "gust": 29, "pop": 70, "precipType": "rain", "watch": [{"k": "wind"}]}
    detail = {"injuriesAvailable": True, "injuries": {
        "6": [{"player": "Guard One", "pos": "G", "status": "Out"}, {"player": "Dak Prescott", "pos": "QB", "status": "Out"},
              {"player": "Wide Out", "pos": "WR", "status": "Doubtful"}, {"player": "Maybe Guy", "pos": "TE", "status": "Questionable"}],
        "21": [{"player": "Long Term", "pos": "RB", "status": "Injured Reserve"}]}}
    log = [["2026-10-25", "NYG", "vs", {"rec_yds": 80}], ["2026-10-18", "WSH", "@", {"rec_yds": 95}], ["2026-10-11", "NYG", "@", {"rec_yds": 71}],
           ["2026-10-04", "SF", "vs", {"rec_yds": 102}], ["2026-09-27", "LAR", "@", {"rec_yds": 40}]]
    props = {"markets": {"rec_yds": ["Receiving yards", "Rec yds"]}, "players": {"77": {"n": "CeeDee Lamb", "ta": "DAL", "pos": "WR", "log": log}},
             "games": {"9001": {"props": [["77", "rec_yds", 65.5, None, None, {"draftkings": {}}]]}}}
    g = wtw_game(books=books, move=move, weather=wx)
    L = wtw_league("nfl", "football", [g], props)
    notes = SP.what_to_watch(L, g, "9001", detail)
    by = dict(notes)
    check([k for k, _ in notes] == ["gap", "move", "inj", "wx"], f"wtw: gap, move, injuries, notable weather first; max {SP.WTW_MAX} ({[k for k, _ in notes]})")
    check(by.get("gap") == "Eagles moneyline: risk $150 to win $100 at Hard Rock Bet vs $162 at DraftKings.", f"wtw gap in plain dollars ({by.get('gap')})")
    check(by.get("move") == "Eagles spread moved from +3 to -3.5 and the total from 48.5 to 44.5 since the opening line (DraftKings).", f"wtw movement ({by.get('move')})")
    check(by.get("inj") == "Listed out for the Cowboys: Guard One (G), Dak Prescott (QB) and 1 more.", f"wtw injuries: out/doubtful only, report order, IR/questionable skipped ({by.get('inj')})")
    check(by.get("wx") == "Forecast near the start: Light rain, 41°F, wind 18 mph (gusts 29 mph), 70% chance of rain.", f"wtw weather ({by.get('wx')})")
    check(SP.wtw_prop(L, "9001") == "CeeDee Lamb went over 65.5 receiving yards in 4 of the last 5 games.", f"wtw hot prop with last-5 rate ({SP.wtw_prop(L, '9001')})")
    wtw_clean(notes + [("prop", SP.wtw_prop(L, "9001"))], "full")
    sec = SP.wtw_section(notes)
    check(sec.count("<li ") == 4 and 'id="wtw-s"' in sec and ">What to watch</h2>" in sec and "not a prediction" in sec and "ld+json" not in sec, "wtw section: visible list + disclaimer, no JSON-LD")
    # underdog prices: what a $100 bet wins
    g2 = wtw_game(books={"draftkings": {"awayML": 170}, "fanduel": {"awayML": 185}})
    check(SP.wtw_gap(wtw_league("nfl", "football", [g2]), g2) == "Cowboys moneyline: a $100 bet wins $185 at FanDuel vs $170 at DraftKings.", "wtw gap: underdog wording")
    # mild weather fills a spare slot after the prop; one book = no gap; small gaps skipped
    g3 = wtw_game(books={"draftkings": books["draftkings"]}, weather=dict(wx, wind=6, gust=8, pop=0, label="Clear", watch=[]))
    L3 = wtw_league("nfl", "football", [g3], props)
    n3 = SP.what_to_watch(L3, g3, "9001", {})
    check([k for k, _ in n3] == ["prop", "wx"] and dict(n3)["wx"] == "Forecast near the start: Clear, 41°F, wind 6 mph (gusts 8 mph).", f"wtw: one book -> no gap, no move/injuries data -> skipped, mild weather last ({n3})")
    g4 = wtw_game(books={"draftkings": {"homeML": -110}, "fanduel": {"homeML": -112}})
    check(SP.wtw_gap(wtw_league("nfl", "football", [g4]), g4) is None, "wtw gap: under $5 difference skipped")
    # nothing known -> no notes, no section; indoor / pending weather never a note
    g5 = wtw_game(weather={"kind": "indoor", "roof": "dome"})
    L5 = wtw_league("nfl", "football", [g5])
    check(SP.what_to_watch(L5, g5, "9001", {}) == [] and SP.wtw_section([]) == "", "wtw: no data -> no section")
    # finals, live games and games outside the data window get nothing
    for st, extra in (("post", {}), ("in", {}), ("pre", {"completed": True})):
        gf = wtw_game(state=st, books=books, move=move, **extra)
        check(SP.what_to_watch(wtw_league("nfl", "football", [gf], props), gf, "9001", detail) == [], f"wtw: none for state={st} {extra}")
    gx = wtw_game(books=books)
    Lx = wtw_league("nfl", "football", [gx]); Lx.current = set()
    check(SP.what_to_watch(Lx, gx, "9001", {}) == [], "wtw: none for archived games")
    # hockey: moneyline move (not -101 -> +101 noise), puck line label, goals total
    gh = wtw_game(books={"draftkings": {"homeSpread": -1.5, "homeSpreadOdds": 180, "total": 6.5, "overOdds": 102}, "fanduel": {"homeSpread": -1.5, "homeSpreadOdds": 165, "total": 6.5, "overOdds": -104}},
                  move={"book": "draftkings", "homeML": {"open": -135, "cur": -162}, "awayML": {"open": 101, "cur": -101}})
    Lh = wtw_league("nhl", "hockey", [gh])
    check(SP.wtw_gap(Lh, gh) == "Eagles -1.5 puck line: a $100 bet wins $180 at DraftKings vs $165 at FanDuel.", f"wtw hockey gap ({SP.wtw_gap(Lh, gh)})")
    check(SP.wtw_move(Lh, gh) == "Eagles moneyline moved from -135 to -162 since the opening line (DraftKings).", f"wtw hockey move ({SP.wtw_move(Lh, gh)})")
    gn = wtw_game(move={"book": "draftkings", "awayML": {"open": 101, "cur": -101}})
    check(SP.wtw_move(wtw_league("nhl", "hockey", [gn]), gn) is None, "wtw: +101 -> -101 is not a move")


def edge_cases(tmp):
    """Postponed stays a live page, canceled has no score, a renamed team leaves a stub, thin finals stay up."""
    site = build_copy(tmp, "siteE")
    data = site / "data"
    now = pv.parse_dt(json.loads((data / "meta.json").read_text())["generated"])
    ix = json.loads((data / "nfl" / "index.json").read_text())

    def side(tid, name, abbr, score=None, winner=False):
        row = {"id": str(tid), "abbr": abbr, "name": name, "short": name.split()[-1], "record": "1-0"}
        if score is not None:
            row["score"] = score
        if winner:
            row["winner"] = True
        return row

    def game(gid, when, away, home, state, detail, books=None):
        return {"id": gid, "date": SP.iso(when), "state": state, "statusDetail": detail, "completed": state == "post" and "postpon" not in detail.lower() and "cancel" not in detail.lower(),
                "venue": "Test Field", "city": "Miami", "venueState": "FL", "venueCountry": "US",
                "home": home, "away": away, "books": books or {}, "odds": None}

    books = {"draftkings": {"homeSpread": -3.5, "awaySpread": 3.5, "homeSpreadOdds": -110, "awaySpreadOdds": -110,
                            "homeML": -160, "awayML": 140, "total": 44.5, "overOdds": -110, "underOdds": -110, "asOf": SP.iso(now - timedelta(hours=5))},
             "hardrockbet": {"homeSpread": -3, "awaySpread": 3, "homeML": -150, "awayML": 130, "total": 45, "overOdds": -110, "underOdds": -110}}
    A, B, C, D = side("91001", "Alpha Test", "ALP"), side("91002", "Beta Test", "BET"), side("91003", "Gamma Test", "GAM"), side("91004", "Delta Test", "DEL")
    thin = game("pp-thin", now - timedelta(days=80), side("91001", "Alpha Test", "ALP", 10), side("91002", "Beta Test", "BET", 20, True), "post", "Final")
    lined = game("pp-lined", now - timedelta(days=40), side("91003", "Gamma Test", "GAM", 14), side("91004", "Delta Test", "DEL", 21, True), "post", "Final", books)
    post = game("pp-post", now - timedelta(days=2), side("91001", "Alpha Test", "ALP"), side("91003", "Gamma Test", "GAM"), "post", "Postponed", books)
    can = game("pp-can", now - timedelta(days=3), side("91003", "Gamma Test", "GAM", 0), side("91004", "Delta Test", "DEL", 0), "post", "Canceled")
    pre = game("pp-pre", now + timedelta(days=3), side("91001", "Alpha Test", "ALP"), side("91004", "Delta Test", "DEL"), "pre", "Sun", books)
    ix["games"].extend([thin, lined, post, can, pre])
    (data / "nfl" / "index.json").write_text(json.dumps(ix))
    arch = tmp / "archE"
    SP.build(site, data, now, archive_dir=arch)
    man = json.loads((data / "pages.json").read_text())
    gman = man["g"]["nfl"]

    def page(gid):
        rel = gman[gid]
        return rel, (site / rel / "index.html").read_text()

    rel, h = page("pp-thin")
    check("Closing lines not recorded" in h and "Final score" in h, "final with no closing line says so, and still has the score")
    rel, h = page("pp-lined")
    check("Closing lines" in h and "Closed at" in h and 'class="card sx-result"' in h, "final with lines shows the closing table and the closed-at time")
    ev = event_ld_ok(rel, h, "nfl", "game")
    check(ev and ev.get("eventStatus") == "https://schema.org/EventScheduled", "lined final keeps EventScheduled")
    rel, h = page("pp-post")
    check("Postponed" in h and "Final score" not in h and 'class="sx-score' not in h, "postponed page stays up and is not a final")
    ev = event_ld_ok(rel, h, "nfl", "game")
    check(ev and ev.get("eventStatus") == "https://schema.org/EventPostponed", "postponed JSON-LD is EventPostponed")
    check(f'href="{rel}"' not in (site / "nfl" / "results" / "index.html").read_text().split('id="recent-s"', 1)[-1].split('id="by-team"', 1)[0], "postponed game is not listed as a result")
    rel, h = page("pp-can")
    check("Canceled" in h and "No score" in h and 'class="sx-score' not in h, "canceled page stays up and shows no score")
    ev = event_ld_ok(rel, h, "nfl", "game")
    check(ev and ev.get("eventStatus") == "https://schema.org/EventCancelled", "canceled JSON-LD is EventCancelled")
    check((site / "nfl" / "results" / "index.html").exists() and "CollectionPage" in (site / "nfl" / "results" / "index.html").read_text(), "results index has CollectionPage")
    # reschedule: old slug becomes a stub
    old_pre = gman["pp-pre"]
    ix = json.loads((data / "nfl" / "index.json").read_text())
    for g in ix["games"]:
        if g["id"] == "pp-pre":
            g["date"] = SP.iso(now + timedelta(days=10))
    (data / "nfl" / "index.json").write_text(json.dumps(ix))
    SP.build(site, data, now + timedelta(hours=1), archive_dir=arch)
    man = json.loads((data / "pages.json").read_text())
    new_pre = man["g"]["nfl"]["pp-pre"]
    check(new_pre != old_pre and (site / old_pre / "index.html").exists(), f"reschedule keeps the old path as a stub ({old_pre} -> {new_pre})")
    stub = (site / old_pre / "index.html").read_text()
    check(f'rel="canonical" href="{SP.BASE_URL + new_pre}"' in stub or f'href="{SP.BASE_URL + new_pre}"' in stub, "reschedule stub canonical points at the new page")
    check("http-equiv" in stub and "refresh" in stub, "reschedule stub meta-refreshes")
    # team rename
    old_team = man["t"]["nfl"]["91002"]
    ix = json.loads((data / "nfl" / "index.json").read_text())
    for g in ix["games"]:
        for s in ("home", "away"):
            if str((g.get(s) or {}).get("id")) == "91002":
                g[s]["name"] = "Beta Renamed"
    (data / "nfl" / "index.json").write_text(json.dumps(ix))
    SP.build(site, data, now + timedelta(hours=2), archive_dir=arch)
    man = json.loads((data / "pages.json").read_text())
    new_team = man["t"]["nfl"]["91002"]
    check(new_team != old_team and "beta-renamed" in new_team, f"rename moves the team URL ({old_team} -> {new_team})")
    th = (site / old_team / "index.html").read_text()
    check(f'href="{SP.BASE_URL + new_team}"' in th and "refresh" in th, "old team slug is a canonical + meta-refresh stub")
    stored = json.loads((arch / "state.json").read_text())["team_paths"]["nfl"]["91002"]
    check(stored[0] == new_team and old_team in stored, f"team_paths remembers the old slug ({stored})")
    # drop them out of the data window: pages stay
    ix = json.loads((data / "nfl" / "index.json").read_text())
    ix["games"] = [g for g in ix["games"] if not str(g["id"]).startswith("pp-")]
    (data / "nfl" / "index.json").write_text(json.dumps(ix))
    SP.build(site, data, now + timedelta(days=70), archive_dir=arch)
    man = json.loads((data / "pages.json").read_text())["g"]["nfl"]
    for gid in ("pp-thin", "pp-lined", "pp-post", "pp-can"):
        check(gid in man and (site / man[gid] / "index.html").exists(), f"{gid} still published 70 days later")
    check("Postponed" in (site / man["pp-post"] / "index.html").read_text(), "postponed game is still labeled Postponed after it leaves the window")
    check("Closing lines not recorded" in (site / man["pp-thin"] / "index.html").read_text(), "thin final still says closing lines were not recorded")


def _main_text(h):
    return h.split('id="app">', 1)[1].split("</main>", 1)[0]


def state_built_checks(site):
    """Pages built from the data file: Florida, a full legal state, an uncertain state, an empty book list."""
    doc = SP.load_books()
    legal = {slug for _, _, slug in SP.legal_states(doc)}
    check(len(legal) == 33 and all((site / slug / "index.html").exists() for slug in legal), "a page for every onlineLegal state")
    check((site / "states" / "index.html").exists(), "/states/ index exists")
    for code, st in doc["states"].items():
        slug = st.get("slug") or ""
        if st.get("onlineLegal"):
            continue
        check(not slug or not (site / slug).exists(), f"{code}: no neutral page yet")
    fl = (site / "florida" / "index.html").read_text()
    fl_main = _main_text(fl)
    check("only legal online sportsbook" in fl_main and "Hard Rock Bet" in fl_main, "Florida says Hard Rock Bet is the only legal online sportsbook")
    check("DraftKings" not in fl_main and "FanDuel" not in fl_main, "Florida main does not name DraftKings or FanDuel")
    check("BetMGM" not in fl_main and "betmgm" not in fl_main.lower(), "BetMGM never appears on the Florida page")
    check("https://www.hardrock.bet/" in fl_main and "as of" in fl_main.lower() or "October 26, 2026" in fl_main, "Florida has the as-of date")
    check("October 26, 2026" in fl_main and "https://www.americangaming.org/" in fl_main, "Florida shows asOf and a source link")
    check("1-833-PLAYWISE" in fl_main and "1-800-GAMBLER" in fl_main, "Florida helpline is 1-833-PLAYWISE plus 1-800-GAMBLER")
    check('data-page="state"' in fl and 'data-route="' not in fl, "Florida page stays static")
    ny = _main_text((site / "new-york" / "index.html").read_text())
    check("DraftKings" in ny and "FanDuel" in ny and "BetMGM" in ny, "New York lists its books")
    check("Status unconfirmed" not in ny and "1-877-8-HOPENY" in ny, "New York is a straight legal page with its helpline")
    la = _main_text((site / "louisiana" / "index.html").read_text())
    check("Status unconfirmed" in la and "parishes" in la, "Louisiana shows the note and status unconfirmed")
    check("Online sports betting is legal in Louisiana" not in la, "Louisiana does not get a flat yes")
    de = _main_text((site / "delaware" / "index.html").read_text())
    check("lists none of the books we compare" in de and "Status unconfirmed" not in de, "Delaware says we list none of our books")
    nv = _main_text((site / "nevada" / "index.html").read_text())
    check("Status unconfirmed" in nv and "lists none of the books we compare" in nv, "Nevada is unconfirmed and lists no books")
    check("1-800-GAMBLER" in _main_text((site / "ohio" / "index.html").read_text()) and "1-833-PLAYWISE" not in _main_text((site / "ohio" / "index.html").read_text()), "Ohio uses 1-800-GAMBLER")
    hub = (site / "nfl" / "index.html").read_text()
    check('href="states/"' in hub, "NFL hub links to /states/")
    idx = (site / "states" / "index.html").read_text()
    check(idx.count('href="florida/"') >= 1 and "texas/" not in idx and "wisconsin/" not in idx, "index lists legal states only")


def state_unit_tests():
    """Slug clash, stale asOf, and templates with no state-specific legal strings."""
    import inspect
    doc = SP.load_books()
    check(len(SP.legal_states(doc)) == 33, f"33 onlineLegal states ({len(SP.legal_states(doc))})")
    check(not SP.slug_clashes(doc), f"state slugs do not clash ({SP.slug_clashes(doc)})")
    check(doc["states"]["DC"]["slug"] == "washington-dc" and doc["states"]["NY"]["slug"] == "new-york", "DC and New York slugs")
    check(doc["states"]["FL"]["books"] == ["hardrockbet"] and "betmgm" not in doc["states"]["FL"]["books"], "Florida data is Hard Rock Bet only")
    for code in ("LA", "WI", "PR", "AR", "MS"):
        check(doc["states"][code].get("uncertain") and doc["states"][code].get("note"), f"{code}: uncertain, with a note")
    fake = json.loads(json.dumps(doc))
    fake["states"]["ZZ"] = {"name": "NFL", "onlineLegal": True, "books": [], "slug": "nfl"}
    check("nfl" in SP.slug_clashes(fake), "a slug of nfl clashes with the league folder")
    stale_day = datetime(2026, 11, 26).date()
    check(SP.books_age_days(doc, stale_day) == 31, "asOf age is counted in days")
    try:
        SP.require_fresh_books(doc, stale_day)
        check(False, "stale asOf must abort the build")
    except SystemExit as e:
        check("asOf" in str(e), f"stale asOf aborts ({e})")
    check(SP.books_age_days(doc, datetime(2026, 10, 28).date()) <= SP.ASOF_MAX_DAYS, "asOf is fresh on 2026-10-28")
    src = "\n".join(inspect.getsource(fn) for fn in (SP.legal_copy, SP.state_faqs, SP.state_title, SP.state_desc, SP.state_page, SP.states_index, SP.books_block, SP.lines_block))
    for bad in ("Florida", "Louisiana", "BetMGM", "Hard Rock", "DraftKings", "FanDuel", "only legal"):
        check(bad not in src, f"state templates have no {bad!r}")
    js = (ROOT / "site" / "assets" / "books-by-state.js").read_text()
    check(js == SP.books_js(doc), "books-by-state.js is the generated copy of the JSON")
    home = (ROOT / "site" / "index.html").read_text()
    check(re.search(re.escape(SP.HOME_START) + re.escape(SP.HOME_END), home), "homepage markers stay empty in the committed file")
    for slug in ("florida", "new-york", "new-jersey", "pennsylvania", "illinois", "ohio", "michigan", "arizona", "colorado", "north-carolina", "virginia", "massachusetts", "states"):
        check(f'href="{slug}/"' in home, f"homepage links {slug}/")


def main():
    title_limit_tests()
    wtw_tests()
    state_unit_tests()
    # last-5 prop strip: boxes render oldest -> newest (newest on the right), each with its M/D date under it; the stats stay latest first
    lg5 = [["2026-10-25", "DDD", "vs", {}], ["2026-10-24", "CCC", "@", {"points": 20}], ["2026-10-22", "BBB", "vs", {"points": 30}],
           ["2026-10-20", "EEE", "@", {"points": 24.5}], ["2026-10-18", "FFF", "vs", {"points": 28}], ["2026-10-16", "GGG", "vs", {"points": 40}]]
    sh5 = SP.strip_html(lg5, "points", 24.5)
    check(re.findall(r"<i>(\w+)</i>", sh5) == ["FFF", "EEE", "BBB", "CCC", "DDD"], "last-5 strip oldest -> newest, left to right")
    check(re.findall(r'data-d="([^"]*)"', sh5) == ["10/18", "10/20", "10/22", "10/24", "10/25"] and sh5.count("<span class=\"pp-b") == 5, "M/D game date under every box (incl. DNP), no UTC day shift")
    check('10/25 vs DDD: no game (latest)"' in sh5 and sh5.count("(latest)") == 1 and "oldest to newest" in sh5, "tooltip has date, newest says (latest), aria label")
    check([b["r"] for b in SP.strip(lg5, "points", 24.5)] == ["x", "u", "o", "p", "o"] and SP.rate(lg5, "points", 24.5) == {"o": 2, "n": 4} and not SP.is_hot(lg5, "points", 24.5), "strip()/rate()/is_hot unchanged (latest first)")
    tmp = Path(tempfile.mkdtemp(prefix="seotest-"))
    try:
        site = build_copy(tmp)
        data = site / "data"
        meta = json.loads((data / "meta.json").read_text())
        now = pv.parse_dt(meta["generated"])
        st = SP.build(site, data, now, archive_dir=tmp / "arch")
        print(f"snapshot build: {st['pages']} pages + {st['redirects']} redirects, {st['bytes'] / 1e6:.1f} MB, {st['seconds']}s {st['total']}")
        check(st["pages"] > 50, f"snapshot builds a real number of pages ({st['pages']})")
        man = json.loads((data / "pages.json").read_text())
        meta2 = json.loads((data / "meta.json").read_text())
        check(meta2.get("pages", {}).get("count") == st["pages"] and "previews" not in meta2, "meta.json: pages count, no previews block")
        check(not (site / ".seo.tmp").exists() and not list(site.glob(".*.old")), "temp dirs cleaned up")
        keys = [f.name for f in (ROOT / "site").glob("*.txt") if re.fullmatch(r"[0-9a-f]{32}", f.stem)]
        check(keys and all((site / k).exists() for k in keys), f"IndexNow key file survives the build ({keys})")
        for lg in SP.ORDER:
            if (data / lg / "index.json").exists():
                check(man["l"].get(lg) == f"{lg}/" and (site / lg / "index.html").exists(), f"{lg}: hub page")
        check("epl" not in man["l"] and not (site / "epl").exists(), "soccer has no SEO pages")

        # ---- every page
        titles, canon, descs = {}, {}, {}
        stubs, real, broken = [], [], []
        hydrated = []
        event_pages = []
        for f in page_dirs(site):
            rel = str(f.parent.relative_to(site)) + "/"
            h = f.read_text()
            d = parse(h)
            if "http-equiv" in h and d.meta.get("refresh"):
                stubs.append((rel, d, h))
                continue
            real.append(rel)
            titles.setdefault(d.title, []).append(rel)
            canon.setdefault(d.links.get("canonical"), []).append(rel)
            descs.setdefault(d.meta.get("description"), []).append(rel)
            check(d.links.get("canonical") == SP.BASE_URL + rel, f"{rel}: canonical is its own URL ({d.links.get('canonical')})")
            check(d.meta.get("og:url") == SP.BASE_URL + rel and d.meta.get("og:title") and d.meta.get("og:description"), f"{rel}: og tags")
            desc_len = len(d.meta.get("description") or "")
            check(40 <= desc_len <= SP.DESC_MAX, f"{rel}: description length {desc_len} (max {SP.DESC_MAX})")
            check(d.title and len(d.title) <= SP.TITLE_MAX, f"{rel}: title <= {SP.TITLE_MAX} including the brand ({len(d.title)}: {d.title})")
            check(not d.title.endswith(SP.SUFFIX) or len(SP.bare_title(d.title)) <= SP.TITLE_MAX - len(SP.SUFFIX), f"{rel}: suffix only when the phrase fits ({d.title})")
            check(not PROMO_RE.search(d.meta.get("description") or ""), f"{rel}: description has no promo wording")
            check(d.meta.get("og:title") == d.title == d.meta.get("twitter:title"), f"{rel}: og:title / twitter:title match <title>")
            check_page_ld(rel, h, d.hrefs, d.body.get("data-page") or "")
            check("noindex" not in (d.meta.get("robots") or ""), f"{rel}: indexable")
            check(any(s.endswith("assets/app.js") for s in d.scripts), f"{rel}: loads the app JS")
            check(d.meta.get("_base") == "../" * rel.count("/"), f"{rel}: <base> points at the site root")
            check("21+" in h and "1-800-GAMBLER" in h, f"{rel}: 21+ and 1-800-GAMBLER")
            check("LineSmart · contact@linesmart.app" in re.sub(r"<[^>]+>", "", h), f"{rel}: privacy footer")
            # page chrome only (header, footer, meta): game/player content can contain real names like Rodney
            chrome = re.sub(r'<main class="wrap" id="app">.*?</main>|<section class="wrap seo-more".*?</section>\s*(?=<footer|<nav|<div class="ftr|$)|<script.*?</script>', " ", h, flags=re.S)
            check("Florida-based" not in h and not BAD_NAME.search(chrome), f"{rel}: no owner location or name")
            m = OFFER.search(mask_official(h))
            check(not m, f"{rel}: no hard-coded sportsbook offer ({m and m.group(0)})")
            prose = " ".join(re.findall(r'<div class="card pv-summary"><p>(.*?)</p>', h, re.S) + re.findall(r'<div class="card sx-result">(.*?)</div>', h, re.S))
            m = pv.FORBIDDEN.search(re.sub(r"<[^>]+>", " ", prose))
            check(not m, f"{rel}: no pick/guarantee language ({m and m.group(0)})")
            check('<main class="wrap" id="app">' in h and 'class="wrap seo-more"' in h, f"{rel}: content in #app + persistent links")
            check(len(re.sub(r"<[^>]+>", " ", h.split('id="app">', 1)[1].split("</main>", 1)[0]).split()) >= 25, f"{rel}: real content in the page")
            check(re.search(r'<nav class="hub-links"', h), f"{rel}: footer links the league hubs")
            seg = rel.split("/")
            if len(seg) > 2 and seg[1] in ("games", "fights", "events"):
                event_ld_ok(rel, h, seg[0], "event" if seg[1] == "events" else "game")
                event_pages.append(rel)
            route = d.body.get("data-route")
            if route:
                hydrated.append((rel, route))
            for href in d.hrefs:
                t = resolve(site, rel, d.meta.get("_base"), href)
                if t is not None and not t.exists():
                    broken.append(f"{rel} -> {href}")
        check(real and all(len(v) == 1 for v in titles.values()), f"titles unique ({[v for v in titles.values() if len(v) > 1][:3]})")
        check(all(len(v) == 1 for v in canon.values()), "canonicals unique")
        check(sum(len(v) > 1 for v in descs.values()) <= len(real) // 50, f"descriptions (nearly) unique ({sum(len(v) > 1 for v in descs.values())} dupes)")
        ev_lgs = {r.split("/")[0] for r in event_pages}
        check({"nfl", "nba", "nhl", "ncaaf"} <= ev_lgs and len(event_pages) == sum(len(v) for v in man["g"].values()), f"SportsEvent JSON-LD checked on every game page ({len(event_pages)}, {sorted(ev_lgs)})")
        nfl_ix = json.loads((data / "nfl" / "index.json").read_text())
        past = [g for g in nfl_ix["games"] if g.get("state") == "post" and g["id"] in man["g"].get("nfl", {})]
        if past:
            pev = event_ld_ok(man["g"]["nfl"][past[0]["id"]], (site / man["g"]["nfl"][past[0]["id"]] / "index.html").read_text(), "nfl", "game")
            check(pev and pev["eventStatus"] == "https://schema.org/EventScheduled", "finished game keeps EventScheduled (schema.org has no 'completed')")
        check(SP.event_status({"statusDetail": "Postponed"}).endswith("EventPostponed") and SP.event_status({"statusDetail": "Canceled"}).endswith("EventCancelled")
              and SP.event_status({"statusDetail": "Final/OT"}).endswith("EventScheduled"), "event_status(): postponed / canceled / final")
        check(SP.place_ld({"city": "Miami"}) == {"@type": "Place", "address": {"@type": "PostalAddress", "addressLocality": "Miami", "addressCountry": "US"}}, "place_ld(): no venue -> no placeholder name")
        check(not broken, f"all internal links resolve ({len(broken)} broken, e.g. {broken[:4]})")
        state_built_checks(site)
        check(len(real) == st["pages"], f"page files match stats ({len(real)} vs {st['pages']})")
        # hydration: only hubs and current, unfinished games hand #app to the live app view
        for rel, route in hydrated:
            kind, lg = route.split("/")[0], route.split("/")[1]
            ok = (kind == "l" and rel == f"{lg}/") or (kind == "g" and man["g"][lg].get(route.split("/")[2]) == rel)
            check(ok, f"{rel}: data-route {route} matches the manifest")
        with_data = [lg for lg in man["l"] if (data / lg / "index.json").exists()]
        check(any(r.startswith("g/") for _, r in hydrated) and sorted(r.split("/")[1] for _, r in hydrated if r.startswith("l/")) == sorted(with_data), "hubs (with data) and upcoming games are hydrated")
        check(len(man["l"]) == len(SP.ORDER), "every league has a hub, even without data this run")

        # ---- internal linking
        def html_of(p):
            return (site / p / "index.html").read_text()
        for lg, hub in man["l"].items():
            hh = html_of(hub)
            check(f'href="{lg}/results/"' in hh and (site / lg / "results" / "index.html").exists(), f"{lg} hub links /{lg}/results/")
            for kind in ("g", "t", "p"):
                for pid, p in (man[kind].get(lg) or {}).items():
                    if kind == "g":
                        # finals older than the hub's 14-day list live on the results archive, which the hub links
                        continue
                    if f'href="{p}"' not in hh:
                        check(False, f"{lg} hub links {p}")
            res_html = ""
            rdir = site / lg / "results"
            if rdir.is_dir():
                res_html = "\n".join(p.read_text() for p in rdir.rglob("index.html"))
            for p in (man["g"].get(lg) or {}).values():
                if f'href="{p}"' not in hh and f'href="{p}"' not in res_html:
                    check(False, f"{lg} hub or results archive links {p}")
        check(True, "hubs link teams, players, the results archive, and (with the archive) their games")
        # every result row on a sample of team pages is a link; the archive, not ESPN's last-5 text, is the source
        sample = []
        for lg, tm in list(man["t"].items()):
            sample.extend(list(tm.values())[:4])
        sample = sample[:20]
        unlinked = 0
        linked_rows = 0
        for rel in sample:
            h = html_of(rel)
            block = re.search(r'id="results-s".*?</section>', h, re.S)
            if not block:
                continue
            for li in re.findall(r"<li\b.*?</li>", block.group(0), re.S):
                linked_rows += 1
                if "<a href=" not in li:
                    unlinked += 1
            if "sx-results" in block.group(0):
                check('>Full results</a>' in block.group(0), f"{rel}: Full results link")
        check(len(sample) >= 8 and linked_rows > 0 and unlinked == 0, f"sample of {len(sample)} team pages: {linked_rows} result rows, {unlinked} without a link")
        props = man["p"].get("nfl") or man["p"].get("nba") or {}
        lgp = "nfl" if man["p"].get("nfl") else "nba"
        if props:
            pid, pp = next(iter(props.items()))
            ph = html_of(pp)
            gl = [p for p in man["g"][lgp].values() if f'href="{p}"' in ph]
            check(gl, f"player page {pp} links its game")
            if gl:
                check(f'href="{pp}"' in html_of(gl[0]), f"game page {gl[0]} links back to the player")
            check(f'href="{man["l"][lgp]}"' in ph, "player page links the hub")
            # "·" never starts a wrapped line: prop-header game label uses .sx-gl (CSS-clipped dot), text dots are glued with a no-break space
            check('class="na sx-gl"' in ph and '<span class="na">· ' not in ph, "player page: prop header game label uses .sx-gl, no literal leading dot")
            check(not re.search(r'class="(?:pv-lead|pp-sum na)">[^<]*[^\u00a0]· ', ph), "player page: lead / last-5 separators glued with a no-break space")
        some_g = next(iter(man["g"]["nfl"].values())) if man["g"].get("nfl") else None
        if some_g:
            gh = html_of(some_g)
            check(any(f'href="{p}"' in gh for p in man["t"]["nfl"].values()), "game page links its teams")
            check('href="nfl/"' in gh, "game page links the hub")

        # ---- hub -> today's (or the next) slate, game -> each team's next matchup, line alert entry
        def ul(h, cls):
            m = re.search(r'<ul class="pv-list ' + cls + r'">(.*?)</ul>', h, re.S)
            return re.findall(r'href="([^"]+)"[^>]*>([^<]*)<', m.group(1)) if m else None
        hubs_today = 0
        for lg, hub in man["l"].items():
            hh = html_of(hub)
            main_h = hh.split('id="app">', 1)[1].split("</main>", 1)[0]
            items = ul(main_h, "sx-today")
            gp = set((man["g"].get(lg) or {}).values())
            if items is None:
                check('class="na sx-none"' in main_h or not gp, f"{lg} hub: no slate -> 'No games today' (or no games at all)")
                continue
            hubs_today += 1
            check(items and all(h in gp for h, _ in items), f"{lg} hub: today/next slate links only real {lg} game pages ({items[:2]})")
            check('id="schedule"' not in main_h or main_h.index("sx-today") < main_h.index('id="schedule"'), f"{lg} hub: slate sits above the schedule")
            check(re.search(r"<h2[^>]*>(Today&#x27;s|Today's|Next) ", main_h[:main_h.index("sx-today")]) is not None, f"{lg} hub: slate heading says Today's / Next")
        check(hubs_today >= 2, f"at least two hubs show a today/next slate ({hubs_today})")
        n_next = n_cta = n_pcta = 0
        for lg, gm in man["g"].items():
            ixp = data / lg / "index.json"
            if not ixp.exists():
                continue
            games = {str(g["id"]): g for g in json.loads(ixp.read_text())["games"] if g.get("home") and g.get("away")}
            for gid, rel in gm.items():
                h = html_of(rel)
                g = games.get(gid)
                if g is None:      # archived (finished, out of the data window): never offers an alert
                    check("al-cta" not in h, f"{rel}: archived game has no alert entry")
                    continue
                final = g.get("state") == "post" or g.get("completed")
                dt = pv.parse_dt(g["date"])
                want = []
                for t in (g["away"], g["home"]):
                    cands = sorted((pv.parse_dt(o["date"]), oid) for oid, o in games.items() if oid != gid and oid in gm and not (o.get("state") == "post" or o.get("completed"))
                                   and str(t.get("id")) in {str(o["home"].get("id")), str(o["away"].get("id"))} and pv.parse_dt(o["date"]) > dt)
                    if cands:
                        want.append(gm[cands[0][1]])
                got = ul(h, "sx-next") or []
                check([x for x, _ in got] == want, f"{rel}: next-matchup links = each team's next game page ({got} vs {want})")
                check(all(lab.startswith("Next for ") and (" vs" in lab or " at " in lab) for _, lab in got), f"{rel}: next-matchup labels read 'Next for X: vs/at Y, Day M/D'")
                n_next += bool(got)
                cta = f'data-al="{lg}/{gid}"' in h
                if g.get("state") == "pre" and not final and pv.has_line(g):
                    check(cta and "Get a line alert" in h, f"{rel}: upcoming game with lines has the line alert entry")
                    n_cta += cta
                else:
                    check(not cta, f"{rel}: {'final' if final else g.get('state')} game has no line alert entry")
        check(n_next and n_cta, f"next-matchup links on {n_next} game pages, alert entry on {n_cta}")
        if (man["g"].get("nfl") or {}).get("401873012"):     # committed snapshot: Bengals at Ravens (final, 10/25)
            got = ul(html_of(man["g"]["nfl"]["401873012"]), "sx-next") or []
            check([lab for _, lab in got] == ["Next for the Bengals: vs Titans, Sun 11/1", "Next for the Ravens: at Bills, Sun 11/1"], f"finished game still links each team's next game ({got})")
        for lg, pm in man["p"].items():
            states = {str(x["id"]): x.get("state") for x in json.loads((data / lg / "index.json").read_text())["games"]}
            for pid, rel in pm.items():
                h = html_of(rel)
                for m in re.finditer(r'data-al-prop="([^"]+)"', h):
                    plg, pgid, ppid, mk = m.group(1).split("|")
                    check(plg == lg and ppid == pid and mk and states.get(pgid) == "pre", f"{rel}: prop alert entry pre-filled for an upcoming game ({m.group(1)})")
                    n_pcta += 1
        check(not man["p"] or n_pcta, f"prop pages carry prop alert entries ({n_pcta})")
        for rel in real:
            h = html_of(rel)
            if "al-cta" in h:
                m = PROMO_RE.search(re.sub(r"<[^>]+>", " ", h))
                check(not m and "Free account, up to 5 alerts a day." in h, f"{rel}: alert entry copy has no promo wording, states the 5-a-day limit ({m and m.group(0)})")

        # ---- redirects (/preview/ folded into the new pages)
        check(stubs, "redirect stubs written")
        for rel, d, h in stubs:
            target = d.links.get("canonical", "")
            check(target.startswith(SP.BASE_URL), f"stub {rel}: canonical to the new URL ({target})")
            tp = target[len(SP.BASE_URL):]
            check(tp == "" or tp in real, f"stub {rel}: target {tp} is a real page")
            check("location.replace(" in h and "location.hash" in h and "<base" not in h, f"stub {rel}: JS redirect keeps the hash, no <base>")
            m = re.search(r'url=([^"]+)"', d.meta.get("refresh", "") + '"')
            check(m and resolve(site, rel, None, m.group(1)).exists(), f"stub {rel}: meta refresh resolves ({d.meta.get('refresh')})")
        check((site / "preview" / "index.html").exists() and SP.BASE_URL in parse(html_of("preview/")).links.get("canonical", "x"), "preview/ redirects home")
        for lg in man["l"]:
            if lg in pv.LEAGUES:
                c = parse(html_of(f"preview/{lg}/")).links.get("canonical")
                check(c == SP.BASE_URL + f"{lg}/", f"preview/{lg}/ redirects to the {lg} hub ({c})")
        used = set()
        ix = json.loads((data / "nfl" / "index.json").read_text())
        cur = [g for g in sorted(ix["games"], key=lambda g: (g["date"], g["id"])) if g["id"] in man["g"].get("nfl", {})]
        if cur:
            old = pv.page_path("nfl", cur[0], used)
            check((site / old / "index.html").exists() and parse(html_of(old)).links.get("canonical") == SP.BASE_URL + man["g"]["nfl"][cur[0]["id"]],
                  f"old preview URL {old} redirects to the game page")

        # ---- sitemap index + robots
        sm = (site / "sitemap.xml").read_text()
        ns = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
        root = ET.fromstring(sm.encode())
        check(root.tag == ns + "sitemapindex", "sitemap.xml is a sitemap index")
        child_locs = [s.find(ns + "loc").text for s in root.findall(ns + "sitemap")]
        check(child_locs and len(child_locs) == len(set(child_locs)), f"index lists each child once ({len(child_locs)})")
        check(all(u.startswith(SP.BASE_URL + "sitemap-") and u.endswith(".xml") for u in child_locs), f"index children are sitemap-*.xml ({child_locs[:4]})")
        check(SP.MAP_START not in sm and "<urlset" not in sm and "<changefreq>" not in sm, "index has no page urls and no old markers")
        files = {u[len(SP.BASE_URL):]: site / u[len(SP.BASE_URL):] for u in child_locs}
        check(all(p.is_file() for p in files.values()), "every index child exists on disk")
        locs = []
        for name, p in files.items():
            croot = ET.fromstring(p.read_text().encode())
            check(croot.tag == ns + "urlset", f"{name} is a urlset")
            check(p.read_text().count(SP.MAP_START) == 1, f"{name}: one generated block")
            rows = [(u.find(ns + "loc").text, (u.find(ns + "lastmod").text if u.find(ns + "lastmod") is not None else None)) for u in croot.findall(ns + "url")]
            check(len(rows) < 50000, f"{name}: under 50k URLs ({len(rows)})")
            locs.extend(rows)
        urls = [u for u, _ in locs]
        check(len(urls) == len(set(urls)), "sitemap: no duplicate URLs across children")
        check(all(lm and re.match(r"^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2}))?$", lm) for _, lm in locs), "sitemap: every URL has a W3C lastmod")
        check(set(SP.BASE_URL + p for p in real) <= set(urls), "sitemap lists every page")
        check(not any(u[len(SP.BASE_URL):] in {r for r, _, _ in stubs} for u in urls), "sitemap: no redirect stubs")
        check(any(u.endswith("/results/") for u in urls), "sitemap-results (or a child) lists results pages")
        core_txt = (site / "sitemap-core.xml").read_text()
        for rel in ("florida/", "new-york/", "louisiana/", "delaware/", "states/"):
            check(SP.BASE_URL + rel in core_txt, f"sitemap-core lists {rel}")
        live_txt = (site / "sitemap-live.xml").read_text() if (site / "sitemap-live.xml").exists() else ""
        check(SP.BASE_URL + "florida/" not in live_txt and SP.BASE_URL + "states/" not in live_txt, "state pages are not in sitemap-live")
        for u in urls:
            p = u[len(SP.BASE_URL):]
            if p.startswith("sitemap-"):
                continue
            f = site / p / "index.html" if (p == "" or p.endswith("/")) else site / p
            if not f.exists():
                check(False, f"sitemap URL exists: {u}")
        robots = (site / "robots.txt").read_text()
        check("Sitemap: https://linesmart.app/sitemap.xml" in robots, "robots.txt points at the sitemap")
        # rebuild with nothing changed: same lastmods (content-hash driven)
        st_b = SP.build(site, data, now + timedelta(minutes=30), archive_dir=tmp / "arch")
        lm1 = dict(locs)
        lm2 = {}
        for p in sorted((site).glob("sitemap-*.xml")):
            for u in ET.fromstring(p.read_text().encode()).findall(ns + "url"):
                lm2[u.find(ns + "loc").text] = u.find(ns + "lastmod").text
        same = sum(lm1.get(u) == v for u, v in lm2.items() if u != SP.BASE_URL)
        check(same >= 0.9 * (len(lm2) - 1), f"rebuild keeps lastmod for unchanged pages ({same}/{len(lm2) - 1})")
        check(st_b["pages"] == st["pages"], "rebuild: same page count")
        parts = SP.chunk_sitemap("sitemap-games-nba-2026-10", [(f"https://linesmart.app/p{i}/", "2026-10-28T00:00:00Z") for i in range(5)], limit=2)
        check([n for n, _ in parts] == ["sitemap-games-nba-2026-10.xml", "sitemap-games-nba-2026-10-2.xml", "sitemap-games-nba-2026-10-3.xml"]
              and all(len(rows) <= 2 for _, rows in parts) and sum(len(rows) for _, rows in parts) == 5, f"sitemap split stays under the cap ({[n for n, _ in parts]})")

        # ---- game / fight titles: "Away vs Home Odds: <books>", books named only if their column is on the page
        for lg, gmap in man["g"].items():
            ixg = {str(x["id"]): x for x in (json.loads((data / lg / "index.json").read_text()).get("games") or [])} if (data / lg / "index.json").exists() else {}
            for gid, rel in gmap.items():
                h = (site / rel / "index.html").read_text()
                d = parse(h)
                t, desc = d.title, d.meta.get("description") or ""
                head = re.search(r'<table class="books pv-books"><thead><tr><th>Market</th>(.*?)</tr></thead>', h)
                cols = set(html.unescape(x) for x in re.findall(r'<th data-book="[^"]*">([^<]*)<', head.group(1))) if head else set()
                named = {full for short, full in (("Hard Rock", "Hard Rock Bet"), ("DraftKings", "DraftKings"), ("FanDuel", "FanDuel")) if short in t or short in desc}
                check(named <= cols, f"{rel}: title/description name only books shown on the page ({sorted(named)} vs {sorted(cols)})")
                check(" vs " in t and " at " not in t.split(" vs ")[0], f"{rel}: '<away> vs <home>' title ({t})")
                if lg == "ufc":
                    check(named <= {"DraftKings"}, f"{rel}: UFC names DraftKings only ({t})")
                g = ixg.get(str(gid))
                if g and lg != "ufc":
                    a_, h_ = pv.side_name(g["away"]), pv.side_name(g["home"])
                    check(t.startswith(f"{a_} vs {h_} ") or t.startswith(f"{g['away'].get('abbr')} vs {g['home'].get('abbr')} "), f"{rel}: away team first ({t})")
                if g and g.get("state") == "pre":
                    check(" Odds" in t, f"{rel}: upcoming title says Odds ({t})")
                    bk = [SP.TITLE_BOOK[k] for k in SP.page_books(g, lg)]
                    vs0 = f"{g['away'].get('name')} vs {g['home'].get('name')}" if lg == "ufc" else f"{a_} vs {h_}"
                    if bk and len(f"{vs0} Odds: {', '.join(bk)}") <= SP.TITLE_MAX - len(SP.SUFFIX):
                        check(t.split(" Odds", 1)[-1].startswith(": "), f"{rel}: books in the title when they fit ({t})")
                if "/games/" in rel and 'class="card sx-result"' in h or (g and g.get("state") == "post"):
                    check("Result" in t or "Final Score" in t, f"{rel}: finished game says Result ({t})")
        nfl_t = [parse((site / r / "index.html").read_text()).title for r in man["g"].get("nfl", {}).values()]
        check(any(re.search(r" vs .+ Odds: (Hard Rock, )?DraftKings(, FanDuel)? \| LineSmart$", x) for x in nfl_t), f"NFL titles carry the books ({nfl_t[:2]})")
        check(SP.and_list(["Hard Rock", "DraftKings", "FanDuel"]) == "Hard Rock, DraftKings and FanDuel" and SP.and_list(["FanDuel"]) == "FanDuel", "and_list()")
        g0 = {"odds": {"provider": "DraftKings", "homeML": -150, "awayML": 130}, "books": {}}
        check(SP.page_books({"odds": {"provider": "ESPN BET", "homeML": -150, "awayML": 130}}, "nba") == [] and
              SP.page_books(g0, "nba") in (["draftkings"], []), "page_books(): ESPN column counts only when it is one of our books")

        # ---- homepage cards
        ih = (site / "index.html").read_text()
        home = parse(ih)
        hdesc = home.meta.get("description") or ""
        check(home.title and len(home.title) <= SP.TITLE_MAX, f"homepage title <= {SP.TITLE_MAX} ({len(home.title or '')}: {home.title})")
        check(40 <= len(hdesc) <= SP.DESC_MAX, f"homepage description <= {SP.DESC_MAX} ({len(hdesc)})")
        check("Hard Rock Bet" in hdesc and "DraftKings" in hdesc and "FanDuel" in hdesc, "homepage description names Hard Rock Bet, DraftKings and FanDuel")
        check("available in Florida" not in hdesc and "legal in Florida" not in hdesc and "DraftKings (via ESPN) and Hard Rock Bet" not in hdesc, "homepage description does not place DraftKings or FanDuel in Florida")
        check(not PROMO_RE.search(hdesc), "homepage description: no promo wording")
        home_nodes = walk_nodes(ld_scripts(ih))
        org = next((n for n in home_nodes if n.get("@type") == "Organization"), {})
        web = next((n for n in home_nodes if n.get("@type") == "WebSite"), {})
        check(org.get("sameAs") == ["https://x.com/LineSmartApp", "https://www.youtube.com/@LineSmartApp"], f"homepage Organization sameAs ({org.get('sameAs')})")
        check(org.get("alternateName") == "Line Smart" and web.get("alternateName") == "Line Smart" and web.get("name") == "LineSmart", "homepage alternateName for the site name")
        check(all(n.get("@type") != "SearchAction" and (not isinstance(n.get("potentialAction"), dict) or n["potentialAction"].get("@type") != "SearchAction") for n in home_nodes), "homepage has no SearchAction")
        block = ih.split(SP.HOME_START, 1)[1].split(SP.HOME_END, 1)[0]
        check("home-cards" in block and "Top games" in block, "homepage cards filled in")
        hrefs = re.findall(r'href="([^"]+)"', block)
        check(hrefs and all(resolve(site, "", None, x).exists() for x in hrefs if not x.startswith("#")), "homepage cards link real pages")
        check(not OFFER.search(block), "homepage cards: no hard-coded offers")
        src_ix = (ROOT / "site" / "index.html").read_text()
        check(re.search(re.escape(SP.HOME_START) + re.escape(SP.HOME_END), src_ix), "committed site/index.html keeps empty homepage markers")
        check(not (ROOT / "site" / "nfl").exists() or not os.popen(f"git -C {ROOT} ls-files site/nfl site/ufc site/data/pages.json").read().strip(), "generated pages are not committed")

        # ---- archive: closing lines -> final -> past page -> pruned
        site2 = build_copy(tmp, "site2")
        d2 = site2 / "data"
        ix = json.loads((d2 / "nfl" / "index.json").read_text())
        g = next((x for x in sorted(ix["games"], key=lambda x: x["date"]) if x["state"] == "pre" and pv.has_line(x)), None)
        check(g, "snapshot has an upcoming NFL game with lines")
        if g:
            start = pv.parse_dt(g["date"])
            arch = tmp / "arch2"
            SP.build(site2, d2, start - timedelta(hours=2), archive_dir=arch)
            path = json.loads((d2 / "pages.json").read_text())["g"]["nfl"][g["id"]]
            a = json.loads((arch / "games-nfl.json").read_text())
            check(a.get(g["id"], {}).get("closing"), "closing lines archived before the start")
            far = [x for x in ix["games"] if x["state"] == "pre" and pv.parse_dt(x["date"]) > start + timedelta(hours=SP.ARCHIVE_AHEAD_H + 1)]
            check(not far or str(far[-1]["id"]) not in a, "games far from their start are not archived yet")
            # the game leaves the data window; the final comes from the home team's recent results
            ix["games"] = [x for x in ix["games"] if x["id"] != g["id"]]
            hid, aab = str(g["home"]["id"]), g["away"]["abbr"]
            ix["teams"].setdefault(hid, {}).setdefault("recent", []).insert(0, {"date": g["date"], "res": "W", "pf": 31.0, "pa": "17", "home": True, "opp": aab})
            (d2 / "nfl" / "index.json").write_text(json.dumps(ix))
            SP.build(site2, d2, start + timedelta(hours=5), archive_dir=arch)
            man2 = json.loads((d2 / "pages.json").read_text())
            check(man2["g"]["nfl"].get(g["id"]) == path, f"finished game keeps its URL ({man2['g']['nfl'].get(g['id'])})")
            ph = (site2 / path / "index.html").read_text()
            pd = parse(ph)
            check("Result" in pd.title and " vs " in pd.title and "17-31" in pd.title and pd.title.startswith(pv.side_name(g["away"]) + " vs "), f"past-game title: away vs home, Result, final score ({pd.title})")
            check(pd.meta.get("og:title") == pd.title == pd.meta.get("twitter:title") and "result" in (pd.meta.get("description") or ""), "past-game og/twitter titles + description follow")
            check("Closing lines" in ph and 'class="card sx-result"' in ph, "past-game page: result card + closing lines")
            check(re.search(r"covered the closing spread|closing spread was a push|No spread", ph) or "closing total" in ph, "past-game page grades the closing line")
            check(not pd.body.get("data-route"), "past-game page stays static (not hydrated)")
            check(pd.links.get("canonical") == SP.BASE_URL + path and SP.BASE_URL + path in SP.read_sitemaps(site2), "past-game page canonical + in sitemap")
            check("Closed at" in ph, "past-game page shows when the lines closed")
            check(f'href="{path}"' in (site2 / "nfl" / "index.html").read_text(), "hub links the past game")
            a = json.loads((arch / "games-nfl.json").read_text())[g["id"]]
            check(a["state"] == "post" and a["home"]["score"] == 31 and a["away"]["score"] == 17, f"archive final normalized ({a['home'].get('score')!r}-{a['away'].get('score')!r})")
            # 61 days later: still in the archive, still a page, still in the sitemap
            lm_before = None
            for pth in (site2).glob("sitemap-*.xml"):
                for u in ET.fromstring(pth.read_text().encode()).findall("{http://www.sitemaps.org/schemas/sitemap/0.9}url"):
                    if u.find("{http://www.sitemaps.org/schemas/sitemap/0.9}loc").text == SP.BASE_URL + path:
                        lm_before = u.find("{http://www.sitemaps.org/schemas/sitemap/0.9}lastmod").text
            # a record change that is not the score or the closing line must not move lastmod
            saved = json.loads((arch / "games-nfl.json").read_text())
            saved[g["id"]]["home"]["record"] = "9-9"
            (arch / "games-nfl.json").write_text(json.dumps(saved))
            SP.build(site2, d2, start + timedelta(days=61), archive_dir=arch)
            man3 = json.loads((d2 / "pages.json").read_text())
            check(man3["g"]["nfl"].get(g["id"]) == path and (site2 / path / "index.html").exists(), "game page never pruned")
            check(g["id"] in json.loads((arch / "games-nfl.json").read_text()), "archive never pruned")
            check(SP.BASE_URL + path in SP.read_sitemaps(site2), "old final stays in the sitemap")
            lm_after = None
            for pth in (site2).glob("sitemap-*.xml"):
                for u in ET.fromstring(pth.read_text().encode()).findall("{http://www.sitemaps.org/schemas/sitemap/0.9}url"):
                    if u.find("{http://www.sitemaps.org/schemas/sitemap/0.9}loc").text == SP.BASE_URL + path:
                        lm_after = u.find("{http://www.sitemaps.org/schemas/sitemap/0.9}lastmod").text
            check(lm_before and lm_before == lm_after, f"finished lastmod frozen when the score and closing line do not change ({lm_before} -> {lm_after})")
            home_rel = man3["t"]["nfl"][str(g["home"]["id"])]
            th = (site2 / home_rel / "index.html").read_text()
            check(f'href="{path}"' in th and ">Full results</a>" in th, "team page links the old final and the full results archive")
            # 404 page handles the expired URL
            nf = (site2 / "404.html").read_text()
            check("expired" in nf and "noindex" in nf and "1-800-GAMBLER" in nf, "404 page explains expired pages")

        # ---- postponed, canceled, team-rename stub, results schema (tiny archive build)
        edge_cases(tmp)

        # ---- UFC fight + event pages: SportsEvent JSON-LD (the committed snapshot has no UFC data)
        site4 = build_copy(tmp, "site4")
        (site4 / "data" / "ufc").mkdir(parents=True, exist_ok=True)
        (site4 / "data" / "ufc" / "index.json").write_text(json.dumps(ufc_fixture(now)))
        SP.build(site4, site4 / "data", now, archive_dir=None)
        man4 = json.loads((site4 / "data" / "pages.json").read_text())
        fights = list((man4["g"].get("ufc") or {}).values())
        check(len(fights) == 3, f"UFC fixture: 3 fight pages ({fights})")
        for rel in fights:
            fev = event_ld_ok(rel, (site4 / rel / "index.html").read_text(), "ufc", "game")
            check(fev and (fev.get("superEvent") or {}).get("url", "").startswith(SP.BASE_URL + "ufc/events/"), f"{rel}: fight links its card (superEvent)")
        evs = sorted(p.parent for p in (site4 / "ufc" / "events").glob("*/index.html"))
        check(len(evs) == 2, f"UFC fixture: 2 event pages ({len(evs)})")
        for p in evs:
            rel = str(p.relative_to(site4)) + "/"
            eev = event_ld_ok(rel, (p / "index.html").read_text(), "ufc", "event")
            if eev and "alpha" in rel:
                main_start = pv.parse_dt(ufc_fixture(now)["events"][0]["segments"][0]["start"])
                check(pv.parse_dt(eev["endDate"]) == main_start + timedelta(hours=SP.UFC_CARD_TAIL_H) and len(eev["performer"]) == 4,
                      f"{rel}: card ends {SP.UFC_CARD_TAIL_H}h after the main card starts; every fighter is a performer")

        # ---- "What to watch": only on upcoming pages that hydrate, clean wording, and the JSON-LD is identical without it
        ld = lambda h: re.findall(r'<script type="application/ld\+json">(.*?)</script>', h, re.S)
        wtw_pages = {}
        for p in site.glob("*/*/*/index.html"):
            h = p.read_text()
            if 'id="wtw-s"' in h:
                rel = str(p.parent.relative_to(site)) + "/"
                wtw_pages[rel] = h
                lis = re.findall(r'<span class="wtw-t">(.*?)</span>', h)
                check(1 <= len(lis) <= SP.WTW_MAX and 'data-route="g/' in h, f"{rel}: wtw has 1-{SP.WTW_MAX} notes, upcoming page only")
                check(h.index('id="wtw-s"') < h.index('Betting lines') if 'Betting lines' in h else True, f"{rel}: wtw sits above the odds")
                wtw_clean([("t", html.unescape(t)) for t in lis], rel)
        check(len(wtw_pages) >= 10, f"snapshot: wtw on upcoming game pages ({len(wtw_pages)})")
        site5 = build_copy(tmp, "site5")
        real = SP.what_to_watch
        SP.what_to_watch = lambda *a, **k: []
        try:
            SP.build(site5, site5 / "data", now, archive_dir=tmp / "arch5")
        finally:
            SP.what_to_watch = real
        same = all(ld(h) == ld((site5 / rel / "index.html").read_text()) for rel, h in wtw_pages.items())
        check(same and not any('id="wtw-s"' in (site5 / rel / "index.html").read_text() for rel in wtw_pages), "wtw: JSON-LD unchanged, section is the only difference")

        # ---- no archive dir (data-history unavailable): still builds from site/data alone
        site3 = build_copy(tmp, "site3")
        st3 = SP.build(site3, site3 / "data", now, archive_dir=None)
        check(st3["pages"] > 50 and st3["archive"] is None, "builds without an archive")
        check(not SP.build(site3, site3 / "data", now, archive_dir=None, write_site_files=False) is None and
              SP.HOME_START in (site3 / "index.html").read_text(), "--no-site-files path works")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print(f"{'PASS' if not failed else 'FAIL'} seo_pages: {passed}/{passed + failed}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
