// Regressionstests für die in "Spielbrett und Regelmechanik überarbeiten" beschriebenen Regelfehler.
// Jeder Test reproduziert den Fehler am Ausgangsstand c7e5bfb (dort schlagen sie fehl) und sichert die Korrektur ab.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyCommand, units, invadeError, baseIncome, GameError, pendingActors } from '../src/engine/index.ts';
import type { GameState, Command } from '../src/engine/index.ts';

function game(n = 3, seed = '0123456789abcdef0123456789abcdef'): GameState {
  const s = createGame({
    players: Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, color: '#000' })),
    seedHex: seed, commitment: 'x',
    // Szenarien mit festen Gebiets-IDs nutzen den Graphen der Kartenrevision 2 (Erdkarte: tests/earth.test.ts)
    mapId: 'kepler-colonies-2',
  });
  for (const t of Object.values(s.territories)) Object.assign(t, { owner: null, mods: 0, commanders: [], station: false, devastated: false });
  for (const p of s.players) p.energy = 20;
  s.phase = 'turn';
  s.year = 1;
  s.turnOrder = s.seatOrder.filter((x) => x !== 'neutral');
  s.turnIndex = s.turnOrder.indexOf('p1');
  s.turn = { player: 'p1', step: 'main', incomeMods: 0, boughtCards: true, invaded: false, contestedConquests: 0, bonusAwarded: false, bonusCardPending: false, fortifiesLeft: 1, conqueredLand: 0 };
  // Jeder Spieler braucht irgendwo Einheiten, sonst gilt er als ausgeschieden
  return s;
}
function put(s: GameState, id: string, owner: string, mods: number, commanders: string[] = [], station = false) {
  Object.assign(s.territories[id], { owner, mods, commanders, station });
}
function give(s: GameState, pid: string, card: string) {
  s.players.find((p) => p.id === pid)!.hand.push(card);
  for (const d of Object.keys(s.decks) as (keyof GameState['decks'])[]) s.decks[d] = s.decks[d].filter((c) => c !== card);
}
const apply = (s: GameState, pid: string, cmd: Command) => applyCommand(s, pid, cmd);
function rejects(s: GameState, pid: string, cmd: unknown, re?: RegExp) {
  const before = JSON.stringify(s);
  assert.throws(() => applyCommand(s, pid, cmd as Command), (e: unknown) => e instanceof GameError && (!re || re.test((e as Error).message)), `sollte abgelehnt werden: ${JSON.stringify(cmd)}`);
  assert.equal(JSON.stringify(s), before, 'abgelehnter Befehl darf den Zustand nicht verändern');
}

// ---------------------------------------------------------------- 3.1 Erdlandung
test('3.1 Erdlandung auf eigenes Gebiet ist eine Verlegung ohne Kampf', () => {
  let s = game();
  put(s, 'HOC-3', 'p1', 4);                         // eigenes Mondgebiet, kein Landeplatz
  put(s, 'BOR-1', 'p1', 2);                         // eigenes Ziel
  put(s, 'KAS-10', 'p1', 3, ['SPACE'], true);
  put(s, 'SAH-1', 'p2', 3); put(s, 'VEL-1', 'p3', 3);
  s.effects.push({ id: 99, kind: 'earthLanding', owner: 'p1', territory: 'BOR-1', expires: { at: 'turnEnd', player: 'p1' } });
  assert.equal(invadeError(s, 'p1', 'HOC-3', 'BOR-1'), null);
  rejects(s, 'p1', { t: 'Invade', from: 'HOC-3', to: 'BOR-1', move: { mods: 4, commanders: [] } }, /zurückbleiben/);
  s = apply(s, 'p1', { t: 'Invade', from: 'HOC-3', to: 'BOR-1', move: { mods: 2, commanders: [] } });
  assert.equal(s.invasion, null, 'keine Invasion gegen eigene Einheiten');
  assert.equal(s.territories['BOR-1'].mods, 4);
  assert.equal(s.territories['HOC-3'].mods, 2);
  assert.equal(s.turn!.contestedConquests, 0);
  assert.ok(!s.effects.some((e) => e.kind === 'earthLanding'), 'Gelegenheit verbraucht');
  assert.ok(!s.log.some((e) => e.kind === 'battle'));
});

