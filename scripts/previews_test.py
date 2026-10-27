#!/usr/bin/env python3
"""Tests for scripts/previews.py (static game preview pages). Offline: builds from a synthetic fixture in a temp dir,
then (if present) from the committed site/data snapshot. Run: python3 scripts/previews_test.py"""
import copy
import json
import re
import shutil
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import previews as P  # noqa: E402

passed = failed = 0


def check(cond, label):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        print("FAIL:", label)


NOW = datetime(2026, 10, 27, 16, 0, tzinfo=timezone.utc)
iso = lambda dt: dt.strftime("%Y-%m-%dT%H:%MZ")


def team(i, abbr, name, short, rec="3-3"):
    return {"id": str(i), "abbr": abbr, "name": name, "short": short, "logo": f"https://a.espncdn.com/{abbr}.png",
            "color": "204e32", "record": rec, "form": "LWWLW"}


def book(hs, hml, aml, tot, asof):
    return {"homeSpread": hs, "awaySpread": -hs, "homeSpreadOdds": -110, "awaySpreadOdds": -110, "homeML": hml, "awayML": aml,
            "total": tot, "overOdds": -110, "underOdds": -110, "asOf": asof}


def game(gid, start, away, home, state="pre", books=True, **kw):
    g = {"id": gid, "date": iso(start), "name": f"{away['name']} at {home['name']}", "state": state, "venue": "Lambeau Field",
         "city": "Green Bay", "venueState": "WI", "venueCountry": "USA", "neutral": False, "broadcasts": ["Prime Video"],
         "home": home, "away": away}
    if books:
        a = iso(NOW - timedelta(minutes=20))
        g["odds"] = {"provider": "Draft Kings", "homeML": -185, "awayML": 154, "homeSpread": -3.5, "awaySpread": 3.5, "total": 47.5,
                     "homeSpreadOpen": -7.0, "totalOpen": 45.5}
        g["books"] = {"draftkings": book(-3.5, -185, 154, 47.5, a), "fanduel": book(-3.5, -198, 166, 47.5, a),
                      "hardrockbet": book(-4.0, -200, 170, 48.0, a)}
        g["move"] = {"book": "draftkings", "since": iso(NOW - timedelta(days=1)), "spread": {"open": -7.0, "cur": -3.5},
                     "total": {"open": 45.5, "cur": 47.5}}
    g.update(kw)
    return g


