// Spielbildschirm: Karte, kontextabhängige Aktionsleiste, Hand, Spieler, Protokoll
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  CARD, cardType, COMMANDER_TYPES, COMMANDER_NAMES, COSTS, MAX_STATIONS, MAX_CARD_BUY, TDEF, RDEF, units,
  invadeError, pathExists, commanderInPlay, commanderLocation, stationCount, validTargets, planDice,
  conquestProbability, maxAttackDice, computeIncome, owned, COLOR_NAMES,
} from '../../engine/index.ts';
import type { Command, CommanderType, GameState, Player, UnitMove, CardDef, Targets } from '../../engine/index.ts';
import { sendCommand, api, type GameView, type Live, type Me } from '../api.ts';
import { Board } from './Board.tsx';
import { Btn, Dot, Stepper, UnitPicker, timeLeft } from './widgets.tsx';
import { Hand, cardStatus } from './Hand.tsx';
import { Players } from './Players.tsx';
import { LogView } from './LogView.tsx';

type Tab = 'map' | 'hand' | 'players' | 'log';
type Pending =
  | { kind: 'hire'; type: CommanderType }
  | { kind: 'station' }
  | { kind: 'card'; inst: string; tg: Targets; step: 1 | 2 }
  | null;

const STEP_LABEL: Record<string, string> = {
  deploy: 'Einsetzen', hire: 'Anheuern & Bauen', buy: 'Karten kaufen', main: 'Karten & Invasionen', fortify: 'Truppenbewegung', end: 'Zugende',
};

export function phaseLabel(v: GameView): string {
  switch (v.phase) {
    case 'quickSetup': return 'Aufstellung';
    case 'setupClaim': return 'Gebiete wählen';
    case 'setupReinforce': return 'Verstärken';
    case 'setupUnits': return 'Starteinheiten';
    case 'bid': return 'Gebot';
    case 'pickSlot': return 'Zugplatz wählen';
    case 'turn': return v.turn ? STEP_LABEL[v.turn.step] : 'Zug';
    case 'gameOver': return 'Spielende';
  }
}

