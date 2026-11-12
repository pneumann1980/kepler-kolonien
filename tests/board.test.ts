// Konsistenz von Spielgraph und Darstellung – für jede Kartenrevision
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TDEF, RDEF, REGION_MEMBERS, LANDING_SITES, EAST_WEST_LAND_ROUTES, neighborsFor, MAP_ID_V1, MAP_ID_V2, MAP_ID_V3,
} from '../src/engine/index.ts';

const read = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
interface Route { a: string; b: string; kind: string; pts: number[][]; pts2?: number[][]; wrap?: boolean; rev?: number }
interface Geo { schema: string; territories: Record<string, { d: string; hit?: string; marker?: number[] }>; regions: Record<string, unknown>; routes: Route[]; borders: [string, string][] }

const REVISIONS: { mapId: string; geo: Geo; label: string }[] = [
  { mapId: MAP_ID_V3, geo: read('../content/board/geometry.json'), label: 'Rev. 3 Erde & Mond' },
  { mapId: MAP_ID_V2, geo: read('../content/board/legacy/kepler-colonies-geometry.json'), label: 'Rev. 1/2 Kepler-Fantasiekarte' },
];

function edgesOf(mapId: string): Set<string> {
  const e = new Set<string>();
  for (const id of Object.keys(TDEF)) for (const n of neighborsFor(mapId, id)) e.add([id, n].sort().join('|'));
  return e;
}

test('Kartendaten: 42/13/14 Gebiete, 6 Kontinente, 5 Wasserkolonien (3/3/3/2/2), 3 Mondkolonien (6/4/4), 3 Landeplätze', () => {
  const ids = Object.keys(TDEF);
  assert.equal(ids.length, 69);
  const byType = (k: string) => ids.filter((i) => TDEF[i].type === k).length;
  assert.deepEqual([byType('land'), byType('water'), byType('moon')], [42, 13, 14]);
  const kind = (k: string) => Object.values(RDEF).filter((r) => r.kind === k).map((r) => r.id);
  assert.equal(kind('continent').length, 6);
  assert.deepEqual(kind('waterColony').map((r) => REGION_MEMBERS[r].length).sort(), [2, 2, 3, 3, 3]);
  assert.deepEqual(kind('lunarColony').map((r) => REGION_MEMBERS[r].length).sort(), [4, 4, 6]);
  assert.deepEqual(LANDING_SITES.sort(), ['HOC-1', 'POL-1', 'TEN-1']);
  assert.deepEqual(Object.fromEntries(Object.values(RDEF).map((r) => [r.id, r.bonus])),
    { BOR: 4, VEL: 4, KAS: 6, MER: 3, SAH: 3, INS: 2, NOR: 2, PEL: 2, ABY: 2, KOR: 2, SUD: 2, HOC: 4, TEN: 3, POL: 2 });
});

test('Alte Kartendatei hat dieselben IDs, Typen, Regionen und Landeplätze (nur Graph/Namen/Darstellung abweichend)', () => {
  const legacy = read('../content/board/legacy/kepler-colonies-map.json');
  assert.deepEqual(legacy.territories.map((t: { id: string }) => t.id).sort(), Object.keys(TDEF).sort());
  for (const t of legacy.territories) {
    assert.equal(t.type, TDEF[t.id].type, t.id);
    assert.equal(t.region, TDEF[t.id].region, t.id);
    assert.equal(Boolean(t.landingSite), Boolean(TDEF[t.id].landingSite), t.id);
  }
});

