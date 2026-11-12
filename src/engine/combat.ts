// Kampfauflösung gemäß Regelheft (W6/W8, Kommandanten, Stationen, Kartenmodifikatoren)
import { TDEF } from './content.ts';
import { roll } from './rng.ts';
import { findEffects, hasEffect, terr, units, commanderLocation, adj, nbrs } from './state.ts';
import type { CommanderType, GameState, Invasion } from './types.ts';

function empAffects(s: GameState, territory: string): boolean {
  return findEffects(s, 'emp').some((e) => {
    const def = TDEF[territory];
    if (def.region === e.region) return true;
    return def.type === 'water' && nbrs(s, territory).some((n) => TDEF[n].region === e.region);
  });
}

/** Kommandanten im Quellgebiet, die nach R21 einen W8 liefern */
export function qualifyingAttackCommanders(s: GameState, inv: Pick<Invasion, 'from' | 'to'>): CommanderType[] {
  const from = terr(s, inv.from);
  if (empAffects(s, inv.from)) return [];
  const ft = TDEF[inv.from].type;
  const tt = TDEF[inv.to].type;
  return from.commanders.filter((c) => {
    switch (c) {
      case 'LAND': return ft === 'land' || tt === 'land';
      case 'NAVAL': return ft === 'water' || tt === 'water';
      case 'SPACE': return ft === 'moon' || tt === 'moon';
      case 'NUCLEAR': return true;
      case 'DIPLOMAT': return false;
    }
  });
}

export function maxAttackDice(s: GameState, inv: Invasion): number {
  const avail = units(terr(s, inv.from)) - 1;
  return Math.max(0, Math.min(3, avail, inv.mods.maxAttackDice ?? 3));
}

export function maxDefenseDice(s: GameState, inv: Invasion): number {
  return Math.min(2, units(terr(s, inv.to)));
}

export interface DicePlan {
  attSides: number[];
  defSides: number[];
  d8Commanders: CommanderType[];
}

export function planDice(s: GameState, inv: Invasion, attDice: number, defDice: number, chosen?: CommanderType[]): DicePlan {
  const q = qualifyingAttackCommanders(s, inv).filter((c) => !chosen || chosen.includes(c));
  let d8 = 0;
  const d8Commanders: CommanderType[] = [];
  for (const c of q) {
    if (d8 >= attDice) break;
    let give = 1;
    if (c === 'NUCLEAR' && hasEffect(s, 'firstStrike', (e) => e.owner === inv.attacker)) give = 2;
    d8 += give;
    d8Commanders.push(c);
  }
  if (inv.mods.attackerExtraD8 && d8Commanders.includes('LAND')) d8 += inv.mods.attackerExtraD8;
  if (inv.mods.attackerMinD8) d8 = Math.max(d8, inv.mods.attackerMinD8);
  if (inv.mods.attackerAllD8) d8 = attDice;
  if (inv.mods.attackerNoD8) { d8 = 0; d8Commanders.length = 0; }
  d8 = Math.min(d8, attDice);
  const attSides = Array.from({ length: attDice }, (_, i) => (i < d8 ? 8 : 6));

  const to = terr(s, inv.to);
  let defD8 = 0;
  const allD8 =
    to.station ||
    inv.mods.defenderAllD8 ||
    hasEffect(s, 'garrison', (e) => e.territory === inv.to && e.owner === to.owner) ||
    (to.commanders.includes('NUCLEAR') && hasEffect(s, 'silo', (e) => e.owner === to.owner && e.territory === inv.to));
  if (allD8) defD8 = defDice;
  else {
    if (!empAffects(s, inv.to)) defD8 = to.commanders.length;
    if (to.owner && hasEffect(s, 'fieldCommand', (e) => e.owner === to.owner)) {
      const lc = commanderLocation(s, to.owner, 'LAND');
      if (lc && (lc === inv.to || adj(s, lc, inv.to))) defD8 = Math.max(defD8, 1);
    }
  }
  defD8 = Math.min(defD8, defDice);
  const defSides = Array.from({ length: defDice }, (_, i) => (i < defD8 ? 8 : 6));
  return { attSides, defSides, d8Commanders };
}

