#!/usr/bin/env python3
"""
Konzept-Asset-Generator: erzeugt die ORIGINALE Spielbrett-Unterlage (Planet + Mond)
als SVG sowie den Territorien-Graphen als map.json.

- Deterministisch (fester Seed) -> reproduzierbare Assets.
- Topologie-Kennzahlen (42 Land / 13 Wasser in 5 Kolonien / 14 Mond in 3 Kolonien)
  entsprechen der Spielmechanik-Struktur; Geometrie, Namen und Grafik sind eigenständig.

Abhängigkeiten: numpy, scipy, shapely
Aufruf:  python3 generate_board.py <ausgabeverzeichnis>
"""
import json
import math
import sys
from collections import defaultdict, deque

import numpy as np
from scipy.spatial import Voronoi
from shapely.geometry import Polygon, Point, box, MultiPolygon
from shapely.ops import unary_union

SEED = 2210
W, H = 2000, 1000
OUT = sys.argv[1] if len(sys.argv) > 1 else "."

rng = np.random.default_rng(SEED)

# ---------------------------------------------------------------------------
# Inhaltsdefinition (eigene Welt "Kepler-Kolonien")
# ---------------------------------------------------------------------------
CONTINENTS = [
    # id, name, center, rx, ry, phase, color, territory names
    ("BOR", "Borea", (430, 245), 330, 165, 0.3, "#8fb3d9",
     ["Frostkamm", "Weißfels", "Kaltmark", "Nordwacht", "Eisgrund",
      "Sturmhafen", "Fjordland", "Grauheide", "Polarnest"]),
    ("VEL", "Vellor", (1510, 235), 310, 150, 1.7, "#e0a070",
     ["Aschental", "Glutmark", "Rubinfeld", "Sonnwacht", "Kupferhang",
      "Feuerkap", "Salzpfanne"]),
    ("KAS", "Kaskadia", (985, 480), 255, 215, 2.9, "#b9a3d6",
     ["Hochplateau", "Zinnberg", "Steinwall", "Talsperre", "Schluchten",
      "Basaltkrone", "Erzhügel", "Kraterfeld", "Silberpass", "Donnerkamm"]),
    ("MER", "Meridia", (385, 730), 215, 195, 4.1, "#93c78f",
     ["Grünhain", "Nebelwald", "Regenbruch", "Lianenhof", "Moorstadt",
      "Smaragdbucht"]),
    ("SAH", "Sahari", (1080, 835), 250, 105, 5.3, "#e6cf7a",
     ["Dünenmeer", "Sandtor", "Oasenring", "Glasebene", "Staubkessel",
      "Mirage"]),
    ("INS", "Insula", (1720, 735), 175, 140, 0.9, "#e39bb0",
     ["Korallen", "Perlriff", "Lagune", "Atollia"]),
]

OCEANS = [
    # id, name, seed, color, territory names
    ("NOR", "Nordmeer", (990, 70), "#5b8fc7", ["Eisrinne", "Walgraben", "Polarstrom"]),
    ("PEL", "Pelagia", (90, 480), "#4a7fb8", ["Tangwald", "Schwarzwasser", "Mahlstrom"]),
    ("ABY", "Abyssos", (690, 470), "#3e6fa6", ["Abyssal-Tor", "Tiefseegraben", "Schlote"]),
    ("KOR", "Korallensee", (1420, 560), "#6aa0d4", ["Riffbank", "Perlgrund"]),
    ("SUD", "Südmeer", (640, 950), "#5486bf", ["Sturmsee", "Südstrom"]),
]

MOON_COLONIES = [
    # Struktur laut Regelheft: 3 Mondkolonien mit 4 bzw. 6 Gebieten (6 + 4 + 4 = 14)
    ("HOC", "Selene-Hochland", -90, "#c9c9d6",
     ["Landeplatz Alpha", "Lichtkrater", "Hochebene", "Kraterrand", "Spiegelfeld", "Sternwarte"]),
    ("TEN", "Mare Tenebris", 30, "#a7a7b8",
     ["Landeplatz Beta", "Schattenmeer", "Staubbecken", "Grabenbruch"]),
    ("POL", "Polarkappe", 150, "#b8c4cf",
     ["Landeplatz Gamma", "Eiskrater", "Kryobasis", "Dunkelseite"]),
]


