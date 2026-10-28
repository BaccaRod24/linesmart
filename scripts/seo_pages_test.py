"""Tests for scripts/seo_pages.py (crawlable league hub / game / props / team / UFC pages, sitemap, redirects, archive).

Builds from the committed site/data snapshot into a temp copy of site/ (never touches site/), offline, no API key.
Checks every generated page (unique titles + canonicals, og/description, app JS, 21+ / 1-800-GAMBLER / footer, no
'Florida-based', no hard-coded sportsbook offers, no pick language), that every internal link resolves to a file, the
sitemap (valid XML, unique, only real pages, lastmod), robots.txt, /preview/ redirects, the homepage cards, and the
finished-games archive: closing lines captured before the start, the final filled in after the game left the window,
the past-game page, and pruning after KEEP_DAYS.
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
from datetime import timedelta
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


OFFER = re.compile(r'class="of-book|Bet on (DraftKings|FanDuel|Hard Rock|BetMGM|Caesars|Fanatics)|href="https?://[^"]*(draftkings|fanduel|hardrock|betmgm|caesars|fanatics)[^"]*"', re.I)
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


def main():
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
            check(40 <= len(d.meta.get("description") or "") <= 170, f"{rel}: description length {len(d.meta.get('description') or '')}")
            check(d.title and d.title.endswith(SP.SUFFIX) and len(d.title) - len(SP.SUFFIX) <= SP.TITLE_MAX, f"{rel}: title <= {SP.TITLE_MAX} chars + brand ({d.title})")
            check(d.meta.get("og:title") == d.title == d.meta.get("twitter:title"), f"{rel}: og:title / twitter:title match <title>")
            check("noindex" not in (d.meta.get("robots") or ""), f"{rel}: indexable")
            check(any(s.endswith("assets/app.js") for s in d.scripts), f"{rel}: loads the app JS")
            check(d.meta.get("_base") == "../" * rel.count("/"), f"{rel}: <base> points at the site root")
            check("21+" in h and "1-800-GAMBLER" in h, f"{rel}: 21+ and 1-800-GAMBLER")
            check("LineSmart · contact@linesmart.app" in re.sub(r"<[^>]+>", "", h), f"{rel}: privacy footer")
            # page chrome only (header, footer, meta): game/player content can contain real names like Rodney
            chrome = re.sub(r'<main class="wrap" id="app">.*?</main>|<section class="wrap seo-more".*?</section>\s*(?=<footer|<nav|<div class="ftr|$)|<script.*?</script>', " ", h, flags=re.S)
            check("Florida-based" not in h and not BAD_NAME.search(chrome), f"{rel}: no owner location or name")
            m = OFFER.search(h)
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
            for kind in ("g", "t", "p"):
                for pid, p in (man[kind].get(lg) or {}).items():
                    if f'href="{p}"' not in hh:
                        check(False, f"{lg} hub links {p}")
        check(True, "hubs link every page of their league")
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

        # ---- sitemap + robots
        sm = (site / "sitemap.xml").read_text()
        root = ET.fromstring(sm.encode())
        ns = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
        locs = [(u.find(ns + "loc").text, (u.find(ns + "lastmod").text if u.find(ns + "lastmod") is not None else None)) for u in root.findall(ns + "url")]
        urls = [u for u, _ in locs]
        check(len(urls) == len(set(urls)), "sitemap: no duplicate URLs")
        check(all(lm and re.match(r"^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2}))?$", lm) for _, lm in locs), "sitemap: every URL has a W3C lastmod")
        check(set(SP.BASE_URL + p for p in real) <= set(urls), "sitemap lists every page")
        check(not any(u[len(SP.BASE_URL):] in {r for r, _, _ in stubs} for u in urls), "sitemap: no redirect stubs")
        for u in urls:
            p = u[len(SP.BASE_URL):]
            f = site / p / "index.html" if (p == "" or p.endswith("/")) else site / p
            if not f.exists():
                check(False, f"sitemap URL exists: {u}")
        check(sm.count(SP.MAP_START) == 1 and "previews:start" not in sm and "<changefreq>" not in sm, "sitemap: one generated block, no old markers")
        robots = (site / "robots.txt").read_text()
        check("Sitemap: https://linesmart.app/sitemap.xml" in robots, "robots.txt points at the sitemap")
        # rebuild with nothing changed: same lastmods (content-hash driven), no duplicated block
        st_b = SP.build(site, data, now + timedelta(minutes=30), archive_dir=tmp / "arch")
        sm2 = (site / "sitemap.xml").read_text()
        lm1 = dict(locs)
        lm2 = {u.find(ns + "loc").text: u.find(ns + "lastmod").text for u in ET.fromstring(sm2.encode()).findall(ns + "url")}
        same = sum(lm1.get(u) == v for u, v in lm2.items() if u != SP.BASE_URL)
        check(sm2.count(SP.MAP_START) == 1 and same >= 0.9 * (len(lm2) - 1), f"rebuild keeps lastmod for unchanged pages ({same}/{len(lm2) - 1})")
        check(st_b["pages"] == st["pages"], "rebuild: same page count")

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
                    if bk and len(f"{a_ if lg != 'ufc' else g['away'].get('name')} vs ") + len(", ".join(bk)) < 30:
                        check(t.split(" Odds", 1)[-1].startswith(": "), f"{rel}: books in the title when they fit ({t})")
                if "/games/" in rel and 'class="card sx-result"' in h or (g and g.get("state") == "post"):
                    check("Result" in t or "Final Score" in t, f"{rel}: finished game says Result ({t})")
        nfl_t = [parse((site / r / "index.html").read_text()).title for r in man["g"].get("nfl", {}).values()]
        check(any(re.search(r" vs .+ Odds: (Hard Rock, )?DraftKings(, FanDuel)? \| LineSmart$", x) for x in nfl_t), f"NFL titles carry the books ({nfl_t[:2]})")
        check(SP.fit("x" * 70, "Short") == "Short" + SP.SUFFIX and SP.fit("x" * 70) == "x" * 70 + SP.SUFFIX, "fit(): first candidate that fits, else shortest")
        check(SP.and_list(["Hard Rock", "DraftKings", "FanDuel"]) == "Hard Rock, DraftKings and FanDuel" and SP.and_list(["FanDuel"]) == "FanDuel", "and_list()")
        g0 = {"odds": {"provider": "DraftKings", "homeML": -150, "awayML": 130}, "books": {}}
        check(SP.page_books({"odds": {"provider": "ESPN BET", "homeML": -150, "awayML": 130}}, "nba") == [] and
              SP.page_books(g0, "nba") in (["draftkings"], []), "page_books(): ESPN column counts only when it is one of our books")

        # ---- homepage cards
        ih = (site / "index.html").read_text()
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
            check(pd.links.get("canonical") == SP.BASE_URL + path and SP.BASE_URL + path in (site2 / "sitemap.xml").read_text(), "past-game page canonical + in sitemap")
            check(f'href="{path}"' in (site2 / "nfl" / "index.html").read_text(), "hub links the past game")
            a = json.loads((arch / "games-nfl.json").read_text())[g["id"]]
            check(a["state"] == "post" and a["home"]["score"] == 31 and a["away"]["score"] == 17, f"archive final normalized ({a['home'].get('score')!r}-{a['away'].get('score')!r})")
            # 61 days later: pruned from the archive, the page, the manifest and the sitemap
            SP.build(site2, d2, start + timedelta(days=SP.KEEP_DAYS + 1), archive_dir=arch)
            man3 = json.loads((d2 / "pages.json").read_text())
            check(g["id"] not in (man3["g"].get("nfl") or {}) and not (site2 / path).exists(), "game page pruned after KEEP_DAYS")
            check(g["id"] not in json.loads((arch / "games-nfl.json").read_text()), "archive pruned after KEEP_DAYS")
            check(SP.BASE_URL + path not in (site2 / "sitemap.xml").read_text(), "pruned page leaves the sitemap")
            # 404 page handles the expired URL
            nf = (site2 / "404.html").read_text()
            check("expired" in nf and "noindex" in nf and "1-800-GAMBLER" in nf, "404 page explains expired pages")

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
