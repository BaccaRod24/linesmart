"""Tests for scripts/seo_pages.py (crawlable league hub / game / props / team / UFC pages, sitemap, redirects, archive).

Builds from the committed site/data snapshot into a temp copy of site/ (never touches site/), offline, no API key.
Checks every generated page (unique titles + canonicals, og/description, app JS, 21+ / 1-800-GAMBLER / footer, no
'Florida-based', no hard-coded sportsbook offers, no pick language), that every internal link resolves to a file, the
sitemap (valid XML, unique, only real pages, lastmod), robots.txt, /preview/ redirects, the homepage cards, and the
finished-games archive: closing lines captured before the start, the final filled in after the game left the window,
the past-game page, and that a finished game is never pruned.
Usage: python3 scripts/seo_pages_test.py        (DATA_DIR=/path/to/data to test with fresher data)
"""
import hashlib
import html
import json
import os
import re
import shutil
import sys
import tempfile
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
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
    "lines": {"ItemList", "BreadcrumbList"},
    "standings": {"CollectionPage", "BreadcrumbList"},
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
    elif kind == "standings":
        check(any(n.get("@type") == "CollectionPage" for n in tops), f"{rel}: CollectionPage is top-level")
        check("BreadcrumbList" in types, f"{rel}: breadcrumb JSON-LD")
        check(not lists, f"{rel}: standings page has no ItemList")
    elif kind == "lines":
        check("SportsEvent" not in types and "Event" not in types, f"{rel}: best lines page has no Event markup")
        check("BreadcrumbList" in types, f"{rel}: breadcrumb JSON-LD")
        check(len(lists) == (1 if games else 0), f"{rel}: ItemList only when games are listed ({len(lists)})")
        if lists and games:
            paths = check_item_list(rel, lists[0])
            check(paths == games, f"{rel}: ItemList matches game links ({len(paths)} vs {len(games)})")
    elif kind == "states":
        check(any(n.get("@type") == "CollectionPage" for n in tops), f"{rel}: CollectionPage is top-level")
        check(len(lists) == 1, f"{rel}: one ItemList ({len(lists)})")
        if lists:
            paths = check_item_list(rel, lists[0])
            want = [p for p in _listed_paths(hrefs, re.compile(r"^[a-z0-9-]+/$")) if p.split("/")[0] not in SP.LEAGUE_DIRS and p not in ("states/", "best-lines-today/")]
            check(paths == want, f"{rel}: ItemList matches state links ({len(paths)} vs {len(want)})")
    else:
        check(not lists, f"{rel}: ItemList only on hubs, team, results and state pages")


def has_query_words(text):
    """True when lines, spreads and odds each appear as their own word."""
    low = (text or "").lower()
    return all(re.search(r"\b" + w + r"\b", low) for w in ("lines", "spreads", "odds"))


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
    check(SP.hub_books() == "DraftKings, Hard Rock Bet and FanDuel", "hub book list is the odds-table book list")
    check(SP.hub_custom_lead("nba", 0) is None and SP.hub_custom_lead("nfl", 4) is None, "shared hubs and an empty slate keep the existing intro")
    books = SP.hub_books()
    for lg, one, many in (
        ("nba", "1 upcoming game", "3 upcoming games"),
        ("ncaaf", "1 upcoming NCAAF game", "3 upcoming NCAAF games"),
        ("ncaab", "1 upcoming NCAAB game", "3 upcoming NCAAB games"),
    ):
        spec = SP.HUB_COPY[lg]
        title, desc, h1 = SP.fit(spec["title"]), SP.cut(spec["desc"]), spec["h1"]
        check(title == spec["title"] + SP.SUFFIX and len(title) <= SP.TITLE_MAX, f"{lg} hub title <= 60 ({len(title)}: {title})")
        check(desc == spec["desc"] and len(desc) <= SP.DESC_MAX, f"{lg} hub description <= 155 ({len(desc)})")
        check(SP.hub_custom_lead(lg, 1).split(":", 1)[0].endswith(one), f"{lg} singular count ({SP.hub_custom_lead(lg, 1).split(':', 1)[0]})")
        lead = SP.hub_custom_lead(lg, 3)
        check(many in lead and books in lead and lead.startswith("Today's"), f"{lg} intro uses the count and the book list")
        check(not PROMO_RE.search(title + " " + desc + " " + h1 + " " + lead), f"{lg} hub copy has no promo wording")
        check(not FL_CLAIM.search(title + " " + desc + " " + h1 + " " + lead), f"{lg} hub copy does not place a book in Florida")
        if lg in ("ncaaf", "ncaab"):
            check(has_query_words(spec["title"]) and has_query_words(spec["desc"]) and has_query_words(spec["h1"]) and has_query_words(lead),
                  f"{lg} hub title, description, h1 and intro say lines, spreads and odds ({title} / {desc})")


def _fixture_league(lg):
    ix = json.loads((ROOT / "site" / "data" / lg / "index.json").read_text())
    props_p = ROOT / "site" / "data" / "props" / f"{lg}.json"
    props = json.loads(props_p.read_text()) if props_p.exists() else None
    return SP.League(lg, ix, props, None, pv.parse_dt(ix.get("generated")), SP.BASE_URL)