export function Game({ gameId, live, me, navigate }: { gameId: string; live: Live; me: Me; navigate: (p: string) => void }) {
  const [view, setView] = useState<GameView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('map');
  const [board, setBoard] = useState<'planet' | 'moon'>('planet');
  const [sel, setSel] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [placements, setPlacements] = useState<Record<string, number>>({});
  const [quick, setQuick] = useState<{ stage: 'mods' | 'land' | 'diplomat' | 'station'; land?: string; diplomat?: string; station?: string }>({ stage: 'mods' });
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [recap, setRecap] = useState<{ count: number; msgs: string[] } | null>(null);
  const [flash, setFlash] = useState<string[]>([]);
  const lastPhaseKey = useRef('');

  useEffect(() => {
    let alive = true;
    api<{ state: GameView }>(`/api/games/${gameId}/state`).then((r) => alive && setView(r.state)).catch((e) => setError(e.message));
    live.subscribe(gameId);
    const off = live.on((m) => {
      if (m.type === 'state' && m.state && m.state.gameId === gameId) setView(m.state);
      if (m.type === 'gone') setError(String(m.error ?? 'Partie nicht verfügbar'));
    });
    return () => { alive = false; off(); live.subscribe(null); };
  }, [gameId]);

  // Lokale Auswahl zurücksetzen, wenn sich Phase/Schritt ändert
  useEffect(() => {
    if (!view) return;
    const key = `${view.phase}|${view.year}|${view.turnIndex}|${view.turn?.step}|${view.invasion ? 'inv' : ''}`;
    if (key !== lastPhaseKey.current) {
      lastPhaseKey.current = key;
      setPlacements({});
      setPending(null);
      if (!view.invasion) { setTarget(null); }
      if (view.phase !== 'turn' || (view.turn?.step !== 'main' && view.turn?.step !== 'fortify')) setSel(null);
      if (view.phase !== 'quickSetup' && view.phase !== 'setupUnits') setQuick({ stage: 'mods' });
    }
  }, [view?.version]);

  // "Was ist passiert, seit ich weg war?"
  useEffect(() => {
    if (!view) return;
    const k = `kk-seen-${gameId}`;
    let last = 0;
    try { last = Number(localStorage.getItem(k) ?? 0); } catch { /* */ }
    const latest = view.log.at(-1)?.seq ?? 0;
    if (last && latest > last && !recap) {
      const fresh = view.log.filter((e) => e.seq > last && e.player !== view.me);
      if (fresh.length >= 3) {
        setRecap({ count: fresh.length, msgs: fresh.slice(-8).map((e) => e.msg) });
        const ids = fresh.flatMap((e) => [e.data?.to, e.data?.territory].filter(Boolean) as string[]);
        setFlash([...new Set(ids)].slice(-10));
        setTimeout(() => setFlash([]), 4000);
      }
    }
    try { localStorage.setItem(k, String(latest)); } catch { /* */ }
  }, [view?.version]);

  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t); } }, [toast]);

  if (error) return <div class="screen center"><p class="error">{error}</p><Btn onClick={() => navigate('/')}>Zur Lobby</Btn></div>;
  if (!view) return <div class="screen center"><div class="spinner" /></div>;

  const s = view as unknown as GameState;
  const myId = view.me;
  const meP = view.players.find((p) => p.id === myId) ?? null;
  const players = Object.fromEntries(view.players.map((p) => [p.id, p])) as Record<string, Player>;
  const myAction = Boolean(myId && view.pending.includes(myId));
  const turn = view.turn;
  const myTurn = Boolean(turn && turn.player === myId && view.phase === 'turn');
  const inv = view.invasion;

  const send = async (cmd: Command, okMsg?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await sendCommand(gameId, cmd, view.version);
      if (okMsg) setToast(okMsg);
      if (!live.connected) {
        const r = await api<{ state: GameView }>(`/api/games/${gameId}/state`);
        setView(r.state);
      }
    } catch (e) {
      setToast((e as Error).message);
      if ((e as { status?: number }).status === 409) {
        const r = await api<{ state: GameView }>(`/api/games/${gameId}/state`);
        setView(r.state);
      }
    } finally {
      setBusy(false);
    }
  };

  // ---------------------------------------------------------------- Kontext für Karte
  const placingTotal = (() => {
    if (!myAction || !myId) return 0;
    if (view.phase === 'quickSetup' && quick.stage === 'mods') return view.setup?.remaining[myId] ?? 0;
    if (view.phase === 'setupReinforce') return Math.min(3, view.setup?.remaining[myId] ?? 0);
    if (myTurn && turn?.step === 'deploy') return turn.incomeMods;
    if (pending?.kind === 'card' && CARD[cardType(pending.inst)].target === 'distribute') return CARD[cardType(pending.inst)].distribute!;
    return 0;
  })();
  const placed = Object.values(placements).reduce((n, x) => n + x, 0);
  const cardDef: CardDef | null = pending?.kind === 'card' ? CARD[cardType(pending.inst)] : null;

  const targets = (() => {
    const set = new Set<string>();
    if (!myId) return set;
    const all = Object.keys(view.territories);
    if (cardDef && pending?.kind === 'card') {
      if (cardDef.target === 'move' && pending.step === 2) {
        for (const id of validTargets(s, myId, cardDef)) if (id !== pending.tg.territory) set.add(id);
        if (cardDef.id === 'NAV-05') for (const id of owned(s, myId)) if (id !== pending.tg.territory) set.add(id);
      } else for (const id of validTargets(s, myId, cardDef)) set.add(id);
      return set;
    }
    if (pending?.kind === 'hire') { for (const id of owned(s, myId)) set.add(id); return set; }
    if (pending?.kind === 'station') {
      for (const id of owned(s, myId)) if (TDEF[id].type === 'land' && !view.territories[id].station) set.add(id);
      return set;
    }
    if (placingTotal > 0) { for (const id of owned(s, myId)) set.add(id); return set; }
    if (view.phase === 'quickSetup' || view.phase === 'setupUnits') {
      if (quick.stage === 'land' || quick.stage === 'diplomat') for (const id of owned(s, myId)) set.add(id);
      if (quick.stage === 'station') for (const id of owned(s, myId)) if (TDEF[id].type === 'land') set.add(id);
      return set;
    }
    if (view.phase === 'setupClaim' && myAction) {
      for (const id of all) if (TDEF[id].type === 'land' && !view.territories[id].owner && !view.territories[id].devastated) set.add(id);
      return set;
    }
    if (myTurn && sel && !inv && turn?.step !== 'fortify') {
      for (const id of all) if (!invadeError(s, myId, sel, id)) set.add(id);
    }
    if (myTurn && sel && turn?.step === 'fortify') {
      for (const id of owned(s, myId)) if (id !== sel && pathExists(s, myId, sel, id)) set.add(id);
    }
    return set;
  })();

  const onTap = (id: string) => {
    if (!myId) return;
    const t = view.territories[id];
    if (pending?.kind === 'hire' || pending?.kind === 'station') {
      if (!targets.has(id)) return setToast('Bitte ein markiertes eigenes Gebiet wählen');
      send(pending.kind === 'hire' ? { t: 'HireCommander', type: pending.type, territory: id } : { t: 'BuildStation', territory: id });
      setPending(null);
      return;
    }
    if (pending?.kind === 'card' && cardDef) {
      if (cardDef.target === 'distribute') {
        if (!targets.has(id)) return setToast('Nur markierte Gebiete');
        if (placed >= placingTotal) return;
        setPlacements({ ...placements, [id]: (placements[id] ?? 0) + 1 });
        return;
      }
      if (!targets.has(id)) return setToast('Nur markierte Gebiete sind gültige Ziele');
      if (cardDef.target === 'move') {
        if (pending.step === 1) setPending({ ...pending, tg: { territory: id }, step: 2 });
        else setPending({ ...pending, tg: { ...pending.tg, territory2: id, count: cardDef.moveMax } });
        return;
      }
      setPending({ ...pending, tg: { territory: id } });
      return;
    }
    if (placingTotal > 0) {
      if (t.owner !== myId) return setToast('Nur in eigene Gebiete');
      if (placed >= placingTotal) return setToast('Alle MODs verteilt – bestätigen oder zurücksetzen');
      setPlacements({ ...placements, [id]: (placements[id] ?? 0) + 1 });
      return;
    }
    if ((view.phase === 'quickSetup' || view.phase === 'setupUnits') && myAction && quick.stage !== 'mods') {
      if (!targets.has(id)) return setToast('Nur eigene (Land-)Gebiete');
      const next = { ...quick, [quick.stage]: id } as typeof quick;
      next.stage = quick.stage === 'land' ? 'diplomat' : quick.stage === 'diplomat' ? 'station' : 'station';
      setQuick(next);
      return;
    }
    if (myTurn && !inv && (turn?.step === 'main' || turn?.step === 'hire' || turn?.step === 'buy' || turn?.step === 'fortify')) {
      if (sel && targets.has(id)) { setTarget(id); return; }
      if (t.owner === myId && units(t) >= 2) { setSel(id); setTarget(null); return; }
    }
    setSel(id);
    setTarget(null);
  };

  const otherBoardTargets = [...targets].some((id) => TDEF[id].board !== board);

  // ---------------------------------------------------------------- Aktionsleiste
  const panel = renderPanel();

  function renderPanel() {
    if (view!.phase === 'gameOver') return <GameOver view={view!} players={players} />;
    const trade = view!.effects.find((e) => e.kind === 'tradeOffer' && e.target === myId);
    const tradeBox = trade && (
      <div class="box warn">
        <b>Handelsabkommen</b> von {players[trade.owner]?.name}: Nimmst du an, erhältst du 2 Energie und {players[trade.owner]?.name} 1.
        <div class="btnrow">
          <Btn kind="ok" small onClick={() => send({ t: 'AnswerTrade', effectId: trade.id, accept: true })}>Annehmen</Btn>
          <Btn kind="ghost" small onClick={() => send({ t: 'AnswerTrade', effectId: trade.id, accept: false })}>Ablehnen</Btn>
        </div>
      </div>
    );
    if (pending?.kind === 'card' && cardDef) return <>{tradeBox}{renderCardTargeting()}</>;
    if (!myId) return <div class="box">Du schaust zu. {waitingText()}</div>;
    if (!myAction) {
      return (
        <>
          {tradeBox}
          <div class="box">
            <div>{waitingText()}</div>
            {view!.deadlineAt && <div class="hint">Frist: {timeLeft(view!.deadlineAt)} – danach übernimmt ein Bot.</div>}
            {sel && <TerritoryInfo id={sel} view={view!} players={players} />}
          </div>
        </>
      );
    }
    return <>{tradeBox}{renderMyAction()}</>;
  }

  function waitingText() {
    const names = view!.pending.map((id) => players[id]?.name).filter(Boolean);
    if (!names.length) return 'Bitte warten …';
    return `Warte auf ${names.join(', ')}${view!.phase === 'turn' ? ` (${phaseLabel(view!)})` : ''} …`;
  }

  function placementBox(title: string, onConfirm: () => void, extra?: preact.ComponentChildren) {
    const left = placingTotal - placed;
    return (
      <div class="box">
        <div class="title">{title}</div>
        <div class="big">{left > 0 ? `Noch ${left} MOD(s) verteilen – tippe auf eigene Gebiete` : 'Alles verteilt'}</div>
        {placed > 0 && (
          <div class="placelist">
            {Object.entries(placements).filter(([, n]) => n > 0).map(([id, n]) => (
              <span class="chip on" key={id} onClick={() => { const p = { ...placements }; p[id]--; setPlacements(p); }}>{TDEF[id].name} +{n} ✕</span>
            ))}
          </div>
        )}
        {sel && left > 0 && view!.territories[sel].owner === myId && (
          <Btn kind="ghost" small onClick={() => setPlacements({ ...placements, [sel]: (placements[sel] ?? 0) + left })}>Rest ({left}) nach {TDEF[sel].name}</Btn>
        )}
        {extra}
        <div class="btnrow">
          <Btn kind="ghost" onClick={() => setPlacements({})} disabled={!placed}>Zurücksetzen</Btn>
          <Btn kind="ok" onClick={onConfirm} disabled={left !== 0 || busy}>Bestätigen</Btn>
        </div>
      </div>
    );
  }

  function renderMyAction() {
    const v = view!;
    const me = meP!;
    switch (v.phase) {
      case 'quickSetup': case 'setupUnits': {
        if (v.phase === 'quickSetup' && quick.stage === 'mods') {
          return placementBox('Aufstellung: restliche Start-MODs', () => setQuick({ stage: 'land' }));
        }
        const stageText = { land: 'Land-Kommandant', diplomat: 'Diplomat', station: 'Raumstation (Landgebiet)', mods: '' }[quick.stage];
        const ready = quick.land && quick.diplomat && quick.station;
        return (
          <div class="box">
            <div class="title">Starteinheiten platzieren</div>
            <div class="big">Tippe ein eigenes Gebiet für: <b>{stageText}</b></div>
            <div class="placelist">
              {(['land', 'diplomat', 'station'] as const).map((k) => (
                <span key={k} class={`chip ${quick.stage === k ? 'on' : ''}`} onClick={() => setQuick({ ...quick, stage: k })}>
                  {k === 'land' ? 'Land-Kdt' : k === 'diplomat' ? 'Diplomat' : 'Station'}: {quick[k] ? TDEF[quick[k]!].name : '–'}
                </span>
              ))}
            </div>
            <div class="btnrow">
              {v.phase === 'quickSetup' && <Btn kind="ghost" onClick={() => { setQuick({ stage: 'mods' }); }}>Zurück</Btn>}
              <Btn kind="ok" disabled={!ready || busy} onClick={() => send(v.phase === 'quickSetup'
                ? { t: 'QuickSetup', placements, land: quick.land!, diplomat: quick.diplomat!, station: quick.station! }
                : { t: 'SetupUnits', land: quick.land!, diplomat: quick.diplomat!, station: quick.station! }, 'Aufstellung gespeichert')}>Aufstellung abschließen</Btn>
            </div>
          </div>
        );
      }
      case 'setupClaim':
        return (
          <div class="box">
            <div class="title">Gebiet beanspruchen</div>
            <div>Tippe auf ein freies Landgebiet (markiert).</div>
            {sel && targets.has(sel) && <Btn kind="ok" onClick={() => send({ t: 'SetupClaim', territory: sel })}>{TDEF[sel].name} besetzen</Btn>}
          </div>
        );
      case 'setupReinforce':
        return placementBox('Verstärken (bis zu 3 MODs)', () => send({ t: 'SetupReinforce', placements }));
      case 'bid':
        return <BidBox me={me} view={v} busy={busy} onBid={(amount, card) => send({ t: 'Bid', amount, card }, 'Gebot abgegeben')} />;
      case 'pickSlot':
        return (
          <div class="box">
            <div class="title">Wähle deinen Zugplatz</div>
            {v.bidResult && <div class="hint">Gebote: {v.bidResult.map((b) => `${players[b.player]?.name} ${b.amount}`).join(' · ')}</div>}
            <div class="btnrow wrap">
              {v.slots.map((x, i) => <Btn key={i} kind={x ? 'ghost' : 'primary'} disabled={Boolean(x) || busy} onClick={() => send({ t: 'PickSlot', slot: i + 1 })}>{i + 1}. {x ? players[x]?.name : 'frei'}</Btn>)}
            </div>
          </div>
        );
      case 'turn':
        return renderTurn(me);
      default:
        return null;
    }
  }

  function renderTurn(me: Player) {
    const v = view!;
    const t = v.turn!;
    if (t.bonusCardPending) {
      return (
        <div class="box ok">
          <div class="title">3-Gebiete-Bonus: Karte wählen</div>
          <div class="btnrow wrap">
            {COMMANDER_TYPES.filter((d) => commanderInPlay(s, myId!, d) && v.deckCounts[d] > 0).map((d) => (
              <Btn key={d} small onClick={() => send({ t: 'ClaimBonusCard', deck: d })}>{COMMANDER_NAMES[d]} ({v.deckCounts[d]})</Btn>
            ))}
          </div>
        </div>
      );
    }
    if (inv) return renderInvasion(me);
    switch (t.step) {
      case 'deploy': {
        const inc = computeIncome(s, myId!);
        return placementBox(`Einsetzen: ${t.incomeMods} neue MODs`, () => send({ t: 'Deploy', placements }),
          <div class="hint">{inc.territories} Gebiete → {inc.base}{inc.bonus ? ` + ${inc.bonus} Bonus` : ''}. Stations-MODs wurden automatisch gesetzt.</div>);
      }
      case 'hire': return renderHire(me);
      case 'buy': return <BuyBox view={v} me={me} s={s} busy={busy} onBuy={(decks) => send({ t: 'BuyCards', decks })} onSkip={() => send({ t: 'EndPhase' })} />;
      case 'main': return renderMain();
      case 'fortify': return renderFortify();
      case 'end':
        return (
          <div class="box">
            <div class="title">Zugende</div>
            <EndCards view={v} s={s} me={me} onPlay={(c) => send({ t: 'PlayCard', card: c })} />
            <Btn kind="danger" onClick={() => send({ t: 'EndTurn' })} disabled={busy}>Zug beenden</Btn>
          </div>
        );
    }
  }

  function renderHire(me: Player) {
    return (
      <div class="box">
        <div class="title">Kommandanten anheuern ({COSTS.commander} E) · Stationen ({COSTS.station} E)</div>
        <div class="cmdgrid">
          {COMMANDER_TYPES.map((c) => {
            const at = commanderLocation(s, myId!, c);
            return (
              <div key={c} class={`cmdcard ${at ? 'active' : ''}`}>
                <b>{COMMANDER_NAMES[c]}</b>
                <span>{at ? TDEF[at].name : 'nicht im Spiel'}</span>
                {!at && <Btn small disabled={me.energy < COSTS.commander} onClick={() => { setPending({ kind: 'hire', type: c }); setToast('Tippe auf ein eigenes Gebiet'); }}>Anheuern</Btn>}
              </div>
            );
          })}
          <div class="cmdcard">
            <b>Raumstation</b>
            <span>{stationCount(s, myId!)} / {MAX_STATIONS}</span>
            <Btn small disabled={me.energy < COSTS.station || stationCount(s, myId!) >= MAX_STATIONS} onClick={() => { setPending({ kind: 'station' }); setToast('Tippe auf ein eigenes Landgebiet'); }}>Bauen</Btn>
          </div>
        </div>
        {pending && <div class="hint warn">Ziel wählen: tippe auf ein markiertes Gebiet · <a onClick={() => setPending(null)}>abbrechen</a></div>}
        <div class="btnrow">
          <Btn kind="ghost" onClick={() => send({ t: 'EndPhase' })}>Weiter: Karten kaufen</Btn>
        </div>
      </div>
    );
  }

  function renderMain() {
    const v = view!;
    const src = sel && v.territories[sel]?.owner === myId ? sel : null;
    if (src && target) {
      const err = invadeError(s, myId!, src, target);
      const tt = v.territories[target];
      if (err) return <div class="box">{err} <Btn kind="ghost" small onClick={() => setTarget(null)}>Zurück</Btn></div>;
      if (units(tt) === 0) return <OccupyBox from={src} to={target} view={v} busy={busy} onGo={(move) => { send({ t: 'Invade', from: src, to: target, move }); setTarget(null); }} onCancel={() => setTarget(null)} />;
      return (
        <div class="box">
          <div class="title">{TDEF[src].name} → {TDEF[target].name}</div>
          <div>Verteidiger: {players[tt.owner!]?.name} mit {units(tt)} Einheit(en){tt.station ? ' + Station (alle W8)' : ''}.</div>
          <div class="hint">Nach der Erklärung können Gegner Reaktionskarten spielen; du kannst Angriffskarten (ANG) einsetzen.</div>
          <div class="btnrow">
            <Btn kind="ghost" onClick={() => setTarget(null)}>Zurück</Btn>
            <Btn kind="danger" disabled={busy} onClick={() => send({ t: 'Invade', from: src, to: target })}>Angriff erklären</Btn>
          </div>
        </div>
      );
    }
    return (
      <div class="box">
        <div class="title">Karten spielen & Invasionen</div>
        <div>{src ? `${TDEF[src].name} gewählt – tippe ein markiertes Ziel (${targets.size}).` : 'Tippe auf ein eigenes Gebiet mit mindestens 2 Einheiten als Angriffsquelle.'}</div>
        {otherBoardTargets && <div class="hint warn">Es gibt Ziele auf dem {board === 'planet' ? 'Mond' : 'Planeten'} – Brett umschalten.</div>}
        {!v.turn!.invaded && <div class="hint">Vor der ersten Invasion: Karten (VOR) im Tab „Hand“ spielen.</div>}
        <div class="btnrow">
          <Btn kind="ghost" onClick={() => setTab('hand')}>Hand ({meP?.hand.length ?? 0})</Btn>
          <Btn kind="ghost" onClick={() => send({ t: 'EndPhase' })}>Weiter: Truppenbewegung</Btn>
        </div>
      </div>
    );
  }

  function renderFortify() {
    const v = view!;
    const src = sel && v.territories[sel]?.owner === myId && units(v.territories[sel]) >= 2 ? sel : null;
    if (src && target && targets.has(target)) {
      return <FortifyBox from={src} to={target} view={v} busy={busy} onGo={(move) => { send({ t: 'Fortify', from: src, to: target, move }); setSel(null); setTarget(null); }} onCancel={() => setTarget(null)} />;
    }
    return (
      <div class="box">
        <div class="title">Truppenbewegung ({v.turn!.fortifiesLeft}×)</div>
        <div>{src ? 'Tippe ein markiertes Zielgebiet (Pfad über eigene Gebiete).' : 'Tippe ein eigenes Gebiet mit mindestens 2 Einheiten als Quelle.'}</div>
        <div class="btnrow">
          <Btn kind="ghost" onClick={() => send({ t: 'EndPhase' })}>Ohne Bewegung weiter</Btn>
          <Btn kind="danger" onClick={() => send({ t: 'EndTurn' })}>Zug beenden</Btn>
        </div>
      </div>
    );
  }

  function renderInvasion(me: Player) {
    const v = view!;
    const i = v.invasion!;
    const from = v.territories[i.from];
    const to = v.territories[i.to];
    const lastBattle = [...v.log].reverse().find((e) => e.kind === 'battle' && (e.data as { to?: string })?.to === i.to);
    if (i.awaitingAdvance) {
      const must = i.lastD8Commanders.filter((c) => from.commanders.includes(c));
      const min = Math.min(i.lastAttDice, units(from) - 1);
      return <AdvanceBox key={v.version} from={i.from} to={i.to} t={from} min={min} must={must} busy={busy} battle={lastBattle} onGo={(move) => send({ t: 'Advance', move }, 'Gebiet erobert!')} />;
    }
    if (i.deterred) {
      return (
        <div class="box warn">
          <div class="title">Abschreckung!</div>
          <div>{players[to.owner!]?.name} verlangt {i.deterred} Energie, sonst wird die Invasion abgebrochen.</div>
          <div class="btnrow">
            <Btn kind="ok" disabled={me.energy < i.deterred} onClick={() => send({ t: 'Deterrence', pay: true })}>Zahlen ({i.deterred} E)</Btn>
            <Btn kind="ghost" onClick={() => send({ t: 'Deterrence', pay: false })}>Abbrechen</Btn>
          </div>
        </div>
      );
    }
    return <AttackBox key={v.version} view={v} s={s} me={me} players={players} busy={busy} battle={lastBattle}
      onAttack={(dice, blitz) => send({ t: 'Attack', dice, blitz, minRemaining: 2 })}
      onRetreat={() => send({ t: 'Retreat' })}
      onCard={(c) => send({ t: 'PlayCard', card: c })} />;
  }

  function renderCardTargeting() {
    const def = cardDef!;
    const p = pending as Extract<Pending, { kind: 'card' }>;
    const cancel = <Btn kind="ghost" onClick={() => { setPending(null); setPlacements({}); }}>Abbrechen</Btn>;
    const play = (tg: Targets) => { send({ t: 'PlayCard', card: p.inst, targets: tg }, `${def.name} gespielt`); setPending(null); setPlacements({}); };
    const head = <div class="title">{def.name} <span class="hint">({def.powerUp} E)</span></div>;
    if (def.target === 'player') {
      return (
        <div class="box">{head}<div>{def.text}</div>
          <div class="btnrow wrap">
            {view!.players.filter((x) => x.id !== myId && !x.eliminated && !x.isNeutral).map((x) => (
              <Btn key={x.id} small onClick={() => play({ player: x.id })}><Dot color={x.color} /> {x.name}</Btn>
            ))}
          </div>{cancel}
        </div>
      );
    }
    if (def.target === 'deck') {
      return (
        <div class="box">{head}
          <div class="btnrow wrap">
            {COMMANDER_TYPES.filter((d) => commanderInPlay(s, myId!, d)).map((d) => <Btn key={d} small disabled={!view!.deckCounts[d]} onClick={() => play({ deck: d })}>{COMMANDER_NAMES[d]} ({view!.deckCounts[d]})</Btn>)}
          </div>{cancel}
        </div>
      );
    }
    if (def.target === 'distribute') {
      return placementBox(`${def.name}: ${def.distribute} MODs in einen Kontinent`, () => play({ placements }), cancel);
    }
    if (def.target === 'move') {
      const tg = p.tg;
      return (
        <div class="box">{head}<div>{def.text}</div>
          <div class="big">{!tg.territory ? 'Tippe auf das Startgebiet.' : !tg.territory2 ? 'Tippe auf das Zielgebiet.' : `${TDEF[tg.territory].name} → ${TDEF[tg.territory2].name}`}</div>
          {tg.territory && tg.territory2 && (
            <div class="row">Einheiten: <Stepper value={tg.count ?? def.moveMax!} min={1} max={Math.min(def.moveMax!, units(view!.territories[tg.territory]) - 1)} onChange={(n) => setPending({ ...p, tg: { ...tg, count: n } })} /></div>
          )}
          <div class="btnrow">{cancel}<Btn kind="ok" disabled={!tg.territory2} onClick={() => play(tg)}>Ausführen</Btn></div>
        </div>
      );
    }
    return (
      <div class="box">{head}<div>{def.text}</div>
        <div class="big">{p.tg.territory ? `Ziel: ${TDEF[p.tg.territory].name}` : `Tippe auf ein markiertes Ziel (${targets.size} möglich).`}</div>
        {targets.size === 0 && <div class="hint warn">Aktuell gibt es kein gültiges Ziel.</div>}
        <div class="btnrow">{cancel}<Btn kind="ok" disabled={!p.tg.territory} onClick={() => play(p.tg)}>Ausführen</Btn></div>
      </div>
    );
  }

  const startCard = (inst: string) => {
    const def = CARD[cardType(inst)];
    if (def.target === 'none') { send({ t: 'PlayCard', card: inst }, `${def.name} gespielt`); return; }
    setPending({ kind: 'card', inst, tg: {}, step: 1 });
    setPlacements({});
    setTab('map');
    const tgts = validTargets(s, myId!, def);
    if (tgts.length && tgts.every((id) => TDEF[id].board === 'moon')) setBoard('moon');
  };

  const overlay = placingTotal > 0 ? placements : undefined;
  const statusLine = view.phase === 'turn' && turn
    ? <><Dot color={players[turn.player]?.color} /> {players[turn.player]?.name} · {phaseLabel(view)}</>
    : <>{phaseLabel(view)}</>;

  return (
    <div class="game">
      <header class="topbar">
        <button class="back" onClick={() => navigate('/')} aria-label="Zur Lobby">‹</button>
        <div class="tb-main">
          <div class="tb-sub">{view.gameName} · Jahr {Math.max(1, Math.min(view.year, view.config.years))}/{view.config.years}</div>
          <div class="tb-title">{statusLine}</div>
        </div>
        {meP && (
          <div class="res">
            <span class="chip"><b class="energy">⚡ {meP.energy}</b></span>
            <span class="chip">🂠 {meP.hand.length}</span>
          </div>
        )}
        <span class={`conn ${live.connected ? 'on' : 'off'}`} title={live.connected ? 'Live verbunden' : 'Verbindung wird aufgebaut'} />
      </header>

      <div class={`content tab-${tab}`}>
        <section class="mapwrap">
          <div class="boardtoggle">
            <button class={board === 'planet' ? 'on' : ''} onClick={() => setBoard('planet')}>Planet</button>
            <button class={board === 'moon' ? 'on' : ''} onClick={() => setBoard('moon')}>Mond{otherBoardTargets && board === 'planet' ? ' •' : ''}</button>
          </div>
          <Board view={view} board={board} selected={target ?? sel} targets={targets} overlay={overlay} flash={flash} onTap={onTap} />
          {sel && !inv && tab === 'map' && <div class="selinfo"><TerritoryInfo id={sel} view={view} players={players} compact /></div>}
        </section>
        <section class="side">
          {tab === 'map' && <div class="panel">{panel}</div>}
          {tab === 'hand' && <Hand view={view} s={s} me={meP} onPlay={startCard} onSetting={(cmd) => send(cmd)} />}
          {tab === 'players' && <Players view={view} />}
          {tab === 'log' && <LogView view={view} />}
        </section>
      </div>

      {recap && (
        <div class="recap" onClick={() => setRecap(null)}>
          <b>Seit deinem letzten Besuch ({recap.count} Ereignisse):</b>
          <ul>{recap.msgs.map((m, i) => <li key={i}>{m}</li>)}</ul>
          <span class="hint">Tippen zum Schließen · vollständig im Protokoll</span>
        </div>
      )}
      {toast && <div class="toast" onClick={() => setToast(null)}>{toast}</div>}

      <nav class="tabbar">
        {(['map', 'hand', 'players', 'log'] as Tab[]).map((k) => (
          <button key={k} class={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            <span class="ico">{{ map: '🗺', hand: '🂠', players: '👥', log: '📜' }[k]}</span>
            {{ map: 'Karte', hand: 'Hand', players: 'Spieler', log: 'Protokoll' }[k]}
            {k === 'map' && myAction && <span class="badge-dot" />}
          </button>
        ))}
      </nav>
    </div>
  );
}

