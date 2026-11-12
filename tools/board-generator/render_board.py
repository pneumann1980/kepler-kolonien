#!/usr/bin/env python3
"""
Kartendarstellung v2 (Geometrie für Client und Vorschauen).

Der Spielgraph (Gebiete, Regionen, Boni, Nachbarschaften) ist in content/board/map.json FESTGESCHRIEBEN.
Dieses Skript ändert ihn nie, sondern erzeugt nur die Darstellung:

* sechs Kontinente mit eigenen Silhouetten, durch Meerengen getrennt (Erosion der Kontinentflächen)
* Landpassagen dort, wo zwei Landgebiete verschiedener Kontinente im Graphen benachbart sind
* fünf Unterwasserkolonien als kompakte Feldgruppen im offenen Meer (13 Felder, 3/3/3/2/2);
  Felder berühren sich NICHT – Verbindungen werden ausschließlich als Routen aus dem Graphen gezeichnet
* Küstenzugänge, Wasser-Wasser-Routen, Ost-West-Übergänge (Wasser; Land nur Kartenrevision 2)
* Trefferflächen für kleine Wasserfelder, Regionsfarben, Regions-Beschriftungen, Landeplatz-Marker (Mond)
* Prüfungen: keine sichtbare Grenze ohne Graphkante, jede Graphkante ist als Grenze oder Route sichtbar

Aufruf:  python3 tools/board-generator/render_board.py
Abhängigkeiten: numpy, scipy, shapely (Formen aus generate_board.py, deterministisch)
"""
import json
import math
import os
import runpy
import sys
from collections import defaultdict

from shapely.geometry import Point, Polygon, MultiPolygon, LineString, box
from shapely.ops import unary_union, nearest_points, polylabel
from shapely import voronoi_polygons, MultiPoint

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
MAP_PATH = os.path.join(ROOT, 'content', 'board', 'map.json')
OUT_DIRS = [os.path.join(ROOT, 'content', 'board'), os.path.join(ROOT, 'docs', 'assets', 'board')]

gen = runpy.run_path(os.path.join(os.path.dirname(__file__), 'generate_board.py'), run_name='lib')
W, H = gen['W'], gen['H']
MW, MH, MR = gen['MW'], gen['MH'], gen['MR']

MAP = json.load(open(MAP_PATH, encoding='utf-8'))
T = {t['id']: t for t in MAP['territories']}
REG = {r['id']: r for r in MAP['regions']}
EDGES = set()
for t in MAP['territories']:
    for n in t['adjacent']:
        EDGES.add(tuple(sorted((t['id'], n))))
EW_LAND = ('BOR-3', 'VEL-5')  # Kartenrevision 2 (src/engine/content.ts)

REGION_COLORS = {
    'BOR': '#7f9fc0', 'VEL': '#cf9358', 'KAS': '#9a86bf', 'MER': '#6aa874', 'SAH': '#d2bb72', 'INS': '#c98598',
    'NOR': '#5fb7c9', 'PEL': '#4f9fd6', 'ABY': '#6c8fe0', 'KOR': '#45c2b0', 'SUD': '#7aa7d8',
    'HOC': '#d8cfa8', 'TEN': '#9aa6c2', 'POL': '#bcdbe9',
}

STRAIT = 13          # halbe Breite der Meerengen
FIELD_R = 35         # Radius eines runden Wasserfeldes (Stützpunkt)
FIELD_GAP = 18       # Abstand zwischen Feldern einer Kolonie (Felder berühren sich nicht)
LAND_CLEAR = 26      # Mindestabstand Kolonie <-> Küste
COLONY_CLEAR = 60    # Mindestabstand zwischen Kolonien


def P(geom):
    """Shapely -> kompakter SVG-Pfad"""
    polys = list(geom.geoms) if isinstance(geom, MultiPolygon) else [geom]
    out = []
    for poly in polys:
        if poly.is_empty:
            continue
        for ring in [poly.exterior, *poly.interiors]:
            pts = list(ring.coords)[:-1]
            out.append('M' + 'L'.join(f'{round(x)},{round(y)}' for x, y in pts) + 'Z')
    return ''.join(out)


