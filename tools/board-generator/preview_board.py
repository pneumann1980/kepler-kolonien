#!/usr/bin/env python3
"""Statische Vorschau (SVG) der Kartendarstellung v2 aus content/board/geometry.json – für Doku und Review.
Der Spiel-Client rendert dieselben Daten interaktiv (src/client/ui/Board.tsx)."""
import json
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
G = json.load(open(os.path.join(ROOT, 'content/board/geometry.json'), encoding='utf-8'))
M = json.load(open(os.path.join(ROOT, 'content/board/map.json'), encoding='utf-8'))
T = {t['id']: t for t in M['territories']}
R = {r['id']: r for r in M['regions']}
OUT = os.path.join(ROOT, 'docs/assets/board')
FONT = 'font-family="Inter,Segoe UI,Helvetica,Arial,sans-serif"'


def shade(hx, f):
    h = hx.lstrip('#')
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return '#%02x%02x%02x' % tuple(max(0, min(255, int(v * f))) for v in (r, g, b))


def route_svg(r):
    styles = {
        'strait': 'stroke="#fff7d6" stroke-width="5" stroke-dasharray="2 9" stroke-linecap="round"',
        'coast': 'stroke="#9fe3ff" stroke-width="2" stroke-dasharray="6 6" stroke-opacity="0.55"',
        'water': 'stroke="#9fe3ff" stroke-width="3" stroke-dasharray="10 6" stroke-opacity="0.8"',
        'colony': 'stroke="#d8f6ff" stroke-width="7" stroke-linecap="round" stroke-opacity="0.9"',
    }
    st = styles[r['kind']]
    out = []
    segs = [r['pts']] + ([r['pts2']] if r.get('pts2') else [])
    if r['kind'] == 'coast':
        # Übersicht: kurzer Stummel am Wasserfeld + Anker an der Küste; volle Linie erst bei Auswahl (Client)
        wa = r['a'] if T[r['a']]['type'] == 'water' else r['b']
        (x1, y1), (x2, y2) = segs[0] if r['a'] == wa else segs[-1][::-1]
        L = max(1, ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5)
        k = min(1, 34 / L)
        out.append(f'<line x1="{x1}" y1="{y1}" x2="{x1 + (x2 - x1) * k:.0f}" y2="{y1 + (y2 - y1) * k:.0f}" stroke="#bdefff" stroke-width="3" stroke-linecap="round"/>')
        lx, ly = (segs[-1][1] if r['a'] == wa else segs[0][0])
        out.append(f'<circle cx="{lx}" cy="{ly}" r="5" fill="#bdefff" stroke="#0b2540" stroke-width="2"/>')
        for (a1, b1), (a2, b2) in segs:
            out.append(f'<line x1="{a1}" y1="{b1}" x2="{a2}" y2="{b2}" stroke="#9fe3ff" stroke-width="1.5" stroke-dasharray="3 7" stroke-opacity="0.28"/>')
        return ''.join(out)
    for pts in segs:
        (x1, y1), (x2, y2) = pts
        out.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" {st} fill="none"/>')
    return ''.join(out)


