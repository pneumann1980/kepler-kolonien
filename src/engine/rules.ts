// Regel-Engine: Spielaufbau, Gebote, Zugablauf, Invasionen, Truppenbewegung, Wertung
import {
  TDEF, RDEF, REGION_MEMBERS, TERRITORY_IDS, IDS_BY_TYPE, START_MODS, COSTS, MAX_STATIONS, MAX_CARD_BUY,
  DEVASTATED_AT_SETUP, TWO_PLAYER_NEUTRAL, NEUTRAL_ID, COMMANDER_NAMES, CURRENT_MAP_ID,
} from './content.ts';
import { seedFromHex, shuffle, roll } from './rng.ts';
import {
  fail, player, pname, tname, terr, units, owned, commanderInPlay, stationCount, totalUnits, activePlayers,
  log, findEffects, hasEffect, removeEffect, expireEffects, computeIncome, validateMove, moveUnits, removeUnits,
  checkElimination, takeOver, pathExists, controlledRegions, nbrs, adj,
} from './state.ts';
import { CARD, CARD_DEFS, buildDecks, cardType, validateTargets, type ReactionCtx, type Timing } from './cards.ts';
import { rollBattle, maxAttackDice, maxDefenseDice, qualifyingAttackCommanders } from './combat.ts';
import { validateCommand } from './validate.ts';
import type {
  GameState, GameConfig, Command, CommanderType, Player, TurnStep, UnitMove, ScoreLine, Targets, Invasion,
} from './types.ts';
import { STEP_ORDER, COMMANDER_TYPES, GameError } from './types.ts';

export interface NewPlayer { id: string; name: string; color: string; isBot?: boolean; botLevel?: number }

export const DEFAULT_CONFIG: GameConfig = { years: 5, setupMode: 'quick', startEnergy: 3 };

// =================================================================== Spielaufbau
export function createGame(opts: { players: NewPlayer[]; seedHex: string; commitment: string; config?: Partial<GameConfig>; mapId?: string }): GameState {
  const n = opts.players.length;
  if (n < 2 || n > 5) fail('2 bis 5 Spieler erforderlich');
  const config = { ...DEFAULT_CONFIG, ...opts.config };
  const s: GameState = {
    schema: 1, version: 0, mapId: opts.mapId ?? CURRENT_MAP_ID, config, seedCommitment: opts.commitment,
    rng: seedFromHex(opts.seedHex),
    players: opts.players.map((p) => ({
      id: p.id, name: p.name, color: p.color, isBot: Boolean(p.isBot), botLevel: p.botLevel ?? 1,
      energy: config.startEnergy, hand: [], eliminated: false, settings: { autoReact: {}, defendMax: true },
    })),
    seatOrder: opts.players.map((p) => p.id),
    territories: Object.fromEntries(TERRITORY_IDS.map((id) => [id, { owner: null, mods: 0, commanders: [], station: false, devastated: false }])),
    decks: buildDecks(), discard: [],
    territoryDecks: { land: [...IDS_BY_TYPE.land], water: [...IDS_BY_TYPE.water], moon: [...IDS_BY_TYPE.moon] },
    phase: 'quickSetup', year: 0, turnOrder: [], turnIndex: -1, turn: null, invasion: null,
    bids: {}, bidResult: null, pickQueue: [], slots: [], setup: null,
    effects: [], nextEffectId: 1, log: [], scores: null, winner: null,
  };
  for (const d of COMMANDER_TYPES) shuffle(s.rng, s.decks[d]);
  for (const k of ['land', 'water', 'moon'] as const) shuffle(s.rng, s.territoryDecks[k]);

  // Verwüstung: 4 Landkarten aufdecken, Karten aus dem Spiel
  const dev: string[] = [];
  for (let i = 0; i < DEVASTATED_AT_SETUP; i++) {
    const id = s.territoryDecks.land.shift()!;
    s.territories[id].devastated = true;
    dev.push(id);
  }
  log(s, { kind: 'setup', msg: `Verwüstet: ${dev.map(tname).join(', ')}.`, data: { territories: dev } });

  // 2 Spieler: neutrale Armee (RH S. 8)
  if (n === 2) {
    s.players.push({
      id: NEUTRAL_ID, name: 'Neutral', color: '#8b93a1', isBot: false, isNeutral: true, energy: 0, hand: [],
      eliminated: false, settings: { autoReact: {}, defendMax: true },
    });
    const place = (kind: 'land' | 'water' | 'moon', count: number) => {
      const drawn = s.territoryDecks[kind].slice(0, count);
      for (const id of drawn) Object.assign(s.territories[id], { owner: NEUTRAL_ID, mods: TWO_PLAYER_NEUTRAL.mods });
      shuffle(s.rng, s.territoryDecks[kind]);
    };
    place('land', TWO_PLAYER_NEUTRAL.land);
    place('water', TWO_PLAYER_NEUTRAL.water);
    place('moon', TWO_PLAYER_NEUTRAL.moon);
    log(s, { kind: 'setup', msg: 'Neutrale Armee besetzt 16 Land-, 6 Wasser- und 6 Mondgebiete mit je 3 MODs.' });
  }

  // Startspieler: jeder würfelt W6, Gleichstand an der Spitze würfelt erneut (RH S. 2); dann Sitzreihenfolge
  let contenders = [...s.seatOrder];
  const rounds: string[] = [];
  while (contenders.length > 1) {
    const rolls = contenders.map((id) => ({ id, v: roll(s.rng, 6) }));
    rounds.push(rolls.map((r) => `${pname(s, r.id)} ${r.v}`).join(', '));
    const top = Math.max(...rolls.map((r) => r.v));
    contenders = rolls.filter((r) => r.v === top).map((r) => r.id);
  }
  const start = s.seatOrder.indexOf(contenders[0]);
  s.seatOrder = [...s.seatOrder.slice(start), ...s.seatOrder.slice(0, start)];
  log(s, { kind: 'setup', msg: `Startwurf (W6): ${rounds.join(' | Stechen: ')} → ${pname(s, s.seatOrder[0])} beginnt die Aufstellung.` });

  const startMods = START_MODS[n];
  const remaining: Record<string, number> = Object.fromEntries(s.seatOrder.map((id) => [id, startMods]));
  const free = IDS_BY_TYPE.land.filter((id) => !s.territories[id].devastated && !s.territories[id].owner);
  if (config.setupMode === 'quick') {
    shuffle(s.rng, free);
    free.forEach((id, i) => {
      const pid = s.seatOrder[i % n];
      Object.assign(s.territories[id], { owner: pid, mods: 1 });
      remaining[pid]--;
    });
    s.setup = { queue: [...s.seatOrder], index: 0, remaining, done: [] };
    s.phase = 'quickSetup';
    log(s, { kind: 'setup', msg: 'Schnellaufstellung: Landgebiete wurden zufällig verteilt. Jetzt restliche MODs, Kommandanten und Station platzieren.' });
  } else {
    s.setup = { queue: [...s.seatOrder], index: 0, remaining, done: [] };
    s.phase = 'setupClaim';
  }
  return s;
}