def largest(g):
    if isinstance(g, MultiPolygon):
        return max(g.geoms, key=lambda x: x.area)
    return g


def rpt(p):
    return [round(p[0]), round(p[1])]


# =========================================================================== Planet
planet_t, _tmap, _adj, _lanes, _edges = gen['build_planet']()
moon_t, _madj = gen['build_moon']()
LAND_GEOM = {t['id']: t['geom'] for t in planet_t if t['type'] == 'land'}
assert set(LAND_GEOM) == {i for i, t in T.items() if t['type'] == 'land'}, 'Landgebiete passen nicht zu map.json'

continents = [r for r in REG.values() if r['kind'] == 'continent']
cont_shape = {}
for c in continents:
    members = [i for i, t in T.items() if t['region'] == c['id']]
    u = unary_union([LAND_GEOM[i].buffer(0.6) for i in members]).buffer(-0.6)
    # Meerengen: Kontinent schrumpfen, Spitzen glätten
    shape = u.buffer(-STRAIT, join_style=1).buffer(-6, join_style=1).buffer(6, join_style=1)
    cont_shape[c['id']] = largest(shape)

land_geom = {}
for i, g in LAND_GEOM.items():
    ng = largest(g.intersection(cont_shape[T[i]['region']]).buffer(0))
    land_geom[i] = ng.simplify(0.8, preserve_topology=True)
LAND_ALL = unary_union(list(land_geom.values()))

# sichtbare Landgrenzen müssen Graphkanten sein
borders = set()
ids = sorted(land_geom)
for a_i, a in enumerate(ids):
    for b in ids[a_i + 1:]:
        if land_geom[a].buffer(0.8).intersection(land_geom[b].buffer(0.8)).length > 4 or \
           land_geom[a].buffer(1.0).intersection(land_geom[b].buffer(1.0)).area > 20:
            pair = tuple(sorted((a, b)))
            assert pair in EDGES, f'Darstellung erzeugt neue Nachbarschaft {pair}'
            borders.add(pair)


def label_of(g):
    p = polylabel(largest(g), tolerance=1.0)
    return [round(p.x), round(p.y)]


# --------------------------------------------------------------- Wasserkolonien
def circ_mean_x(xs):
    a = [x / W * 2 * math.pi for x in xs]
    s, c = sum(math.sin(v) for v in a), sum(math.cos(v) for v in a)
    return (math.atan2(s, c) / (2 * math.pi) * W) % W


def coast_target(wid):
    lands = [n for n in T[wid]['adjacent'] if T[n]['type'] == 'land']
    pts = [land_geom[n].representative_point() for n in lands]
    return circ_mean_x([p.x for p in pts]), sum(p.y for p in pts) / len(pts)


colonies = [r['id'] for r in REG.values() if r['kind'] == 'waterColony']
members = {c: sorted(i for i, t in T.items() if t['region'] == c) for c in colonies}


def layout(cid):
    """Relative Feldpositionen: Kette (Mittelglied = Feld mit zwei Nachbarn) oder Dreieck."""
    ms = members[cid]
    step = 2 * FIELD_R + FIELD_GAP
    inner = {m: [n for n in T[m]['adjacent'] if n in ms] for m in ms}
    if len(ms) == 2:
        return {ms[0]: (-step / 2, 0), ms[1]: (step / 2, 0)}, step / 2 + FIELD_R
    # drei Felder als kompaktes Dreieck; welche Felder verbunden sind, zeigen nur die Routen aus dem Graphen
    r = step / math.sqrt(3)
    return {m: (r * math.cos(math.radians(90 + k * 120)), r * math.sin(math.radians(90 + k * 120))) for k, m in enumerate(ms)}, r + FIELD_R


def rotate(pt, a):
    return (pt[0] * math.cos(a) - pt[1] * math.sin(a), pt[0] * math.sin(a) + pt[1] * math.cos(a))


