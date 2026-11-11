#!/usr/bin/env python3
"""
Erzeugt UI-Wireframes (Smartphone-Client) als SVG für das Konzeptdokument.
Die Kartenansicht nutzt einen echten Ausschnitt des generierten Planetenbretts.

Aufruf: python3 generate_mockups.py <board-dir> <out-dir>
"""
import json
import os
import re
import sys

BOARD = sys.argv[1] if len(sys.argv) > 1 else "docs/assets/board"
OUT = sys.argv[2] if len(sys.argv) > 2 else "docs/assets/ui"
os.makedirs(OUT, exist_ok=True)

svg_planet = open(os.path.join(BOARD, "planet.svg"), encoding="utf-8").read()
data = json.load(open(os.path.join(BOARD, "map.json"), encoding="utf-8"))
T = {t["id"]: t for t in data["territories"]}
paths = dict(re.findall(r'<path id="([A-Z]+-\d+)" d="([^"]+)"', svg_planet))

P = {"rot": "#e5484d", "gelb": "#f2b134", "gruen": "#30a46c", "violett": "#8e4ec6", "neutral": "#8b93a1"}
OWN = {  # fiktiver Spielstand im Kartenausschnitt
    "KAS-1": ("violett", 3), "KAS-2": ("gelb", 2), "KAS-3": ("gelb", 4), "KAS-4": ("violett", 2),
    "KAS-5": ("violett", 5), "KAS-6": ("rot", 3), "KAS-7": ("rot", 4), "KAS-8": ("rot", 2),
    "KAS-9": ("rot", 2), "KAS-10": ("rot", 6), "SAH-1": ("gruen", 2), "SAH-2": ("gruen", 3),
    "SAH-3": ("gruen", 1), "SAH-4": ("gruen", 4), "SAH-5": ("gruen", 2), "SAH-6": ("gelb", 1),
    "KOR-1": ("violett", 2), "ABY-3": ("gruen", 1), "ABY-2": ("gelb", 2), "VEL-6": ("violett", 3),
    "VEL-7": ("violett", 2), "BOR-6": ("gelb", 3), "BOR-9": ("gelb", 2), "KOR-2": ("neutral", 0),
    "SUD-2": ("neutral", 0), "SUD-1": ("neutral", 0), "INS-1": ("gelb", 2), "INS-4": ("gelb", 3),
    "VEL-1": ("violett", 1), "VEL-4": ("violett", 2), "NOR-2": ("neutral", 0), "ABY-1": ("neutral", 0),
}
DEVASTATED = {"KAS-2"}
CMDR = {"KAS-10": "L", "KAS-7": "D", "SAH-4": "L", "KAS-5": "N"}
STATION = {"KAS-7", "VEL-4"}

FONT = 'font-family="Inter,Segoe UI,Helvetica,Arial,sans-serif"'
PW, PH, GAP = 360, 760, 40


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;")


def text(x, y, s, size=14, fill="#e8eef7", weight=400, anchor="start", extra=""):
    return (f'<text x="{x}" y="{y}" font-size="{size}" fill="{fill}" font-weight="{weight}" '
            f'text-anchor="{anchor}" {extra}>{esc(s)}</text>')


def rect(x, y, w, h, fill, r=10, stroke=None, extra=""):
    st = f' stroke="{stroke}" stroke-width="1.5"' if stroke else ""
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}"{st} {extra}/>'


def button(x, y, w, h, label, fill="#3b82f6", fg="#ffffff", size=15):
    return rect(x, y, w, h, fill, 12) + text(x + w / 2, y + h / 2 + 5, label, size, fg, 700, "middle")