test('3.1 Erdlandung auf Gegner = normale Invasion, auf freies Ziel = Besetzung; ohne Raum-Kdt nicht erlaubt', () => {
  const base = game();
  put(base, 'HOC-3', 'p1', 4);
  put(base, 'KAS-10', 'p1', 3, ['SPACE'], true);
  put(base, 'SAH-1', 'p2', 3); put(base, 'VEL-1', 'p3', 3);
  base.effects.push({ id: 99, kind: 'earthLanding', owner: 'p1', territory: 'SAH-1', expires: { at: 'turnEnd', player: 'p1' } });
  const s = apply(base, 'p1', { t: 'Invade', from: 'HOC-3', to: 'SAH-1' });
  assert.ok(s.invasion && s.invasion.defender === 'p2');
  const noSpace = structuredClone(base);
  noSpace.territories['KAS-10'].commanders = [];
  rejects(noSpace, 'p1', { t: 'Invade', from: 'HOC-3', to: 'SAH-1' }, /Raum/);
  const free = structuredClone(base);
  free.effects[0].territory = 'BOR-2';
  const f = apply(free, 'p1', { t: 'Invade', from: 'HOC-3', to: 'BOR-2', move: { mods: 2, commanders: [] } });
  assert.equal(f.territories['BOR-2'].owner, 'p1');
  assert.equal(f.invasion, null);
});

// ---------------------------------------------------------------- 3.2 Taktischer Sprengkopf
function warheadSetup(n: number, station = false) {
  const s = game(n);
  put(s, 'KAS-10', 'p1', 6, ['NUCLEAR']);
  put(s, 'SAH-1', 'p2', 1, [], station);           // letzter Verteidiger von p2
  if (n > 2) put(s, 'VEL-1', 'p3', 3);
  give(s, 'p1', 'NUC-06#1');
  return s;
}
test('3.2 Sprengkopf entfernt letzten Verteidiger: Nachrücken, dann Übernahme, Ausscheiden, Wertung (2 Spieler)', () => {
  let s = warheadSetup(2);
  s = apply(s, 'p1', { t: 'Invade', from: 'KAS-10', to: 'SAH-1' });
  s = apply(s, 'p1', { t: 'PlayCard', card: 'NUC-06#1' });
  assert.equal(s.phase, 'turn', 'Spiel darf nicht vor dem Nachrücken enden');
  assert.ok(s.invasion?.awaitingAdvance);
  assert.equal(s.invasion?.defender, 'p2');
  s = apply(s, 'p1', { t: 'Advance', move: { mods: 1, commanders: [] } });
  assert.equal(s.territories['SAH-1'].owner, 'p1');
  assert.equal(s.phase, 'gameOver');
  assert.ok(s.players.find((p) => p.id === 'p2')!.eliminated);
  const line = s.scores!.find((l) => l.player === 'p1')!;
  assert.equal(line.territories, 2, 'erobertes Ziel zählt in der Wertung');
  assert.equal(s.log.filter((e) => e.msg.startsWith('Endstand')).length, 1, 'Wertung genau einmal');
});
test('3.2 Sprengkopf mit Station im Ziel und weiteren Mitspielern', () => {
  let s = warheadSetup(3, true);
  s = apply(s, 'p1', { t: 'Invade', from: 'KAS-10', to: 'SAH-1' });
  s = apply(s, 'p1', { t: 'PlayCard', card: 'NUC-06#1' });
  assert.ok(s.invasion?.awaitingAdvance);
  assert.equal(s.territories['SAH-1'].station, true);
  s = apply(s, 'p1', { t: 'Advance', move: { mods: 1, commanders: [] } });
  assert.equal(s.territories['SAH-1'].owner, 'p1');
  assert.equal(s.territories['SAH-1'].station, true, 'Station übernommen');
  assert.ok(s.players.find((p) => p.id === 'p2')!.eliminated);
  assert.equal(s.phase, 'turn', 'Partie läuft mit p3 weiter');
  assert.equal(s.turn!.contestedConquests, 1, 'Ziel war bei der Erklärung umkämpft');
});

