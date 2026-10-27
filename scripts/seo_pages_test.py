"""Tests for scripts/seo_pages.py (crawlable league hub / game / props / team / UFC pages, sitemap, redirects, archive).

Builds from the committed site/data snapshot into a temp copy of site/ (never touches site/), offline, no API key.
Checks every generated page (unique titles + canonicals, og/description, app JS, 21+ / 1-800-GAMBLER / footer, no
'Florida-based', no hard-coded sportsbook offers, no pick language), that every internal link resolves to a file, the
sitemap (valid XML, unique, only real pages, lastmod), robots.txt, /preview/ redirects, the homepage cards, and the
finished-games archive: closing lines captured before the start, the final filled in after the game left the window,
the past-game page, and pruning after KEEP_DAYS.
Usage: python3 scripts/seo_pages_test.py        (DATA_DIR=/path/to/data to test with fresher data)
"""
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
BAD_NAME = re.compile(r"\bRod\b|Rodney", re.I)


def page_dirs(site):
    for d in SP.GEN_DIRS:
        if (site / d).exists():
            yield from sorted((site / d).rglob("index.html"))


def resolve(site, page_rel, base, href):
    """File a relative href points to (or None for anchors / external / app routes)."""
    if not href or href.startswith(("#", "http:", "https:", "mailto:", "tel:", "javascript:", "//")):
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
        for lg in SP.ORDER:
            if (data / lg / "index.json").exists():
                check(man["l"].get(lg) == f"{lg}/" and (site / lg / "index.html").exists(), f"{lg}: hub page")
        check("epl" not in man["l"] and not (site / "epl").exists(), "soccer has no SEO pages")

        # ---- every page
        titles, canon, descs = {}, {}, {}
        stubs, real, broken = [], [], []
        hydrated = []
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
            check(d.title and d.title.endswith("· LineSmart") and len(d.title) <= 90, f"{rel}: title ({d.title})")
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
            check("Final Score &amp; Closing Odds" in ph and "31" in pd.title and "17" in pd.title, f"past-game title has the final score ({pd.title})")
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
