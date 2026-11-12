// Exportiert Natural-Earth-Länder (1:50 Mio., gemeinfrei; über das npm-Paket world-atlas) als GeoJSON
// für tools/board-generator/earth_board.py.  Aufruf: node tools/board-generator/export_countries.mjs <ziel.geojson>
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { feature } from 'topojson-client';

const require = createRequire(import.meta.url);
const topo = JSON.parse(readFileSync(require.resolve('world-atlas/countries-50m.json'), 'utf8'));
const out = process.argv[2];
if (!out) throw new Error('Zielpfad fehlt');
writeFileSync(out, JSON.stringify(feature(topo, topo.objects.countries)));
console.log('geschrieben:', out);