# ---------------------------------------------------------------------------
# Geometrie-Helfer
# ---------------------------------------------------------------------------
def lloyd_voronoi(points, clip, iterations=4):
    """Voronoi-Zellen (shapely) mit Lloyd-Relaxation, geclippt auf `clip`."""
    for it in range(iterations + 1):
        # Spiegelpunkte, damit alle Zellen endlich sind
        minx, miny, maxx, maxy = clip.bounds
        far = np.array([[minx - 5000, miny - 5000], [maxx + 5000, miny - 5000],
                        [minx - 5000, maxy + 5000], [maxx + 5000, maxy + 5000]])
        vor = Voronoi(np.vstack([points, far]))
        cells = []
        for i in range(len(points)):
            region = vor.regions[vor.point_region[i]]
            if -1 in region or len(region) == 0:
                cells.append(None)
                continue
            poly = Polygon(vor.vertices[region]).intersection(clip)
            cells.append(poly if not poly.is_empty else None)
        if it == iterations:
            return points, cells, vor
        points = np.array([[c.centroid.x, c.centroid.y] if c is not None else p
                           for c, p in zip(cells, points)])


def cell_neighbors(vor, n, cells):
    """Nachbarschaft nur bei echter gemeinsamer Kante INNERHALB des Clip-Bereichs."""
    nb = defaultdict(set)
    for a, b in vor.ridge_points:
        if a < n and b < n and cells[a] is not None and cells[b] is not None:
            if cells[a].intersection(cells[b]).length > 1.0:
                nb[a].add(b)
                nb[b].add(a)
    return nb


def grow_regions(cells_subset, seeds, targets, nb, centers):
    """Balanciertes Multi-Source-Region-Growing auf dem Zellgraphen."""
    subset = set(cells_subset)
    owner = {}
    sizes = [0] * len(seeds)
    frontier = [set() for _ in seeds]
    for r, s in enumerate(seeds):
        owner[s] = r
        sizes[r] = 1
        frontier[r] |= (nb[s] & subset)
    while True:
        cand = [r for r in range(len(seeds)) if frontier[r] - owner.keys()]
        if not cand:
            break
        r = min(cand, key=lambda k: sizes[k] / targets[k])
        free = frontier[r] - owner.keys()
        sc = centers[seeds[r]]
        c = min(free, key=lambda k: np.hypot(*(centers[k] - sc)))
        owner[c] = r
        sizes[r] += 1
        frontier[r] |= (nb[c] & subset)
    return owner


def farthest_seeds(cells_subset, k, centers, rng_):
    cells_subset = list(cells_subset)
    first = cells_subset[rng_.integers(len(cells_subset))]
    seeds = [first]
    while len(seeds) < k:
        d = [min(np.hypot(*(centers[c] - centers[s])) for s in seeds) for c in cells_subset]
        seeds.append(cells_subset[int(np.argmax(d))])
    return seeds


def components(cells_subset, nb):
    subset = set(cells_subset)
    seen, comps = set(), []
    for c in subset:
        if c in seen:
            continue
        q, comp = deque([c]), []
        seen.add(c)
        while q:
            x = q.popleft()
            comp.append(x)
            for y in nb[x] & subset:
                if y not in seen:
                    seen.add(y)
                    q.append(y)
        comps.append(comp)
    return sorted(comps, key=len, reverse=True)


def poly_to_path(geom):
    if isinstance(geom, MultiPolygon):
        return " ".join(poly_to_path(g) for g in geom.geoms)
    def ring(coords):
        pts = list(coords)[:-1]
        return "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in pts) + " Z"
    s = ring(geom.exterior.coords)
    for interior in geom.interiors:
        s += " " + ring(interior.coords)
    return s


def clean_geom(geom):
    """Entfernt Kleinstfragmente (<3 % der Fläche), die nur über Eckpunkte hängen."""
    if isinstance(geom, MultiPolygon):
        parts = sorted(geom.geoms, key=lambda g: g.area, reverse=True)
        keep = [g for g in parts if g.area >= 0.03 * parts[0].area]
        return keep[0] if len(keep) == 1 else MultiPolygon(keep)
    return geom


