#!/usr/bin/env python3
"""
Kartenrevision 3 „Erde & Mond" (mapId kepler-earth-3): Spielgraph UND Darstellung.

Erde
* Küsten und Ländergrenzen: Natural Earth 1:50 Mio. (gemeinfrei), exportiert mit export_countries.mjs
* Projektion: Miller-Zylinder (84°N … 58°S), Kartenrand in der Beringstraße (169°W), Europa-Band
  horizontal leicht gedehnt (Faktor EUROPE_STRETCH), damit sieben europäische Gebiete am Handy bedienbar bleiben
* EIGENE Aufteilung in 42 Landgebiete: ganze Länder bzw. Länderteile (Voronoi-Teilung großer Staaten an
  festen Saatpunkten); Namen, Zuschnitt und Seewege sind Kepler-eigene Festlegungen
* Nachbarschaft = gemeinsame Landgrenze bzw. Meerenge < STRAIT_PX (aus der Geometrie berechnet)
  + wenige explizite Seewege (SEA_LANES) + Ost-West-Übergang Beringia <-> Fernost über den Kartenrand
* 13 Wasserfelder in 5 Unterwasserkolonien an festen Meerespositionen, Kopplung an 1–3 Küsten je Feld

Mond
* NASA/GSFC/Arizona State University, LROC WAC Nearside-Mosaik (gemeinfrei), orthographisch
* 14 Gebiete an realen Mondformationen (sphärisches Voronoi auf der Mondkugel), 3 Kolonien,
  Landeplätze an Apollo-Landestellen

Ausgabe: content/board/map.json, content/board/geometry.json, src/client/public/board/moon.jpg,
         docs/assets/board/geometry.json
Aufruf:  node tools/board-generator/export_countries.mjs /tmp/countries.geojson
         python3 tools/board-generator/earth_board.py /tmp/countries.geojson <moon-nasa.jpg>
Abhängigkeiten: numpy, shapely>=2, pillow
"""
import json
import math
import os
import sys
from collections import defaultdict

import numpy as np
from PIL import Image
from shapely.geometry import shape, Polygon, MultiPolygon, Point, box, LineString
from shapely.ops import unary_union, nearest_points, polylabel
from shapely import voronoi_polygons, MultiPoint, make_valid

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
MAP_ID = 'kepler-earth-3'
W, H = 2000, 1000
MW, MH, MR = 1000, 1000, 440
L0 = -169.0                 # Kartenrand (Längengrad) in der Beringstraße
EUROPE = (-14.0, 42.0)      # gedehntes Längenband
EUROPE_STRETCH = 1.3
LAT_TOP = 84.0
STRAIT_PX = 7.0             # Abstand, bis zu dem zwei Landgebiete als benachbart gelten (Meerenge)
MIN_PIECE = 10.0            # kleinere Inseln (px²) entfallen
FIELD_R = 30                # Radius eines Wasserfeldes
PROBLEMS = []               # Layoutprobleme (Abbruch am Ende, außer ENTWURF=1)

