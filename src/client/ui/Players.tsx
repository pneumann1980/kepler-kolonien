import { COMMANDER_TYPES, COMMANDER_SHORT, COMMANDER_NAMES, RDEF, owned, totalUnits, commanderInPlay, stationCount, controlledRegions } from '../../engine/index.ts';
import type { GameState } from '../../engine/index.ts';
import type { GameView } from '../api.ts';
import { Dot } from './widgets.tsx';

export function Players({ view }: { view: GameView }) {
  const s = view as unknown as GameState;
  const order = view.turnOrder.length ? view.turnOrder : view.seatOrder;
  const list = [...order.map((id) => view.players.find((p) => p.id === id)!), ...view.players.filter((p) => p.isNeutral)];
  return (
    <div class="panel">
      <div class="box">
        <div class="title">Spieler {view.turnOrder.length ? `(Zugreihenfolge Jahr ${view.year})` : ''}</div>
        {list.map((p, i) => {
          const regions = controlledRegions(s, p.id);
          const counts = view.handCounts[p.id] ?? {};
          return (
            <div key={p.id} class={`prow ${view.pending.includes(p.id) ? 'active' : ''} ${p.eliminated ? 'out' : ''}`}>
              <div class="pname">
                <Dot color={p.color} size={14} />
                <b>{!p.isNeutral && view.turnOrder.length ? `${i + 1}. ` : ''}{p.name}</b>
                {p.id === view.me && <span class="tag">Du</span>}
                {p.isBot && !p.isNeutral && <span class="tag">{p.away ? 'Bot-Vertretung' : 'Bot'}</span>}
                {p.eliminated && <span class="tag">ausgeschieden</span>}
                {view.pending.includes(p.id) && <span class="tag warn">am Zug</span>}
              </div>
              {!p.isNeutral && (
                <div class="pstats">
                  <span>⚡ {p.energy}</span>
                  <span>🗺 {owned(s, p.id).length}</span>
                  <span>⚔ {totalUnits(s, p.id)}</span>
                  <span>◆ {stationCount(s, p.id)}</span>
                  <span title="Kommandanten im Spiel">{COMMANDER_TYPES.filter((c) => commanderInPlay(s, p.id, c)).map((c) => COMMANDER_SHORT[c]).join(' ') || '–'}</span>
                  <span title="Handkarten nach Deck (öffentlich)">🂠 {COMMANDER_TYPES.filter((d) => counts[d]).map((d) => `${counts[d]}${COMMANDER_SHORT[d]}`).join(' ') || '0'}</span>
                </div>
              )}
              {regions.length > 0 && <div class="hint">Kontrolliert: {regions.map((r) => `${RDEF[r].name} (+${RDEF[r].bonus})`).join(', ')}</div>}
            </div>
          );
        })}
      </div>
      <div class="box">
        <div class="title">Legende</div>
        <div class="hint">⚡ Energie · 🗺 Gebiete · ⚔ Einheiten · ◆ Stationen · Kommandanten: {COMMANDER_TYPES.map((c) => `${COMMANDER_SHORT[c]} = ${COMMANDER_NAMES[c]}`).join(', ')} · 🂠 Karten je Deck</div>
        <div class="hint">Decks: {COMMANDER_TYPES.map((d) => `${COMMANDER_NAMES[d]} ${view.deckCounts[d]}`).join(' · ')}</div>
        <div class="hint">Würfel-Commitment (SHA-256): <code class="wrap">{view.seedCommitment}</code></div>
      </div>
    </div>
  );
}