// ---------------------------------------------------------------- 3.3 Kommandantenverlust
test('3.3 Fällt der Marine-Kdt, ist der nächste Wurf ins Wasser unzulässig', () => {
  let s = game();
  put(s, 'KAS-8', 'p1', 6);
  put(s, 'KAS-7', 'p1', 1, ['NAVAL']);
  put(s, 'KOR-1', 'p2', 5); put(s, 'VEL-1', 'p3', 3);
  s = apply(s, 'p1', { t: 'Invade', from: 'KAS-8', to: 'KOR-1' });
  s.territories['KAS-7'].commanders = [];           // Marine-Kdt fällt (z. B. durch Reaktion)
  rejects(s, 'p1', { t: 'Attack' }, /Marine/);
  const r = apply(s, 'p1', { t: 'Retreat' });        // sauberer Abbruch möglich
  assert.equal(r.invasion, null);
});
test('3.3 Blitz stoppt, sobald der Marine-Kdt im Quellgebiet fällt', () => {
  let found = 0;
  for (let i = 0; i < 300 && found < 3; i++) {
    let s = game(3, i.toString(16).padStart(32, '0'));
    put(s, 'KOR-1', 'p1', 0, ['DIPLOMAT', 'LAND', 'NUCLEAR', 'NAVAL']); // Marine fällt zuerst
    put(s, 'KOR-2', 'p2', 9); put(s, 'VEL-1', 'p3', 3);
    s = apply(s, 'p1', { t: 'Invade', from: 'KOR-1', to: 'KOR-2' });
    s = apply(s, 'p1', { t: 'Attack', blitz: true, minRemaining: 1 });
    const naval = Object.values(s.territories).some((t) => t.owner === 'p1' && t.commanders.includes('NAVAL'));
    if (naval || !s.invasion || s.invasion.awaitingAdvance) continue;
    found++;
    const battle = s.log.filter((e) => e.kind === 'battle').at(-1)!;
    const rolls = battle.data!.rolls as { attLoss: number }[];
    // Nach dem Wurf, in dem der Kdt fiel, darf kein weiterer Wurf folgen
    let lost = 0;
    const needed = 1; // NAVAL steht an letzter Stelle -> fällt beim ersten Verlust
    let rollOfDeath = -1;
    rolls.forEach((r, k) => { lost += r.attLoss; if (rollOfDeath < 0 && lost >= needed) rollOfDeath = k; });
    assert.equal(rollOfDeath, rolls.length - 1, 'nach dem Verlust des Marine-Kdt wurde weitergewürfelt');
    assert.match(String(battle.data!.stopReason ?? ''), /Marine/);
  }
  assert.ok(found > 0, 'Szenario mit gefallenem Marine-Kdt gefunden');
});

