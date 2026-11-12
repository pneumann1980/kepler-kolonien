// Statische Spielinhalte: Karte, Regionen, Score-Chart-Tabelle, Konstanten
import mapJson from '../../content/board/map.json' with { type: 'json' };
import legacyMapJson from '../../content/board/legacy/kepler-colonies-map.json' with { type: 'json' };
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
/** Landgebiet grenzt an Wasser (gemäß Kartenrevision) */
export function isCoastalFor(mapId: string, id: string): boolean {
  return TDEF[id].type === 'land' && neighborsFor(mapId, id).some((n) => TDEF[n].type === 'water');
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
 * Kartenrevisionen. Gebiets-IDs, Regionen, Typen, Landeplätze und Boni sind in allen Revisionen identisch;
 * es unterscheiden sich Nachbarschaften, Namen und Darstellung.
 *  - kepler-colonies    (Rev. 1): Kepler-Fantasiekarte, Graph aus content/board/legacy/kepler-colonies-map.json
 *  - kepler-colonies-2  (Rev. 2): wie Rev. 1 + Landroute Kaltmark <-> Kupferhang über den Ost-West-Rand
 *  - kepler-earth-3     (Rev. 3): Erde & Mond (Natural Earth / NASA), eigener Graph aus content/board/map.json;
 *                                 Ost-West-Landroute Beringia <-> Fernost über die Beringstraße
 * Laufende Partien behalten die Kennung, mit der sie angelegt wurden.
 */
export const MAP_ID_V1 = 'kepler-colonies';
export const MAP_ID_V2 = 'kepler-colonies-2';
export const MAP_ID_V3 = 'kepler-earth-3';
export const CURRENT_MAP_ID = MAP_ID_V3;
export const MAP_IDS = [MAP_ID_V1, MAP_ID_V2, MAP_ID_V3] as const;
if (MAP.id !== MAP_ID_V3) throw new Error(`content/board/map.json hat Kennung ${MAP.id}, erwartet ${MAP_ID_V3}`);
/** Ost-West-Landroute je Revision (Rev. 1: keine) */
export const EAST_WEST_LAND_ROUTES: Record<string, [string, string] | null> = {
  [MAP_ID_V1]: null, [MAP_ID_V2]: ['BOR-3', 'VEL-5'], [MAP_ID_V3]: ['BOR-1', 'KAS-4'],
};
/** @deprecated Rev.-2-Route; für neue Partien EAST_WEST_LAND_ROUTES[CURRENT_MAP_ID] verwenden */
export const EAST_WEST_LAND_ROUTE: [string, string] = ['BOR-3', 'VEL-5'];

const LEGACY_TERRITORIES = (legacyMapJson as unknown as { territories: TerritoryDef[] }).territories;
const LEGACY_REGIONS = (legacyMapJson as unknown as { regions: RegionDef[] }).regions;
function adjOf(list: { id: string; adjacent: string[] }[], extra: Record<string, string[]> = {}): Record<string, string[]> {
  return Object.fromEntries(list.map((t) => [t.id, [...t.adjacent, ...(extra[t.id] ?? [])]]));
}
const GRAPH: Record<string, Record<string, string[]>> = {
  [MAP_ID_V1]: adjOf(LEGACY_TERRITORIES),
  [MAP_ID_V2]: adjOf(LEGACY_TERRITORIES, { 'BOR-3': ['VEL-5'], 'VEL-5': ['BOR-3'] }),
  [MAP_ID_V3]: adjOf(MAP.territories),
};
const GRAPH_SETS: Record<string, Record<string, Set<string>>> = Object.fromEntries(
  Object.entries(GRAPH).map(([k, g]) => [k, Object.fromEntries(Object.entries(g).map(([id, ns]) => [id, new Set(ns)]))]),
);
const NAMES: Record<string, Record<string, string>> = {
  [MAP_ID_V1]: Object.fromEntries(LEGACY_TERRITORIES.map((t) => [t.id, t.name])),
  [MAP_ID_V3]: Object.fromEntries(MAP.territories.map((t) => [t.id, t.name])),
};
NAMES[MAP_ID_V2] = NAMES[MAP_ID_V1];
const REGION_NAMES: Record<string, Record<string, string>> = {
  [MAP_ID_V1]: Object.fromEntries(LEGACY_REGIONS.map((r) => [r.id, r.name])),
  [MAP_ID_V3]: Object.fromEntries(MAP.regions.map((r) => [r.id, r.name])),
};
REGION_NAMES[MAP_ID_V2] = REGION_NAMES[MAP_ID_V1];

function rev(mapId: string): string {
  return GRAPH[mapId] ? mapId : MAP_ID_V1;   // unbekannte/alte Kennungen: ursprünglicher Graph
}
/** Nachbarn eines Gebiets für eine bestimmte Kartenrevision (Spielregeln, Client und Bots nutzen nur dies) */
export function neighborsFor(mapId: string, id: string): string[] {
  return GRAPH[rev(mapId)][id] ?? [];
}
export function adjacentFor(mapId: string, a: string, b: string): boolean {
  return GRAPH_SETS[rev(mapId)][a]?.has(b) ?? false;
}
/** Anzeigename eines Gebiets in der Kartenrevision der Partie */
export function territoryName(mapId: string | undefined, id: string): string {
  return NAMES[rev(mapId ?? CURRENT_MAP_ID)][id] ?? id;
}
export function regionName(mapId: string | undefined, id: string): string {
  return REGION_NAMES[rev(mapId ?? CURRENT_MAP_ID)][id] ?? id;
}
export function isLegacyMap(mapId: string): boolean {
  return rev(mapId) !== MAP_ID_V3;
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