function setupCurrent(s: GameState): string {
  const q = s.setup!.queue;
  return q[s.setup!.index % q.length];
}

function freeLand(s: GameState): string[] {
  return IDS_BY_TYPE.land.filter((id) => !s.territories[id].devastated && !s.territories[id].owner);
}

function advanceReinforce(s: GameState): void {
  const st = s.setup!;
  for (let i = 0; i < st.queue.length; i++) {
    if (st.remaining[setupCurrent(s)] > 0) return;
    st.index++;
  }
  // alle MODs gesetzt -> Starteinheiten in Sitzreihenfolge
  s.phase = 'setupUnits';
  st.index = 0;
}

function placeStartUnits(s: GameState, pid: string, land: string, diplomat: string, station: string): void {
  for (const id of [land, diplomat]) if (terr(s, id).owner !== pid) fail('Kommandanten nur in eigene Gebiete');
  const st = terr(s, station);
  if (st.owner !== pid || TDEF[station].type !== 'land') fail('Station nur auf eigenes Landgebiet');
  terr(s, land).commanders.push('LAND');
  terr(s, diplomat).commanders.push('DIPLOMAT');
  st.station = true;
}

// =================================================================== Jahre, Gebote, Züge
function startYear(s: GameState): void {
  s.year++;
  if (s.year > s.config.years) { endGame(s); return; }
  s.phase = 'bid';
  s.bids = {};
  s.bidResult = null;
  s.turn = null;
  s.turnOrder = [];
  log(s, { kind: 'system', msg: `Jahr ${s.year} beginnt – Gebot um die Zugreihenfolge.` });
}

function resolveBids(s: GameState): void {
  const ids = activePlayers(s).map((p) => p.id);
  const res = ids.map((id) => {
    const b = s.bids[id];
    const p = player(s, id);
    p.energy -= b.amount;
    let effective = b.amount;
    if (b.card) {
      p.hand = p.hand.filter((c) => c !== b.card);
      s.discard.push(b.card);
      effective += 2;
    }
    return { player: id, amount: b.amount, effective, tie: 0 };
  });
  // Gleichstände per W6 auflösen (wiederholen bis eindeutig)
  res.sort((a, b) => b.effective - a.effective);
  const groups = new Map<number, typeof res>();
  for (const r of res) groups.set(r.effective, [...(groups.get(r.effective) ?? []), r]);
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    let unresolved = true;
    while (unresolved) {
      for (const r of g) r.tie = roll(s.rng, 6);
      unresolved = new Set(g.map((r) => r.tie)).size !== g.length;
    }
  }
  res.sort((a, b) => b.effective - a.effective || b.tie - a.tie);
  s.bidResult = res.map(({ player: p, amount, effective }) => ({ player: p, amount, effective }));
  log(s, {
    kind: 'bid',
    msg: 'Gebote: ' + res.map((r) => `${pname(s, r.player)} ${r.amount}${r.effective !== r.amount ? ` (+2 → ${r.effective})` : ''}`).join(', ') + '.',
    data: { bids: s.bidResult },
  });
  s.pickQueue = res.map((r) => r.player);
  s.slots = Array(res.length).fill(null);
  s.phase = 'pickSlot';
  autoPickLast(s);
}

function autoPickLast(s: GameState): void {
  if (s.pickQueue.length === 1) {
    const free = s.slots.findIndex((x) => x === null);
    s.slots[free] = s.pickQueue.shift()!;
  }
  if (s.pickQueue.length === 0) {
    s.turnOrder = s.slots as string[];
    s.turnIndex = -1;
    log(s, { kind: 'system', msg: 'Zugreihenfolge: ' + s.turnOrder.map((id, i) => `${i + 1}. ${pname(s, id)}`).join(', ') + '.' });
    s.phase = 'turn';
    nextTurn(s);
  }
}

function nextTurn(s: GameState): void {
  s.turn = null;
  s.invasion = null;
  while (true) {
    s.turnIndex++;
    if (s.turnIndex >= s.turnOrder.length) { startYear(s); return; }
    const pid = s.turnOrder[s.turnIndex];
    if (!player(s, pid).eliminated) { startTurn(s, pid); return; }
  }
}

function startTurn(s: GameState, pid: string): void {
  expireEffects(s, 'turnStart', pid);
  const p = player(s, pid);
  const inc = computeIncome(s, pid);
  let energy = inc.energy;
  const sanction = findEffects(s, 'sanctions', (e) => e.target === pid);
  if (sanction.length) energy = Math.max(0, energy - 3 * sanction.length);
  p.energy += energy;
  let extraMods = 0;
  for (const id of owned(s, pid)) {
    if (s.territories[id].station) { s.territories[id].mods += 1; extraMods++; }
  }
  for (const e of findEffects(s, 'harbor', (e) => e.owner === pid)) {
    if (s.territories[e.territory!].owner === pid) { s.territories[e.territory!].mods += 1; extraMods++; }
  }
  s.turn = {
    player: pid, step: 'deploy', incomeMods: inc.mods, boughtCards: false, invaded: false, contestedConquests: 0,
    bonusAwarded: false, bonusCardPending: false, fortifiesLeft: 1, conqueredLand: 0,
  };
  log(s, {
    kind: 'income', player: pid,
    msg: `${p.name} ist am Zug: ${inc.territories} Gebiete → ${inc.base}` +
      (inc.bonus ? ` + ${inc.bonus} Bonus (${inc.regions.map((r) => RDEF[r].name).join(', ')})` : '') +
      ` = ${inc.mods} MODs und ${energy} Energie` + (extraMods ? `, +${extraMods} MOD(s) an Stationen/Häfen` : '') +
      (sanction.length ? ' (Sanktionen −3)' : '') + '.',
    data: { ...inc, energyGained: energy },
  });
}

