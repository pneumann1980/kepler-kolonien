// Kommandokarten (eigene Inhalte, siehe docs/KARTEN.md): 5 Decks à 20 Karten, 67 Typen
import { TDEF, RDEF, REGION_MEMBERS, IDS_BY_TYPE, MAX_STATIONS, COSTS, isCoastalFor } from './content.ts';
import { roll, randInt } from './rng.ts';
import {
  fail, player, pname, tname, terr, units, owned, commanderLocation, commanderInPlay, stationCount,
  log, addEffect, findEffects, removeUnits, moveUnits, validateMove, controlsRegion, withinRange,
  adjacentToOwn, checkElimination, onOwnerChange, controlledRegions, nbrs,
} from './state.ts';
import type { CommanderType, GameState, Invasion, Targets, UnitMove } from './types.ts';
import { COMMANDER_TYPES } from './types.ts';

export type Timing = 'VOR' | 'ANG' | 'REA' | 'ERO' | 'KAR' | 'ENDE' | 'GEBOT' | 'WERT';
export type TargetKind =
  | 'none' | 'ownTerritory' | 'ownLand' | 'ownWater' | 'ownMoon' | 'ownStation' | 'ownCoastal'
  | 'enemyTerritory' | 'anyTerritory' | 'player' | 'deck' | 'distribute' | 'move';

export interface ReactionCtx {
  invasion?: Invasion;
  conquest?: { territory: string; by: string; advanced: number; previousOwner: string };
  card?: { player: string; inst: string; targets: Targets };
}

export interface CardDef {
  id: string;
  deck: CommanderType;
  name: string;
  copies: number;
  powerUp: number;
  timing: Timing;
  text: string;
  target: TargetKind;
  /** Für Gebietsziele: erlaubte Gebiete */
  targets?: (s: GameState, pid: string) => string[];
  distribute?: number;
  moveMax?: number;
  /** Zusatzbedingung, gibt Fehlertext zurück */
  check?: (s: GameState, pid: string, ctx: ReactionCtx) => string | null;
  /** Standardbedingung für automatische Reaktion / Bot-Nutzen */
  react?: (s: GameState, pid: string, ctx: ReactionCtx) => boolean;
  apply: (s: GameState, pid: string, tg: Targets, ctx: ReactionCtx) => void;
  /** Wertungspunkte bei Spielende (WERT) */
  score?: (s: GameState, pid: string) => number;
  value: number;
}

// ------------------------------------------------------------------ Hilfen
function hits(s: GameState, dice: number, min: number): number {
  let n = 0;
  for (let i = 0; i < dice; i++) if (roll(s.rng, 6) >= min) n++;
  return n;
}
function ownOf(type?: 'land' | 'water' | 'moon') {
  return (s: GameState, pid: string) => owned(s, pid).filter((id) => !type || TDEF[id].type === type);
}
function enemyWithUnits(s: GameState, pid: string): string[] {
  return Object.keys(s.territories).filter((id) => {
    const t = s.territories[id];
    return t.owner && t.owner !== pid && units(t) > 0;
  });
}
function inRange(n: number) {
  return (s: GameState, pid: string) => {
    const r = withinRange(s, pid, n);
    return enemyWithUnits(s, pid).filter((id) => r.has(id));
  };
}
function defendingSelf(type?: 'land' | 'water') {
  return (s: GameState, pid: string, ctx: ReactionCtx): string | null => {
    const inv = ctx.invasion;
    if (!inv) return 'Nur als Reaktion auf eine Invasion';
    if (s.territories[inv.to].owner !== pid) return 'Nur wenn dein Gebiet angegriffen wird';
    if (type && TDEF[inv.to].type !== type) return `Nur für ${type === 'land' ? 'Land' : 'Wasser'}gebiete`;
    return null;
  };
}
function attackerUnits(s: GameState, ctx: ReactionCtx): number {
  return ctx.invasion ? units(s.territories[ctx.invasion.from]) : 0;
}
function defUnits(s: GameState, ctx: ReactionCtx): number {
  return ctx.invasion ? units(s.territories[ctx.invasion.to]) : 0;
}
function moveCommander(s: GameState, pid: string, type: CommanderType, to: string): void {
  const from = commanderLocation(s, pid, type);
  if (!from) fail('Kommandant nicht im Spiel');
  if (from === to) fail('Kommandant steht bereits dort');
  const t = terr(s, from);
  if (units(t) - 1 < 1 && !t.station) fail('Das Ausgangsgebiet darf nicht leer werden');
  t.commanders = t.commanders.filter((c) => c !== type);
  terr(s, to).commanders.push(type);
}
function waterColoniesTouching(s: GameState, id: string): Set<string> {
  const res = new Set<string>();
  const d = TDEF[id];
  if (d.type === 'water') res.add(d.region);
  for (const n of nbrs(s, id)) if (TDEF[n].type === 'water') res.add(TDEF[n].region);
  return res;
}
function damage(s: GameState, id: string, n: number, keepOne = false): number {
  const owner = s.territories[id].owner;
  const r = removeUnits(s, id, n, keepOne);
  if (owner) checkElimination(s, owner);
  return r;
}
function nextTurnStart(pid: string) {
  return { at: 'turnStart' as const, player: pid };
}
function thisTurnEnd(pid: string) {
  return { at: 'turnEnd' as const, player: pid };
}