# ------------------------------------------------------------------ Inhalte (Kepler-eigene Festlegungen)
REGIONS = [
    # id, Name, Art, Bonus
    ('BOR', 'Nordamerika', 'continent', 4), ('VEL', 'Europa', 'continent', 4), ('KAS', 'Asien', 'continent', 6),
    ('MER', 'Südamerika', 'continent', 3), ('SAH', 'Afrika', 'continent', 3), ('INS', 'Ozeanien', 'continent', 2),
    ('NOR', 'Nordmeer', 'waterColony', 2), ('PEL', 'Pelagia', 'waterColony', 2), ('ABY', 'Abyssos', 'waterColony', 2),
    ('KOR', 'Korallensee', 'waterColony', 2), ('SUD', 'Südmeer', 'waterColony', 2),
    ('HOC', 'Selene-Hochland', 'lunarColony', 4), ('TEN', 'Mare Tenebris', 'lunarColony', 3), ('POL', 'Polarkappe', 'lunarColony', 2),
]
REGION_COLORS = {
    'BOR': '#c9a23a', 'VEL': '#3f7fc4', 'KAS': '#4f9a4a', 'MER': '#c8642e', 'SAH': '#b8892f', 'INS': '#9b5bb5',
    'NOR': '#7fd3e6', 'PEL': '#4fb0f0', 'ABY': '#6f8cff', 'KOR': '#3fd1b8', 'SUD': '#8fb8ff',
    'HOC': '#e7c873', 'TEN': '#e0786b', 'POL': '#8fd0ff',
}
LAND = {
    'BOR-1': 'Beringia', 'BOR-2': 'Yukon', 'BOR-3': 'Hudson', 'BOR-4': 'Labrador', 'BOR-5': 'Grönland',
    'BOR-6': 'Pazifikküste', 'BOR-7': 'Prärie', 'BOR-8': 'Atlantikküste', 'BOR-9': 'Mittelamerika',
    'VEL-1': 'Britannia', 'VEL-2': 'Skandinavien', 'VEL-3': 'Iberia', 'VEL-4': 'Gallien', 'VEL-5': 'Mitteleuropa',
    'VEL-6': 'Adria', 'VEL-7': 'Osteuropa',
    'KAS-1': 'Westsibirien', 'KAS-2': 'Taimyr', 'KAS-3': 'Jakutien', 'KAS-4': 'Fernost', 'KAS-5': 'Mittelasien',
    'KAS-6': 'Hochasien', 'KAS-7': 'Vorderasien', 'KAS-8': 'Indien', 'KAS-9': 'Ostasien', 'KAS-10': 'Südostasien',
    'MER-1': 'Karibikküste', 'MER-2': 'Anden', 'MER-3': 'Amazonas', 'MER-4': 'Ostbrasilien', 'MER-5': 'Pampa',
    'MER-6': 'Patagonien',
    'SAH-1': 'Maghreb', 'SAH-2': 'Westafrika', 'SAH-3': 'Niltal', 'SAH-4': 'Kongo', 'SAH-5': 'Ostafrika',
    'SAH-6': 'Südafrika',
    'INS-1': 'Inselbogen', 'INS-2': 'Outback', 'INS-3': 'Ostaustralien', 'INS-4': 'Neuseeland',
}
COUNTRY = {}
for tid, names in {
    'BOR-5': ['Greenland'],
    'BOR-9': ['Mexico', 'Guatemala', 'Belize', 'Honduras', 'El Salvador', 'Nicaragua', 'Costa Rica', 'Panama', 'Cuba',
              'Jamaica', 'Haiti', 'Dominican Rep.', 'Bahamas', 'Puerto Rico'],
    'VEL-1': ['United Kingdom', 'Ireland', 'Iceland', 'Isle of Man', 'Faeroe Is.'],
    'VEL-2': ['Norway', 'Sweden', 'Finland', 'Denmark', 'Åland'],
    'VEL-3': ['Spain', 'Portugal', 'Andorra'],
    'VEL-4': ['France', 'Belgium', 'Netherlands', 'Luxembourg', 'Switzerland', 'Monaco', 'Jersey', 'Guernsey'],
    'VEL-5': ['Germany', 'Poland', 'Czechia', 'Austria', 'Slovakia', 'Hungary', 'Liechtenstein', 'Slovenia'],
    'VEL-6': ['Italy', 'San Marino', 'Vatican', 'Malta', 'Croatia', 'Bosnia and Herz.', 'Serbia', 'Montenegro',
              'Kosovo', 'Albania', 'Macedonia', 'Greece', 'Bulgaria', 'Romania'],
    'VEL-7': ['Ukraine', 'Belarus', 'Moldova', 'Estonia', 'Latvia', 'Lithuania'],
    'KAS-5': ['Kazakhstan', 'Uzbekistan', 'Turkmenistan', 'Kyrgyzstan', 'Tajikistan', 'Afghanistan'],
    'KAS-6': ['Mongolia'],
    'KAS-7': ['Turkey', 'Cyprus', 'N. Cyprus', 'Syria', 'Lebanon', 'Israel', 'Palestine', 'Jordan', 'Iraq', 'Iran',
              'Kuwait', 'Saudi Arabia', 'Bahrain', 'Qatar', 'United Arab Emirates', 'Oman', 'Yemen', 'Georgia',
              'Armenia', 'Azerbaijan'],
    'KAS-8': ['India', 'Pakistan', 'Nepal', 'Bhutan', 'Bangladesh', 'Sri Lanka', 'Siachen Glacier'],
    'KAS-9': ['Japan', 'North Korea', 'South Korea', 'Taiwan', 'Hong Kong', 'Macao'],
    'KAS-10': ['Myanmar', 'Thailand', 'Laos', 'Cambodia', 'Vietnam', 'Singapore', 'Philippines'],
    'MER-1': ['Venezuela', 'Colombia', 'Guyana', 'Suriname', 'Trinidad and Tobago'],
    'MER-2': ['Ecuador', 'Peru', 'Bolivia'],
    'MER-5': ['Paraguay', 'Uruguay'],
    'MER-6': ['Chile', 'Falkland Is.'],
    'SAH-1': ['Morocco', 'W. Sahara', 'Algeria', 'Tunisia', 'Libya'],
    'SAH-2': ['Mauritania', 'Mali', 'Senegal', 'Gambia', 'Guinea-Bissau', 'Guinea', 'Sierra Leone', 'Liberia',
              "Côte d'Ivoire", 'Burkina Faso', 'Ghana', 'Togo', 'Benin', 'Niger', 'Nigeria'],
    'SAH-3': ['Egypt', 'Sudan', 'S. Sudan', 'Chad'],
    'SAH-4': ['Cameroon', 'Central African Rep.', 'Eq. Guinea', 'Gabon', 'Congo', 'Dem. Rep. Congo', 'Angola',
              'São Tomé and Principe'],
    'SAH-5': ['Ethiopia', 'Eritrea', 'Djibouti', 'Somalia', 'Somaliland', 'Kenya', 'Uganda', 'Rwanda', 'Burundi',
              'Tanzania'],
    'SAH-6': ['South Africa', 'Namibia', 'Botswana', 'Zimbabwe', 'Zambia', 'Malawi', 'Mozambique', 'Lesotho',
              'eSwatini', 'Madagascar'],
    'INS-1': ['Indonesia', 'Timor-Leste', 'Papua New Guinea', 'Brunei', 'Solomon Is.'],
    'INS-4': ['New Zealand'],
}.items():
    for n in names:
        COUNTRY[n] = tid
# große Staaten: Teilung an Saatpunkten (Länge, Breite)
SPLIT = {
    'United States of America': {'BOR-6': (-119, 41), 'BOR-7': (-100, 42), 'BOR-8': (-81, 37)},
    'Canada': {'BOR-2': (-127, 63), 'BOR-3': (-93, 63), 'BOR-4': (-68, 53), 'BOR-7': (-106, 53), 'BOR-6': (-124, 52)},
    'Russia/EU': {'VEL-7': (40, 56)},
    'Russia': {'KAS-1': (74, 60), 'KAS-2': (98, 69), 'KAS-3': (126, 62), 'KAS-4': (156, 63)},
    'China': {'KAS-6': (87, 37), 'KAS-9': (113, 31)},
    'Brazil': {'MER-3': (-61, -6), 'MER-4': (-44, -13)},
    'Argentina': {'MER-5': (-62, -31), 'MER-6': (-68, -45)},
    'Australia': {'INS-2': (121, -25), 'INS-3': (145, -26)},
    'Malaysia': {'KAS-10': (102, 4), 'INS-1': (114, 3)},
}
# Seewege zwischen Landgebieten (über größere Wasserflächen); Meerengen < STRAIT_PX ergeben sich aus der Geometrie
SEA_LANES = [('BOR-5', 'VEL-1'), ('INS-1', 'INS-2'), ('INS-1', 'INS-3'), ('INS-3', 'INS-4'), ('KAS-10', 'INS-1')]
WRAP_LAND = [('BOR-1', 'KAS-4')]   # Beringstraße über den Kartenrand (Ost-West-Landroute)