def game_title_tests():
    """Upcoming titles name the matchup, the date and the three-book comparison. Finished titles stay result titles."""
    cases = [
        ("ncaaf", "401856734", "Florida vs Georgia Odds: DK, FD & HR (Oct 31) | LineSmart"),
        ("nfl", "401873026", "Ravens vs Bills Odds: DK, FD & HR (Nov 1) | LineSmart"),
        ("nfl", "401873024", "Cardinals vs Cowboys Odds: DK, FD & HR (Nov 1) | LineSmart"),
        ("ncaab", "401906769", "Miami vs Florida Odds: DK, FD & HR (Nov 2) | LineSmart"),
        ("ncaaf", "401866454", "Buffalo vs Miami OH Odds: DK, FD & HR (Nov 3) | LineSmart"),
        ("ncaaf", "401858509", "Ohio State vs USC Odds: DK, FD & HR (Oct 31) | LineSmart"),
        ("nba", "401909903", "Celtics vs Magic Odds: DK, FD & HR (Nov 1) | LineSmart"),
        ("nba", "401909895", "Grizzlies vs Blazers Odds: DK, FD & HR (Oct 29) | LineSmart"),
        ("nba", "401909893", "Cavaliers vs Hawks Odds: DK, FD & HR (Oct 29) | LineSmart"),
    ]
    leagues = {}
    seen_desc = {}
    for lg, gid, want in cases:
        L = leagues.setdefault(lg, _fixture_league(lg))
        g = L.cur[gid]
        title, desc = SP.game_meta(L, g, gid)
        check(title == want, f"{lg} {gid} title ({title})")
        snippet_ok(title, desc, f"{lg} {gid}")
        check(SP.title_side(g["away"]) in title and SP.title_side(g["home"]) in title, f"{lg} {gid} title names both teams ({title})")
        if lg in ("ncaaf", "ncaab"):
            check(has_query_words(desc), f"{lg} {gid} description says lines, spreads and odds ({desc})")
            check("Odds" in title, f"{lg} {gid} title still says Odds ({title})")
        seen_desc.setdefault(desc, []).append(gid)
    check(all(len(v) == 1 for v in seen_desc.values()), f"sample game descriptions are unique ({[v for v in seen_desc.values() if len(v) > 1]})")
    # A long college matchup stays readable inside 60, instead of collapsing to abbreviations to keep the brand suffix.
    long_phrase = "Tennessee Tech vs Mississippi St Odds: DK, FD & HR (Nov 2)"
    check(SP.prefer_title([long_phrase, "TNTC vs MSST Odds: DK, FD & HR (Nov 2)"]) == long_phrase, f"prefer_title keeps the readable name ({SP.prefer_title([long_phrase, 'TNTC vs MSST'])})")
    check(SP.day_in_title("Rays vs Brewers Odds (Oct 2)", "Oct 2") and not SP.day_in_title("Rays vs Brewers Odds (Oct 20)", "Oct 2"), "day_in_title does not treat Oct 2 as Oct 20")
    Lnb = _fixture_league("ncaab")
    long_t, long_d = SP.game_meta(Lnb, Lnb.cur["401906791"], "401906791")
    check(long_t.startswith("Tennessee Tech vs Mississippi St ") and len(long_t) <= SP.TITLE_MAX, f"long matchup stays readable ({long_t})")
    snippet_ok(long_t, long_d, "Tennessee Tech")
    # No line and a posted line share the comparison title. The description adds the number only when a line is up.
    L = leagues["ncaaf"]
    bare_t, bare_d = SP.game_meta(L, L.cur["401866454"], "401866454")
    buffalo = json.loads(json.dumps(L.cur["401866454"]))
    buffalo["books"] = {"draftkings": {"homeSpread": -3.5, "awaySpread": 3.5, "homeSpreadOdds": -110, "awaySpreadOdds": -110,
                                       "total": 48.5, "overOdds": -110, "underOdds": -110, "homeML": -160, "awayML": 140}}
    lined, lined_desc = SP.game_meta(L, buffalo, "401866454")
    check(lined == bare_t and "DK, FD & HR" in lined, f"Buffalo title is stable once a line posts ({lined})")
    check("total 48.5" in lined_desc and all(b in lined_desc for b in BOOKS3), f"Buffalo lined description names the number and the books ({lined_desc})")
    snippet_ok(lined, lined_desc, "Buffalo lined")
    check("Miami OH" in bare_d and "total 48.5" not in bare_d, "Buffalo without a line does not invent a number")
    check(has_query_words(bare_d), f"NCAAF game with no number yet still says lines, spreads and odds ({bare_d})")
    done = json.loads(json.dumps(leagues["ncaaf"].cur["401856734"]))
    done["state"], done["completed"] = "post", True
    done["statusDetail"] = "Final"
    done["away"]["score"], done["home"]["score"] = 17, 24
    done["home"]["winner"] = True
    done["_closing"] = True
    fin_t, fin_d = SP.game_meta(leagues["ncaaf"], done, "401856734")
    check("Result" in fin_t and has_query_words(fin_d), f"finished NCAAF game with a closing line says lines, spreads and odds ({fin_d})")
    bare_fin = json.loads(json.dumps(done))
    bare_fin["books"], bare_fin["odds"], bare_fin["_closing"] = {}, None, False
    _, bare_fin_d = SP.game_meta(leagues["ncaaf"], bare_fin, "401856734")
    check(has_query_words(bare_fin_d) and "no closing odds, lines or spreads" in bare_fin_d.lower(), f"finished NCAAF game with no line does not invent one ({bare_fin_d})")
    fl = leagues["ncaaf"].cur["401856734"]
    h1 = SP.game_h1(leagues["ncaaf"], fl)
    check(h1.startswith("Florida Gators vs Georgia Bulldogs ") and " at " not in h1, f"neutral H1 uses vs ({h1})")
    check(leagues["ncaaf"].game_slug(fl) == "florida-gators-at-georgia-bulldogs-2026-10-31", "neutral slug stays at")
    intro = SP.game_intro(leagues["ncaaf"], fl, "401856734")
    check("neutral site" in intro and "favored by" in intro and "should win" not in intro.lower(), f"Florida intro is the line, not a pick ({intro[:80]})")
    check(not pv.FORBIDDEN.search(intro) and not PROMO_RE.search(intro), "intro has no pick or promo wording")
    finished = {
        "401873012": "Bengals vs Ravens Final Score: 35-13 | LineSmart",
        "401873011": "Steelers vs Saints Final Score: 16-10 | LineSmart",
        "401873016": "Giants vs Texans Final Score: 27-21, OT | LineSmart",
    }
    nfl = leagues["nfl"]
    for gid, want in finished.items():
        title, desc = SP.game_meta(nfl, nfl.cur[gid], gid)
        check(title == want and len(desc) <= SP.DESC_MAX, f"finished title unchanged ({title})")
    # best number per side: +3.5 beats +3, -2.5 beats -3, lowest total for the over, highest for the under
    g = {"away": {"abbr": "BAL", "short": "Ravens", "name": "Baltimore Ravens"},
         "home": {"abbr": "BUF", "short": "Bills", "name": "Buffalo Bills"}}
    books = {
        "draftkings": {"awaySpread": 3, "homeSpread": -3, "awaySpreadOdds": -110, "homeSpreadOdds": -110,
                       "total": 45, "overOdds": -110, "underOdds": -108, "awayML": 130, "homeML": -150},
        "fanduel": {"awaySpread": 3.5, "homeSpread": -3.5, "awaySpreadOdds": -105, "homeSpreadOdds": -115,
                    "total": 44.5, "overOdds": -105, "underOdds": -115, "awayML": 120, "homeML": -140},
        "hardrockbet": {"awaySpread": 3.5, "homeSpread": -3.5, "awaySpreadOdds": -105, "homeSpreadOdds": -115,
                        "total": 44.5, "overOdds": -105, "underOdds": -115, "awayML": 120, "homeML": -140},
    }
    sides = SP.best_sides(g, books)
    check(sides["spread"][0][2].startswith("+3.5") and sides["spread"][1][2].startswith("-3 ("), f"best spread per side ({sides['spread']})")
    check(sides["total"][0][2].startswith("44.5") and sides["total"][1][2].startswith("45"), f"best over is the lower total, best under the higher ({sides['total']})")
    check(sides["ml"][0][2] == "+130" and sides["ml"][1][2] == "-140", f"best moneyline is the higher price ({sides['ml']})")
    check(SP.best_label(books, SP._market_fns(g)["spread"][0], g).endswith("FD, HR"), f"tied books ({SP.best_label(books, SP._market_fns(g)['spread'][0], g)})")
    # line_cell still scores the home spread only
    cell = SP.line_cell(g, books, {"fanduel": "FanDuel", "draftkings": "DraftKings", "hardrockbet": "Hard Rock"}, "spread")
    check(cell.startswith("BUF -3 ("), f"line_cell unchanged ({cell})")
    disagree = {
        "draftkings": {"homeSpread": -4.5, "awaySpread": 4.5, "total": 161.5, "homeML": -180, "awayML": 150},
        "hardrockbet": {"homeSpread": -5.5, "awaySpread": 5.5, "total": 159.5, "homeML": -200, "awayML": 170},
        "fanduel": {"homeSpread": -5.5, "awaySpread": 5.5, "total": 159.5, "homeML": -200, "awayML": 170},
    }
    phrase = SP.spread_phrase({"away": {"short": "Miami", "name": "Miami"}, "home": {"short": "Florida", "name": "Florida"}}, disagree)
    check(phrase == "Florida -4.5 to -5.5", f"spread range ({phrase})")
    js = (ROOT / "site" / "assets" / "app.js").read_text()
    check("PAGE_SEO" in js and ".seo-head" in js and "PAGE_ROUTE === `g/${key}/${id}`" in js, "app.js keeps .seo-head on the matching game route")


def _slate_game(gid, date, state="pre", line=True):
    g = {"id": gid, "date": date, "state": state, "completed": state == "post", "neutral": False,
         "away": {"id": "1", "name": "Away Team", "short": "Away", "abbr": "AWY"},
         "home": {"id": "2", "name": "Home Team", "short": "Home", "abbr": "HOM"}}
    if line:
        g["books"] = {"draftkings": {"homeSpread": -3, "awaySpread": 3, "homeSpreadOdds": -110, "awaySpreadOdds": -110,
                                     "total": 45, "overOdds": -110, "underOdds": -110, "homeML": -150, "awayML": 130}}
    else:
        g["books"] = {}
        g["odds"] = None
    return g


def _slate_league(lg, games, now):
    kind = {"nba": "basketball", "ncaab": "basketball", "nhl": "hockey", "mlb": "baseball"}.get(lg, "football")
    ix = {"league": {"kind": kind}, "games": games, "teams": {}, "generated": "2026-10-31T20:00:00Z"}
    L = SP.League(lg, ix, None, None, now, SP.BASE_URL)
    L.games = {str(g["id"]): g for g in games}
    L.paths = {str(g["id"]): f"{lg}/games/{g['id']}/" for g in games}
    return L


def best_lines_filter_tests():
    """Started, live, final, and no-line games are not listed. A partial line stays, with the missing markets blank.
    Next up skips a day whose games have no posted number."""
    now = pv.parse_dt("2026-10-31T20:00:00Z")  # 4:00 PM ET
    ml_only = _slate_game("nhl-ml", "2026-10-31T23:00:00Z", line=False)
    ml_only["books"] = {"draftkings": {"homeML": -150, "awayML": 130}}
    nfl = _slate_league("nfl", [
        _slate_game("nfl-later", "2026-10-31T23:00:00Z"),          # 7:00 PM ET, still ahead
        _slate_game("nfl-started", "2026-10-31T17:00:00Z"),        # 1:00 PM ET, already started
        _slate_game("nfl-now", "2026-10-31T20:00:00Z"),            # kickoff == build time
        _slate_game("nfl-live", "2026-10-31T23:30:00Z", "in"),
        _slate_game("nfl-final", "2026-10-31T17:00:00Z", "post"),
    ], now)
    nba = _slate_league("nba", [
        _slate_game("nba-noline", "2026-11-01T00:00:00Z", line=False),  # 8:00 PM ET, nothing posted
    ], now)
    nhl = _slate_league("nhl", [ml_only], now)
    rows, nxt = SP._best_line_rows({"nfl": nfl, "nba": nba, "nhl": nhl}, now)
    ids = [r[2] for r in rows]
    check(nxt is None and ids == ["nfl-later", "nhl-ml"], f"today keeps a full line and a moneyline-only game ({ids}, next={nxt})")
    check("nba-noline" not in ids and not any(x in ids for x in ("nfl-started", "nfl-now", "nfl-live", "nfl-final")), f"no-line, started, live and final stay off ({ids})")
    check([r[0] for r in rows] == ["nfl", "nhl"], f"a sport with no lined game is dropped ({[r[0] for r in rows]})")
    # nothing lined today: skip a later day that also has no line
    nfl2 = _slate_league("nfl", [_slate_game("nfl-old", "2026-10-31T17:00:00Z")], now)
    nba2 = _slate_league("nba", [_slate_game("nba-empty-day", "2026-11-01T23:00:00Z", line=False)], now)
    ncaaf = _slate_league("ncaaf", [
        _slate_game("ncaaf-next", "2026-11-02T16:00:00Z"),
        _slate_game("ncaaf-live", "2026-11-02T20:00:00Z", "in"),
    ], now)
    rows2, nxt2 = SP._best_line_rows({"nfl": nfl2, "nba": nba2, "ncaaf": ncaaf}, now)
    check(nxt2 == "2026-11-02" and [r[2] for r in rows2] == ["ncaaf-next"], f"Next up uses the next day that has a line ({[r[2] for r in rows2]}, {nxt2})")


OFFER = re.compile(r'class="of-book|Bet on (DraftKings|FanDuel|Hard Rock|BetMGM|Caesars|Fanatics)|href="https?://[^"]*(draftkings|fanduel|hardrock|betmgm|caesars|fanatics)[^"]*"', re.I)


