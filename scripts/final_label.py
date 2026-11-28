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
    detail = f"{st.get('shortDetail') or ''} {st.get('detail') or ''}"
    if any(x in name for x in ("POSTPONED", "CANCELED", "CANCELLED", "SUSPENDED", "ABANDONED", "FORFEIT")) or _HELD_RX.search(detail):
        return None
    if kind == "soccer":
        if "PEN" in name or re.search(r"pen", str(st.get("shortDetail") or ""), re.I): return "FT-Pens"
        if "AET" in name or re.search(r"\baet\b|extra time", str(st.get("shortDetail") or ""), re.I): return "AET"
        return "FT"
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


# A delay is not one of these: a delayed game can still be played. "forfeit" covers forfeited.
_HELD_RX = re.compile(
    r"(?:^|[^a-z])(?:cancel+ed|postpon\w*|suspend\w*|abandon\w*|forfeit\w*)(?:[^a-z]|$)",
    re.I,
)
_FINALISH = re.compile(r"^(?:final|ft|f)(?:\b|/)", re.I)


def _status_blob(g):
    """statusDetail plus an ESPN status name, when the record still has one."""
    g = g or {}
    parts = []
    for k in ("statusDetail", "statusName", "detail", "det"):
        if g.get(k):
            parts.append(str(g.get(k)))
    st = g.get("status")
    if isinstance(st, str) and st:
        parts.append(st)
    elif isinstance(st, dict):
        t = st.get("type") if isinstance(st.get("type"), dict) else {}
        for v in (t.get("name"), t.get("shortDetail"), t.get("detail"), st.get("name"), st.get("detail"), st.get("shortDetail")):
            if v:
                parts.append(str(v))
    return " ".join(parts)


def _game_state(g):
    g = g or {}
    if g.get("state") not in (None, ""):
        return g.get("state")
    return g.get("st")


def is_canceled_or_postponed(g):
    """True when this game will not produce a normal final.

    Status text or status name matches canceled, cancelled, postponed, suspended, abandoned
    or forfeit. A delay does not match. Also true when ESPN marked the game post without
    completed (the MLS cancellations that still say state "post").
    """
    g = g or {}
    if _HELD_RX.search(_status_blob(g)):
        return True
    return _game_state(g) == "post" and g.get("completed") is False


def held_status(g):
    """Words to show instead of Final: ESPN's status text, else a short label."""
    g = g or {}
    d = str(g.get("statusDetail") or g.get("detail") or g.get("det") or "").strip()
    if d and not _FINALISH.match(d):
        return d
    blob = _status_blob(g)
    if re.search(r"postpon", blob, re.I):
        return "Postponed"
    if re.search(r"cancel", blob, re.I):
        return "Canceled"
    if re.search(r"suspend", blob, re.I):
        return "Suspended"
    if re.search(r"abandon", blob, re.I):
        return "Abandoned"
    if re.search(r"forfeit", blob, re.I):
        return "Forfeit"
    return "Not played"


def held_kind(g):
    """'postponed', 'canceled', 'suspended', 'abandoned', 'forfeit', 'held', or ''."""
    if not is_canceled_or_postponed(g):
        return ""
    blob = _status_blob(g).lower()
    if "postpon" in blob:
        return "postponed"
    if "cancel" in blob:
        return "canceled"
    if "suspend" in blob:
        return "suspended"
    if "abandon" in blob:
        return "abandoned"
    if "forfeit" in blob:
        return "forfeit"
    return "held"