// ------------------------------------------------------------------ Definitionen
export const CARD_DEFS: CardDef[] = [
  // ============================ LAND
  {
    id: 'LAN-01', deck: 'LAND', name: 'Gezielte Mobilisierung', copies: 3, powerUp: 0, timing: 'VOR', target: 'none', value: 3,
    text: '+3 MODs in das Gebiet deines Land-Kommandanten.',
    apply: (s, pid) => { const at = commanderLocation(s, pid, 'LAND')!; terr(s, at).mods += 3; },
  },
  {
    id: 'LAN-02', deck: 'LAND', name: 'Tarnstellung', copies: 2, powerUp: 1, timing: 'REA', target: 'none', value: 3,
    text: 'Invasion in ein Landgebiet erklärt: +2 MODs des Verteidigers im angegriffenen Gebiet.',
    check: defendingSelf('land'),
    react: (s, pid, ctx) => defUnits(s, ctx) <= 4 && attackerUnits(s, ctx) >= 3,
    apply: (s, _pid, _tg, ctx) => { terr(s, ctx.invasion!.to).mods += 2; },
  },
  {
    id: 'LAN-03', deck: 'LAND', name: 'Grabenkrieg', copies: 2, powerUp: 1, timing: 'REA', target: 'none', value: 2,
    text: 'Eigenes Landgebiet angegriffen: Der Angreifer würfelt in dieser Invasion mit höchstens 2 Würfeln.',
    check: defendingSelf('land'),
    react: (s, _pid, ctx) => attackerUnits(s, ctx) >= 5,
    apply: (_s, _pid, _tg, ctx) => { ctx.invasion!.mods.maxAttackDice = 2; },
  },
  {
    id: 'LAN-04', deck: 'LAND', name: 'Sturmangriff', copies: 2, powerUp: 1, timing: 'ANG', target: 'none', value: 2,
    text: 'Eigene Invasion von oder in Land, Land-Kdt im Quellgebiet: Bis zu 2 Angriffswürfel sind W8.',
    check: (s, _pid, ctx) => {
      const inv = ctx.invasion!;
      if (!terr(s, inv.from).commanders.includes('LAND')) return 'Land-Kommandant muss im Quellgebiet stehen';
      if (TDEF[inv.from].type !== 'land' && TDEF[inv.to].type !== 'land') return 'Nur bei Invasionen von oder in Land';
      return null;
    },
    apply: (_s, _pid, _tg, ctx) => { ctx.invasion!.mods.attackerExtraD8 = (ctx.invasion!.mods.attackerExtraD8 ?? 0) + 1; },
  },
  {
    id: 'LAN-05', deck: 'LAND', name: 'Nachschubkolonne', copies: 1, powerUp: 1, timing: 'VOR', target: 'none', value: 4,
    text: '+1 MOD in jedes eigene Gebiet, das an ein gegnerisches Landgebiet grenzt (max. 5).',
    apply: (s, pid) => {
      const front = owned(s, pid).filter((id) => nbrs(s, id).some((n) => {
        const o = s.territories[n].owner; return o && o !== pid && TDEF[n].type === 'land';
      }));
      front.sort((a, b) => units(s.territories[a]) - units(s.territories[b]));
      for (const id of front.slice(0, 5)) terr(s, id).mods += 1;
    },
  },
  {
    id: 'LAN-06', deck: 'LAND', name: 'Garnison', copies: 1, powerUp: 3, timing: 'VOR', target: 'ownLand', value: 3,
    text: 'Ein eigenes Landgebiet verteidigt bis zu deinem nächsten Zug mit W8 für alle Einheiten.',
    targets: ownOf('land'),
    apply: (s, pid, tg) => { addEffect(s, { kind: 'garrison', owner: pid, territory: tg.territory, expires: nextTurnStart(pid) }); },
  },
  {
    id: 'LAN-07', deck: 'LAND', name: 'Rekrutierungswelle', copies: 2, powerUp: 2, timing: 'VOR', target: 'distribute', distribute: 4, value: 4,
    text: '+4 MODs, verteilt auf eigene Gebiete eines Kontinents, in dem du mindestens 3 Gebiete kontrollierst.',
    targets: (s, pid) => owned(s, pid).filter((id) => {
      const d = TDEF[id];
      return RDEF[d.region].kind === 'continent' && REGION_MEMBERS[d.region].filter((x) => s.territories[x].owner === pid).length >= 3;
    }),
    check: (s, pid) => (CARD['LAN-07'].targets!(s, pid).length ? null : 'Kein Kontinent mit mindestens 3 eigenen Gebieten'),
    apply: (s, _pid, tg) => {
      const regions = new Set(Object.keys(tg.placements ?? {}).map((id) => TDEF[id].region));
      if (regions.size !== 1) fail('Alle MODs müssen in denselben Kontinent');
      for (const [id, n] of Object.entries(tg.placements!)) terr(s, id).mods += n;
    },
  },
  {
    id: 'LAN-08', deck: 'LAND', name: 'Brückenkopf', copies: 1, powerUp: 1, timing: 'VOR', target: 'ownCoastal', value: 2,
    text: 'Bis Zugende grenzt ein eigenes Küstengebiet an alle Landgebiete am selben Wassergebiet (ohne Marine-Kdt).',
    targets: (s, pid) => owned(s, pid).filter((id) => isCoastalFor(s.mapId, id)),
    apply: (s, pid, tg) => { addEffect(s, { kind: 'bridgehead', owner: pid, territory: tg.territory, expires: thisTurnEnd(pid) }); },
  },
  {
    id: 'LAN-09', deck: 'LAND', name: 'Verbrannte Erde', copies: 1, powerUp: 0, timing: 'ERO', target: 'none', value: 2,
    text: 'Eigenes Landgebiet erobert: 2 der nachgezogenen Einheiten des Eroberers werden vernichtet (mind. 1 bleibt).',
    check: (_s, pid, ctx) => (ctx.conquest && ctx.conquest.previousOwner === pid && TDEF[ctx.conquest.territory].type === 'land' ? null : 'Nur wenn dein Landgebiet erobert wurde'),
    react: (_s, _pid, ctx) => (ctx.conquest?.advanced ?? 0) >= 2,
    apply: (s, _pid, _tg, ctx) => { damage(s, ctx.conquest!.territory, 2, true); },
  },
  {
    id: 'LAN-10', deck: 'LAND', name: 'Feldkommando', copies: 1, powerUp: 2, timing: 'VOR', target: 'none', value: 3,
    text: 'Bis zu deinem nächsten Zug würfelt in eigenen Gebieten an deinem Land-Kdt ein Verteidigungswürfel als W8.',
    apply: (s, pid) => { addEffect(s, { kind: 'fieldCommand', owner: pid, expires: nextTurnStart(pid) }); },
  },
  {
    id: 'LAN-11', deck: 'LAND', name: 'Offensivprämie', copies: 1, powerUp: 0, timing: 'ENDE', target: 'none', value: 2,
    text: 'Hast du in diesem Zug mindestens 2 umkämpfte Landgebiete erobert: +2 Energie.',
    check: (s) => ((s.turn?.conqueredLand ?? 0) >= 2 ? null : 'Erst nach 2 eroberten umkämpften Landgebieten'),
    apply: (s, pid) => { player(s, pid).energy += 2; },
  },
  {
    id: 'LAN-12', deck: 'LAND', name: 'Hinterhalt', copies: 1, powerUp: 2, timing: 'REA', target: 'none', value: 1,
    text: 'Eigenes Landgebiet angegriffen: W6 vor dem ersten Wurf, bei 4–6 verliert der Angreifer 1 Einheit.',
    check: defendingSelf('land'),
    react: (s, _pid, ctx) => attackerUnits(s, ctx) >= 3,
    apply: (s, pid, _tg, ctx) => {
      const r = roll(s.rng, 6);
      if (r >= 4) { removeUnits(s, ctx.invasion!.from, 1, true); log(s, { kind: 'text', msg: `Hinterhalt (${r}): Angreifer verliert 1 Einheit.`, player: pid }); }
      else log(s, { kind: 'text', msg: `Hinterhalt (${r}): ohne Wirkung.`, player: pid });
    },
  },
  {
    id: 'LAN-13', deck: 'LAND', name: 'Territorialanspruch', copies: 1, powerUp: 0, timing: 'WERT', target: 'none', value: 2,
    text: 'Wertung: +1 Punkt je vollständig kontrolliertem Kontinent.',
    apply: () => {},
    score: (s, pid) => controlledRegions(s, pid).filter((r) => RDEF[r].kind === 'continent').length,
  },
  {
    id: 'LAN-14', deck: 'LAND', name: 'Kommandowechsel', copies: 1, powerUp: 0, timing: 'VOR', target: 'ownTerritory', value: 1,
    text: 'Versetze deinen Land-Kdt in ein beliebiges eigenes Gebiet.',
    targets: ownOf(),
    apply: (s, pid, tg) => moveCommander(s, pid, 'LAND', tg.territory!),
  },

  // ============================ MARINE
  {
    id: 'NAV-01', deck: 'NAVAL', name: 'Tiefsee-Raffinerie', copies: 3, powerUp: 0, timing: 'VOR', target: 'none', value: 2,
    text: '+1 Energie je eigenem Wassergebiet (max. 4).',
    apply: (s, pid) => { player(s, pid).energy += Math.min(4, ownOf('water')(s, pid).length); },
  },
  {
    id: 'NAV-02', deck: 'NAVAL', name: 'Strömungsvorstoß', copies: 1, powerUp: 1, timing: 'VOR', target: 'none', value: 2,
    text: 'Bis Zugende grenzen deine Wassergebiete an alle Gebiete derselben Wasserkolonie und deren Küsten.',
    apply: (s, pid) => { addEffect(s, { kind: 'currents', owner: pid, expires: thisTurnEnd(pid) }); },
  },
  {
    id: 'NAV-03', deck: 'NAVAL', name: 'Minenfeld', copies: 2, powerUp: 2, timing: 'REA', target: 'none', value: 2,
    text: 'Eigenes Wassergebiet angegriffen: Der Angreifer verliert vor dem ersten Wurf 1 Einheit.',
    check: defendingSelf('water'),
    react: (s, _pid, ctx) => attackerUnits(s, ctx) >= 3,
    apply: (s, _pid, _tg, ctx) => { removeUnits(s, ctx.invasion!.from, 1, true); },
  },
  {
    id: 'NAV-04', deck: 'NAVAL', name: 'Amphibienlandung', copies: 2, powerUp: 1, timing: 'ANG', target: 'none', value: 2,
    text: 'Eigene Invasion aus Wasser in Land: Bis zu 2 Angriffswürfel sind W8.',
    check: (_s, _pid, ctx) => (TDEF[ctx.invasion!.from].type === 'water' && TDEF[ctx.invasion!.to].type === 'land' ? null : 'Nur bei Invasion aus Wasser in Land'),
    apply: (_s, _pid, _tg, ctx) => { ctx.invasion!.mods.attackerMinD8 = 2; },
  },
  {
    id: 'NAV-05', deck: 'NAVAL', name: 'Konvoi', copies: 2, powerUp: 1, timing: 'VOR', target: 'move', moveMax: 5, value: 2,
    text: 'Bewege bis zu 5 Einheiten zwischen zwei eigenen Gebieten an derselben Wasserkolonie.',
    targets: (s, pid) => owned(s, pid).filter((id) => waterColoniesTouching(s, id).size > 0),
    apply: (s, pid, tg) => {
      const a = tg.territory!, b = tg.territory2!;
      const ca = waterColoniesTouching(s, a), cb = waterColoniesTouching(s, b);
      if (![...ca].some((c) => cb.has(c))) fail('Beide Gebiete müssen an dieselbe Wasserkolonie grenzen');
      if (s.territories[b].owner !== pid) fail('Ziel muss dir gehören');
      doMove(s, a, b, tg.count ?? 0, 5);
    },
  },
  {
    id: 'NAV-06', deck: 'NAVAL', name: 'Unterwasserbergbau', copies: 2, powerUp: 0, timing: 'VOR', target: 'none', value: 2,
    text: '+2 Energie; +1 weitere, wenn du eine Wasserkolonie vollständig kontrollierst.',
    apply: (s, pid) => {
      const any = controlledRegions(s, pid).some((r) => RDEF[r].kind === 'waterColony');
      player(s, pid).energy += any ? 3 : 2;
    },
  },
  {
    id: 'NAV-07', deck: 'NAVAL', name: 'Torpedo-Salve', copies: 1, powerUp: 2, timing: 'VOR', target: 'enemyTerritory', value: 1,
    text: 'Gegnerisches Küstengebiet neben eigenem Wassergebiet: 2 W6, je 5–6 → −1 Einheit. Keine Invasion.',
    targets: (s, pid) => enemyWithUnits(s, pid).filter((id) => TDEF[id].type === 'land' &&
      nbrs(s, id).some((n) => TDEF[n].type === 'water' && s.territories[n].owner === pid)),
    apply: (s, pid, tg) => {
      const h = hits(s, 2, 5); const r = damage(s, tg.territory!, h);
      log(s, { kind: 'text', msg: `Torpedo-Salve auf ${tname(tg.territory!, s)}: ${r} Verluste.`, player: pid });
    },
  },
  {
    id: 'NAV-08', deck: 'NAVAL', name: 'Seesperre', copies: 1, powerUp: 2, timing: 'VOR', target: 'ownWater', value: 2,
    text: 'Ein eigenes Wassergebiet kann bis zu deinem nächsten Zug nicht angegriffen werden.',
    targets: ownOf('water'),
    apply: (s, pid, tg) => { addEffect(s, { kind: 'seaBlock', owner: pid, territory: tg.territory, expires: nextTurnStart(pid) }); },
  },
  {
    id: 'NAV-09', deck: 'NAVAL', name: 'Hafenausbau', copies: 1, powerUp: 2, timing: 'VOR', target: 'ownCoastal', value: 4,
    text: 'Hafen in ein eigenes Küstengebiet: beim Einkommen +1 MOD dort, solange du es kontrollierst.',
    targets: (s, pid) => owned(s, pid).filter((id) => isCoastalFor(s.mapId, id) && !findEffects(s, 'harbor', (e) => e.territory === id).length),
    apply: (s, pid, tg) => { addEffect(s, { kind: 'harbor', owner: pid, territory: tg.territory, expires: 'permanent' }); },
  },
  {
    id: 'NAV-10', deck: 'NAVAL', name: 'Sonar-Täuschung', copies: 1, powerUp: 1, timing: 'REA', target: 'none', value: 2,
    text: 'Eigenes Wassergebiet angegriffen: Der Angreifer würfelt in dieser Invasion nur W6.',
    check: defendingSelf('water'),
    react: (s, _pid, ctx) => terr(s, ctx.invasion!.from).commanders.length > 0,
    apply: (_s, _pid, _tg, ctx) => { ctx.invasion!.mods.attackerNoD8 = true; },
  },
  {
    id: 'NAV-11', deck: 'NAVAL', name: 'Flottenverlegung', copies: 1, powerUp: 0, timing: 'VOR', target: 'ownTerritory', value: 1,
    text: 'Versetze deinen Marine-Kdt in ein beliebiges eigenes Gebiet.',
    targets: ownOf(),
    apply: (s, pid, tg) => moveCommander(s, pid, 'NAVAL', tg.territory!),
  },
  {
    id: 'NAV-12', deck: 'NAVAL', name: 'Küstenpatrouille', copies: 2, powerUp: 0, timing: 'VOR', target: 'none', value: 2,
    text: 'Je +1 MOD in bis zu 3 verschiedene eigene Wassergebiete.',
    check: (s, pid) => (ownOf('water')(s, pid).length ? null : 'Du kontrollierst kein Wassergebiet'),
    apply: (s, pid) => {
      const w = ownOf('water')(s, pid).sort((a, b) => units(s.territories[a]) - units(s.territories[b]));
      for (const id of w.slice(0, 3)) terr(s, id).mods += 1;
    },
  },
  {
    id: 'NAV-13', deck: 'NAVAL', name: 'Herrschaft der Meere', copies: 1, powerUp: 0, timing: 'WERT', target: 'none', value: 2,
    text: 'Wertung: +1 Punkt je vollständig kontrollierter Wasserkolonie; +1 bei mindestens 5 Wassergebieten.',
    apply: () => {},
    score: (s, pid) => controlledRegions(s, pid).filter((r) => RDEF[r].kind === 'waterColony').length + (ownOf('water')(s, pid).length >= 5 ? 1 : 0),
  },

  // ============================ RAUM
  {
    id: 'SPC-01', deck: 'SPACE', name: 'Orbitaler Nachschub', copies: 3, powerUp: 2, timing: 'VOR', target: 'ownStation', value: 3,
    text: '+3 MODs in das Gebiet einer eigenen Raumstation.',
    targets: (s, pid) => owned(s, pid).filter((id) => s.territories[id].station),
    apply: (s, _pid, tg) => { terr(s, tg.territory!).mods += 3; },
  },
  {
    id: 'SPC-02', deck: 'SPACE', name: 'Orbitale Verstärkung', copies: 1, powerUp: 2, timing: 'REA', target: 'none', value: 3,
    text: 'Gebiet mit eigener Station angegriffen: bis zu 3 Einheiten aus einem anderen Stationsgebiet dorthin verlegen.',
    check: (s, pid, ctx) => {
      const e = defendingSelf()(s, pid, ctx); if (e) return e;
      if (!s.territories[ctx.invasion!.to].station) return 'Nur für Gebiete mit Station';
      const src = owned(s, pid).filter((id) => id !== ctx.invasion!.to && s.territories[id].station && s.territories[id].mods >= 2);
      return src.length ? null : 'Keine andere Station mit verfügbaren MODs';
    },
    apply: (s, pid, _tg, ctx) => {
      const src = owned(s, pid).filter((id) => id !== ctx.invasion!.to && s.territories[id].station && s.territories[id].mods >= 2)
        .sort((a, b) => s.territories[b].mods - s.territories[a].mods)[0];
      const n = Math.min(3, s.territories[src].mods - 1);
      moveUnits(s, src, ctx.invasion!.to, { mods: n, commanders: [] });
    },
  },
  {
    id: 'SPC-03', deck: 'SPACE', name: 'Mondbasis-Ausbau', copies: 2, powerUp: 1, timing: 'VOR', target: 'ownMoon', value: 2,
    text: 'Mondbasis in ein eigenes Mondgebiet: +1 Wertungspunkt, solange du es kontrollierst.',
    targets: (s, pid) => ownOf('moon')(s, pid).filter((id) => !findEffects(s, 'moonBase', (e) => e.territory === id).length),
    apply: (s, pid, tg) => { addEffect(s, { kind: 'moonBase', owner: pid, territory: tg.territory, expires: 'permanent' }); },
  },
  {
    id: 'SPC-04', deck: 'SPACE', name: 'Orbitalsprung', copies: 2, powerUp: 1, timing: 'VOR', target: 'move', moveMax: 4, value: 2,
    text: 'Bewege bis zu 4 Einheiten aus einem eigenen Stationsgebiet in ein anderes.',
    targets: (s, pid) => owned(s, pid).filter((id) => s.territories[id].station),
    apply: (s, pid, tg) => {
      if (!s.territories[tg.territory2!]?.station || s.territories[tg.territory2!].owner !== pid) fail('Ziel muss ein eigenes Stationsgebiet sein');
      doMove(s, tg.territory!, tg.territory2!, tg.count ?? 0, 4);
    },
  },
  {
    id: 'SPC-05', deck: 'SPACE', name: 'Landekapsel', copies: 2, powerUp: 2, timing: 'ANG', target: 'none', value: 3,
    text: 'Eigene Invasion von oder in ein Mondgebiet: Alle Angriffswürfel sind W8.',
    check: (_s, _pid, ctx) => (TDEF[ctx.invasion!.from].type === 'moon' || TDEF[ctx.invasion!.to].type === 'moon' ? null : 'Nur bei Mond-Invasionen'),
    apply: (_s, _pid, _tg, ctx) => { ctx.invasion!.mods.attackerAllD8 = true; },
  },
  {
    id: 'SPC-06', deck: 'SPACE', name: 'Fertigbau-Modul', copies: 2, powerUp: 0, timing: 'VOR', target: 'ownLand', value: 2,
    text: 'Baue sofort eine Raumstation für 3 statt 5 Energie (Limits gelten).',
    targets: (s, pid) => ownOf('land')(s, pid).filter((id) => !s.territories[id].station),
    check: (s, pid) => (stationCount(s, pid) >= MAX_STATIONS ? 'Bereits 4 Stationen' : player(s, pid).energy < 3 ? 'Zu wenig Energie (3)' : null),
    apply: (s, pid, tg) => { player(s, pid).energy -= 3; terr(s, tg.territory!).station = true; },
  },
  {
    id: 'SPC-07', deck: 'SPACE', name: 'Orbitales Bombardement', copies: 1, powerUp: 3, timing: 'VOR', target: 'enemyTerritory', value: 2,
    text: 'Gegnerisches Gebiet neben einem eigenen Stationsgebiet: 3 W6, je 5–6 → −1 Einheit. Keine Invasion.',
    targets: (s, pid) => enemyWithUnits(s, pid).filter((id) => nbrs(s, id).some((n) => s.territories[n].owner === pid && s.territories[n].station)),
    apply: (s, pid, tg) => {
      const r = damage(s, tg.territory!, hits(s, 3, 5));
      log(s, { kind: 'text', msg: `Orbitales Bombardement auf ${tname(tg.territory!, s)}: ${r} Verluste.`, player: pid });
    },
  },
  {
    id: 'SPC-08', deck: 'SPACE', name: 'Schildgitter', copies: 1, powerUp: 2, timing: 'REA', target: 'none', value: 3,
    text: 'Gebiet mit eigener Station angegriffen: In dieser Invasion zählt jeder Verteidigungswürfel +1.',
    check: (s, pid, ctx) => defendingSelf()(s, pid, ctx) ?? (s.territories[ctx.invasion!.to].station ? null : 'Nur für Gebiete mit Station'),
    react: (s, _pid, ctx) => attackerUnits(s, ctx) >= 4,
    apply: (_s, _pid, _tg, ctx) => { ctx.invasion!.mods.defenderBonus = 1; },
  },
  {
    id: 'SPC-09', deck: 'SPACE', name: 'Satellitenaufklärung', copies: 1, powerUp: 0, timing: 'VOR', target: 'player', value: 1,
    text: 'Sieh dir die Handkarten eines Spielers an.',
    apply: (s, pid, tg) => {
      const other = player(s, tg.player!);
      const names = other.hand.map((c) => CARD[cardType(c)].name);
      log(s, { kind: 'text', to: pid, player: pid, msg: `Aufklärung ${other.name}: ${names.length ? names.join(', ') : 'keine Karten'}.` });
    },
  },
  {
    id: 'SPC-10', deck: 'SPACE', name: 'Mondkolonisten', copies: 1, powerUp: 1, timing: 'VOR', target: 'none', value: 2,
    text: '+1 MOD in jedes eigene Mondgebiet (max. 4).',
    check: (s, pid) => (ownOf('moon')(s, pid).length ? null : 'Du kontrollierst kein Mondgebiet'),
    apply: (s, pid) => { for (const id of ownOf('moon')(s, pid).slice(0, 4)) terr(s, id).mods += 1; },
  },
  {
    id: 'SPC-11', deck: 'SPACE', name: 'Erdlandung', copies: 2, powerUp: 2, timing: 'VOR', target: 'none', value: 2,
    text: 'Decke ein Landgebiet auf: Bis Zugende darfst du einmal von einem eigenen Mondgebiet aus dorthin invadieren.',
    check: (s, pid) => (ownOf('moon')(s, pid).some((id) => units(s.territories[id]) >= 2) ? null : 'Kein eigenes Mondgebiet mit mindestens 2 Einheiten'),
    apply: (s, pid) => {
      const deck = s.territoryDecks.land;
      if (!deck.length) { log(s, { kind: 'text', msg: 'Erdlandung: Landkarten-Deck leer.', player: pid }); return; }
      const target = deck.shift()!;
      if (s.territories[target].devastated) { log(s, { kind: 'text', msg: `Erdlandung: ${tname(target, s)} ist verwüstet – ohne Wirkung.`, player: pid }); return; }
      addEffect(s, { kind: 'earthLanding', owner: pid, territory: target, expires: thisTurnEnd(pid) });
      log(s, { kind: 'text', msg: `Erdlandung: Ziel ist ${tname(target, s)}.`, player: pid, data: { territory: target } });
    },
  },
  {
    id: 'SPC-12', deck: 'SPACE', name: 'Energiekollektor', copies: 1, powerUp: 0, timing: 'VOR', target: 'none', value: 2,
    text: '+1 Energie je eigener Raumstation.',
    apply: (s, pid) => { player(s, pid).energy += stationCount(s, pid); },
  },
  {
    id: 'SPC-13', deck: 'SPACE', name: 'Herrschaft über den Orbit', copies: 1, powerUp: 0, timing: 'WERT', target: 'none', value: 2,
    text: 'Wertung: +1 Punkt je eigener Raumstation.',
    apply: () => {},
    score: (s, pid) => stationCount(s, pid),
  },

  // ============================ NUKLEAR
  {
    id: 'NUC-01', deck: 'NUCLEAR', name: 'Präzisionsschlag', copies: 3, powerUp: 2, timing: 'VOR', target: 'enemyTerritory', value: 2,
    text: 'Gebiet in Reichweite 2: 3 W6, je 5–6 → −1 Einheit. Keine Invasion.',
    targets: inRange(2),
    apply: (s, pid, tg) => {
      const r = damage(s, tg.territory!, hits(s, 3, 5));
      log(s, { kind: 'text', msg: `Präzisionsschlag auf ${tname(tg.territory!, s)}: ${r} Verluste.`, player: pid });
    },
  },
  {
    id: 'NUC-02', deck: 'NUCLEAR', name: 'Flächenbombardement', copies: 1, powerUp: 4, timing: 'VOR', target: 'enemyTerritory', value: 5,
    text: 'Die Hälfte der Einheiten eines Gebiets wird vernichtet (aufgerundet). Danach W6: bei 1 wird das Gebiet verwüstet.',
    targets: (s, pid) => enemyWithUnits(s, pid),
    apply: (s, pid, tg) => {
      const id = tg.territory!;
      const t = terr(s, id);
      const prev = t.owner;
      const r = damage(s, id, Math.ceil(units(t) / 2));
      const w = roll(s.rng, 6);
      let msg = `Flächenbombardement auf ${tname(id, s)}: ${r} Verluste.`;
      if (w === 1) {
        t.mods = 0; t.commanders = []; t.station = false; t.owner = null; t.devastated = true;
        onOwnerChange(s, id);
        if (prev) checkElimination(s, prev);
        msg += ' Das Gebiet ist verwüstet.';
      }
      log(s, { kind: 'text', msg, player: pid, data: { territory: id } });
    },
  },
  {
    id: 'NUC-03', deck: 'NUCLEAR', name: 'Abschreckung', copies: 2, powerUp: 1, timing: 'REA', target: 'none', value: 2,
    text: 'Eigenes Gebiet angegriffen: Der Angreifer zahlt 2 Energie oder bricht die Invasion ohne Wurf ab.',
    check: defendingSelf(),
    react: (s, _pid, ctx) => defUnits(s, ctx) >= 3,
    apply: (_s, _pid, _tg, ctx) => { ctx.invasion!.deterred = 2; },
  },
  {
    id: 'NUC-04', deck: 'NUCLEAR', name: 'EMP-Welle', copies: 1, powerUp: 3, timing: 'VOR', target: 'anyTerritory', value: 3,
    text: 'Bis zu deinem nächsten Zug würfeln alle Kommandanten in einem Kontinent (inkl. angrenzender Wassergebiete) nur W6.',
    targets: () => IDS_BY_TYPE.land,
    apply: (s, pid, tg) => {
      const region = TDEF[tg.territory!].region;
      addEffect(s, { kind: 'emp', owner: pid, region, expires: nextTurnStart(pid) });
      log(s, { kind: 'text', msg: `EMP-Welle über ${RDEF[region].name}.`, player: pid });
    },
  },
  {
    id: 'NUC-05', deck: 'NUCLEAR', name: 'Verseuchung', copies: 2, powerUp: 2, timing: 'VOR', target: 'enemyTerritory', value: 3,
    text: 'Gegnerisches Gebiet in Reichweite 2: −2 Einheiten (mind. 1 bleibt); zählt beim nächsten Einkommen seines Besitzers nicht.',
    targets: inRange(2),
    apply: (s, pid, tg) => {
      const id = tg.territory!;
      const victim = s.territories[id].owner!;
      damage(s, id, 2, true);
      addEffect(s, { kind: 'contaminated', owner: pid, target: victim, territory: id, expires: { at: 'turnEnd', player: victim } });
    },
  },
  {
    id: 'NUC-06', deck: 'NUCLEAR', name: 'Taktischer Sprengkopf', copies: 2, powerUp: 1, timing: 'ANG', target: 'none', value: 2,
    text: 'Eigene Invasion erklärt: Der Verteidiger verliert vor dem ersten Wurf 1 Einheit.',
    check: (s, _pid, ctx) => (units(s.territories[ctx.invasion!.to]) > 0 ? null : 'Ziel ohne Einheiten'),
    apply: (s, _pid, _tg, ctx) => {
      // Während der Invasion bleibt der Verteidiger Besitzer; fällt die letzte Einheit, folgt das Nachrücken
      const t = terr(s, ctx.invasion!.to);
      if (t.mods > 0) t.mods--; else t.commanders.pop();
    },
  },
  {
    id: 'NUC-07', deck: 'NUCLEAR', name: 'Erstschlag-Doktrin', copies: 1, powerUp: 2, timing: 'VOR', target: 'none', value: 2,
    text: 'Bis Zugende würfelt dein Nuklear-Kdt bei Invasionen aus seinem Gebiet mit 2 W8 statt 1.',
    apply: (s, pid) => { addEffect(s, { kind: 'firstStrike', owner: pid, expires: thisTurnEnd(pid) }); },
  },
  {
    id: 'NUC-08', deck: 'NUCLEAR', name: 'Bunker', copies: 2, powerUp: 2, timing: 'REA', target: 'none', value: 3,
    text: 'Eigenes Gebiet angegriffen: Der Verteidiger verliert in dieser Invasion pro Wurf höchstens 1 Einheit.',
    check: defendingSelf(),
    react: (s, pid, ctx) => controlsRegion(s, pid, TDEF[ctx.invasion!.to].region) || defUnits(s, ctx) >= 4,
    apply: (_s, _pid, _tg, ctx) => { ctx.invasion!.mods.defenderMaxLoss1 = true; },
  },
  {
    id: 'NUC-09', deck: 'NUCLEAR', name: 'Reaktorüberlastung', copies: 1, powerUp: 3, timing: 'ERO', target: 'none', value: 3,
    text: 'Eigenes Gebiet erobert: Die Hälfte der nachgezogenen Einheiten des Eroberers wird vernichtet (mind. 1 bleibt).',
    check: (_s, pid, ctx) => (ctx.conquest && ctx.conquest.previousOwner === pid ? null : 'Nur wenn dein Gebiet erobert wurde'),
    react: (_s, _pid, ctx) => (ctx.conquest?.advanced ?? 0) >= 4,
    apply: (s, _pid, _tg, ctx) => { damage(s, ctx.conquest!.territory, Math.floor(ctx.conquest!.advanced / 2), true); },
  },
  {
    id: 'NUC-10', deck: 'NUCLEAR', name: 'Kettenreaktion', copies: 1, powerUp: 4, timing: 'VOR', target: 'enemyTerritory', value: 5,
    text: 'Gebiet in Reichweite 2: −3 Einheiten dort, −1 in jedem angrenzenden Gebiet (auch eigenen). Je Gebiet bleibt 1.',
    targets: inRange(2),
    apply: (s, pid, tg) => {
      const id = tg.territory!;
      damage(s, id, 3, true);
      for (const n of nbrs(s, id)) if (s.territories[n].owner) damage(s, n, 1, true);
      log(s, { kind: 'text', msg: `Kettenreaktion in ${tname(id, s)}.`, player: pid, data: { territory: id } });
    },
  },
  {
    id: 'NUC-11', deck: 'NUCLEAR', name: 'Uranhandel', copies: 2, powerUp: 0, timing: 'VOR', target: 'ownTerritory', value: 2,
    text: '+3 Energie; entferne 1 MOD aus einem eigenen Gebiet mit mindestens 2 Einheiten.',
    targets: (s, pid) => owned(s, pid).filter((id) => s.territories[id].mods >= 1 && units(s.territories[id]) >= 2),
    apply: (s, pid, tg) => { terr(s, tg.territory!).mods -= 1; player(s, pid).energy += 3; },
  },
  {
    id: 'NUC-12', deck: 'NUCLEAR', name: 'Raketensilo', copies: 1, powerUp: 3, timing: 'VOR', target: 'none', value: 3,
    text: 'Solange dein Nuklear-Kdt in seinem aktuellen Gebiet steht, verteidigen dort alle Einheiten mit W8.',
    apply: (s, pid) => {
      const at = commanderLocation(s, pid, 'NUCLEAR')!;
      addEffect(s, { kind: 'silo', owner: pid, territory: at, expires: 'permanent' });
    },
  },
  {
    id: 'NUC-13', deck: 'NUCLEAR', name: 'Gleichgewicht des Schreckens', copies: 1, powerUp: 0, timing: 'WERT', target: 'none', value: 3,
    text: 'Wertung: +1 Punkt je eigenem Kommandanten im Spiel (max. 5).',
    apply: () => {},
    score: (s, pid) => COMMANDER_TYPES.filter((c) => commanderInPlay(s, pid, c)).length,
  },

  // ============================ DIPLOMAT
  {
    id: 'DIP-01', deck: 'DIPLOMAT', name: 'Schildgenerator', copies: 2, powerUp: 1, timing: 'REA', target: 'none', value: 3,
    text: 'Eigenes Gebiet angegriffen: Der Verteidiger würfelt in dieser Invasion nur W8.',
    check: defendingSelf(),
    react: (s, _pid, ctx) => defUnits(s, ctx) >= 2 && attackerUnits(s, ctx) >= 3 && !s.territories[ctx.invasion!.to].station,
    apply: (_s, _pid, _tg, ctx) => { ctx.invasion!.mods.defenderAllD8 = true; },
  },
  {
    id: 'DIP-02', deck: 'DIPLOMAT', name: 'Waffenstillstand', copies: 2, powerUp: 2, timing: 'VOR', target: 'player', value: 3,
    text: 'Ein gewählter Spieler und du dürft bis zu deinem nächsten Zug nicht gegeneinander invadieren.',
    apply: (s, pid, tg) => { addEffect(s, { kind: 'ceasefire', owner: pid, target: tg.player, expires: nextTurnStart(pid) }); },
  },
  {
    id: 'DIP-03', deck: 'DIPLOMAT', name: 'Handelsabkommen', copies: 2, powerUp: 0, timing: 'VOR', target: 'player', value: 2,
    text: 'Du erhältst 1 Energie. Stimmt der gewählte Spieler zu, erhaltet ihr beide zusätzlich je 1 bzw. 2 Energie.',
    apply: (s, pid, tg) => {
      player(s, pid).energy += 1;
      addEffect(s, { kind: 'tradeOffer', owner: pid, target: tg.player, expires: nextTurnStart(pid) });
      log(s, { kind: 'text', msg: `${pname(s, pid)} bietet ${pname(s, tg.player)} ein Handelsabkommen an.`, player: pid });
    },
  },
  {
    id: 'DIP-04', deck: 'DIPLOMAT', name: 'Sanktionen', copies: 2, powerUp: 1, timing: 'VOR', target: 'player', value: 2,
    text: 'Ein gewählter Spieler erhält bei seinem nächsten Einkommen 3 Energie weniger.',
    apply: (s, pid, tg) => { addEffect(s, { kind: 'sanctions', owner: pid, target: tg.player, expires: thisTurnEnd(tg.player!) }); },
  },
  {
    id: 'DIP-05', deck: 'DIPLOMAT', name: 'Geheimverhandlung', copies: 2, powerUp: 0, timing: 'GEBOT', target: 'none', value: 2,
    text: 'Mit dem Gebot: Dein Gebot zählt +2; bezahlt wird nur der tatsächlich gebotene Betrag.',
    apply: () => {},
  },
  {
    id: 'DIP-06', deck: 'DIPLOMAT', name: 'Freies Geleit', copies: 1, powerUp: 0, timing: 'ENDE', target: 'none', value: 2,
    text: 'Führe eine zweite Truppenbewegung durch.',
    apply: (s) => { if (s.turn) { s.turn.fortifiesLeft += 1; s.turn.step = 'fortify'; } },
  },
  {
    id: 'DIP-07', deck: 'DIPLOMAT', name: 'Überläufer', copies: 1, powerUp: 2, timing: 'VOR', target: 'enemyTerritory', value: 3,
    text: 'Gegnerisches Gebiet mit genau 1 MOD, ohne Kommandant und Station, neben einem eigenen: wird deins. Keine Invasion.',
    targets: (s, pid) => enemyWithUnits(s, pid).filter((id) => {
      const t = s.territories[id];
      return t.mods === 1 && t.commanders.length === 0 && !t.station && adjacentToOwn(s, pid, id);
    }),
    apply: (s, pid, tg) => {
      const t = terr(s, tg.territory!);
      const prev = t.owner!;
      t.owner = pid;
      onOwnerChange(s, tg.territory!);
      log(s, { kind: 'conquest', msg: `${tname(tg.territory!, s)} läuft zu ${pname(s, pid)} über.`, player: pid, data: { territory: tg.territory } });
      checkElimination(s, prev);
    },
  },
  {
    id: 'DIP-08', deck: 'DIPLOMAT', name: 'Spionagenetz', copies: 2, powerUp: 0, timing: 'VOR', target: 'deck', value: 2,
    text: 'Ziehe 1 Karte aus einem Deck, dessen Kommandant du im Spiel hast.',
    apply: (s, pid, tg) => {
      const deck = tg.deck!;
      if (!commanderInPlay(s, pid, deck)) fail('Kommandant dieses Decks nicht im Spiel');
      const c = s.decks[deck].shift();
      if (!c) fail('Deck ist leer');
      player(s, pid).hand.push(c);
    },
  },
  {
    id: 'DIP-09', deck: 'DIPLOMAT', name: 'Veto', copies: 1, powerUp: 2, timing: 'KAR', target: 'none', value: 3,
    text: 'Annulliere eine gerade gespielte gegnerische Karte (Kosten bleiben bezahlt). Kein Veto gegen ein Veto.',
    check: (_s, _pid, ctx) => (ctx.card && cardType(ctx.card.inst) !== 'DIP-09' ? null : 'Nichts zu annullieren'),
    react: (s, pid, ctx) => {
      const c = ctx.card!; const def = CARD[cardType(c.inst)];
      const hitsMe = (c.targets.territory && s.territories[c.targets.territory]?.owner === pid) || c.targets.player === pid;
      return Boolean(hitsMe) && (def.deck === 'NUCLEAR' || def.value >= 3);
    },
    apply: () => {},
  },
  {
    id: 'DIP-10', deck: 'DIPLOMAT', name: 'Embargo', copies: 1, powerUp: 1, timing: 'VOR', target: 'player', value: 2,
    text: 'Ein gewählter Spieler darf in seinem nächsten Zug keine Kommandokarten kaufen.',
    apply: (s, pid, tg) => { addEffect(s, { kind: 'embargo', owner: pid, target: tg.player, expires: thisTurnEnd(tg.player!) }); },
  },
  {
    id: 'DIP-11', deck: 'DIPLOMAT', name: 'Neutralitätszone', copies: 1, powerUp: 2, timing: 'VOR', target: 'ownTerritory', value: 2,
    text: 'Ein eigenes Gebiet kann bis zu deinem nächsten Zug nicht invadiert werden (Nuklearkarten wirken weiter).',
    targets: ownOf(),
    apply: (s, pid, tg) => { addEffect(s, { kind: 'neutralZone', owner: pid, territory: tg.territory, expires: nextTurnStart(pid) }); },
  },
  {
    id: 'DIP-12', deck: 'DIPLOMAT', name: 'Sabotage', copies: 1, powerUp: 3, timing: 'VOR', target: 'enemyTerritory', value: 3,
    text: 'Zerstört eine gegnerische Station neben einem eigenen Gebiet; bei W6 = 1–2 misslingt die Sabotage.',
    targets: (s, pid) => Object.keys(s.territories).filter((id) => {
      const t = s.territories[id];
      return t.owner && t.owner !== pid && t.station && adjacentToOwn(s, pid, id);
    }),
    apply: (s, pid, tg) => {
      const w = roll(s.rng, 6);
      if (w <= 2) { log(s, { kind: 'text', msg: `Sabotage in ${tname(tg.territory!, s)} misslingt (${w}).`, player: pid }); return; }
      const t = terr(s, tg.territory!);
      t.station = false;
      const prev = t.owner!;
      if (units(t) === 0) { t.owner = null; onOwnerChange(s, tg.territory!); checkElimination(s, prev); }
      log(s, { kind: 'text', msg: `Sabotage: Station in ${tname(tg.territory!, s)} zerstört (${w}).`, player: pid });
    },
  },
  {
    id: 'DIP-13', deck: 'DIPLOMAT', name: 'Weltrat-Mandat', copies: 1, powerUp: 0, timing: 'WERT', target: 'none', value: 2,
    text: 'Wertung: +3 Punkte, wenn du in jedem Kontinent mindestens ein Gebiet kontrollierst.',
    apply: () => {},
    score: (s, pid) => {
      const conts = Object.values(RDEF).filter((r) => r.kind === 'continent');
      return conts.every((r) => REGION_MEMBERS[r.id].some((id) => s.territories[id].owner === pid)) ? 3 : 0;
    },
  },
  {
    id: 'DIP-14', deck: 'DIPLOMAT', name: 'Diplomatische Immunität', copies: 1, powerUp: 1, timing: 'REA', target: 'none', value: 2,
    text: 'Eigenes Gebiet angegriffen: Fiele ein Kommandant, wird er stattdessen in ein angrenzendes eigenes Gebiet verlegt.',
    check: (s, pid, ctx) => defendingSelf()(s, pid, ctx) ?? (s.territories[ctx.invasion!.to].commanders.length ? null : 'Kein Kommandant im Gebiet'),
    react: (s, _pid, ctx) => s.territories[ctx.invasion!.to].mods <= 2,
    apply: (_s, _pid, _tg, ctx) => { ctx.invasion!.mods.immunity = true; },
  },
];