def fixture(d: Path):
    car, gb = team(29, "CAR", "Carolina Panthers", "Panthers"), team(9, "GB", "Green Bay Packers", "Packers", "4-3")
    kc, buf = team(12, "KC", "Kansas City Chiefs", "Chiefs"), team(2, "BUF", "Buffalo Bills", "Bills")
    nfl = [
        game("1001", NOW + timedelta(days=2, hours=8, minutes=15), car, gb),                       # indexed
        game("1002", NOW + timedelta(days=20), kc, buf),                                # beyond horizon
        game("1003", NOW - timedelta(hours=1), kc, buf, state="in"),                    # live -> redirect stub
        game("1004", NOW - timedelta(hours=100), kc, buf, state="post"),                # old -> dropped
    ]
    w = (d / "nfl" / "games"); w.mkdir(parents=True)
    teams = {"9": {"recordSummary": "4-3", "standingSummary": "4th in NFC North", "homeSplit": {"gp": 3, "w": 2, "l": 1},
                   "awaySplit": {"gp": 4, "w": 2, "l": 2}, "last10": {"gp": 7, "w": 4, "l": 3}, "streak": "L1"},
             "29": {"recordSummary": "3-3", "homeSplit": {"gp": 3, "w": 1, "l": 2}, "awaySplit": {"gp": 3, "w": 2, "l": 1},
                    "last10": {"gp": 6, "w": 3, "l": 3}, "streak": "W2"}}
    (d / "nfl" / "index.json").write_text(json.dumps({"league": {"key": "nfl", "name": "NFL", "full": "National Football League", "kind": "football"},
                                                     "generated": iso(NOW), "games": nfl, "teams": teams}))
    (w / "1001.json").write_text(json.dumps({"game": nfl[0], "detail": {"injuriesAvailable": True, "injuries": {
        "9": [{"player": "Kaleb Johnson", "pos": "RB", "status": "Out", "type": "Ankle"}],
        "29": [{"player": "Some Player", "pos": "WR", "status": "Questionable", "type": "Knee"}]}}}))
    (d / "props").mkdir()
    (d / "props" / "nfl.json").write_text(json.dumps({"markets": {"pass_yds": ["Passing yards", "Pass yds"]},
        "players": {"77": {"n": "Bryce Young", "pos": "QB", "ta": "CAR"}},
        "games": {"1001": {"props": [["77", "pass_yds", 205.5, None, [3, 3, 0, 6], {"draftkings": [205.5, -115, -115], "hardrockbet": [204.5, -110, -110]}]]}}}))
    # college: one game without any line (skipped), one with lines
    ul, unc = team(97, "LOU", "Louisville Cardinals", "Cardinals"), team(153, "UNC", "North Carolina Tar Heels", "Tar Heels")
    (d / "ncaaf").mkdir()
    (d / "ncaaf" / "index.json").write_text(json.dumps({"league": {"key": "ncaaf", "name": "NCAAF", "full": "College Football", "kind": "football"},
        "games": [game("2001", NOW + timedelta(days=3), ul, unc), game("2002", NOW + timedelta(days=3), unc, ul, books=False)], "teams": {}}))
    # UFC: main card only
    f1, f2 = {"id": "501", "name": "Jiří Procházka", "abbr": "PROC"}, {"id": "502", "name": "Alex Pereira", "abbr": "PERE"}
    f3, f4 = {"id": "503", "name": "Prelim One", "abbr": "PRE1"}, {"id": "504", "name": "Prelim Two", "abbr": "PRE2"}
    ufc = [game("3001", NOW + timedelta(days=4), f1, f2, segment="main", mainEvent=True, event={"name": "UFC 999"}),
           game("3002", NOW + timedelta(days=4), f3, f4, segment="prelims", event={"name": "UFC 999"})]
    (d / "ufc").mkdir()
    (d / "ufc" / "index.json").write_text(json.dumps({"league": {"key": "ufc", "name": "UFC", "full": "UFC", "kind": "mma"}, "games": ufc, "teams": {}}))
    (d / "meta.json").write_text(json.dumps({"generated": iso(NOW)}))


class Doc(HTMLParser):
    def __init__(self):
        super().__init__()
        self.meta, self.links, self.ld, self.scripts, self.base, self._ld, self.text = {}, {}, [], [], None, None, []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "meta":
            self.meta[a.get("name") or a.get("property") or a.get("http-equiv")] = a.get("content")
        elif tag == "link" and a.get("rel"):
            self.links[a["rel"]] = a.get("href")
        elif tag == "base":
            self.base = a.get("href")
        elif tag == "script":
            if a.get("type") == "application/ld+json":
                self._ld = []
            elif a.get("src"):
                self.scripts.append(a["src"])

    def handle_data(self, data):
        if self._ld is not None:
            self._ld.append(data)
        else:
            self.text.append(data)

    def handle_endtag(self, tag):
        if tag == "script" and self._ld is not None:
            self.ld.append(json.loads("".join(self._ld)))
            self._ld = None


def parse(html):
    d = Doc(); d.feed(html); return d


BAD_NAME = re.compile(r"\bRod\b|Rodney", re.I)   # same check as newsletter_test.mjs
SITE_FILES = ["index.html", "sitemap.xml", "robots.txt", "manifest.webmanifest", "sw.js"]