def planet():
    B = G['boards']['planet']
    W, H = B['width'], B['height']
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H + 120}" width="{W}" height="{H + 120}" {FONT}>',
         '<defs><radialGradient id="sea" cx="50%" cy="45%" r="75%"><stop offset="0" stop-color="#1d4f80"/><stop offset="1" stop-color="#0f2c4d"/></radialGradient></defs>',
         f'<rect width="{W}" height="{H + 120}" fill="#0b1220"/><rect width="{W}" height="{H}" fill="url(#sea)"/>']
    for x in range(0, W, 200):
        o.append(f'<line x1="{x}" y1="0" x2="{x}" y2="{H}" stroke="#fff" stroke-opacity="0.04"/>')
    for y in range(0, H, 200):
        o.append(f'<line x1="0" y1="{y}" x2="{W}" y2="{y}" stroke="#fff" stroke-opacity="0.04"/>')
    o.append(f'<path d="{G["landShadow"]}" fill="#2d6a95" fill-opacity="0.55"/>')
    for r in G['routes']:
        if r['kind'] in ('coast', 'water'):
            o.append(route_svg(r))
    for cid, reg in G['regions'].items():
        if R[cid]['kind'] == 'waterColony':
            o.append(f'<path d="{reg["outline"]}" fill="{reg["color"]}" fill-opacity="0.12" stroke="{reg["color"]}" stroke-opacity="0.6" stroke-width="2" stroke-dasharray="4 5"/>')
    for k, (tid, t) in enumerate(G['territories'].items()):
        d = T[tid]
        if d['board'] != 'planet':
            continue
        col = G['regions'][d['region']]['color']
        f = 1.0 + 0.06 * ((k * 7) % 5 - 2)
        stroke = '#0b1322' if d['type'] == 'land' else '#e8fbff'
        o.append(f'<path d="{t["d"]}" fill="{shade(col, f)}" stroke="{stroke}" stroke-width="{1.6 if d["type"] == "land" else 2.5}" stroke-linejoin="round"/>')
    for cid, reg in G['regions'].items():
        if R[cid]['kind'] == 'continent':
            o.append(f'<path d="{reg["outline"]}" fill="none" stroke="#06101d" stroke-width="4.5" stroke-linejoin="round"/>')
    for r in G['routes']:
        if r['kind'] in ('strait', 'colony'):
            o.append(route_svg(r))
    for tid, t in G['territories'].items():
        d = T[tid]
        if d['board'] != 'planet':
            continue
        x, y = t['label']
        fs = 14 if d['type'] == 'land' else 12
        o.append(f'<text x="{x}" y="{y + 4}" font-size="{fs}" font-weight="700" text-anchor="middle" fill="#0b1322" paint-order="stroke" stroke="#ffffff" stroke-width="3" stroke-opacity="0.65">{d["name"]}</text>')
    for cid, reg in G['regions'].items():
        if R[cid]['kind'] in ('continent', 'waterColony'):
            x, y = reg['label']
            big = R[cid]['kind'] == 'continent'
            txt = f'{R[cid]["name"]} +{R[cid]["bonus"]}'
            w = len(txt) * (15 if big else 11.5) + 24
            o.append(f'<rect x="{x - w / 2}" y="{y - (18 if big else 14)}" width="{w}" height="{36 if big else 28}" rx="{18 if big else 14}" fill="#0b1220" fill-opacity="0.82" stroke="{reg["color"]}" stroke-width="2.5"/>')
            o.append(f'<text x="{x}" y="{y + (8 if big else 6)}" font-size="{26 if big else 19}" font-weight="800" text-anchor="middle" fill="{reg["color"]}">{txt}</text>')
    o.append(f'<text x="20" y="{H + 40}" font-size="22" font-weight="800" fill="#fff">Kepler-Kolonien · Planet (Darstellung v2)</text>')
    o.append(f'<text x="20" y="{H + 75}" font-size="16" fill="#c9d6e8">· · · Landpassage (ohne Marine)   – – Küstenzugang / Wasserroute (Marine-Kdt)   ━ Verbindung innerhalb einer Unterwasserkolonie   Linien zum Rand = Ost-West-Übergang</text>')
    o.append(f'<text x="20" y="{H + 102}" font-size="16" fill="#c9d6e8">Neue Partien (Kartenrevision 2): zusätzliche Landroute Kaltmark (BOR-3) ⇄ Kupferhang (VEL-5) über den Ost-West-Rand</text>')
    o.append('</svg>')
    return '\n'.join(o)


def moon():
    B = G['boards']['moon']
    W, H = B['width'], B['height']
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H + 80}" width="{W}" height="{H + 80}" {FONT}>',
         f'<rect width="{W}" height="{H + 80}" fill="#070b14"/>',
         f'<circle cx="{B["cx"]}" cy="{B["cy"]}" r="{B["radius"] + 14}" fill="#1a2236"/>']
    for k, (tid, t) in enumerate(G['territories'].items()):
        d = T[tid]
        if d['board'] != 'moon':
            continue
        col = G['regions'][d['region']]['color']
        o.append(f'<path d="{t["d"]}" fill="{shade(col, 1.0 + 0.05 * ((k * 5) % 5 - 2))}" stroke="#2b2f3d" stroke-width="1.6"/>')
    for cid, reg in G['regions'].items():
        if R[cid]['kind'] == 'lunarColony':
            o.append(f'<path d="{reg["outline"]}" fill="none" stroke="#070b14" stroke-width="6"/>')
    for tid, t in G['territories'].items():
        d = T[tid]
        if d['board'] != 'moon':
            continue
        x, y = t['label']
        o.append(f'<text x="{x}" y="{y + 5}" font-size="16" font-weight="700" text-anchor="middle" fill="#141824">{d["name"]}</text>')
        if 'marker' in t:
            mx, my = t['marker']
            o.append(f'<g transform="translate({mx},{my})"><circle r="20" fill="#fde047" stroke="#141824" stroke-width="3"/><path d="M-9,-6 L0,8 L9,-6 Z" fill="#141824"/></g>')
            o.append(f'<text x="{mx}" y="{my + 38}" font-size="15" font-weight="800" text-anchor="middle" fill="#141824" paint-order="stroke" stroke="#fde047" stroke-width="4">{G["landingShort"][tid]}</text>')
    for cid, reg in G['regions'].items():
        if R[cid]['kind'] == 'lunarColony':
            x, y = reg['label']
            n = sum(1 for t in T.values() if t["region"] == cid)
            o.append(f'<text x="{x}" y="{y - 2}" font-size="24" font-weight="800" text-anchor="middle" fill="{reg["color"]}">{R[cid]["name"]} +{R[cid]["bonus"]}</text>')
            o.append(f'<text x="{x}" y="{y + 20}" font-size="15" text-anchor="middle" fill="{reg["color"]}" fill-opacity="0.8">{n} Gebiete</text>')
    o.append(f'<text x="20" y="{H + 50}" font-size="18" fill="#c9d6e8">▼ Landeplatz: Ziel einer Mondlandung von einer eigenen Raumstation (Raum-Kdt im Spiel)</text>')
    o.append('</svg>')
    return '\n'.join(o)


open(os.path.join(OUT, 'planet.svg'), 'w', encoding='utf-8').write(planet())
open(os.path.join(OUT, 'moon.svg'), 'w', encoding='utf-8').write(moon())
print('Vorschauen geschrieben')