for (const { mapId, geo, label } of REVISIONS) {
  const edges = edgesOf(mapId);

  test(`${label}: Graph ist symmetrisch, Regionen und Planet zusammenhängend`, () => {
    for (const id of Object.keys(TDEF)) for (const n of neighborsFor(mapId, id)) assert.ok(neighborsFor(mapId, n).includes(id), `Symmetrie ${id}-${n}`);
    for (const [r, members] of Object.entries(REGION_MEMBERS)) {
      const seen = new Set([members[0]]);
      const q = [members[0]];
      while (q.length) for (const n of neighborsFor(mapId, q.shift()!)) if (members.includes(n) && !seen.has(n)) { seen.add(n); q.push(n); }
      assert.equal(seen.size, members.length, `Region ${r} nicht zusammenhängend`);
    }
    const planet = Object.keys(TDEF).filter((i) => TDEF[i].board === 'planet');
    const seen = new Set([planet[0]]);
    const q = [planet[0]];
    while (q.length) for (const n of neighborsFor(mapId, q.shift()!)) if (TDEF[n].board === 'planet' && !seen.has(n)) { seen.add(n); q.push(n); }
    assert.equal(seen.size, planet.length, 'Planet nicht zusammenhängend');
  });

  test(`${label}: Geometrie referenziert genau die Gebiete und Regionen`, () => {
    assert.match(geo.schema, /^geometry\/v[23]$/);
    assert.deepEqual(Object.keys(geo.territories).sort(), Object.keys(TDEF).sort());
    assert.deepEqual(Object.keys(geo.regions).sort(), Object.keys(RDEF).sort());
    for (const [id, t] of Object.entries(geo.territories)) {
      assert.ok(t.d.startsWith('M'), id);
      if (TDEF[id].type === 'water') assert.ok(t.hit, `Wasserfeld ${id} ohne Trefferfläche`);
      if (TDEF[id].landingSite) assert.ok(t.marker, `Landeplatz ${id} ohne Marker`);
    }
  });

  test(`${label}: jede Graphkante ist als Grenze oder Route sichtbar; Darstellung erfindet keine Nachbarschaften`, () => {
    const shown = new Set<string>();
    for (const [a, b] of geo.borders) {
      const k = [a, b].sort().join('|');
      assert.ok(edges.has(k), `Grenze ohne Graphkante: ${k}`);
      shown.add(k);
    }
    for (const r of geo.routes) {
      const k = [r.a, r.b].sort().join('|');
      if (r.rev && mapId !== MAP_ID_V2) continue;      // Rev.-2-Landroute wird nur in Rev.-2-Partien gezeigt
      assert.ok(edges.has(k), `Route ohne Graphkante: ${k}`);
      const ta = TDEF[r.a].type, tb = TDEF[r.b].type;
      const expected = ta === 'land' && tb === 'land' ? 'strait' : ta === 'water' && tb === 'water' ? (TDEF[r.a].region === TDEF[r.b].region ? 'colony' : 'water') : 'coast';
      assert.equal(r.kind, expected, `Routentyp ${k}`);
      assert.ok(r.pts.length >= 2 && (!r.wrap || (r.pts2 && r.pts2.length >= 2)), `Route ${k} ohne Linienzug`);
      shown.add(k);
    }
    for (const e of edges) assert.ok(shown.has(e), `Kante nicht dargestellt: ${e}`);
  });

  test(`${label}: Ost-West-Landroute ist dargestellt und spielbar`, () => {
    const route = EAST_WEST_LAND_ROUTES[mapId];
    assert.ok(route);
    const [a, b] = route;
    assert.ok(neighborsFor(mapId, a).includes(b));
    const r = geo.routes.find((x) => [x.a, x.b].sort().join('|') === [a, b].sort().join('|'));
    assert.ok(r, 'Route fehlt in der Geometrie');
    assert.equal(r.kind, 'strait');
  });
}

test('Rev. 1 hat keine Ost-West-Landroute, Rev. 2 genau eine zusätzliche Kante', () => {
  const e1 = edgesOf(MAP_ID_V1), e2 = edgesOf(MAP_ID_V2);
  assert.deepEqual([...e2].filter((e) => !e1.has(e)), ['BOR-3|VEL-5']);
  assert.equal(EAST_WEST_LAND_ROUTES[MAP_ID_V1], null);
});

test('Rev. 3: Wasserfelder sparsam verbunden (1–3 Küsten je Feld), Beringstraße über den Kartenrand', () => {
  const geo = REVISIONS[0].geo;
  for (const id of Object.keys(TDEF).filter((i) => TDEF[i].type === 'water')) {
    const coasts = neighborsFor(MAP_ID_V3, id).filter((n) => TDEF[n].type === 'land').length;
    assert.ok(coasts <= 3, `${id}: ${coasts} Küsten`);
  }
  const bering = geo.routes.find((r) => [r.a, r.b].sort().join('|') === 'BOR-1|KAS-4');
  assert.ok(bering?.wrap, 'Beringstraße wird über den Kartenrand gezeichnet');
  // Kontinentübergänge der Erdkarte (Auswahl): Panama, Sinai, Ural, Bosporus, Gibraltar
  for (const [a, b] of [['BOR-9', 'MER-1'], ['SAH-3', 'KAS-7'], ['VEL-7', 'KAS-1'], ['VEL-6', 'KAS-7'], ['VEL-3', 'SAH-1']]) {
    assert.ok(neighborsFor(MAP_ID_V3, a).includes(b), `${a}-${b}`);
  }
});