function enterStep(s: GameState, target: TurnStep): void {
  const t = s.turn!;
  if (target !== 'deploy' && t.incomeMods > 0) fail('Zuerst alle neuen MODs einsetzen');
  const cur = STEP_ORDER.indexOf(t.step);
  const tgt = STEP_ORDER.indexOf(target);
  if (tgt < cur) fail('Diese Zugphase ist bereits vorbei');
  if (s.invasion && target !== 'main') fail('Erst die laufende Invasion abschließen');
  t.step = target;
}

function requireTurn(s: GameState, pid: string): void {
  if (s.phase !== 'turn' || !s.turn) fail('Gerade ist kein Spielzug aktiv');
  if (s.turn.player !== pid) fail('Du bist nicht am Zug');
}

function endTurn(s: GameState): void {
  const t = s.turn!;
  const pid = t.player;
  if (t.bonusCardPending) autoClaimBonus(s, pid);
  expireEffects(s, 'turnEnd', pid);
  log(s, { kind: 'system', msg: `${pname(s, pid)} beendet den Zug.`, player: pid });
  nextTurn(s);
}

function autoClaimBonus(s: GameState, pid: string): void {
  const deck = bonusDecks(s, pid).sort((a, b) => deckValue(s, b) - deckValue(s, a))[0];
  if (deck) drawCard(s, pid, deck, true);
  s.turn!.bonusCardPending = false;
}

export function deckValue(s: GameState, d: CommanderType): number {
  const cards = s.decks[d];
  if (!cards.length) return 0;
  return cards.reduce((n, c) => n + CARD[cardType(c)].value, 0) / cards.length;
}

function drawCard(s: GameState, pid: string, deck: CommanderType, bonus = false): void {
  const c = s.decks[deck].shift();
  if (!c) fail(`Das ${COMMANDER_NAMES[deck]}-Deck ist leer`);
  player(s, pid).hand.push(c);
  if (bonus) log(s, { kind: 'text', player: pid, msg: `${pname(s, pid)} erhält eine Bonuskarte (${COMMANDER_NAMES[deck]}).` });
  log(s, { kind: 'text', player: pid, to: pid, msg: `Neue Karte: ${CARD[cardType(c)].name}.` });
}

// =================================================================== Wertung
function endGame(s: GameState): void {
  s.phase = 'gameOver';
  s.turn = null;
  s.invasion = null;
  // Zugreihenfolge des letzten Jahres, danach früher ausgeschiedene Spieler (sonst fehlten sie in der Wertung)
  const order = [...s.turnOrder, ...s.seatOrder.filter((id) => !s.turnOrder.includes(id) && id !== NEUTRAL_ID)];
  const lines: ScoreLine[] = [];
  for (const pid of order) {
    const p = player(s, pid);
    const terrs = owned(s, pid).length;
    const regions = controlledRegions(s, pid).reduce((n, r) => n + RDEF[r].bonus, 0);
    let cards = 0;
    if (!p.eliminated) {
      for (const c of p.hand) {
        const def = CARD[cardType(c)];
        if (def.timing === 'WERT' && def.score && commanderInPlay(s, pid, def.deck)) {
          const pts = def.score(s, pid);
          cards += pts;
          log(s, { kind: 'score', player: pid, msg: `${p.name} wertet ${def.name}: +${pts}.` });
        }
      }
      cards += findEffects(s, 'moonBase', (e) => e.owner === pid && s.territories[e.territory!].owner === pid).length;
    }
    lines.push({
      player: pid, territories: terrs, regions, cards, total: terrs + regions + cards,
      energy: p.energy, units: totalUnits(s, pid), rank: 0,
    });
  }
  const survivors = activePlayers(s);
  lines.sort((a, b) => b.total - a.total || b.energy - a.energy || b.units - a.units);
  lines.forEach((l, i) => {
    const prev = lines[i - 1];
    l.rank = prev && prev.total === l.total && prev.energy === l.energy && prev.units === l.units ? prev.rank : i + 1;
  });
  if (survivors.length === 1 && s.year <= s.config.years) {
    s.winner = [survivors[0].id];
    const sl = lines.find((l) => l.player === survivors[0].id)!;
    lines.splice(lines.indexOf(sl), 1);
    lines.unshift(sl);
    lines.forEach((l, i) => { l.rank = i + 1; });
  } else {
    s.winner = lines.filter((l) => l.rank === 1).map((l) => l.player);
  }
  s.scores = lines;
  log(s, {
    kind: 'score',
    msg: 'Endstand: ' + lines.map((l) => `${l.rank}. ${pname(s, l.player)} ${l.total} (${l.territories} Gebiete + ${l.regions} Boni + ${l.cards} Karten)`).join(' · '),
    data: { scores: lines },
  });
  log(s, { kind: 'system', msg: `Neue Weltführung: ${s.winner.map((w) => pname(s, w)).join(' & ')}.` });
}

// =================================================================== Karten
function timingAllowed(s: GameState, pid: string, timing: Timing): void {
  switch (timing) {
    case 'VOR':
      requireTurn(s, pid);
      if (s.invasion || s.turn!.invaded) fail('Nur vor der ersten Invasion bzw. Bewegung spielbar');
      enterStep(s, 'main');
      return;
    case 'ANG': {
      requireTurn(s, pid);
      const inv = s.invasion;
      if (!inv || inv.attacker !== pid || inv.rolls > 0 || inv.awaitingAdvance) fail('Nur nach Erklärung einer eigenen Invasion vor dem ersten Wurf');
      return;
    }
    case 'ENDE':
      requireTurn(s, pid);
      if (s.invasion) fail('Erst die Invasion abschließen');
      enterStep(s, 'end');
      return;
    default:
      fail('Diese Karte wird automatisch zum passenden Zeitpunkt gespielt (Reaktionsregel)');
  }
}

