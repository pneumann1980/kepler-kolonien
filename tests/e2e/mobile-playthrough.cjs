// E2E: Mobilgerät (iPhone-Emulation) spielt über die echte UI: Profil, Lobby, Aufstellung, Gebot, Zug mit Angriff.
// Aufruf: node tests/e2e/mobile-playthrough.cjs [BASE_URL] [SCREENSHOT_DIR]
const { chromium, devices } = require('playwright');
const fs = require('fs');
const BASE = process.argv[2] || 'http://localhost:8210';
const SHOTS = process.argv[3] || './e2e-shots';
const USER = 'Paula' + Math.floor(Math.random() * 9000 + 1000);
fs.mkdirSync(SHOTS, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => { console.error('PAGEERROR', e.message); process.exitCode = 1; });
  const shot = async (name) => { await page.waitForTimeout(400); await page.screenshot({ path: `${SHOTS}/${name}.png` }); console.log('📸', name); };
  const state = async () => (await page.evaluate(async (id) => (await (await fetch(`/api/games/${id}/state`)).json()).state, gameId));
  const visibleBadge = async (id) => {
    const box = await page.locator('svg.board').boundingBox();
    const loc = page.locator(`g.badge[data-tid="${id}"] circle.anchor`);
    const n = await loc.count();
    for (let i = 0; i < n; i++) {
      const bb = await loc.nth(i).boundingBox({ timeout: 500 }).catch(() => null);
      if (bb && bb.x > box.x + 10 && bb.x < box.x + box.width - 60 && bb.y > box.y + 45 && bb.y < box.y + box.height - 50) return bb;
    }
    return null;
  };
  // sichtbare Kopie antippen (der Ost-West-Umlauf rendert Kopien links/rechts neben dem Brett)
  const tap = async (tid) => {
    const bb = await visibleBadge(tid);
    if (bb) { await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.waitForTimeout(150); return; }
    await page.locator(`g.terr[data-tid="${tid}"] path`).first().click({ force: true });
  };
  const visible = async (ids) => {
    const out = [];
    for (const id of ids) if (await visibleBadge(id)) out.push(id);
    return out;
  };
  const waitMine = async (pred, label, ms = 60000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const s = await state();
      if (pred(s)) return s;
      await page.waitForTimeout(500);
    }
    throw new Error('Timeout: ' + label);
  };
  let gameId = '';

  await page.goto(BASE);
  await shot('01-login');
  await page.getByRole('button', { name: 'Profil anlegen' }).first().click();
  await page.getByLabel('Name').fill(USER);
  await page.getByLabel('Passwort').fill('geheim123');
  await page.locator('form .btn.ok').click();
  await page.getByText('Hallo ' + USER).waitFor();
  await page.getByRole('button', { name: '+ Neue Partie' }).click();
  await page.getByLabel('Name').fill('Testrunde');
  await page.locator('input[type=range]').nth(0).fill('3');
  await page.locator('input[type=range]').nth(1).fill('2');
  await shot('02-create');
  await page.getByRole('button', { name: 'Partie anlegen' }).click();
  await page.getByRole('button', { name: 'Starten' }).click();
  await page.getByRole('button', { name: 'Öffnen' }).first().click();
  await page.waitForURL(/\/game\//);
  gameId = page.url().split('/game/')[1];
  await page.locator('svg.board').waitFor();

  // ---- Schnellaufstellung
  let s = await waitMine((x) => x.phase === 'quickSetup', 'quickSetup');
  const me = s.me;
  const mine = await visible(Object.keys(s.territories).filter((id) => s.territories[id].owner === me));
  await shot('03-setup');
  await tap(mine[0]);
  await page.getByRole('button', { name: /^Rest/ }).click();
  await page.getByRole('button', { name: 'Bestätigen' }).click();
  await tap(mine[0]);
  await tap(mine[1] ?? mine[0]);
  const land = mine.find((id) => !id.startsWith('NOR') && !id.startsWith('PEL') && !id.startsWith('ABY') && !id.startsWith('KOR') && !id.startsWith('SUD'));
  await tap(land);
  await shot('04-setup-units');
  await page.getByRole('button', { name: 'Aufstellung abschließen' }).click();

  // ---- Gebot
  s = await waitMine((x) => x.phase === 'bid' || x.phase === 'pickSlot' || x.phase === 'turn', 'bid');
  if (s.phase === 'bid') {
    await shot('05-bid');
    await page.getByRole('button', { name: 'Gebot verbindlich abgeben' }).click();
  }
  s = await waitMine((x) => x.phase === 'turn' || (x.phase === 'pickSlot' && x.pickQueue[0] === me), 'pickSlot/turn');
  if (s.phase === 'pickSlot') {
    await shot('06-pickslot');
    await page.locator('.box .btn.primary').first().click();
  }

  // ---- Eigener Zug
  s = await waitMine((x) => x.phase === 'turn' && x.turn && x.turn.player === me, 'eigener Zug', 120000);
  await shot('07-deploy');
  const owned = await visible(Object.keys(s.territories).filter((id) => s.territories[id].owner === me));
  // Grenzgebiet mit Gegner suchen
  const map = await page.evaluate(async () => null);
  await tap(owned[0]);
  await page.getByRole('button', { name: /^Rest/ }).click();
  await page.getByRole('button', { name: 'Bestätigen' }).click();
  await page.getByRole('button', { name: 'Weiter: Karten kaufen' }).waitFor();
  await shot('08-hire');
  await page.getByRole('button', { name: 'Weiter: Karten kaufen' }).click();
  await page.getByText('Kommandokarten kaufen').waitFor();
  await page.locator('.deck:not(.locked) .stepper button').nth(1).click();
  await shot('09-buy');
  await page.getByRole('button', { name: /^Kaufen/ }).click();
  await page.getByText('Karten spielen & Invasionen').waitFor();
  s = await state();
  // Angriffsquelle mit Ziel finden (über die Engine-Regeln im Client: markierte Ziele)
  let attacked = false;
  const sources = (await visible(Object.keys(s.territories))).filter((id) => s.territories[id].owner === me && (s.territories[id].mods + s.territories[id].commanders.length) >= 2)
    .sort((a, b) => (s.territories[b].mods) - (s.territories[a].mods));
  console.log('Quellen:', sources.length);
  for (const src of sources) {
    await tap(src);
    await page.waitForTimeout(250);
    const targets = await page.locator('g.terr path.pulse').count();
    if (!targets) continue;
    await shot('10-source-selected');
    // sichtbares gegnerisches Ziel wählen (andere wären per Wischen erreichbar)
    const box = await page.locator('svg.board').boundingBox();
    let tid = null;
    for (const h of await page.locator('g.terr path.pulse').all()) {
      const id = await h.evaluate((el) => el.parentElement.getAttribute('data-tid'));
      const bb = await visibleBadge(id);
      const o = s.territories[id].owner;
      if (bb && o && o !== me && bb.y > box.y + 40) { tid = id; break; }
    }
    if (!tid) continue;
    await tap(tid);
    await page.getByRole('button', { name: 'Angriff erklären' }).click();
    await page.getByRole('button', { name: 'Würfeln' }).waitFor();
    await shot('11-attack');
    await page.getByRole('button', { name: 'Würfeln' }).click();
    await page.waitForTimeout(600);
    await shot('12-after-roll');
    s = await state();
    if (s.invasion && s.invasion.awaitingAdvance) {
      await page.getByRole('button', { name: /^Nachziehen/ }).click();
    } else if (s.invasion) {
      await page.getByRole('button', { name: 'Abbrechen' }).click();
    }
    attacked = true;
    break;
  }
  console.log('Angriff durchgeführt:', attacked);
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Weiter: Truppenbewegung' }).click();
  await shot('13-fortify');
  await page.getByRole('button', { name: 'Zug beenden' }).click();
  await page.waitForTimeout(800);

  // Tabs
  await page.getByRole('button', { name: /Hand/ }).last().click();
  await shot('14-hand');
  await page.getByRole('button', { name: /Spieler/ }).last().click();
  await shot('15-players');
  await page.getByRole('button', { name: /Protokoll/ }).last().click();
  await shot('16-log');
  await page.getByRole('button', { name: /Karte/ }).last().click();
  await page.getByRole('button', { name: 'Mond' }).click();
  await shot('17-moon');

  // Rest der Partie an Bot abgeben und auf Spielende warten
  await page.evaluate(async (id) => fetch(`/api/games/${id}/command`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd: { t: 'Resign' } }) }), gameId);
  await waitMine((x) => x.phase === 'gameOver', 'Spielende', 300000);
  await page.getByRole('button', { name: 'Planet' }).click();
  await page.waitForTimeout(1500);
  await shot('18-gameover');
  // Tablet-Ansicht
  const tablet = await browser.newContext({ ...devices['iPad (gen 7) landscape'] });
  const tp = await tablet.newPage();
  await tp.goto(BASE);
  await tp.getByLabel('Name').fill(USER);
  await tp.getByLabel('Passwort').fill('geheim123');
  await tp.locator('form .btn.ok').click();
  await tp.getByText('Hallo ' + USER).waitFor();
  await tp.screenshot({ path: `${SHOTS}/19-tablet-lobby.png` });
  await tp.goto(`${BASE}/game/${gameId}`);
  await tp.locator('svg.board').waitFor();
  await tp.waitForTimeout(1200);
  await tp.screenshot({ path: `${SHOTS}/20-tablet-game.png` });
  console.log('E2E OK');
  await browser.close();
})().catch((e) => { console.error('E2E FEHLER', e); process.exit(1); });
