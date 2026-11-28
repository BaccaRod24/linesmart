"""Canonical sportsbook names for ESPN and Odds API strings.

ESPN writes DraftKings as "Draft Kings". Some descriptions shortened Hard Rock Bet
to "Hard Rock". Display and new data use the names on the books' own sites.
Anything that is not one of those books is returned unchanged, so a legal-status
sentence is never rewritten.
"""
import re

# Compact key (letters only) -> the name we show.
_DISPLAY = {
    "draftkings": "DraftKings",
    "hardrock": "Hard Rock Bet",
    "hardrockbet": "Hard Rock Bet",
    "fanduel": "FanDuel",
}


def _compact(name):
    return re.sub(r"[^a-z]", "", (name or "").lower())


def display_book(name):
    """Book label for a provider or source string. Unknown text is unchanged.

    A whole value of "Draft Kings", "Hard Rock", or "Hard Rock Bet" becomes the
    canonical name. A longer source such as "ESPN (Draft Kings)" only replaces
    that ESPN spelling. "Hard Rock" inside a sentence is left alone.
    """
    if name is None:
        return name
    raw = str(name)
    key = _compact(raw.strip())
    if key in _DISPLAY:
        return _DISPLAY[key]
    if "Draft Kings" in raw:
        return raw.replace("Draft Kings", "DraftKings")
    return raw


def book_key(name):
    """draftkings / hardrockbet / fanduel, or None when the provider is not one of our books."""
    p = _compact(name)
    if "draftkings" in p:
        return "draftkings"
    if "fanduel" in p:
        return "fanduel"
    if "hardrock" in p:
        return "hardrockbet"
    return None
