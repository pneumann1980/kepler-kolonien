// Handkarten, Spielbarkeit und Reaktionsregeln
import {
  CARD, CARD_DEFS, cardType, commanderInPlay, validTargets, COMMANDER_NAMES, autoReactEnabled,
} from '../../engine/index.ts';
import type { Command, GameState, Player } from '../../engine/index.ts';
import type { GameView } from '../api.ts';
import { useState } from 'preact/hooks';
import { Btn } from './widgets.tsx';
import { Ico, CMD_COLOR } from './icons.tsx';

const TIMING_LABEL: Record<string, string> = {
  VOR: 'Vor der ersten Invasion', ANG: 'Bei eigener Invasion', REA: 'Reaktion (automatisch)', ERO: 'Nach Gebietsverlust (automatisch)',
  KAR: 'Gegen gegnerische Karte (automatisch)', ENDE: 'Zugende', GEBOT: 'Mit dem Gebot', WERT: 'Wertung bei Spielende',
};

export function cardStatus(view: GameView, s: GameState, me: Player, inst: string): { ok: boolean; reason: string } {
  const def = CARD[cardType(inst)];
  const no = (reason: string) => ({ ok: false, reason });
  if (!commanderInPlay(s, me.id, def.deck)) return no(`${COMMANDER_NAMES[def.deck]}-Kommandant nicht im Spiel`);
  if (me.energy < def.powerUp) return no(`Benötigt ${def.powerUp} Energie`);
  if (['REA', 'ERO', 'KAR'].includes(def.timing)) return no('Wird automatisch per Reaktionsregel gespielt');
  if (def.timing === 'GEBOT') return no('Beim Gebot auswählbar');
  if (def.timing === 'WERT') return no('Zählt automatisch bei Spielende');
  const t = view.turn;
  if (view.phase !== 'turn' || !t || t.player !== me.id) return no('Nur im eigenen Zug');
  if (t.incomeMods > 0) return no('Erst MODs einsetzen');
  const inv = view.invasion;
  if (def.timing === 'VOR') {
    if (inv || t.invaded) return no('Nur vor der ersten Invasion/Bewegung');
    if (t.step === 'fortify' || t.step === 'end') return no('Phase vorbei');
  }
  if (def.timing === 'ANG' && (!inv || inv.attacker !== me.id || inv.rolls > 0)) return no('Nach Erklärung einer eigenen Invasion, vor dem ersten Wurf');
  if (def.timing === 'ENDE' && inv) return no('Erst Invasion abschließen');
  const err = def.check?.(s, me.id, { invasion: inv ?? undefined });
  if (err) return no(err);
  if (['ownTerritory', 'ownLand', 'ownWater', 'ownMoon', 'ownStation', 'ownCoastal', 'enemyTerritory', 'anyTerritory', 'distribute', 'move'].includes(def.target)) {
    const n = validTargets(s, me.id, def).length;
    if (n === 0 || (def.target === 'move' && n < 2 && def.id !== 'NAV-05')) return no('Kein gültiges Ziel');
  }
  return { ok: true, reason: '' };
}

