"""Official UFC rankings from the public UFC.com rankings page.

https://www.ufc.com/rankings is free HTML (no key). ESPN's MMA rankings feed is a stale
snapshot, so this does not use it. The Odds API is not called.

scripts/build_data.py fetches the page on every UFC refresh and writes
site/data/ufc/rankings.json. A failed fetch, or a page that does not parse as the full
official board, leaves the previous file in place.
"""
import datetime as dt
import email.utils
import json
import os
import re
import unicodedata
import urllib.error
import urllib.request
from html.parser import HTMLParser

URL = "https://www.ufc.com/rankings"
UA = "Mozilla/5.0 LineSmart/1.0"

# Official board only. "All Meta Rankings" (view-display-id-meta_rankings) is a second list and is ignored.
REQUIRED = (
    ("mens-p4p", "Men's Pound-for-Pound", "Men's P4P", "men", "p4p"),
    ("womens-p4p", "Women's Pound-for-Pound", "Women's P4P", "women", "p4p"),
    ("flyweight", "Flyweight", "Flyweight", "men", "division"),
    ("bantamweight", "Bantamweight", "Bantamweight", "men", "division"),
    ("featherweight", "Featherweight", "Featherweight", "men", "division"),
    ("lightweight", "Lightweight", "Lightweight", "men", "division"),
    ("welterweight", "Welterweight", "Welterweight", "men", "division"),
    ("middleweight", "Middleweight", "Middleweight", "men", "division"),
    ("light-heavyweight", "Light Heavyweight", "Light Heavyweight", "men", "division"),
    ("heavyweight", "Heavyweight", "Heavyweight", "men", "division"),
    ("womens-strawweight", "Women's Strawweight", "W Strawweight", "women", "division"),
    ("womens-flyweight", "Women's Flyweight", "W Flyweight", "women", "division"),
    ("womens-bantamweight", "Women's Bantamweight", "W Bantamweight", "women", "division"),
)
_BY_KEY = {row[0]: row for row in REQUIRED}
# A division UFC still publishes but that is not part of the required board (women's featherweight has been vacant).
_EXTRA = {
    "womens-featherweight": ("Women's Featherweight", "W Featherweight", "women", "division"),
}
_HEADERS = {row[1].lower(): row[0] for row in REQUIRED}
_HEADERS["women's featherweight"] = "womens-featherweight"
MIN_RANKS = 5


def _norm_header(text):
    t = re.sub(r"\s+", " ", text or "").strip()
    t = t.replace("\u2019", "'").replace("\u2018", "'")
    t = re.sub(r"\s+top rank$", "", t, flags=re.I).strip().lower()
    return _HEADERS.get(t)


def _slug(href):
    m = re.search(r"/athlete/([a-z0-9-]+)", href or "", re.I)
    return m.group(1).lower() if m else ""


def _classes(attrs):
    raw = ""
    for k, v in attrs:
        if k == "class":
            raw = v or ""
    return set(raw.split())


def _change(text, classes):
    t = " ".join((text or "").split())
    if "athlete-rankings--not-ranked" in classes or re.search(r"\bNR\b", t):
        return "nr"
    m = re.search(r"(\d+)", t)
    if not m:
        return None
    n = int(m.group(1))
    low = t.lower()
    if "athlete-rankings--rank-decrease" in classes or "decreased" in low:
        return -n
    if "athlete-rankings--rank-increase" in classes or "increased" in low:
        return n
    return None


