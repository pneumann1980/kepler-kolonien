#!/usr/bin/env python3
"""Statische Vorschau (SVG) der Kartenrevision 3 (Erde & Mond) aus content/board/geometry.json – für Doku und Review.
Der Spiel-Client rendert dieselben Daten interaktiv (src/client/ui/Board.tsx) im selben Stil.
Aufruf: python3 tools/board-generator/preview_earth.py   -> docs/assets/board/planet.svg, moon.svg"""
import base64
import json
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
G = json.load(open(os.path.join(ROOT, 'content/board/geometry.json'), encoding='utf-8'))
M = json.load(open(os.path.join(ROOT, 'content/board/map.json'), encoding='utf-8'))
T = {t['id']: t for t in M['territories']}
R = {r['id']: r for r in M['regions']}
OUT = os.path.join(ROOT, 'docs/assets/board')
FONT = 'font-family="Inter,Segoe UI,Helvetica,Arial,sans-serif"'


def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;')


def text(x, y, s, size, fill='#fff', weight=600, halo='#06141c', hw=4, anchor='middle', extra=''):
    return (f'<text x="{x}" y="{y}" {FONT} font-size="{size}" font-weight="{weight}" text-anchor="{anchor}" '
            f'dominant-baseline="central" fill="{fill}" stroke="{halo}" stroke-width="{hw}" paint-order="stroke" '
            f'stroke-linejoin="round" {extra}>{esc(s)}</text>')


def routes_svg(board):
    out = []
    for r in G['routes']:
        if T[r['a']]['board'] != board:
            continue
        segs = [r['pts']] + ([r['pts2']] if r.get('pts2') else [])
        k = r['kind']
        for seg in segs:
            pts = ' '.join(f'{x},{y}' for x, y in seg)
            if k == 'colony':
                c = G['regions'][T[r['a']]['region']]['color']
                o_ = f'stroke="{c}" stroke-width="6" opacity="0.95"'
            elif k == 'water':
                o_ = 'stroke="#bfe9ff" stroke-width="3" stroke-dasharray="12 7" opacity="0.75"'
            elif k == 'strait':
                o_ = 'stroke="#fff3c4" stroke-width="3.5" stroke-dasharray="3 7"'
            else:
                wa = r['a'] if T[r['a']]['type'] == 'water' else r['b']
                c = G['regions'][T[wa]['region']]['color']
                o_ = f'stroke="{c}" stroke-width="2.5" opacity="0.8"'
            out.append(f'<polyline points="{pts}" fill="none" stroke-linecap="round" stroke-linejoin="round" {o_}/>')
        if r.get('wrap'):
            for (x, y) in (segs[0][-1], segs[1][0]):
                dx = -1 if x == 0 else 1
                out.append(f'<path d="M{x - dx * 4},{y - 9}L{x + dx * 10},{y}L{x - dx * 4},{y + 9}Z" fill="#fff3c4"/>')
    return ''.join(out)


def planet():
    b = G['boards']['planet']
    W, H = b['width'], b['height']
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H + 70}" width="{W}" height="{H + 70}">',
         '<defs><linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0c3f52"/>'
         '<stop offset="0.5" stop-color="#0a3445"/><stop offset="1" stop-color="#072634"/></linearGradient>'
         '<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter></defs>',
         f'<rect width="{W}" height="{H + 70}" fill="#061b25"/><rect width="{W}" height="{H}" fill="url(#sea)"/>']
    for x in G['graticule']['lon']:
        o.append(f'<line x1="{x}" y1="0" x2="{x}" y2="{H}" stroke="#2c6a80" stroke-width="1" opacity="0.35"/>')
    for y in G['graticule']['lat']:
        o.append(f'<line x1="0" y1="{y}" x2="{W}" y2="{y}" stroke="#2c6a80" stroke-width="1" opacity="0.35"/>')
    o.append(f'<path d="{G["landShadow"]}" fill="#04131a" opacity="0.55" transform="translate(3,4)"/>')
    for tid, g in G['territories'].items():
        t = T[tid]
        if t['type'] != 'land':
            continue
        c = G['regions'][t['region']]['color']
        o.append(f'<path d="{g["d"]}" fill="{c}" stroke="#13232b" stroke-width="1.6" stroke-linejoin="round"/>')
    for rid, rg in G['regions'].items():
        if R[rid]['kind'] == 'continent':
            o.append(f'<path d="{rg["outline"]}" fill="none" stroke="#0b1418" stroke-width="2.6" stroke-linejoin="round"/>')
    o.append(routes_svg('planet'))
    for tid, g in G['territories'].items():
        t = T[tid]
        if t['type'] != 'water':
            continue
        c = G['regions'][t['region']]['color']
        o.append(f'<path d="{g["d"]}" fill="none" stroke="{c}" stroke-width="10" opacity="0.55" filter="url(#glow)"/>')
        o.append(f'<path d="{g["d"]}" fill="#062a38" fill-opacity="0.85" stroke="{c}" stroke-width="5"/>')
    for tid, g in G['territories'].items():
        t = T[tid]
        if t['board'] != 'planet':
            continue
        x, y = g['label']
        if t['type'] == 'land':
            o.append(text(x, y, t['name'], 15))
        else:
            o.append(text(x, y + 46, t['name'], 12, fill='#d9f4ff', weight=500, hw=3))
    for rid, rg in G['regions'].items():
        r = R[rid]
        if r['kind'] == 'lunarColony':
            continue
        x, y = rg['label']
        s = f"{r['name']} +{r['bonus']}"
        big = r['kind'] == 'continent'
        w = (14 if big else 11) * len(s) + 26
        h = 34 if big else 26
        o.append(f'<rect x="{x - w / 2}" y="{y - h / 2}" width="{w}" height="{h}" rx="{h / 2}" fill="#071a22" fill-opacity="0.85" stroke="{rg["color"]}" stroke-width="2.5"/>')
        o.append(text(x, y, s, 20 if big else 15, fill=rg['color'] if not big else '#fff', weight=800 if big else 700, hw=0))
    # Legende
    y0 = H + 35
    items = [('land', 'Landgebiet (Farbe = Kontinent)'), ('ring', 'Wasserkolonie (Marine nötig)'), ('colony', 'Verbindung in der Kolonie'),
             ('strait', 'Seeweg / Meerenge'), ('coast', 'Küstenzugang'), ('wrap', 'über den Kartenrand')]
    x = 30
    for kind, label in items:
        if kind == 'land':
            o.append(f'<rect x="{x}" y="{y0 - 10}" width="28" height="20" rx="3" fill="#c9a23a" stroke="#13232b"/>')
        elif kind == 'ring':
            o.append(f'<circle cx="{x + 14}" cy="{y0}" r="11" fill="#062a38" stroke="#4fb0f0" stroke-width="4"/>')
        elif kind == 'colony':
            o.append(f'<line x1="{x}" y1="{y0}" x2="{x + 28}" y2="{y0}" stroke="#4fb0f0" stroke-width="6" stroke-linecap="round"/>')
        elif kind == 'strait':
            o.append(f'<line x1="{x}" y1="{y0}" x2="{x + 28}" y2="{y0}" stroke="#fff3c4" stroke-width="3.5" stroke-dasharray="3 7" stroke-linecap="round"/>')
        elif kind == 'coast':
            o.append(f'<line x1="{x}" y1="{y0}" x2="{x + 28}" y2="{y0}" stroke="#4fb0f0" stroke-width="2.5" opacity="0.8"/>')
        else:
            o.append(f'<path d="M{x + 6},{y0 - 9}L{x + 22},{y0}L{x + 6},{y0 + 9}Z" fill="#fff3c4"/>')
        o.append(text(x + 38, y0, label, 17, fill='#cfe6ee', weight=500, hw=0, anchor='start'))
        x += 60 + 9.6 * len(label)
    o.append(text(W - 20, y0, 'KEPLER-KOLONIEN · ERDE', 20, fill='#7fd3e6', weight=800, hw=0, anchor='end', extra='letter-spacing="3"'))
    o.append('</svg>')
    return ''.join(o)


