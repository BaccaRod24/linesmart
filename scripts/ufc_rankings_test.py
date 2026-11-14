"""Parser and last-good fallback for the public UFC rankings file.

Offline. No Odds API. Usage: env -u ODDS_API_KEY python3 scripts/ufc_rankings_test.py
"""
import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
os.environ.pop("ODDS_API_KEY", None)
import ufc_rankings as UR  # noqa: E402

passed = failed = 0


def check(ok, msg):
    global passed, failed
    if ok:
        passed += 1
    else:
        failed += 1
        print("FAIL", msg)


def row(rank, slug, name, change=""):
    ch = ""
    if change == "nr":
        ch = '<span class="athlete-rankings--attribute athlete-rankings--not-ranked">NR</span>'
    elif isinstance(change, int) and change < 0:
        ch = f'<span class="athlete-rankings--rank-change athlete-rankings--rank-decrease">Rank decreased by</span> {-change}'
    elif isinstance(change, int) and change > 0:
        ch = f'<span class="athlete-rankings--rank-change athlete-rankings--rank-increase">Rank increased by</span> {change}'
    return (
        "<tr>"
        f'<td class="views-field views-field-weight-class-rank">{rank}</td>'
        f'<td class="views-field views-field-title"><a href="/athlete/{slug}">{name}</a></td>'
        f'<td class="views-field views-field-weight-class-rank-change">{ch}</td>'
        "</tr>"
    )


def champ(slug, name, role):
    label = f"<h6><span class=\"text\">{role}</span></h6>" if role else ""
    return (
        '<div class="rankings--athlete--champion clearfix"><div class="info">'
        f"<h5><a href=\"/athlete/{slug}\">{name}</a></h5>{label}</div></div>"
    )


def group(header, champs, rows):
    return (
        '<div class="view-grouping">'
        f'<div class="view-grouping-header">{header}</div>'
        '<div class="view-grouping-content"><table><caption>'
        + "".join(champs)
        + "</caption><tbody>"
        + "".join(rows)
        + "</tbody></table></div></div>"
    )


def page(groups, meta=""):
    return (
        '<div class="view view-athlete-rankings view-display-id-block_1">'
        + "".join(groups)
        + "</div>"
        + meta
    )


SHORT = page([
    group(
        "Men's Pound-for-Pound <span>Top Rank</span>",
        [champ("islam-makhachev", "Islam Makhachev", "")],
        [row(1, "islam-makhachev", "Islam Makhachev"), row(2, "alexander-volkanovski", "Alexander Volkanovski")],
    ),
    group(
        "Lightweight",
        [champ("justin-gaethje", "Justin Gaethje", "Champion"), champ("interim-guy", "Interim Guy", "Interim Champion")],
        [
            row(1, "ilia-topuria", "Ilia Topuria"),
            row(12, "charles-oliveira", "Charles Oliveira"),
            row(12, "max-holloway", "Max Holloway", -1),
            row(15, "grant-dawson", "Grant Dawson", "nr"),
        ],
    ),
    group("Women&#039;s Strawweight", [champ("mackenzie-dern", "Mackenzie Dern", "Champion")], [row(1, "zhang-weili", "Zhang Weili")]),
], meta=page([
    group("Lightweight", [champ("not-official", "Not Official", "Champion")], [row(1, "someone-else", "Someone Else")] * 5),
]).replace("view-display-id-block_1", "view-display-id-meta_rankings"))


def full_html():
    groups = []
    for key, name, _short, _gender, kind in UR.REQUIRED:
        header = name + (" <span>Top Rank</span>" if kind == "p4p" else "")
        champs = [] if kind == "p4p" else [champ("champ-" + key, "Champ " + name, "Champion")]
        if key == "heavyweight":
            champs.append(champ("interim-hw", "Interim Heavy", "Interim Champion"))
        rows = [row(i, f"f-{key}-{i}", f"Fighter {name} {i}", -1 if i == 3 else "") for i in range(1, 6)]
        groups.append(group(header, champs, rows))
    return page(groups)