free_ocean = box(0, 0, W, H).difference(LAND_ALL.buffer(LAND_CLEAR))
placed = {}
field_center = {}
order = sorted(colonies, key=lambda c: -len(members[c]))
for cid in order:
    rel, radius = layout(cid)
    targets = {m: coast_target(m) for m in members[cid]}
    tx = circ_mean_x([p[0] for p in targets.values()])
    ty = sum(p[1] for p in targets.values()) / len(targets)
    best = None
    for gx in range(int(radius) + 4, W - int(radius) - 4, 8):
        for gy in range(int(radius) + 4, H - int(radius) - 4, 8):
            dx = min(abs(gx - tx), W - abs(gx - tx))
            cost = math.hypot(dx, gy - ty)
            if best and cost >= best[0]:
                continue
            c = Point(gx, gy)
            if not free_ocean.contains(c.buffer(radius)):
                continue
            if any(c.distance(Point(*p[0])) < radius + p[1] + COLONY_CLEAR for p in placed.values()):
                continue
            best = (cost, gx, gy)
    assert best, f'Kein Platz für Kolonie {cid}'
    cx, cy = best[1], best[2]
    # Rotation so wählen, dass jedes Feld zu seinen Küsten zeigt
    best_rot = None
    import itertools
    slots = list(rel.values())
    perms = [dict(zip(members[cid], pm)) for pm in itertools.permutations(slots)]
    for deg in range(0, 360, 5):
      for pm in perms:
        a = math.radians(deg)
        cost = 0
        for m, p in pm.items():
            q = rotate(p, a)
            fx, fy = cx + q[0], cy + q[1]
            tx2, ty2 = targets[m]
            dx = min(abs(fx - tx2), W - abs(fx - tx2))
            cost += math.hypot(dx, fy - ty2)
        if best_rot is None or cost < best_rot[0]:
            best_rot = (cost, a, pm)
    placed[cid] = ((cx, cy), radius)
    for m, p in best_rot[2].items():
        q = rotate(p, best_rot[1])
        field_center[m] = (cx + q[0], cy + q[1])


def disc(c, r):
    return Point(*c).buffer(r, resolution=12)


water_geom = {m: disc(c, FIELD_R) for m, c in field_center.items()}
for a in water_geom:
    for b in water_geom:
        if a < b:
            assert water_geom[a].distance(water_geom[b]) > 6, f'Wasserfelder {a}/{b} berühren sich'
    assert water_geom[a].distance(LAND_ALL) > 10, f'Wasserfeld {a} berührt Land'

# Trefferflächen: Voronoi-Zelle des Feldes ∩ vergrößerter Kreis, ohne Land
centers = MultiPoint([Point(*c) for c in field_center.values()])
cells = voronoi_polygons(centers, extend_to=box(-W, -H, 2 * W, 2 * H))
water_hit = {}
for m, c in field_center.items():
    cell = next(g for g in cells.geoms if g.contains(Point(*c)))
    hit = cell.intersection(Point(*c).buffer(FIELD_R + 26)).difference(LAND_ALL.buffer(6))
    water_hit[m] = largest(hit).simplify(1.0)

# --------------------------------------------------------------- Routen
routes = []
coastline = {}
for i, g in land_geom.items():
    others = unary_union([h.buffer(2.5) for j, h in land_geom.items() if j != i])
    c = g.boundary.difference(others)
    coastline[i] = c if not c.is_empty and c.length > 8 else g.boundary


def edge_point(geom, toward, tid=None):
    """Punkt auf dem Rand (bei Landgebieten: auf der Küstenlinie) nächst toward"""
    line = coastline.get(tid) if tid in coastline else geom.boundary
    p1, _ = nearest_points(line, Point(*toward))
    return (p1.x, p1.y)


def unwrap(ax, bx):
    """kürzeste horizontale Darstellung über den Rand"""
    d = bx - ax
    if d > W / 2:
        return bx - W
    if d < -W / 2:
        return bx + W
    return bx


