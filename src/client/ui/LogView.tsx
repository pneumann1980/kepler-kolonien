import type { GameView } from '../api.ts';
import { Dot } from './widgets.tsx';

export function LogView({ view }: { view: GameView }) {
  const players = Object.fromEntries(view.players.map((p) => [p.id, p]));
  const entries = [...view.log].reverse().slice(0, 300);
  return (
    <div class="panel">
      <div class="box">
        <div class="title">Protokoll</div>
        <ul class="log">
          {entries.map((e) => {
            const rolls = e.kind === 'battle' ? (e.data?.rolls as { att: number[]; def: number[]; attSides: number[]; defSides: number[] }[]) : null;
            return (
              <li key={e.seq} class={`log-${e.kind} ${e.to ? 'private' : ''}`}>
                <span class="ly">J{Math.max(1, e.year)}</span>
                {e.player && players[e.player] && <Dot color={players[e.player].color} size={9} />}
                <span>{e.msg}</span>
                {rolls && rolls.length > 0 && (
                  <div class="dicerow small">
                    {rolls.slice(-3).map((r, i) => (
                      <span key={i} class="rollgrp">
                        {r.att.map((v, k) => <span key={`a${k}`} class={`die att d${r.attSides[k]}`}>{v}</span>)}
                        <span class="vs">:</span>
                        {r.def.map((v, k) => <span key={`d${k}`} class={`die def d${r.defSides[k]}`}>{v}</span>)}
                      </span>
                    ))}
                    {rolls.length > 3 && <span class="hint">… {rolls.length} Würfe</span>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