/** Führt eine Karte aus (manuell oder als Reaktion). Gibt false zurück, wenn sie per Veto annulliert wurde. */
export function executeCard(s: GameState, pid: string, inst: string, tg: Targets, ctx: ReactionCtx): boolean {
  const def = CARD[cardType(inst)];
  const p = player(s, pid);
  if (!p.hand.includes(inst)) fail('Karte nicht auf der Hand');
  if (!commanderInPlay(s, pid, def.deck)) fail(`${COMMANDER_NAMES[def.deck]}-Kommandant muss im Spiel sein`);
  if (p.energy < def.powerUp) fail(`Power-up-Kosten ${def.powerUp} Energie nicht gedeckt`);
  const err = def.check?.(s, pid, ctx);
  if (err) fail(err);
  validateTargets(s, pid, def, tg);
  p.energy -= def.powerUp;
  p.hand = p.hand.filter((c) => c !== inst);
  s.discard.push(inst);
  const tdesc = tg.territory ? ` → ${tname(tg.territory)}` : tg.player ? ` → ${pname(s, tg.player)}` : '';
  log(s, { kind: 'card', player: pid, msg: `${p.name} spielt ${def.name}${tdesc}.`, data: { card: def.id, targets: tg } });
  if (def.timing !== 'KAR') {
    const vetoed = runReactions(s, 'KAR', { card: { player: pid, inst, targets: tg } }, pid);
    if (vetoed) {
      log(s, { kind: 'card', msg: `${def.name} wurde per Veto annulliert.` });
      return false;
    }
  }
  def.apply(s, pid, tg, ctx);
  return true;
}

export function autoReactEnabled(p: Player, cardId: string): boolean {
  return p.settings.autoReact[cardId] ?? true;
}

/** Automatische Reaktionen (Reaktionsregeln) in Zugreihenfolge nach dem aktiven Spieler */
function runReactions(s: GameState, timing: 'REA' | 'ERO' | 'KAR', ctx: ReactionCtx, exclude: string): boolean {
  const order = s.turnOrder.length ? s.turnOrder : s.seatOrder;
  const startIdx = Math.max(0, order.indexOf(s.turn?.player ?? order[0]));
  const seq = [...order.slice(startIdx + 1), ...order.slice(0, startIdx + 1)];
  for (const pid of seq) {
    if (pid === exclude) continue;
    const p = player(s, pid);
    if (p.eliminated || p.isNeutral) continue;
    for (const inst of [...p.hand]) {
      const def = CARD[cardType(inst)];
      if (def.timing !== timing || !autoReactEnabled(p, def.id)) continue;
      if (!commanderInPlay(s, pid, def.deck) || p.energy < def.powerUp) continue;
      if (def.check?.(s, pid, ctx)) continue;
      if (def.react && !def.react(s, pid, ctx)) continue;
      try {
        const done = executeCard(s, pid, inst, {}, ctx);
        if (timing === 'KAR' && done) return true; // Veto erfolgreich
        if (ctx.invasion) ctx.invasion.mods.played.push(def.id);
      } catch (e) {
        if (!(e instanceof GameError)) throw e;
      }
      break; // max. eine Reaktion pro Spieler und Auslöser
    }
  }
  return false;
}

// =================================================================== Invasionen
export function invadeError(s: GameState, pid: string, from: string, to: string): string | null {
  const a = s.territories[from];
  const b = s.territories[to];
  if (!a || !b) return 'Unbekanntes Gebiet';
  if (a.owner !== pid) return 'Startgebiet gehört dir nicht';
  if (units(a) < 2) return 'Im Startgebiet müssen mindestens 2 Einheiten stehen';
  if (b.devastated) return 'Verwüstete Gebiete sind unpassierbar';
  const ft = TDEF[from].type;
  const tt = TDEF[to].type;
  const landing = findEffects(s, 'earthLanding', (e) => e.owner === pid && e.territory === to);
  if (b.owner === pid && !(ft === 'moon' && tt !== 'moon' && landing.length)) return 'Ziel gehört bereits dir';
  if (b.owner && b.owner !== pid) {
    if (hasEffect(s, 'neutralZone', (e) => e.territory === to)) return 'Neutralitätszone';
    if (hasEffect(s, 'seaBlock', (e) => e.territory === to)) return 'Seesperre';
    if (hasEffect(s, 'ceasefire', (e) => (e.owner === pid && e.target === b.owner) || (e.owner === b.owner && e.target === pid))) return 'Waffenstillstand';
  }
  let connected = false;
  if (ft === 'moon' && tt !== 'moon') {
    if (!landing.length) return 'Vom Mond zur Erde nur mit der Karte Erdlandung';
    connected = true;
  } else if (tt === 'moon' && ft !== 'moon') {
    if (!a.station) return 'Mond-Invasionen starten nur von einem Gebiet mit eigener Station';
    if (!TDEF[to].landingSite) return 'Vom Planeten aus nur Landeplätze erreichbar';
    connected = true;
  } else {
    connected = adj(s, from, to);
    if (!connected && hasEffect(s, 'currents', (e) => e.owner === pid) && ft === 'water') {
      const col = TDEF[from].region;
      connected = TDEF[to].region === col || TDEF[to].adjacent.some((n) => TDEF[n].region === col && TDEF[n].type === 'water');
    }
    if (!connected && ft === 'land' && tt === 'land' && hasEffect(s, 'bridgehead', (e) => e.owner === pid && e.territory === from)) {
      const waters = new Set(TDEF[from].adjacent.filter((n) => TDEF[n].type === 'water'));
      connected = TDEF[to].adjacent.some((n) => waters.has(n));
    }
  }
  if (!connected) return 'Gebiete sind nicht benachbart';
  if ((ft === 'water' || tt === 'water') && !commanderInPlay(s, pid, 'NAVAL')) return 'Für Wassergebiete muss ein Marine-Kommandant im Spiel sein';
  if ((ft === 'moon' || tt === 'moon') && !commanderInPlay(s, pid, 'SPACE')) return 'Für Mondgebiete muss ein Raum-Kommandant im Spiel sein';
  return null;
}

function defaultMove(s: GameState, from: string, min: number, mustCmd: CommanderType[]): UnitMove {
  const t = terr(s, from);
  const cmds = mustCmd.filter((c) => t.commanders.includes(c));
  const maxMove = units(t) - 1;
  const mods = Math.max(0, Math.min(t.mods, Math.max(min, maxMove) - cmds.length));
  return { mods, commanders: cmds };
}