def mask_official(h):
    """Official book URLs from the data file are not offers. Any other book-domain href still fails."""
    for url in (SP.load_books().get("urls") or {}).values():
        h = h.replace(f'href="{url}"', 'href="https://example.com/book"')
    return h
PROMO_RE = re.compile(r"\b(free bets?|risk[- ]free|no[- ]risk|guaranteed|bonus bets?|no[- ]sweat|free plays?)\b", re.I)   # same list as compliance_test.mjs
# Title and meta-description ban list for game and player-prop pages (also rejects the phrase inside a longer sentence).
SNIPPET_BANNED = re.compile(r"\b(locks?|guaranteed|free bets?|bonus bets?|risk[- ]free|no[- ]sweat|free plays?|free money|can(?:'|’)?t lose)\b", re.I)
FL_CLAIM = re.compile(r"\b(?:legal|available|offered)\s+in\s+florida\b|\bin\s+florida\b", re.I)
DATE_RE = re.compile(r"\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\b")
BOOKS3 = ("DraftKings", "FanDuel", "Hard Rock Bet")


def snippet_ok(title, desc, who, books=True):
    """Length, the three books, a date, and none of the banned or Florida-availability phrases."""
    blob = f"{title or ''}\n{desc or ''}"
    check(bool(title) and len(title) <= SP.TITLE_MAX, f"{who}: title length {len(title or '')} ({title})")
    check(bool(desc) and 40 <= len(desc) <= SP.DESC_MAX, f"{who}: description length {len(desc or '')}")
    hit = SNIPPET_BANNED.search(blob)
    check(not hit, f"{who}: banned word ({hit and hit.group(0)})")
    hit = pv.FORBIDDEN.search(blob)
    check(not hit, f"{who}: pick or promo language ({hit and hit.group(0)})")
    check(not FL_CLAIM.search(blob), f"{who}: implies a book is available in Florida")
    if books:
        missing = [b for b in BOOKS3 if b not in (desc or "")]
        check(not missing, f"{who}: description missing {missing} ({desc})")
        check(SP.TITLE_BOOKS in (title or "") or all(b in (title or "") for b in BOOKS3), f"{who}: title does not name the comparison ({title})")
        check(DATE_RE.search(title or "") and DATE_RE.search(desc or ""), f"{who}: title and description need a date ({title} / {desc})")
BAD_NAME = re.compile(r"\bRod\b|Rodney", re.I)


EV_DUR = {"nfl": 3.5, "ncaaf": 3.5, "nba": 2.5, "ncaab": 2.5, "nhl": 2.5, "mlb": 3, "ufc": 3}
ISO_OFF = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?[+-]\d\d:\d\d$")


def offer_ld_ok(rel, ev):
    """Free odds-page offer: price 0 on the canonical URL. Not a ticket and not a sportsbook."""
    off = ev.get("offers") or {}
    if isinstance(off, list):
        off = off[0] if off else {}
    blob = json.dumps(off)
    check(off.get("@type") == "Offer" and off.get("url") == ev.get("url"), f"{rel}: offers.url is the canonical page ({off.get('url')})")
    check(off.get("price") == 0 and off.get("priceCurrency") == "USD", f"{rel}: free offer is 0 USD ({off.get('price')} {off.get('priceCurrency')})")
    check(off.get("availability") == "https://schema.org/InStock", f"{rel}: offers.availability InStock")
    check(ISO_OFF.match(off.get("validFrom") or ""), f"{rel}: offers.validFrom with offset ({off.get('validFrom')})")
    check(off.get("name") == "Free odds and stats" and "not a ticket" in (off.get("description") or "").lower(), f"{rel}: offer names the free page, not a ticket ({off.get('name')})")
    check(not PROMO_RE.search(blob) and not re.search(r"draftkings|fanduel|hard rock|betmgm|sportsbook", blob, re.I), f"{rel}: offer JSON-LD has no promo or sportsbook wording")


def event_ld_ok(rel, h, lg, kind):
    """Google Event structured data on a game / fight / UFC event page: required fields (name, startDate, location)
    plus the recommended ones Search Console flagged (offers, endDate, performer, organizer.url)."""
    lds = [json.loads(x.replace("<\\/", "</")) for x in re.findall(r'<script type="application/ld\+json">(.*?)</script>', h, re.S)]
    evs = [x for x in lds if x.get("@type") == "SportsEvent"]
    check(len(evs) == 1, f"{rel}: one SportsEvent JSON-LD ({len(evs)})")
    if not evs:
        return None
    ev = evs[0]
    st, en = pv.parse_dt(ev.get("startDate")), pv.parse_dt(ev.get("endDate"))
    check(ev.get("name") and ev.get("url") == SP.BASE_URL + rel and ISO_OFF.match(ev.get("startDate") or ""), f"{rel}: name, url, startDate with offset")
    check(isinstance(ev.get("description"), str) and ev["description"].strip(), f"{rel}: SportsEvent description ({ev.get('description')!r})")
    for node in walk_nodes(lds):
        if node.get("@type") in ("Event", "SportsEvent"):
            check(isinstance(node.get("description"), str) and node["description"].strip(), f"{rel}: every Event has a description ({node.get('name')})")
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
    offer_ld_ok(rel, ev)
    visible = re.sub(r"<script\b.*?</script>", " ", h, flags=re.S)
    check("Free odds and stats" not in visible and "Not a ticket" not in visible, f"{rel}: offer wording stays in JSON-LD")
    se = ev.get("superEvent")
    if isinstance(se, dict):
        check(se.get("@type") == "SportsEvent" and se.get("name") and str(se.get("url") or "").startswith(SP.BASE_URL + "ufc/events/"), f"{rel}: superEvent is the card")
        check(isinstance(se.get("description"), str) and se["description"].strip(), f"{rel}: superEvent description ({se.get('description')!r})")
        check(ISO_OFF.match(se.get("endDate") or "") and ISO_OFF.match(se.get("startDate") or ""), f"{rel}: superEvent startDate and endDate")
        sorg = se.get("organizer") or {}
        check(sorg.get("name") and sorg.get("url") == SP.ORGANIZER["ufc"][2], f"{rel}: superEvent organizer url")
        sperf = se.get("performer") or []
        check(len(sperf) >= 2 and all(p.get("@type") == "Person" and p.get("name") for p in sperf), f"{rel}: superEvent performers")
        offer_ld_ok(rel + " superEvent", se)
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
    check("https://www.hardrock.bet/" in fl_main, "Florida links the Hard Rock Bet official site")
    check("Online sports betting is legal in Florida." in fl_main, "Florida says online betting is legal as its own sentence")
    check("legal in Florida as of" not in fl_main and "is legal as of" not in fl_main, "Florida does not glue the word legal to the verification date")
    check("Last verified October 26, 2026" in fl_main, "Florida keeps a clear verification date")
    check("best price among Hard Rock Bet" not in fl_main and "The lines are the Hard Rock Bet price." in fl_main, "one book reads as that book's price")
    check("October 26, 2026" in fl_main and "https://www.americangaming.org/" in fl_main, "Florida shows asOf and a source link")
    check("1-833-PLAYWISE" in fl_main and "1-800-GAMBLER" in fl_main, "Florida helpline is 1-833-PLAYWISE plus 1-800-GAMBLER")
    check('data-page="state"' in fl and 'data-route="' not in fl, "Florida page stays static")
    ny = _main_text((site / "new-york" / "index.html").read_text())
    check("DraftKings" in ny and "FanDuel" in ny and "BetMGM" in ny, "New York lists its books")
    check("The lines are the best price among DraftKings, FanDuel and BetMGM." in ny, "several books still say best price among")
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


def college_title_tests():
    """College team titles keep the school name and a short NCAAF/NCAAB label. No URL slug."""
    samples = [
        ("Duke Blue Devils", "ncaab"),
        ("Kentucky Wildcats", "ncaab"),
        ("Arkansas-Pine Bluff Golden Lions", "ncaab"),
        ("North Carolina Central Eagles", "ncaab"),
        ("North Carolina Tar Heels", "ncaab"),
        ("Duke Blue Devils", "ncaaf"),
    ]
    titles = []
    for name, lg in samples:
        title = SP.college_team_title(name, lg)
        bare = SP.bare_title(title)
        slug = name.lower().replace(" ", "-")
        check(len(title) <= SP.TITLE_MAX, f"{name} title fits ({len(title)}: {title})")
        check(f"({SP.SHORT[lg]})" in bare, f"{name} title names {SP.SHORT[lg]} ({title})")
        check(name in bare, f"{name} is not clipped ({title})")
        check(f"({slug})" not in bare and slug not in bare, f"{name} title has no slug ({title})")
        titles.append(title)
    check(len(set(titles)) == len(titles), f"sample college titles are unique ({titles})")


def fight_method_tests():
    g = {"away": {"name": "Islam Makhachev", "winner": True}, "home": {"name": "Ian Machado Garry", "winner": False},
         "result": {"round": 5, "clock": "5:00"}, "statusDetail": "Final"}
    bare = SP.ufc_result_line(g)
    check("won by in round" not in bare and bare == "Islam Makhachev won in round 5 at 5:00", f"missing method is not 'won by in round' ({bare})")
    decision = SP.ufc_result_line(SP.apply_fight_method(g, {"method": "Decision - Unanimous", "round": 5, "clock": "5:00"}))
    check(decision == "Islam Makhachev won by Decision - Unanimous in round 5 at 5:00", f"decision method ({decision})")
    bare_ko = {"away": g["away"], "home": g["home"], "result": {}, "statusDetail": "Final"}
    ko = SP.ufc_result_line(SP.apply_fight_method(bare_ko, {"method": "KO/TKO", "detail": "Punches", "round": 3, "clock": "3:20"}))
    check(ko == "Islam Makhachev won by KO/TKO (Punches) in round 3 at 3:20", f"ko method ({ko})")
    split = SP.ufc_result_line(SP.apply_fight_method(g, {"method": "Decision - Split"}))
    check(split == "Islam Makhachev won by Decision - Split in round 5 at 5:00", f"split decision keeps the stored round ({split})")


