// Konsistenz von Spielgraph (map.json) und Darstellung (geometry.json)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TDEF, RDEF, REGION_MEMBERS, LANDING_SITES, EAST_WEST_LAND_ROUTE, neighborsFor, MAP_ID_V2 } from '../src/engine/index.ts';

const geo = JSON.parse(readFileSync(new URL('../content/board/geometry.json', import.meta.url), 'utf8'));
const edges = new Set<string>();
for (const t of Object.values(TDEF)) for (const n of t.adjacent) edges.add([t.id, n].sort().join('|'));

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

test('Jede Region hängt im Gebietsgraphen zusammen', () => {
  for (const [r, members] of Object.entries(REGION_MEMBERS)) {
    const seen = new Set([members[0]]);
    const q = [members[0]];
    while (q.length) for (const n of TDEF[q.shift()!].adjacent) if (members.includes(n) && !seen.has(n)) { seen.add(n); q.push(n); }
    assert.equal(seen.size, members.length, `Region ${r} nicht zusammenhängend`);
  }
});

test('Geometrie referenziert genau die Gebiete und Regionen aus map.json', () => {
  assert.equal(geo.schema, 'geometry/v2');
  assert.deepEqual(Object.keys(geo.territories).sort(), Object.keys(TDEF).sort());
  assert.deepEqual(Object.keys(geo.regions).sort(), Object.keys(RDEF).sort());
  for (const [id, t] of Object.entries<{ d: string; hit?: string; marker?: number[] }>(geo.territories)) {
    assert.ok(t.d.startsWith('M'), id);
    if (TDEF[id].type === 'water') assert.ok(t.hit, `Wasserfeld ${id} ohne Trefferfläche`);
    if (TDEF[id].landingSite) assert.ok(t.marker, `Landeplatz ${id} ohne Marker`);
  }
});

test('Jede Graphkante ist als Grenze oder Route sichtbar; Darstellung erfindet keine Nachbarschaften', () => {
  const shown = new Set<string>();
  for (const [a, b] of geo.borders) {
    const k = [a, b].sort().join('|');
    assert.ok(edges.has(k), `Grenze ohne Graphkante: ${k}`);
    shown.add(k);
  }
  for (const r of geo.routes) {
    const k = [r.a, r.b].sort().join('|');
    if (r.rev === 2) {
      assert.deepEqual([r.a, r.b].sort(), [...EAST_WEST_LAND_ROUTE].sort());
      assert.ok(neighborsFor(MAP_ID_V2, r.a).includes(r.b), 'angezeigte Landroute ist in Revision 2 spielbar');
      assert.equal(r.kind, 'strait');
      continue;
    }
    assert.ok(edges.has(k), `Route ohne Graphkante: ${k}`);
    const ta = TDEF[r.a].type, tb = TDEF[r.b].type;
    const expected = ta === 'land' && tb === 'land' ? 'strait' : ta === 'water' && tb === 'water' ? (TDEF[r.a].region === TDEF[r.b].region ? 'colony' : 'water') : 'coast';
    assert.equal(r.kind, expected, `Routentyp ${k}`);
    shown.add(k);
  }
  for (const e of edges) assert.ok(shown.has(e), `Kante nicht dargestellt: ${e}`);
});

test('Probe: Riffbank hat Küstenzugänge nach Kaskadia, Sahari und Insula', () => {
  const regions = new Set(geo.routes.filter((r: { a: string; b: string; kind: string }) => r.kind === 'coast' && (r.a === 'KOR-1' || r.b === 'KOR-1'))
    .map((r: { a: string; b: string }) => TDEF[r.a === 'KOR-1' ? r.b : r.a].region));
  assert.deepEqual([...regions].sort(), ['INS', 'KAS', 'SAH']);
});