// ---------------------------------------------------------------- 3.4 W6/W8-Wahl
test('3.4 Angreifer kann auf W8 verzichten; Nachrückpflicht folgt dem letzten Wurf', () => {
  let s = game();
  put(s, 'KAS-10', 'p1', 6, ['LAND']);
  put(s, 'SAH-1', 'p2', 1); put(s, 'VEL-1', 'p3', 3);
  s = apply(s, 'p1', { t: 'Invade', from: 'KAS-10', to: 'SAH-1' });
  for (let i = 0; i < 20 && s.invasion && !s.invasion.awaitingAdvance; i++) {
    s = apply(s, 'p1', { t: 'Attack', dice: 3, d8: [] } as Command);
  }
  const rolls = s.log.filter((e) => e.kind === 'battle').flatMap((e) => e.data!.rolls as { attSides: number[] }[]);
  assert.ok(rolls.length > 0 && rolls.every((r) => r.attSides.every((x) => x === 6)), 'nur W6 gewürfelt');
  assert.ok(s.invasion?.awaitingAdvance);
  assert.deepEqual(s.invasion!.lastD8Commanders, []);
  s = apply(s, 'p1', { t: 'Advance', move: { mods: 3, commanders: [] } }); // Land-Kdt muss nicht mit
  assert.ok(s.territories['KAS-10'].commanders.includes('LAND'));
});
test('3.4 Ungültige W8-Auswahl wird abgelehnt; altes Befehlsformat nutzt W8 weiter', () => {
  let s = game();
  put(s, 'KAS-10', 'p1', 6, ['LAND', 'DIPLOMAT']);
  put(s, 'SAH-1', 'p2', 3); put(s, 'VEL-1', 'p3', 3);
  s = apply(s, 'p1', { t: 'Invade', from: 'KAS-10', to: 'SAH-1' });
  rejects(s, 'p1', { t: 'Attack', dice: 3, d8: ['DIPLOMAT'] }, /W8/);
  rejects(s, 'p1', { t: 'Attack', dice: 3, d8: ['NAVAL'] }, /W8/);
  rejects(s, 'p1', { t: 'Attack', dice: 3, d8: ['LAND', 'LAND'] });
  rejects(s, 'p1', { t: 'Attack', dice: 3, d8: 'LAND' });
  const r = apply(s, 'p1', { t: 'Attack', dice: 3 });
  const roll = (r.log.filter((e) => e.kind === 'battle').at(-1)!.data!.rolls as { attSides: number[] }[])[0];
  assert.equal(roll.attSides.filter((x) => x === 8).length, 1, 'Standard: berechtigter Kdt würfelt W8');
});

// ---------------------------------------------------------------- 3.5 Bonuskarte
function bonusSetup() {
  const s = game();
  put(s, 'KAS-10', 'p1', 6, ['LAND']);
  put(s, 'SAH-1', 'p2', 0); put(s, 'VEL-1', 'p3', 3);
  s.turn!.contestedConquests = 2;
  s.invasion = { attacker: 'p1', defender: 'p2', from: 'KAS-10', to: 'SAH-1', rolls: 1, contested: true, mods: { played: [] }, lastAttDice: 1, lastD8Commanders: [], awaitingAdvance: true };
  return s;
}
test('3.5 Nach der dritten umkämpften Eroberung muss zuerst die Bonuskarte gewählt werden', () => {
  let s = bonusSetup();
  const e0 = s.players[0].energy;
  s = apply(s, 'p1', { t: 'Advance', move: { mods: 1, commanders: [] } });
  assert.equal(s.players[0].energy, e0 + 1);
  assert.ok(s.turn!.bonusCardPending);
  rejects(s, 'p1', { t: 'EndPhase' }, /Bonuskarte/);
  rejects(s, 'p1', { t: 'EndTurn' }, /Bonuskarte/);
  rejects(s, 'p1', { t: 'ClaimBonusCard', deck: 'NAVAL' }, /Kommandant/);
  s = apply(s, 'p1', { t: 'ClaimBonusCard', deck: 'LAND' });
  assert.equal(s.turn!.bonusCardPending, false);
  assert.equal(s.players[0].hand.length, 1);
  s = apply(s, 'p1', { t: 'EndPhase' });
});
test('3.5 Ohne verfügbares Deck: nur Energie, keine blockierende Auswahl', () => {
  let s = bonusSetup();
  s.decks.LAND = [];
  s = apply(s, 'p1', { t: 'Advance', move: { mods: 1, commanders: [] } });
  assert.equal(s.turn!.bonusCardPending, false);
  s = apply(s, 'p1', { t: 'EndPhase' });
  assert.ok(pendingActors(s).length > 0);
});