def common_page_checks(html, label, real_data=False):
    """real_data: pages built from live data contain real player names (a QB named Lock, say), so only the
    text we write ourselves (summary paragraph, page chrome with data cells removed) is checked for those words."""
    check("21+" in html and "1-800-GAMBLER" in html, f"{label}: 21+ and 1-800-GAMBLER")
    body = re.sub(r"<script.*?</script>|<style.*?</style>", "", html, flags=re.S)
    if real_data:
        summ = re.search(r'<div class="card pv-summary"><p>(.*?)</p>', body, re.S)
        prose = summ.group(1) if summ else ""
        chrome = re.sub(r"<(table|ul|ol)\b.*?</\1>|<h1.*?</h1>|<title>.*?</title>|<b>.*?</b>", " ", body, flags=re.S)
        chrome = re.sub(r'<div class="card pv-summary">.*?</div>', " ", chrome, flags=re.S)
        chrome = re.sub(r'<meta[^>]*>|<a [^>]*class="tlink"[^>]*>.*?</a>', " ", chrome, flags=re.S)
    else:
        prose = chrome = body
    check(not BAD_NAME.search(chrome) and not BAD_NAME.search(prose), f"{label}: no owner name")
    m = P.FORBIDDEN.search(re.sub(r"<[^>]+>", " ", prose)) or P.FORBIDDEN.search(re.sub(r"<[^>]+>", " ", chrome))
    check(not m, f"{label}: no pick/guarantee language ({m and m.group(0)})")


# ---------- unit checks
check(P.slugify("Jiří Procházka") == "jiri-prochazka", "slugify strips accents")
check(P.slugify("St. Louis Blues") == "st-louis-blues", "slugify punctuation")
car, gb = team(29, "CAR", "Carolina Panthers", "Panthers"), team(9, "GB", "Green Bay Packers", "Packers")
g0 = game("1", datetime(2026, 10, 30, 0, 15, tzinfo=timezone.utc), car, gb)   # 8:15 PM ET on Oct 29
used = set()
p1 = P.page_path("nfl", g0, used)
check(p1 == "preview/nfl/carolina-panthers-at-green-bay-packers-2026-10-29/", f"ET date in path ({p1})")
p2 = P.page_path("nfl", dict(g0, id="2"), used)
check(p2 != p1 and p2.endswith("-2/"), f"collision gets id suffix ({p2})")
check(P.page_path("ufc", dict(g0, id="3"), set()).split("/")[2].startswith("carolina-panthers-vs-"), "UFC uses -vs-")
many = [game(str(i), NOW + timedelta(hours=i), car, gb) for i in range(80)]
sel = P.select("nba", many, NOW)
check(len([1 for _, m in sel if m == "index"]) == P.LEAGUES["nba"]["cap"], "per-league cap enforced")
check([g["id"] for g, _ in sel] == sorted([g["id"] for g, _ in sel], key=int), "soonest games kept first")
check("epl" not in P.LEAGUES and "mls" not in P.LEAGUES, "soccer not included")
check(P.ref_name("nfl", gb, True) == "The Packers" and P.ref_name("ncaaf", gb) == "Green Bay Packers", "ref_name grammar")