def add_route(a, b, kind, extra=None):
    ga = water_geom.get(a) or land_geom.get(a)
    gb = water_geom.get(b) or land_geom.get(b)
    ca = ga.representative_point() if a not in field_center else Point(*field_center[a])
    cb = gb.representative_point() if b not in field_center else Point(*field_center[b])
    bx = unwrap(ca.x, cb.x)
    wrapped = bx != cb.x
    if not wrapped:
        pa = edge_point(ga, (cb.x, cb.y), a)
        pb = edge_point(gb, (ca.x, ca.y), b)
        if kind == 'strait':  # über die Meerenge: kürzeste Verbindung der beiden Gebiete
            q1, q2 = nearest_points(ga, gb)
            pa, pb = (q1.x, q1.y), (q2.x, q2.y)
        r = {'a': a, 'b': b, 'kind': kind, 'pts': [rpt(pa), rpt(pb)]}
    else:
        # zwei Teilstücke: a -> Rand und Rand -> b (Ost-West-Übergang)
        y_mid = (ca.y + cb.y) / 2
        edge_a = W if bx > W else 0
        edge_b = 0 if edge_a == W else W
        pa = edge_point(ga, (edge_a, y_mid), a)
        pb = edge_point(gb, (edge_b, y_mid), b)
        r = {'a': a, 'b': b, 'kind': kind, 'wrap': True,
             'pts': [rpt(pa), [edge_a, round(y_mid)]], 'pts2': [[edge_b, round(y_mid)], rpt(pb)]}
    if extra:
        r.update(extra)
    routes.append(r)


for a, b in sorted(EDGES):
    ta, tb = T[a]['type'], T[b]['type']
    if 'moon' in (ta, tb):
        continue
    if ta == 'land' and tb == 'land':
        if (a, b) in borders:
            continue
        add_route(a, b, 'strait')                     # Landpassage über eine Meerenge
    elif ta == 'water' and tb == 'water':
        add_route(a, b, 'colony' if T[a]['region'] == T[b]['region'] else 'water')
    else:
        add_route(a, b, 'coast')
add_route(*EW_LAND, 'strait', {'rev': 2, 'label': 'Landroute'})

# Kontrolle: jede Graphkante (Planet) ist Grenze oder Route
shown = set(borders) | {tuple(sorted((r['a'], r['b']))) for r in routes if not r.get('rev')}
planet_edges = {e for e in EDGES if T[e[0]]['type'] != 'moon' and T[e[1]]['type'] != 'moon'}
assert shown == planet_edges, f'Fehlende/zusätzliche Darstellung: {planet_edges ^ shown}'


# --------------------------------------------------------------- Beschriftungen
def inside_spot(geom, text_w, text_h, points):
    """Innen: Stelle mit größtem Abstand zu den Einheitenmarkern (Gebietsmittelpunkten)"""
    best = None
    minx, miny, maxx, maxy = geom.bounds
    for x in range(int(minx), int(maxx), 8):
        for y in range(int(miny), int(maxy), 8):
            bx = box(x - text_w / 2, y - text_h / 2, x + text_w / 2, y + text_h / 2)
            if not geom.contains(bx):
                continue
            d = min((bx.distance(Point(*p)) for p in points), default=999)
            if best is None or d > best[0]:
                best = (d, x, y)
    return [best[1], best[2]] if best else None