// ================================================================== Teil-Komponenten
function TerritoryInfo({ id, view, players, compact }: { id: string; view: GameView; players: Record<string, Player>; compact?: boolean }) {
  const t = view.territories[id];
  const def = TDEF[id];
  const owner = t.owner ? players[t.owner] : null;
  return (
    <div class={`tinfo ${compact ? 'compact' : ''}`}>
      <b>{def.name}</b> <span class="hint">{def.type === 'land' ? 'Land' : def.type === 'water' ? 'Wasser' : 'Mond'} · {RDEF[def.region].name} (+{RDEF[def.region].bonus}){def.landingSite ? ' · Landeplatz' : ''}</span>
      <div>
        {t.devastated ? 'Verwüstet' : owner ? <><Dot color={owner.color} /> {owner.name}: {t.mods} MODs{t.commanders.length ? ` · ${t.commanders.map((c) => COMMANDER_NAMES[c]).join(', ')}` : ''}{t.station ? ' · Station' : ''}</> : 'Unbesetzt'}
      </div>
    </div>
  );
}

function BidBox({ me, view, busy, onBid }: { me: Player; view: GameView; busy: boolean; onBid: (amount: number, card?: string) => void }) {
  const [amount, setAmount] = useState(0);
  const [useCard, setUseCard] = useState(false);
  const card = me.hand.find((c) => CARD[cardType(c)].timing === 'GEBOT');
  const canCard = card && commanderInPlay(view as unknown as GameState, me.id, 'DIPLOMAT');
  if (view.bids[me.id]) return <div class="box">Gebot abgegeben ({view.bids[me.id].amount}). Warte auf die anderen …</div>;
  return (
    <div class="box">
      <div class="title">Jahr {view.year}: geheimes Gebot um die Zugreihenfolge</div>
      <div class="bidnum">{amount}</div>
      <input type="range" min={0} max={me.energy} value={amount} onInput={(e) => setAmount(Number((e.target as HTMLInputElement).value))} />
      <div class="hint">von {me.energy} Energie · Gebote verfallen vollständig · der Höchstbietende wählt seinen Platz frei</div>
      {canCard && <label class="check"><input type="checkbox" checked={useCard} onChange={(e) => setUseCard((e.target as HTMLInputElement).checked)} /> Geheimverhandlung spielen (+2 aufs Gebot)</label>}
      <div class="hint">Abgegeben: {Object.keys(view.bids).length} / {view.players.filter((p) => !p.eliminated && !p.isNeutral).length}</div>
      <Btn kind="warn" disabled={busy} onClick={() => { if (confirm(`Gebot ${amount} verbindlich abgeben?`)) onBid(amount, useCard ? card : undefined); }}>Gebot verbindlich abgeben</Btn>
    </div>
  );
}

