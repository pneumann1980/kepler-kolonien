// Baut die PWA nach dist/public (esbuild): gehashte Assets, Service Worker, Manifest, Icons
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist/public');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const result = await build({
  entryPoints: [join(root, 'src/client/main.tsx')],
  bundle: true,
  format: 'esm',
  target: ['es2022', 'safari15'],
  outdir: join(out, 'assets'),
  entryNames: 'app-[hash]',
  assetNames: '[name]-[hash]',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  minify: true,
  sourcemap: true,
  metafile: true,
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
});

const outputs = Object.keys(result.metafile.outputs).map((p) => '/' + relative(out, join(root, p)).replace(/\\/g, '/'));
const js = outputs.find((p) => p.endsWith('.js') && !p.endsWith('.map'));
const css = outputs.find((p) => p.endsWith('.css') && !p.endsWith('.map'));
const html = readFileSync(join(root, 'src/client/index.html'), 'utf8').replace('%JS%', js).replace('%CSS%', css);
writeFileSync(join(out, 'index.html'), html);

cpSync(join(root, 'src/client/public'), out, { recursive: true });

await build({
  entryPoints: [join(root, 'src/client/sw.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  outfile: join(out, 'sw.js'),
  minify: true,
  define: { __ASSETS__: JSON.stringify([js, css, '/icons/icon-192.png', '/board/moon.jpg']) },
  logLevel: 'warning',
});

const size = (p) => (readFileSync(join(out, p.slice(1))).length / 1024).toFixed(0);
console.log(`Client gebaut: ${js} (${size(js)} KB), ${css} (${size(css)} KB)`);