def state_date_tests():
    """The states index 'as of' is the build. The book-list date stays labeled as last verified."""
    doc = json.loads(json.dumps(SP.load_books()))
    doc["asOf"] = "2026-10-26"
    sh = SP.Shell((ROOT / "site" / "index.html").read_text(), SP.BASE_URL)
    now = datetime(2026, 11, 11, 18, 0, tzinfo=timezone.utc)
    html, _title = SP.states_index(doc, sh, {}, now)
    main = re.sub(r"<!--.*?-->", "", _main_text(html), flags=re.S)
    check(f"as of {SP.built_long(now)}" in main, f"states page as-of is the build day ({SP.built_long(now)})")
    check(f"Last verified {SP.asof_long(doc)}" in main, "states page still names when the book list was checked")
    check(f"as of {SP.asof_long(doc)}" not in main, "the older verification date is not the page as-of")
    check("Book list verified October 26, 2026" in html, "the description keeps the book-list date")


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


def _prop_league(players, games, props_by_game, now):
    """A tiny NFL league with prop pages, built the same way the SEO build collects players. No odds API."""
    ix_games = []
    raw = json.loads((ROOT / "site" / "data" / "nfl" / "index.json").read_text())
    by_id = {g["id"]: g for g in raw["games"]}
    for gid in games:
        ix_games.append(by_id[gid])
    props = {
        "markets": {"rush_yds": ["Rushing yards", "Rush yds"], "rec": ["Receptions", "Recs"], "anytime_td": ["Anytime TD", "TD"]},
        "players": players,
        "games": props_by_game,
    }
    L = SP.League("nfl", {"league": {"kind": "football"}, "games": ix_games, "teams": {}, "generated": SP.iso(now)}, props, SP.Archive(None), now, SP.BASE_URL)
    L.select()
    L.assign_paths()
    L.collect_players()
    L.collect_teams()
    return L


def snippet_copy_tests():
    """Player-prop titles and descriptions, plus the banned-word and Florida guards."""
    for phrase in ("lock", "locks", "guaranteed", "free bet", "free bets", "bonus bet", "risk-free", "risk free", "no sweat", "no-sweat", "free play", "free money", "can't lose", "can’t lose"):
        check(SNIPPET_BANNED.search(f"this is a {phrase} tonight"), f"banned guard catches {phrase!r}")
    check(not SNIPPET_BANNED.search("the clock and a block of text"), "banned guard ignores clock and block")
    check(FL_CLAIM.search("DraftKings is legal in Florida") and FL_CLAIM.search("available in Florida") and not FL_CLAIM.search("Compare Florida vs Georgia NCAAF odds"), "Florida guard is an availability claim, not the Gators")
    now = pv.parse_dt("2026-10-26T12:00:00Z")
    players = {
        "1": {"n": "Josh Jacobs", "ta": "GB", "pos": "RB", "t": "9", "log": []},
        "2": {"n": "Christopher Rodriguez Jr.", "ta": "WAS", "pos": "RB", "t": "28", "log": []},
        "3": {"n": "Christopher Montgomery Rodriguez", "ta": "GB", "pos": "RB", "t": "9", "log": []},
        "4": {"n": "Josh Jacobs", "ta": "LV", "pos": "RB", "t": "13", "log": []},
    }
    row = lambda pid, mk, ln: [pid, mk, ln, None, None, {"draftkings": [ln, -110, -110], "fanduel": [ln, -115, -105], "hardrockbet": [ln, -110, -110]}]
    props_by_game = {
        "401873023": {"props": [row("1", "rush_yds", 68.5), row("1", "rec", 3.5), row("1", "anytime_td", 0.5), row("3", "rush_yds", 40.5)]},
        "401873026": {"props": [row("2", "rush_yds", 55.5), row("4", "rush_yds", 70.5)]},
    }
    L = _prop_league(players, ["401873023", "401873026"], props_by_game, now)
    titles, descs = {}, {}
    for pid in players:
        title, desc = SP.player_meta(L, pid)
        snippet_ok(title, desc, f"player {players[pid]['n']} {players[pid]['ta']}")
        check(players[pid]["n"] in title or SP.short_person(players[pid]["n"]) in title, f"{pid} title names the player ({title})")
        check(players[pid]["ta"] in title or players[pid]["ta"] in desc, f"{pid} names the team ({title} / {desc})")
        titles.setdefault(title, []).append(pid)
        descs.setdefault(desc, []).append(pid)
    check(all(len(v) == 1 for v in titles.values()), f"prop titles unique ({[v for v in titles.values() if len(v) > 1]})")
    check(all(len(v) == 1 for v in descs.values()), f"prop descriptions unique ({[v for v in descs.values() if len(v) > 1]})")
    jt, jd = SP.player_meta(L, "1")
    check(jt == "Josh Jacobs (GB) Props: DK, FD & HR (Oct 29) | LineSmart", f"Josh Jacobs title ({jt})")
    check(jd.startswith("Compare Josh Jacobs (GB) NFL props for Panthers at Packers on Thu, Oct 29 across DraftKings, FanDuel and Hard Rock Bet."), f"Josh Jacobs description ({jd})")
    check("Rushing yards 68.5" in jd and "best bet" not in jd.lower(), "Josh Jacobs description states the posted line")
    long_t, long_d = SP.player_meta(L, "3")
    check(long_t.startswith("Christopher Montgomery Rodriguez ") and len(long_t) <= SP.TITLE_MAX and "Oct 29" in long_t, f"long player name keeps the date ({long_t})")
    check(all(b in long_d for b in BOOKS3) and "Oct 29" in long_d, f"long player description names the books and the date ({long_d})")
    sh = SP.Shell((ROOT / "site" / "index.html").read_text(), SP.BASE_URL)
    html, title = SP.player_page(L, sh, "1")
    d = parse(html)
    desc = d.meta.get("description")
    check(d.title == title == d.meta.get("og:title") == d.meta.get("twitter:title"), "prop page og:title and twitter:title match <title>")
    check(desc == d.meta.get("og:description") == d.meta.get("twitter:description"), "prop page og:description and twitter:description match")
    check("21+" in html and "1-800-GAMBLER" in html, "prop page keeps the 21+ notice and the helpline")


NS = "{http://www.sitemaps.org/schemas/sitemap/0.9}"


def sitemap_page_urls(site):
    """Page <loc>s from every child urlset. The index lists sitemap files, not pages."""
    urls = []
    for p in sorted(Path(site).glob("sitemap-*.xml")):
        root = ET.fromstring(p.read_text().encode())
        if not root.tag.endswith("urlset"):
            continue
        for u in root.findall(NS + "url"):
            loc = u.find(NS + "loc")
            if loc is not None and loc.text:
                urls.append(loc.text)
    return urls


def check_sitemap_files(site, label):
    """Every sitemap URL is a file from this build. A game URL's file is the page, not a redirect stub."""
    urls = sitemap_page_urls(site)
    missing, stubs = [], []
    for u in urls:
        rel = u[len(SP.BASE_URL):] if u.startswith(SP.BASE_URL) else None
        f = SP.rel_file(site, rel) if rel is not None else None
        if f is None or not f.is_file():
            missing.append(u)
            continue
        if rel and SP.is_game_rel(rel) and SP.is_redirect_file(f):
            stubs.append(u)
    check(bool(urls) and not missing, f"{label}: every sitemap URL has a file ({len(urls)} urls, missing {missing[:3]})")
    check(not stubs, f"{label}: no game redirect is listed ({stubs[:2]})")
    return urls


def _side(tid, name, abbr, score=None, winner=False):
    row = {"id": str(tid), "abbr": abbr, "name": name, "short": name.split()[-1], "record": "4-1"}
    if score is not None:
        row["score"] = score
    if winner:
        row["winner"] = True
    return row


def _game(gid, when, away, home, state, books):
    return {"id": gid, "date": SP.iso(when), "state": state,
            "statusDetail": "Final" if state == "post" else "Sat", "completed": state == "post",
            "venue": "Ohio Stadium", "city": "Columbus", "venueState": "OH", "venueCountry": "US",
            "home": home, "away": away, "books": books or {}, "odds": None}


