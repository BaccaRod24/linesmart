"""Final-score labels: "Final/OT", "Final/2OT", "Final/SO" (NHL/NBA/NFL/college), "Final/12" (extra-inning MLB),
"AET" / "FT-Pens" (soccer). Stored on game records (finalLabel) and team recent rows (fin) by build_data.py, so the
SEO archive keeps them after a game leaves the build window. Older records without one read as plain "Final".
Pure functions, stdlib only. Tested in scripts/final_label_test.py."""
import re

# regulation periods by sport kind; men's college basketball plays two halves
REG = {"football": 4, "basketball": 4, "hockey": 3, "baseball": 9}
REG_LEAGUE = {"ncaab": 2}
_EXTRA = re.compile(r"^\s*(?:final|f)\s*/\s*([0-9]*\s*(?:ot|so)|[0-9]+)\s*$", re.I)


def _norm(s):
    """'F/12' -> 'Final/12', 'final/2ot' -> 'Final/2OT', 'Final' -> 'Final'; None when it is not a final label"""
    s = str(s or "").strip()
    m = _EXTRA.match(s)
    if m: return "Final/" + m.group(1).replace(" ", "").upper()
    if re.match(r"^final$", s, re.I): return "Final"
    return None


def label(kind, status_type, period=None, league=None):
    """ESPN status -> final label, or None for a game that is not final (or was postponed/canceled).
    status_type: ESPN status.type dict (state, completed, name, shortDetail, detail); period: status.period."""
    st = status_type or {}
    if st.get("completed") is False or (st.get("state") != "post" and not st.get("completed")): return None
    name = str(st.get("name") or "").upper()
    if kind == "soccer":
        if "PEN" in name or re.search(r"pen", str(st.get("shortDetail") or ""), re.I): return "FT-Pens"
        if "AET" in name or re.search(r"\baet\b|extra time", str(st.get("shortDetail") or ""), re.I): return "AET"
        return "FT"
    if any(x in name for x in ("POSTPONED", "CANCELED", "CANCELLED", "SUSPENDED", "FORFEIT")): return None
    for k in ("shortDetail", "detail", "description"):
        lab = _norm(st.get(k))
        if lab and lab != "Final": return lab
    # ESPN said plain "Final" (or nothing): read extra time off the period count
    try: p = int(period or 0)
    except (TypeError, ValueError): p = 0
    reg = REG_LEAGUE.get(league) or REG.get(kind)
    if reg and p > reg:
        extra = p - reg
        if kind == "baseball": return f"Final/{p}"
        if kind == "hockey": return "Final/OT" if extra == 1 else "Final"   # period 5 is a shootout (regular season) or 2OT (playoffs): trust ESPN's text only
        return "Final/OT" if extra == 1 else f"Final/{extra}OT"
    return "Final"


def of_game(g):
    """the label to show for a finished game record: finalLabel, else a final-looking statusDetail, else 'Final'"""
    g = g or {}
    for v in (g.get("finalLabel"), g.get("statusDetail")):
        s = str(v or "").strip()
        if _norm(s) and _norm(s) != "Final": return _norm(s)
        if s in ("AET", "FT-Pens"): return s
    return "Final"


def suffix(lab, kind=None):
    """short tag for compact score lines: 'OT', '2OT', 'SO', '12 inn', 'AET', 'pens'; '' for a regulation final"""
    s = str(lab or "").strip()
    if s == "AET": return "AET"
    if s == "FT-Pens": return "pens"
    m = _EXTRA.match(s)
    if not m: return ""
    x = m.group(1).replace(" ", "").upper()
    return f"{x} inn" if x.isdigit() else x