function BuyBox({ view, me, s, busy, onBuy, onSkip }: { view: GameView; me: Player; s: GameState; busy: boolean; onBuy: (d: CommanderType[]) => void; onSkip: () => void }) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const total = Object.values(counts).reduce((n, x) => n + x, 0);
  const embargo = view.effects.some((e) => e.kind === 'embargo' && e.target === me.id);
  return (
    <div class="box">
      <div class="title">Kommandokarten kaufen ({COSTS.card} E je Karte, max. {MAX_CARD_BUY})</div>
      {embargo && <div class="hint warn">Embargo: in diesem Zug keine Käufe.</div>}
      <div class="decks">
        {COMMANDER_TYPES.map((d) => {
          const ok = commanderInPlay(s, me.id, d);
          const n = counts[d] ?? 0;
          return (
            <div key={d} class={`deck ${ok ? '' : 'locked'}`}>
              <b>{COMMANDER_NAMES[d]}</b>
              <span class="hint">{view.deckCounts[d]} übrig</span>
              {ok ? <Stepper value={n} min={0} max={Math.min(view.deckCounts[d], n + MAX_CARD_BUY - total, n + me.energy - total)} onChange={(v) => setCounts({ ...counts, [d]: v })} /> : <span class="hint">gesperrt</span>}
            </div>
          );
        })}
      </div>
      <div class="hint">Alle Karten werden in einem Vorgang gekauft und danach aufgedeckt.</div>
      <div class="btnrow">
        <Btn kind="ghost" onClick={onSkip}>Überspringen</Btn>
        <Btn kind="ok" disabled={!total || busy || embargo} onClick={() => onBuy(Object.entries(counts).flatMap(([d, n]) => Array(n).fill(d)))}>Kaufen ({total} E)</Btn>
      </div>
    </div>
  );
}