# Wasserfelder: Position (Länge, Breite), Name, Küsten
WATER = {
    'NOR-1': ((-33, 61), 'Irmingersee', ['BOR-5', 'BOR-4']),
    'NOR-2': ((-6, 69), 'Jan-Mayen-Rücken', ['VEL-1']),
    'NOR-3': ((10, 72), 'Barentsschwelle', ['VEL-2', 'VEL-7']),
    'PEL-1': ((-160, 32), 'Kuroshio-Drift', ['KAS-9']),
    'PEL-2': ((-150, 49), 'Aleutenrinne', ['BOR-1', 'BOR-6']),
    'PEL-3': ((-132, 23), 'Clarion-Graben', ['BOR-9']),
    'ABY-1': ((-50, 35), 'Sargasso-Tiefe', ['BOR-8']),
    'ABY-2': ((-32, 23), 'Atlantis-Schwelle', ['VEL-3', 'SAH-2']),
    'ABY-3': ((-35, 8), 'Romanche-Bruch', ['MER-1', 'MER-4']),
    'KOR-1': ((156, -16), 'Riffbank', ['INS-1', 'INS-3']),
    'KOR-2': ((162, -34), 'Tasmanbecken', ['INS-4', 'INS-3']),
    'SUD-1': ((57, -24), 'Maskarenen-Rücken', ['SAH-6', 'SAH-5']),
    'SUD-2': ((86, -9), 'Südstrom', ['KAS-8', 'INS-2']),
}
WATER_LINKS = [('NOR-1', 'NOR-2'), ('NOR-2', 'NOR-3'), ('PEL-1', 'PEL-2'), ('PEL-2', 'PEL-3'),
               ('ABY-1', 'ABY-2'), ('ABY-2', 'ABY-3'), ('KOR-1', 'KOR-2'), ('SUD-1', 'SUD-2'),
               # zwischen Kolonien (Meeresströmungen)
               ('NOR-1', 'ABY-1'), ('ABY-3', 'SUD-1'), ('KOR-1', 'PEL-3')]
# Linienführung um Kontinente herum (Wegpunkte Länge/Breite)
VIA = {('ABY-3', 'SUD-1'): [(-5, -30), (22, -41)]}

# Mond: Gebiet -> (Name, selenographische Breite, Länge); Landeplätze an Apollo-Landestellen
MOON = {
    'HOC-1': ('Tranquillitatis', 1, 24), 'HOC-2': ('Mare Crisium', 17, 59), 'HOC-3': ('Mare Nectaris', -15, 34),
    'HOC-4': ('Ptolemaeus', -10, -3), 'HOC-5': ('Tycho', -42, -12), 'HOC-6': ('Clavius', -63, 8),
    'TEN-1': ('Kopernikus', 8, -22), 'TEN-2': ('Kepler-Krater', 10, -44), 'TEN-3': ('Aristarchus', 26, -56),
    'TEN-4': ('Mare Humorum', -24, -42),
    'POL-1': ('Hadley-Rille', 25, 4), 'POL-2': ('Mare Imbrium', 40, -22), 'POL-3': ('Mare Frigoris', 60, -2),
    'POL-4': ('Mare Serenitatis', 29, 22),
}
LANDING = {'HOC-1': 'Alpha', 'TEN-1': 'Beta', 'POL-1': 'Gamma'}
LANDING_NOTE = {'HOC-1': 'Apollo 11', 'TEN-1': 'Apollo 12', 'POL-1': 'Apollo 15'}
MOON_TEX = {'cx': 639.5, 'cy': 640.0, 'r': 641.5}   # Scheibe im NASA-Mosaik (gemessen)


# ------------------------------------------------------------------ Projektion
def _span(a, b):
    lo, hi = max(a, EUROPE[0]), min(b, EUROPE[1])
    return (b - a) + (EUROPE_STRETCH - 1) * max(0.0, hi - lo)


TOTAL = _span(L0, L0 + 360)
KX = W / TOTAL                      # px je (ungedehntem) Längengrad
K = KX * 180 / math.pi              # px je Radiant (Breite, Miller)


def miller(lat):
    return 1.25 * math.log(math.tan(math.pi / 4 + 0.4 * math.radians(lat)))


Y0 = K * miller(LAT_TOP)


def proj(lon, lat):
    """lon muss bereits im Bereich [L0, L0+360] liegen (Stücke werden vorher als Ganzes verschoben)"""
    return KX * _span(L0, lon), Y0 - K * miller(max(-75, min(85, lat)))


def unproj_x(x):
    lo, hi = L0, L0 + 360
    for _ in range(50):
        m = (lo + hi) / 2
        if KX * _span(L0, m) < x:
            lo = m
        else:
            hi = m
    return lo


def P(geom, nd=0):
    polys = list(geom.geoms) if hasattr(geom, 'geoms') else [geom]
    out = []
    for poly in polys:
        if poly.is_empty:
            continue
        for ring in [poly.exterior, *poly.interiors]:
            pts = list(ring.coords)[:-1]
            out.append('M' + 'L'.join(f'{round(x)},{round(y)}' for x, y in pts) + 'Z')
    return ''.join(out)


def largest(g):
    if hasattr(g, 'geoms'):
        return max(g.geoms, key=lambda x: x.area)
    return g


def rpt(p):
    return [round(p[0]), round(p[1])]


def polys_of(g):
    if g.is_empty:
        return []
    if isinstance(g, Polygon):
        return [g]
    return [p for p in getattr(g, 'geoms', []) if isinstance(p, Polygon)]


