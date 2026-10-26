"""Unit tests for scripts/weather.py (game-day weather). Offline: Open-Meteo responses are faked.
Usage: python3 scripts/weather_test.py"""
import datetime as dt, json, os, sys, tempfile, urllib.parse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import weather as WX

fails = []
def check(ok, msg, tag="weather"):
    print(f"{'PASS' if ok else 'FAIL'} {tag}: {msg}")
    if not ok: fails.append(f"{tag}: {msg}")

NOW = dt.datetime(2026, 10, 26, 12, 0, tzinfo=dt.timezone.utc)
def iso(d): return d.strftime("%Y-%m-%dT%H:%MZ")

# ---------- classify
check(WX.classify("basketball", "Spectrum Center", True) == ("indoor", "arena"), "NBA arena -> Indoor", "classify")
check(WX.classify("hockey", "Some Outdoor Stadium", False) == ("indoor", "arena"), "hockey always Indoor (outdoor specials not modelled)", "classify")
check(WX.classify("football", "Ford Field", True) == ("indoor", "dome"), "Ford Field dome", "classify")
check(WX.classify("football", "SoFi Stadium", False) == ("indoor", "dome"), "SoFi fixed roof despite ESPN indoor=false", "classify")
check(WX.classify("football", "AT&T Stadium", True) == ("retractable", None), "AT&T retractable despite ESPN indoor=true", "classify")
check(WX.classify("baseball", "American Family Field", True) == ("retractable", None), "MLB retractable", "classify")
check(WX.classify("baseball", "Tropicana Field", True) == ("indoor", "dome"), "Tropicana dome", "classify")
check(WX.classify("baseball", "Wrigley Field", True) == ("outdoor", None), "MLB open-air park outdoor even if ESPN says indoor=true", "classify")
check(WX.classify("football", "Lambeau Field", False) == ("outdoor", None), "Lambeau outdoor", "classify")
check(WX.classify("soccer", "Anfield", None) == ("outdoor", None), "soccer indoor=None -> outdoor", "classify")
check(WX.classify("football", "Unknown Dome", True) == ("indoor", "dome"), "unknown venue with indoor=true -> dome", "classify")

# ---------- parse_place
check(WX.parse_place("Charlotte, North Carolina", None, "USA") == ("Charlotte", "North Carolina", "US"), "MLS 'City, State' string", "place")
check(WX.parse_place("Green Bay", "WI", "USA") == ("Green Bay", "Wisconsin", "US"), "US state abbreviation", "place")
check(WX.parse_place("Toronto", "ON", "Canada") == ("Toronto", "Ontario", "CA"), "Canadian province", "place")
check(WX.parse_place("Bodø/Glimt", None, "Norway")[0] == "Bodø", "club suffix after / dropped", "place")
check(WX.parse_place("Liverpool", None, "England")[2] == "GB", "England -> GB", "place")

# ---------- pick_geo
res = [dict(name="Springfield", admin1="Illinois", country_code="US", feature_code="PPLA", latitude=39.8, longitude=-89.6, population=114000),
       dict(name="Springfield", admin1="Missouri", country_code="US", feature_code="PPL", latitude=37.2, longitude=-93.3, population=169000)]
check(WX.pick_geo(res, "Springfield", "Missouri", "US")["admin1"] == "Missouri", "state disambiguates same-named cities", "geo")
check(WX.pick_geo(res[:1], "Springfield", "Missouri", "US") is None, "wrong US state never accepted", "geo")
air = [dict(name="USAF Academy Airfield", admin1="Colorado", country_code="US", feature_code="AIRF", latitude=38.7, longitude=-104.3),
       dict(name="USAF Academy", admin1="Colorado", country_code="US", feature_code="PPL", latitude=38.99, longitude=-104.86, population=6000)]
check(WX.pick_geo(air, "USAF Academy", "Colorado", "US")["feature_code"] == "PPL", "populated place beats an airfield", "geo")
check(WX.pick_geo([dict(name="Paris", admin1="Texas", country_code="US", feature_code="PPL", latitude=1, longitude=1)], "Paris", None, "FR") is None, "country filter", "geo")
check(WX.override_for(dict(venue="Toyota Stadium", venueCountry="USA"))["lat"] == 33.1546, "override fixes ESPN's Toyota Stadium city", "geo")
check(WX.override_for(dict(venue="Estadio de la Cerámica", venueCountry="Spain")) is not None, "accent-insensitive override lookup", "geo")

# ---------- hourly window + summary
def hourly(start_ts, n=48, temp=50, wind=5, gust=9, pop=10, code=2, overrides=None):
    h = dict(time=[start_ts + i * 3600 for i in range(n)], temperature_2m=[temp] * n, apparent_temperature=[temp - 2] * n,
             precipitation_probability=[pop] * n, precipitation=[0.0] * n, wind_speed_10m=[wind] * n, wind_gusts_10m=[gust] * n,
             wind_direction_10m=[270] * n, weather_code=[code] * n)
    for i, vals in (overrides or {}).items():
        for k, v in vals.items(): h[k][i] = v
    return h

