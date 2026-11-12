#!/usr/bin/env python3
"""App-Logo: Erdkugel (orthographisch, Natural Earth, Kontinentfarben der Karte), Orbitring mit Station, Mond.
Aufruf: python3 tools/board-generator/make_icon.py <countries.geojson>   -> src/client/public/icons/icon.svg
PNGs (192/512/maskable/Unraid) rendert tools/board-generator/render_icons.cjs mit Playwright."""
import json, math, os, sys
from shapely.geometry import shape, Polygon, MultiPolygon, Point, box
from shapely.ops import unary_union
from shapely import make_valid

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CX, CY, R = 232, 282, 150
LON0, LAT0 = 20.0, 18.0     # Blickrichtung: Afrika/Europa/Asien
CONT = {  # Länder -> Farbe (Kontinentfarben der Erdkarte)
    '#3f7fc4': ['Germany', 'France', 'Spain', 'Italy', 'Poland', 'Ukraine', 'Sweden', 'Norway', 'Finland', 'United Kingdom', 'Romania', 'Belarus', 'Greece', 'Portugal', 'Austria', 'Czechia', 'Hungary', 'Bulgaria', 'Serbia', 'Ireland', 'Iceland', 'Denmark', 'Lithuania', 'Latvia', 'Estonia', 'Slovakia', 'Croatia', 'Bosnia and Herz.'],
    '#4f9a4a': ['China', 'India', 'Kazakhstan', 'Mongolia', 'Iran', 'Turkey', 'Saudi Arabia', 'Pakistan', 'Afghanistan', 'Uzbekistan', 'Turkmenistan', 'Iraq', 'Syria', 'Russia', 'Japan', 'Myanmar', 'Thailand', 'Vietnam', 'Nepal', 'Bangladesh', 'Oman', 'Yemen', 'Jordan', 'Israel', 'Georgia', 'Azerbaijan', 'Armenia', 'Kyrgyzstan', 'Tajikistan', 'Laos', 'Cambodia', 'Sri Lanka', 'N. Korea', 'South Korea', 'North Korea', 'Kuwait', 'United Arab Emirates', 'Qatar', 'Lebanon'],
}
AFR = '#b8892f'


def orth(lon, lat):
    l, p = math.radians(lon - LON0), math.radians(lat)
    p0 = math.radians(LAT0)
    cosc = math.sin(p0) * math.sin(p) + math.cos(p0) * math.cos(p) * math.cos(l)
    if cosc < 0:
        return None
    x = math.cos(p) * math.sin(l)
    y = math.cos(p0) * math.sin(p) - math.sin(p0) * math.cos(p) * math.cos(l)
    return CX + R * x, CY - R * y


def poly_path(poly):
    out = []
    for ring in [poly.exterior, *poly.interiors]:
        pts = []
        for lon, lat in ring.coords:
            q = orth(lon, lat)
            if q:
                pts.append(q)
        if len(pts) >= 3:
            out.append('M' + 'L'.join(f'{x:.1f},{y:.1f}' for x, y in pts) + 'Z')
    return ''.join(out)