function OccupyBox({ from, to, view, busy, onGo, onCancel }: { from: string; to: string; view: GameView; busy: boolean; onGo: (m: UnitMove) => void; onCancel: () => void }) {
  const t = view.territories[from];
  const [move, setMove] = useState<UnitMove>({ mods: Math.min(t.mods, Math.max(1, Math.floor(units(t) / 2))), commanders: [] });
  return (
    <div class="box">
      <div class="title">{TDEF[from].name} → {TDEF[to].name} (unbesetzt)</div>
      <div class="hint">Besetzen ohne Würfeln – zählt als Invasion.</div>
      <UnitPicker t={t} value={move} onChange={setMove} min={1} />
      <div class="btnrow"><Btn kind="ghost" onClick={onCancel}>Zurück</Btn><Btn kind="ok" disabled={busy || move.mods + move.commanders.length < 1} onClick={() => onGo(move)}>Besetzen</Btn></div>
    </div>
  );
}

function FortifyBox({ from, to, view, busy, onGo, onCancel }: { from: string; to: string; view: GameView; busy: boolean; onGo: (m: UnitMove) => void; onCancel: () => void }) {
  const t = view.territories[from];
  const [move, setMove] = useState<UnitMove>({ mods: Math.max(0, t.mods - (t.commanders.length ? 0 : 1)), commanders: [] });
  return (
    <div class="box">
      <div class="title">Verlegen: {TDEF[from].name} → {TDEF[to].name}</div>
      <UnitPicker t={t} value={move} onChange={setMove} min={1} />
      <div class="btnrow"><Btn kind="ghost" onClick={onCancel}>Zurück</Btn><Btn kind="ok" disabled={busy || move.mods + move.commanders.length < 1} onClick={() => onGo(move)}>Verlegen</Btn></div>
    </div>
  );
}