function doInvade(s: GameState, pid: string, from: string, to: string, move?: UnitMove): void {
  requireTurn(s, pid);
  if (s.invasion) fail('Es läuft bereits eine Invasion');
  enterStep(s, 'main');
  const err = invadeError(s, pid, from, to);
  if (err) fail(err);
  s.turn!.invaded = true;
  const landing = findEffects(s, 'earthLanding', (e) => e.owner === pid && e.territory === to);
  if (landing.length && TDEF[from].type === 'moon') removeEffect(s, landing[0].id);
  const b = terr(s, to);
  if (b.owner === pid) {
    // Erdlandung auf ein eigenes Gebiet: Verlegung ohne Kampf, ohne Reaktionen, ohne Eroberungsbonus
    const mv = move ?? defaultMove(s, from, 1, []);
    validateMove(s, from, mv);
    moveUnits(s, from, to, mv);
    log(s, { kind: 'move', player: pid, msg: `${pname(s, pid)} verlegt per Erdlandung ${mv.mods + mv.commanders.length} Einheit(en) von ${tname(from)} nach ${tname(to)}.`, data: { from, to } });
    return;
  }
  if (units(b) === 0) {
    const mv = move ?? defaultMove(s, from, 1, []);
    validateMove(s, from, mv);
    const prev = b.owner;
    if (prev !== pid) takeOver(s, to, pid);
    moveUnits(s, from, to, mv);
    log(s, {
      kind: 'conquest', player: pid,
      msg: `${pname(s, pid)} besetzt ${tname(to)} von ${tname(from)} aus${prev && prev !== pid ? ` (Station von ${pname(s, prev)})` : ''}.`,
      data: { from, to },
    });
    if (prev && prev !== pid) checkElimination(s, prev);
    return;
  }
  const inv: Invasion = {
    attacker: pid, defender: b.owner, from, to, rolls: 0, contested: true, mods: { played: [] },
    lastAttDice: 0, lastD8Commanders: [], awaitingAdvance: false,
    viaCard: landing.length && TDEF[from].type === 'moon' ? 'earthLanding' : undefined,
  };
  s.invasion = inv;
  log(s, { kind: 'invasion', player: pid, msg: `${pname(s, pid)} greift ${tname(to)} (${pname(s, b.owner)}) von ${tname(from)} an.`, data: { from, to } });
  runReactions(s, 'REA', { invasion: inv }, pid);
  checkInvasionState(s);
}

function checkInvasionState(s: GameState): void {
  const inv = s.invasion;
  if (!inv) return;
  if (units(terr(s, inv.to)) === 0 && !inv.awaitingAdvance) {
    inv.awaitingAdvance = true;
    inv.lastAttDice = Math.max(1, inv.lastAttDice);
  }
}

function doAttack(s: GameState, pid: string, dice?: number, blitz?: boolean, minRemaining = 1, d8?: CommanderType[]): void {
  requireTurn(s, pid);
  const inv = s.invasion;
  if (!inv || inv.attacker !== pid) fail('Keine laufende Invasion');
  if (inv.awaitingAdvance) fail('Erst Einheiten nachziehen');
  if (inv.deterred) fail('Abschreckung: zuerst zahlen oder abbrechen');
  if (d8) {
    const q = qualifyingAttackCommanders(s, inv);
    for (const c of d8) if (!q.includes(c)) fail(`${COMMANDER_NAMES[c]}-Kommandant darf hier keinen W8 würfeln`);
    if (dice && d8.length > dice) fail('Mehr W8 gewählt als Würfel');
  }
  const rolls: { att: number[]; def: number[]; attSides: number[]; defSides: number[]; attLoss: number; defLoss: number }[] = [];
  let guard = 0;
  let stopReason: string | undefined;
  do {
    const blocker = attackBlocker(s, inv);
    if (blocker) { if (!rolls.length) fail(blocker); stopReason = blocker; break; }
    const maxA = maxAttackDice(s, inv);
    if (maxA < 1) { if (!rolls.length) fail('Zu wenige Einheiten für einen Angriff'); break; }
    const a = dice ? Math.max(1, Math.min(dice, maxA)) : maxA;
    const defender = terr(s, inv.to).owner;
    const dp = defender ? s.players.find((x) => x.id === defender) : undefined;
    const d = dp && !dp.settings.defendMax ? 1 : maxDefenseDice(s, inv);
    const chosen = d8?.filter((c) => terr(s, inv.from).commanders.includes(c));
    const r = rollBattle(s, inv, a, d, chosen);
    removeUnits(s, inv.from, r.attLoss, true);
    applyDefenderLosses(s, inv, r.defLoss);
    inv.rolls++;
    inv.lastAttDice = a;
    inv.lastD8Commanders = r.d8Commanders;
    rolls.push(r);
    if (units(terr(s, inv.to)) === 0) { inv.awaitingAdvance = true; break; }
    guard++;
  } while (blitz && units(terr(s, inv.from)) > Math.max(1, minRemaining) && guard < 200);
  if (!stopReason && blitz && !inv.awaitingAdvance) stopReason = attackBlocker(s, inv) ?? undefined;
  const attLoss = rolls.reduce((n, r) => n + r.attLoss, 0);
  const defLoss = rolls.reduce((n, r) => n + r.defLoss, 0);
  log(s, {
    kind: 'battle', player: pid,
    msg: `${tname(inv.from)} → ${tname(inv.to)}: ${rolls.length} Wurf/Würfe, Angreifer −${attLoss}, Verteidiger −${defLoss}` +
      (inv.awaitingAdvance ? '. Gebiet erobert!' : '.') + (stopReason ? ` Angriff gestoppt: ${stopReason}.` : ''),
    data: { from: inv.from, to: inv.to, rolls, attLoss, defLoss, conquered: inv.awaitingAdvance, stopReason },
  });
}

function applyDefenderLosses(s: GameState, inv: Invasion, n: number): void {
  const t = terr(s, inv.to);
  for (let i = 0; i < n; i++) {
    if (t.mods > 0) { t.mods--; continue; }
    if (!t.commanders.length) break;
    const c = t.commanders.pop()!;
    if (inv.mods.immunity) {
      const refuge = nbrs(s, inv.to).find((x) => s.territories[x].owner === t.owner && x !== inv.from);
      if (refuge) {
        s.territories[refuge].commanders.push(c);
        log(s, { kind: 'text', msg: `${COMMANDER_NAMES[c]}-Kommandant flieht nach ${tname(refuge)}.` });
      }
    }
  }
}