def label_point(geom):
    """Pole of inaccessibility -> Label liegt garantiert tief im Polygon."""
    from shapely.ops import polylabel
    g = max(geom.geoms, key=lambda x: x.area) if isinstance(geom, MultiPolygon) else geom
    p = polylabel(g, tolerance=1.0)
    return p.x, p.y


# ---------------------------------------------------------------------------
# Planet
# ---------------------------------------------------------------------------
def land_test(x, y):
    for idx, (cid, _, (cx, cy), rx, ry, ph, *_r) in enumerate(CONTINENTS):
        dx, dy = (x - cx) / rx, (y - cy) / ry
        th = math.atan2(dy, dx)
        r_eff = 1 + 0.16 * math.sin(3 * th + ph) + 0.09 * math.sin(5 * th + 2 * ph) \
            + 0.05 * math.sin(9 * th + 3 * ph)
        if dx * dx + dy * dy < r_eff * r_eff:
            return idx
    return None


def build_planet():
    clip = box(0, 0, W, H)
    pts = np.column_stack([rng.uniform(0, W, 900), rng.uniform(0, H, 900)])
    pts, cells, vor = lloyd_voronoi(pts, clip, iterations=4)
    n = len(pts)
    nb = cell_neighbors(vor, n, cells)
    centers = {i: np.array([cells[i].centroid.x, cells[i].centroid.y]) for i in range(n)}

    cont_of = {}
    for i in range(n):
        idx = land_test(*centers[i])
        if idx is not None:
            cont_of[i] = idx

    territories = []  # dicts
    land_owner = {}
    for ci, (cid, cname, center, rx, ry, ph, color, names) in enumerate(CONTINENTS):
        cset = [i for i, c in cont_of.items() if c == ci]
        comps = components(cset, nb)
        main = comps[0]
        for comp in comps[1:]:
            for c in comp:
                cont_of.pop(c, None)
        seeds = farthest_seeds(main, len(names), centers, rng)
        owner = grow_regions(main, seeds, [1] * len(seeds), nb, centers)
        groups = defaultdict(list)
        for c, r in owner.items():
            groups[r].append(c)
        # Sortierung NW->SO für stabile Namensvergabe
        order = sorted(groups, key=lambda r: (round(centers[seeds[r]][1] / 120), centers[seeds[r]][0]))
        for k, r in enumerate(order):
            tid = f"{cid}-{k + 1}"
            for c in groups[r]:
                land_owner[c] = tid
            territories.append({"id": tid, "name": names[k], "type": "land",
                                "region": cid, "cells": groups[r]})

    ocean_cells = [i for i in range(n) if i not in land_owner]
    comps = components(ocean_cells, nb)
    main_ocean = comps[0]
    # Seen/Binnengewässer -> an benachbarte Landterritorien anhängen
    for comp in comps[1:]:
        for c in comp:
            for y in nb[c]:
                if y in land_owner:
                    land_owner[c] = land_owner[y]
                    for t in territories:
                        if t["id"] == land_owner[y]:
                            t["cells"].append(c)
                    break

    def nearest_cell(p, pool):
        return min(pool, key=lambda k: np.hypot(*(centers[k] - np.array(p))))

    # Nicht erreichbare Restzellen (z. B. Randzellen) dem nächsten Nachbarn zuschlagen
    o_seeds = [nearest_cell(o[2], main_ocean) for o in OCEANS]
    o_targets = [len(o[4]) for o in OCEANS]
    o_owner = grow_regions(main_ocean, o_seeds, o_targets, nb, centers)
    water_owner = {}
    for oi, (oid, oname, seed, color, names) in enumerate(OCEANS):
        ocells = [c for c, r in o_owner.items() if r == oi]
        seeds = farthest_seeds(ocells, len(names), centers, rng)
        owner = grow_regions(ocells, seeds, [1] * len(seeds), nb, centers)
        groups = defaultdict(list)
        for c, r in owner.items():
            groups[r].append(c)
        order = sorted(groups, key=lambda r: (centers[seeds[r]][0], centers[seeds[r]][1]))
        for k, r in enumerate(order):
            tid = f"{oid}-{k + 1}"
            for c in groups[r]:
                water_owner[c] = tid
            territories.append({"id": tid, "name": names[k], "type": "water",
                                "region": oid, "cells": groups[r]})

    tid_of = {**land_owner, **water_owner}
    tmap = {t["id"]: t for t in territories}
    changed = True
    while changed:
        changed = False
        for c in range(n):
            if c in tid_of or cells[c] is None:
                continue
            # nur echte (im Clip-Rechteck liegende) gemeinsame Kanten zählen
            shared = [(cells[c].intersection(cells[y]).length, tid_of[y])
                      for y in nb[c] if y in tid_of and cells[y] is not None]
            shared = [x for x in shared if x[0] > 1.0]
            if shared:
                owner_t = max(shared)[1]
                tid_of[c] = owner_t
                tmap[owner_t]["cells"].append(c)
                changed = True
    for t in territories:
        t["geom"] = clean_geom(unary_union([cells[c].buffer(0.01) for c in t["cells"]]).buffer(-0.01))

    # Adjazenzen über gemeinsame Zellkanten
    adj = defaultdict(set)
    for a in range(n):
        for b in nb[a]:
            if a not in tid_of or b not in tid_of or tid_of[a] == tid_of[b]:
                continue
            adj[tid_of[a]].add(tid_of[b])
            adj[tid_of[b]].add(tid_of[a])

    # Zylinder-Topologie (Ost-West-Umlauf): Territorien am linken/rechten Rand verbinden
    edge_links = []
    eps = 2.0
    left = [t for t in territories if t["geom"].bounds[0] < eps]
    right = [t for t in territories if t["geom"].bounds[2] > W - eps]
    for tl in left:
        sl = tl["geom"].intersection(box(0, 0, eps, H))
        for tr in right:
            sr = tr["geom"].intersection(box(W - eps, 0, W, H))
            if sl.is_empty or sr.is_empty:
                continue
            lo = max(sl.bounds[1], sr.bounds[1])
            hi = min(sl.bounds[3], sr.bounds[3])
            if hi - lo > 25 and tl["type"] == tr["type"]:
                adj[tl["id"]].add(tr["id"])
                adj[tr["id"]].add(tl["id"])
                edge_links.append((tl["id"], tr["id"], (lo + hi) / 2))

    # Seewege (Land<->Land über Meerengen), damit Land-Graph zusammenhängt
    lands = [t for t in territories if t["type"] == "land"]
    sea_lanes = []
    cont_pairs = {}
    for i, a in enumerate(lands):
        for b in lands[i + 1:]:
            if a["region"] == b["region"]:
                continue
            d = a["geom"].distance(b["geom"])
            key = tuple(sorted((a["region"], b["region"])))
            if key not in cont_pairs or d < cont_pairs[key][0]:
                cont_pairs[key] = (d, a["id"], b["id"])
    # Kruskal über Kontinente + zusätzliche kurze Engen
    parent = {c[0]: c[0] for c in CONTINENTS}
    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    for key, (d, a, b) in sorted(cont_pairs.items(), key=lambda kv: kv[1][0]):
        ra, rb = find(key[0]), find(key[1])
        if ra != rb or d < 140:
            parent[ra] = rb
            if b not in adj[a]:
                adj[a].add(b)
                adj[b].add(a)
                sea_lanes.append((a, b))

    return territories, tmap, adj, sea_lanes, edge_links