def phone(ix, title, body):
    ox = ix * (PW + GAP) + GAP
    return (f'<g transform="translate({ox},70)">'
            f'<rect x="-8" y="-8" width="{PW + 16}" height="{PH + 16}" rx="44" fill="#05070c"/>'
            f'<rect width="{PW}" height="{PH}" rx="36" fill="#0e1523"/>'
            f'<clipPath id="clip{ix}"><rect width="{PW}" height="{PH}" rx="36"/></clipPath>'
            f'<g clip-path="url(#clip{ix})">{body}</g>'
            f'<rect x="{PW / 2 - 50}" y="10" width="100" height="22" rx="11" fill="#05070c"/>'
            f'</g>'
            + text(ox + PW / 2, 50, title, 18, "#0e1523", 800, "middle"))


def status_bar():
    return text(24, 28, "21:42", 13, "#c9d6e8", 600) + text(PW - 24, 28, "5G ▮▮▮ 82 %", 12, "#c9d6e8", 500, "end")


def top_bar(phase, me="rot"):
    return (rect(0, 40, PW, 70, "#152036", 0)
            + text(16, 66, "Jahr 3 / 5", 13, "#9fb3cc", 600)
            + text(16, 92, phase, 18, "#ffffff", 800)
            + f'<circle cx="{PW - 30}" cy="76" r="14" fill="{P[me]}"/>'
            + text(PW - 52, 72, "Du", 12, "#9fb3cc", 600, "end")
            + text(PW - 52, 90, "Zug 2 / 4", 12, "#ffffff", 700, "end"))


def chips(items, y=120):
    out, x = [], 12
    for label, val, clr in items:
        w = 30 + 7.0 * len(label) + 9 * len(val)
        out.append(rect(x, y, w, 28, "#1c2a44", 14) + text(x + 10, y + 19, label, 12, "#9fb3cc", 600)
                   + text(x + w - 10, y + 19, val, 13, clr, 800, "end"))
        x += w + 8
    return "".join(out)


def nav(active):
    items = ["Karte", "Hand", "Spieler", "Log"]
    out = [rect(0, PH - 64, PW, 64, "#152036", 0)]
    for i, it in enumerate(items):
        cx = 45 + i * 90
        c = "#60a5fa" if it == active else "#7b8aa3"
        out.append(f'<circle cx="{cx}" cy="{PH - 42}" r="9" fill="none" stroke="{c}" stroke-width="2.5"/>')
        out.append(text(cx, PH - 18, it, 12, c, 700, "middle"))
    return "".join(out)