def place_label(geom, text_w, text_h, avoid, prefer='above', others=None, points=(), inside_first=False):
    if inside_first:
        spot = inside_spot(geom, text_w, text_h, points)
        if spot:
            return spot, 'inside'
    """Beschriftung außerhalb der Fläche (ober-/unterhalb, links/rechts), sonst innen"""
    minx, miny, maxx, maxy = geom.bounds
    cx, cy = (minx + maxx) / 2, (miny + maxy) / 2
    vert = [miny - text_h * 0.9, maxy + text_h * 0.9]
    if prefer != 'above':
        vert.reverse()
    cands = [(cx + dx, y) for y in vert for dx in (0, -60, 60, -120, 120, -200, 200, -260, 260)]
    cands += [(minx - text_w / 2 - 12, cy + dy) for dy in (0, -50, 50)] + [(maxx + text_w / 2 + 12, cy + dy) for dy in (0, -50, 50)]
    for x, y in cands:
        bx = box(x - text_w / 2, y - text_h / 2, x + text_w / 2, y + text_h / 2)
        if 6 < bx.bounds[1] and bx.bounds[3] < H - 6 and 4 < bx.bounds[0] and bx.bounds[2] < W - 4 and not bx.intersects(avoid):
            d_own = bx.distance(geom)
            if d_own > 45 or (others is not None and bx.distance(others) <= d_own + 25):
                continue  # zu weit weg oder näher an einer anderen Region -> mehrdeutig
            return [round(x), round(y)], 'outside'
    spot = inside_spot(geom, text_w, text_h, points)
    if spot:
        return spot, 'inside'
    p = polylabel(largest(geom), 2)
    return [round(p.x), round(p.y)], 'inside'


WATER_ALL = unary_union(list(water_geom.values()))
regions_out = {}
ROUTE_LINES = unary_union([LineString(seg) for r in routes if r['kind'] in ('strait', 'colony') for seg in [r['pts']] + ([r['pts2']] if r.get('pts2') else [])]).buffer(5)
avoid = LAND_ALL.buffer(8).union(WATER_ALL.buffer(14)).union(ROUTE_LINES)
taken = []
for cid in colonies:
    (cx, cy), rad = placed[cid]
    g = unary_union([water_geom[m] for m in members[cid]])
    text = f"{REG[cid]['name']} +{REG[cid]['bonus']}"
    halo = MultiPoint([Point(*field_center[m]) for m in members[cid]]).convex_hull.buffer(FIELD_R + 12)
    pos, mode = place_label(halo, 13 * len(text) + 24, 32, LAND_ALL.buffer(4).union(ROUTE_LINES).union(unary_union(taken)), prefer='below')
    taken.append(box(pos[0] - 7 * len(text) - 12, pos[1] - 16, pos[0] + 7 * len(text) + 12, pos[1] + 16))
    regions_out[cid] = {'outline': P(halo.simplify(1.0)), 'color': REGION_COLORS[cid], 'label': pos, 'labelMode': mode}

for c in continents:
    g = cont_shape[c['id']]
    text = f"{c['name']} +{c['bonus']}"
    others = unary_union([cont_shape[o['id']] for o in continents if o['id'] != c['id']])
    pts = [label_of(land_geom[i]) for i, t in T.items() if t['region'] == c['id']]
    pos, mode = place_label(g, 16 * len(text) + 30, 40, avoid.union(unary_union(taken)) if taken else avoid, others=others,
                            points=pts, inside_first=g.area > 120000)
    taken.append(box(pos[0] - 8 * len(text) - 15, pos[1] - 20, pos[0] + 8 * len(text) + 15, pos[1] + 20))
    regions_out[c['id']] = {'outline': P(g.simplify(1.0)), 'color': REGION_COLORS[c['id']], 'label': pos, 'labelMode': mode}

# =========================================================================== Mond
moon_geom = {t['id']: t['geom'] for t in moon_t}
for t in moon_t:
    assert t['id'] in T and T[t['id']]['region'] == t['region']
moon_borders = set()
mids = sorted(moon_geom)
for i, a in enumerate(mids):
    for b in mids[i + 1:]:
        if moon_geom[a].buffer(0.8).intersection(moon_geom[b].buffer(0.8)).length > 4:
            pair = (a, b)
            assert pair in EDGES, f'Mond: neue Nachbarschaft {pair}'
            moon_borders.add(pair)
moon_edges = {e for e in EDGES if T[e[0]]['type'] == 'moon' and T[e[1]]['type'] == 'moon'}
assert moon_borders == moon_edges, f'Mond-Grenzen weichen vom Graphen ab: {moon_borders ^ moon_edges}'