def region_bonus(territories, adj, region):
    members = [t for t in territories if t["region"] == region]
    ids = {t["id"] for t in members}
    border = sum(1 for t in members
                 if any(tmap_all[x]["region"] != region and tmap_all[x]["type"] == t["type"]
                        for x in adj[t["id"]]))
    n = len(members)
    return max(1, round(0.4 * n + 0.4 * border)), border


# ---------------------------------------------------------------------------
# Mond
# ---------------------------------------------------------------------------
MW, MH, MR = 1000, 1000, 440


def build_moon():
    cx, cy = MW / 2, MH / 2
    disk = Point(cx, cy).buffer(MR, resolution=128)
    pts = []
    while len(pts) < 260:
        x, y = rng.uniform(cx - MR, cx + MR, 2)
        if (x - cx) ** 2 + (y - cy) ** 2 < MR ** 2:
            pts.append((x, y))
    pts, cells, vor = lloyd_voronoi(np.array(pts), disk, iterations=5)
    n = len(pts)
    nb = cell_neighbors(vor, n, cells)
    centers = {i: np.array([cells[i].centroid.x, cells[i].centroid.y]) for i in range(n)}
    allc = list(range(n))

    def nearest(p):
        return min(allc, key=lambda k: np.hypot(*(centers[k] - np.array(p))))

    seeds = [nearest((cx + 0.55 * MR * math.cos(math.radians(a)),
                      cy + 0.55 * MR * math.sin(math.radians(a)))) for _, _, a, _, _ in MOON_COLONIES]
    owner = grow_regions(allc, seeds, [len(m[4]) for m in MOON_COLONIES], nb, centers)
    territories = []
    for mi, (mid, mname, ang, color, names) in enumerate(MOON_COLONIES):
        mcells = [c for c, r in owner.items() if r == mi]
        # Landeplatz = äußerste Zelle Richtung Kolonie-Winkel (Rand der Scheibe)
        rim = (cx + MR * math.cos(math.radians(ang)), cy + MR * math.sin(math.radians(ang)))
        land_seed = min(mcells, key=lambda k: np.hypot(*(centers[k] - np.array(rim))))
        others = farthest_seeds([c for c in mcells if c != land_seed], len(names) - 1, centers, rng)
        sub = grow_regions(mcells, [land_seed] + others, [1] * len(names), nb, centers)
        groups = defaultdict(list)
        for c, r in sub.items():
            groups[r].append(c)
        rest = sorted([r for r in groups if r != 0],
                      key=lambda r: math.atan2(*(centers[([land_seed] + others)[r]] - [cx, cy])[::-1]))
        for k, r in enumerate([0] + rest):
            tid = f"{mid}-{k + 1}"
            territories.append({"id": tid, "name": names[k], "type": "moon", "region": mid,
                                "landing_site": r == 0, "cells": groups[r]})
    tid_of = {}
    for t in territories:
        for c in t["cells"]:
            tid_of[c] = t["id"]
        t["geom"] = unary_union([cells[c].buffer(0.01) for c in t["cells"]]).buffer(-0.01)
    adj = defaultdict(set)
    for a in range(n):
        for b in nb[a]:
            if tid_of[a] == tid_of[b]:
                continue
            adj[tid_of[a]].add(tid_of[b])
            adj[tid_of[b]].add(tid_of[a])
    return territories, adj