function DiceRow({ battle }: { battle?: { data?: Record<string, unknown> } }) {
  const rolls = (battle?.data?.rolls as { att: number[]; def: number[]; attSides: number[]; defSides: number[] }[] | undefined) ?? [];
  const last = rolls.at(-1);
  if (!last) return null;
  return (
    <div class="dicerow">
      {last.att.map((v, i) => <span key={`a${i}`} class={`die att d${last.attSides[i]}`}>{v}</span>)}
      <span class="vs">vs.</span>
      {last.def.map((v, i) => <span key={`d${i}`} class={`die def d${last.defSides[i]}`}>{v}</span>)}
      {rolls.length > 1 && <span class="hint">({rolls.length} Würfe)</span>}
    </div>
  );
}

function AttackBox({ view, s, me, players, busy, battle, onAttack, onRetreat, onCard }: {
  view: GameView; s: GameState; me: Player; players: Record<string, Player>; busy: boolean; battle?: { data?: Record<string, unknown> };
  onAttack: (dice: number, blitz: boolean) => void; onRetreat: () => void; onCard: (c: string) => void;
}) {
  const i = view.invasion!;
  const max = maxAttackDice(s, i);
  const [dice, setDice] = useState(max);
  const a = Math.min(dice, max);
  const from = view.territories[i.from];
  const to = view.territories[i.to];
  const defDice = Math.min(2, units(to));
  const plan = a > 0 ? planDice(s, i, a, defDice) : null;
  const a8 = plan?.attSides.filter((x) => x === 8).length ?? 0;
  const d8 = plan?.defSides.filter((x) => x === 8).length ?? 0;
  const pBlitz = conquestProbability(units(from), units(to), a8, d8, 2);
  const angCards = me.hand.filter((c) => cardStatus(view, s, me, c).ok && CARD[cardType(c)].timing === 'ANG');
  return (
    <div class="box">
      <div class="title">{TDEF[i.from].name} ({units(from)}) → {TDEF[i.to].name} ({units(to)}, {players[to.owner ?? '']?.name ?? '–'})</div>
      {i.mods.played.length > 0 && <div class="hint warn">Gespielte Karten: {i.mods.played.map((id) => CARD[id].name).join(', ')}</div>}
      <DiceRow battle={battle} />
      {plan && (
        <div class="dicepreview">
          {plan.attSides.map((sd, k) => <span key={k} class={`die att d${sd}`}>W{sd}</span>)}
          <span class="vs">vs.</span>
          {plan.defSides.map((sd, k) => <span key={k} class={`die def d${sd}`}>W{sd}</span>)}
        </div>
      )}
      <div class="row">Würfel: <Stepper value={a} min={1} max={Math.max(1, max)} onChange={setDice} /></div>
      <div class="hint ok">P(Eroberung per Blitz, Stopp bei 2 Einheiten) ≈ {(pBlitz * 100).toFixed(0)} %</div>
      {i.rolls === 0 && angCards.length > 0 && (
        <div class="btnrow wrap">{angCards.map((c) => <Btn key={c} small kind="warn" onClick={() => onCard(c)}>{CARD[cardType(c)].name} ({CARD[cardType(c)].powerUp} E)</Btn>)}</div>
      )}
      <div class="btnrow">
        <Btn kind="danger" disabled={busy || max < 1} onClick={() => onAttack(a, false)}>Würfeln</Btn>
        <Btn kind="primary" disabled={busy || max < 1} onClick={() => onAttack(max, true)}>Blitz</Btn>
        <Btn kind="ghost" disabled={busy || (i.rolls === 0 && max > 0)} onClick={onRetreat}>Abbrechen</Btn>
      </div>
    </div>
  );
}

