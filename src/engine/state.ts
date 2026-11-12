// Zustands-Hilfsfunktionen und gemeinsame Mutationen (von Regeln und Karten genutzt)
import {
  TDEF, RDEF, REGION_MEMBERS, TERRITORY_IDS, LANDING_SITES, MAX_STATIONS, NEUTRAL_ID, baseIncome, neighborsFor, adjacentFor,
} from './content.ts';
import type {
  GameState, Player, TerritoryState, CommanderType, Effect, EffectKind, LogEntry, UnitMove,
} from './types.ts';
import { GameError } from './types.ts';

/** Spielrelevante Nachbarn gemäß Kartenrevision der Partie */
export function nbrs(s: Pick<GameState, 'mapId'>, id: string): string[] {
  return neighborsFor(s.mapId, id);
}
export function adj(s: Pick<GameState, 'mapId'>, a: string, b: string): boolean {
  return adjacentFor(s.mapId, a, b);
}

export function fail(msg: string): never {
  throw new GameError(msg);
}

export function player(s: GameState, id: string): Player {
  const p = s.players.find((x) => x.id === id);
  if (!p) fail(`Unbekannter Spieler ${id}`);
  return p;
}

export function pname(s: GameState, id: string | null | undefined): string {
  if (!id) return 'niemand';
  return s.players.find((x) => x.id === id)?.name ?? id;
}

export function tname(id: string): string {
  return TDEF[id]?.name ?? id;
}

export function terr(s: GameState, id: string): TerritoryState {
  const t = s.territories[id];
  if (!t) fail(`Unbekanntes Gebiet ${id}`);
  return t;
}

export function units(t: TerritoryState): number {
  return t.mods + t.commanders.length;
}

export function owned(s: GameState, pid: string): string[] {
  return TERRITORY_IDS.filter((id) => s.territories[id].owner === pid);
}

export function ownsTerritory(s: GameState, pid: string, id: string): boolean {
  return s.territories[id]?.owner === pid;
}

export function commanderLocation(s: GameState, pid: string, type: CommanderType): string | null {
  for (const id of TERRITORY_IDS) {
    const t = s.territories[id];
    if (t.owner === pid && t.commanders.includes(type)) return id;
  }
  return null;
}

export function commanderInPlay(s: GameState, pid: string, type: CommanderType): boolean {
  return commanderLocation(s, pid, type) !== null;
}

export function stationCount(s: GameState, pid: string): number {
  return TERRITORY_IDS.filter((id) => s.territories[id].owner === pid && s.territories[id].station).length;
}

export function totalUnits(s: GameState, pid: string): number {
  return owned(s, pid).reduce((n, id) => n + units(s.territories[id]), 0);
}

export function activePlayers(s: GameState): Player[] {
  return s.players.filter((p) => !p.eliminated && !p.isNeutral);
}

export function log(s: GameState, e: Omit<LogEntry, 'seq' | 'year'>): void {
  const seq = (s.log.at(-1)?.seq ?? 0) + 1;
  s.log.push({ seq, year: s.year, ...e });
}

// ---------------------------------------------------------------- Effekte
export function addEffect(s: GameState, e: Omit<Effect, 'id'>): Effect {
  const eff = { ...e, id: s.nextEffectId++ } as Effect;
  s.effects.push(eff);
  return eff;
}

export function findEffects(s: GameState, kind: EffectKind, pred?: (e: Effect) => boolean): Effect[] {
  return s.effects.filter((e) => e.kind === kind && (!pred || pred(e)));
}

export function hasEffect(s: GameState, kind: EffectKind, pred?: (e: Effect) => boolean): boolean {
  return findEffects(s, kind, pred).length > 0;
}

export function removeEffect(s: GameState, id: number): void {
  s.effects = s.effects.filter((e) => e.id !== id);
}

export function expireEffects(s: GameState, at: 'turnStart' | 'turnEnd', pid: string): void {
  s.effects = s.effects.filter((e) => !(e.expires !== 'permanent' && e.expires.at === at && e.expires.player === pid));
}

/** Gebietsgebundene Dauer-Effekte entfernen, wenn der Besitzer wechselt */
export function onOwnerChange(s: GameState, id: string): void {
  s.effects = s.effects.filter((e) => {
    if (e.territory !== id) return true;
    if (['harbor', 'moonBase', 'garrison', 'seaBlock', 'neutralZone'].includes(e.kind)) {
      return s.territories[id].owner === e.owner;
    }
    return true;
  });
}

// ---------------------------------------------------------------- Regionen / Einkommen
export function controlsRegion(s: GameState, pid: string, region: string): boolean {
  const members = REGION_MEMBERS[region].filter((id) => !s.territories[id].devastated);
  return members.length > 0 && members.every((id) => s.territories[id].owner === pid);
}

export function controlledRegions(s: GameState, pid: string): string[] {
  return Object.keys(REGION_MEMBERS).filter((r) => controlsRegion(s, pid, r));
}

export function regionBonus(s: GameState, pid: string): number {
  return controlledRegions(s, pid).reduce((n, r) => n + RDEF[r].bonus, 0);
}

export interface IncomeBreakdown {
  territories: number;
  base: number;
  bonus: number;
  regions: string[];
  stationMods: number;
  energy: number;
  mods: number;
}