def moon():
    b = G['boards']['moon']
    W, H = b['width'], b['height']
    tex = os.path.join(ROOT, 'src/client/public', b['texture'])
    href = 'data:image/jpeg;base64,' + base64.b64encode(open(tex, 'rb').read()).decode()
    cx, cy, r = b['cx'], b['cy'], b['radius']
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 {W} {H}" width="{W}" height="{H}">',
         f'<defs><clipPath id="disc"><circle cx="{cx}" cy="{cy}" r="{r}"/></clipPath>'
         '<radialGradient id="space"><stop offset="0" stop-color="#101a2e"/><stop offset="1" stop-color="#03060d"/></radialGradient></defs>',
         f'<rect width="{W}" height="{H}" fill="url(#space)"/>',
         f'<circle cx="{cx}" cy="{cy}" r="{r + 10}" fill="#9fb4d8" opacity="0.12"/>',
         f'<image href="{href}" x="0" y="0" width="{W}" height="{H}" clip-path="url(#disc)"/>']
    for tid, g in G['territories'].items():
        t = T[tid]
        if t['type'] != 'moon':
            continue
        c = G['regions'][t['region']]['color']
        o.append(f'<path d="{g["d"]}" fill="{c}" fill-opacity="0.16" stroke="{c}" stroke-width="2.2" stroke-opacity="0.9"/>')
    for rid, rg in G['regions'].items():
        if R[rid]['kind'] == 'lunarColony':
            o.append(f'<path d="{rg["outline"]}" fill="none" stroke="{rg["color"]}" stroke-width="5" stroke-linejoin="round"/>')
    for tid, g in G['territories'].items():
        t = T[tid]
        if t['type'] != 'moon':
            continue
        x, y = g['label']
        o.append(text(x, y, t['name'], 17))
        if 'marker' in g:
            mx, my = g['marker']
            o.append(f'<circle cx="{mx}" cy="{my}" r="17" fill="#0b1220" stroke="#ffd166" stroke-width="3"/>'
                     f'<path d="M{mx},{my - 10}L{mx + 6},{my + 6}L{mx},{my + 3}L{mx - 6},{my + 6}Z" fill="#ffd166"/>')
            o.append(text(mx, my + 28, G['landingShort'][tid], 13, fill='#ffd166', weight=700, hw=3))
    for rid, rg in G['regions'].items():
        r_ = R[rid]
        if r_['kind'] != 'lunarColony':
            continue
        x, y = rg['label']
        s = f"{r_['name']} +{r_['bonus']}"
        w = 12 * len(s) + 26
        o.append(f'<rect x="{x - w / 2}" y="{y - 15}" width="{w}" height="30" rx="15" fill="#0b1220" stroke="{rg["color"]}" stroke-width="2.5"/>')
        o.append(text(x, y, s, 17, fill=rg['color'], weight=800, hw=0))
    o.append(text(W - 16, H - 14, 'Mond: NASA/GSFC/Arizona State University', 11, fill='#7f8da8', weight=400, hw=0, anchor='end'))
    o.append('</svg>')
    return ''.join(o)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    open(os.path.join(OUT, 'planet.svg'), 'w', encoding='utf-8').write(planet())
    open(os.path.join(OUT, 'moon.svg'), 'w', encoding='utf-8').write(moon())
    print('geschrieben:', os.path.join(OUT, 'planet.svg'), os.path.join(OUT, 'moon.svg'))
