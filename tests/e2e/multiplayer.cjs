// E2E: Zwei Menschen auf zwei Geräten (iPhone + Android) spielen gegeneinander (2er-Partie mit neutraler Armee).
// Aufruf: node tests/e2e/multiplayer.cjs [BASE_URL] [SCREENSHOT_DIR]
const { chromium, devices } = require('playwright');
const fs = require('fs');
const BASE = process.argv[2] || 'http://localhost:8210';
const SHOTS = process.argv[3] || './e2e-shots';
fs.mkdirSync(SHOTS, { recursive: true });
const sfx = Math.floor(Math.random() * 9000 + 1000);

async function player(browser, device, name) {
  const ctx = await browser.newContext({ ...devices[device] });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => { console.error(name, 'PAGEERROR', e.message); process.exitCode = 1; });
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Profil anlegen' }).first().click();
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Passwort').fill('geheim123');
  await page.locator('form .btn.ok').click();
  await page.getByText('Hallo ' + name).waitFor();
  return page;
}

async function stateOf(page, id) {
  return page.evaluate(async (gid) => (await (await fetch(`/api/games/${gid}/state`)).json()).state, id);
}
async function visible(page, ids) {
  const box = await page.locator('svg.board').boundingBox();
  const out = [];
  for (const id of ids) {
    const loc = page.locator(`g.badge[data-tid="${id}"] circle`);
    if (!(await loc.count())) continue;
    const bb = await loc.first().boundingBox({ timeout: 500 }).catch(() => null);
    if (bb && bb.x > box.x + 10 && bb.x < box.x + box.width - 10 && bb.y > box.y + 45 && bb.y < box.y + box.height - 50) out.push(id);
  }
  return out;
}
const tap = (page, id) => page.locator(`g.badge[data-tid="${id}"] circle`).first().click({ force: true });

async function quickSetup(page, id) {
  const s = await stateOf(page, id);
  const mine = await visible(page, Object.keys(s.territories).filter((t) => s.territories[t].owner === s.me));
  await tap(page, mine[0]);
  await page.getByRole('button', { name: /^Rest/ }).click();
  await page.getByRole('button', { name: 'Bestätigen' }).click();
  await tap(page, mine[0]);
  await tap(page, mine[1] ?? mine[0]);
  await tap(page, mine[0]);
  await page.getByRole('button', { name: 'Aufstellung abschließen' }).click();
}

async function waitFor(page, id, pred, label, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const s = await stateOf(page, id); if (pred(s)) return s; await page.waitForTimeout(400); }
  throw new Error('Timeout: ' + label);
}

(async () => {
  const browser = await chromium.launch();
  const a = await player(browser, 'iPhone 13', 'Anna' + sfx);
  const b = await player(browser, 'Pixel 7', 'Ben' + sfx);
  await a.getByRole('button', { name: '+ Neue Partie' }).click();
  await a.getByLabel('Name').fill('Duell ' + sfx);
  await a.locator('input[type=range]').nth(0).fill('2');
  await a.getByRole('button', { name: 'Partie anlegen' }).click();
  // Ben sieht die offene Partie live in der Lobby und tritt bei
  const card = b.locator('.gamecard', { hasText: 'Duell ' + sfx });
  await card.getByRole('button', { name: 'Beitreten' }).click();
  await a.locator('.gamecard', { hasText: 'Ben' + sfx }).waitFor();
  await a.screenshot({ path: `${SHOTS}/mp-01-lobby-host.png` });
  await a.locator('.gamecard', { hasText: 'Duell ' + sfx }).getByRole('button', { name: 'Starten' }).click();
  await a.locator('.gamecard', { hasText: 'Duell ' + sfx }).getByRole('button', { name: 'Öffnen' }).click();
  await b.locator('.gamecard', { hasText: 'Duell ' + sfx }).getByRole('button', { name: 'Öffnen' }).click();
  await a.waitForURL(/\/game\//);
  await b.waitForURL(/\/game\//);
  const id = a.url().split('/game/')[1];
  await a.locator('svg.board').waitFor();
  await b.locator('svg.board').waitFor();
  await a.waitForTimeout(800);

  await quickSetup(a, id);
  await quickSetup(b, id);
  let s = await waitFor(a, id, (x) => x.phase === 'bid', 'Gebotsphase');
  console.log('Neutrale Gebiete:', Object.values(s.territories).filter((t) => t.owner === 'neutral').length);
  for (const p of [a, b]) await p.getByRole('button', { name: 'Gebot verbindlich abgeben' }).click();
  s = await waitFor(a, id, (x) => x.phase === 'pickSlot' || x.phase === 'turn', 'Platzwahl');
  if (s.phase === 'pickSlot') {
    const picker = s.pickQueue[0] === s.me ? a : b;
    await picker.locator('.box .btn.primary').first().click();
  }
  s = await waitFor(a, id, (x) => x.phase === 'turn', 'erster Zug');
  const first = s.turn.player === s.me ? a : b;
  const second = first === a ? b : a;
  await second.waitForTimeout(800);
  await second.screenshot({ path: `${SHOTS}/mp-02-waiting.png` });
  // Erster Spieler: einsetzen, Phasen überspringen, Zug beenden
  const fs1 = await stateOf(first, id);
  const own = await visible(first, Object.keys(fs1.territories).filter((t) => fs1.territories[t].owner === fs1.me));
  await tap(first, own[0]);
  await first.getByRole('button', { name: /^Rest/ }).click();
  await first.getByRole('button', { name: 'Bestätigen' }).click();
  await first.getByRole('button', { name: 'Weiter: Karten kaufen' }).click();
  await first.getByRole('button', { name: 'Überspringen' }).click();
  await first.getByRole('button', { name: 'Weiter: Truppenbewegung' }).click();
  await first.getByRole('button', { name: 'Zug beenden' }).click();
  // Zweiter Spieler bekommt live den Zug
  await second.getByText('Einsetzen:').waitFor({ timeout: 15000 });
  await second.screenshot({ path: `${SHOTS}/mp-03-second-turn.png` });
  console.log('Multiplayer E2E OK');
  await browser.close();
})().catch((e) => { console.error('E2E FEHLER', e); process.exit(1); });
