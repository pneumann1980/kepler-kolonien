// Heuristik-Bot (Stufe 1): liefert den nächsten Befehl für einen Bot-Spieler.
// Nutzt nur öffentliche Informationen und die eigene Hand. Jeder Kandidat wird probeweise ausgeführt.
import { TDEF, RDEF, REGION_MEMBERS, TERRITORY_IDS, IDS_BY_TYPE, COSTS, MAX_STATIONS } from './content.ts';
import { applyCommand, invadeError, pendingActors, deckValue } from './rules.ts';
import { CARD, cardType, validTargets, type CardDef } from './cards.ts';
import { conquestProbability, qualifyingAttackCommanders } from './combat.ts';
import {
  units, owned, commanderInPlay, commanderLocation, stationCount, pathExists, player, controlsRegion,
} from './state.ts';
import type { Command, CommanderType, GameState, UnitMove } from './types.ts';
import { COMMANDER_TYPES, GameError } from './types.ts';

function tryCmd(s: GameState, pid: string, cmd: Command): boolean {
  try { applyCommand(s, pid, cmd); return true; } catch (e) { if (e instanceof GameError) return false; throw e; }
}

function hash(s: GameState, pid: string, salt: number): number {
  let h = 2166136261 ^ (s.version * 31 + salt);
  for (const ch of pid) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

function enemyNeighbors(s: GameState, pid: string, id: string): string[] {
  return TDEF[id].adjacent.filter((n) => {
    const o = s.territories[n].owner;
    return o && o !== pid;
  });
}

function threat(s: GameState, pid: string, id: string): number {
  return enemyNeighbors(s, pid, id).reduce((n, x) => n + units(s.territories[x]), 0) - units(s.territories[id]);
}

function borderTerritories(s: GameState, pid: string): string[] {
  return owned(s, pid).filter((id) => enemyNeighbors(s, pid, id).length > 0);
}

function targetValue(s: GameState, pid: string, to: string): number {
  const def = TDEF[to];
  const members = REGION_MEMBERS[def.region].filter((x) => !s.territories[x].devastated);
  const mine = members.filter((x) => s.territories[x].owner === pid).length;
  const bonus = RDEF[def.region].bonus;
  let v = 1;
  if (mine + 1 === members.length) v += bonus * 1.5;
  else v += ((mine + 1) / members.length) * bonus * 0.6;
  const owner = s.territories[to].owner;
  if (owner && owner !== pid && controlsRegion(s, owner, def.region)) v += bonus;
  if (s.territories[to].station) v += 2;
  if (s.year >= s.config.years) v += 1.5; // im letzten Jahr zählt jedes Gebiet direkt
  return v;
}

interface Candidate { from: string; to: string; p: number; score: number; empty: boolean }

function invasionCandidates(s: GameState, pid: string): Candidate[] {
  const res: Candidate[] = [];
  const last = s.year >= s.config.years;
  for (const from of owned(s, pid)) {
    const a = s.territories[from];
    if (units(a) < 2) continue;
    const targets = new Set<string>(TDEF[from].adjacent);
    if (a.station) for (const id of IDS_BY_TYPE.moon) if (TDEF[id].landingSite) targets.add(id);
    for (const e of s.effects) if (e.kind === 'earthLanding' && e.owner === pid && e.territory) targets.add(e.territory);
    for (const to of targets) {
      if (invadeError(s, pid, from, to)) continue;
      const b = s.territories[to];
      const empty = units(b) === 0;
      let p = 1;
      if (!empty) {
        const attD8 = Math.min(3, qualifyingAttackCommanders(s, { from, to }).length);
        const defD8 = b.station ? 2 : Math.min(2, b.commanders.length);
        p = conquestProbability(units(a), units(b), attD8, defD8, 2);
      } else if (units(a) < 3) continue;
      const score = p * targetValue(s, pid, to) - (empty ? 0.3 : 0);
      const threshold = last ? 0.4 : 0.6;
      if (p >= threshold) res.push({ from, to, p, score, empty });
    }
  }
  return res.sort((x, y) => y.score - x.score);
}

function distribute(total: number, weights: [string, number][]): Record<string, number> {
  const res: Record<string, number> = {};
  if (total <= 0) return res;
  const w = weights.filter(([, x]) => x > 0);
  if (!w.length) return res;
  const sum = w.reduce((n, [, x]) => n + x, 0);
  let left = total;
  for (const [id, x] of w) {
    const n = Math.floor((x / sum) * total);
    if (n > 0) { res[id] = (res[id] ?? 0) + n; left -= n; }
  }
  if (left > 0) res[w[0][0]] = (res[w[0][0]] ?? 0) + left;
  return res;
}

function deployPlan(s: GameState, pid: string, total: number): Record<string, number> {
  const mine = owned(s, pid);
  const borders = borderTerritories(s, pid);
  const best = invasionCandidates(s, pid)[0];
  const weights: [string, number][] = [];
  if (best) weights.push([best.from, 3]);
  const threatened = [...borders].sort((a, b) => threat(s, pid, b) - threat(s, pid, a)).slice(0, 2);
  for (const t of threatened) weights.push([t, 1.5]);
  if (!weights.length) weights.push([mine.sort((a, b) => units(s.territories[b]) - units(s.territories[a]))[0], 1]);
  return distribute(total, weights);
}

function setupPlan(s: GameState, pid: string, total: number): { placements: Record<string, number>; land: string; diplomat: string; station: string } {
  const mine = owned(s, pid);
  const lands = mine.filter((id) => TDEF[id].type === 'land');
  const borders = borderTerritories(s, pid);
  // Kontinent mit dem höchsten Anteil eigener Gebiete stärken
  const share = (id: string) => {
    const m = REGION_MEMBERS[TDEF[id].region];
    return m.filter((x) => s.territories[x].owner === pid).length / m.length;
  };
  const weighted = (borders.length ? borders : mine).map((id) => [id, 1 + share(id) * 3 + Math.max(0, threat(s, pid, id)) * 0.3] as [string, number])
    .sort((a, b) => b[1] - a[1]).slice(0, 6);
  const placements = distribute(total, weighted);
  const strongest = weighted[0]?.[0] ?? mine[0];
  const interior = lands.filter((id) => !borders.includes(id));
  const station = (interior.length ? interior : lands).sort((a, b) => share(b) - share(a))[0];
  return { placements, land: strongest, diplomat: weighted[1]?.[0] ?? strongest, station };
}

function chooseCardTargets(s: GameState, pid: string, def: CardDef): Record<string, unknown> | null {
  const valid = validTargets(s, pid, def);
  switch (def.target) {
    case 'none': return {};
    case 'player': {
      const others = s.players.filter((p) => p.id !== pid && !p.eliminated && !p.isNeutral);
      if (!others.length) return null;
      const leader = others.sort((a, b) => owned(s, b.id).length - owned(s, a.id).length)[0];
      return { player: leader.id };
    }
    case 'deck': {
      const d = COMMANDER_TYPES.filter((x) => commanderInPlay(s, pid, x) && s.decks[x].length)
        .sort((a, b) => deckValue(s, b) - deckValue(s, a))[0];
      return d ? { deck: d } : null;
    }
    case 'distribute': {
      if (!valid.length) return null;
      const region = TDEF[valid.sort((a, b) => threat(s, pid, b) - threat(s, pid, a))[0]].region;
      const inRegion = valid.filter((id) => TDEF[id].region === region);
      return { placements: { [inRegion[0]]: def.distribute! } };
    }
    case 'move': {
      if (valid.length < 2) return null;
      const src = [...valid].sort((a, b) => units(s.territories[b]) - units(s.territories[a]))[0];
      const dst = valid.filter((x) => x !== src).sort((a, b) => threat(s, pid, b) - threat(s, pid, a))[0];
      if (units(s.territories[src]) < 3 || threat(s, pid, dst) <= 0) return null;
      return { territory: src, territory2: dst, count: def.moveMax };
    }
    case 'enemyTerritory': case 'anyTerritory': {
      const enemy = valid.filter((id) => s.territories[id].owner && s.territories[id].owner !== pid);
      const pick = (enemy.length ? enemy : valid).sort((a, b) => units(s.territories[b]) - units(s.territories[a]))[0];
      if (!pick) return null;
      if (def.target === 'enemyTerritory' && units(s.territories[pick]) < 2 && def.id !== 'DIP-07' && def.id !== 'DIP-12') return null;
      return { territory: pick };
    }
    default: {
      if (!valid.length) return null;
      const pick = [...valid].sort((a, b) => threat(s, pid, b) - threat(s, pid, a))[0];
      return { territory: pick };
    }
  }
}

function playableCards(s: GameState, pid: string, timing: string): string[] {
  const p = player(s, pid);
  return p.hand.filter((c) => {
    const def = CARD[cardType(c)];
    return def.timing === timing && commanderInPlay(s, pid, def.deck) && p.energy >= def.powerUp;
  }).sort((a, b) => CARD[cardType(b)].value - CARD[cardType(a)].value);
}

function advanceMove(s: GameState, pid: string): UnitMove {
  const inv = s.invasion!;
  const from = s.territories[inv.from];
  const avail = units(from) - 1;
  const must = inv.lastD8Commanders.filter((c) => from.commanders.includes(c)).slice(0, avail);
  const stillThreatened = enemyNeighbors(s, pid, inv.from).filter((x) => x !== inv.to).length > 0;
  let wanted = stillThreatened ? Math.ceil(avail / 2) : avail;
  wanted = Math.max(wanted, Math.min(inv.lastAttDice, avail));
  const mods = Math.min(from.mods, Math.max(0, wanted - must.length));
  const commanders = [...must];
  if (mods + commanders.length < Math.min(inv.lastAttDice, avail)) {
    for (const c of from.commanders) if (!commanders.includes(c) && mods + commanders.length < Math.min(inv.lastAttDice, avail)) commanders.push(c);
  }
  return { mods, commanders };
}

function fortifyMove(s: GameState, pid: string): Command | null {
  const mine = owned(s, pid);
  const borders = new Set(borderTerritories(s, pid));
  const sources = mine.filter((id) => !borders.has(id) && s.territories[id].mods >= 2)
    .sort((a, b) => s.territories[b].mods - s.territories[a].mods);
  const targets = [...borders].sort((a, b) => threat(s, pid, b) - threat(s, pid, a));
  for (const from of sources.slice(0, 4)) {
    for (const to of targets.slice(0, 5)) {
      if (pathExists(s, pid, from, to)) {
        return { t: 'Fortify', from, to, move: { mods: s.territories[from].mods - (units(s.territories[from]) - s.territories[from].mods > 0 ? 0 : 1), commanders: [] } };
      }
    }
  }
  return null;
}

/** Nächster Befehl des Bots oder null, wenn er gerade nichts tun muss */
export function botCommand(s: GameState, pid: string): Command | null {
  const me = player(s, pid);
  // Handelsangebote immer annehmen (Energie für beide)
  const offer = s.effects.find((e) => e.kind === 'tradeOffer' && e.target === pid);
  if (offer) return { t: 'AnswerTrade', effectId: offer.id, accept: true };
  if (!pendingActors(s).includes(pid)) return null;

  const attempt = (cmds: (Command | null)[]): Command | null => {
    for (const c of cmds) if (c && tryCmd(s, pid, c)) return c;
    return null;
  };

  switch (s.phase) {
    case 'quickSetup': {
      const plan = setupPlan(s, pid, s.setup!.remaining[pid]);
      return { t: 'QuickSetup', ...plan };
    }
    case 'setupClaim': {
      const free = IDS_BY_TYPE.land.filter((id) => !s.territories[id].owner && !s.territories[id].devastated);
      const score = (id: string) => {
        const m = REGION_MEMBERS[TDEF[id].region];
        return m.filter((x) => s.territories[x].owner === pid).length * 2 - m.filter((x) => s.territories[x].owner && s.territories[x].owner !== pid).length + 4 / m.length + hash(s, pid, TERRITORY_IDS.indexOf(id)) * 0.5;
      };
      return { t: 'SetupClaim', territory: free.sort((a, b) => score(b) - score(a))[0] };
    }
    case 'setupReinforce': {
      const n = Math.min(3, s.setup!.remaining[pid]);
      const target = (borderTerritories(s, pid).sort((a, b) => threat(s, pid, b) - threat(s, pid, a))[0]) ?? owned(s, pid)[0];
      return { t: 'SetupReinforce', placements: { [target]: n } };
    }
    case 'setupUnits': {
      const plan = setupPlan(s, pid, 0);
      return { t: 'SetupUnits', land: plan.land, diplomat: plan.diplomat, station: plan.station };
    }
    case 'bid': {
      const r = hash(s, pid, 7);
      const reserve = 3;
      const amount = me.energy <= reserve ? (r > 0.7 && me.energy > 0 ? 1 : 0) : Math.min(me.energy - reserve, Math.round(1 + r * 3));
      const card = me.hand.find((c) => CARD[cardType(c)].timing === 'GEBOT' && commanderInPlay(s, pid, 'DIPLOMAT'));
      return attempt([{ t: 'Bid', amount: Math.max(0, amount), card: r > 0.5 ? card : undefined }, { t: 'Bid', amount: 0 }]);
    }
    case 'pickSlot': {
      const free = s.slots.map((x, i) => (x === null ? i + 1 : 0)).filter(Boolean);
      return { t: 'PickSlot', slot: free[0] };
    }
    case 'turn':
      return turnCommand(s, pid, attempt);
    default:
      return null;
  }
}

function turnCommand(s: GameState, pid: string, attempt: (c: (Command | null)[]) => Command | null): Command | null {
  const me = player(s, pid);
  const t = s.turn!;
  const inv = s.invasion;

  if (t.step === 'deploy') {
    return attempt([{ t: 'Deploy', placements: deployPlan(s, pid, t.incomeMods) }, { t: 'Deploy', placements: { [owned(s, pid)[0]]: t.incomeMods } }]);
  }
  if (t.bonusCardPending) {
    const d = COMMANDER_TYPES.filter((x) => commanderInPlay(s, pid, x) && s.decks[x].length).sort((a, b) => deckValue(s, b) - deckValue(s, a))[0];
    if (d) return { t: 'ClaimBonusCard', deck: d };
  }
  if (inv) {
    if (inv.awaitingAdvance) return attempt([{ t: 'Advance', move: advanceMove(s, pid) }]);
    if (inv.deterred) return { t: 'Deterrence', pay: me.energy >= inv.deterred + 1 };
    if (inv.rolls === 0) {
      for (const c of playableCards(s, pid, 'ANG')) {
        const cmd = attempt([{ t: 'PlayCard', card: c }]);
        if (cmd) return cmd;
      }
    }
    const att = attempt([{ t: 'Attack', blitz: true, minRemaining: 2 }]);
    if (att) return att;
    return attempt([{ t: 'Retreat' }, { t: 'EndTurn' }]);
  }

  if (t.step === 'hire') {
    const reserve = 2;
    const mine = owned(s, pid);
    const strongest = [...borderTerritories(s, pid)].sort((a, b) => units(s.territories[b]) - units(s.territories[a]))[0] ?? mine[0];
    const stationTerr = mine.find((id) => s.territories[id].station);
    const coastal = mine.find((id) => TDEF[id].adjacent.some((n) => TDEF[n].type === 'water'));
    const prio: [CommanderType, string | undefined, number][] = [
      ['LAND', strongest, 0], ['DIPLOMAT', strongest, 0], ['NAVAL', coastal ?? strongest, 1],
      ['SPACE', stationTerr ?? strongest, 1], ['NUCLEAR', strongest, 4],
    ];
    for (const [type, where, extra] of prio) {
      if (!where || commanderInPlay(s, pid, type)) continue;
      if (me.energy >= COSTS.commander + reserve + extra) {
        const c = attempt([{ t: 'HireCommander', type, territory: where }]);
        if (c) return c;
      }
    }
    if (stationCount(s, pid) < Math.min(MAX_STATIONS, 2) && me.energy >= COSTS.station + 4) {
      const safe = mine.filter((id) => TDEF[id].type === 'land' && !s.territories[id].station && !enemyNeighbors(s, pid, id).length);
      const c = attempt(safe.slice(0, 3).map((id) => ({ t: 'BuildStation', territory: id }) as Command));
      if (c) return c;
    }
    return { t: 'EndPhase' };
  }
  if (t.step === 'buy') {
    const budget = Math.min(4, me.energy - 2);
    if (budget > 0 && !t.boughtCards) {
      const decks = COMMANDER_TYPES.filter((d) => commanderInPlay(s, pid, d) && s.decks[d].length)
        .sort((a, b) => deckValue(s, b) - deckValue(s, a));
      if (decks.length) {
        const pick: CommanderType[] = [];
        for (let i = 0; i < budget; i++) pick.push(decks[i % decks.length]);
        const c = attempt([{ t: 'BuyCards', decks: pick }, { t: 'BuyCards', decks: [decks[0]] }]);
        if (c) return c;
      }
    }
    return { t: 'EndPhase' };
  }
  if (t.step === 'main') {
    if (!t.invaded) {
      for (const c of playableCards(s, pid, 'VOR')) {
        const def = CARD[cardType(c)];
        if (def.powerUp > me.energy - 1 && def.powerUp > 0) continue;
        const tg = chooseCardTargets(s, pid, def);
        if (!tg) continue;
        const cmd = attempt([{ t: 'PlayCard', card: c, targets: tg }]);
        if (cmd) return cmd;
      }
    }
    for (const cand of invasionCandidates(s, pid).slice(0, 6)) {
      const from = s.territories[cand.from];
      const move = cand.empty ? { mods: Math.max(1, Math.min(from.mods, Math.floor(units(from) / 2))), commanders: [] } : undefined;
      const cmd = attempt([{ t: 'Invade', from: cand.from, to: cand.to, move }]);
      if (cmd) return cmd;
    }
    return { t: 'EndPhase' };
  }
  if (t.step === 'fortify') {
    if (t.fortifiesLeft > 0) {
      const f = fortifyMove(s, pid);
      if (f) { const c = attempt([f]); if (c) return c; }
    }
    return { t: 'EndPhase' };
  }
  // end
  for (const c of playableCards(s, pid, 'ENDE')) {
    const cmd = attempt([{ t: 'PlayCard', card: c }]);
    if (cmd) return cmd;
  }
  return { t: 'EndTurn' };
}

export function commanderAt(s: GameState, pid: string, type: CommanderType): string | null {
  return commanderLocation(s, pid, type);
}