def main(path):
    data = json.load(open(path, encoding='utf-8'))
    view = box(LON0 - 95, -90, LON0 + 95, 90)
    paths = []
    for f in data['features']:
        name = f['properties']['name']
        if name == 'Antarctica':
            continue
        col = next((c for c, names in CONT.items() if name in names), None)
        g = make_valid(shape(f['geometry']))
        if not col:
            c = g.centroid
            if -20 < c.x < 52 and -36 < c.y < 36 and name not in ('Madagascar',):
                col = AFR
            elif -90 < c.x < -30 and c.y < 14:
                col = '#c8642e'
            elif -170 < c.x < -50 and c.y > 7:
                col = '#c9a23a'
            elif 95 < c.x < 180 and c.y < -5:
                col = '#9b5bb5'
            else:
                col = '#4f9a4a'
        geoms = [x for x in (g.geoms if hasattr(g, 'geoms') else [g]) if isinstance(x, Polygon)]
        for p in geoms:
            q = p.simplify(0.35, preserve_topology=True).intersection(view)
            for pp in (list(q.geoms) if hasattr(q, 'geoms') else [q]):
                if isinstance(pp, Polygon) and not pp.is_empty and pp.area > 0.6:
                    d = poly_path(pp)
                    if d:
                        paths.append((col, d))
    land = ''.join(f'<path d="{d}" fill="{c}"/>' for c, d in paths)
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="sky" cx="50%" cy="38%" r="80%"><stop offset="0" stop-color="#20457f"/><stop offset="0.6" stop-color="#101f45"/><stop offset="1" stop-color="#070c1c"/></radialGradient>
    <radialGradient id="sea" cx="36%" cy="30%" r="80%"><stop offset="0" stop-color="#4fb0ff"/><stop offset="0.55" stop-color="#1c5fb0"/><stop offset="1" stop-color="#0d2a5c"/></radialGradient>
    <radialGradient id="shade" cx="34%" cy="30%" r="78%"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#020611" stop-opacity="0.72"/></radialGradient>
    <radialGradient id="moon" cx="36%" cy="32%" r="75%"><stop offset="0" stop-color="#f2f2f8"/><stop offset="1" stop-color="#9a9db4"/></radialGradient>
    <clipPath id="globe"><circle cx="{CX}" cy="{CY}" r="{R}"/></clipPath>
    <linearGradient id="ring" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fde047" stop-opacity="0.15"/><stop offset="0.5" stop-color="#fde047"/><stop offset="1" stop-color="#fde047" stop-opacity="0.9"/></linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#sky)"/>
  <g fill="#fff" opacity="0.8"><circle cx="84" cy="96" r="3"/><circle cx="430" cy="74" r="2.4"/><circle cx="462" cy="226" r="2"/><circle cx="64" cy="446" r="2.6"/><circle cx="170" cy="58" r="2"/><circle cx="352" cy="468" r="2.2"/><circle cx="470" cy="420" r="1.8"/></g>
  <circle cx="{CX}" cy="{CY}" r="{R + 10}" fill="#4fb0ff" opacity="0.16"/>
  <circle cx="{CX}" cy="{CY}" r="{R}" fill="url(#sea)"/>
  <g clip-path="url(#globe)">{land}
    <g fill="none" stroke="#fff" stroke-opacity="0.12" stroke-width="1.4"><ellipse cx="{CX}" cy="{CY}" rx="{R}" ry="{R*0.35:.0f}"/><ellipse cx="{CX}" cy="{CY}" rx="{R*0.5:.0f}" ry="{R}"/></g>
    <circle cx="{CX}" cy="{CY}" r="{R}" fill="url(#shade)"/>
  </g>
  <circle cx="{CX}" cy="{CY}" r="{R}" fill="none" stroke="#071024" stroke-width="7"/>
  <path d="M40 330 A232 70 -22 0 1 430 214" fill="none" stroke="#071024" stroke-width="15" stroke-linecap="round" opacity="0.5"/>
  <path d="M40 330 A232 70 -22 0 1 430 214" fill="none" stroke="url(#ring)" stroke-width="8" stroke-linecap="round" stroke-dasharray="1 0"/>
  <g transform="translate(112 285) rotate(-28)">
    <rect x="-10" y="-5" width="20" height="10" rx="3" fill="#e2f4ff" stroke="#071024" stroke-width="3"/>
    <rect x="-34" y="-7" width="20" height="14" rx="2" fill="#38bdf8" stroke="#071024" stroke-width="3"/>
    <rect x="14" y="-7" width="20" height="14" rx="2" fill="#38bdf8" stroke="#071024" stroke-width="3"/>
  </g>
  <circle cx="414" cy="132" r="52" fill="url(#moon)" stroke="#071024" stroke-width="7"/>
  <g fill="#8a8ea6" opacity="0.85"><circle cx="398" cy="118" r="11"/><circle cx="430" cy="150" r="8"/><circle cx="440" cy="112" r="6"/><circle cx="402" cy="152" r="5"/></g>
  <path d="M414 82 l7 20 h-14 z" fill="#fde047" stroke="#071024" stroke-width="3" transform="translate(0 -2)" opacity="0"/>
</svg>
'''
    out = os.path.join(ROOT, 'src', 'client', 'public', 'icons', 'icon.svg')
    open(out, 'w', encoding='utf-8').write(svg)
    print('geschrieben:', out, len(svg) // 1024, 'KB')


if __name__ == '__main__':
    main(sys.argv[1])