class _Parser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.official = None
        self.groups = []
        self.group = None
        self.capture = None
        self.capture_depth = 0
        self.buf = []
        self.cell_classes = set()
        self.champ = None
        self.row = None
        self.href = ""

    def handle_starttag(self, tag, attrs):
        classes = _classes(attrs)
        self.stack.append({"tag": tag, "classes": classes})
        if self.official is None:
            if tag == "div" and "view-display-id-block_1" in classes:
                self.official = len(self.stack)
            return
        if tag == "div" and "view-grouping" in classes and "view-grouping-header" not in classes and "view-grouping-content" not in classes:
            self.group = {"header": "", "champs": [], "ranks": []}
            self.groups.append(self.group)
            return
        if self.group is None:
            return
        if tag == "div" and "view-grouping-header" in classes:
            self._start("header")
            return
        if tag == "div" and "rankings--athlete--champion" in classes:
            self.champ = {"name": "", "slug": "", "role": "", "classes": classes}
            self.group["champs"].append(self.champ)
            return
        if self.champ is not None and tag == "h6":
            self._start("role")
            return
        if self.champ is not None and tag == "a" and not self.champ.get("name"):
            self.href = dict(attrs).get("href") or ""
            self._start("name")
            return
        if tag == "tr":
            self.row = {"rank": None, "name": "", "slug": "", "change": None, "_i": len(self.group["ranks"])}
            return
        if self.row is not None and tag == "td":
            if "views-field-weight-class-rank" in classes:
                self._start("rank")
            elif "views-field-title" in classes:
                self._start("title")
            elif "views-field-weight-class-rank-change" in classes:
                self.cell_classes = set()
                self._start("change")
            return
        if self.capture == "title" and tag == "a" and not self.row.get("slug"):
            self.row["slug"] = _slug(dict(attrs).get("href") or "")
            return
        if self.capture == "change":
            self.cell_classes |= classes

    def handle_endtag(self, tag):
        # Finish a cell only when the tag that opened it closes. Rank movement
        # puts the number after an inner <span>, so a nested close must not cut the text off.
        if self.capture and len(self.stack) == self.capture_depth and self.stack and self.stack[-1]["tag"] == tag:
            self._finish()
        if self.champ is not None and tag == "div" and self.stack and "rankings--athlete--champion" in self.stack[-1]["classes"]:
            self.champ = None
        if self.row is not None and tag == "tr":
            if self.group is not None and self.row.get("name") and isinstance(self.row.get("rank"), int):
                if 1 <= self.row["rank"] <= 15:
                    self.group["ranks"].append(self.row)
            self.row = None
        if self.group is not None and tag == "div" and self.stack and "view-grouping" in self.stack[-1]["classes"] and "view-grouping-header" not in self.stack[-1]["classes"] and "view-grouping-content" not in self.stack[-1]["classes"]:
            self.group = None
        if self.official is not None and len(self.stack) == self.official and tag == "div":
            self.official = None
            self.group = None
        if self.stack:
            self.stack.pop()

    def handle_data(self, data):
        if self.capture:
            self.buf.append(data)

    def _start(self, kind):
        self.capture = kind
        self.capture_depth = len(self.stack)
        self.buf = []

    def _finish(self):
        text = " ".join("".join(self.buf).split())
        kind, self.capture, self.buf = self.capture, None, []
        if kind == "header" and self.group is not None:
            self.group["header"] = text
        elif kind == "name" and self.champ is not None and text:
            self.champ["name"] = text
            self.champ["slug"] = _slug(self.href) or self.champ.get("slug") or ""
        elif kind == "role" and self.champ is not None:
            self.champ["role"] = text
        elif kind == "rank" and self.row is not None:
            try:
                self.row["rank"] = int(text)
            except ValueError:
                self.row["rank"] = None
        elif kind == "title" and self.row is not None and text:
            self.row["name"] = text
        elif kind == "change" and self.row is not None:
            self.row["change"] = _change(text, self.cell_classes)
            self.cell_classes = set()


def _person(name, slug):
    row = {"name": name}
    if slug:
        row["slug"] = slug
    return row


def _division(key, header, champs, ranks):
    meta = _BY_KEY.get(key)
    extra = _EXTRA.get(key)
    if meta:
        name, short, gender, kind = meta[1], meta[2], meta[3], meta[4]
    elif extra:
        name, short, gender, kind = extra
    else:
        name, short, gender, kind = header or key, header or key, "", "division"
    champ = interim = None
    for c in champs:
        role = (c.get("role") or "").lower()
        if not c.get("name"):
            continue
        if "interim" in role and interim is None:
            interim = _person(c["name"], c.get("slug") or "")
        elif role.startswith("champion") and "interim" not in role and champ is None:
            champ = _person(c["name"], c.get("slug") or "")
    rows = []
    for r in sorted(ranks, key=lambda r: (r["rank"], r.get("_i", 0))):
        row = {"rank": r["rank"], "name": r["name"]}
        if r.get("slug"):
            row["slug"] = r["slug"]
        if r.get("change") not in (None, 0):
            row["change"] = r["change"]
        rows.append(row)
    out = {
        "key": key,
        "name": name,
        "short": short,
        "gender": gender,
        "kind": kind,
        "champion": champ,
        "interim": interim,
        "ranks": rows,
    }
    return out


def parse_rankings(html):
    """Official divisions from the UFC.com rankings HTML. Meta rankings are not included.

    Returns {"divisions": [...]} . An unusable page returns no divisions.
    """
    if not isinstance(html, str) or "view-display-id-block_1" not in html:
        return {"divisions": []}
    p = _Parser()
    try:
        p.feed(html)
        p.close()
    except Exception:
        return {"divisions": []}
    found = {}
    extras = []
    for g in p.groups:
        key = _norm_header(g.get("header"))
        if not key or key in found:
            continue
        div = _division(key, g.get("header") or "", g.get("champs") or [], g.get("ranks") or [])
        if key in _BY_KEY or key in _EXTRA:
            found[key] = div
        else:
            extras.append(div)
    ordered = [found[k] for k, *_ in REQUIRED if k in found]
    for key, div in found.items():
        if key not in _BY_KEY:
            ordered.append(div)
    ordered.extend(extras)
    return {"divisions": ordered}