# ------------------------------------------------------------------ Erde: Länder -> Gebiete
def load_pieces(path):
    data = json.load(open(path, encoding='utf-8'))
    pieces = []        # (Land, Polygon in lon/lat)
    for f in data['features']:
        name = f['properties']['name']
        g = shape(f['geometry'])
        if name == 'Russia':   # Polygone über die Datumsgrenze: östliche Längen fortlaufend (bis 190°) schreiben
            from shapely.ops import transform as _tr
            g = _tr(lambda x, y, z=None: (np.where(np.asarray(x) < 0, np.asarray(x) + 360, x), y), g)
        for p0 in polys_of(g):
            for p in polys_of(make_valid(p0)) if not p0.is_valid else [p0]:
                pieces.append((name, p))
    out = []
    for name, p in pieces:
        if True:
            if name == 'Russia':
                c = p.centroid
                if p.area > 500:   # Festland am Ural (60°O) teilen
                    for part, nm in ((p.intersection(box(0, -90, 60, 90)), 'Russia/EU'),
                                     (p.intersection(box(60, -90, 360, 90)), 'Russia')):
                        for q in polys_of(part):
                            out.append((nm, q))
                    continue
                out.append(('Russia/EU' if 0 < c.x < 60 else 'Russia', p))
            else:
                out.append((name, p))
    return out


def project_poly(p, shift):
    def tr(coords):
        return [proj(x + shift, y) for x, y in coords]
    p = p.intersection(box(L0 - shift, -90, L0 + 360 - shift, 90))   # nichts über den Kartenrand ziehen
    res = [Polygon(tr(q.exterior.coords), [tr(r.coords) for r in q.interiors]).buffer(0) for q in polys_of(p)]
    return unary_union(res) if res else Polygon()


def assign_pieces(pieces):
    """Liefert {tid: [projizierte Polygone]} und eine Liste verworfener Länder"""
    out = defaultdict(list)
    dropped = defaultdict(float)
    seeds_px = {c: {t: proj(*ll) for t, ll in d.items()} for c, d in SPLIT.items()}
    for name, p in pieces:
        c = p.centroid
        # Lage-Filter: Überseegebiete und abgelegene Inseln entfallen
        if name == 'France' and not (-10 < c.x < 12 and 40 < c.y < 52):
            if -55 < c.x < -50 and 2 < c.y < 6:
                name = 'French Guiana'
            else:
                continue
        if name == 'French Guiana':
            tid_fixed = 'MER-1'
        else:
            tid_fixed = None
        if name == 'United States of America' and (c.y < 24.5 or c.x < L0 or c.x > 0):
            continue                                   # Hawaii, Aleuten westlich der Datumsgrenze
        if name in ('Spain', 'Portugal') and c.x < -10:
            continue                                   # Kanaren, Azoren, Madeira
        if name == 'Ecuador' and c.x < -85:
            continue                                   # Galápagos
        if name == 'Norway' and c.y < 0:
            continue
        if name == 'New Zealand' and (c.x < 0 or c.y < -49):
            continue
        if name == 'Chile' and c.x < -78:
            continue                                   # Juan Fernández, Osterinsel
        if name == 'Australia' and c.x > 155:
            continue                                   # Lord Howe, Norfolk
        shift = 0
        q = project_poly(p, shift)
        if q.is_empty or q.area < MIN_PIECE:
            dropped[name] += q.area
            continue
        if name == 'United States of America' and c.x < -140:
            out['BOR-1'].append(q)                     # Alaska
            continue
        if tid_fixed:
            out[tid_fixed].append(q)
            continue
        if name in COUNTRY:
            out[COUNTRY[name]].append(q)
            continue
        if name in SPLIT:
            sp = seeds_px[name]
            inside = [t for t, s in sp.items() if q.contains(Point(*s))]
            if len(inside) == 0:
                t = min(sp, key=lambda t: q.distance(Point(*sp[t])))
                out[t].append(q)
            elif len(inside) == 1 and len(sp) == 1:
                out[inside[0]].append(q)
            else:
                pts = MultiPoint([Point(*sp[t]) for t in sp])
                cells = voronoi_polygons(pts, extend_to=box(-W, -H, 2 * W, 2 * H))
                for t, s in sp.items():
                    cell = next(g for g in cells.geoms if g.contains(Point(*s)))
                    part = q.intersection(cell)
                    for r in polys_of(part):
                        if r.area > 0.5:
                            out[t].append(r)
            continue
        dropped[name] += q.area
    return out, dropped


def build_earth(countries_path):
    pieces = load_pieces(countries_path)
    parts, dropped = assign_pieces(pieces)
    big_drop = {k: round(v) for k, v in dropped.items() if v > 40}
    if big_drop:
        print('Hinweis – verworfene größere Flächen (px²):', big_drop)
    land = {}
    for tid in LAND:
        assert parts.get(tid), f'{tid} hat keine Fläche'
        g = unary_union([p.buffer(0.35, join_style=2) for p in parts[tid]]).buffer(-0.35, join_style=2)
        g = g.simplify(0.7, preserve_topology=True).buffer(0)
        land[tid] = g
    # Überlappungen durch Pufferung bereinigen (Reihenfolge fest)
    ids = list(LAND)
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            if land[a].intersects(land[b]) and land[a].intersection(land[b]).area > 0.01:
                land[b] = land[b].difference(land[a]).buffer(0)
    return land


def wrap_dist(a, b):
    """Abstand zweier Geometrien unter Berücksichtigung des Ost-West-Randes"""
    from shapely.affinity import translate
    return min(a.distance(b), a.distance(translate(b, W, 0)), a.distance(translate(b, -W, 0)))