// ---------------------------------------------------------------- 3.6 Startspieler und Validierung
test('3.6 Startspieler per W6-Wurf je Spieler ohne Sitzplatzverzerrung (4 und 5 Spieler)', () => {
  for (const n of [4, 5]) {
    const count = new Array(n).fill(0);
    const N = 1500;
    for (let i = 0; i < N; i++) {
      const s = createGame({ players: Array.from({ length: n }, (_, k) => ({ id: `p${k + 1}`, name: `P${k + 1}`, color: '#000' })), seedHex: (i * 7919 + 13).toString(16).padStart(32, 'a'), commitment: 'x', config: { setupMode: 'classic' } });
      count[Number(s.seatOrder[0].slice(1)) - 1]++;
      if (i < 3) {
        const msg = s.log.find((e) => e.msg.includes('beginnt die Aufstellung'))!;
        assert.match(msg.msg, /W6/, 'Würfe werden protokolliert');
      }
    }
    for (const c of count) assert.ok(Math.abs(c / N - 1 / n) < 0.05, `Startverteilung ${count.join('/')} bei ${n} Spielern`);
  }
});
test('3.6 Laufzeitvalidierung öffentlicher Befehle', () => {
  const s = game();
  put(s, 'KAS-10', 'p1', 6, ['LAND']);
  put(s, 'SAH-1', 'p2', 2); put(s, 'VEL-1', 'p3', 3);
  s.turn!.step = 'hire';
  rejects(s, 'p1', { t: 'HireCommander', type: 'FOO', territory: 'KAS-10' });
  rejects(s, 'p1', { t: 'HireCommander', type: 'NAVAL', territory: 42 });
  rejects(s, 'p1', { t: 'BuyCards', decks: ['FOO'] });
  rejects(s, 'p1', { t: 'BuyCards', decks: 'LAND' });
  rejects(s, 'p1', { t: 'Invade', from: 'KAS-10', to: 'SAH-1', move: { mods: 1.5, commanders: [] } });
  rejects(s, 'p1', { t: 'Fortify', from: 'KAS-10', to: 'SAH-1', move: { mods: 1, commanders: ['X'] } });
  rejects(s, 'p1', { t: 'Attack', dice: 7 });
  rejects(s, 'p1', { t: 'Attack', dice: 'drei' });
  rejects(s, 'p1', { t: 'Attack', minRemaining: -1 });
  rejects(s, 'p1', { t: 'Deploy', placements: { 'KAS-10': '3' } });
  rejects(s, 'p1', { t: 'Nonsense' });
  rejects(s, 'p1', null);
  const b = structuredClone(s);
  b.phase = 'pickSlot'; b.pickQueue = ['p1', 'p2', 'p3']; b.slots = [null, null, null];
  rejects(b, 'p1', { t: 'PickSlot', slot: 1.5 });
  rejects(b, 'p1', { t: 'PickSlot', slot: '1' });
  rejects(b, 'p1', { t: 'PickSlot', slot: 0 });
});

