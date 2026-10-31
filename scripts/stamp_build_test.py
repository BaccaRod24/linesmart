#!/usr/bin/env python3
"""Visible build stamp + the light service-worker update check. No network, no Odds API."""
import datetime
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stamp_build as S

ROOT = Path(__file__).resolve().parent.parent
fail = 0


def check(ok, msg):
    global fail
    print(("PASS" if ok else "FAIL") + " " + msg)
    if not ok:
        fail += 1


when = datetime.datetime(2026, 10, 31, 5, 0, tzinfo=datetime.timezone.utc)  # 1:00 AM ET
label = S.build_label("2b253a5045f3f679c82f03882d0128f4baeb192d", when)
check(label == "2b253a5 · Oct 31, 1:00 AM ET", f"label is short commit + ET time ({label})")
check(S.build_label("abc", when) == "abc · Oct 31, 1:00 AM ET", "short sha kept as-is")
noon = datetime.datetime(2026, 7, 4, 16, 5, tzinfo=datetime.timezone.utc)  # 12:05 PM ET
check(S.build_label("abcdef0", noon) == "abcdef0 · Jul 4, 12:05 PM ET", "noon and July format")

sample = '''<meta name="ls-build-label" content="dev">
<p class="ls-build" data-ls-build>Build dev</p>
<meta name="ls-build-label" content="dev"/>
const SITE_BUILD = "dev";
'''
out = S.stamp_html(sample, label)
check(out.count(label) == 3, "meta (both quotes) and footer text stamped")
check('SITE_BUILD = "dev"' in out, "pro-gate SITE_BUILD placeholder is left alone")
check("localStorage" not in Path(ROOT, "scripts/stamp_build.py").read_text(), "stamp script does not touch localStorage")

with tempfile.TemporaryDirectory() as d:
    p = Path(d) / "nested" / "index.html"
    p.parent.mkdir()
    p.write_text(sample, encoding="utf-8")
    (Path(d) / "skip.txt").write_text("Build dev", encoding="utf-8")
    n = S.stamp_tree(d, label)
    check(n == 1 and label in p.read_text(encoding="utf-8"), "stamp_tree writes html only")
    r = subprocess.run([sys.executable, str(ROOT / "scripts/stamp_build.py"), "--root", d, "--sha", "2b253a5", "--when", "2026-10-31T05:00:00Z"], capture_output=True, text=True)
    check(r.returncode == 0 and "2b253a5 · Oct 31, 1:00 AM ET" in r.stdout, "CLI stamps from --sha and --when")

idx = (ROOT / "site/index.html").read_text(encoding="utf-8")
check('<meta name="ls-build-label" content="dev">' in idx and 'data-ls-build>Build dev</p>' in idx, "homepage has the dev placeholder in the head and footer")
bets = (ROOT / "site/assets/bets.js").read_text(encoding="utf-8")
check('meta[name="ls-build-label"]' in bets and "data-ls-build" in bets, "My Bets prints the same build label")
site = (ROOT / "site/assets/site.js").read_text(encoding="utf-8")
check("visibilitychange" in site and "r.update" in site, "resume calls registration.update()")
check('Update ready - tap to refresh' in site and "controllerchange" in site and "had" in site and 'updateViaCache: "none"' in site, "a new worker shows the reload banner; sw.js is not HTTP-cached")
check("localStorage.clear" not in site and "unregister" not in site, "update check does not clear storage or unregister the worker")
for name in ("about.html", "privacy.html", "terms.html", "responsible-gambling.html", "affiliate-disclosure.html"):
    html = (ROOT / "site" / name).read_text(encoding="utf-8")
    check('data-ls-build>Build dev</p>' in html and "1-800-GAMBLER" in html and "1-833-PLAYWISE" in html, f"{name}: build line added, helplines kept")

print(f"\n{fail} FAILED" if fail else "\nall build-stamp tests passed")
sys.exit(1 if fail else 0)