t0 = int(dt.datetime(2026, 11, 1, 0, 0, tzinfo=dt.timezone.utc).timestamp())
kick = t0 + 18 * 3600 + 25 * 60          # 18:25Z -> nearest hour is 18:00
rows = WX.hours_window(hourly(t0), kick)
check(len(rows) == 4 and rows[0]["t"] == t0 + 18 * 3600, f"nearest hour + 3 more ({len(rows)} rows)", "hours")
check(WX.hours_window(hourly(t0, n=10), kick) == [], "span not covering kickoff -> no rows", "hours")
s = WX.summarize(rows, "football")
check(s["temp"] == 50 and s["dirTxt"] == "W" and s["watch"] == [] and s["totalsNote"], "calm game: no watch, totals note for football", "summary")
check(WX.summarize(rows, "soccer")["totalsNote"] is False, "no totals note for soccer", "summary")
# thresholds: wind >=15 (anywhere in window), temp <=32, pop >=50, snow detection
w = WX.summarize(WX.hours_window(hourly(t0, overrides={20: dict(wind_speed_10m=15, wind_gusts_10m=28)}), kick), "football")
check([x["k"] for x in w["watch"]] == ["wind"] and "gusts 28" in w["watch"][0]["text"], f"wind 15 mph two hours in -> watch ({w['watch']})", "summary")
w = WX.summarize(WX.hours_window(hourly(t0, wind=14), kick), "football")
check(w["watch"] == [], "wind 14 mph -> no watch", "summary")
w = WX.summarize(WX.hours_window(hourly(t0, temp=32), kick), "baseball")
check([x["k"] for x in w["watch"]] == ["cold"], "32°F -> cold watch", "summary")
w = WX.summarize(WX.hours_window(hourly(t0, temp=33), kick), "baseball")
check(w["watch"] == [], "33°F -> no watch", "summary")
w = WX.summarize(WX.hours_window(hourly(t0, pop=50, code=63), kick), "football")
check([x["k"] for x in w["watch"]] == ["rain"] and w["label"] == "Rain", "50% rain -> rain watch", "summary")
w = WX.summarize(WX.hours_window(hourly(t0, pop=70, code=73, temp=28), kick), "football")
check(sorted(x["k"] for x in w["watch"]) == ["cold", "snow"] and w["precipType"] == "snow", "snow + cold", "summary")
w = WX.summarize(WX.hours_window(hourly(t0, pop=49), kick), "football")
check(w["watch"] == [], "49% -> no watch", "summary")
check(WX.label_for(51, 2) == "Cloudy, light drizzle possible" and WX.label_for(51, 40) == "Light drizzle", "low-chance precip code relabelled", "summary")

# ---------- attach (end to end with a fake fetch)
LG_NFL = dict(key="nfl", kind="football")
def game(i, venue, city, state, kick_dt, indoor=False, gstate="pre", vid=None):
    return dict(id=str(i), date=iso(kick_dt), state=gstate, venue=venue, city=city, venueState=state, venueCountry="USA", indoor=indoor, venueId=vid or str(100 + i))

class Fake:
    def __init__(self, fail=False, hourly_kw=None): self.calls, self.fail, self.kw = [], fail, hourly_kw or {}
    def __call__(self, url):
        self.calls.append(url)
        if self.fail: raise OSError("boom")
        q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
        if "geocoding" in url:
            return dict(results=[dict(name=q["name"][0], admin1=dict(Arlington="Texas").get(q["name"][0], "Wisconsin"), country_code="US",
                                      feature_code="PPL", latitude=44.5, longitude=-88.0, timezone="America/Chicago", population=100000)])
        lats = q["latitude"][0].split(","); start = dt.datetime.fromisoformat(q["start_date"][0]).replace(tzinfo=dt.timezone.utc)
        out = [dict(hourly=hourly(int(start.timestamp()), n=24 * 4, **self.kw)) for _ in lats]
        return out if len(out) > 1 else out[0]