def sitemap_game_guard_tests():
    """A game URL enters a sitemap only with HTML from that build, and leaves when the page does.

    NCAAF needs a posted line. The Oregon page is listed once that page exists. UCLA, which has no
    line, is not listed and gets no file. When Oregon's line comes down before the game is archived,
    the URL leaves the sitemap and the file becomes a hub redirect (no odds, no Pro). The finished
    game stays in sitemap-games. Putting the line back restores the page and the sitemap entry.
    """
    line = {"draftkings": {"homeSpread": -3.5, "awaySpread": 3.5, "homeML": -160, "awayML": 140,
                           "total": 48.5, "overOdds": -110, "underOdds": -110}}
    tmp = Path(tempfile.mkdtemp(prefix="seosm-"))
    try:
        # ---- writer: sitemap-games cannot name a game file this build did not write
        unit = tmp / "unit"
        unit.mkdir()
        (unit / "sitemap.xml").write_text("<sitemapindex/>\n")
        (unit / "sitemap-core.xml").write_text("")
        now_u = pv.parse_dt("2026-11-07T16:00:00Z")
        fin_g = _game("401858514", now_u, _side("1", "Oregon Ducks", "ORE", 28), _side("2", "Ohio State Buckeyes", "OSU", 41, True), "post", line)
        L = SP.League("ncaaf", {"games": [fin_g], "teams": {}, "league": {"kind": "football"}}, None, SP.Archive(None), now_u, SP.BASE_URL)
        rel = "ncaaf/games/oregon-ducks-at-ohio-state-buckeyes-2026-11-07/"
        L.games = {"401858514": fin_g}
        L.paths = {"401858514": rel}
        (unit / "ncaaf").mkdir()
        (unit / "ncaaf" / "index.html").write_text("<html>hub</html>\n")
        entries = [("ncaaf/", "2026-11-07T16:00:00Z"), (rel, "2026-11-07T16:00:00Z")]
        SP.update_sitemap(unit, entries, {"ncaaf": L}, "2026-11-07T16:00:00Z")
        check(SP.BASE_URL + rel not in sitemap_page_urls(unit) and not list(unit.glob("sitemap-games-*.xml")),
              "sitemap-games omits a game whose HTML was not written")
        f = unit / rel / "index.html"
        f.parent.mkdir(parents=True)
        f.write_text("<html><title>Oregon vs Ohio State Result</title></html>\n")
        SP.update_sitemap(unit, entries, {"ncaaf": L}, "2026-11-07T16:00:00Z")
        games_xml = unit / "sitemap-games-ncaaf-2026-11.xml"
        check(games_xml.is_file() and SP.BASE_URL + rel in games_xml.read_text(), "sitemap-games lists the game once its file exists")
        f.write_text(SP.redirect_stub(rel, "ncaaf/", SP.BASE_URL, "College Football odds"))
        SP.update_sitemap(unit, entries, {"ncaaf": L}, "2026-11-07T16:00:00Z")
        check(SP.BASE_URL + rel not in sitemap_page_urls(unit) and not games_xml.exists(), "a game redirect is dropped from sitemap-games")

        # ---- build: line posted, line removed, line restored. Other leagues are emptied so this stays small.
        site = build_copy(tmp, "flicker")
        data = site / "data"
        now = pv.parse_dt(json.loads((data / "meta.json").read_text())["generated"])
        for lg in SP.ORDER:
            p = data / lg / "index.json"
            if not p.exists():
                continue
            doc = json.loads(p.read_text())
            doc["games"] = []
            p.write_text(json.dumps(doc))
        ore = _side("2483", "Oregon Ducks", "ORE")
        osu = _side("194", "Ohio State Buckeyes", "OSU")
        ucla = _side("26", "UCLA Bruins", "UCLA")
        minn = _side("135", "Minnesota Golden Gophers", "MINN")
        lined = _game("flicker-ore", now + timedelta(days=3), ore, osu, "pre", line)
        bare = _game("flicker-ucla", now + timedelta(days=3), ucla, minn, "pre", {})
        past = _game("flicker-final", now - timedelta(days=1),
                     _side("2483", "Oregon Ducks", "ORE", 17), _side("194", "Ohio State Buckeyes", "OSU", 24, True), "post", line)
        ix = json.loads((data / "ncaaf" / "index.json").read_text())
        ix["games"] = [lined, bare, past]
        (data / "ncaaf" / "index.json").write_text(json.dumps(ix))
        arch = tmp / "archF"
        SP.build(site, data, now, archive_dir=arch)
        man = json.loads((data / "pages.json").read_text())["g"].get("ncaaf") or {}
        ore_path, fin_path = man.get("flicker-ore"), man.get("flicker-final")
        check(ore_path and (site / ore_path / "index.html").is_file() and "oregon-ducks-at-ohio-state-buckeyes" in ore_path,
              f"lined NCAAF game is a real page ({ore_path})")
        ucla_hit = list((site / "ncaaf" / "games").glob("*ucla*")) if (site / "ncaaf" / "games").is_dir() else []
        check("flicker-ucla" not in man and not ucla_hit, "NCAAF game with no line is not generated")
        urls = check_sitemap_files(site, "with a line")
        fin_ym = SP.day_et(pv.parse_dt(past["date"]))[:7]
        check(SP.BASE_URL + ore_path in urls and SP.BASE_URL + fin_path in urls, "lined game and final are in the sitemap")
        check(SP.BASE_URL + ore_path in (site / "sitemap-live.xml").read_text(), "upcoming game is in sitemap-live, not invented early")
        check(SP.BASE_URL + fin_path in (site / f"sitemap-games-ncaaf-{fin_ym}.xml").read_text(), f"final is in sitemap-games-{fin_ym}")
        check("ucla-bruins" not in SP.read_sitemaps(site) and "ucla-bruins" not in (site / "ncaaf" / "index.html").read_text(),
              "no-line game is absent from the sitemap and the hub")
        # line comes down: page leaves the sitemap; the URL refreshes to the hub instead of 404
        ix = json.loads((data / "ncaaf" / "index.json").read_text())
        for g in ix["games"]:
            if g["id"] == "flicker-ore":
                g["books"], g["odds"] = {}, None
        (data / "ncaaf" / "index.json").write_text(json.dumps(ix))
        SP.build(site, data, now, archive_dir=arch)
        man = json.loads((data / "pages.json").read_text())["g"].get("ncaaf") or {}
        check("flicker-ore" not in man and man.get("flicker-final") == fin_path, "dropped upcoming game leaves the manifest; the final stays")
        stub_f = site / ore_path / "index.html"
        stub = stub_f.read_text()
        check('http-equiv="refresh"' in stub and f'href="{SP.BASE_URL}ncaaf/"' in stub, "dropped game refreshes to the college football hub")
        check("21+" in stub and "1-800-GAMBLER" in stub and "1-833-PLAYWISE" in stub, "hub redirect keeps the 21+ notice and the helplines")
        check("pro-gate" not in stub and "rankings" not in stub.lower() and "data-offers-slot" not in stub and "Free odds and stats" not in stub,
              "hub redirect has no Pro data and no odds")
        check(SP.BASE_URL + ore_path not in sitemap_page_urls(site), "dropped game leaves every sitemap")
        check(SP.BASE_URL + fin_path in (site / f"sitemap-games-ncaaf-{fin_ym}.xml").read_text(), "sitemap-games keeps the final that still has a page")
        check_sitemap_files(site, "after the line drops")
        fin_html = (site / fin_path / "index.html").read_text()
        check("21+" in fin_html and "1-800-GAMBLER" in fin_html and "1-833-PLAYWISE" in fin_html and "1-888-ADMIT-IT" in fin_html
              and "data-aff-disclosure" in fin_html and "data-rg-local" in fin_html, "final page still has 21+, state helplines, and the Ad slot")
        check('content="noindex, nofollow"' in (site / "owner.html").read_text(), "Pro owner page stays noindex")
        check('noindex, nofollow' in (ROOT / "site" / "assets" / "pro-gate.js").read_text() and 'class="aff-tag">Ad' in (ROOT / "site" / "assets" / "site.js").read_text(),
              "Pro noindex and the Ad label are unchanged")
        # line returns: same URL is a real page and is listed again
        ix = json.loads((data / "ncaaf" / "index.json").read_text())
        for g in ix["games"]:
            if g["id"] == "flicker-ore":
                g["books"] = line
        (data / "ncaaf" / "index.json").write_text(json.dumps(ix))
        SP.build(site, data, now, archive_dir=arch)
        man = json.loads((data / "pages.json").read_text())["g"]["ncaaf"]
        check(man.get("flicker-ore") == ore_path, f"the same URL comes back when the line is posted ({man.get('flicker-ore')})")
        back = (site / ore_path / "index.html").read_text()
        check('http-equiv="refresh"' not in back and SP.BASE_URL + ore_path in sitemap_page_urls(site), "restored page is real HTML and back in the sitemap")
        check_sitemap_files(site, "line restored")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def sitemap_trim_tests():
    """Thin, empty, duplicate and meta-refresh URLs stay out of the sitemap. Hubs and upcoming games stay in."""
    now = pv.parse_dt("2026-11-07T16:00:00Z")
    lm = "2026-11-07T16:00:00Z"
    line = {"draftkings": {"homeSpread": -3.5, "awaySpread": 3.5, "total": 47.5, "homeML": -150, "awayML": 130}}
    L = SP.League("nfl", {"games": [], "teams": {}, "league": {"kind": "football"}}, None, SP.Archive(None), now, SP.BASE_URL)

    def side(tid, name, abbr, score=None):
        row = {"id": tid, "abbr": abbr, "name": name, "short": name.split()[-1]}
        if score is not None:
            row["score"] = score
        return row

    def game(gid, state, books, detail="Sat", scores=None):
        away, home = side("1", "Away Team", "AWY"), side("2", "Home Team", "HOM")
        if scores:
            away["score"], home["score"] = scores
            home["winner"] = True
        return {"id": gid, "date": SP.iso(now - timedelta(days=1) if state == "post" else now + timedelta(days=1)),
                "state": state, "completed": state == "post", "statusDetail": detail,
                "venue": "Stadium", "city": "Miami", "venueState": "FL", "venueCountry": "US",
                "away": away, "home": home, "books": books or {}, "odds": None}

    L.games = {
        "up": game("up", "pre", line),
        "fin": game("fin", "post", line, "Final", (10, 17)),
        "thin": game("thin", "post", {}, "Final", (7, 14)),
        "noscore": game("noscore", "post", line, "Final"),
        "held": game("held", "pre", {}, "Postponed"),
    }
    L.paths = {gid: f"nfl/games/{gid}/" for gid in L.games}
    L.players = {
        "good": {"path": "nfl/props/good/", "rows": [("up", ["good", "rush_yds", 55.5])], "archived": False, "p": {"n": "Good"}},
        "empty": {"path": "nfl/props/empty/", "rows": [], "archived": False, "p": {"n": "Empty"}},
        "blank": {"path": "nfl/props/blank/", "rows": [("up", ["blank", "rush_yds", None])], "archived": False, "p": {"n": "Blank"}},
        "stale": {"path": "nfl/props/stale/", "rows": [("fin", ["stale", "rush_yds", 40])], "archived": True, "p": {"n": "Stale"}},
    }
    L.team_paths = {"1": "nfl/teams/away/"}
    L.ev = {}
    U = SP.League("ufc", {"games": [], "teams": {}, "league": {"kind": "mma"}}, None, SP.Archive(None), now, SP.BASE_URL)
    U.ev = {"e": {"path": "ufc/events/empty-card/", "bouts": [], "name": "Empty Card", "date": SP.iso(now)}}
    U.games, U.paths, U.players, U.team_paths = {}, {}, {}, {}
    pages = [
        "nfl/", "nfl/results/", "nfl/standings/", "nfl/teams/away/",
        "nfl/games/up/", "nfl/games/fin/", "nfl/games/thin/", "nfl/games/noscore/", "nfl/games/held/",
        "nfl/props/good/", "nfl/props/empty/", "nfl/props/blank/", "nfl/props/stale/",
        "ufc/events/empty-card/", "nfl/teams/canon/",
    ]
    tmp = Path(tempfile.mkdtemp(prefix="seotrim-"))
    try:
        (tmp / "sitemap.xml").write_text("<sitemapindex/>\n")
        (tmp / "sitemap-core.xml").write_text("")
        for rel in pages:
            f = tmp / rel / "index.html"
            f.parent.mkdir(parents=True, exist_ok=True)
            canon = SP.BASE_URL + ("nfl/" if rel == "nfl/teams/canon/" else rel)
            f.write_text(f'<html><head><link rel="canonical" href="{canon}"></head><body><p>21+ 1-800-GAMBLER</p></body></html>\n')
        stub = tmp / "nfl/teams/old/index.html"
        stub.parent.mkdir(parents=True, exist_ok=True)
        stub.write_text(SP.redirect_stub("nfl/teams/old/", "nfl/", SP.BASE_URL, "NFL odds"))
        moved = tmp / "nfl/games/moved/index.html"
        moved.parent.mkdir(parents=True, exist_ok=True)
        moved.write_text(SP.redirect_stub("nfl/games/moved/", "nfl/", SP.BASE_URL, "NFL odds"))
        entries = [(rel, lm) for rel in pages] + [
            ("nfl/", lm),
            ("nfl/teams/old/", lm),
            ("nfl/games/moved/", lm),
            ("nfl/games/missing/", lm),
            ("preview/nfl/", lm),
        ]
        stats = SP.update_sitemap(tmp, entries, {"nfl": L, "ufc": U}, lm)
        urls = set(sitemap_page_urls(tmp))
        keep = ["nfl/", "nfl/results/", "nfl/standings/", "nfl/teams/away/", "nfl/games/up/", "nfl/games/fin/", "nfl/props/good/"]
        drop = ["nfl/games/thin/", "nfl/games/noscore/", "nfl/games/held/", "nfl/props/empty/", "nfl/props/blank/", "nfl/props/stale/",
                "ufc/events/empty-card/", "nfl/teams/old/", "nfl/games/moved/", "nfl/games/missing/", "preview/nfl/", "nfl/teams/canon/"]
        for rel in keep:
            check(SP.BASE_URL + rel in urls, f"sitemap keeps {rel}")
        for rel in drop:
            check(SP.BASE_URL + rel not in urls, f"sitemap drops {rel}")
        raw = "\n".join(p.read_text() for p in tmp.glob("sitemap-*.xml"))
        check(raw.count("<loc>" + SP.BASE_URL + "nfl/</loc>") == 1, "duplicate hub is listed once")
        reasons = stats["dropped"]
        check(reasons.get("past game with no odds") == 1, f"past game with no odds dropped ({reasons})")
        check(reasons.get("past game with little content") == 1, f"past game with little content dropped ({reasons})")
        check(reasons.get("postponed or canceled game with no odds") == 1, f"postponed game with no odds dropped ({reasons})")
        check(reasons.get("empty prop page") == 2, f"empty prop pages dropped ({reasons})")
        check(reasons.get("empty event page") == 1, f"empty event page dropped ({reasons})")
        check(reasons.get("meta-refresh") == 1, f"non-game meta-refresh dropped ({reasons})")
        check(reasons.get("duplicate redirect") == 2, f"preview and canonical mismatch dropped ({reasons})")
        check(reasons.get("duplicate url") == 1, f"repeated URL dropped ({reasons})")
        check(sum(reasons.values()) == stats["before"] - stats["after"], f"trim delta matches ({stats['before']} -> {stats['after']}, {reasons})")
        check("21+" in stub.read_text() and "1-800-GAMBLER" in stub.read_text() and 'class="aff-tag">Ad' not in stub.read_text(), "meta-refresh stub keeps the 21+ notice and helpline")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def logo_and_cap_tests():
    class _L:
        lg, hub, base_url = "nfl", "nfl/", SP.BASE_URL
        players = {
            "1": {"path": "nfl/props/josh-allen/", "p": {"n": "Josh Allen", "ta": "BUF"}},
            "2": {"path": "nfl/props/patrick-mahomes/", "p": {"n": "Patrick Mahomes", "ta": "KC"}},
        }
    sh = SP.Shell((ROOT / "site" / "index.html").read_text(), SP.BASE_URL)
    html, title = SP.props_index_page(_L(), sh)
    check("nfl/props/josh-allen/" in html and "nfl/props/patrick-mahomes/" in html, "props index links the player pages")
    check('rel="canonical" href="https://linesmart.app/nfl/props/"' in html, "props index canonical")
    check("Player Props" in title and len(title) <= SP.TITLE_MAX, f"props index title ({title})")
    check('name="description"' in html and "DraftKings" in html and "FanDuel" in html and "Hard Rock Bet" in html, "props index description names the books")
    check("21+" in html and "1-800-GAMBLER" in html, "props index keeps the 21+ notice")
    check("florida" not in html.lower() or "1-833-PLAYWISE" in html, "props index does not claim a book is legal in Florida")
    src = pv.logo_src("https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/lv.png", 22)
    check(src == "https://a.espncdn.com/combiner/i?img=/i/teamlogos/nfl/500/scoreboard/lv.png&w=80&h=80", f"22px logo asks the combiner for 80px ({src})")
    check(pv.logo_src("https://a.espncdn.com/i/teamlogos/nfl/500/gb.png", 42).endswith("w=128&h=128"), "42px logo asks for 128px")
    check(pv.logo_src("https://a.espncdn.com/i/teamlogos/ncaa/500/150.png", 96).endswith("w=256&h=256"), "96px logo asks for 256px")
    check(pv.logo_src("https://example.com/x.png", 22) == "https://example.com/x.png", "non-ESPN logos stay put")
    shown, rest = SP._split_cap(list(range(80)), SP.HUB_GAME_CAP)
    check(shown == list(range(SP.HUB_GAME_CAP)) and rest == list(range(SP.HUB_GAME_CAP, 80)), "a long slate keeps a window and a remainder")
    check(SP._split_cap(list(range(3)), SP.HUB_GAME_CAP)[1] == [], "a short slate is not split")