def map_crop(x, y, w, h, vb=(745, 300, 640, 711), arrow=("KAS-10", "SAH-1")):
    vx, vy, vw, vh = vb
    out = [f'<svg x="{x}" y="{y}" width="{w}" height="{h}" viewBox="{vx} {vy} {vw} {vh}" '
           f'preserveAspectRatio="xMidYMid slice">',
           '<defs><pattern id="hatch" width="12" height="12" patternUnits="userSpaceOnUse" '
           'patternTransform="rotate(45)"><rect width="12" height="12" fill="#3a3f4a"/>'
           '<line x1="0" y1="0" x2="0" y2="12" stroke="#6b7280" stroke-width="5"/></pattern></defs>',
           f'<rect x="{vx}" y="{vy}" width="{vw}" height="{vh}" fill="#1f3d63"/>']
    for tid, d in paths.items():
        t = T[tid]
        if tid in DEVASTATED:
            fill, op = "url(#hatch)", 1
        elif tid in OWN and OWN[tid][0] != "neutral":
            fill, op = P[OWN[tid][0]], (0.85 if t["type"] == "land" else 0.45)
        else:
            fill, op = ("#2a4f7c" if t["type"] == "water" else "#59606d"), 1
        stroke = "#0b1322" if t["type"] == "land" else "#7fb0e0"
        out.append(f'<path d="{d}" fill="{fill}" fill-opacity="{op}" stroke="{stroke}" stroke-width="2.5"/>')
    a, b = arrow
    (ax, ay), (bx, by) = T[a]["label"], T[b]["label"]
    out.append(f'<path d="M{ax},{ay} Q{(ax + bx) / 2 + 60},{(ay + by) / 2} {bx},{by - 22}" fill="none" '
               f'stroke="#ffffff" stroke-width="9" stroke-linecap="round" opacity="0.95"/>'
               f'<polygon points="{bx - 14},{by - 40} {bx + 14},{by - 40} {bx},{by - 16}" fill="#ffffff"/>')
    out.append(f'<path d="{paths[a]}" fill="none" stroke="#ffffff" stroke-width="7"/>')
    out.append(f'<path d="{paths[b]}" fill="none" stroke="#fde047" stroke-width="7" stroke-dasharray="14 8"/>')
    for tid, (own, n) in OWN.items():
        if own == "neutral" or tid in DEVASTATED:
            continue
        lx, ly = T[tid]["label"]
        out.append(f'<circle cx="{lx}" cy="{ly}" r="20" fill="{P[own]}" stroke="#ffffff" stroke-width="3"/>'
                   f'<text x="{lx}" y="{ly + 8}" font-size="22" font-weight="800" fill="#fff" '
                   f'text-anchor="middle">{n}</text>')
        if tid in CMDR:
            out.append(f'<rect x="{lx + 14}" y="{ly - 36}" width="26" height="24" rx="6" fill="#111827" '
                       f'stroke="#fff" stroke-width="2"/><text x="{lx + 27}" y="{ly - 18}" font-size="16" '
                       f'font-weight="800" fill="#fde047" text-anchor="middle">{CMDR[tid]}</text>')
        if tid in STATION:
            out.append(f'<polygon points="{lx - 34},{ly - 30} {lx - 22},{ly - 44} {lx - 10},{ly - 30} '
                       f'{lx - 22},{ly - 16}" fill="#22d3ee" stroke="#fff" stroke-width="2"/>')
    lx, ly = T["KAS-2"]["label"]
    out.append(f'<text x="{lx}" y="{ly}" font-size="18" font-weight="800" fill="#e5e7eb" text-anchor="middle">VERWÜSTET</text>')
    out.append("</svg>")
    return "".join(out)


# --------------------------------------------------------------------------- Screens
def s_lobby():
    players = [("rot", "Paul (Host)", "bereit"), ("gelb", "Mara", "bereit"),
               ("gruen", "Jonas", "verbunden"), ("violett", "Bot · Stufe 2", "bereit")]
    b = [status_bar(), text(24, 82, "Neue Partie", 24, "#ffffff", 800),
         text(24, 106, "Kepler-Kolonien · Regelsatz »standard« v2", 12, "#9fb3cc"),
         rect(16, 124, PW - 32, 120, "#152036", 16),
         text(32, 152, "Beitrittscode", 12, "#9fb3cc", 600),
         text(32, 192, "QX7 - 42K", 34, "#ffffff", 800, extra='letter-spacing="2"'),
         rect(PW - 112, 136, 84, 84, "#ffffff", 8)]
    for i in range(7):
        for j in range(7):
            if (i * 3 + j * 5 + i * j) % 3 == 0 or i in (0, 6) and j in (0, 1, 5, 6) or j in (0, 6) and i in (1, 5):
                b.append(rect(PW - 106 + j * 10.5, 142 + i * 10.5, 10, 10, "#0e1523", 1))
    b.append(text(32, 228, "oder Link teilen · QR scannen", 12, "#60a5fa", 600))
    b.append(text(24, 280, "Spieler (4 / 5)", 15, "#ffffff", 700))
    for i, (c, n, st) in enumerate(players):
        y = 294 + i * 54
        b.append(rect(16, y, PW - 32, 46, "#152036", 12))
        b.append(f'<circle cx="40" cy="{y + 23}" r="10" fill="{P[c]}"/>')
        b.append(text(60, y + 28, n, 15, "#ffffff", 600))
        b.append(text(PW - 32, y + 28, st, 12, "#4ade80" if st == "bereit" else "#fbbf24", 700, "end"))
    b.append(text(24, 534, "Einstellungen", 15, "#ffffff", 700))
    for i, (k, v) in enumerate([("Modus", "Asynchron + Push"), ("Zug-Frist", "24 h → Bot-Vertretung"),
                                ("Reaktionen", "Reaktionsregeln (sofort)"), ("Würfel", "Server-RNG, auditierbar")]):
        y = 558 + i * 26
        b.append(text(24, y, k, 13, "#9fb3cc"))
        b.append(text(PW - 24, y, v, 13, "#e8eef7", 600, "end"))
    b.append(button(16, 672, PW - 32, 52, "Partie starten", "#22c55e"))
    return "".join(b)