function doAdvance(s: GameState, pid: string, move: UnitMove): void {
  requireTurn(s, pid);
  const inv = s.invasion;
  if (!inv || !inv.awaitingAdvance) fail('Nichts zum Nachziehen');
  const from = terr(s, inv.from);
  const avail = units(from) - 1;
  validateMove(s, inv.from, move);
  const total = move.mods + move.commanders.length;
  const required = Math.min(inv.lastAttDice, avail);
  if (total < required) fail(`Mindestens ${required} Einheit(en) nachziehen`);
  const mustCmd = inv.lastD8Commanders.filter((c) => from.commanders.includes(c));
  if (mustCmd.length <= avail && !mustCmd.every((c) => move.commanders.includes(c))) {
    fail('Kommandanten, die W8 geliefert haben, müssen mit einrücken');
  }
  const prev = inv.defender ?? terr(s, inv.to).owner;
  takeOver(s, inv.to, pid);
  moveUnits(s, inv.from, inv.to, move);
  const t = s.turn!;
  if (inv.contested) {
    t.contestedConquests++;
    if (TDEF[inv.to].type === 'land') t.conqueredLand++;
    if (t.contestedConquests >= 3 && !t.bonusAwarded) {
      t.bonusAwarded = true;
      player(s, pid).energy += 1;
      t.bonusCardPending = bonusDecks(s, pid).length > 0;
      log(s, { kind: 'text', player: pid, msg: `${pname(s, pid)} erhält den 3-Gebiete-Bonus: +1 Energie${t.bonusCardPending ? ' und eine Karte nach Wahl' : ''}.` });
    }
  }
  log(s, { kind: 'conquest', player: pid, msg: `${pname(s, pid)} erobert ${tname(inv.to)} und zieht ${total} Einheit(en) nach.`, data: { from: inv.from, to: inv.to, moved: total } });
  s.invasion = null;
  if (prev && prev !== pid) {
    checkElimination(s, prev);
    if (!player(s, prev).eliminated) {
      runReactions(s, 'ERO', { conquest: { territory: inv.to, by: pid, advanced: total, previousOwner: prev } }, pid);
    }
  }
}

// =================================================================== Command-Dispatcher
export function applyCommand(state: GameState, pid: string, cmd: Command): GameState {
  const s = structuredClone(state);
  dispatch(s, pid, cmd);
  if (s.phase === 'gameOver' && !s.scores) endGame(s);
  s.version++;
  return s;
}

const ALWAYS_ALLOWED = ['SetAutoReact', 'SetDefendMax', 'AnswerTrade', 'Resign', 'ClaimBonusCard'];

