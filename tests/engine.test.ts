import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, applyCommand, project, baseIncome, CARD_DEFS, CARD, invadeError, planDice, conquestProbability,
  computeIncome, pathExists, TDEF, IDS_BY_TYPE, LANDING_SITES, REGION_MEMBERS, units,
} from '../src/engine/index.ts';
import type { GameState, Invasion } from '../src/engine/index.ts';
import { runGame, checkInvariants } from '../src/tools/simulate.ts';

function blankGame(n = 3): GameState {
  const s = createGame({
    players: Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, color: '#000', isBot: true })),
    seedHex: '0123456789abcdef0123456789abcdef', commitment: 'x',
  });
  // Brett leeren für kontrollierte Szenarien
  for (const t of Object.values(s.territories)) Object.assign(t, { owner: null, mods: 0, commanders: [], station: false, devastated: false });
  s.phase = 'turn';
  s.year = 1;
  s.turnOrder = s.seatOrder;
  s.turn = { player: 'p1', step: 'main', incomeMods: 0, boughtCards: true, invaded: false, contestedConquests: 0, bonusAwarded: false, bonusCardPending: false, fortifiesLeft: 1, conqueredLand: 0 };
  return s;
}
function put(s: GameState, id: string, owner: string, mods: number, commanders: string[] = [], station = false) {
  Object.assign(s.territories[id], { owner, mods, commanders, station });
}

test('Score-Chart-Tabelle (Regelheft S. 3) inkl. Abweichung bei 45', () => {
  const expected: Record<number, number> = { 1: 3, 11: 3, 12: 4, 14: 4, 15: 5, 16: 5, 17: 5, 18: 6, 20: 6, 41: 13, 42: 14, 44: 14, 45: 14, 46: 15, 47: 15, 48: 16, 65: 21, 69: 23, 70: 23 };
  for (const [n, v] of Object.entries(expected)) assert.equal(baseIncome(Number(n)), v, `Feld ${n}`);
  for (let n = 1; n <= 70; n++) if (n !== 45) assert.equal(baseIncome(n), Math.max(3, Math.floor(n / 3)), `Feld ${n}`);
});

test('Karten: 5 Decks à 20 Karten, 67 Typen', () => {
  assert.equal(CARD_DEFS.length, 67);
  for (const d of ['LAND', 'NAVAL', 'SPACE', 'NUCLEAR', 'DIPLOMAT']) {
    assert.equal(CARD_DEFS.filter((c) => c.deck === d).reduce((n, c) => n + c.copies, 0), 20, d);
  }
  for (const c of CARD_DEFS) assert.ok(c.powerUp >= 0 && c.powerUp <= 4, c.id);
});

test('Karte: 42 Land, 13 Wasser, 14 Mond, 3 Landeplätze, Mondkolonien 6/4/4', () => {
  assert.equal(IDS_BY_TYPE.land.length, 42);
  assert.equal(IDS_BY_TYPE.water.length, 13);
  assert.equal(IDS_BY_TYPE.moon.length, 14);
  assert.equal(LANDING_SITES.length, 3);
  assert.deepEqual(['HOC', 'TEN', 'POL'].map((r) => REGION_MEMBERS[r].length), [6, 4, 4]);
  for (const t of Object.values(TDEF)) for (const n of t.adjacent) assert.ok(TDEF[n].adjacent.includes(t.id), `Symmetrie ${t.id}-${n}`);
});

test('Setup: 4 verwüstete Gebiete, Startenergie 3, Schnellaufstellung verteilt alle Landgebiete', () => {
  const s = createGame({ players: [1, 2, 3, 4].map((i) => ({ id: `p${i}`, name: `P${i}`, color: '#000' })), seedHex: 'ab', commitment: 'x' });
  assert.equal(Object.values(s.territories).filter((t) => t.devastated).length, 4);
  assert.ok(s.players.every((p) => p.energy === 3));
  const free = IDS_BY_TYPE.land.filter((id) => !s.territories[id].devastated && !s.territories[id].owner);
  assert.equal(free.length, 0);
  for (const p of s.players) assert.equal(s.setup!.remaining[p.id] + Object.values(s.territories).filter((t) => t.owner === p.id).length, 30);
});

test('2 Spieler: neutrale Armee 16/6/6 mit je 3 MODs', () => {
  const s = createGame({ players: [1, 2].map((i) => ({ id: `p${i}`, name: `P${i}`, color: '#000' })), seedHex: 'cd', commitment: 'x' });
  const neutral = Object.entries(s.territories).filter(([, t]) => t.owner === 'neutral');
  const byType = (k: string) => neutral.filter(([id]) => TDEF[id].type === k).length;
  assert.deepEqual([byType('land'), byType('water'), byType('moon')], [16, 6, 6]);
  assert.ok(neutral.every(([, t]) => t.mods === 3));
});

test('W8-Regel "von oder in" (R21) und Stationsverteidigung (R22)', () => {
  const s = blankGame();
  const land = 'KAS-10';
  const water = 'KOR-1';
  put(s, land, 'p1', 5, ['LAND', 'NAVAL', 'DIPLOMAT']);
  put(s, water, 'p2', 2, [], false);
  const inv = { attacker: 'p1', from: land, to: water, mods: { played: [] } } as unknown as Invasion;
  const plan = planDice(s, inv, 3, 2);
  // Land (von Land) + Marine (in Wasser) liefern W8, Diplomat nie
  assert.deepEqual(plan.attSides.filter((x) => x === 8).length, 2);
  put(s, 'KAS-8', 'p2', 3, [], true);
  const inv2 = { attacker: 'p1', from: land, to: 'KAS-8', mods: { played: [] } } as unknown as Invasion;
  assert.deepEqual(planDice(s, inv2, 3, 2).defSides, [8, 8]);
});