// ---------------------------------------------------------------- Karte / Ost-West-Landroute
test('Ost-West-Landroute je Kartenrevision; alte Partien behalten ihre Topologie', () => {
  const s = game();
  put(s, 'BOR-3', 'p1', 5); put(s, 'VEL-5', 'p2', 2); put(s, 'VEL-1', 'p3', 3);
  assert.equal(invadeError(s, 'p1', 'BOR-3', 'VEL-5'), null, 'Revision 2: Landroute ohne Marine-Kdt');
  const old = structuredClone(s);
  old.mapId = 'kepler-colonies';
  assert.match(String(invadeError(old, 'p1', 'BOR-3', 'VEL-5')), /benachbart/);
  // Revision 3 (Erde): Beringstraße Beringia <-> Fernost, ohne Marine-Kdt; die Rev.-2-Route existiert dort nicht
  const earth = structuredClone(s);
  earth.mapId = 'kepler-earth-3';
  assert.match(String(invadeError(earth, 'p1', 'BOR-3', 'VEL-5')), /benachbart/);
  put(earth, 'BOR-1', 'p1', 5); put(earth, 'KAS-4', 'p2', 2);
  assert.equal(invadeError(earth, 'p1', 'BOR-1', 'KAS-4'), null);
});

test('Score Chart: 45 Gebiete → 14 MODs und 14 Energie', () => {
  assert.equal(baseIncome(44), 14);
  assert.equal(baseIncome(45), 14);
  assert.equal(baseIncome(46), 15);
});

test('Abgelehnte Befehle verändern weder Zustand noch Version', () => {
  const s = game();
  put(s, 'KAS-10', 'p1', 6); put(s, 'SAH-1', 'p2', 2); put(s, 'VEL-1', 'p3', 3);
  rejects(s, 'p2', { t: 'Invade', from: 'SAH-1', to: 'KAS-10' }, /nicht am Zug/);
  assert.equal(s.version, 0);
});

test('Wertung enthält auch Spieler, die in einem früheren Jahr ausgeschieden sind', () => {
  let s = game(3);
  put(s, 'KAS-10', 'p1', 6); put(s, 'SAH-1', 'p2', 3);
  s.players.find((p) => p.id === 'p3')!.eliminated = true;
  s.turnOrder = ['p1', 'p2'];
  s.turnIndex = 0;
  s.year = 5;
  s = apply(s, 'p1', { t: 'EndTurn' });
  s = apply(s, 'p2', { t: 'Deploy', placements: { 'SAH-1': s.turn!.incomeMods } });
  s = apply(s, 'p2', { t: 'EndTurn' });
  assert.equal(s.phase, 'gameOver');
  assert.deepEqual(s.scores!.map((l) => l.player).sort(), ['p1', 'p2', 'p3']);
  assert.equal(s.scores!.find((l) => l.player === 'p3')!.rank, 3);
});

test('Alter Spielstand (c7e5bfb) lädt, läuft bis zum Ende und erhält keine neue Landroute', async () => {
  const { readFileSync } = await import('node:fs');
  const { botCommand, nbrs, project } = await import('../src/engine/index.ts');
  let s = JSON.parse(readFileSync(new URL('./fixtures/alte-partie-c7e5bfb.json', import.meta.url), 'utf8')) as GameState;
  assert.equal(s.mapId, 'kepler-colonies');
  assert.ok(!nbrs(s, 'BOR-3').includes('VEL-5'));
  assert.ok(project(s, 'p1').territories, 'Projektion für den Client funktioniert');
  let guard = 0;
  while (s.phase !== 'gameOver' && guard++ < 5000) {
    const pid = pendingActors(s)[0];
    s = applyCommand(s, pid, botCommand(s, pid)!);
    assert.equal(s.mapId, 'kepler-colonies');
    if (s.invasion) assert.ok(!(['BOR-3', 'VEL-5'].includes(s.invasion.from) && ['BOR-3', 'VEL-5'].includes(s.invasion.to)), 'keine Invasion über die neue Route');
  }
  assert.equal(s.phase, 'gameOver');
  const fresh = createGame({ players: [{ id: 'a', name: 'A', color: '#000' }, { id: 'b', name: 'B', color: '#111' }], seedHex: 'ab', commitment: 'x' });
  assert.equal(fresh.mapId, 'kepler-earth-3');
  assert.ok(nbrs(fresh, 'BOR-1').includes('KAS-4') && nbrs(fresh, 'KAS-4').includes('BOR-1'));
});