def main():
    logo_and_cap_tests()
    sitemap_game_guard_tests()
    sitemap_trim_tests()
    title_limit_tests()
    game_title_tests()
    snippet_copy_tests()
    best_lines_filter_tests()
    wtw_tests()
    state_unit_tests()
    state_date_tests()
    college_title_tests()
    fight_method_tests()
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
        for lg in ("nba", "ncaaf", "ncaab"):
            h = (site / lg / "index.html").read_text()
            d = parse(h)
            spec = SP.HUB_COPY[lg]
            h1 = html.unescape(re.search(r'class="pv-h1">(.*?)</h1>', h).group(1))
            lead = html.unescape(re.search(r'class="pv-lead">(.*?)</p>', h).group(1))
            cp = next(n for n in walk_nodes(ld_scripts(h)) if n.get("@type") == "CollectionPage")
            check(d.title == spec["title"] + SP.SUFFIX and len(d.title) <= SP.TITLE_MAX, f"{lg} rendered title {len(d.title)}")
            check(d.meta.get("description") == spec["desc"] and len(spec["desc"]) <= SP.DESC_MAX, f"{lg} rendered description {len(spec['desc'])}")
            check(h1 == spec["h1"], f"{lg} rendered h1")
            check(cp.get("name") == spec["title"] and cp.get("description") == spec["desc"], f"{lg} CollectionPage name and description follow the new copy")
            check(SP.hub_books() in lead, f"{lg} intro names the books from the book table")
            if lg in ("ncaaf", "ncaab"):
                check(has_query_words(d.title) and has_query_words(d.meta.get("description") or ""), f"{lg} rendered title and description say lines, spreads and odds")
        for lg in SP.ORDER:
            h = (site / lg / "index.html").read_text()
            main_h = h.split('id="app">', 1)[1].split("</main>", 1)[0]
            more_h = h.split("</main>", 1)[1].split("<footer", 1)[0]
            check('class="sx-discover"' in main_h and 'class="sx-discover"' in more_h, f"{lg}: crawlable league links in the page and again outside #app")
            check(all(f'href="{o}/"' in more_h for o in SP.ORDER if o != lg), f"{lg}: other league hubs are plain links outside #app")
            today = re.search(r'class="pv-list sx-today">(.*?)</ul>', main_h, re.S)
            if today:
                hrefs = re.findall(r'href="([^"]+)"', today.group(1))
                check(hrefs and any(href in more_h for href in hrefs), f"{lg}: an upcoming game is linked outside #app")
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
            if rel.startswith(("ncaaf/teams/", "ncaab/teams/")) and d.body.get("data-page") == "team":
                label = "NCAAF" if rel.startswith("ncaaf/") else "NCAAB"
                bare = SP.bare_title(d.title or "")
                slug = rel.strip("/").rsplit("/", 1)[-1]
                h1m = re.search(r'class="pv-h1">(.*?)</h1>', h)
                h1 = html.unescape(re.sub(r"<[^>]+>", "", h1m.group(1))) if h1m else ""
                school = re.sub(r" odds, schedule & results$", "", h1, flags=re.I)
                check(f"({label})" in bare, f"{rel}: title names {label} ({d.title})")
                check(not re.search(r"\([a-z0-9]+(?:-[a-z0-9]+)+\)", bare) and slug not in bare, f"{rel}: title has no url slug ({d.title})")
                if school and len(school) + len(f" ({label})") <= SP.TITLE_MAX:
                    check(school in bare, f"{rel}: school name is not clipped ({d.title})")
            check(not d.title.endswith(SP.SUFFIX) or len(SP.bare_title(d.title)) <= SP.TITLE_MAX - len(SP.SUFFIX), f"{rel}: suffix only when the phrase fits ({d.title})")
            check(not PROMO_RE.search(d.meta.get("description") or ""), f"{rel}: description has no promo wording")
            check(d.meta.get("og:title") == d.title == d.meta.get("twitter:title"), f"{rel}: og:title / twitter:title match <title>")
            check_page_ld(rel, h, d.hrefs, d.body.get("data-page") or "")
            robots = d.meta.get("robots") or ""
            if d.body.get("data-page") == "fighter" and "noindex" in robots:
                pass
            else:
                check("noindex" not in robots, f"{rel}: indexable")
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
            parts = route.split("/")
            kind, lg = parts[0], parts[1] if len(parts) > 1 else ""
            ok = (route == f"l/{lg}" and rel == f"{lg}/") or (route == f"l/{lg}/standings" and rel == f"{lg}/standings/") or (kind == "g" and len(parts) > 2 and (man["g"].get(lg) or {}).get(parts[2]) == rel)
            check(ok, f"{rel}: data-route {route} matches the manifest")
        with_data = [lg for lg in man["l"] if (data / lg / "index.json").exists()]
        hubs = sorted({r.split("/")[1] for _, r in hydrated if r.count("/") == 1 and r.startswith("l/")})
        check(any(r.startswith("g/") for _, r in hydrated) and hubs == sorted(with_data), "hubs (with data) and upcoming games are hydrated")
        check(len(man["l"]) == len(SP.ORDER), "every league has a hub, even without data this run")

        # ---- internal linking
        def html_of(p):
            return (site / p / "index.html").read_text()
        for lg, hub in man["l"].items():
            hh = html_of(hub)
            check(f'href="{lg}/results/"' in hh and (site / lg / "results" / "index.html").exists(), f"{lg} hub links /{lg}/results/")
            # A long slate keeps the hub light: overflow games, teams and players live on directory pages the hub links.
            extra = ""
            for rel_extra in (f"{lg}/props/", f"{lg}/teams/", f"{lg}/schedule/"):
                if f'href="{rel_extra}"' not in hh:
                    continue
                folder = site / rel_extra
                if folder.is_dir():
                    extra += "\n" + "\n".join(p.read_text() for p in folder.rglob("index.html"))
            blob = hh + extra
            for kind in ("g", "t", "p"):
                for pid, p in (man[kind].get(lg) or {}).items():
                    if kind == "g":
                        # finals older than the hub's 14-day list live on the results archive, which the hub links
                        continue
                    if f'href="{p}"' not in blob:
                        check(False, f"{lg} hub (or its directory) links {p}")
            res_html = ""
            rdir = site / lg / "results"
            if rdir.is_dir():
                res_html = "\n".join(p.read_text() for p in rdir.rglob("index.html"))
            for p in (man["g"].get(lg) or {}).values():
                if f'href="{p}"' not in blob and f'href="{p}"' not in res_html:
                    check(False, f"{lg} hub, schedule or results archive links {p}")
            if lg in SP.PROP_INDEX_LGS and any("/props/" in p for p in (man.get("p") or {}).get(lg, {}).values()):
                ph = (site / lg / "props" / "index.html").read_text()
                pd = parse(ph)
                check(pd.links.get("canonical") == SP.BASE_URL + f"{lg}/props/", f"{lg} props index canonical")
                check(pd.title and "Player Props" in pd.title and len(pd.title) <= SP.TITLE_MAX, f"{lg} props index title ({pd.title})")
                check(pd.meta.get("description") and pd.meta.get("og:description") == pd.meta.get("description"), f"{lg} props index description")
                check(f'href="{lg}/props/"' in hh, f"{lg} hub links the props index")
                check("21+" in ph and "1-800-GAMBLER" in ph, f"{lg} props index keeps the 21+ notice")
                check(not PROMO_RE.search(pd.meta.get("description") or ""), f"{lg} props index description has no promo wording")
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
        sm = st.get("sitemap") or {}
        dropped_paths = {p for paths in (sm.get("dropped_paths") or {}).values() for p in paths}
        check(sm.get("before") == st["pages"] + 1 + len(SP.TOOL_PAGES), f"sitemap before trim counts every page plus home and tools ({sm.get('before')} vs {st['pages'] + 1 + len(SP.TOOL_PAGES)})")
        check(sm.get("after") == len(urls), f"sitemap after trim matches the written urls ({sm.get('after')} vs {len(urls)})")
        check(sum((sm.get("dropped") or {}).values()) == sm.get("before", 0) - sm.get("after", 0), f"dropped counts add up ({sm.get('dropped')})")
        check(set(SP.BASE_URL + p for p in real if p not in dropped_paths) <= set(urls), "sitemap lists every page it did not trim")
        check(not any(SP.BASE_URL + p in set(urls) for p in dropped_paths), "sitemap omits the trimmed pages")
        check(all(SP.BASE_URL + f"{lg}/" in set(urls) for lg in man["l"]), "sitemap keeps every league hub")
        check(not any(u[len(SP.BASE_URL):] in {r for r, _, _ in stubs} for u in urls), "sitemap: no redirect stubs")
        check(any(u.endswith("/results/") for u in urls), "sitemap-results (or a child) lists results pages")
        core_txt = (site / "sitemap-core.xml").read_text()
        for rel in ("florida/", "new-york/", "louisiana/", "delaware/", "states/", "best-lines-today/"):
            check(SP.BASE_URL + rel in core_txt, f"sitemap-core lists {rel}")
        bl_lm = home_lm = None
        for u in ET.fromstring(core_txt.encode()).findall(ns + "url"):
            loc, lm = u.find(ns + "loc").text, u.find(ns + "lastmod").text
            if loc == SP.BASE_URL:
                home_lm = lm
            if loc == SP.BASE_URL + "best-lines-today/":
                bl_lm = lm
        check(bl_lm and bl_lm == home_lm, f"best-lines-today lastmod is this run's generated stamp ({bl_lm})")
        live_txt = (site / "sitemap-live.xml").read_text() if (site / "sitemap-live.xml").exists() else ""
        check(SP.BASE_URL + "florida/" not in live_txt and SP.BASE_URL + "states/" not in live_txt, "state pages are not in sitemap-live")
        missing, stub_games, game_n = [], [], 0
        for u in urls:
            rel = u[len(SP.BASE_URL):] if u.startswith(SP.BASE_URL) else None
            f = SP.rel_file(site, rel) if rel is not None else None
            if f is None or not f.is_file():
                missing.append(u)
                continue
            if SP.is_game_rel(rel):
                game_n += 1
                if SP.is_redirect_file(f):
                    stub_games.append(u)
        check(not missing, f"every sitemap URL has a matching file ({len(missing)} missing, {missing[:3]})")
        check(game_n > 0 and not stub_games, f"sitemap game URLs are pages this build wrote ({game_n}, stubs {stub_games[:2]})")
        robots = (site / "robots.txt").read_text()
        check("Sitemap: https://linesmart.app/sitemap.xml" in robots, "robots.txt points at the sitemap")
        # rebuild with nothing changed: same lastmods (content-hash driven), and the free-page offer keeps its first validFrom
        sample_rel = next(iter(man["g"]["nfl"].values()))
        vf_before = event_ld_ok(sample_rel, (site / sample_rel / "index.html").read_text(), "nfl", "game")["offers"]["validFrom"]
        st_b = SP.build(site, data, now + timedelta(minutes=30), archive_dir=tmp / "arch")
        vf_after = json.loads(re.search(r'<script type="application/ld\+json">(.*?)</script>', (site / sample_rel / "index.html").read_text(), re.S).group(1).replace("<\\/", "</"))["offers"]["validFrom"]
        check(vf_before and vf_before == vf_after, f"offers.validFrom stays on the first publish time ({vf_before} -> {vf_after})")
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

        # ---- game / fight / prop snippets. Upcoming team-sport pages name the three-book comparison even when a
        # column is still empty (the page compares that set; a missing column is "no line yet"). Finished pages and
        # UFC still name only a book that is actually on the page. UFC is DraftKings only.
        snip_desc = {}
        for lg, gmap in man["g"].items():
            ixg = {str(x["id"]): x for x in (json.loads((data / lg / "index.json").read_text()).get("games") or [])} if (data / lg / "index.json").exists() else {}
            for gid, rel in gmap.items():
                h = (site / rel / "index.html").read_text()
                d = parse(h)
                t, desc = d.title, d.meta.get("description") or ""
                head = re.search(r'<table class="books pv-books"><thead><tr><th>Market</th>(.*?)</tr></thead>', h)
                cols = set(html.unescape(x) for x in re.findall(r'<th data-book="[^"]*">([^<]*)<', head.group(1))) if head else set()
                named = {full for short, full in (("Hard Rock", "Hard Rock Bet"), ("DraftKings", "DraftKings"), ("FanDuel", "FanDuel")) if short in t or short in desc}
                check(" vs " in t and " at " not in t.split(" vs ")[0], f"{rel}: '<away> vs <home>' title ({t})")
                g = ixg.get(str(gid))
                upcoming = bool(g and g.get("state") in ("pre", "in") and lg != "ufc" and not SP.abnormal(g))
                if lg == "ufc":
                    check(named <= {"DraftKings"}, f"{rel}: UFC names DraftKings only ({t})")
                elif upcoming:
                    snippet_ok(t, desc, rel)
                    check(d.meta.get("og:title") == t == d.meta.get("twitter:title"), f"{rel}: og/twitter title")
                    check(d.meta.get("og:description") == desc == d.meta.get("twitter:description"), f"{rel}: og/twitter description")
                    snip_desc.setdefault(desc, []).append(rel)
                else:
                    check(named <= cols, f"{rel}: title/description name only books shown on the page ({sorted(named)} vs {sorted(cols)})")
                if g and lg != "ufc":
                    away_names = {SP.title_side(g["away"]), pv.side_name(g["away"])}
                    check(any(t.startswith(f"{n} vs ") for n in away_names if n) or t.startswith(f"{g['away'].get('abbr')} vs "), f"{rel}: away team first ({t})")
                if upcoming or (g and g.get("state") in ("pre", "in") and lg == "ufc" and not SP.abnormal(g)):
                    check(" Odds" in t, f"{rel}: upcoming title says Odds ({t})")
                if "/games/" in rel and 'class="card sx-result"' in h or (g and g.get("state") == "post"):
                    check("Result" in t or "Final Score" in t, f"{rel}: finished game says Result ({t})")
        for lg, pmap in (man.get("p") or {}).items():
            for pid, rel in (pmap or {}).items():
                if "/props/" not in rel:
                    continue
                h = (site / rel / "index.html").read_text()
                d = parse(h)
                desc = d.meta.get("description") or ""
                snippet_ok(d.title, desc, rel)
                check(d.meta.get("og:title") == d.title == d.meta.get("twitter:title"), f"{rel}: og/twitter title")
                check(d.meta.get("og:description") == desc == d.meta.get("twitter:description"), f"{rel}: og/twitter description")
                check("21+" in h and "1-800-GAMBLER" in h, f"{rel}: 21+ and helpline stay on the prop page")
                snip_desc.setdefault(desc, []).append(rel)
        dupes = [v for v in snip_desc.values() if len(v) > 1]
        check(not dupes, f"upcoming game and prop descriptions are unique ({dupes[:2]})")
        nfl_t = [parse((site / r / "index.html").read_text()).title for r in man["g"].get("nfl", {}).values()]
        pre_t = [x for x in nfl_t if "Final Score" not in x and "Result" not in x and "Canceled" not in x and "Postponed" not in x]
        check(pre_t and all(SP.TITLE_BOOKS in x and DATE_RE.search(x) for x in pre_t), f"NFL upcoming titles name the date and the comparison ({pre_t[:2]})")
        check(all("Final Score" in x or "Result" in x or "Canceled" in x or "Postponed" in x or SP.TITLE_BOOKS in x for x in nfl_t), f"NFL titles are a result or a comparison ({[x for x in nfl_t if SP.TITLE_BOOKS not in x and 'Final' not in x][:2]})")
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
        check('class="sx-discover"' in block and "Upcoming games" in block and "Leagues" in block, "homepage lists upcoming games and league hubs in static HTML")
        check('href="ncaaf/"' in block and 'href="ncaab/"' in block and block.lower().count("odds, lines and spreads") >= 2, "homepage links NCAAF and NCAAB with lines, spreads and odds")
        disc = block.split('class="sx-discover"', 1)[1].split('class="home-cards"', 1)[0]
        game_hrefs = re.findall(r'href="([^"]*/(?:games|fights)/[^"]*)"', disc)
        check(game_hrefs and all(resolve(site, "", None, x).exists() for x in game_hrefs), f"homepage upcoming links are real game pages ({len(game_hrefs)})")
        check(any(h.startswith("ncaaf/games/") for h in game_hrefs) and any(h.startswith("ncaab/games/") for h in game_hrefs), "homepage links an NCAAF game and an NCAAB game")
        hc_logos = re.findall(r'<img class="hc-logo"[^>]*>', block)
        check(len(hc_logos) >= 2, f"homepage game cards include team logos ({len(hc_logos)})")
        check(all("espncdn.com" in t and 'loading="lazy"' not in t and "onerror=" in t and "visibility" in t for t in hc_logos),
              "homepage logos load immediately and hide Safari's broken-image box")
        hc_rule = re.search(r"\.hc-tm img,\.hc-logo\{([^}]*)\}", (ROOT / "site" / "assets" / "styles.css").read_text())
        check(hc_rule and "max-width:none" in hc_rule.group(1) and "flex:none" in hc_rule.group(1),
              "home card logos opt out of the flex max-width:100% trap")
        check('href="best-lines-today/"' in block and "See all best lines today" in block, "homepage cards link best lines today")
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
            check(f'href="#/g/nfl/{g["id"]}/box"' in ph, "past-game page links to the box score")
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
            check(f'href="{path}#/g/nfl/{g["id"]}/box"' in th and ">Full results</a>" in th, "team page result opens that game's box score")
            # 404 page handles the expired URL
            nf = (site2 / "404.html").read_text()
            check("expired" in nf and "noindex" in nf and "1-800-GAMBLER" in nf, "404 page explains expired pages")

        # ---- postponed, canceled, team-rename stub, results schema (tiny archive build)
        edge_cases(tmp)

        # ---- UFC fight + event pages: SportsEvent JSON-LD (the committed snapshot has no UFC data)
        site4 = build_copy(tmp, "site4")
        (site4 / "data" / "ufc").mkdir(parents=True, exist_ok=True)
        fix = ufc_fixture(now)
        old_bout = {
            "id": "401old", "date": SP.iso(now - timedelta(days=40)),
            "name": "Islam Makhachev vs. Ian Machado Garry", "state": "post", "statusDetail": "Final", "completed": True,
            "away": {"id": "21", "name": "Islam Makhachev", "short": "Makhachev", "last": "Makhachev", "record": "27-1-0", "winner": True},
            "home": {"id": "22", "name": "Ian Machado Garry", "short": "Garry", "last": "Garry", "record": "16-1-0", "winner": False},
            "event": {"id": "900002", "name": "UFC 999: Charlie vs. Delta"}, "segment": "main", "segmentName": "Main Card", "matchNo": 2,
            "weightClass": "Lightweight", "rounds": 5, "mainEvent": True,
            "result": {"winner": "away", "round": 5, "clock": "5:00"}, "books": {}, "odds": None,
        }
        fix["games"].append(old_bout)
        (site4 / "data" / "ufc" / "index.json").write_text(json.dumps(fix))
        (site4 / "data" / "ufc" / "fighters.json").write_text(json.dumps({
            "fighters": {"21": {"id": "21", "name": "Islam Makhachev", "hist": [
                {"id": "401old", "method": "Decision - Unanimous", "round": 5, "clock": "5:00", "opp": "Ian Machado Garry"},
            ]}},
        }))
        SP.build(site4, site4 / "data", now, archive_dir=None)
        man4 = json.loads((site4 / "data" / "pages.json").read_text())
        fights = list((man4["g"].get("ufc") or {}).values())
        check(len(fights) == 4, f"UFC fixture: 4 fight pages ({fights})")
        fighter_pages = list((site4 / "ufc" / "fighters").glob("*/index.html"))
        booked = no_book = 0
        core4 = (site4 / "sitemap-core.xml").read_text() if (site4 / "sitemap-core.xml").exists() else ""
        for fp in fighter_pages:
            rel = "ufc/fighters/" + fp.parent.name + "/"
            page = fp.read_text()
            noindex = 'content="noindex, nofollow"' in page
            listed = SP.BASE_URL + rel in core4
            if "islam-makhachev" in rel:
                check("won by Decision - Unanimous in round 5 at 5:00" in page and "won by in round" not in page, "fighter page uses the stored finish method")
                check(noindex and not listed, "a fighter with no upcoming bout is noindex and off the sitemap")
            if noindex:
                no_book += 1
                check(not listed, f"{rel}: noindex fighter is not in sitemap-core")
            else:
                booked += 1
                check(listed, f"{rel}: booked fighter stays in sitemap-core")
        check(booked >= 1 and no_book >= 1, f"ufc fixture splits booked and unbooked fighters ({booked} booked, {no_book} noindex)")
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