# ---------------------------------------------------------------------------
# SVG-Ausgabe
# ---------------------------------------------------------------------------
def shade(hex_color, f):
    h = hex_color.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    r, g, b = (max(0, min(255, int(v * f))) for v in (r, g, b))
    return f"#{r:02x}{g:02x}{b:02x}"


def svg_planet(territories, adj, sea_lanes, edge_links, bonuses):
    color = {c[0]: c[6] for c in CONTINENTS} | {o[0]: o[3] for o in OCEANS}
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H + 190}" '
           f'width="{W}" height="{H + 190}" font-family="Inter,Segoe UI,Helvetica,Arial,sans-serif">',
           '<defs><pattern id="grid" width="100" height="100" patternUnits="userSpaceOnUse">'
           '<path d="M100 0 L0 0 0 100" fill="none" stroke="#ffffff" stroke-opacity="0.06"/></pattern></defs>',
           f'<rect width="{W}" height="{H + 190}" fill="#0f1a2b"/>',
           f'<rect width="{W}" height="{H}" fill="#24476e"/>']
    for k, t in enumerate(territories):
        base = color[t["region"]]
        f = 1.0 + 0.10 * ((k * 7) % 5 - 2) / 2
        fill = shade(base, f)
        stroke = "#0f1a2b" if t["type"] == "land" else "#9cc3ea"
        sw = 2.2 if t["type"] == "land" else 1.2
        out.append(f'<path id="{t["id"]}" d="{poly_to_path(t["geom"])}" fill="{fill}" '
                   f'stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round"/>')
    out.append(f'<rect width="{W}" height="{H}" fill="url(#grid)"/>')
    # Regionsgrenzen (Kontinent-/Kolonieumrisse) betonen
    for reg in [c[0] for c in CONTINENTS]:
        g = unary_union([t["geom"].buffer(0.5) for t in territories if t["region"] == reg])
        out.append(f'<path d="{poly_to_path(g)}" fill="none" stroke="#0b1322" stroke-width="5" '
                   f'stroke-opacity="0.85" stroke-linejoin="round"/>')
    tm = {t["id"]: t for t in territories}
    for a, b in sea_lanes:
        pa, pb = tm[a]["geom"], tm[b]["geom"]
        from shapely.ops import nearest_points
        p1, p2 = nearest_points(pa, pb)
        ax, ay = label_point(pa)
        bx, by = label_point(pb)
        out.append(f'<line x1="{ax:.0f}" y1="{ay:.0f}" x2="{bx:.0f}" y2="{by:.0f}" stroke="#ffffff" '
                   f'stroke-width="3" stroke-dasharray="10 8" stroke-opacity="0.75"/>')
    left_lbl, right_lbl = defaultdict(list), defaultdict(list)
    for a, b, y in edge_links:
        left_lbl[a].append((b, y))
        right_lbl[b].append((a, y))
    for side, lbls in (("L", left_lbl), ("R", right_lbl)):
        for tid, lst in lbls.items():
            y = sum(v for _, v in lst) / len(lst)
            partners = "/".join(sorted({p for p, _ in lst}))
            x, anchor = (6, "start") if side == "L" else (W - 6, "end")
            for t in territories:
                lx_, ly_ = label_point(t["geom"])
                if abs(lx_ - x) < 260 and abs(ly_ - y) < 30:
                    y = ly_ + 42 if y >= ly_ else ly_ - 42
            txt = f"◀ {partners}" if side == "L" else f"{partners} ▶"
            out.append(f'<text x="{x}" y="{y:.0f}" font-size="15" fill="#ffffff" text-anchor="{anchor}" '
                       f'font-weight="700" paint-order="stroke" stroke="#0f1a2b" stroke-width="3">{txt}</text>')
    for t in territories:
        x, y = label_point(t["geom"])
        fs = 17 if t["type"] == "land" else 16
        fc = "#0f1a2b" if t["type"] == "land" else "#ffffff"
        sc = "#ffffff" if t["type"] == "land" else "#1b3557"
        out.append(f'<text x="{x:.0f}" y="{y - 4:.0f}" font-size="{fs}" font-weight="700" fill="{fc}" '
                   f'text-anchor="middle" paint-order="stroke" stroke="{sc}" stroke-width="3" '
                   f'stroke-opacity="0.6">{t["name"]}</text>')
        out.append(f'<text x="{x:.0f}" y="{y + 14:.0f}" font-size="12" fill="{fc}" text-anchor="middle" '
                   f'opacity="0.8">{t["id"]}</text>')
    # Legende
    lx, ly = 20, H + 30
    out.append(f'<text x="{lx}" y="{ly}" font-size="20" font-weight="700" fill="#ffffff">'
               f'Kepler-Kolonien – Planetenbrett (Konzept-Unterlage, Original-Design)</text>')
    col = 0
    for reg in [c for c in CONTINENTS] + [o for o in OCEANS]:
        rid = reg[0]
        name = reg[1]
        clr = reg[6] if len(reg) == 8 else reg[3]
        cnt = sum(1 for t in territories if t["region"] == rid)
        x = lx + (col % 6) * 325
        y = ly + 30 + (col // 6) * 34
        out.append(f'<rect x="{x}" y="{y - 16}" width="22" height="22" rx="4" fill="{clr}" stroke="#ffffff" stroke-opacity="0.4"/>')
        out.append(f'<text x="{x + 30}" y="{y + 1}" font-size="16" fill="#e8eef7">{name} ({rid}) · '
                   f'{cnt} Terr. · Bonus +{bonuses[rid]}</text>')
        col += 1
    out.append(f'<text x="{lx}" y="{ly + 30 + 2 * 34 + 8}" font-size="15" fill="#c9d6e8">'
               f'- - - Seeweg (Land↔Land)   ·   ◀ ▶ Ost-West-Umlauf (Kartenrand verbindet)   ·   '
               f'Wasserterritorien: Invasion nur mit Marine-Kommandant   ·   IDs = Schlüssel in map.json</text>')
    out.append("</svg>")
    return "\n".join(out)


def svg_moon(territories, bonuses):
    color = {m[0]: m[3] for m in MOON_COLONIES}
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {MW} {MH + 170}" width="{MW}" '
           f'height="{MH + 170}" font-family="Inter,Segoe UI,Helvetica,Arial,sans-serif">',
           f'<rect width="{MW}" height="{MH + 170}" fill="#0b0f19"/>']
    srng = np.random.default_rng(7)
    for _ in range(160):
        x, y = srng.uniform(0, MW), srng.uniform(0, MH)
        out.append(f'<circle cx="{x:.0f}" cy="{y:.0f}" r="{srng.uniform(0.5, 1.6):.1f}" fill="#ffffff" '
                   f'opacity="{srng.uniform(0.2, 0.8):.2f}"/>')
    for k, t in enumerate(territories):
        fill = shade(color[t["region"]], 1.0 + 0.08 * ((k * 5) % 5 - 2) / 2)
        out.append(f'<path id="{t["id"]}" d="{poly_to_path(t["geom"])}" fill="{fill}" stroke="#2b2f3d" '
                   f'stroke-width="2" stroke-linejoin="round"/>')
    for reg in [m[0] for m in MOON_COLONIES]:
        g = unary_union([t["geom"].buffer(0.5) for t in territories if t["region"] == reg])
        out.append(f'<path d="{poly_to_path(g)}" fill="none" stroke="#141824" stroke-width="5" stroke-linejoin="round"/>')
    for t in territories:
        x, y = label_point(t["geom"])
        if t["landing_site"]:
            out.append(f'<circle cx="{x:.0f}" cy="{y - 30:.0f}" r="13" fill="#ffcc33" stroke="#141824" stroke-width="2"/>'
                       f'<text x="{x:.0f}" y="{y - 25:.0f}" font-size="14" font-weight="800" text-anchor="middle" fill="#141824">L</text>')
        out.append(f'<text x="{x:.0f}" y="{y:.0f}" font-size="17" font-weight="700" fill="#141824" '
                   f'text-anchor="middle" paint-order="stroke" stroke="#ffffff" stroke-width="3" stroke-opacity="0.5">{t["name"]}</text>')
        out.append(f'<text x="{x:.0f}" y="{y + 17:.0f}" font-size="12" fill="#141824" text-anchor="middle">{t["id"]}</text>')
    ly = MH + 30
    out.append(f'<text x="20" y="{ly}" font-size="20" font-weight="700" fill="#ffffff">Mondbrett (Konzept-Unterlage, Original-Design)</text>')
    for i, (mid, mname, _, clr, names) in enumerate(MOON_COLONIES):
        x, yy = 20, ly + 22 + i * 30
        out.append(f'<rect x="{x}" y="{yy}" width="22" height="22" rx="4" fill="{clr}"/>'
                   f'<text x="{x + 30}" y="{yy + 17}" font-size="16" fill="#e8eef7">{mname} ({mid}) · '
                   f'{len(names)} Terr. · Bonus +{bonuses[mid]}</text>')
    out.append(f'<text x="20" y="{ly + 125}" font-size="15" fill="#c9d6e8">(L) Landeplatz: Ziel einer Invasion '
               f'von einer Raumstation aus (Raum-Kommandant erforderlich)</text>')
    out.append("</svg>")
    return "\n".join(out)


# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import os
    os.makedirs(OUT, exist_ok=True)
    territories, tmap_all, adj, sea_lanes, edge_links = build_planet()
    moon_t, moon_adj = build_moon()
    for t in moon_t:
        tmap_all[t["id"]] = t
    adj_all = defaultdict(set, {**adj, **moon_adj})
    all_t = territories + moon_t

    bonuses, borders = {}, {}
    for reg in [c[0] for c in CONTINENTS] + [o[0] for o in OCEANS] + [m[0] for m in MOON_COLONIES]:
        bonuses[reg], borders[reg] = region_bonus(all_t, adj_all, reg)

    with open(os.path.join(OUT, "planet.svg"), "w", encoding="utf-8") as f:
        f.write(svg_planet(territories, adj, sea_lanes, edge_links, bonuses))
    with open(os.path.join(OUT, "moon.svg"), "w", encoding="utf-8") as f:
        f.write(svg_moon(moon_t, bonuses))

    regions = []
    for c in CONTINENTS:
        regions.append({"id": c[0], "name": c[1], "kind": "continent", "bonus": bonuses[c[0]],
                        "borderTerritories": borders[c[0]]})
    for o in OCEANS:
        regions.append({"id": o[0], "name": o[1], "kind": "waterColony", "bonus": bonuses[o[0]],
                        "borderTerritories": borders[o[0]]})
    for m in MOON_COLONIES:
        regions.append({"id": m[0], "name": m[1], "kind": "lunarColony", "bonus": bonuses[m[0]],
                        "borderTerritories": borders[m[0]]})
    data = {
        "schema": "map/v1",
        "id": "kepler-colonies",
        "name": "Kepler-Kolonien",
        "generator": {"script": "tools/board-generator/generate_board.py", "seed": SEED},
        "boards": [{"id": "planet", "width": W, "height": H, "svg": "planet.svg", "wrapX": True},
                   {"id": "moon", "width": MW, "height": MH, "svg": "moon.svg"}],
        "regions": regions,
        "territories": [{
            "id": t["id"], "name": t["name"], "type": t["type"], "region": t["region"],
            "board": "moon" if t["type"] == "moon" else "planet",
            **({"landingSite": True} if t.get("landing_site") else {}),
            "label": [round(v) for v in label_point(t["geom"])],
            "adjacent": sorted(adj_all[t["id"]]),
        } for t in all_t],
        "seaLanes": [list(x) for x in sea_lanes],
        "wrapLinks": [[a, b] for a, b, _ in edge_links],
        "specialLinks": [{"kind": "orbital", "from": "anySpaceStation", "to": "landingSites",
                          "requires": "spaceCommanderInPlay"}],
    }
    with open(os.path.join(OUT, "map.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    # Geometrie für den Spiel-Client (vereinfachte Pfade, ganzzahlige Koordinaten)
    def compact_path(geom, tol=0.6):
        g = geom.simplify(tol, preserve_topology=True)
        polys = list(g.geoms) if isinstance(g, MultiPolygon) else [g]
        out = []
        for poly in polys:
            for ring in [poly.exterior, *poly.interiors]:
                pts = list(ring.coords)[:-1]
                out.append("M" + "L".join(f"{round(x)},{round(y)}" for x, y in pts) + "Z")
        return "".join(out)

    geometry = {
        "schema": "geometry/v1",
        "boards": {"planet": {"width": W, "height": H}, "moon": {"width": MW, "height": MH, "radius": MR}},
        "territories": {t["id"]: {"d": compact_path(t["geom"]),
                                   "label": [round(v) for v in label_point(t["geom"])]} for t in all_t},
        "regions": {},
        "seaLanes": [[a, b, [round(v) for v in label_point(tmap_all[a]["geom"])],
                      [round(v) for v in label_point(tmap_all[b]["geom"])]] for a, b in sea_lanes],
        "wrapLinks": [[a, b, round(y)] for a, b, y in edge_links],
    }
    for reg in [c[0] for c in CONTINENTS] + [m[0] for m in MOON_COLONIES]:
        g = unary_union([t["geom"].buffer(0.5) for t in all_t if t["region"] == reg])
        geometry["regions"][reg] = compact_path(g, 1.0)
    geo_out = os.environ.get("GEOMETRY_OUT")
    targets = [OUT] + ([geo_out] if geo_out else [])
    for target in targets:
        os.makedirs(target, exist_ok=True)
        with open(os.path.join(target, "geometry.json"), "w", encoding="utf-8") as f:
            json.dump(geometry, f, ensure_ascii=False, separators=(",", ":"))
        if target != OUT:
            with open(os.path.join(target, "map.json"), "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)

    # Kurzbericht
    print("Territorien:", {k: sum(1 for t in all_t if t['type'] == k) for k in ('land', 'water', 'moon')})
    print("Boni:", bonuses)
    print("Seewege:", sea_lanes)
    print("Umlauf:", [(a, b) for a, b, _ in edge_links])
    iso = [t["id"] for t in all_t if not adj_all[t["id"]]]
    print("Isoliert:", iso)
    print("MultiPolygon:", [t["id"] for t in all_t if isinstance(t["geom"], MultiPolygon)])
