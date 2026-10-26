"""LineSmart game-day weather (Open-Meteo, free, no API key).

For every upcoming/live game the builder passes in:
  * classify the venue: indoor arena/dome (no forecast), retractable roof (forecast + note) or outdoor,
  * look up venue coordinates (committed seed scripts/venue_coords.json, then a runtime cache, then
    Open-Meteo geocoding of the ESPN city/state/country),
  * fetch the hourly forecast for kickoff..+3h (one batched request per UTC date span, many locations each),
  * summarize the kickoff hour and flag betting-relevant conditions ("Weather watch").

Fail soft: every network step is wrapped; a failure leaves weather={"kind": "unavailable"} and never raises
out of attach(). Standard library only. Weather data by Open-Meteo.com (CC BY 4.0).
"""
import datetime as dt, gzip, json, math, os, re, time, unicodedata, urllib.parse, urllib.request

FORECAST = "https://api.open-meteo.com/v1/forecast"
GEOCODE = "https://geocoding-api.open-meteo.com/v1/search"
HOURLY = ["temperature_2m", "apparent_temperature", "precipitation_probability", "precipitation",
          "wind_speed_10m", "wind_gusts_10m", "wind_direction_10m", "weather_code"]
HERE = os.path.dirname(os.path.abspath(__file__))
SEED_FILE = os.path.join(HERE, "venue_coords.json")
FORECAST_DAYS = 16              # Open-Meteo horizon; later kickoffs -> "Forecast not yet available"
WINDOW_H = 3                    # hours after kickoff included in the game window
BATCH = 40                      # locations per forecast request
MAX_GEOCODE_PER_RUN = 60        # new venues geocoded per league per run (rest next run)
STALE_OK_H = 24                 # serve the last good forecast this long when Open-Meteo is down
WATCH = dict(wind=15, cold=32, pop=50)   # mph, degF, percent
INDOOR_KINDS = {"basketball", "hockey"}