function dispatch(s: GameState, pid: string, cmd: Command): void {
  validateCommand(cmd);
  const p = player(s, pid);
  if (s.phase === 'turn' && s.turn?.player === pid && s.turn.bonusCardPending && !ALWAYS_ALLOWED.includes(cmd.t)) {
    if (bonusDecks(s, pid).length) fail('Zuerst die Bonuskarte für drei umkämpfte Eroberungen wählen');
    s.turn.bonusCardPending = false; // kein gültiges Deck mehr -> Auswahl entfällt
  }
  if (s.phase === 'gameOver' && !['SetAutoReact', 'SetDefendMax'].includes(cmd.t)) fail('Die Partie ist beendet');
  if (p.eliminated && !['SetAutoReact', 'SetDefendMax'].includes(cmd.t)) fail('Du bist ausgeschieden');
  switch (cmd.t) {
    // ---------------- Aufstellung
    case 'QuickSetup': {
      if (s.phase !== 'quickSetup') fail('Keine Schnellaufstellung aktiv');
      const st = s.setup!;
      if (st.done.includes(pid)) fail('Aufstellung bereits abgeschlossen');
      placeExact(s, pid, cmd.placements, st.remaining[pid]);
      placeStartUnits(s, pid, cmd.land, cmd.diplomat, cmd.station);
      st.remaining[pid] = 0;
      st.done.push(pid);
      log(s, { kind: 'setup', player: pid, msg: `${p.name} hat die Aufstellung abgeschlossen.` });
      if (st.done.length === st.queue.length) { s.setup = null; startYear(s); }
      return;
    }
    case 'SetupClaim': {
      if (s.phase !== 'setupClaim') fail('Keine Gebietswahl aktiv');
      if (setupCurrent(s) !== pid) fail('Du bist nicht an der Reihe');
      const t = terr(s, cmd.territory);
      if (TDEF[cmd.territory].type !== 'land' || t.devastated || t.owner) fail('Nur freie, nicht verwüstete Landgebiete');
      Object.assign(t, { owner: pid, mods: 1 });
      s.setup!.remaining[pid]--;
      s.setup!.index++;
      if (!freeLand(s).length) { s.phase = 'setupReinforce'; advanceReinforce(s); }
      return;
    }
    case 'SetupReinforce': {
      if (s.phase !== 'setupReinforce') fail('Keine Verstärkungsrunde aktiv');
      if (setupCurrent(s) !== pid) fail('Du bist nicht an der Reihe');
      const n = Math.min(3, s.setup!.remaining[pid]);
      placeExact(s, pid, cmd.placements, n);
      s.setup!.remaining[pid] -= n;
      s.setup!.index++;
      advanceReinforce(s);
      return;
    }
    case 'SetupUnits': {
      if (s.phase !== 'setupUnits') fail('Keine Starteinheiten-Runde aktiv');
      if (setupCurrent(s) !== pid) fail('Du bist nicht an der Reihe');
      placeStartUnits(s, pid, cmd.land, cmd.diplomat, cmd.station);
      s.setup!.index++;
      if (s.setup!.index >= s.setup!.queue.length) { s.setup = null; startYear(s); }
      return;
    }
    // ---------------- Gebote
    case 'Bid': {
      if (s.phase !== 'bid') fail('Keine Gebotsrunde aktiv');
      if (s.bids[pid]) fail('Gebot bereits abgegeben');
      if (!Number.isInteger(cmd.amount) || cmd.amount < 0 || cmd.amount > p.energy) fail('Ungültiges Gebot');
      if (cmd.card) {
        if (!p.hand.includes(cmd.card) || CARD[cardType(cmd.card)].timing !== 'GEBOT') fail('Diese Karte kann nicht mit dem Gebot gespielt werden');
        if (!commanderInPlay(s, pid, CARD[cardType(cmd.card)].deck)) fail('Diplomat muss im Spiel sein');
      }
      s.bids[pid] = { amount: cmd.amount, card: cmd.card };
      log(s, { kind: 'bid', player: pid, msg: `${p.name} hat geboten.` });
      if (activePlayers(s).every((x) => s.bids[x.id])) resolveBids(s);
      return;
    }
    case 'PickSlot': {
      if (s.phase !== 'pickSlot') fail('Keine Platzwahl aktiv');
      if (s.pickQueue[0] !== pid) fail('Du bist nicht an der Reihe');
      const i = cmd.slot - 1;
      if (!(i >= 0 && i < s.slots.length) || s.slots[i]) fail('Platz nicht verfügbar');
      s.slots[i] = pid;
      s.pickQueue.shift();
      log(s, { kind: 'bid', player: pid, msg: `${p.name} wählt Zugplatz ${cmd.slot}.` });
      autoPickLast(s);
      return;
    }
    // ---------------- Zug
    case 'Deploy': {
      requireTurn(s, pid);
      if (s.turn!.step !== 'deploy') fail('Einsetzen ist bereits erledigt');
      placeExact(s, pid, cmd.placements, s.turn!.incomeMods);
      s.turn!.incomeMods = 0;
      s.turn!.step = 'hire';
      return;
    }
    case 'HireCommander': {
      requireTurn(s, pid);
      enterStep(s, 'hire');
      if (commanderInPlay(s, pid, cmd.type)) fail('Dieser Kommandant ist bereits im Spiel');
      if (p.energy < COSTS.commander) fail(`Kommandant kostet ${COSTS.commander} Energie`);
      if (terr(s, cmd.territory).owner !== pid) fail('Nur in eigene Gebiete');
      p.energy -= COSTS.commander;
      terr(s, cmd.territory).commanders.push(cmd.type);
      log(s, { kind: 'text', player: pid, msg: `${p.name} heuert den ${COMMANDER_NAMES[cmd.type]}-Kommandanten in ${tname(cmd.territory)} an.` });
      return;
    }
    case 'BuildStation': {
      requireTurn(s, pid);
      enterStep(s, 'hire');
      const t = terr(s, cmd.territory);
      if (t.owner !== pid || TDEF[cmd.territory].type !== 'land') fail('Stationen nur auf eigenen Landgebieten');
      if (t.station) fail('Dort steht bereits eine Station');
      if (stationCount(s, pid) >= MAX_STATIONS) fail(`Höchstens ${MAX_STATIONS} Stationen`);
      if (p.energy < COSTS.station) fail(`Station kostet ${COSTS.station} Energie`);
      p.energy -= COSTS.station;
      t.station = true;
      log(s, { kind: 'text', player: pid, msg: `${p.name} baut eine Raumstation in ${tname(cmd.territory)}.` });
      return;
    }
    case 'BuyCards': {
      requireTurn(s, pid);
      enterStep(s, 'buy');
      const t = s.turn!;
      if (t.boughtCards) fail('Karten wurden in diesem Zug bereits gekauft');
      if (!cmd.decks.length || cmd.decks.length > MAX_CARD_BUY) fail(`1 bis ${MAX_CARD_BUY} Karten kaufen`);
      if (hasEffect(s, 'embargo', (e) => e.target === pid)) fail('Embargo: in diesem Zug keine Kartenkäufe');
      const need: Partial<Record<CommanderType, number>> = {};
      for (const d of cmd.decks) {
        if (!COMMANDER_TYPES.includes(d)) fail('Unbekanntes Deck');
        if (!commanderInPlay(s, pid, d)) fail(`${COMMANDER_NAMES[d]}-Kommandant nicht im Spiel`);
        need[d] = (need[d] ?? 0) + 1;
      }
      for (const [d, n] of Object.entries(need)) if (s.decks[d as CommanderType].length < n!) fail(`${COMMANDER_NAMES[d as CommanderType]}-Deck hat zu wenige Karten`);
      if (p.energy < cmd.decks.length * COSTS.card) fail('Zu wenig Energie');
      p.energy -= cmd.decks.length * COSTS.card;
      for (const d of cmd.decks) {
        const c = s.decks[d].shift()!;
        p.hand.push(c);
        log(s, { kind: 'text', player: pid, to: pid, msg: `Gekauft: ${CARD[cardType(c)].name}.` });
      }
      t.boughtCards = true;
      t.step = 'main';
      log(s, { kind: 'text', player: pid, msg: `${p.name} kauft ${cmd.decks.length} Karte(n): ${Object.entries(need).map(([d, n]) => `${n}× ${COMMANDER_NAMES[d as CommanderType]}`).join(', ')}.` });
      return;
    }
    case 'ClaimBonusCard': {
      requireTurn(s, pid);
      if (!s.turn!.bonusCardPending) fail('Keine Bonuskarte offen');
      if (!commanderInPlay(s, pid, cmd.deck)) fail('Kommandant dieses Decks nicht im Spiel');
      if (!s.decks[cmd.deck].length) fail('Dieses Deck ist leer');
      drawCard(s, pid, cmd.deck, true);
      s.turn!.bonusCardPending = false;
      return;
    }
    case 'PlayCard': {
      if (!p.hand.includes(cmd.card)) fail('Karte nicht auf der Hand');
      const def = CARD[cardType(cmd.card)];
      timingAllowed(s, pid, def.timing);
      executeCard(s, pid, cmd.card, cmd.targets ?? {}, { invasion: s.invasion ?? undefined });
      if (def.timing === 'ANG' && s.invasion) { s.invasion.mods.played.push(def.id); checkInvasionState(s); }
      return;
    }
    case 'Invade':
      doInvade(s, pid, cmd.from, cmd.to, cmd.move);
      return;
    case 'Attack':
      doAttack(s, pid, cmd.dice, cmd.blitz, cmd.minRemaining, cmd.d8);
      return;
    case 'Advance':
      doAdvance(s, pid, cmd.move);
      return;
    case 'Retreat': {
      requireTurn(s, pid);
      const inv = s.invasion;
      if (!inv || inv.attacker !== pid) fail('Keine laufende Invasion');
      if (inv.awaitingAdvance) fail('Gebiet erobert – bitte nachziehen');
      if (inv.rolls === 0 && maxAttackDice(s, inv) > 0 && !attackBlocker(s, inv)) fail('Vor dem Abbruch muss mindestens einmal gewürfelt werden');
      s.invasion = null;
      log(s, { kind: 'text', player: pid, msg: `${p.name} bricht die Invasion auf ${tname(inv.to)} ab.` });
      return;
    }
    case 'Deterrence': {
      requireTurn(s, pid);
      const inv = s.invasion;
      if (!inv?.deterred) fail('Keine Abschreckung offen');
      if (cmd.pay && p.energy >= inv.deterred) {
        p.energy -= inv.deterred;
        inv.deterred = undefined;
        log(s, { kind: 'text', player: pid, msg: `${p.name} zahlt die Abschreckung.` });
      } else {
        s.invasion = null;
        log(s, { kind: 'text', player: pid, msg: `${p.name} bricht die Invasion wegen Abschreckung ab.` });
      }
      return;
    }
    case 'Fortify': {
      requireTurn(s, pid);
      if (s.invasion) fail('Erst die Invasion abschließen');
      enterStep(s, 'fortify');
      const t = s.turn!;
      if (t.fortifiesLeft <= 0) fail('Keine Truppenbewegung mehr übrig');
      if (terr(s, cmd.from).owner !== pid || terr(s, cmd.to).owner !== pid) fail('Nur zwischen eigenen Gebieten');
      validateMove(s, cmd.from, cmd.move);
      if (!pathExists(s, pid, cmd.from, cmd.to)) fail('Kein durchgehender Pfad über eigene Gebiete');
      moveUnits(s, cmd.from, cmd.to, cmd.move);
      t.invaded = true;
      t.fortifiesLeft--;
      log(s, { kind: 'move', player: pid, msg: `${p.name} verlegt ${cmd.move.mods + cmd.move.commanders.length} Einheit(en) von ${tname(cmd.from)} nach ${tname(cmd.to)}.`, data: { from: cmd.from, to: cmd.to } });
      if (t.fortifiesLeft === 0) t.step = 'end';
      return;
    }
    case 'EndPhase': {
      requireTurn(s, pid);
      const t = s.turn!;
      if (t.step === 'deploy') fail('Zuerst alle neuen MODs einsetzen');
      if (s.invasion) fail('Erst die laufende Invasion abschließen (würfeln oder abbrechen)');
      const idx = STEP_ORDER.indexOf(t.step);
      if (idx >= STEP_ORDER.length - 1) { endTurn(s); return; }
      t.step = STEP_ORDER[idx + 1];
      if (t.step === 'buy' && (t.boughtCards)) t.step = 'main';
      return;
    }
    case 'EndTurn': {
      requireTurn(s, pid);
      if (s.turn!.incomeMods > 0) fail('Zuerst alle neuen MODs einsetzen');
      const inv = s.invasion;
      if (inv) {
        if (inv.awaitingAdvance) fail('Gebiet erobert – bitte nachziehen');
        if (inv.rolls === 0 && !inv.deterred && maxAttackDice(s, inv) > 0 && !attackBlocker(s, inv)) fail('Vor dem Abbruch muss mindestens einmal gewürfelt werden');
        s.invasion = null;
      }
      endTurn(s);
      return;
    }
    case 'AnswerTrade': {
      const e = s.effects.find((x) => x.id === cmd.effectId && x.kind === 'tradeOffer' && x.target === pid);
      if (!e) fail('Kein Angebot vorhanden');
      removeEffect(s, e.id);
      if (cmd.accept) {
        player(s, e.owner).energy += 1;
        p.energy += 2;
        log(s, { kind: 'text', player: pid, msg: `${p.name} nimmt das Handelsabkommen von ${pname(s, e.owner)} an.` });
      } else log(s, { kind: 'text', player: pid, msg: `${p.name} lehnt das Handelsabkommen ab.` });
      return;
    }
    case 'SetAutoReact':
      if (!CARD[cmd.cardType]) fail('Unbekannter Kartentyp');
      p.settings.autoReact[cmd.cardType] = cmd.on;
      return;
    case 'SetDefendMax':
      p.settings.defendMax = cmd.on;
      return;
    case 'Resign':
      p.isBot = true;
      p.away = true;
      log(s, { kind: 'system', player: pid, msg: `${p.name} gibt die Kontrolle an einen Bot ab.` });
      return;
    default:
      fail('Unbekannter Befehl');
  }
}

