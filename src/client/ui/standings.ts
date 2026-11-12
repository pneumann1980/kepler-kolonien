// Zwischenstand für die Kopfleiste: Gebiete + Regionsboni (ohne private Wertungskarten); Gleichstand wie bei der Endwertung
import { RDEF, owned, totalUnits, controlledRegions, stationCount } from '../../engine/index.ts';
import type { GameState } from '../../engine/index.ts';
import type { GameView } from '../api.ts';

export interface Standing {
  id: string; name: string; color: string; seat: number; rank: number;
  territories: number; regions: number; total: number; energy: number; units: number; stations: number;
  active: boolean; me: boolean; eliminated: boolean; bot: boolean;
}

export function standings(view: GameView): Standing[] {
  const s = view as unknown as GameState;
  const rows = view.players.filter((p) => !p.isNeutral).map((p) => {
    const territories = owned(s, p.id).length;
    const regions = controlledRegions(s, p.id).reduce((n, r) => n + RDEF[r].bonus, 0);
    return {
      id: p.id, name: p.name, color: p.color, seat: Math.max(0, view.seatOrder.indexOf(p.id)), rank: 0,
      territories, regions, total: territories + regions, energy: p.energy, units: totalUnits(s, p.id), stations: stationCount(s, p.id),
      active: view.pending.includes(p.id), me: p.id === view.me, eliminated: Boolean(p.eliminated), bot: Boolean(p.isBot),
    } as Standing;
  });
  rows.sort((a, b) => Number(a.eliminated) - Number(b.eliminated) || b.total - a.total || b.energy - a.energy || b.units - a.units);
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    r.rank = prev && !prev.eliminated && !r.eliminated && prev.total === r.total && prev.energy === r.energy && prev.units === r.units ? prev.rank : i + 1;
  });
  return rows;
}
