// Bot-gegen-Bot-Simulation: Robustheit (Invarianten) und grobe Balancing-Kennzahlen.
// Aufruf: node src/tools/simulate.ts [Partien] [Spieler] [quick|classic]
import { createGame, applyCommand, botCommand, pendingActors, units, TERRITORY_IDS, PLAYER_COLORS, CARD, cardType } from '../engine/index.ts';
import type { GameState } from '../engine/index.ts';
import { randomBytes } from 'node:crypto';

export function checkInvariants(s: GameState): void {
  for (const id of TERRITORY_IDS) {
    const t = s.territories[id];
    if (t.mods < 0) throw new Error(`negative MODs in ${id}`);
    if (t.devastated && (t.owner || units(t) || t.station)) throw new Error(`verwüstetes Gebiet besetzt: ${id}`);
    if (t.owner && units(t) === 0 && !t.station && !(s.invasion?.awaitingAdvance && s.invasion.to === id)) throw new Error(`Besitzer ohne Einheiten/Station: ${id}`);
    if (!t.owner && (units(t) > 0 || t.station)) throw new Error(`Einheiten ohne Besitzer: ${id}`);
    if (new Set(t.commanders).size !== t.commanders.length) throw new Error(`doppelte Kommandanten in ${id}`);
  }
  for (const p of s.players) {
    if (p.energy < 0) throw new Error(`negative Energie bei ${p.id}`);
    const stations = TERRITORY_IDS.filter((id) => s.territories[id].owner === p.id && s.territories[id].station).length;
    if (stations > 4) throw new Error(`zu viele Stationen bei ${p.id}`);
    for (const c of ['LAND', 'NAVAL', 'SPACE', 'NUCLEAR', 'DIPLOMAT']) {
      const n = TERRITORY_IDS.filter((id) => s.territories[id].owner === p.id && s.territories[id].commanders.includes(c as never)).length;
      if (n > 1) throw new Error(`Kommandant ${c} mehrfach bei ${p.id}`);
    }
  }
  const cards = s.players.reduce((n, p) => n + p.hand.length, 0) + s.discard.length + Object.values(s.decks).reduce((n, d) => n + d.length, 0);
  if (cards !== 100) throw new Error(`Kartenzahl ${cards} != 100`);
}

export function runGame(nPlayers: number, mode: 'quick' | 'classic', seedHex = randomBytes(16).toString('hex')) {
  let s = createGame({
    players: Array.from({ length: nPlayers }, (_, i) => ({ id: `p${i + 1}`, name: `Bot ${i + 1}`, color: PLAYER_COLORS[i], isBot: true })),
    seedHex, commitment: 'sim', config: { setupMode: mode },
  });
  let steps = 0;
  const cardPlays: Record<string, number> = {};
  while (s.phase !== 'gameOver') {
    const actors = pendingActors(s);
    if (!actors.length) throw new Error(`Keine handelnden Spieler in Phase ${s.phase}`);
    let progressed = false;
    for (const pid of actors) {
      const cmd = botCommand(s, pid);
      if (!cmd) continue;
      if (cmd.t === 'PlayCard') cardPlays[cardType(cmd.card)] = (cardPlays[cardType(cmd.card)] ?? 0) + 1;
      s = applyCommand(s, pid, cmd);
      checkInvariants(s);
      progressed = true;
      steps++;
      break;
    }
    if (!progressed) throw new Error(`Bot hängt in Phase ${s.phase}/${s.turn?.step} (Seed ${seedHex})`);
    if (steps > 20000) throw new Error(`Zu viele Schritte (Seed ${seedHex})`);
  }
  return { s, steps, cardPlays, seedHex };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const games = Number(process.argv[2] ?? 20);
  const n = Number(process.argv[3] ?? 4);
  const mode = (process.argv[4] ?? 'quick') as 'quick' | 'classic';
  const wins: Record<string, number> = {};
  const plays: Record<string, number> = {};
  let totalSteps = 0;
  const t0 = Date.now();
  for (let g = 0; g < games; g++) {
    const r = runGame(n, mode);
    totalSteps += r.steps;
    for (const w of r.s.winner ?? []) wins[w] = (wins[w] ?? 0) + 1;
    for (const [k, v] of Object.entries(r.cardPlays)) plays[k] = (plays[k] ?? 0) + v;
  }
  console.log(`${games} Partien à ${n} Spieler (${mode}) in ${((Date.now() - t0) / 1000).toFixed(1)} s, Ø ${Math.round(totalSteps / games)} Befehle`);
  console.log('Siege nach Sitz-ID:', wins);
  const unplayed = Object.keys(CARD).filter((k) => !plays[k] && !['REA', 'ERO', 'KAR', 'WERT', 'GEBOT'].includes(CARD[k].timing));
  console.log('Manuell gespielte Karten:', Object.keys(plays).length, 'Typen; nie gespielt (VOR/ANG/ENDE):', unplayed.join(', ') || '–');
}