function placeExact(s: GameState, pid: string, placements: Record<string, number>, expected: number): void {
  let sum = 0;
  for (const [id, n] of Object.entries(placements ?? {})) {
    if (!Number.isInteger(n) || n < 0) fail('Ungültige Anzahl');
    if (n === 0) continue;
    if (terr(s, id).owner !== pid) fail(`${tname(id)} gehört dir nicht`);
    sum += n;
  }
  if (sum !== expected) fail(`Genau ${expected} MODs platzieren (aktuell ${sum})`);
  for (const [id, n] of Object.entries(placements)) s.territories[id].mods += n;
}

// =================================================================== Abfragen
/** Wer muss gerade handeln? */
export function pendingActors(s: GameState): string[] {
  switch (s.phase) {
    case 'setupClaim': case 'setupReinforce': case 'setupUnits':
      return [setupCurrent(s)];
    case 'quickSetup':
      return s.setup!.queue.filter((id) => !s.setup!.done.includes(id));
    case 'bid':
      return activePlayers(s).filter((p) => !s.bids[p.id]).map((p) => p.id);
    case 'pickSlot':
      return s.pickQueue.slice(0, 1);
    case 'turn':
      return s.turn ? [s.turn.player] : [];
    default:
      return [];
  }
}

/** Decks, aus denen die Bonuskarte gewählt werden darf */
export function bonusDecks(s: GameState, pid: string): CommanderType[] {
  return COMMANDER_TYPES.filter((d) => commanderInPlay(s, pid, d) && s.decks[d].length > 0);
}

/** Grund, warum der nächste Wurf einer laufenden Invasion unzulässig ist (Kommandant gefallen) */
export function attackBlocker(s: GameState, inv: Invasion): string | null {
  const ft = TDEF[inv.from].type, tt = TDEF[inv.to].type;
  if ((ft === 'water' || tt === 'water') && !commanderInPlay(s, inv.attacker, 'NAVAL')) return 'Marine-Kommandant nicht mehr im Spiel (Wassergebiete)';
  if ((ft === 'moon' || tt === 'moon') && !commanderInPlay(s, inv.attacker, 'SPACE')) return 'Raum-Kommandant nicht mehr im Spiel (Mondgebiete)';
  if (terr(s, inv.from).owner !== inv.attacker) return 'Ausgangsgebiet verloren';
  return null;
}

export function setupRemaining(s: GameState, pid: string): number {
  return s.setup?.remaining[pid] ?? 0;
}

export { CARD_DEFS, REGION_MEMBERS, totalUnits };