export function Hand({ view, s, me, onPlay, onSetting }: { view: GameView; s: GameState; me: Player | null; onPlay: (inst: string) => void; onSetting: (cmd: Command) => void }) {
  if (!me) return <div class="panel"><div class="box">Du schaust zu.</div></div>;
  const reactionTypes = CARD_DEFS.filter((c) => ['REA', 'ERO', 'KAR'].includes(c.timing));
  return (
    <div class="panel">
      <div class="box">
        <div class="title">Deine Hand ({me.hand.length}) · ⚡ {me.energy}</div>
        {me.hand.length === 0 && <div class="hint">Keine Karten. Karten kaufst du im eigenen Zug in der Phase „Karten kaufen“.</div>}
        <div class="cards">
          {me.hand.map((inst) => {
            const def = CARD[cardType(inst)];
            const st = cardStatus(view, s, me, inst);
            const auto = ['REA', 'ERO', 'KAR'].includes(def.timing);
            return (
              <div key={inst} class={`card deck-${def.deck.toLowerCase()} ${st.ok ? 'playable' : ''}`}>
                <div class="card-head">
                  <b>{def.name}</b>
                  <span class="cost">{def.powerUp} E</span>
                </div>
                <div class="card-meta">{COMMANDER_NAMES[def.deck]} · {TIMING_LABEL[def.timing]}</div>
                <div class="card-text">{def.text}</div>
                {auto ? (
                  <label class="check">
                    <input type="checkbox" checked={autoReactEnabled(me, def.id)} onChange={(e) => onSetting({ t: 'SetAutoReact', cardType: def.id, on: (e.target as HTMLInputElement).checked })} />
                    automatisch einsetzen
                  </label>
                ) : st.ok ? (
                  <Btn small kind="ok" onClick={() => onPlay(inst)}>Spielen</Btn>
                ) : (
                  <div class="hint">{st.reason}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div class="box">
        <div class="title">Reaktionsregeln & Verteidigung</div>
        <div class="hint">Reaktionskarten werden automatisch gespielt, wenn ihre Bedingung erfüllt ist (z. B. Schildgenerator bei starkem Angriff). So musst du bei Partien über mehrere Tage nicht auf Angriffe warten. Abschalten pro Kartentyp:</div>
        <div class="reactlist">
          {reactionTypes.map((def) => (
            <label key={def.id} class="check">
              <input type="checkbox" checked={autoReactEnabled(me, def.id)} onChange={(e) => onSetting({ t: 'SetAutoReact', cardType: def.id, on: (e.target as HTMLInputElement).checked })} />
              {def.name} <span class="hint">({COMMANDER_NAMES[def.deck]})</span>
            </label>
          ))}
        </div>
        <label class="check">
          <input type="checkbox" checked={me.settings.defendMax} onChange={(e) => onSetting({ t: 'SetDefendMax', on: (e.target as HTMLInputElement).checked })} />
          Immer mit maximaler Würfelzahl verteidigen (empfohlen)
        </label>
      </div>
    </div>
  );
}

/** Handkarten als Leiste unten im Spielfeld: Piktogramm je Deck, Kosten, antippen für Details */
export function HandTray({ view, s, me, onPlay }: { view: GameView; s: GameState; me: Player | null; onPlay: (inst: string) => void }) {
  const [open, setOpen] = useState(true);
  const [sel, setSel] = useState<string | null>(null);
  if (!me) return null;
  const hand = [...me.hand].sort((a, b) => CARD[cardType(a)].deck.localeCompare(CARD[cardType(b)].deck));
  const selDef = sel && me.hand.includes(sel) ? CARD[cardType(sel)] : null;
  const st = selDef && sel ? cardStatus(view, s, me, sel) : null;
  return (
    <div class="tray" data-open={open ? 1 : 0}>
      {selDef && sel && st && (
        <div class={`tray-detail deck-${selDef.deck.toLowerCase()}`}>
          <div class="td-head">
            <span class="td-ico" style={{ color: CMD_COLOR[selDef.deck] }}><Ico name={selDef.deck} size={22} /></span>
            <b>{selDef.name}</b>
            <span class="cost"><Ico name="bolt" size={14} /> {selDef.powerUp}</span>
            <button type="button" class="x" aria-label="Schließen" onClick={() => setSel(null)}><Ico name="close" size={16} /></button>
          </div>
          <div class="card-meta">{COMMANDER_NAMES[selDef.deck]} · {TIMING_LABEL[selDef.timing]}</div>
          <div class="card-text">{selDef.text}</div>
          {st.ok ? <Btn small kind="ok" onClick={() => { setSel(null); onPlay(sel); }}>Spielen</Btn> : <div class="hint">{['REA', 'ERO', 'KAR'].includes(selDef.timing) ? (autoReactEnabled(me, selDef.id) ? 'Wird automatisch eingesetzt (Hand-Menü: abschaltbar).' : 'Automatik ist aus (Hand-Menü).') : st.reason}</div>}
        </div>
      )}
      <div class="tray-bar">
        <button type="button" class="tray-toggle" onClick={() => setOpen(!open)} aria-label={open ? 'Handkarten einklappen' : 'Handkarten ausklappen'}>
          <Ico name="cards" size={18} /><b>{me.hand.length}</b><Ico name={open ? 'chevronDown' : 'chevronUp'} size={14} />
        </button>
        {open && (
          <div class="tray-row">
            
            {hand.map((inst) => {
              const def = CARD[cardType(inst)];
              const ok = cardStatus(view, s, me, inst).ok;
              const auto = ['REA', 'ERO', 'KAR'].includes(def.timing);
              return (
                <button type="button" key={inst} class={`tile deck-${def.deck.toLowerCase()} ${ok ? 'playable' : ''} ${sel === inst ? 'sel' : ''}`} onClick={() => setSel(sel === inst ? null : inst)} title={def.name}>
                  <span class="t-ico" style={{ color: CMD_COLOR[def.deck] }}><Ico name={def.deck} size={22} /></span>
                  <span class="t-cost"><Ico name="bolt" size={11} />{def.powerUp}</span>
                  <span class="t-name">{def.name}</span>
                  {auto && <span class="t-auto" title="wirkt automatisch"><Ico name="check" size={10} /></span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