export const CARD: Record<string, CardDef> = Object.fromEntries(CARD_DEFS.map((c) => [c.id, c]));

export function cardType(inst: string): string {
  return inst.split('#')[0];
}

export function buildDecks(): Record<CommanderType, string[]> {
  const decks = { LAND: [], NAVAL: [], SPACE: [], NUCLEAR: [], DIPLOMAT: [] } as Record<CommanderType, string[]>;
  for (const c of CARD_DEFS) for (let i = 1; i <= c.copies; i++) decks[c.deck].push(`${c.id}#${i}`);
  return decks;
}

function doMove(s: GameState, from: string, to: string, count: number, max: number): void {
  if (from === to) fail('Start und Ziel müssen verschieden sein');
  const t = terr(s, from);
  const n = Math.min(count || max, max);
  const mods = Math.min(n, t.mods);
  const cmds = t.commanders.slice(0, Math.max(0, n - mods));
  const move: UnitMove = { mods, commanders: cmds };
  validateMove(s, from, move);
  moveUnits(s, from, to, move);
}

// ------------------------------------------------------------------ Spielbarkeit / Ziele
export function validTargets(s: GameState, pid: string, def: CardDef): string[] {
  return def.targets ? def.targets(s, pid) : [];
}

export function validateTargets(s: GameState, pid: string, def: CardDef, tg: Targets): void {
  switch (def.target) {
    case 'none': return;
    case 'player': {
      const p = s.players.find((x) => x.id === tg.player);
      if (!p || p.id === pid || p.eliminated || p.isNeutral) fail('Ungültiger Zielspieler');
      return;
    }
    case 'deck':
      if (!tg.deck || !COMMANDER_TYPES.includes(tg.deck)) fail('Deck wählen');
      return;
    case 'distribute': {
      const allowed = new Set(validTargets(s, pid, def));
      const pl = tg.placements ?? {};
      let sum = 0;
      for (const [id, n] of Object.entries(pl)) {
        if (!allowed.has(id) || !Number.isInteger(n) || n < 0) fail('Ungültige Verteilung');
        sum += n;
      }
      if (sum !== def.distribute) fail(`Genau ${def.distribute} MODs verteilen`);
      return;
    }
    case 'move': {
      const allowed = new Set(validTargets(s, pid, def));
      if (!tg.territory || !tg.territory2 || !allowed.has(tg.territory)) fail('Start- und Zielgebiet wählen');
      return;
    }
    default: {
      if (!tg.territory || !validTargets(s, pid, def).includes(tg.territory)) fail('Ungültiges Zielgebiet');
    }
  }
}

export function randomPick<T>(s: GameState, arr: T[]): T {
  return arr[randInt(s.rng, arr.length)];
}