def s_map():
    b = [status_bar(), top_bar("Invasion"),
         chips([("Energie", "7", "#fde047"), ("Karten", "3", "#e8eef7"), ("Eroberungen", "2/3", "#4ade80")]),
         map_crop(0, 156, PW, 330)]
    y = 486
    b.append(rect(0, y, PW, PH - 64 - y, "#101a2c", 0))
    b.append(rect(PW / 2 - 22, y + 8, 44, 5, "#334155", 3))
    b.append(text(16, y + 40, "Donnerkamm → Dünenmeer", 17, "#ffffff", 800))
    b.append(text(16, y + 62, "Angreifer 6 MODs + Land-Kdt.  ·  Verteidiger 2 MODs", 12, "#9fb3cc"))
    dice = [("W8", "#fde047"), ("W6", "#e8eef7"), ("W6", "#e8eef7")]
    for i, (d, c) in enumerate(dice):
        b.append(rect(16 + i * 58, y + 76, 50, 44, "#1c2a44", 10, c))
        b.append(text(41 + i * 58, y + 104, d, 15, c, 800, "middle"))
    b.append(text(196, y + 96, "vs.", 13, "#9fb3cc", 600))
    for i in range(2):
        b.append(rect(226 + i * 58, y + 76, 50, 44, "#1c2a44", 10, "#e8eef7"))
        b.append(text(251 + i * 58, y + 104, "W6", 15, "#e8eef7", 800, "middle"))
    b.append(text(16, y + 140, "P(2:0 im Wurf) ≈ 0,47 · P(Eroberung, Blitz) ≈ 0,96", 12, "#4ade80", 600))
    b.append(button(16, y + 152, 160, 44, "Würfeln", "#ef4444"))
    b.append(button(184, y + 152, 160, 44, "Blitz ≥ 2 übrig", "#334155"))
    b.append(nav("Karte"))
    return "".join(b)


def s_reaction():
    b = [status_bar(), top_bar("Zug von Rot", me="gruen"),
         rect(16, 124, PW - 32, 112, "#3b1218", 16, "#ef4444"),
         text(32, 154, "⚠ Angriff auf Dünenmeer", 18, "#fecaca", 800),
         text(32, 178, "Rot greift mit 3 Würfeln (1× W8) an.", 13, "#fecaca"),
         text(32, 202, "Du verteidigst mit 2 MODs.", 13, "#fecaca"),
         rect(32, 214, PW - 64, 8, "#5b1d25", 4), rect(32, 214, (PW - 64) * 0.62, 8, "#ef4444", 4),
         text(PW - 32, 210, "0:12", 13, "#fecaca", 800, "end"),
         text(24, 270, "Reaktionskarte spielen?", 16, "#ffffff", 800),
         text(24, 292, "Nur Karten, deren Kommandant im Spiel ist und die du bezahlen kannst.", 11, "#9fb3cc")]
    cards = [("Schildgenerator", "Diplomat", "1 E", "Verteidiger würfelt diese Runde mit W8.", True),
             ("Tarnstellung", "Land", "1 E", "+2 MODs des Verteidigers in Dünenmeer.", True),
             ("Orbitale Verstärkung", "Raum", "2 E", "Raum-Kdt. nicht im Spiel", False)]
    for i, (n, deck, cost, desc, ok) in enumerate(cards):
        y = 308 + i * 96
        b.append(rect(16, y, PW - 32, 86, "#152036" if ok else "#111827", 14, "#60a5fa" if i == 0 else None))
        b.append(text(32, y + 28, n, 16, "#ffffff" if ok else "#6b7280", 800))
        b.append(text(PW - 32, y + 28, cost, 15, "#fde047" if ok else "#6b7280", 800, "end"))
        b.append(text(32, y + 50, deck + "-Deck", 12, "#9fb3cc" if ok else "#4b5563", 600))
        b.append(text(32, y + 72, desc, 12, "#c9d6e8" if ok else "#4b5563"))
    b.append(button(16, 610, PW - 32, 50, "Schildgenerator spielen (1 E)", "#3b82f6"))
    b.append(button(16, 668, PW - 32, 22, "", "#0e1523"))
    b.append(text(PW / 2, 684, "Nicht reagieren", 14, "#9fb3cc", 700, "middle"))
    b.append(nav("Karte"))
    return "".join(b)


