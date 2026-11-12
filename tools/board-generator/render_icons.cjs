// Rendert icon.svg zu PNGs (PWA 192/512, maskable 512, Unraid 256). Aufruf: node tools/board-generator/render_icons.cjs
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..', '..');
const svg = fs.readFileSync(path.join(root, 'src/client/public/icons/icon.svg'), 'utf8');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ deviceScaleFactor: 1 });
  const out = async (size, file, { maskable = false } = {}) => {
    await p.setViewportSize({ width: size, height: size });
    const inner = maskable ? `<div style="position:absolute;inset:0;background:#0b1630"></div><div style="position:absolute;inset:${size * 0.1}px;">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div>` : svg.replace('<svg ', `<svg width="${size}" height="${size}" `);
    await p.setContent(`<body style="margin:0;background:transparent;position:relative;width:${size}px;height:${size}px">${inner}</body>`);
    await p.screenshot({ path: file, omitBackground: true });
    console.log('png', file);
  };
  await out(192, path.join(root, 'src/client/public/icons/icon-192.png'));
  await out(512, path.join(root, 'src/client/public/icons/icon-512.png'));
  await out(512, path.join(root, 'src/client/public/icons/icon-maskable-512.png'), { maskable: true });
  await out(256, path.join(root, 'deploy/unraid/icon.png'));
  await b.close();
})();