def earth_graph(land):
    adj = defaultdict(set)
    borders, straits = set(), set()
    ids = sorted(land)
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            if land[a].distance(land[b]) < 2.5:
                borders.add((a, b))
            elif land[a].distance(land[b]) < STRAIT_PX:
                # nur echte Meerengen: die kürzeste Verbindung darf kein drittes Gebiet queren
                q1, q2 = nearest_points(land[a], land[b])
                seg = LineString([q1, q2])
                others = [land[c] for c in ids if c not in (a, b)]
                if not any(seg.distance(o) < 0.8 for o in others):
                    straits.add((a, b))
    for a, b in SEA_LANES:
        straits.add(tuple(sorted((a, b))))
    for a, b in WRAP_LAND:
        straits.add(tuple(sorted((a, b))))
    for a, b in borders | straits:
        adj[a].add(b)
        adj[b].add(a)
    return adj, borders, straits


# ------------------------------------------------------------------ Mond
def sph(lat, lon):
    la, lo = math.radians(lat), math.radians(lon)
    return np.array([math.cos(la) * math.sin(lo), -math.sin(la), math.cos(la) * math.cos(lo)])


def build_moon():
    """Sphärisches Voronoi der Formationen (exakte Großkreis-Grenzen), orthographisch projiziert"""
    from scipy.spatial import SphericalVoronoi
    cx, cy = MW / 2, MH / 2
    ids = list(MOON)
    S = np.array([sph(v[1], v[2]) for v in MOON.values()])
    # Hilfspunkte auf der Rückseite, damit jede Zelle beschränkt bleibt
    back = np.array([[0, 0, -1], [1, 0, -0.2], [-1, 0, -0.2], [0, 1, -0.2], [0, -1, -0.2]], float)
    back /= np.linalg.norm(back, axis=1)[:, None]
    pts = np.vstack([S, back])
    sv = SphericalVoronoi(pts, radius=1, center=np.zeros(3))
    sv.sort_vertices_of_regions()

    def to2d(v):
        x, y, z = v
        if z < 0:                      # hinter dem Rand: auf den Rand legen
            n = math.hypot(x, y) or 1
            x, y = x / n, y / n
        return (cx + x * MR, cy + y * MR)

    disk = Point(cx, cy).buffer(MR, resolution=180)
    geoms = {}
    for i, tid in enumerate(ids):
        verts = sv.vertices[sv.regions[i]]
        ring = []
        for k in range(len(verts)):
            a_, b_ = verts[k], verts[(k + 1) % len(verts)]
            om = math.acos(max(-1, min(1, float(np.dot(a_, b_)))))
            n = max(2, int(om / math.radians(1.0)))
            for j in range(n):
                t = j / n
                if om < 1e-9:
                    v = a_
                else:
                    v = (math.sin((1 - t) * om) * a_ + math.sin(t * om) * b_) / math.sin(om)
                ring.append(to2d(v))
        g = Polygon(ring).buffer(0).intersection(disk)
        geoms[tid] = largest(g)
    adj = defaultdict(set)
    borders = set()
    for i, a_ in enumerate(ids):
        for b_ in ids[i + 1:]:
            if geoms[a_].buffer(0.5).intersection(geoms[b_].buffer(0.5)).length > 8:
                adj[a_].add(b_)
                adj[b_].add(a_)
                borders.add(tuple(sorted((a_, b_))))
    return geoms, adj, borders


def moon_texture(src, dst, size=1000):
    """NASA-Mosaik so beschneiden/skalieren, dass die Mondscheibe genau (500,500,r=440) entspricht"""
    im = Image.open(src).convert('L')
    s = MOON_TEX['r'] / MR
    left, top = MOON_TEX['cx'] - (MW / 2) * s, MOON_TEX['cy'] - (MH / 2) * s
    crop = im.transform((size, size), Image.AFFINE, (s * MW / size, 0, left, 0, s * MH / size, top),
                        resample=Image.BICUBIC, fillcolor=0)
    a = np.asarray(crop).astype(np.float32)
    yy, xx = np.mgrid[0:size, 0:size]
    d = np.hypot(xx + 0.5 - size / 2, yy + 0.5 - size / 2) / (MR * size / MW)
    mask = np.clip((1.0 - d) * 220, 0, 1)
    a = a * mask
    Image.fromarray(a.astype(np.uint8)).save(dst, quality=82, optimize=True, progressive=True)