export interface RollResult {
  att: number[];
  def: number[];
  attSides: number[];
  defSides: number[];
  attLoss: number;
  defLoss: number;
  d8Commanders: CommanderType[];
}

export function rollBattle(s: GameState, inv: Invasion, attDice: number, defDice: number, chosen?: CommanderType[]): RollResult {
  const plan = planDice(s, inv, attDice, defDice, chosen);
  const att = plan.attSides.map((sd) => ({ v: roll(s.rng, sd), sd }));
  const bonus = inv.mods.defenderBonus ?? 0;
  const def = plan.defSides.map((sd) => ({ v: Math.min(9, roll(s.rng, sd) + bonus), sd }));
  att.sort((a, b) => b.v - a.v);
  def.sort((a, b) => b.v - a.v);
  let attLoss = 0;
  let defLoss = 0;
  for (let i = 0; i < Math.min(att.length, def.length); i++) {
    if (att[i].v > def[i].v) defLoss++;
    else attLoss++;
  }
  if (inv.mods.defenderMaxLoss1 && defLoss > 1) defLoss = 1;
  return {
    att: att.map((x) => x.v), def: def.map((x) => x.v),
    attSides: att.map((x) => x.sd), defSides: def.map((x) => x.sd),
    attLoss, defLoss, d8Commanders: plan.d8Commanders,
  };
}

/** Exakte Gewinnwahrscheinlichkeit (Markov), z. B. für Bots und UI: Angreifer stoppt bei minLeft Einheiten */
const cache = new Map<string, number>();
export function conquestProbability(att: number, def: number, attD8: number, defD8: number, minLeft = 1): number {
  const key = `${att}|${def}|${attD8}|${defD8}|${minLeft}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let result: number;
  if (def <= 0) result = 1;
  else if (att <= minLeft || att < 2) result = 0;
  else {
    const a = Math.min(3, att - 1);
    const d = Math.min(2, def);
    const dist = outcomeDistribution(a, d, Math.min(attD8, a), Math.min(defD8, d));
    result = 0;
    for (const [k, p] of dist) {
      const [al, dl] = k.split(',').map(Number);
      result += p * conquestProbability(att - al, def - dl, attD8, defD8, minLeft);
    }
  }
  cache.set(key, result);
  return result;
}

const distCache = new Map<string, Map<string, number>>();
export function outcomeDistribution(a: number, d: number, a8: number, d8: number): Map<string, number> {
  const key = `${a}${d}${a8}${d8}`;
  const hit = distCache.get(key);
  if (hit) return hit;
  const aSides = Array.from({ length: a }, (_, i) => (i < a8 ? 8 : 6));
  const dSides = Array.from({ length: d }, (_, i) => (i < d8 ? 8 : 6));
  const res = new Map<string, number>();
  const total = [...aSides, ...dSides].reduce((n, x) => n * x, 1);
  const rec = (idx: number, vals: number[]) => {
    if (idx === aSides.length + dSides.length) {
      const av = vals.slice(0, a).sort((x, y) => y - x);
      const dv = vals.slice(a).sort((x, y) => y - x);
      let al = 0, dl = 0;
      for (let i = 0; i < Math.min(a, d); i++) (av[i] > dv[i] ? dl++ : al++);
      const k = `${al},${dl}`;
      res.set(k, (res.get(k) ?? 0) + 1 / total);
      return;
    }
    const sides = idx < a ? aSides[idx] : dSides[idx - a];
    for (let v = 1; v <= sides; v++) { vals.push(v); rec(idx + 1, vals); vals.pop(); }
  };
  rec(0, []);
  distCache.set(key, res);
  return res;
}