with tempfile.TemporaryDirectory() as tmp:
    seed = os.path.join(tmp, "seed.json")
    json.dump(dict(venues={"201": dict(lat=42.77, lon=-78.79, tz="America/New_York", place="Orchard Park, New York")}), open(seed, "w"))
    cache, snap = os.path.join(tmp, "wx"), os.path.join(tmp, "snap")
    games = [game(1, "Lambeau Field", "Green Bay", "WI", NOW + dt.timedelta(days=3)),
             game(2, "Highmark Stadium", "Orchard Park", "NY", NOW + dt.timedelta(days=3, hours=3), vid="201"),
             game(3, "Ford Field", "Detroit", "MI", NOW + dt.timedelta(days=3), indoor=True),
             game(4, "AT&T Stadium", "Arlington", "TX", NOW + dt.timedelta(days=5), indoor=True),
             game(5, "Lambeau Field", "Green Bay", "WI", NOW + dt.timedelta(days=20), vid="101"),
             game(6, "Old Game", "Green Bay", "WI", NOW - dt.timedelta(days=1), gstate="post")]
    f = Fake()
    rep = WX.attach(LG_NFL, games, cache, snap, log=lambda *a: None, now=NOW, fetch=f, seed_file=seed)
    by = {g["id"]: g.get("weather") for g in games}
    check(by["1"]["kind"] == "forecast" and by["1"]["place"].startswith("Green Bay"), "outdoor game geocoded + forecast", "attach")
    check(by["2"]["kind"] == "forecast" and by["2"]["lat"] == 42.77, "seed file coordinates used (no geocode)", "attach")
    check(by["3"] == dict(kind="indoor", roof="dome"), "dome -> Indoor, no forecast", "attach")
    check(by["4"]["kind"] == "forecast" and by["4"]["roof"] == "retractable", "retractable -> forecast + roof note", "attach")
    check(by["5"]["kind"] == "pending", "beyond ~16 days -> pending (Forecast not yet available)", "attach")
    check(by["6"] is None, "completed game: no weather", "attach")
    geos = [u for u in f.calls if "geocoding" in u]; fcs = [u for u in f.calls if "forecast" in u]
    check(len(geos) == 2 and rep["geocoded"] == 2, f"geocoded only unknown venues ({len(geos)} calls: Lambeau, Arlington)", "attach")
    check(len(fcs) <= 3, f"forecasts batched by date span ({len(fcs)} calls for 3 outdoor games)", "attach")
    check(os.path.exists(os.path.join(cache, "venues.json")) and os.path.exists(os.path.join(snap, "_weather", "forecasts.json")), "caches saved + snapshotted", "attach")
    # second run 20 minutes later: everything cached -> zero network
    games2 = json.loads(json.dumps(games)); f2 = Fake()
    WX.attach(LG_NFL, games2, cache, None, log=lambda *a: None, now=NOW + dt.timedelta(minutes=20), fetch=f2, seed_file=seed)
    check(f2.calls == [] and games2[0]["weather"]["kind"] == "forecast", f"next run reuses venue + forecast cache ({len(f2.calls)} calls)", "cache")
    # 7 hours later: forecasts refreshed (6h age for games >48h out), venues still cached
    f3 = Fake()
    WX.attach(LG_NFL, json.loads(json.dumps(games)), cache, None, log=lambda *a: None, now=NOW + dt.timedelta(hours=7), fetch=f3, seed_file=seed)
    check(f3.calls and all("forecast" in u for u in f3.calls), f"stale forecasts refetched, venues not re-geocoded ({len(f3.calls)} calls)", "cache")
    # Open-Meteo down: last good forecast served, nothing raises
    games4 = json.loads(json.dumps(games)); f4 = Fake(fail=True)
    rep4 = WX.attach(LG_NFL, games4, cache, None, log=lambda *a: None, now=NOW + dt.timedelta(hours=14), fetch=f4, seed_file=seed)
    check(games4[0]["weather"]["kind"] == "forecast" and rep4.get("stale", 0) >= 1 and rep4["errors"], f"API down -> last good forecast ({rep4.get('stale')} stale)", "failsoft")
    # no cache at all + API down -> unavailable, still no exception
    games5 = json.loads(json.dumps(games))
    rep5 = WX.attach(LG_NFL, games5, None, None, log=lambda *a: None, now=NOW, fetch=Fake(fail=True), seed_file=None)
    check(games5[0]["weather"]["kind"] == "unavailable" and games5[2]["weather"]["kind"] == "indoor", "API down, no cache -> unavailable (indoor still Indoor)", "failsoft")
    # an unexpected bug inside attach is swallowed
    bad = [dict(id="x", date="not-a-date", state="pre", venue="Lambeau Field", city="Green Bay")]
    rep6 = WX.attach(LG_NFL, bad, None, None, log=lambda *a: None, now=NOW, fetch=Fake(), seed_file=None)
    check(bad[0]["weather"]["kind"] == "unavailable" and rep6["errors"], "malformed game never raises", "failsoft")
    # NBA: no calls at all
    f7 = Fake(); nba = [dict(id="n1", date=iso(NOW + dt.timedelta(days=1)), state="pre", venue="Spectrum Center", city="Charlotte", indoor=True)]
    WX.attach(dict(key="nba", kind="basketball"), nba, None, None, log=lambda *a: None, now=NOW, fetch=f7, seed_file=None)
    check(nba[0]["weather"]["kind"] == "indoor" and f7.calls == [], "NBA -> Indoor with zero API calls", "attach")

# ---------- seed file is valid
seed = json.load(open(WX.SEED_FILE))
bad = [k for k, v in seed["venues"].items() if not (-90 <= v["lat"] <= 90 and -180 <= v["lon"] <= 180 and v.get("tz"))]
check(len(seed["venues"]) > 50 and not bad, f"venue_coords.json: {len(seed['venues'])} venues, all with lat/lon/tz", "seed")

print(f"\n{len(fails)} failure(s)" if fails else "\nall weather tests passed")
sys.exit(1 if fails else 0)