test('Wasser und Mond erfordern Kommandanten im Spiel; Mond nur von Station auf Landeplatz', () => {
  const s = blankGame();
  put(s, 'KAS-10', 'p1', 5, ['LAND']);
  put(s, 'KOR-1', 'p2', 1);
  assert.match(invadeError(s, 'p1', 'KAS-10', 'KOR-1')!, /Marine/);
  put(s, 'KAS-7', 'p1', 1, ['NAVAL']);
  assert.equal(invadeError(s, 'p1', 'KAS-10', 'KOR-1'), null);
  // Mond
  assert.match(invadeError(s, 'p1', 'KAS-10', 'HOC-1')!, /Station/);
  s.territories['KAS-10'].station = true;
  assert.match(invadeError(s, 'p1', 'KAS-10', 'HOC-1')!, /Raum/);
  s.territories['KAS-7'].commanders.push('SPACE');
  assert.equal(invadeError(s, 'p1', 'KAS-10', 'HOC-1'), null);
  assert.match(invadeError(s, 'p1', 'KAS-10', 'HOC-3')!, /Landeplätze/);
  // Mond -> Erde nur per Karte
  put(s, 'HOC-1', 'p1', 3);
  put(s, 'BOR-1', 'p2', 1);
  assert.match(invadeError(s, 'p1', 'HOC-1', 'BOR-1')!, /Erdlandung/);
});

test('Truppenbewegung über Pfad eigener Gebiete inkl. Station <-> Landeplatz (R32)', () => {
  const s = blankGame();
  put(s, 'KAS-10', 'p1', 3, [], true);
  put(s, 'KAS-7', 'p1', 1);
  put(s, 'KAS-1', 'p1', 1);
  put(s, 'HOC-1', 'p1', 1);
  put(s, 'HOC-3', 'p1', 1);
  assert.ok(pathExists(s, 'p1', 'KAS-10', 'KAS-1'));
  assert.ok(pathExists(s, 'p1', 'KAS-10', 'HOC-3'));
  put(s, 'KAS-7', 'p2', 1);
  assert.ok(!pathExists(s, 'p1', 'KAS-10', 'KAS-1') || TDEF['KAS-10'].adjacent.includes('KAS-1'));
});

test('Einkommen: Energie = MODs, Boni für MODs und Energie, verwüstete Gebiete zählen nicht', () => {
  const s = blankGame();
  for (const id of REGION_MEMBERS.INS) put(s, id, 'p1', 1);
  s.territories['INS-4'].owner = null; s.territories['INS-4'].mods = 0; s.territories['INS-4'].devastated = true;
  const inc = computeIncome(s, 'p1');
  assert.equal(inc.territories, 3);
  assert.equal(inc.base, 3);
  assert.equal(inc.bonus, 2);
  assert.equal(inc.energy, inc.mods);
});

test('Projektion verrät keine fremden Handkarten oder Gebote', () => {
  const { s } = runGame(3, 'quick', 'feedfacefeedfacefeedfacefeedface');
  const p1 = project(s, 'p1');
  for (const p of p1.players) if (p.id !== 'p1') assert.equal(p.hand.length, 0);
  assert.ok(!('rng' in p1) && !('decks' in p1));
  assert.ok(p1.log.every((e) => !e.to || e.to === 'p1'));
});

test('Bot-gegen-Bot: Partien mit 2–5 Spielern laufen regelkonform bis zur Wertung', () => {
  for (const n of [2, 3, 4, 5]) {
    for (let i = 0; i < 3; i++) {
      const { s } = runGame(n, i % 2 ? 'classic' : 'quick');
      assert.equal(s.phase, 'gameOver');
      assert.ok(s.scores && s.scores.length === n);
      assert.ok(s.winner && s.winner.length >= 1);
      checkInvariants(s);
    }
  }
});

test('Reaktionskarten werden automatisch gespielt', () => {
  let reactions = 0;
  for (let i = 0; i < 6; i++) {
    const { s } = runGame(4, 'quick');
    reactions += s.log.filter((e) => e.kind === 'card' && ['REA', 'ERO', 'KAR'].includes(CARD[String(e.data?.card)]?.timing)).length;
  }
  assert.ok(reactions > 0, 'mindestens eine automatische Reaktion');
});

test('Befehle außerhalb des eigenen Zugs werden abgelehnt', () => {
  const s = blankGame();
  put(s, 'KAS-10', 'p1', 3);
  put(s, 'KAS-7', 'p2', 1);
  assert.throws(() => applyCommand(s, 'p2', { t: 'Invade', from: 'KAS-7', to: 'KAS-10' }), /nicht am Zug/);
  const s2 = applyCommand(s, 'p1', { t: 'Invade', from: 'KAS-10', to: 'KAS-7' });
  assert.ok(s2.invasion);
  assert.throws(() => applyCommand(s2, 'p1', { t: 'Retreat' }), /mindestens einmal/);
  assert.equal(units(s.territories['KAS-10']), 3, 'Ursprungszustand unverändert');
});

test('Gewinnwahrscheinlichkeit plausibel', () => {
  const p = conquestProbability(7, 2, 1, 0, 2);
  assert.ok(p > 0.9 && p < 1);
  assert.ok(conquestProbability(2, 10, 0, 0) < 0.01);
});