# ---------- fixture build
tmp = Path(tempfile.mkdtemp(prefix="pvtest-"))
try:
    site = tmp / "site"; site.mkdir()
    (site / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                                      '  <url><loc>https://linesmart.app/</loc></url>\n  <!-- previews:start -->\n  <!-- previews:end -->\n</urlset>\n')
    data = site / "data"; data.mkdir(); fixture(data)
    stats = P.build(site, data, NOW)
    check(stats["nfl"] == {"pages": 1, "redirects": 1}, f"nfl stats {stats.get('nfl')}")
    check(stats["ncaaf"]["pages"] == 1, "college game without a line skipped")
    check(stats["ufc"]["pages"] == 1, "UFC prelims skipped")
    pv = site / "preview"
    files = sorted(str(p.relative_to(pv)) for p in pv.rglob("index.html"))
    check(len(files) == 1 + 1 + 1 + 1 + 1, f"page files {files}")
    check(not (site / ".preview.tmp").exists() and not (site / ".preview.old").exists(), "temp dirs cleaned up")
    man = json.loads((data / "previews.json").read_text())
    nfl_path = "preview/nfl/carolina-panthers-at-green-bay-packers-2026-10-29/"
    check(man["leagues"]["nfl"] == {"1001": nfl_path}, f"manifest maps game id to path ({man['leagues'].get('nfl')})")
    check("1003" not in man["leagues"]["nfl"], "started game not in manifest")
    check(json.loads((data / "meta.json").read_text()).get("previews", {}).get("pages") == 3, "meta.json flags previews for the app")

    html = (site / nfl_path / "index.html").read_text()
    d = parse(html)
    url = P.BASE_URL + nfl_path
    check(d.links.get("canonical") == url, "canonical")
    check(d.meta.get("og:url") == url and d.meta.get("og:title") and d.meta.get("og:image"), "Open Graph tags")
    check(d.meta.get("twitter:card"), "twitter card")
    check(d.base == "../../../", "base href points at site root (works under a subpath)")
    import html as _h
    t = _h.unescape(re.search(r"<title>(.*?)</title>", html).group(1))
    check("Panthers" in t and "Packers" in t and len(t) <= 70, f"title ({t})")
    desc = d.meta.get("description") or ""
    check(50 <= len(desc) <= 170, f"meta description length {len(desc)}")
    check("noindex" not in (d.meta.get("robots") or ""), "indexable")
    ev = next((x for x in d.ld if x.get("@type") == "SportsEvent"), None)
    check(ev is not None, "SportsEvent JSON-LD")
    if ev:
        check(ev["startDate"].startswith("2026-10-29T20:15") and ev["startDate"].endswith("-04:00"), f"startDate with ET offset ({ev['startDate']})")
        check(ev["homeTeam"]["name"] == "Green Bay Packers" and ev["awayTeam"]["name"] == "Carolina Panthers", "home/away teams")
        check(ev["location"]["name"] == "Lambeau Field" and ev["location"]["address"]["addressRegion"] == "WI", "location")
        check(ev.get("eventStatus", "").endswith("EventScheduled") and ev.get("url") == url, "status + url")
    check(any(x.get("@type") == "BreadcrumbList" for x in d.ld), "BreadcrumbList JSON-LD")
    txt = " ".join(d.text)
    check("8:15 PM ET" in txt, "start time in ET")
    for k in ("Hard Rock Bet", "DraftKings", "FanDuel"):
        check(k in html, f"odds table has {k}")
    check("+170" in html and "-3.5" in html and "48" in html, "best lines shown")
    check(re.search(r'class="[^"]*best', html), "best price highlighted")
    check("Line movement" in html and "-7" in html, "line movement section")
    check("Bryce Young" in html and "Passing yards" in html, "player props")
    check("Kaleb Johnson" in html and "Questionable" in html, "injuries")
    check("4-3" in html and "3-3" in html, "records")
    check("The Panthers are 3-3" in txt or "the Panthers are 3-3" in txt, "form sentence grammar")
    check('href="#/g/nfl/1001"' in html, "link to the live game page")
    check('id="pvOffers"' in html and not re.search(r"sign ?up bonus|promo code", html, re.I), "offers left to geo.js")
    sc = d.scripts
    need = ["assets/books-by-state.js", "assets/geo-core.js", "assets/geo.js", "assets/preview.js"]
    check(all(any(s.split("?")[0] == n for s in sc) for n in need), f"geo scripts loaded ({sc})")
    idx = [next(i for i, s in enumerate(sc) if s.split("?")[0] == n) for n in need]
    check(idx == sorted(idx), "geo scripts load before preview.js")
    check(re.search(r'<th data-book="hardrockbet"', html) and re.search(r'data-book="draftkings"', html), "book columns tagged for geo dimming")
    check('id="stateBtn"' in html, "state picker button")
    common_page_checks(html, "nfl page")

    stub = next(p for p in pv.rglob("index.html") if "1003" in p.read_text() and "noindex" in p.read_text())
    s = stub.read_text(); sd = parse(s)
    check("noindex" in (sd.meta.get("robots") or ""), "stub is noindex")
    check("#/g/nfl/1003" in s and "location.replace" in s and (sd.meta.get("refresh") or "").find("#/g/nfl/1003") > 0, "stub redirects to game page")
    check("21+" in s, "stub 21+")
    check(not sd.ld, "stub has no JSON-LD")

    ufc = (site / "preview" / "ufc").rglob("index.html").__next__().read_text()
    check("jiri-prochazka-vs-alex-pereira" in str(next((site / "preview" / "ufc").iterdir())), "UFC path")
    ud = parse(ufc); uev = next(x for x in ud.ld if x.get("@type") == "SportsEvent")
    check(uev.get("competitor") and all(c["@type"] == "Person" for c in uev["competitor"]), "UFC competitors are Person")
    common_page_checks(ufc, "ufc page")

    hub = (pv / "index.html").read_text()
    check(nfl_path.replace("preview/", "", 1) in hub or nfl_path in hub, "hub links the game")
    check("noindex" not in hub and "CollectionPage" in hub, "hub indexable CollectionPage")
    common_page_checks(hub, "hub")

    sm = (site / "sitemap.xml").read_text()
    block = sm.split("<!-- previews:start -->")[1].split("<!-- previews:end -->")[0]
    locs = re.findall(r"<loc>(.*?)</loc>", block)
    check(P.BASE_URL + "preview/" in locs and url in locs, "sitemap lists hub and page")
    check(len(locs) == 1 + 3, f"sitemap: indexable pages only ({len(locs)})")
    check(not any("1003" in l or "kansas-city-chiefs-at-buffalo" in l for l in locs), "no stubs in sitemap")
    check(sm.count("<!-- previews:start -->") == 1 and sm.strip().endswith("</urlset>"), "sitemap still well-formed")
    # rebuild later: everything moves on, sitemap block replaced not duplicated, the game page becomes a stub
    later = NOW + timedelta(days=2, hours=9)
    ix = json.loads((data / "nfl" / "index.json").read_text()); ix["games"][0]["state"] = "in"
    (data / "nfl" / "index.json").write_text(json.dumps(ix))
    P.build(site, data, later)
    sm2 = (site / "sitemap.xml").read_text()
    check(sm2.count("<!-- previews:start -->") == 1 and url not in sm2, "rebuild replaces sitemap block, started game removed")
    page2 = (site / nfl_path / "index.html").read_text()
    check("noindex" in page2 and "#/g/nfl/1001" in page2, "started game page becomes redirect stub")
    P.build(site, data, NOW + timedelta(days=6))
    check(not (site / nfl_path).exists(), "stub pruned after the stub window")
    # sitemap without markers: block inserted before </urlset>
    (site / "sitemap.xml").write_text('<?xml version="1.0"?>\n<urlset>\n</urlset>\n')
    P.build(site, data, NOW)
    check("<!-- previews:start -->" in (site / "sitemap.xml").read_text(), "markers inserted when missing")

    # ---------- committed snapshot smoke test (whatever site/data currently holds)
    real = ROOT / "site" / "data"
    if (real / "meta.json").exists():
        s2 = tmp / "real"; shutil.copytree(real, s2 / "data")
        shutil.copy(ROOT / "site" / "sitemap.xml", s2 / "sitemap.xml")
        gen = P.parse_dt(json.loads((real / "meta.json").read_text()).get("generated")) or NOW
        st = P.build(s2, s2 / "data", gen)
        n = 0
        for f in (s2 / "preview").rglob("index.html"):
            h = f.read_text(); n += 1
            dd = parse(h)  # JSON-LD must parse
            common_page_checks(h, f"snapshot {f.relative_to(s2)}", real_data=True)
            if "noindex" not in (dd.meta.get("robots") or ""):
                check(dd.links.get("canonical", "").startswith(P.BASE_URL + "preview/"), f"canonical {f}")
        check(n == st["total"]["pages"] + st["total"]["redirects"] + 1, "snapshot page count matches stats")
        print(f"snapshot build: {st['total']} ({n} files)")
finally:
    shutil.rmtree(tmp, ignore_errors=True)

print(f"{'PASS' if not failed else 'FAIL'} previews: {passed}/{passed + failed}")
sys.exit(1 if failed else 0)