export function computeIncome(s: GameState, pid: string): IncomeBreakdown {
  const contaminated = new Set(findEffects(s, 'contaminated', (e) => e.target === pid).map((e) => e.territory));
  const terrs = owned(s, pid).filter((id) => !contaminated.has(id)).length;
  const base = baseIncome(terrs);
  const regions = controlledRegions(s, pid);
  const bonus = regions.reduce((n, r) => n + RDEF[r].bonus, 0);
  const stationMods = stationCount(s, pid);
  return { territories: terrs, base, bonus, regions, stationMods, energy: base + bonus, mods: base + bonus };
}

// ---------------------------------------------------------------- Bewegungen und Verluste
export function validateMove(s: GameState, from: string, move: UnitMove, minLeave = 1): void {
  const t = terr(s, from);
  if (!Number.isInteger(move.mods) || move.mods < 0) fail('Ungültige MOD-Anzahl');
  if (move.mods > t.mods) fail('Nicht genug MODs im Ausgangsgebiet');
  const seen = new Set<CommanderType>();
  for (const c of move.commanders) {
    if (!t.commanders.includes(c) || seen.has(c)) fail('Kommandant nicht im Ausgangsgebiet');
    seen.add(c);
  }
  const moving = move.mods + move.commanders.length;
  if (moving <= 0) fail('Es muss mindestens eine Einheit bewegt werden');
  if (units(t) - moving < minLeave) fail('Mindestens eine Einheit muss zurückbleiben');
}

export function moveUnits(s: GameState, from: string, to: string, move: UnitMove): void {
  const a = terr(s, from);
  const b = terr(s, to);
  a.mods -= move.mods;
  a.commanders = a.commanders.filter((c) => !move.commanders.includes(c));
  b.mods += move.mods;
  b.commanders.push(...move.commanders);
}

/** Entfernt n Einheiten (MODs zuerst). Gibt die Zahl tatsächlich entfernter Einheiten zurück. */
export function removeUnits(s: GameState, id: string, n: number, keepOne = false): number {
  const t = terr(s, id);
  let removed = 0;
  while (removed < n) {
    if (keepOne && units(t) <= 1) break;
    if (t.mods > 0) t.mods--;
    else if (t.commanders.length > 0) t.commanders.pop();
    else break;
    removed++;
  }
  if (units(t) === 0 && !t.station) {
    const prev = t.owner;
    t.owner = null;
    onOwnerChange(s, id);
    if (prev) checkElimination(s, prev);
  }
  return removed;
}

export function checkElimination(s: GameState, pid: string): void {
  if (pid === NEUTRAL_ID) return;
  const p = player(s, pid);
  if (p.eliminated) return;
  if (totalUnits(s, pid) > 0) return;
  // Ohne Einheiten scheidet der Spieler aus; Stationen werden entfernt, Karten abgelegt (RH S. 7)
  p.eliminated = true;
  for (const id of TERRITORY_IDS) {
    const t = s.territories[id];
    if (t.owner === pid) {
      t.station = false;
      t.owner = null;
      onOwnerChange(s, id);
    }
  }
  s.discard.push(...p.hand);
  p.hand = [];
  log(s, { kind: 'system', msg: `${p.name} ist ausgeschieden.`, player: pid });
  if (activePlayers(s).length <= 1 && s.phase !== 'gameOver') s.phase = 'gameOver';
}

/** Übernahme eines Gebiets nach Eroberung: Station ersetzen oder zerstören */
export function takeOver(s: GameState, id: string, newOwner: string): void {
  const t = terr(s, id);
  const prev = t.owner;
  if (t.station && prev !== newOwner) {
    if (stationCount(s, newOwner) >= MAX_STATIONS) {
      t.station = false;
      log(s, { kind: 'text', msg: `Station in ${tname(id)} zerstört (Limit ${MAX_STATIONS} erreicht).` });
    } else {
      log(s, { kind: 'text', msg: `${pname(s, newOwner)} übernimmt die Station in ${tname(id)}.` });
    }
  }
  t.owner = newOwner;
  onOwnerChange(s, id);
}

// ---------------------------------------------------------------- Graph-Hilfen
/** Pfad über kontrollierte Gebiete (inkl. Station <-> Landeplatz) für die Truppenbewegung */
export function pathExists(s: GameState, pid: string, from: string, to: string): boolean {
  if (from === to) return false;
  const seen = new Set([from]);
  const queue = [from];
  const ownStationTerrs = TERRITORY_IDS.filter((id) => s.territories[id].owner === pid && s.territories[id].station);
  while (queue.length) {
    const cur = queue.shift()!;
    const next = [...nbrs(s, cur)];
    if (ownStationTerrs.includes(cur)) next.push(...LANDING_SITES);
    if (TDEF[cur].landingSite) next.push(...ownStationTerrs);
    for (const n of next) {
      if (seen.has(n) || s.territories[n].owner !== pid) continue;
      if (n === to) return true;
      seen.add(n);
      queue.push(n);
    }
  }
  return false;
}

/** Gebiete in Reichweite n (Grenzübertritte) von eigenen Gebieten aus */
export function withinRange(s: GameState, pid: string, n: number): Set<string> {
  const start = owned(s, pid);
  const dist = new Map<string, number>(start.map((id) => [id, 0]));
  const queue = [...start];
  while (queue.length) {
    const cur = queue.shift()!;
    const d = dist.get(cur)!;
    if (d >= n) continue;
    for (const nb of nbrs(s, cur)) {
      if (!dist.has(nb)) { dist.set(nb, d + 1); queue.push(nb); }
    }
  }
  return new Set(dist.keys());
}

export function adjacentToOwn(s: GameState, pid: string, id: string): boolean {
  return nbrs(s, id).some((n) => s.territories[n].owner === pid);
}