function AdvanceBox({ from, to, t, min, must, busy, battle, onGo }: { from: string; to: string; t: GameView['territories'][string]; min: number; must: CommanderType[]; busy: boolean; battle?: { data?: Record<string, unknown> }; onGo: (m: UnitMove) => void }) {
  const maxMove = units(t) - 1;
  const [move, setMove] = useState<UnitMove>(() => {
    const cmds = must.slice(0, maxMove);
    return { mods: Math.min(t.mods, Math.max(min - cmds.length, maxMove - cmds.length)), commanders: cmds };
  });
  return (
    <div class="box ok">
      <div class="title">{TDEF[to].name} erobert! Einheiten nachziehen</div>
      <DiceRow battle={battle} />
      <div class="hint">Mindestens {min} (Würfel des letzten Wurfs); Kommandanten mit W8 müssen mit.</div>
      <UnitPicker t={t} value={move} onChange={setMove} min={min} mustCmd={must} />
      <Btn kind="ok" disabled={busy || move.mods + move.commanders.length < min} onClick={() => onGo(move)}>Nachziehen von {TDEF[from].name}</Btn>
    </div>
  );
}

function EndCards({ view, s, me, onPlay }: { view: GameView; s: GameState; me: Player; onPlay: (c: string) => void }) {
  const cards = me.hand.filter((c) => CARD[cardType(c)].timing === 'ENDE');
  if (!cards.length) return null;
  return (
    <div class="btnrow wrap">
      {cards.map((c) => {
        const st = cardStatus(view, s, me, c);
        return <Btn key={c} small kind="warn" disabled={!st.ok} title={st.reason} onClick={() => onPlay(c)}>{CARD[cardType(c)].name}</Btn>;
      })}
    </div>
  );
}

