# Generates 4 LineSmart logo concepts (text converted to paths from Inter).
import os
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

FONT = "/usr/share/fonts/truetype/sand-box/google/Inter/Inter-VariableFont_opsz,wght.ttf"
OUT = os.path.dirname(os.path.abspath(__file__))
BG, CARD, LINE, TXT, MUTE = "#0b0f17", "#141c2b", "#243046", "#e6edf7", "#8b9ab3"
ACC, ACC2 = "#22d3a6", "#38bdf8"
_cache = {}

def font(w):
    if w not in _cache:
        _cache[w] = instancer.instantiateVariableFont(TTFont(FONT), {"wght": w, "opsz": 32})
    return _cache[w]

def text(s, w, size, x, y, track=0.0):
    """Return (svg path d, advance width) for string s, baseline at y."""
    f = font(w); upm = f["head"].unitsPerEm; sc = size / upm
    gs = f.getGlyphSet(); cmap = f.getBestCmap(); hmtx = f["hmtx"]
    ds = []; cx = x
    for ch in s:
        g = cmap[ord(ch)]
        pen = SVGPathPen(gs)
        gs[g].draw(TransformPen(pen, (sc, 0, 0, -sc, cx, y)))
        ds.append(pen.getCommands())
        cx += hmtx[g][0] * sc + track * size
    return " ".join(ds), cx - x - track * size

def r(v): return round(v, 2)

# ---------------- icons (64x64 viewBox) ----------------
ICONS = {
1: f'''<rect width="64" height="64" rx="14" fill="{ACC}"/>
  <path d="M17 13V47L30 34L37 41L49 23" fill="none" stroke="{BG}" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M41 20.5L51 19L50.5 29.5Z" fill="{BG}" stroke="{BG}" stroke-width="2.5" stroke-linejoin="round"/>''',
2: f'''<rect x="2" y="2" width="60" height="60" rx="13" fill="{CARD}" stroke="{ACC}" stroke-width="4"/>
  <rect x="12" y="18" width="36" height="10" rx="3" fill="{ACC}"/>
  <rect x="12" y="36" width="22" height="10" rx="3" fill="{ACC2}"/>
  <rect x="39" y="11" width="5" height="42" rx="2.5" fill="{TXT}"/>''',
3: f'''<path d="M32 3L61 32L32 61L3 32Z" fill="{ACC}"/>
  <path d="M32 3L3 32H61Z" fill="#6ee7c8"/>
  <path d="M16 37L26 27L35 35L47 24" fill="none" stroke="{BG}" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>''',
}
# concept 4: LS monogram from Inter glyphs + rising line
_ls, _w = text("LS", 800, 34, 0, 0, -0.02)
_x = (64 - _w) / 2
_ls, _ = text("LS", 800, 34, _x, 38, -0.02)
ICONS[4] = f'''<rect width="64" height="64" rx="14" fill="{CARD}"/>
  <rect x="1.5" y="1.5" width="61" height="61" rx="12.5" fill="none" stroke="{LINE}" stroke-width="3"/>
  <path d="{_ls}" fill="{TXT}"/>
  <path d="M11 54L25 47L33 50L50 41" fill="none" stroke="{ACC}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M45 39L54 39L50 47Z" fill="{ACC}" stroke="{ACC}" stroke-width="2" stroke-linejoin="round"/>'''

# ---------------- wordmarks ----------------
def wordmark(n, x):
    if n == 1:   # bold, "Smart" in accent
        a, wa = text("Line", 700, 38, x, 46, -0.02)
        b, wb = text("Smart", 700, 38, x + wa, 46, -0.02)
        return f'<path d="{a}" fill="{TXT}"/><path d="{b}" fill="{ACC}"/>', wa + wb
    if n == 2:   # scoreboard caps, tracked
        a, wa = text("LINE", 800, 30, x, 43, 0.08)
        g = 0.08 * 30
        b, wb = text("SMART", 800, 30, x + wa + g, 43, 0.08)
        return f'<path d="{a}" fill="{TXT}"/><path d="{b}" fill="{ACC}"/>', wa + g + wb
    if n == 3:   # single-color semibold, gem-dot accent after
        a, wa = text("LineSmart", 600, 38, x, 46, -0.025)
        return f'<path d="{a}" fill="{TXT}"/>', wa
    if n == 4:   # weight contrast: light Line + heavy Smart
        a, wa = text("Line", 400, 38, x, 46, -0.01)
        b, wb = text("Smart", 800, 38, x + wa + 1, 46, -0.02)
        return f'<path d="{a}" fill="{MUTE}"/><path d="{b}" fill="{TXT}"/>', wa + 1 + wb

for n in range(1, 5):
    d = os.path.join(OUT, f"concept-{n}"); os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "icon.svg"), "w") as fh:
        fh.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">\n  {ICONS[n]}\n</svg>\n')
    wm, ww = wordmark(n, 80)
    W = r(80 + ww + 4)
    with open(os.path.join(d, "logo.svg"), "w") as fh:
        fh.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} 64" width="{W}" height="64">\n'
                 f'  <title>LineSmart</title>\n  <g>{ICONS[n]}</g>\n  {wm}\n</svg>\n')
    print(n, W)
