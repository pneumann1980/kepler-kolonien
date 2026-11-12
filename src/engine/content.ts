// Statische Spielinhalte: Karte, Regionen, Score-Chart-Tabelle, Konstanten
import mapJson from '../../content/board/map.json' with { type: 'json' };
import type { MapDef, RegionDef, TerritoryDef, TerritoryType, CommanderType } from './types.ts';

export const MAP: MapDef = {
  id: (mapJson as { id: string }).id,
  name: (mapJson as { name: string }).name,
  territories: (mapJson as unknown as { territories: TerritoryDef[] }).territories,
  regions: (mapJson as unknown as { regions: RegionDef[] }).regions,
};

export const TDEF: Record<string, TerritoryDef> = Object.fromEntries(MAP.territories.map((t) => [t.id, t]));
export const RDEF: Record<string, RegionDef> = Object.fromEntries(MAP.regions.map((r) => [r.id, r]));
export const REGION_MEMBERS: Record<string, string[]> = {};
for (const t of MAP.territories) (REGION_MEMBERS[t.region] ??= []).push(t.id);
export const TERRITORY_IDS = MAP.territories.map((t) => t.id);
export const IDS_BY_TYPE: Record<TerritoryType, string[]> = {
  land: MAP.territories.filter((t) => t.type === 'land').map((t) => t.id),
  water: MAP.territories.filter((t) => t.type === 'water').map((t) => t.id),
  moon: MAP.territories.filter((t) => t.type === 'moon').map((t) => t.id),
};
export const LANDING_SITES = MAP.territories.filter((t) => t.landingSite).map((t) => t.id);
const ADJ: Record<string, Set<string>> = Object.fromEntries(MAP.territories.map((t) => [t.id, new Set(t.adjacent)]));
export function isAdjacent(a: string, b: string): boolean {
  return ADJ[a]?.has(b) ?? false;
}
export function neighbors(a: string): string[] {
  return TDEF[a]?.adjacent ?? [];
}
/** Landgebiet grenzt an Wasser */
export function isCoastal(id: string): boolean {
  return TDEF[id].type === 'land' && neighbors(id).some((n) => TDEF[n].type === 'water');
}

/**
 * Score Chart (Regelheft S. 3): [ab Gebietszahl, Grundwert]. Grundwert = MODs = Energie.
 * Abweichung von floor(n/3) bei 45 (=14). Feld 15 im Regelheft verdeckt -> 5 angenommen.
 */
export const INCOME_TABLE: [number, number][] = [
  [0, 3], [12, 4], [15, 5], [18, 6], [21, 7], [24, 8], [27, 9], [30, 10], [33, 11], [36, 12],
  [39, 13], [42, 14], [46, 15], [48, 16], [51, 17], [54, 18], [57, 19], [60, 20], [63, 21], [66, 22], [69, 23],
];
export function baseIncome(territories: number): number {
  let v = 3;
  for (const [from, val] of INCOME_TABLE) if (territories >= from) v = val;
  return v;
}

/**
 * Kartenrevisionen. Die Gebiete, Regionen und Boni sind identisch; Revision 2 ergänzt genau eine
 * Landverbindung über den Ost-West-Rand (Kaltmark <-> Kupferhang). Partien mit der alten Kennung behalten
 * ihre Topologie.
 */
export const MAP_ID_V1 = 'kepler-colonies';
export const MAP_ID_V2 = 'kepler-colonies-2';
export const CURRENT_MAP_ID = MAP_ID_V2;
export const EAST_WEST_LAND_ROUTE: [string, string] = ['BOR-3', 'VEL-5'];
const EXTRA_V2: Record<string, string[]> = { 'BOR-3': ['VEL-5'], 'VEL-5': ['BOR-3'] };

/** Nachbarn eines Gebiets für eine bestimmte Kartenrevision (Spielregeln, Client und Bots nutzen nur dies) */
export function neighborsFor(mapId: string, id: string): string[] {
  const base = TDEF[id]?.adjacent ?? [];
  if (mapId === MAP_ID_V2 && EXTRA_V2[id]) return [...base, ...EXTRA_V2[id]];
  return base;
}
export function adjacentFor(mapId: string, a: string, b: string): boolean {
  return (ADJ[a]?.has(b) ?? false) || (mapId === MAP_ID_V2 && (EXTRA_V2[a]?.includes(b) ?? false));
}

export const START_MODS: Record<number, number> = { 2: 30, 3: 35, 4: 30, 5: 25 };
export const COSTS = { commander: 3, station: 5, card: 1 } as const;
export const MAX_STATIONS = 4;
export const MAX_CARD_BUY = 4;
export const DEVASTATED_AT_SETUP = 4;
export const TWO_PLAYER_NEUTRAL = { land: 16, water: 6, moon: 6, mods: 3 } as const;
export const NEUTRAL_ID = 'neutral';

export const PLAYER_COLORS = ['#e5484d', '#f2b134', '#30a46c', '#8e4ec6', '#0090ff'];
export const COLOR_NAMES: Record<string, string> = {
  '#e5484d': 'Rot', '#f2b134': 'Gelb', '#30a46c': 'Grün', '#8e4ec6': 'Violett', '#0090ff': 'Blau', '#8b93a1': 'Neutral',
};

export const COMMANDER_NAMES: Record<CommanderType, string> = {
  LAND: 'Land', NAVAL: 'Marine', SPACE: 'Raum', NUCLEAR: 'Nuklear', DIPLOMAT: 'Diplomat',
};
export const COMMANDER_SHORT: Record<CommanderType, string> = {
  LAND: 'L', NAVAL: 'M', SPACE: 'R', NUCLEAR: 'N', DIPLOMAT: 'D',
};