# ------------------------------------------------------------------ Hauptprogramm
def main(countries_path, moon_src):
    land = build_earth(countries_path)
    adj, land_borders, straits = earth_graph(land)
    LAND_ALL = unary_union(list(land.values()))

    # Wasserfelder
    field_center = {w: proj(*v[0]) for w, v in WATER.items()}
    water_geom = {w: Point(*c).buffer(FIELD_R, resolution=16) for w, c in field_center.items()}
    for w, g in water_geom.items():
        d = g.distance(LAND_ALL)
        if d <= 6:
            PROBLEMS.append(f'Wasserfeld {w} liegt zu nah am Land ({d:.1f}px)')
        for v, h in water_geom.items():
            if w < v:
                if g.distance(h) <= 8:
                    PROBLEMS.append(f'Wasserfelder {w}/{v} berühren sich')
    for w, (_, _, coasts) in WATER.items():
        for t in coasts:
            adj[w].add(t)
            adj[t].add(w)
    for a, b in WATER_LINKS:
        adj[a].add(b)
        adj[b].add(a)

    moon_geom, moon_adj, moon_borders = build_moon()
    for a, ns in moon_adj.items():
        adj[a] |= ns

    # Zusammenhang prüfen
    allids = list(LAND) + list(WATER) + list(MOON)
    seen, stack = {allids[0]}, [allids[0]]
    planet = set(LAND) | set(WATER)
    while stack:
        cur = stack.pop()
        for n in adj[cur]:
            if n not in seen and n in planet:
                seen.add(n)
                stack.append(n)
    assert seen == planet, f'Planet nicht zusammenhängend: {planet - seen}'
    for reg in ('HOC', 'TEN', 'POL'):
        mem = [m for m in MOON if m.startswith(reg)]
        seen, stack = {mem[0]}, [mem[0]]
        while stack:
            cur = stack.pop()
            for n in adj[cur]:
                if n not in seen and n in mem:
                    seen.add(n)
                    stack.append(n)
        assert seen == set(mem), f'Mondkolonie {reg} nicht zusammenhängend'
    for c in ('BOR', 'VEL', 'KAS', 'MER', 'SAH', 'INS'):
        mem = [m for m in LAND if m.startswith(c + '-')]
        seen, stack = {mem[0]}, [mem[0]]
        while stack:
            cur = stack.pop()
            for n in adj[cur]:
                if n not in seen and n in mem:
                    seen.add(n)
                    stack.append(n)
        assert seen == set(mem), f'Kontinent {c} nicht zusammenhängend: {set(mem) - seen}'

    # ---------------------------------------------------------- map.json
    reg_of = lambda t: t.split('-')[0]
    def label_of(g):
        p = polylabel(largest(g), tolerance=1.0)
        return [round(p.x), round(p.y)]

    territories = []
    for tid, name in LAND.items():
        territories.append({'id': tid, 'name': name, 'type': 'land', 'region': reg_of(tid), 'board': 'planet',
                            'label': label_of(land[tid]), 'adjacent': sorted(adj[tid])})
    for w, (_, name, _) in WATER.items():
        territories.append({'id': w, 'name': name, 'type': 'water', 'region': reg_of(w), 'board': 'planet',
                            'label': rpt(field_center[w]), 'adjacent': sorted(adj[w])})
    for m, (name, _, _) in MOON.items():
        t = {'id': m, 'name': name, 'type': 'moon', 'region': reg_of(m), 'board': 'moon',
             'label': label_of(moon_geom[m]), 'adjacent': sorted(adj[m])}
        if m in LANDING:
            t['landingSite'] = True
            t['landingName'] = f'Landeplatz {LANDING[m]} ({LANDING_NOTE[m]})'
        territories.append(t)
    regions = []
    for rid, name, kind, bonus in REGIONS:
        mem = [t['id'] for t in territories if t['region'] == rid]
        border = sum(1 for m in mem if any(reg_of(n) != rid for n in adj[m]))
        regions.append({'id': rid, 'name': name, 'kind': kind, 'bonus': bonus, 'borderTerritories': border})
    for t in territories:   # Symmetrie
        for n in t['adjacent']:
            assert t['id'] in adj[n], f'asymmetrisch {t["id"]}-{n}'
    mapdef = {
        'schema': 'map/v1', 'id': MAP_ID, 'name': 'Kepler-Kolonien – Erde & Mond',
        'generator': {'script': 'tools/board-generator/earth_board.py',
                      'sources': ['Natural Earth 1:50m (public domain) via world-atlas@2',
                                  'NASA/GSFC/Arizona State University LROC WAC nearside mosaic (public domain)']},
        'boards': [{'id': 'planet', 'width': W, 'height': H, 'svg': 'planet.svg', 'wrapX': True},
                   {'id': 'moon', 'width': MW, 'height': MH, 'svg': 'moon.svg', 'texture': 'board/moon.jpg'}],
        'regions': regions, 'territories': territories,
        'seaLanes': [list(p) for p in sorted(straits) if p not in {tuple(sorted(x)) for x in WRAP_LAND}],
        'wrapLinks': [],   # wird nach dem Routenaufbau gefüllt
        'specialLinks': [{'kind': 'orbital', 'from': 'anySpaceStation', 'to': 'landingSites', 'requires': 'spaceCommanderInPlay'}],
    }

    # ---------------------------------------------------------- Routen
    routes = []
    coastline = {}
    for i, g in land.items():
        others = unary_union([h.buffer(2.0) for j, h in land.items() if j != i])
        c = g.boundary.difference(others)
        coastline[i] = c if not c.is_empty and c.length > 6 else g.boundary

    def geom_of(t):
        return water_geom.get(t) or land.get(t)

    def center_of(t):
        if t in field_center:
            return Point(*field_center[t])
        return Point(*label_of(land[t]))

    def edge_point(t, toward):
        line = coastline[t] if t in coastline else geom_of(t).boundary
        p1, _ = nearest_points(line, Point(*toward))
        return (p1.x, p1.y)

    def ring_edge(c, toward):
        dx, dy = toward[0] - c[0], toward[1] - c[1]
        n = math.hypot(dx, dy) or 1
        return (c[0] + dx / n * (FIELD_R + 1), c[1] + dy / n * (FIELD_R + 1))

    def add_route(a, b, kind, wrap=False):
        ga, gb = geom_of(a), geom_of(b)
        ca, cb = center_of(a), center_of(b)
        via = [proj(*v) for v in VIA.get((a, b), [])]
        if not wrap:
            ta, tb = (via[0] if via else (cb.x, cb.y)), (via[-1] if via else (ca.x, ca.y))
            if not via and (kind == 'strait' or (a in land and b in land)):
                q1, q2 = nearest_points(ga, gb)
                pa, pb = (q1.x, q1.y), (q2.x, q2.y)
            else:
                pa = field_center[a] if a in field_center else edge_point(a, ta)
                pb = field_center[b] if b in field_center else edge_point(b, tb)
            line = [pa, *via, pb]
            if a in field_center:
                line[0] = ring_edge(line[0], line[1])
            if b in field_center:
                line[-1] = ring_edge(line[-1], line[-2])
            routes.append({'a': a, 'b': b, 'kind': kind, 'pts': [rpt(v) for v in line]})
        else:
            # a liegt links (x klein), b rechts; Teilstücke zum jeweiligen Rand
            if ca.x > cb.x:
                a, b, ga, gb, ca, cb = b, a, gb, ga, cb, ca
            from shapely.affinity import translate
            gb_l = translate(gb, -W, 0)
            if a in field_center or b in field_center:
                pa = field_center.get(a) or edge_point(a, (cb.x - W, cb.y))
                pb = field_center.get(b) or edge_point(b, (ca.x + W, ca.y))
                if a in field_center:
                    pa = ring_edge(pa, (pb[0] - W, pb[1]))
                if b in field_center:
                    pb = ring_edge(pb, (pa[0] + W, pa[1]))
            else:
                q1, q2 = nearest_points(ga, gb_l)
                pa, pb = (q1.x, q1.y), (q2.x + W, q2.y)
            # Schnitt mit dem Rand: lineare Interpolation zwischen pa und (pb - W)
            x1, y1 = pa
            x2, y2 = pb[0] - W, pb[1]
            t = (0 - x1) / (x2 - x1) if x2 != x1 else 0.5
            ym = y1 + (y2 - y1) * t
            routes.append({'a': a, 'b': b, 'kind': kind, 'wrap': True,
                           'pts': [rpt(pa), [0, round(ym)]], 'pts2': [[W, round(ym)], rpt(pb)]})

    wrapset = {tuple(sorted(p)) for p in WRAP_LAND} | {('KOR-1', 'PEL-3')}
    planet_edges = set()
    for t in territories:
        if t['type'] == 'moon':
            continue
        for n in t['adjacent']:
            if t['id'] < n:
                planet_edges.add((t['id'], n))
    for a, b in sorted(planet_edges):
        if (a, b) in land_borders:
            continue
        ta, tb = a in land, b in land
        wrap = abs(center_of(a).x - center_of(b).x) > W / 2
        if ta and tb:
            add_route(a, b, 'strait', wrap)
        elif not ta and not tb:
            add_route(a, b, 'colony' if reg_of(a) == reg_of(b) else 'water', wrap)
        else:
            add_route(a, b, 'coast', wrap)
    mapdef['wrapLinks'] = sorted([r['a'], r['b']] for r in routes if r.get('wrap'))
    shown = set(land_borders) | {tuple(sorted((r['a'], r['b']))) for r in routes}
    assert shown == planet_edges, f'Darstellung weicht vom Graphen ab: {planet_edges ^ shown}'

    # ---------------------------------------------------------- Regionsumrisse und Beschriftungen
    WATER_ALL = unary_union(list(water_geom.values()))
    ROUTE_LINES = unary_union([LineString(seg) for r in routes for seg in [r['pts']] + ([r['pts2']] if r.get('pts2') else [])]).buffer(5)
    regions_out = {}
    taken = []
    name_boxes = []
    for w, (_, name, _) in WATER.items():
        x, y = field_center[w]
        name_boxes.append(box(x - 4.2 * len(name), y + FIELD_R + 6, x + 4.2 * len(name), y + FIELD_R + 26))
    for t in LAND:
        x, y = label_of(land[t])
        name_boxes.append(box(x - 4.6 * len(LAND[t]), y - 10, x + 4.6 * len(LAND[t]), y + 10))
    NAME_BOXES = unary_union(name_boxes)

    def free_spot(target, tw, th, avoid, maxd=70):
        best = None
        minx, miny, maxx, maxy = target.bounds
        for x in range(int(minx - maxd), int(maxx + maxd), 6):
            for y in range(int(miny - maxd), int(maxy + maxd), 6):
                bx = box(x - tw / 2, y - th / 2, x + tw / 2, y + th / 2)
                if bx.bounds[0] < 4 or bx.bounds[2] > W - 4 or bx.bounds[1] < 4 or bx.bounds[3] > H - 4:
                    continue
                if bx.intersects(avoid):
                    continue
                d = bx.distance(target)
                if d > maxd:
                    continue
                score = d + 0.02 * abs(y - target.centroid.y)
                if best is None or score < best[0]:
                    best = (score, x, y)
        return [best[1], best[2]] if best else None

    for rid, name, kind, bonus in REGIONS:
        if kind == 'lunarColony':
            continue
        text = f'{name} +{bonus}'
        tw, th = (15 * len(text) + 28, 36) if kind == 'continent' else (12 * len(text) + 22, 28)
        if kind == 'continent':
            mem = [t for t in LAND if reg_of(t) == rid]
            g = unary_union([land[t].buffer(1.0) for t in mem]).buffer(-1.0)
            outline = g
        else:
            mem = [w for w in WATER if reg_of(w) == rid]
            outline = MultiPoint([Point(*field_center[m]) for m in mem]).convex_hull.buffer(FIELD_R + 10)
            g = outline
        avoid = LAND_ALL.buffer(5).union(WATER_ALL.buffer(10)).union(ROUTE_LINES).union(NAME_BOXES)
        if taken:
            avoid = avoid.union(unary_union(taken))
        pos = free_spot(largest(g), tw, th, avoid, 60 if kind == 'continent' else 90)
        mode = 'outside'
        if pos is None:
            p = polylabel(largest(g), 2)
            pos, mode = [round(p.x), round(p.y)], 'inside'
        taken.append(box(pos[0] - tw / 2 - 6, pos[1] - th / 2 - 6, pos[0] + tw / 2 + 6, pos[1] + th / 2 + 6))
        regions_out[rid] = {'outline': P(outline.simplify(1.0)), 'color': REGION_COLORS[rid], 'label': pos, 'labelMode': mode}

    MCX, MCY = MW / 2, MH / 2
    for rid in ('HOC', 'TEN', 'POL'):
        g = unary_union([moon_geom[i].buffer(0.6) for i in MOON if reg_of(i) == rid]).buffer(-0.6)
        gp = g.representative_point()
        ang = math.atan2(gp.y - MCY, gp.x - MCX)
        # oben links/rechts liegen im Client Brettumschalter und Zoomknöpfe -> seitliche Kolonien unten beschriften
        if abs(math.cos(ang)) < 0.35 and math.sin(ang) < 0:
            lx, ly = MCX, 28
        else:
            lx = MCX + (0 if abs(math.cos(ang)) < 0.35 else math.copysign(MW / 2 - 150, math.cos(ang)))
            ly = MH - 28
        regions_out[rid] = {'outline': P(g.simplify(1.0)), 'color': REGION_COLORS[rid], 'label': [round(lx), round(ly)], 'labelMode': 'outside'}

    # Trefferflächen der Wasserfelder
    centers = MultiPoint([Point(*c) for c in field_center.values()])
    cells = voronoi_polygons(centers, extend_to=box(-W, -H, 2 * W, 2 * H))
    water_hit = {}
    for m, c in field_center.items():
        cell = next(g for g in cells.geoms if g.contains(Point(*c)))
        hit = cell.intersection(Point(*c).buffer(FIELD_R + 22)).difference(LAND_ALL.buffer(4))
        water_hit[m] = largest(hit).simplify(1.0)

    # kleine Landgebiete: Trefferfläche vergrößern (Inseln wie Britannia/Neuseeland)
    land_hit = {}
    for tid, g in land.items():
        if g.area < 2500 or largest(g).area < 0.6 * g.area:
            others = unary_union([h for j, h in land.items() if j != tid])
            hit = g.buffer(10).difference(others.buffer(2)).difference(WATER_ALL.buffer(4))
            land_hit[tid] = hit.simplify(1.0)

    # Landeplatz-Marker (Mond)
    moon_marker = {}
    for tid in LANDING:
        g = moon_geom[tid]
        lab = Point(*label_of(g))
        name_box = box(lab.x - 5.2 * len(MOON[tid][0]) - 8, lab.y - 13, lab.x + 5.2 * len(MOON[tid][0]) + 8, lab.y + 13)
        inner = g.buffer(-24)
        best = None
        minx, miny, maxx, maxy = inner.bounds
        for x in range(int(minx), int(maxx) + 1, 4):
            for y in range(int(miny), int(maxy) + 1, 4):
                p = Point(x, y)
                if inner.contains(p) and p.buffer(30).disjoint(name_box):
                    d = p.distance(lab)
                    if 75 <= d <= 150:   # Abstand zum Einheitenmarker (und dessen Kommandanten-Chips oben rechts)
                        score = -abs(d - 90) - 0.3 * abs(p.y - lab.y - 20) - (40 if p.x > lab.x and p.y < lab.y else 0)
                        if best is None or score > best[0]:
                            best = (score, x, y)
        assert best, f'Kein Platz für Landeplatz-Marker in {tid}'
        moon_marker[tid] = [best[1], best[2]]

    geometry = {
        'schema': 'geometry/v3',
        'mapId': MAP_ID,
        'boards': {'planet': {'width': W, 'height': H, 'style': 'earth'},
                   'moon': {'width': MW, 'height': MH, 'radius': MR, 'cx': MCX, 'cy': MCY, 'texture': 'board/moon.jpg'}},
        'territories': {},
        'regions': regions_out,
        'routes': routes,
        'borders': sorted([list(b) for b in land_borders | moon_borders]),
        'landShadow': P(LAND_ALL.buffer(4).simplify(1.2)),
        'landingShort': LANDING,
        'graticule': {'lon': [rpt(proj(lon, 0))[0] for lon in range(-150, 181, 30)],
                      'lat': [rpt(proj(0, lat))[1] for lat in range(-45, 76, 15)]},
        'credits': 'Küsten: Natural Earth (gemeinfrei) · Mond: NASA/GSFC/Arizona State University (LROC)',
    }
    for tid, g in land.items():
        geometry['territories'][tid] = {'d': P(g), 'label': label_of(g)}
        if tid in land_hit:
            geometry['territories'][tid]['hit'] = P(land_hit[tid])
    for tid, g in water_geom.items():
        geometry['territories'][tid] = {'d': P(g), 'label': rpt(field_center[tid]), 'hit': P(water_hit[tid])}
    for tid, g in moon_geom.items():
        geometry['territories'][tid] = {'d': P(g), 'label': label_of(g)}
        if tid in moon_marker:
            geometry['territories'][tid]['marker'] = moon_marker[tid]

    os.makedirs(os.path.join(ROOT, 'src', 'client', 'public', 'board'), exist_ok=True)
    moon_texture(moon_src, os.path.join(ROOT, 'src', 'client', 'public', 'board', 'moon.jpg'))
    with open(os.path.join(ROOT, 'content', 'board', 'map.json'), 'w', encoding='utf-8') as f:
        json.dump(mapdef, f, ensure_ascii=False, indent=1)
    for d in (os.path.join(ROOT, 'content', 'board'), os.path.join(ROOT, 'docs', 'assets', 'board')):
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, 'geometry.json'), 'w', encoding='utf-8') as f:
            json.dump(geometry, f, ensure_ascii=False, separators=(',', ':'))

    if PROBLEMS:
        print('LAYOUTPROBLEME:\n  ' + '\n  '.join(PROBLEMS))
        if os.environ.get('ENTWURF') != '1':
            sys.exit(1)
    kinds = defaultdict(int)
    for r in routes:
        kinds[r['kind'] + (' (Rand)' if r.get('wrap') else '')] += 1
    print('Gebiete:', len(territories), '| Landgrenzen:', len(land_borders), '| Mondgrenzen:', len(moon_borders),
          '| Routen:', dict(kinds))
    print('Meerengen/Seewege:', sorted(straits))
    print('Grenzgebiete je Region:', {r['id']: r['borderTerritories'] for r in regions})
    for t in territories:
        if t['type'] == 'land':
            print(f"  {t['id']:6} {t['name']:14} {round(land[t['id']].area):6} px²  -> {', '.join(t['adjacent'])}")


if __name__ == '__main__':
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