# ---------------------------------------------------------------- venue knowledge (names normalized by vkey)
def vkey(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()

RETRACTABLE = {vkey(n) for n in [
    # NFL
    "AT&T Stadium", "NRG Stadium", "Lucas Oil Stadium", "Mercedes-Benz Stadium", "State Farm Stadium",
    # MLB
    "Chase Field", "Daikin Park", "Minute Maid Park", "Rogers Centre", "T-Mobile Park", "American Family Field",
    "loanDepot park", "Globe Life Field",
    # soccer (MLS / Europe)
    "BC Place", "Johan Cruijff ArenA", "Johan Cruyff Arena", "Veltins-Arena", "Estadio Santiago Bernabeu", "Santiago Bernabeu",
    "Stade Pierre-Mauroy", "Decathlon Arena", "Strawberry Arena", "Friends Arena", "Merkur Spiel-Arena", "PGE Narodowy",
    "Stadion Narodowy", "Parken", "Telia Parken", "GelreDome", "Principality Stadium", "Astana Arena", "Ozera Arena",
]}
FIXED_ROOF = {vkey(n) for n in [
    "SoFi Stadium", "Allegiant Stadium", "Ford Field", "Caesars Superdome", "U.S. Bank Stadium", "Tropicana Field",
    "JMA Wireless Dome", "Carrier Dome", "Alamodome", "Fargodome", "Kibbie Dome", "Holt Arena", "Walkup Skydome",
]}
# ESPN address errors seen in the data (city wrong or missing): exact stadium coordinates
OVERRIDES = {
    (vkey("Toyota Stadium"), "USA"): dict(lat=33.1546, lon=-96.8353, tz="America/Chicago", place="Frisco, Texas"),
    (vkey("Signal Iduna Park"), "Germany"): dict(lat=51.4926, lon=7.4519, tz="Europe/Berlin", place="Dortmund"),
    # city geocoding lands somewhere else (an airfield / a same-named town)
    (vkey("Falcon Stadium"), "*"): dict(lat=38.9969, lon=-104.8436, tz="America/Denver", place="USAF Academy, Colorado"),
    (vkey("Estadio de la Ceramica"), "*"): dict(lat=39.9441, lon=-0.1036, tz="Europe/Madrid", place="Villarreal, Valencia"),
}

def override_for(g):
    return OVERRIDES.get((vkey(g.get("venue")), g.get("venueCountry") or "")) or OVERRIDES.get((vkey(g.get("venue")), "*"))

US_STATES = dict(AL="Alabama", AK="Alaska", AZ="Arizona", AR="Arkansas", CA="California", CO="Colorado", CT="Connecticut",
    DE="Delaware", DC="District of Columbia", FL="Florida", GA="Georgia", HI="Hawaii", ID="Idaho", IL="Illinois", IN="Indiana",
    IA="Iowa", KS="Kansas", KY="Kentucky", LA="Louisiana", ME="Maine", MD="Maryland", MA="Massachusetts", MI="Michigan",
    MN="Minnesota", MS="Mississippi", MO="Missouri", MT="Montana", NE="Nebraska", NV="Nevada", NH="New Hampshire",
    NJ="New Jersey", NM="New Mexico", NY="New York", NC="North Carolina", ND="North Dakota", OH="Ohio", OK="Oklahoma",
    OR="Oregon", PA="Pennsylvania", RI="Rhode Island", SC="South Carolina", SD="South Dakota", TN="Tennessee", TX="Texas",
    UT="Utah", VT="Vermont", VA="Virginia", WA="Washington", WV="West Virginia", WI="Wisconsin", WY="Wyoming", PR="Puerto Rico")
CA_PROV = dict(AB="Alberta", BC="British Columbia", MB="Manitoba", NB="New Brunswick", NL="Newfoundland and Labrador",
    NS="Nova Scotia", ON="Ontario", PE="Prince Edward Island", QC="Quebec", SK="Saskatchewan")
COUNTRIES = {"usa": "US", "united states": "US", "us": "US", "canada": "CA", "mexico": "MX", "england": "GB", "scotland": "GB",
    "wales": "GB", "northern ireland": "GB", "united kingdom": "GB", "ireland": "IE", "spain": "ES", "germany": "DE", "france": "FR",
    "italy": "IT", "netherlands": "NL", "portugal": "PT", "turkiye": "TR", "turkey": "TR", "norway": "NO", "austria": "AT",
    "greece": "GR", "czechia": "CZ", "czech republic": "CZ", "belgium": "BE", "switzerland": "CH", "denmark": "DK", "sweden": "SE",
    "croatia": "HR", "serbia": "RS", "ukraine": "UA", "poland": "PL", "cyprus": "CY", "azerbaijan": "AZ", "kazakhstan": "KZ",
    "hungary": "HU", "slovakia": "SK", "slovenia": "SI", "romania": "RO", "bulgaria": "BG", "moldova": "MD", "israel": "IL",
    "russia": "RU", "scotland ": "GB", "finland": "FI", "iceland": "IS", "luxembourg": "LU", "malta": "MT", "albania": "AL",
    "bosnia and herzegovina": "BA", "north macedonia": "MK", "montenegro": "ME", "georgia": "GE", "armenia": "AM", "belarus": "BY",
    "latvia": "LV", "lithuania": "LT", "estonia": "EE", "gibraltar": "GI", "kosovo": "XK", "faroe islands": "FO", "andorra": "AD",
    "san marino": "SM", "brazil": "BR", "argentina": "AR", "japan": "JP", "australia": "AU", "saudi arabia": "SA", "qatar": "QA"}
UK_PARTS = {"england": "England", "scotland": "Scotland", "wales": "Wales", "northern ireland": "Northern Ireland"}

def classify(kind, venue_name, indoor_flag):
    """-> ("indoor", why) | ("retractable", None) | ("outdoor", None)"""
    k = vkey(venue_name)
    if kind in INDOOR_KINDS: return "indoor", "arena"
    if k in RETRACTABLE: return "retractable", None
    if k in FIXED_ROOF: return "indoor", "dome"
    # ESPN's indoor flag is reliable for football; for baseball it is set on open-air parks too,
    # so baseball roofs come only from the lists above
    if indoor_flag is True and kind != "baseball": return "indoor", "dome"
    return "outdoor", None

def parse_place(city, state, country):
    """ESPN address -> (city, admin1 or None, ISO country or None). Handles 'Charlotte, North Carolina' and 'Bodø/Glimt'."""
    city = (city or "").strip(); state = (state or "").strip()
    if "," in city and not state:
        city, state = [p.strip() for p in city.split(",", 1)]
    city = city.split("/")[0].strip()
    cc = COUNTRIES.get((country or "").strip().lower())
    admin = None
    if state:
        up = state.upper()
        if up in US_STATES and (cc in (None, "US")): admin, cc = US_STATES[up], "US"
        elif up in CA_PROV and cc in (None, "CA"): admin, cc = CA_PROV[up], "CA"
        else:
            admin = state
            if cc is None and state in US_STATES.values(): cc = "US"
    elif (country or "").strip().lower() in UK_PARTS:
        admin = UK_PARTS[country.strip().lower()]
    return city, admin, cc

# ---------------------------------------------------------------- http
def http_json(url, timeout=12, tries=2):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "LineSmart/1.0 (+https://linesmart.app)", "Accept-Encoding": "gzip"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                b = r.read()
                if b[:2] == b"\x1f\x8b": b = gzip.decompress(b)
                return json.loads(b)
        except Exception as e:
            last = e
            if getattr(e, "code", None) in (400, 401, 403, 404): break
            time.sleep(1.0 * (i + 1))
    raise last

def _fold(s): return vkey(s)

def pick_geo(results, city, admin, cc):
    """Choose the geocoding result matching the country / admin1; None when nothing plausible."""
    best, best_s = None, -1
    for i, r in enumerate(results or []):
        if cc and r.get("country_code") != cc: continue
        s = 0
        if admin and _fold(r.get("admin1")) == _fold(admin): s += 4
        elif admin and cc in ("US", "CA"): continue            # wrong state/province: never accept
        if _fold(r.get("name")) == _fold(city): s += 2
        if (r.get("feature_code") or "").startswith("PPL"): s += 1
        else: s -= 3                                           # airfields, parks, regions...
        pop = r.get("population") or 0
        if pop > 0: s += min(1.5, math.log10(pop) / 4)
        s += max(0, 1 - i * 0.1)                               # API order (relevance / population)
        if s > best_s: best, best_s = r, s
    return best

def geocode(city, admin, cc, fetch=http_json):
    if not city: return None
    names = [city]
    m = re.match(r"^(.*?)[\s-]+upon[\s-]+(.*)$", city, re.I)
    if m: names.append(f"{m.group(1)} upon {m.group(2)}")
    for n in names:
        q = urllib.parse.urlencode(dict(name=n, count=10, language="en", format="json") | ({"countryCode": cc} if cc else {}))
        r = pick_geo((fetch(f"{GEOCODE}?{q}") or {}).get("results"), n, admin, cc)
        if r: return dict(lat=round(r["latitude"], 4), lon=round(r["longitude"], 4), tz=r.get("timezone"),
                          place=", ".join(x for x in (r.get("name"), r.get("admin1")) if x), src="open-meteo geocoding")
    return None

# ---------------------------------------------------------------- caches
def _load(path):
    try:
        with open(path) as fh: return json.load(fh)
    except Exception: return {}

def _save(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as fh: json.dump(obj, fh, indent=0, sort_keys=True, separators=(",", ":"))
    os.replace(tmp, path)

def coord_key(g): return str(g.get("venueId") or vkey(f"{g.get('venue')} {g.get('city')}"))

def refresh_age_h(hours_to_kick):
    """How old a cached forecast may be before refetching (forecasts change less far out)."""
    if hours_to_kick <= 12: return 0.9
    if hours_to_kick <= 48: return 2.5
    return 6.0

# ---------------------------------------------------------------- forecast -> summary
WMO = {0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Freezing fog",
       51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 56: "Freezing drizzle", 57: "Freezing drizzle",
       61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain",
       71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains", 80: "Rain showers", 81: "Rain showers",
       82: "Heavy showers", 85: "Snow showers", 86: "Heavy snow showers", 95: "Thunderstorms", 96: "Thunderstorms, hail", 99: "Thunderstorms, hail"}
SNOW = {71, 73, 75, 77, 85, 86}
DIRS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]

PRECIP = set(range(51, 68)) | set(range(71, 78)) | set(range(80, 87)) | {95, 96, 99}
LOW_POP = 25        # a precip weather code with a precipitation chance below this reads as "cloudy, ... possible"

def label_for(code, pop):
    lab = WMO.get(code, "—")
    if code in PRECIP and pop is not None and pop < LOW_POP:
        return f"Cloudy, {lab.lower()} possible"
    return lab

def compass(deg):
    return None if deg is None else DIRS[int((deg % 360) / 22.5 + 0.5) % 16]

def _r(v, d=0):
    if v is None: return None
    v = round(float(v), d)
    return int(v) if d == 0 else v

def hours_window(hourly, kick_ts):
    """Rows from the hour nearest kickoff through +WINDOW_H hours. hourly: Open-Meteo 'hourly' with unixtime."""
    ts = hourly.get("time") or []
    if not ts: return []
    i0 = min(range(len(ts)), key=lambda i: abs(ts[i] - kick_ts))
    if abs(ts[i0] - kick_ts) > 2 * 3600: return []           # requested span didn't cover kickoff
    rows = []
    for i in range(i0, min(len(ts), i0 + WINDOW_H + 1)):
        col = lambda k: (hourly.get(k) or [None] * len(ts))[i]
        rows.append(dict(t=ts[i], temp=_r(col("temperature_2m")), feels=_r(col("apparent_temperature")),
                         pop=_r(col("precipitation_probability")), precip=_r(col("precipitation"), 2),
                         wind=_r(col("wind_speed_10m")), gust=_r(col("wind_gusts_10m")), dir=_r(col("wind_direction_10m")),
                         code=_r(col("weather_code"))))
    return rows

def summarize(rows, kind, roof=None):
    """Kickoff hour + game-window extremes + Weather watch flags."""
    if not rows: return None
    k = rows[0]
    mx = lambda f: max((r[f] for r in rows if r[f] is not None), default=None)
    mn = lambda f: min((r[f] for r in rows if r[f] is not None), default=None)
    wind, gust, cold, feels, pop = mx("wind"), mx("gust"), mn("temp"), mn("feels"), mx("pop")
    snow = any(r["code"] in SNOW for r in rows if r["code"] is not None)
    watch = []
    if wind is not None and wind >= WATCH["wind"]:
        watch.append(dict(k="wind", text=f"Wind {wind} mph" + (f", gusts {gust}" if gust and gust > wind else "")))
    if cold is not None and cold <= WATCH["cold"]:
        watch.append(dict(k="cold", text=f"Cold {cold}°F" + (f" (feels {feels}°F)" if feels is not None and feels < cold else "")))
    if pop is not None and pop >= WATCH["pop"]:
        watch.append(dict(k="snow" if snow else "rain", text=f"{'Snow' if snow else 'Rain'} {pop}% chance"))
    return dict(kind="forecast", roof=roof, temp=k["temp"], feels=k["feels"], pop=k["pop"], precip=k["precip"],
                wind=k["wind"], gust=k["gust"], dir=k["dir"], dirTxt=compass(k["dir"]), code=k["code"], label=label_for(k["code"], k["pop"]),
                hours=rows, max=dict(wind=wind, gust=gust, pop=pop), min=dict(temp=cold, feels=feels), precipType="snow" if snow else "rain",
                watch=watch, totalsNote=kind in ("football", "baseball"))

def fetch_batch(locs, start, end, fetch=http_json):
    """locs: [(lat, lon)] -> list of Open-Meteo 'hourly' dicts in the same order."""
    q = urllib.parse.urlencode(dict(latitude=",".join(str(a) for a, _ in locs), longitude=",".join(str(b) for _, b in locs),
                                    hourly=",".join(HOURLY), temperature_unit="fahrenheit", wind_speed_unit="mph",
                                    precipitation_unit="inch", timezone="GMT", timeformat="unixtime",
                                    start_date=start, end_date=end))
    res = fetch(f"{FORECAST}?{q}")
    res = res if isinstance(res, list) else [res]
    if len(res) != len(locs): raise ValueError(f"open-meteo returned {len(res)} locations for {len(locs)}")
    return [r.get("hourly") or {} for r in res]

# ---------------------------------------------------------------- main entry
def attach(lg, games, cache_dir=None, snap_dir=None, log=print, now=None, fetch=http_json, seed_file=SEED_FILE):
    """Set g['weather'] on every pre/live game. Returns a short report dict. Never raises."""
    rep = dict(indoor=0, forecast=0, retractable=0, pending=0, unavailable=0, fetched=0, cached=0, geocoded=0, calls=0, errors=[])
    if (lg or {}).get("kind") == "mma":   # fights are indoors; no weather section or chips for UFC
        for g in games: g.pop("weather", None)
        rep["skipped"] = "mma"; return rep
    try:
        now = now or dt.datetime.now(dt.timezone.utc)
        seed = _load(seed_file).get("venues", {}) if seed_file else {}
        vpath = os.path.join(cache_dir, "venues.json") if cache_dir else None
        fpath = os.path.join(cache_dir, "forecasts.json") if cache_dir else None
        vcache = _load(vpath).get("venues", {}) if vpath else {}
        fcache = _load(fpath).get("games", {}) if fpath else {}
        want, geo_n = [], 0
        for g in games:
            g.pop("weather", None)
            if g.get("state") not in ("pre", "in"): continue
            cls, why = classify(lg["kind"], g.get("venue"), g.get("indoor"))
            if cls == "indoor":
                g["weather"] = dict(kind="indoor", roof=why); rep["indoor"] += 1; continue
            kick = dt.datetime.fromisoformat(g["date"].replace("Z", "+00:00"))
            if kick - now > dt.timedelta(days=FORECAST_DAYS - 0.5):
                g["weather"] = dict(kind="pending", roof="retractable" if cls == "retractable" else None); rep["pending"] += 1; continue
            ck = coord_key(g)
            ov = override_for(g)
            c = ov or vcache.get(ck) or seed.get(ck)
            if c is None and geo_n < MAX_GEOCODE_PER_RUN:
                geo_n += 1; rep["calls"] += 1
                try:
                    c = geocode(*parse_place(g.get("city"), g.get("venueState"), g.get("venueCountry")), fetch=fetch)
                except Exception as ex:
                    rep["errors"].append(f"geocode {g.get('venue')}: {str(ex)[:80]}")
                if c:
                    c = dict(c, name=g.get("venue"), city=g.get("city")); vcache[ck] = c; rep["geocoded"] += 1
            if not c:
                g["weather"] = dict(kind="unavailable", why="venue location unknown"); rep["unavailable"] += 1; continue
            want.append((g, c, kick, "retractable" if cls == "retractable" else None))
        # forecasts: reuse fresh cache entries, batch the rest by UTC date span
        todo = {}
        for g, c, kick, roof in want:
            fc = fcache.get(g["id"])
            age_ok = fc and fc.get("kick") == g["date"] and fc.get("lat") == c["lat"] and fc.get("lon") == c["lon"] and \
                (now - dt.datetime.fromisoformat(fc["fetchedAt"])).total_seconds() / 3600 < refresh_age_h((kick - now).total_seconds() / 3600)
            if age_ok:
                g["_wx"] = (fc["rows"], fc["fetchedAt"]); rep["cached"] += 1; continue
            span = (max(kick, now - dt.timedelta(hours=1)).strftime("%Y-%m-%d"), (kick + dt.timedelta(hours=WINDOW_H)).strftime("%Y-%m-%d"))
            todo.setdefault(span, []).append((g, c, kick))
        stamp = now.isoformat(timespec="seconds")
        for (start, end), items in todo.items():
            for b in range(0, len(items), BATCH):
                chunk = items[b:b + BATCH]
                # one location per unique coordinate pair
                uniq = list(dict.fromkeys((c["lat"], c["lon"]) for _, c, _ in chunk))
                rep["calls"] += 1
                try:
                    hourly = dict(zip(uniq, fetch_batch(uniq, start, end, fetch)))
                except Exception as ex:
                    rep["errors"].append(f"forecast {start}..{end}: {str(ex)[:80]}"); continue
                for g, c, kick in chunk:
                    rows = hours_window(hourly[(c["lat"], c["lon"])], int(kick.timestamp()))
                    if rows:
                        g["_wx"] = (rows, stamp); rep["fetched"] += 1
                        fcache[g["id"]] = dict(kick=g["date"], lat=c["lat"], lon=c["lon"], fetchedAt=stamp, rows=rows)
        for g, c, kick, roof in want:
            rows, at = g.pop("_wx", (None, None))
            fc = fcache.get(g["id"])
            if not rows and fc and fc.get("kick") == g["date"] and fc.get("rows") and \
                    (now - dt.datetime.fromisoformat(fc["fetchedAt"])).total_seconds() < STALE_OK_H * 3600:
                rows, at = fc["rows"], fc["fetchedAt"]; rep["stale"] = rep.get("stale", 0) + 1   # fetch failed: last good forecast
            s = summarize(rows, lg["kind"], roof) if rows else None
            if not s:
                g["weather"] = dict(kind="unavailable", why="forecast fetch failed", roof=roof); rep["unavailable"] += 1; continue
            s.update(asOf=at, tz=c.get("tz"), place=c.get("place"), lat=c["lat"], lon=c["lon"])
            g["weather"] = s; rep["forecast"] += 1; rep["retractable"] += bool(roof)
        # persist caches (prune games that have started more than a day ago)
        if cache_dir:
            cut = now - dt.timedelta(days=1)
            fcache = {k: v for k, v in fcache.items() if dt.datetime.fromisoformat(v["kick"].replace("Z", "+00:00")) > cut}
            allf = _load(fpath); allf.setdefault("games", {}); allf["games"] = {k: v for k, v in allf["games"].items() if k in fcache} | fcache
            _save(fpath, dict(allf, updated=stamp)); _save(vpath, dict(venues=vcache, updated=stamp))
            if snap_dir:
                for p in (fpath, vpath):
                    d = os.path.join(snap_dir, "_weather"); os.makedirs(d, exist_ok=True)
                    with open(p) as src, open(os.path.join(d, os.path.basename(p)), "w") as dst: dst.write(src.read())
    except Exception as ex:   # fail soft: never break the build
        rep["errors"].append(f"weather step failed: {str(ex)[:120]}")
        for g in games:
            g.pop("_wx", None)
            if g.get("state") in ("pre", "in") and "weather" not in g: g["weather"] = dict(kind="unavailable", why="weather step failed")
    rep["errors"] = rep["errors"][:5]
    return rep

# ---------------------------------------------------------------- CLI: seed venue coordinates from built data
def seed_from(data_dir, leagues, out=SEED_FILE, fetch=http_json):
    seed = _load(out); venues = seed.get("venues", {})
    added = []
    for key, kind in leagues:
        try: idx = json.load(open(os.path.join(data_dir, key, "index.json")))
        except Exception: continue
        for g in idx.get("games", []):
            cls, _ = classify(kind, g.get("venue"), g.get("indoor"))
            ck = coord_key(g)
            if cls == "indoor" or ck in venues or override_for(g): continue
            c = geocode(*parse_place(g.get("city"), g.get("venueState"), g.get("venueCountry")), fetch=fetch)
            if c:
                venues[ck] = dict(c, name=g.get("venue"), city=g.get("city")); added.append((key, g.get("venue"), c["place"]))
            else:
                added.append((key, g.get("venue"), "NOT FOUND"))
            time.sleep(0.15)
    _save(out, dict(note="Venue coordinates (city level) for weather; keyed by ESPN venue id. Generated by scripts/weather.py seed; edit freely.",
                    venues=venues))
    return added

if __name__ == "__main__":
    import sys
    sys.path.insert(0, HERE)
    if len(sys.argv) >= 3 and sys.argv[1] == "seed":
        import build_data as B
        for row in seed_from(sys.argv[2], [(l["key"], l["kind"]) for l in B.LEAGUES]): print(*row, sep=" | ")
    else:
        print("usage: python3 scripts/weather.py seed <data_dir>")