def s_shop():
    b = [status_bar(), top_bar("Kaufen & Ausspielen"),
         chips([("Energie", "7", "#fde047"), ("Karten gekauft", "1/4", "#e8eef7")]),
         text(16, 178, "Kommandanten (3 E)", 15, "#ffffff", 800)]
    cmd = [("L", "Land", "im Spiel"), ("D", "Diplomat", "im Spiel"), ("M", "Marine", "kaufen"),
           ("R", "Raum", "kaufen"), ("N", "Nuklear", "gefallen")]
    for i, (k, n, st) in enumerate(cmd):
        x = 12 + i * 68
        active = st == "im Spiel"
        b.append(rect(x, 192, 62, 86, "#1c2a44" if active else "#152036", 12, "#4ade80" if active else "#334155"))
        b.append(text(x + 31, 226, k, 24, "#fde047" if active else "#9fb3cc", 800, "middle"))
        b.append(text(x + 31, 248, n, 11, "#e8eef7", 600, "middle"))
        b.append(text(x + 31, 268, st, 10, "#4ade80" if active else ("#f87171" if st == "gefallen" else "#60a5fa"),
                      700, "middle"))
    b.append(rect(16, 292, PW - 32, 54, "#152036", 12))
    b.append(f'<polygon points="44,305 56,319 44,333 32,319" fill="#22d3ee"/>')
    b.append(text(68, 315, "Raumstation bauen", 14, "#ffffff", 700))
    b.append(text(68, 335, "1 / 4 gebaut · nur auf eigenem Land", 11, "#9fb3cc"))
    b.append(button(PW - 104, 303, 76, 32, "5 E", "#0891b2", size=14))
    b.append(text(16, 376, "Kommandokarten (1 E, max. 4 / Zug)", 15, "#ffffff", 800))
    decks = [("Land", 11, True), ("Diplomat", 9, True), ("Marine", 12, False), ("Raum", 10, False), ("Nuklear", 8, False)]
    for i, (n, cnt, ok) in enumerate(decks):
        x = 12 + i * 68
        b.append(rect(x, 390, 62, 72, "#1c2a44" if ok else "#111827", 10, "#60a5fa" if ok else None))
        b.append(text(x + 31, 414, n, 11, "#e8eef7" if ok else "#4b5563", 700, "middle"))
        b.append(text(x + 31, 440, str(cnt), 20, "#ffffff" if ok else "#4b5563", 800, "middle"))
        b.append(text(x + 31, 456, "ziehen" if ok else "gesperrt", 10, "#60a5fa" if ok else "#4b5563", 700, "middle"))
    b.append(text(16, 494, "Deine Hand (3)", 15, "#ffffff", 800))
    hand = [("Orbitaler Nachschub", "Raum · 2 E", "nicht spielbar – Raum-Kdt. fehlt", False),
            ("Schildgenerator", "Diplomat · 1 E", "Reaktion: bei Angriff auf dich", True),
            ("Gezielte Mobilisierung", "Land · 0 E", "Jetzt: +3 MODs in einem Gebiet mit Land-Kdt.", True)]
    for i, (n, meta, desc, ok) in enumerate(hand):
        y = 506 + i * 60
        b.append(rect(16, y, PW - 32, 52, "#152036", 12, "#4ade80" if i == 2 else None))
        b.append(text(30, y + 22, n, 14, "#ffffff" if ok else "#6b7280", 700))
        b.append(text(PW - 30, y + 22, meta, 11, "#fde047" if ok else "#6b7280", 700, "end"))
        b.append(text(30, y + 41, desc, 11, "#9fb3cc" if ok else "#4b5563"))
    b.append(nav("Hand"))
    return "".join(b)


