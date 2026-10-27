"""Keep a league's last good data when a refresh can't reach its source (ESPN 403s, timeouts, a suspiciously empty feed).

The last good data is read from LASTGOOD_SRC: a URL base (the deploy workflow points it at the currently deployed site,
https://linesmart.app/data/) or a local directory. Unset/empty turns the fallback off (local builds, tests). Restored games are marked stale ({"asOf", "reason"}) and the
league index gets a top-level "stale" note, which the site and the preview pages show. The fallback gives up when:
  * the last good data is older than LASTGOOD_MAX_H hours (default 18), counted from the last REAL fetch (a stale copy
    re-served by a later run keeps its original asOf), or
  * its games have finished: pre-game entries more than PRE_GRACE_H past their start and live entries more than IN_GRACE_H
    past their start are dropped (their result is unknown); finals are kept POST_KEEP_H hours for the scores ticker; once
    no upcoming/live game is left the league shows empty again.
A real empty schedule (every day fetched OK, no events, and the last good copy had no upcoming games) stays empty."""
import datetime as dt
import json
import os
import urllib.parse

MAX_H = float(os.environ.get("LASTGOOD_MAX_H") or 18)
PRE_GRACE_H = 4      # a pre-game entry whose start is this far in the past has almost surely been played
IN_GRACE_H = 5       # a live entry this old is over (result unknown)
POST_KEEP_H = 36     # finals kept for the scores ticker / "recent" rows
SUSPICIOUS_MIN = 2   # an all-OK empty feed is a failure if the last good copy had at least this many upcoming games in the window


def parse(s):
    if not s: return None
    try:
        t = dt.datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        return t if t.tzinfo else t.replace(tzinfo=dt.timezone.utc)
    except ValueError:
        return None


def iso(t):
    return t.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def default_src(root=None):
    """LASTGOOD_SRC: a URL base (the workflow sets https://linesmart.app/data/) or a local dir. Unset or empty = off, so
    local builds and tests never reach the live site unless asked to."""
    return (os.environ.get("LASTGOOD_SRC") or "").strip() or None


class Source:
    """Reads last good files (relative paths like 'nhl/index.json') from a URL base or a local dir. Never raises."""

    def __init__(self, src, getj=None, log=print, bust=None):
        self.src, self.getj, self.log, self._idx = src, getj, log, {}
        self.bust = bust            # cache-buster query value for URL sources (the CDN caches ~10 min)
        self.remote = bool(src) and src.startswith(("http://", "https://"))

    def __bool__(self):
        return bool(self.src)

    def get(self, rel):
        if not self.src: return None
        try:
            if self.remote:
                url = self.src.rstrip("/") + "/" + urllib.parse.quote(rel)
                if self.bust: url += f"?lg={urllib.parse.quote(str(self.bust))}"
                return self.getj(url)
            with open(os.path.join(self.src, rel)) as fh:
                return json.load(fh)
        except Exception as ex:   # missing file, 404, network: no fallback for this file
            self.log(f"[lastgood] {rel}: not available ({str(ex)[:80]})")
            return None

    def index(self, key):
        if key not in self._idx:
            ix = self.get(f"{key}/index.json")
            self._idx[key] = ix if isinstance(ix, dict) and isinstance(ix.get("games"), list) else None
        return self._idx[key]


def as_of(idx, g=None):
    """When the data was really fetched: a game's own stale.asOf, else the index's stale.asOf, else its generated time."""
    return ((g or {}).get("stale") or {}).get("asOf") or ((idx or {}).get("stale") or {}).get("asOf") or (idx or {}).get("generated")


def keep_game(g, now):
    t = parse(g.get("date"))
    if not t: return False
    st = g.get("state")
    if st == "pre": return t > now - dt.timedelta(hours=PRE_GRACE_H)
    if st == "in": return t > now - dt.timedelta(hours=IN_GRACE_H)
    if st == "post": return t > now - dt.timedelta(hours=POST_KEEP_H)
    return False


def et_day(g, tz):
    t = parse(g.get("date"))
    return t.astimezone(tz).strftime("%Y%m%d") if t else None


def pick(idx, now, max_h=None, days=None, tz=None, exclude=()):
    """Games from a last good index worth carrying over. days: only games on these ET days (YYYYMMDD; partial failures).
    Returns (games, asOf, why_not): games empty when nothing qualifies (why_not says why)."""
    max_h = MAX_H if max_h is None else max_h
    if not idx: return [], None, "no last good copy"
    out, newest, too_old = [], None, 0
    for g in idx.get("games") or []:
        if str(g.get("id")) in exclude: continue
        if days is not None and et_day(g, tz) not in days: continue
        a = parse(as_of(idx, g))
        if not a or now - a > dt.timedelta(hours=max_h): too_old += 1; continue
        if not keep_game(g, now): continue
        out.append(g); newest = a if newest is None or a > newest else newest
    if not any(g.get("state") in ("pre", "in") for g in out):
        if too_old: return [], None, f"last good copy older than {max_h:g}h"
        return [], None, "no upcoming or live games in the last good copy" if (idx.get("games") or []) else "last good copy was empty"
    oldest = min(parse(as_of(idx, g)) for g in out)
    return out, iso(oldest), None


