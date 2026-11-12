import { rn } from '../names.ts';
import { COMMANDER_TYPES, COMMANDER_NAMES, RDEF, commanderInPlay, controlledRegions } from '../../engine/index.ts';
import type { GameState } from '../../engine/index.ts';
import type { GameView } from '../api.ts';
import { Dot } from './widgets.tsx';
import { Ico, CmdBadge } from './icons.tsx';
import { standings } from './standings.ts';

export function Players({ view }: { view: GameView }) {
  const s = view as unknown as GameState;
  const rows = standings(view);
  const order = view.turnOrder.length ? view.turnOrder : view.seatOrder;
  const seatNo = (id: string) => order.indexOf(id) + 1;
  return (
    <div class="panel">
      <div class="box">
        <div class="title"><Ico name="rank" size={18} /> Rangliste <span class="hint">Zwischenstand</span></div>
        <table class="scores rank">
          <thead><tr><th>#</th><th>Spieler</th><th title="Gebiete"><Ico name="territory" size={14} /></th><th title="Regionsboni">+</th><th title="Punkte"><b>Σ</b></th><th title="Energie"><Ico name="bolt" size={14} /></th><th title="Einheiten"><Ico name="units" size={14} /></th><th title="Stationen"><Ico name="station" size={14} /></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} class={`${r.active ? 'active' : ''} ${r.me ? 'me' : ''} ${r.eliminated ? 'out' : ''}`}>
                <td class="rknum">{r.eliminated ? '✕' : r.rank}</td>
                <td><Dot color={r.color} size={12} /> {r.name}{r.bot ? ' 🤖' : ''}</td>
                <td>{r.territories}</td><td>{r.regions}</td><td><b>{r.total}</b></td><td>{r.energy}</td><td>{r.units}</td><td>{r.stations}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div class="hint">Punkte = Gebiete + Regionsboni. Wertungskarten (privat) und Gleichstand (Energie, dann Einheiten) zählen erst bei Spielende.</div>
      </div>
      <div class="box">
        <div class="title">Spieler {view.turnOrder.length ? `(Zugfolge Jahr ${view.year})` : ''}</div>
        {[...order.map((id) => view.players.find((p) => p.id === id)!), ...view.players.filter((p) => p.isNeutral)].map((p) => {
          const regions = controlledRegions(s, p.id);
          const counts = view.handCounts[p.id] ?? {};
          return (
            <div key={p.id} class={`prow ${view.pending.includes(p.id) ? 'active' : ''} ${p.eliminated ? 'out' : ''}`}>
              <div class="pname">
                <Dot color={p.color} size={14} />
                <b>{!p.isNeutral && view.turnOrder.length ? `${seatNo(p.id)}. ` : ''}{p.name}</b>
                {p.id === view.me && <span class="tag">Du</span>}
                {p.isBot && !p.isNeutral && <span class="tag">{p.away ? 'Bot-Vertretung' : 'Bot'}</span>}
                {p.eliminated && <span class="tag">ausgeschieden</span>}
                {view.pending.includes(p.id) && <span class="tag warn">am Zug</span>}
              </div>
              {!p.isNeutral && (
                <div class="pstats">
                  <span class="cmdrow" title="Kommandanten im Spiel">
                    {COMMANDER_TYPES.map((c) => <span key={c} class={commanderInPlay(s, p.id, c) ? '' : 'dim'}><CmdBadge type={c} size={22} title={COMMANDER_NAMES[c]} /></span>)}
                  </span>
                  <span class="cmdrow" title="Handkarten nach Deck (öffentlich)">
                    <Ico name="cards" size={16} />
                    {COMMANDER_TYPES.filter((d) => counts[d]).map((d) => <span key={d} class="hc"><CmdBadge type={d} size={18} />×{counts[d]}</span>)}
                    {!COMMANDER_TYPES.some((d) => counts[d]) && '0'}
                  </span>
                </div>
              )}
              {regions.length > 0 && <div class="hint">Kontrolliert: {regions.map((r) => `${rn(r)} (+${RDEF[r].bonus})`).join(', ')}</div>}
            </div>
          );
        })}
      </div>
      <div class="box">
        <div class="title">Legende</div>
        <div class="hint">Kommandanten: {COMMANDER_TYPES.map((c) => <span key={c} class="lg-inline"><CmdBadge type={c} size={18} /> {COMMANDER_NAMES[c]}</span>)}</div>
        <div class="hint">Decks: {COMMANDER_TYPES.map((d) => `${COMMANDER_NAMES[d]} ${view.deckCounts[d]}`).join(' · ')}</div>
        <div class="hint">Würfel-Commitment (SHA-256): <code class="wrap">{view.seedCommitment}</code></div>
      </div>
    </div>
  );
}