MCX, MCY = MW / 2, MH / 2
moon_regions = [r for r in REG.values() if r['kind'] == 'lunarColony']
for r in moon_regions:
    g = unary_union([moon_geom[i].buffer(0.6) for i in moon_geom if T[i]['region'] == r['id']]).buffer(-0.6)
    gp = g.representative_point()
    ang = math.atan2(gp.y - MCY, gp.x - MCX)
    # Beschriftung im Weltraum außerhalb der Mondscheibe: oben/unten mittig oder in der passenden Ecke
    if abs(math.cos(ang)) < 0.35:
        lx, ly = MCX, (28 if math.sin(ang) < 0 else MH - 28)
    else:
        lx = MCX + math.copysign(MW / 2 - 150, math.cos(ang))
        ly = MCY + math.copysign(MH / 2 - 38, math.sin(ang))
    regions_out[r['id']] = {'outline': P(g.simplify(1.0)), 'color': REGION_COLORS[r['id']], 'label': [round(lx), round(ly)], 'labelMode': 'outside'}

# Landeplatz-Marker: im Gebiet verankert, möglichst weit weg vom Einheitenmarker
LANDING_SHORT = {'HOC-1': 'Alpha', 'TEN-1': 'Beta', 'POL-1': 'Gamma'}
moon_marker = {}
for tid, g in moon_geom.items():
    if not T[tid].get('landingSite'):
        continue
    lab = Point(*label_of(g))
    inner = g.buffer(-26)
    best = None
    minx, miny, maxx, maxy = inner.bounds
    for x in range(int(minx), int(maxx) + 1, 4):
        for y in range(int(miny), int(maxy) + 1, 4):
            p = Point(x, y)
            if inner.contains(p):
                d = p.distance(lab)
                if 62 <= d <= 120:
                    score = math.hypot(x - MCX, y - MCY) - abs(d - 80)  # Richtung Rand, nah am Gebietszentrum
                    if best is None or score > best[0]:
                        best = (score, x, y)
    assert best, f'Kein Platz für Landeplatz-Marker in {tid}'
    moon_marker[tid] = [best[1], best[2]]

# =========================================================================== Ausgabe
geometry = {
    'schema': 'geometry/v2',
    'boards': {'planet': {'width': W, 'height': H}, 'moon': {'width': MW, 'height': MH, 'radius': MR, 'cx': MCX, 'cy': MCY}},
    'territories': {},
    'regions': regions_out,
    'routes': routes,
    'borders': sorted([list(b) for b in borders | moon_borders]),
    'landShadow': P(LAND_ALL.buffer(9).simplify(1.5)),
    'landingShort': LANDING_SHORT,
}
for tid, g in land_geom.items():
    geometry['territories'][tid] = {'d': P(g), 'label': label_of(g)}
for tid, g in water_geom.items():
    c = field_center[tid]
    geometry['territories'][tid] = {'d': P(g), 'label': [round(c[0]), round(c[1])], 'hit': P(water_hit[tid])}
for tid, g in moon_geom.items():
    geometry['territories'][tid] = {'d': P(g.simplify(0.6, preserve_topology=True)), 'label': label_of(g)}
    if tid in moon_marker:
        geometry['territories'][tid]['marker'] = moon_marker[tid]
assert set(geometry['territories']) == set(T), 'Geometrie und Gebietsliste weichen ab'

for d in OUT_DIRS:
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, 'geometry.json'), 'w', encoding='utf-8') as f:
        json.dump(geometry, f, ensure_ascii=False, separators=(',', ':'))

kinds = defaultdict(int)
for r in routes:
    kinds[r['kind'] + (' (Rev. 2)' if r.get('rev') else '')] += 1
print('Gebiete:', len(geometry['territories']), '| Grenzen:', len(geometry['borders']), '| Routen:', dict(kinds))
print('Kolonien:', {c: [round(v) for v in placed[c][0]] for c in colonies})
print('Regionsbeschriftungen:', {k: (v['label'], v['labelMode']) for k, v in regions_out.items()})