parsed = UR.parse_rankings(SHORT)
by = {d["key"]: d for d in parsed["divisions"]}
check(set(by) == {"mens-p4p", "lightweight", "womens-strawweight"}, "parser keeps the official divisions and drops the meta board")
check(by["mens-p4p"]["champion"] is None and by["mens-p4p"]["ranks"][0]["name"] == "Islam Makhachev", "pound-for-pound top rank is a rank, not a division champion")
lw = by["lightweight"]
check(lw["champion"]["name"] == "Justin Gaethje" and lw["champion"]["slug"] == "justin-gaethje", "division champion comes from the champion label")
check(lw["interim"]["name"] == "Interim Guy", "interim champion is kept beside the champion")
check(lw["champion"]["name"] != "Not Official", "the meta rankings champion does not replace the official one")
tied = [r for r in lw["ranks"] if r["rank"] == 12]
check(len(tied) == 2 and tied[1]["change"] == -1, "tied ranks are both kept, with the movement on the fighter who moved")
check(lw["ranks"][-1]["change"] == "nr" and lw["ranks"][-1]["name"] == "Grant Dawson", "NR is a new ranking, not a number")
check(by["womens-strawweight"]["name"] == "Women's Strawweight", "an encoded apostrophe still matches the women's division")
check(UR.parse_rankings("")["divisions"] == [] and UR.parse_rankings(None)["divisions"] == [] and not UR.complete(parsed), "a partial page is not a publishable board")
check(not UR.complete({"divisions": []}) and not UR.complete(UR.parse_rankings("<html>no rankings</html>")), "garbage html does not count as rankings")

full = UR.parse_rankings(full_html())
check(UR.complete(full), "a board with every required division is publishable")
check([d["key"] for d in full["divisions"]] == [row[0] for row in UR.REQUIRED], "divisions stay in pound-for-pound, then men's, then women's order")
hw = next(d for d in full["divisions"] if d["key"] == "heavyweight")
check(hw["interim"]["name"] == "Interim Heavy" and hw["champion"]["name"] == "Champ Heavyweight", "a full board still keeps champion and interim apart")
check(all(len(d["ranks"]) == 5 and d["ranks"][0]["rank"] == 1 for d in full["divisions"]), "each division keeps ranks 1 through the list UFC published")

d = tempfile.mkdtemp(prefix="ufc_rank_")
path = os.path.join(d, "ufc", "rankings.json")
os.makedirs(os.path.dirname(path))
json.dump({"keep": True}, open(path, "w"))
logs = []
ok = UR.refresh(path, lambda: (_ for _ in ()).throw(OSError("timed out")), "2026-11-14T12:00:00+00:00", log=logs.append)
check(ok is False and json.load(open(path)) == {"keep": True}, "a failed fetch keeps the last good file")
check(any("FAILED" in x for x in logs), "a failed fetch is logged")
ok = UR.refresh(path, lambda: (SHORT, "Sat, 14 Nov 2026 11:52:48 GMT"), "2026-11-14T12:00:00+00:00", log=logs.append)
check(ok is False and json.load(open(path)) == {"keep": True}, "an incomplete page does not replace the last good file")
missing = os.path.join(d, "missing", "rankings.json")
ok = UR.refresh(missing, lambda: (_ for _ in ()).throw(TimeoutError("down")), "2026-11-14T12:00:00+00:00", log=lambda *a: None)
check(ok is False and not os.path.exists(missing), "a failed first fetch does not publish an empty file")
fighters = {"fighters": {"3088812": {"id": "3088812", "name": "Fighter Men's Pound-for-Pound 1"}}}
ok = UR.refresh(path, lambda: (full_html(), "Sat, 14 Nov 2026 11:52:48 GMT"), "2026-11-14T12:00:00+00:00", fighters, log=logs.append)
body = json.load(open(path))
check(ok is True and body.get("keep") is None and body["source"] == "UFC", "a full board replaces the previous file")
check(body["sourceUrl"] == "https://www.ufc.com/rankings" and body["updated"] == "2026-11-14T11:52:48Z", "the file records UFC.com and the page's updated time")
check(body["generated"].startswith("2026-11-14T12:00:00"), "generated is the refresh time")
p4p = next(x for x in body["divisions"] if x["key"] == "mens-p4p")
check(p4p["ranks"][0].get("id") == "3088812", "a fighter id is attached only when the fighter file has that name")
check("id" not in p4p["ranks"][1], "a name that is not in the fighter file stays without an id")
check(not any(x["key"] == "meta" for x in body["divisions"]), "the written file has no meta-rankings division")

src = Path("scripts/ufc_rankings.py").read_text()
build = Path("scripts/build_data.py").read_text()
check("the-odds-api" not in src and "ODDS_API" not in src, "the rankings module does not call the Odds API")
check("https://www.ufc.com/rankings" in src and "view-display-id-meta_rankings" in src, "the source is the public UFC.com page, and meta rankings are called out")
check("def write_ufc_rankings" in build and "write_ufc_rankings(log)" in build, "the data build refreshes UFC rankings")
fn = build[build.find("def write_ufc_rankings"):build.find("def write_ncaaf_rankings")]
check("ODDS_API" not in fn and "the-odds-api" not in fn, "the rankings writer does not call the Odds API")
check("_private" not in src and "pro/rankings" not in src, "public UFC rankings stay out of the Pro snapshot")

print(f"PASS ufc_rankings: {passed} passed, {failed} failed" if not failed else f"FAIL ufc_rankings: {failed} failed, {passed} passed")
sys.exit(1 if failed else 0)