function GameOver({ view, players }: { view: GameView; players: Record<string, Player> }) {
  const [check, setCheck] = useState<string>('');
  useEffect(() => {
    if (!view.revealedSeed || !crypto.subtle) return;
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(view.revealedSeed)).then((buf) => {
      const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
      setCheck(hex === view.seedCommitment ? '✔ Würfel-Seed stimmt mit dem Commitment vom Spielstart überein.' : '✖ Seed passt nicht zum Commitment!');
    });
  }, [view.revealedSeed]);
  return (
    <div class="box">
      <div class="title">🏆 Neue Weltführung: {view.winner?.map((w) => players[w]?.name).join(' & ')}</div>
      <table class="scores">
        <thead><tr><th>#</th><th>Spieler</th><th>Gebiete</th><th>Boni</th><th>Karten</th><th>Summe</th></tr></thead>
        <tbody>
          {view.scores?.map((l) => (
            <tr key={l.player}><td>{l.rank}</td><td><Dot color={players[l.player]?.color} /> {players[l.player]?.name}</td><td>{l.territories}</td><td>{l.regions}</td><td>{l.cards}</td><td><b>{l.total}</b></td></tr>
          ))}
        </tbody>
      </table>
      {view.revealedSeed && <div class="hint">Seed: <code>{view.revealedSeed}</code><br />{check}</div>}
    </div>
  );
}

export { COLOR_NAMES };