def suspicious_empty(idx, now, days, max_h=None):
    """An all-days-OK but empty feed is treated as a failure only when the last good copy (still fresh) had at least
    SUSPICIOUS_MIN upcoming games inside the window; otherwise it is a real empty schedule (off-season, break)."""
    max_h = MAX_H if max_h is None else max_h
    if not idx: return 0
    a = parse(as_of(idx))
    if not a or now - a > dt.timedelta(hours=max_h): return 0
    end = now + dt.timedelta(days=days)
    n = sum(1 for g in idx.get("games") or [] if g.get("state") == "pre" and (t := parse(g.get("date"))) and now < t < end)
    return n if n >= SUSPICIOUS_MIN else 0


def mark(g, asof, reason):
    g = dict(g)
    g["stale"] = dict(asOf=(g.get("stale") or {}).get("asOf") or asof, reason=reason)
    return g


def game_docs(src, key, games, workers=8):
    """Fetch the last good per-game files for these games (id -> doc). Missing files -> a minimal doc."""
    import concurrent.futures as cf
    out = {}
    with cf.ThreadPoolExecutor(workers) as ex:
        futs = {ex.submit(src.get, f"{key}/games/{g['id']}.json"): g for g in games}
        for f in cf.as_completed(futs):
            g = futs[f]; d = f.result()
            out[str(g["id"])] = d if isinstance(d, dict) else dict(league=key, game=g, detail={}, teams={}, hasSummary=False, history=None)
    return out


def restore_league(src, key, out_dir, now, reason, log=print, apply_odds=None, max_h=None):
    """Whole-league fallback (UFC, or a league whose build raised): rewrite <key>/index.json, games/*.json (and UFC's
    fighters.json) from the last good copy. Returns the meta report dict, or None if there is nothing usable."""
    idx = src.index(key) if src else None
    games, asof, why = pick(idx, now, max_h)
    if not games:
        log(f"[{key}] no fallback: {why}")
        return None
    games = [mark(g, asof, reason) for g in games]
    if apply_odds:
        try: apply_odds(games)
        except Exception as ex: log(f"[{key}] fallback odds merge failed: {ex}")
    docs = game_docs(src, key, games)
    ldir = os.path.join(out_dir, key); gdir = os.path.join(ldir, "games"); os.makedirs(gdir, exist_ok=True)
    for fn in os.listdir(gdir): os.remove(os.path.join(gdir, fn))
    for g in games:
        d = dict(docs[str(g["id"])], game=g)
        with open(os.path.join(gdir, f"{g['id']}.json"), "w") as fh: json.dump(d, fh, separators=(",", ":"))
    ids = {str(g["id"]) for g in games}
    new = dict(idx, games=games, generated=iso(now))
    if isinstance(idx.get("events"), list):   # UFC: keep only cards that still have a kept bout
        evs = []
        for e in idx["events"]:
            bouts = [b for b in (e.get("bouts") or []) if str(b) in ids]
            if bouts or any(str((g.get("event") or {}).get("id")) == str(e.get("id")) for g in games):
                evs.append(dict(e, bouts=bouts or e.get("bouts") or []))
        new["events"] = evs
    upcoming = sum(1 for g in games if g.get("state") == "pre")
    fb = dict(asOf=asof, reason=reason, games=len(games), whole=True)
    rep = dict((idx.get("report") or {}), league=key, games=len(games), upcoming=upcoming,
               withOdds=sum(1 for g in games if g.get("odds")),
               providers=sorted({g["odds"]["provider"] for g in games if g.get("odds") and g["odds"].get("provider")}),
               fallback=fb)
    new["report"] = rep
    new["stale"] = dict(asOf=asof, reason=reason, since=((idx.get("stale") or {}).get("since") or iso(now)), games=len(games), whole=True)
    with open(os.path.join(ldir, "index.json"), "w") as fh: json.dump(new, fh, separators=(",", ":"))
    if key == "ufc" or (idx.get("league") or {}).get("kind") == "mma":
        fx = src.get(f"{key}/fighters.json")
        if isinstance(fx, dict):
            with open(os.path.join(ldir, "fighters.json"), "w") as fh: json.dump(fx, fh, separators=(",", ":"))
    note(log, key, reason, len(games), asof)
    return rep


def restore_file(src, out_dir, rel, log=print):
    """Put back a whole derived file (search/<lg>.json, matchups/..., props/..., adv/...) from the last good copy."""
    d = src.get(rel) if src else None
    if not isinstance(d, dict): return False
    p = os.path.join(out_dir, rel); os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w") as fh: json.dump(d, fh, separators=(",", ":"), ensure_ascii=False)
    log(f"[lastgood] restored {rel} from the last good copy")
    return True


def note(log, key, reason, n, asof):
    log(f"[{key}] FALLBACK: {reason} -> kept {n} games from the last good data as of {asof}")   # (the workflow's sanity step adds ::warning:: annotations)