def s_bid():
    b = [status_bar(), rect(0, 40, PW, 70, "#152036", 0),
         text(16, 66, "Jahr 4 / 5 · Jahresbeginn", 13, "#9fb3cc", 600),
         text(16, 92, "Geheimes Gebot", 18, "#ffffff", 800),
         rect(16, 128, PW - 32, 210, "#152036", 16),
         text(PW / 2, 160, "Dein Gebot (Energie)", 13, "#9fb3cc", 600, "middle"),
         text(PW / 2, 236, "3", 72, "#fde047", 800, "middle"),
         text(PW / 2, 266, "von 9 verfügbar · Gebote verfallen vollständig", 12, "#9fb3cc", 500, "middle"),
         rect(40, 290, PW - 80, 8, "#334155", 4), rect(40, 290, (PW - 80) * 3 / 9, 8, "#fde047", 4),
         f'<circle cx="{40 + (PW - 80) * 3 / 9}" cy="294" r="12" fill="#fde047" stroke="#0e1523" stroke-width="3"/>',
         text(24, 372, "Status", 15, "#ffffff", 800)]
    for i, (c, n, st) in enumerate([("gelb", "Mara", "abgegeben ✓"), ("gruen", "Jonas", "überlegt …"),
                                    ("violett", "Bot · Stufe 2", "abgegeben ✓")]):
        y = 386 + i * 46
        b.append(rect(16, y, PW - 32, 38, "#152036", 10))
        b.append(f'<circle cx="38" cy="{y + 19}" r="8" fill="{P[c]}"/>')
        b.append(text(56, y + 24, n, 14, "#ffffff", 600))
        b.append(text(PW - 30, y + 24, st, 12, "#4ade80" if "✓" in st else "#fbbf24", 700, "end"))
    b.append(rect(16, 534, PW - 32, 80, "#13233a", 12))
    b.append(text(30, 560, "Danach wählt der Höchstbietende seinen", 12, "#c9d6e8"))
    b.append(text(30, 578, "Zugplatz frei (1.–4.). Gleichstand: Server-", 12, "#c9d6e8"))
    b.append(text(30, 596, "Würfel, Ergebnis im Log nachprüfbar.", 12, "#c9d6e8"))
    b.append(button(16, 640, PW - 32, 52, "Gebot verbindlich abgeben", "#eab308", "#111827"))
    return "".join(b)


screens = [("1 · Lobby / Beitritt", s_lobby()), ("2 · Karte: Invasion", s_map()),
           ("3 · Reaktionsfenster (Live-Modus)", s_reaction()), ("4 · Kaufen & Hand", s_shop()),
           ("5 · Geheimes Gebot", s_bid())]
total_w = len(screens) * (PW + GAP) + GAP
svg = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {total_w} {PH + 110}" width="{total_w}" '
       f'height="{PH + 110}" {FONT}>', f'<rect width="{total_w}" height="{PH + 110}" fill="#e9eef5"/>']
for i, (title, body) in enumerate(screens):
    svg.append(phone(i, title, body))
svg.append("</svg>")
open(os.path.join(OUT, "mobile-wireframes.svg"), "w", encoding="utf-8").write("".join(svg))
print("ok", total_w)
