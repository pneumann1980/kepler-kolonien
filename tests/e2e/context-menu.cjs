// E2E: Aktionsmenü am Gebiet und schwebende Aktionsleiste bei eingeklappter Seitenleiste; Atom-Symbol auf kontaminierten Gebieten.
// Benötigt Server mit ENABLE_TEST_API=1.  Aufruf: node tests/e2e/context-menu.cjs [BASE_URL] [SCREENSHOT_DIR]
const { chromium, devices } = require('playwright');
const fs = require('fs');
const assert = require('assert');
const BASE = process.argv[2] || 'http://localhost:8210';
const SHOTS = process.argv[3] || './e2e-shots';
fs.mkdirSync(SHOTS, { recursive: true });
const USER = 'Mara' + Math.floor(Math.random() * 9000 + 1000);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13 landscape'] });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => { console.error('PAGEERROR', e.message); process.exitCode = 1; });
  const shot = async (name) => { await page.waitForTimeout(350); await page.screenshot({ path: `${SHOTS}/${name}.png` }); console.log('📸', name); };
  const api = (path, body) => page.evaluate(async ([pa, b]) => {
    const r = await fetch(pa, { method: b ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
    return { status: r.status, json: await r.json() };
  }, [path, body]);
  let gameId;
  const raw = async () => (await api(`/api/test/games/${gameId}/state`)).json.state;
  const setState = async (s) => { s.log = s.log.slice(-15); const r = await api(`/api/test/games/${gameId}/state`, { state: s }); assert.equal(r.status, 200, JSON.stringify(r.json)); await page.waitForTimeout(500); };
  const tap = async (tid) => {
    const box = await page.locator('svg.board').boundingBox();
    const cands = page.locator(`svg.board .landing-marker[data-tid="${tid}"] circle, svg.board path.hit[data-tid="${tid}"], svg.board g.badge[data-tid="${tid}"] circle.anchor`);
    let best = null;
    for (let i = 0; i < await cands.count(); i++) {
      const bb = await cands.nth(i).boundingBox().catch(() => null);
      if (!bb) continue;
      const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
      if (cx < box.x + 4 || cx > box.x + box.width - 52 || cy < box.y + 46 || cy > box.y + box.height - 92) continue;
      const water = /^(NOR|PEL|ABY|KOR|SUD)-/.test(tid);
      const cls = (await cands.nth(i).evaluate((e) => (e.getAttribute('class') || '') + ' ' + (e.parentElement?.getAttribute('class') || ''))) || '';
      const score = cls.includes('landing') ? 4 : cls.includes('hit') ? (water ? 3 : 1) : 2;
      if (!best || score > best.score) best = { cx, cy, score };
    }
    assert.ok(best, `Gebiet ${tid} nicht sichtbar`);
    await page.mouse.click(best.cx, best.cy);
    await page.waitForTimeout(300);
  };
  const pan = async (dx, dy) => {
    const box = await page.locator('svg.board').boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 }); await page.mouse.move(x + dx, y + dy, { steps: 4 }); await page.mouse.up();
  };
  const centerOn = async (tid) => {
    for (let k = 0; k < 6; k++) {
      const box = await page.locator('svg.board').boundingBox();
      const els = page.locator(`svg.board g.badge[data-tid="${tid}"] circle.anchor`);
      let best = null;
      for (let i = 0; i < await els.count(); i++) {
        const bb = await els.nth(i).boundingBox().catch(() => null);
        if (!bb) continue;
        const d = Math.hypot(bb.x + bb.width / 2 - (box.x + box.width / 2), bb.y + bb.height / 2 - (box.y + box.height / 2));
        if (!best || d < best.d) best = { d, x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 };
      }
      if (!best || best.d < 30) return;
      await pan(box.x + box.width / 2 - best.x, box.y + box.height / 2 - best.y);
      await page.waitForTimeout(150);
    }
  };
  const minFloat = async () => { if (await page.locator('.floatpanel:not(.min)').count()) await page.locator('.fp-head').click(); await page.waitForTimeout(150); };
  const openFloat = async () => { if (await page.locator('.floatpanel.min').count()) await page.locator('.fp-head').click(); await page.waitForTimeout(150); };
  const zoomTo = async (n) => { for (let i = 0; i < n; i++) { await page.getByRole('button', { name: 'Hineinzoomen' }).click(); await page.waitForTimeout(80); } };

  await page.goto(BASE);
  await page.getByRole('button', { name: 'Profil anlegen' }).first().click();
  await page.getByLabel('Name').fill(USER);
  await page.getByLabel('Passwort').fill('geheim123');
  await page.locator('form .btn.ok').click();
  await page.getByText('Hallo ' + USER).waitFor();
  await page.getByRole('button', { name: '+ Neue Partie' }).click();
  await page.getByLabel('Name').fill('Menütest');
  await page.locator('input[type=range]').nth(0).fill('3');
  await page.locator('input[type=range]').nth(1).fill('2');
  await page.getByRole('button', { name: 'Partie anlegen' }).click();
  await page.getByRole('button', { name: 'Starten' }).click();
  await page.getByRole('button', { name: 'Öffnen' }).first().click();
  await page.waitForURL(/\/game\//);
  gameId = page.url().split('/game/')[1];
  await page.locator('svg.board').waitFor();
  let s = await raw();
  const me = s.players.find((p) => !p.isBot).id;
  const bots = s.players.filter((p) => p.isBot).map((p) => p.id);

  // Seitenleiste einklappen: alle Aktionen müssen trotzdem möglich sein
  await page.getByRole('button', { name: 'Seitenleiste ausblenden' }).click();
  assert.equal(await page.locator('section.side').count(), 0, 'Seitenleiste eingeklappt');

  const scenario = (step, extra = {}) => {
    for (const id of Object.keys(s.territories)) Object.assign(s.territories[id], { owner: null, mods: 0, commanders: [], station: false, devastated: false });
    const put = (id, o, m, c = [], st = false) => Object.assign(s.territories[id], { owner: o, mods: m, commanders: c, station: st });
    put('VEL-1', me, 8, ['LAND']); put('VEL-4', bots[0], 3); put('VEL-3', me, 1); put('VEL-5', null, 0);
    put('KAS-8', me, 5, ['NAVAL', 'SPACE'], true); put('KAS-7', me, 2);
    put('BOR-2', bots[1], 2);
    s.territories['SAH-1'].devastated = true; s.territories['SAH-2'].devastated = true;   // kontaminiert
    s.phase = 'turn'; s.year = 1; s.turnOrder = [me, ...bots]; s.turnIndex = 0; s.invasion = null; s.setup = null;
    s.turn = { player: me, step, incomeMods: 0, boughtCards: true, invaded: false, contestedConquests: 0, bonusAwarded: false, bonusCardPending: false, fortifiesLeft: 1, conqueredLand: 0, ...extra };
    s.players.forEach((p) => { p.energy = 20; p.hand = []; });
  };

  // ---------------------------------------------------------------- 1. Angriff über das Menü
  scenario('main'); await setState(s);
  assert.ok((await page.locator('svg.board g.contam').count()) >= 2, 'Atom-Symbol auf kontaminierten Gebieten');
  await centerOn('VEL-1'); await zoomTo(3); await centerOn('VEL-1');
  await shot('ctx-01-kontaminiert-atom');
  await tap('VEL-1');
  await page.locator('.ctxmenu [data-act="atk"]').waitFor();
  assert.equal(await page.locator('.ctxmenu [data-act="moon"]').count(), 0, 'Mondlandung nur an Stationsgebieten');
  await shot('ctx-02-menue-quelle');
  await page.locator('.ctxmenu [data-act="atk"]').click();
  console.log('DEBUG toast after atk:', await page.locator('.toast').count(), '| menus:', await page.locator('.ctxmenu').count());
  await tap('VEL-4');
  console.log('DEBUG selinfo:', (await page.locator('.selinfo').innerText().catch(() => '-')).replace(/\n/g, ' | '), '| menus:', await page.locator('.ctxmenu').count(), '| pulse:', await page.locator('svg.board path.pulse').count());
  await page.locator('.ctxmenu [data-act="atk2"]').waitFor({ timeout: 5000 });
  await shot('ctx-03-menue-ziel');
  await page.locator('.ctxmenu [data-act="atk2"]').click();
  // Würfeln über die schwebende Aktionsleiste (Seitenleiste ist eingeklappt)
  await page.locator('.floatpanel').getByRole('button', { name: 'Würfeln' }).waitFor();
  await shot('ctx-04-schwebende-leiste-wuerfeln');
  await page.locator('.floatpanel').getByRole('button', { name: 'Würfeln' }).click();
  await page.waitForTimeout(600);

  // ---------------------------------------------------------------- 2. Mondlandung nur an der Station
  s = await raw(); scenario('main'); await setState(s);
  await page.getByRole('button', { name: 'Gesamtansicht' }).click();
  await centerOn('KAS-8'); await zoomTo(3); await centerOn('KAS-8');
  await tap('KAS-8');
  await page.locator('.ctxmenu [data-act="moon"]').waitFor();
  await shot('ctx-05-menue-station-mondlandung');

  // ---------------------------------------------------------------- 3. Aufrüsten: anheuern / Station bauen
  s = await raw(); scenario('hire'); s.players.find((p) => p.id === me).energy = 8; s.territories['KAS-8'].commanders = ['NAVAL', 'SPACE']; await setState(s);
  await minFloat();
  await page.getByRole('button', { name: 'Gesamtansicht' }).click();
  await centerOn('VEL-1'); await zoomTo(3); await centerOn('VEL-1');
  await tap('VEL-1');
  await page.locator('.ctxmenu [data-act="hLAND"]').count().then((n) => assert.equal(n, 0, 'Land-Kdt ist schon im Spiel'));
  await page.locator('.ctxmenu [data-act="hNUCLEAR"]').waitFor();
  await page.locator('.ctxmenu [data-act="st"]').waitFor();
  await shot('ctx-06-menue-aufruesten');
  await page.locator('.ctxmenu [data-act="hDIPLOMAT"]').click();
  await page.waitForTimeout(700);
  s = await raw();
  assert.ok(s.territories['VEL-1'].commanders.includes('DIPLOMAT'), 'Diplomat angeheuert');
  assert.equal(s.players.find((p) => p.id === me).energy, 5, '3 Energie bezahlt');

  // ---------------------------------------------------------------- 4. MODs einsetzen über das Menü + Bestätigen in der schwebenden Leiste
  s = await raw(); scenario('deploy', { incomeMods: 7 }); await setState(s);
  await minFloat();
  await tap('VEL-1');
  await page.locator('.ctxmenu [data-act="pr"]').waitFor();       // Rest hierher
  await shot('ctx-07-menue-einsetzen');
  await page.locator('.ctxmenu [data-act="pr"]').click();
  await openFloat();
  await page.locator('.floatpanel').getByRole('button', { name: 'Bestätigen' }).click();
  await page.waitForTimeout(700);
  s = await raw();
  assert.equal(s.territories['VEL-1'].mods, 15, '7 MODs eingesetzt (8 + 7)');
  console.log('Kontextmenü-E2E OK');
  await browser.close();
})().catch((e) => { console.error('E2E FEHLER', e); process.exit(1); });
