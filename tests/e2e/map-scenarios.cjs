// E2E: Karten-Szenarien im Browser (benötigt Server mit ENABLE_TEST_API=1).
// Prüft Gesamtansicht, Legende, Antippen kleiner Wasserfelder, Landpassage ohne Marine, Wasserangriff ohne/mit Marine,
// Mondlandung von einer Station, Truppenbewegung vom Mond zurück, Kartenumlauf, Tablet-Querformat.
// Aufruf: node tests/e2e/map-scenarios.cjs [BASE_URL] [SCREENSHOT_DIR]
const { chromium, devices } = require('playwright');
const fs = require('fs');
const assert = require('assert');
const BASE = process.argv[2] || 'http://localhost:8210';
const SHOTS = process.argv[3] || './e2e-shots';
fs.mkdirSync(SHOTS, { recursive: true });
const USER = 'Karla' + Math.floor(Math.random() * 9000 + 1000);

(async () => {
  const browser = await chromium.launch();
  // schmales Smartphone (iPhone SE: 375 px) im Hochformat
  const ctx = await browser.newContext({ ...devices['iPhone SE'] });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => { console.error('PAGEERROR', e.message); process.exitCode = 1; });
  const shot = async (name, p = page) => { await p.waitForTimeout(350); await p.screenshot({ path: `${SHOTS}/${name}.png` }); console.log('📸', name); };
  const api = (path, body) => page.evaluate(async ([pa, b]) => {
    const r = await fetch(pa, { method: b ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
    return { status: r.status, json: await r.json() };
  }, [path, body]);
  let gameId;
  const raw = async () => (await api(`/api/test/games/${gameId}/state`)).json.state;
  const setState = async (s) => { s.log = s.log.slice(-15); const r = await api(`/api/test/games/${gameId}/state`, { state: s }); assert.equal(r.status, 200, JSON.stringify(r.json)); await page.waitForTimeout(500); };
  /** sichtbare Kopie eines Gebiets (Ost-West-Umlauf rendert Kopien) antippen; Wasserfelder über die Trefferfläche */
  const tap = async (tid, p = page) => {
    const box = await p.locator('svg.board').boundingBox();
    const cands = p.locator(`svg.board .landing-marker[data-tid="${tid}"] circle, svg.board path.hit[data-tid="${tid}"], svg.board g.badge[data-tid="${tid}"] circle.anchor`);
    const n = await cands.count();
    let best = null;
    for (let i = 0; i < n; i++) {
      const el = cands.nth(i);
      const cls = (await el.evaluate((e) => (e.getAttribute('class') || '') + ' ' + (e.parentElement?.getAttribute('class') || ''))) || '';
      const bb = await el.boundingBox().catch(() => null);
      if (!bb) continue;
      const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
      if (cx < box.x + 4 || cx > box.x + box.width - 52 || cy < box.y + 46 || cy > box.y + box.height - 4) continue;
      const score = (cls.includes('landing') ? 4 : cls.includes('hit') ? 3 : 2);
      if (!best || score > best.score) best = { cx, cy, score };
    }
    assert.ok(best, `Gebiet ${tid} nicht sichtbar`);
    await p.mouse.click(best.cx, best.cy);
    await p.waitForTimeout(250);
  };
  const isTarget = async (tid) => (await page.locator(`svg.board g.terr[data-tid="${tid}"] path.pulse`).count()) > 0;
  const zoomTo = async (n) => { for (let i = 0; i < n; i++) { await page.getByRole('button', { name: 'Hineinzoomen' }).click(); await page.waitForTimeout(80); } };
  const pan = async (dx, dy) => {
    const box = await page.locator('svg.board').boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 }); await page.mouse.move(x + dx, y + dy, { steps: 4 }); await page.mouse.up();
  };
  const centerOn = async (tid) => {
    // Kamera so verschieben, dass das Gebiet in der Mitte liegt
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

  // ---------------------------------------------------------------- Partie anlegen
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Profil anlegen' }).first().click();
  await page.getByLabel('Name').fill(USER);
  await page.getByLabel('Passwort').fill('geheim123');
  await page.locator('form .btn.ok').click();
  await page.getByText('Hallo ' + USER).waitFor();
  await page.getByRole('button', { name: '+ Neue Partie' }).click();
  await page.getByLabel('Name').fill('Kartentest');
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
  const bot = s.players.find((p) => p.isBot).id;
  const bot2 = s.players.filter((p) => p.isBot)[1].id;
  assert.equal(s.mapId, 'kepler-colonies-2', 'neue Partie nutzt Kartenrevision 2');

  // ---------------------------------------------------------------- 1. Gesamtansicht + Legende
  await page.waitForTimeout(600);
  const labels = await page.locator('svg.board .rlabel text').allTextContents();
  for (const name of ['Borea +4', 'Vellor +4', 'Kaskadia +6', 'Meridia +3', 'Sahari +3', 'Insula +2', 'Nordmeer +2', 'Pelagia +2', 'Abyssos +2', 'Korallensee +2', 'Südmeer +2']) {
    assert.ok(labels.some((t) => t.startsWith(name)), `Regionslabel ${name} in der Gesamtansicht`);
  }
  await shot('map-01-gesamtansicht-handy');
  await page.getByRole('button', { name: 'Legende' }).click();
  await shot('map-02-legende');
  await page.getByRole('button', { name: 'Legende' }).click();

  // ---------------------------------------------------------------- Szenario-Zustand
  const empty = (id) => Object.assign(s.territories[id], { owner: null, mods: 0, commanders: [], station: false, devastated: false });
  for (const id of Object.keys(s.territories)) empty(id);
  const put = (id, owner, mods, commanders = [], station = false) => Object.assign(s.territories[id], { owner, mods, commanders, station });
  put('KAS-10', me, 8, ['LAND']);          // Landpassage nach SAH-1 (Donnerkamm–Dünenmeer)
  put('KAS-8', me, 6, [], true);           // Station, Küste an Riffbank
  put('KAS-7', me, 1);
  put('SAH-1', bot, 1);
  put('KOR-1', bot, 1); put('KOR-2', bot, 1);
  put('NOR-1', bot2, 1); put('NOR-2', bot2, 1);
  put('BOR-3', me, 3); put('VEL-5', bot2, 1);
  put('INS-1', bot, 2);
  s.phase = 'turn'; s.year = 1; s.turnOrder = [me, bot, bot2]; s.turnIndex = 0; s.invasion = null; s.setup = null;
  s.turn = { player: me, step: 'main', incomeMods: 0, boughtCards: true, invaded: false, contestedConquests: 0, bonusAwarded: false, bonusCardPending: false, fortifiesLeft: 1, conqueredLand: 0 };
  s.players.forEach((p) => { p.energy = 20; p.hand = []; });
  await setState(s);

  // ---------------------------------------------------------------- 2. kleine Wasserfelder einzeln antippen
  await centerOn('NOR-1'); await zoomTo(2); await centerOn('NOR-1');
  await tap('NOR-1');
  await page.locator('.selinfo').getByText('Eisrinne').waitFor();
  await tap('NOR-2');
  await page.locator('.selinfo').getByText('Walgraben').waitFor();
  await shot('map-03-wasserfelder-antippen');

  // ---------------------------------------------------------------- 3. Landpassage ohne Marine-Kdt
  await page.getByRole('button', { name: 'Gesamtansicht' }).click();
  await centerOn('KAS-10'); await zoomTo(2); await centerOn('KAS-10');
  await tap('KAS-10');
  assert.ok(await isTarget('SAH-1'), 'Landpassage Donnerkamm → Dünenmeer ohne Marine');
  assert.ok(!(await isTarget('KOR-1')), 'Wasserziel ohne Marine-Kdt nicht wählbar');
  await shot('map-04-landpassage-ohne-marine');
  await tap('SAH-1');
  await page.getByRole('button', { name: 'Angriff erklären' }).click();
  await page.getByRole('button', { name: 'Würfeln' }).waitFor();
  // W8-Auswahl: Land-Kdt auf W6 umschalten
  await page.locator('button[data-d8="LAND"]').click();
  await shot('map-05-w6-statt-w8');
  for (let i = 0; i < 8; i++) {
    const st = await raw();
    if (!st.invasion || st.invasion.awaitingAdvance) break;
    await page.getByRole('button', { name: 'Würfeln' }).click();
    await page.waitForTimeout(500);
  }
  s = await raw();
  const rolls = s.log.filter((e) => e.kind === 'battle').flatMap((e) => e.data.rolls);
  assert.ok(rolls.length && rolls.every((r) => r.attSides.every((x) => x === 6)), 'Angreifer würfelte nur W6');
  if (s.invasion?.awaitingAdvance) await page.getByRole('button', { name: /^Nachziehen/ }).click();
  else if (s.invasion) await page.getByRole('button', { name: 'Abbrechen' }).click();
  await page.waitForTimeout(400);

  // ---------------------------------------------------------------- 4. Wasserangriff ohne / mit Marine
  s = await raw();
  s.invasion = null;
  s.turn.step = 'main';
  await setState(s);
  await page.getByRole('button', { name: 'Gesamtansicht' }).click();
  await centerOn('KAS-8'); await zoomTo(2); await centerOn('KAS-8');
  await tap('KAS-8');
  assert.ok(!(await isTarget('KOR-1')), 'ohne Marine-Kdt kein Angriff auf Riffbank');
  s = await raw();
  s.territories['KAS-7'].commanders = ['NAVAL'];
  await setState(s);
  await tap('KAS-7'); await tap('KAS-8');
  assert.ok(await isTarget('KOR-1'), 'mit Marine-Kdt (irgendwo im Spiel) Angriff auf Riffbank möglich');
  await centerOn('KOR-1');
  await shot('map-06-wasserangriff-mit-marine');
  await tap('KOR-1');
  await page.getByRole('button', { name: 'Angriff erklären' }).click();
  await page.getByRole('button', { name: 'Würfeln' }).waitFor();
  s = await raw();
  assert.ok(s.invasion && s.invasion.to === 'KOR-1');
  s.invasion = null; await setState(s);

  // ---------------------------------------------------------------- 5. Mondlandung von der Station
  s = await raw();
  s.territories['KAS-7'].commanders = ['NAVAL', 'SPACE'];
  await setState(s);
  await tap('KAS-7'); await tap('KAS-8');
  await page.getByRole('button', { name: /Mondlandung/ }).click();
  await page.locator('svg.board-moon').waitFor();
  for (const l of ['HOC-1', 'TEN-1', 'POL-1']) assert.ok(await isTarget(l), `Landeplatz ${l} markiert`);
  assert.ok(!(await isTarget('HOC-3')), 'Nicht-Landeplatz nicht markiert');
  await shot('map-07-mondlandung-ziele');
  await zoomTo(1); await centerOn('HOC-1');
  await tap('HOC-1');
  await shot('map-07b-nach-tipp');
  await page.getByRole('button', { name: 'Besetzen' }).click();
  await page.waitForTimeout(500);
  s = await raw();
  assert.equal(s.territories['HOC-1'].owner, me, 'Landeplatz Alpha besetzt');
  await shot('map-08-mond-besetzt');

  // ---------------------------------------------------------------- 6. Truppenbewegung vom Mond zurück (ohne Raum-Kdt)
  s = await raw();
  s.territories['KAS-7'].commanders = ['NAVAL'];          // Raum-Kdt nicht nötig für die Bewegung
  s.territories['HOC-1'].mods = 4;
  s.turn.step = 'fortify'; s.turn.invaded = true;
  await setState(s);
  // Quelle Kraterfeld (Station) ist noch gewählt -> Alpha ist Ziel; Richtung umkehren = vom Mond zurück
  await tap('HOC-1');
  await page.getByRole('button', { name: /Richtung umkehren/ }).click();
  await page.getByText('Verlegen: Landeplatz Alpha → Kraterfeld').waitFor();
  await shot('map-08b-mond-zurueck');
  // zusätzlich über das Brett: Auswahl aufheben, Alpha als Quelle, Planet zeigt das Stationsgebiet als Ziel
  await page.getByRole('button', { name: 'Zurück' }).click();
  await tap('HOC-1');                                   // erneut tippen = abwählen
  await tap('HOC-1');                                   // neue Quelle
  await page.getByText('Brett wechseln').first().click();
  await page.locator('svg.board-planet').waitFor();
  await page.getByRole('button', { name: 'Gesamtansicht' }).click();
  await centerOn('KAS-8'); await zoomTo(1); await centerOn('KAS-8');
  assert.ok(await isTarget('KAS-8'), 'Stationsgebiet als Ziel der Truppenbewegung vom Mond');
  await tap('KAS-8');
  await page.getByRole('button', { name: 'Verlegen' }).click();
  await page.waitForTimeout(500);
  s = await raw();
  assert.ok(s.territories['HOC-1'].mods < 4, 'Einheiten vom Mond verlegt');
  await shot('map-09-bewegung-vom-mond');

  // ---------------------------------------------------------------- 7. Ost-West-Landroute + Kartenumlauf
  s = await raw();
  s.turn.step = 'main'; s.turn.invaded = false; s.turn.fortifiesLeft = 1;
  await setState(s);
  await page.getByRole('button', { name: 'Gesamtansicht' }).click();
  await zoomTo(2);
  await centerOn('BOR-3');
  await pan(170, 0); // über den Westrand hinaus: Ostseite wird links angezeigt
  await page.waitForTimeout(200);
  await tap('BOR-3');
  assert.ok(await isTarget('VEL-5'), 'Landroute Kaltmark → Kupferhang über den Rand (ohne Marine)');
  await shot('map-10-ost-west-landroute');

  // Moon overview
  await page.getByRole('button', { name: 'Mond' }).click();
  await page.getByRole('button', { name: 'Gesamtansicht' }).click();
  await shot('map-11-mond-gesamtansicht');

  // ---------------------------------------------------------------- 8. Tablet-Querformat
  const tctx = await browser.newContext({ ...devices['iPad (gen 7) landscape'] });
  const tp = await tctx.newPage();
  await tp.goto(BASE);
  await tp.getByLabel('Name').fill(USER);
  await tp.getByLabel('Passwort').fill('geheim123');
  await tp.locator('form .btn.ok').click();
  await tp.getByText('Hallo ' + USER).waitFor();
  await tp.goto(`${BASE}/game/${gameId}`);
  await tp.locator('svg.board').waitFor();
  await tp.waitForTimeout(800);
  await shot('map-12-tablet-planet', tp);
  await tap('KOR-1', tp);
  await tp.waitForTimeout(300);
  await shot('map-13-tablet-routen-riffbank', tp);
  console.log('Karten-E2E OK');
  await browser.close();
})().catch((e) => { console.error('E2E FEHLER', e); process.exit(1); });
