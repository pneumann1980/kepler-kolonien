// Informationsfilter: Was darf ein Spieler sehen? (einzige Stelle, über die Zustand den Server verlässt)
import { CARD, cardType } from './cards.ts';
import { pendingActors } from './rules.ts';
import type { CommanderType, GameState } from './types.ts';
import { COMMANDER_TYPES } from './types.ts';

export type ProjectedState = Omit<GameState, 'rng' | 'decks' | 'territoryDecks'> & {
  me: string | null;
  deckCounts: Record<CommanderType, number>;
  territoryDeckCounts: Record<string, number>;
  handCounts: Record<string, Record<CommanderType, number>>;
  pending: string[];
};

export function project(s: GameState, viewer: string | null): ProjectedState {
  const { rng: _rng, decks, territoryDecks, ...rest } = structuredClone(s);
  const handCounts: Record<string, Record<CommanderType, number>> = {};
  for (const p of rest.players) {
    const counts = Object.fromEntries(COMMANDER_TYPES.map((d) => [d, 0])) as Record<CommanderType, number>;
    for (const c of p.hand) counts[CARD[cardType(c)].deck]++;
    handCounts[p.id] = counts;
    if (p.id !== viewer) {
      p.hand = [];
      p.settings = { autoReact: {}, defendMax: p.settings.defendMax };
    }
  }
  const bids: GameState['bids'] = {};
  for (const [id, b] of Object.entries(rest.bids)) {
    bids[id] = id === viewer ? b : { amount: -1 };
  }
  rest.bids = bids;
  rest.log = rest.log.filter((e) => !e.to || e.to === viewer);
  return {
    ...rest,
    me: viewer,
    deckCounts: Object.fromEntries(COMMANDER_TYPES.map((d) => [d, decks[d].length])) as Record<CommanderType, number>,
    territoryDeckCounts: { land: territoryDecks.land.length, water: territoryDecks.water.length, moon: territoryDecks.moon.length },
    handCounts,
    pending: pendingActors(s),
  };
}
