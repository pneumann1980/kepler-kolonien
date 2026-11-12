// Laufzeitvalidierung öffentlicher Befehle (JSON von außen). TypeScript-Typen allein schützen nicht.
import { TDEF } from './content.ts';
import { CARD } from './cards.ts';
import { COMMANDER_TYPES, GameError } from './types.ts';
import type { Command } from './types.ts';

function bad(msg: string): never {
  throw new GameError(`Ungültiger Befehl: ${msg}`);
}
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min = 0, max = 10_000): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

function territory(v: unknown, name: string): void {
  if (typeof v !== 'string' || !TDEF[v]) bad(`${name} ist kein Gebiet`);
}
function optTerritory(v: unknown, name: string): void {
  if (v !== undefined) territory(v, name);
}
function commander(v: unknown, name = 'Kommandant'): void {
  if (typeof v !== 'string' || !(COMMANDER_TYPES as string[]).includes(v)) bad(`${name}: unbekannter Kommandantentyp`);
}
function commanderList(v: unknown, name: string, max = 5): void {
  if (!Array.isArray(v) || v.length > max) bad(`${name} muss eine Liste sein`);
  for (const c of v) commander(c, name);
  if (new Set(v).size !== v.length) bad(`${name} enthält Doppelungen`);
}
function placements(v: unknown, name = 'placements'): void {
  if (!isObj(v)) bad(`${name} muss ein Objekt sein`);
  const keys = Object.keys(v);
  if (keys.length > 80) bad(`${name}: zu viele Einträge`);
  for (const k of keys) {
    territory(k, name);
    if (!isInt(v[k], 0, 1000)) bad(`${name}: Anzahl muss eine ganze Zahl ≥ 0 sein`);
  }
}
function unitMove(v: unknown, name = 'move'): void {
  if (!isObj(v)) bad(`${name} muss ein Objekt sein`);
  if (!isInt(v.mods, 0, 1000)) bad(`${name}.mods muss eine ganze Zahl ≥ 0 sein`);
  commanderList(v.commanders, `${name}.commanders`);
}
function bool(v: unknown, name: string, optional = true): void {
  if (v === undefined && optional) return;
  if (typeof v !== 'boolean') bad(`${name} muss true/false sein`);
}
function cardInst(v: unknown, name = 'card'): void {
  if (typeof v !== 'string' || !CARD[v.split('#')[0]]) bad(`${name} ist keine Karte`);
}

export function validateCommand(cmd: unknown): asserts cmd is Command {
  if (!isObj(cmd) || typeof cmd.t !== 'string') bad('Objekt mit Feld t erwartet');
  const c = cmd;
  switch (c.t) {
    case 'SetupClaim': territory(c.territory, 'territory'); return;
    case 'SetupReinforce': placements(c.placements); return;
    case 'SetupUnits': territory(c.land, 'land'); territory(c.diplomat, 'diplomat'); territory(c.station, 'station'); return;
    case 'QuickSetup': placements(c.placements); territory(c.land, 'land'); territory(c.diplomat, 'diplomat'); territory(c.station, 'station'); return;
    case 'Bid': if (!isInt(c.amount, 0, 100_000)) bad('amount muss eine ganze Zahl ≥ 0 sein'); if (c.card !== undefined) cardInst(c.card); return;
    case 'PickSlot': if (!isInt(c.slot, 1, 5)) bad('slot muss eine ganze Zahl von 1 bis 5 sein'); return;
    case 'Deploy': placements(c.placements); return;
    case 'HireCommander': commander(c.type, 'type'); territory(c.territory, 'territory'); return;
    case 'BuildStation': territory(c.territory, 'territory'); return;
    case 'BuyCards':
      if (!Array.isArray(c.decks) || c.decks.length < 1 || c.decks.length > 4) bad('decks: Liste mit 1–4 Decks');
      for (const d of c.decks) commander(d, 'decks');
      return;
    case 'PlayCard': {
      cardInst(c.card);
      if (c.targets === undefined) return;
      if (!isObj(c.targets)) bad('targets muss ein Objekt sein');
      const tg = c.targets;
      optTerritory(tg.territory, 'targets.territory');
      optTerritory(tg.territory2, 'targets.territory2');
      if (tg.player !== undefined && typeof tg.player !== 'string') bad('targets.player');
      if (tg.deck !== undefined) commander(tg.deck, 'targets.deck');
      if (tg.placements !== undefined) placements(tg.placements, 'targets.placements');
      if (tg.count !== undefined && !isInt(tg.count, 1, 100)) bad('targets.count');
      return;
    }
    case 'Invade':
      territory(c.from, 'from'); territory(c.to, 'to');
      if (c.move !== undefined) unitMove(c.move);
      return;
    case 'Attack':
      if (c.dice !== undefined && !isInt(c.dice, 1, 3)) bad('dice muss 1, 2 oder 3 sein');
      bool(c.blitz, 'blitz');
      if (c.minRemaining !== undefined && !isInt(c.minRemaining, 1, 1000)) bad('minRemaining muss eine ganze Zahl ≥ 1 sein');
      if (c.d8 !== undefined) commanderList(c.d8, 'd8 (W8-Kommandanten)', 3);
      return;
    case 'Advance': unitMove(c.move); return;
    case 'Retreat': case 'EndPhase': case 'EndTurn': case 'Resign': return;
    case 'Deterrence': bool(c.pay, 'pay', false); return;
    case 'ClaimBonusCard': commander(c.deck, 'deck'); return;
    case 'Fortify': territory(c.from, 'from'); territory(c.to, 'to'); unitMove(c.move); return;
    case 'AnswerTrade': if (!isInt(c.effectId, 0, 1e9)) bad('effectId'); bool(c.accept, 'accept', false); return;
    case 'SetAutoReact': if (typeof c.cardType !== 'string' || !CARD[c.cardType]) bad('cardType'); bool(c.on, 'on', false); return;
    case 'SetDefendMax': bool(c.on, 'on', false); return;
    default: bad(`unbekannter Befehl "${String(c.t).slice(0, 30)}"`);
  }
}
