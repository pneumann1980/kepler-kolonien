// Anzeigenamen von Gebieten/Regionen in der Kartenrevision der gerade angezeigten Partie
// (alte Partien behalten die Namen der Kepler-Fantasiekarte, neue zeigen die Erdkarte).
import { territoryName, regionName, CURRENT_MAP_ID } from '../engine/index.ts';

let current: string = CURRENT_MAP_ID;
/** Wird beim Rendern einer Partie gesetzt; der Client zeigt immer genau eine Partie an */
export function setNameMap(mapId: string | undefined): void {
  current = mapId ?? CURRENT_MAP_ID;
}
export const tn = (id: string): string => territoryName(current, id);
export const rn = (id: string): string => regionName(current, id);