def complete(parsed):
    """True when every required division has a real ranked list. A short or missing board is a bad fetch."""
    if not isinstance(parsed, dict):
        return False
    divs = {}
    for d in parsed.get("divisions") or []:
        if isinstance(d, dict) and d.get("key"):
            divs[d["key"]] = d
    for key, *_rest in REQUIRED:
        d = divs.get(key)
        if not d:
            return False
        ranks = [r for r in (d.get("ranks") or []) if isinstance(r, dict) and r.get("name") and isinstance(r.get("rank"), int)]
        if len(ranks) < MIN_RANKS:
            return False
        if not any(1 <= r["rank"] <= 15 for r in ranks):
            return False
    return True


def _iso(value):
    if not value:
        return None
    if isinstance(value, dt.datetime):
        t = value if value.tzinfo else value.replace(tzinfo=dt.timezone.utc)
        return t.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    s = str(value).strip()
    try:
        t = email.utils.parsedate_to_datetime(s)
        if t is not None:
            if t.tzinfo is None:
                t = t.replace(tzinfo=dt.timezone.utc)
            return t.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except (TypeError, ValueError, IndexError, OverflowError):
        pass
    try:
        t = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
        if t.tzinfo is None:
            t = t.replace(tzinfo=dt.timezone.utc)
        return t.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        return None


def norm_name(name):
    s = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def attach_ids(body, fighters_doc):
    """Set id from data/ufc/fighters.json when the display name matches. Ids are ESPN athlete ids."""
    fighters = (fighters_doc or {}).get("fighters") if isinstance(fighters_doc, dict) else None
    if not isinstance(fighters, dict):
        return body
    by = {}
    for fid, f in fighters.items():
        if not isinstance(f, dict):
            continue
        n = norm_name(f.get("name"))
        if n and n not in by:
            by[n] = str(f.get("id") or fid)
    for div in body.get("divisions") or []:
        people = [div.get("champion"), div.get("interim")]
        people.extend(div.get("ranks") or [])
        for person in people:
            if not isinstance(person, dict) or person.get("id"):
                continue
            pid = by.get(norm_name(person.get("name")))
            if pid:
                person["id"] = pid
    return body


def file_body(parsed, generated, updated=None):
    gen = _iso(generated) or generated
    upd = _iso(updated) or gen
    return {
        "league": "ufc",
        "source": "UFC",
        "sourceUrl": URL,
        "generated": gen,
        "updated": upd,
        "divisions": (parsed or {}).get("divisions") or [],
    }


def fetch_rankings(url=URL, timeout=30):
    """GET the public rankings page. Returns (html, last-modified ISO or None)."""
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
        charset = "utf-8"
        ctype = r.headers.get("Content-Type") or ""
        m = re.search(r"charset=([\w.-]+)", ctype, re.I)
        if m:
            charset = m.group(1)
        html = raw.decode(charset, "replace")
        updated = _iso(r.headers.get("Last-Modified"))
    return html, updated


def write_rankings(path, html, generated, updated=None, fighters=None):
    """Write path when html is a full official board. Returns the body, or None when it is not written."""
    parsed = parse_rankings(html)
    if not complete(parsed):
        return None
    body = file_body(parsed, generated, updated)
    attach_ids(body, fighters)
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(body, fh, indent=1, ensure_ascii=False)
        fh.write("\n")
    os.replace(tmp, path)
    return body


def refresh(path, fetch, generated, fighters=None, log=print):
    """Replace path only after a good fetch. On failure the previous file stays, and an empty file is not created."""
    try:
        html, updated = fetch()
    except (OSError, urllib.error.URLError, ValueError, TimeoutError) as ex:
        log(f"[ufc] rankings FAILED: {str(ex)[:180]}")
        return False
    except Exception as ex:
        log(f"[ufc] rankings FAILED: {str(ex)[:180]}")
        return False
    body = write_rankings(path, html, generated, updated, fighters)
    if not body:
        log("[ufc] rankings incomplete; keeping the last file")
        return False
    n = len(body.get("divisions") or [])
    log(f"[ufc] rankings: {n} divisions, as of {body.get('updated')}")
    return True


def load_fighters(path):
    try:
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh)
    except (OSError, ValueError):
        return None
    return doc if isinstance(doc, dict) else None
