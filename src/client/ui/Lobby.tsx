// Anmeldung, Lobby (Partien anlegen/beitreten) und Profil
import { useEffect, useState } from 'preact/hooks';
import { PLAYER_COLORS, COLOR_NAMES } from '../../engine/index.ts';
import { api, enablePush, type GameSummary, type Live, type Me } from '../api.ts';
import { Btn, Dot, timeLeft } from './widgets.tsx';

export function Login({ onLogin }: { onLogin: (u: Me) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const r = await api<{ user: Me }>(`/api/auth/${mode}`, { body: { name, password, code: code || undefined } });
      onLogin(r.user);
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="screen login">
      <div class="logo"><img src="/icons/icon.svg" alt="" /><div><h1>Kepler-Kolonien</h1><p>Rundenstrategie für 2–5 Spieler · Planet, Ozeane, Mond</p></div></div>
      <form class="box" onSubmit={submit}>
        <div class="seg">
          <button type="button" class={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>Anmelden</button>
          <button type="button" class={mode === 'register' ? 'on' : ''} onClick={() => setMode('register')}>Profil anlegen</button>
        </div>
        <label>Name<input value={name} autocomplete="username" onInput={(e) => setName((e.target as HTMLInputElement).value)} required minLength={3} maxLength={24} /></label>
        <label>Passwort<input type="password" value={password} autocomplete={mode === 'login' ? 'current-password' : 'new-password'} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} required minLength={6} /></label>
        {mode === 'register' && <label>Einladungscode <span class="hint">(nur falls vom Server verlangt)</span><input value={code} onInput={(e) => setCode((e.target as HTMLInputElement).value)} /></label>}
        {err && <div class="error">{err}</div>}
        <Btn kind="ok" type="submit" disabled={busy}>{mode === 'login' ? 'Anmelden' : 'Profil anlegen'}</Btn>
      </form>
      <p class="hint center">Tipp: Über „Zum Home-Bildschirm hinzufügen“ wird das Spiel zur App (nötig für Push auf iOS).</p>
    </div>
  );
}

export function Lobby({ me, live, navigate }: { me: Me; live: Live; navigate: (p: string) => void }) {
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [err, setErr] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const load = () => api<{ games: GameSummary[] }>('/api/games').then((r) => setGames(r.games)).catch((e) => setErr(e.message));
  useEffect(() => {
    load();
    live.subscribe(null);
    const off = live.on((m) => { if (m.type === 'lobbyChanged') load(); });
    const iv = setInterval(load, 30_000);
    return () => { off(); clearInterval(iv); };
  }, []);
  const act = async (path: string, method = 'POST') => {
    setErr('');
    try { await api(path, { method, body: method === 'POST' ? {} : undefined }); await load(); } catch (e) { setErr((e as Error).message); }
  };
  const mine = games?.filter((g) => g.joined && g.status !== 'finished') ?? [];
  const open = games?.filter((g) => !g.joined && g.status === 'lobby') ?? [];
  const watch = games?.filter((g) => !g.joined && g.status === 'running') ?? [];
  const done = games?.filter((g) => g.joined && g.status === 'finished') ?? [];
  return (
    <div class="screen lobby">
      <header class="topbar">
        <img class="appicon" src="/icons/icon.svg" alt="" />
        <div class="tb-main"><div class="tb-title">Kepler-Kolonien</div><div class="tb-sub">Lobby</div></div>
        <button class="avatar" style={{ background: me.color ?? '#475569' }} onClick={() => navigate('/profile')} aria-label="Profil">{me.name[0]?.toUpperCase()}</button>
      </header>
      <main class="lobby-main">
        {err && <div class="error">{err}</div>}
        <div class="box hero">
          <div><b>Hallo {me.name}!</b> <span class="hint">{me.stats.played} Partien · {me.stats.won} Siege</span></div>
          <Btn kind="ok" onClick={() => setShowCreate(!showCreate)}>{showCreate ? 'Schließen' : '+ Neue Partie'}</Btn>
        </div>
        {showCreate && <CreateGame onCreated={() => { setShowCreate(false); load(); }} />}
        <Section title="Meine Partien" empty="Noch keine Partie – lege eine an oder tritt einer offenen bei.">
          {mine.map((g) => <GameCard key={g.id} g={g} me={me} act={act} navigate={navigate} />)}
        </Section>
        <Section title="Offene Partien" empty="Keine offenen Partien.">
          {open.map((g) => <GameCard key={g.id} g={g} me={me} act={act} navigate={navigate} />)}
        </Section>
        {watch.length > 0 && <Section title="Laufende Partien (zuschauen)">{watch.map((g) => <GameCard key={g.id} g={g} me={me} act={act} navigate={navigate} />)}</Section>}
        {done.length > 0 && <Section title="Beendet">{done.slice(0, 10).map((g) => <GameCard key={g.id} g={g} me={me} act={act} navigate={navigate} />)}</Section>}
        <Leaderboard />
      </main>
    </div>
  );
}

function Section({ title, empty, children }: { title: string; empty?: string; children: preact.ComponentChildren }) {
  const arr = Array.isArray(children) ? children : [children];
  return (
    <section class="section">
      <h2>{title}</h2>
      {arr.length === 0 && empty ? <div class="hint">{empty}</div> : children}
    </section>
  );
}

function GameCard({ g, me, act, navigate }: { g: GameSummary; me: Me; act: (p: string, m?: string) => void; navigate: (p: string) => void }) {
  const status = g.status === 'lobby' ? `Wartet auf Spieler (${g.seats.length}/${g.maxPlayers})` : g.status === 'running' ? `Jahr ${Math.max(1, g.year)} · ${g.myTurn ? 'Du bist dran!' : 'läuft'}` : 'Beendet';
  return (
    <div class={`box gamecard ${g.myTurn ? 'myturn' : ''}`}>
      <div class="gc-head">
        <b>{g.name}</b>
        <span class={`tag ${g.myTurn ? 'warn' : ''}`}>{status}</span>
      </div>
      <div class="seats">
        {g.seats.map((s) => (
          <span key={s.playerId} class="seat">
            <Dot color={s.color} /> {s.name}{s.isBot ? ' 🤖' : ''}{s.rank === 1 ? ' 🏆' : ''}
            {g.status === 'lobby' && g.host && s.isBot && <a class="x" onClick={() => act(`/api/games/${g.id}/leave`, 'POST')}> </a>}
          </span>
        ))}
      </div>
      <div class="hint">{g.options.setupMode === 'quick' ? 'Schnellaufstellung' : 'Klassische Aufstellung'} · Frist {g.options.deadlineHours ? `${g.options.deadlineHours} h` : 'keine'}{g.status === 'running' && g.deadlineAt ? ` · ${timeLeft(g.deadlineAt)}` : ''}</div>
      <div class="btnrow wrap">
        {g.status !== 'lobby' && <Btn small kind={g.myTurn ? 'warn' : 'primary'} onClick={() => navigate(`/game/${g.id}`)}>{g.joined ? 'Öffnen' : 'Zuschauen'}</Btn>}
        {g.status === 'lobby' && !g.joined && g.seats.length < g.maxPlayers && <Btn small kind="ok" onClick={() => act(`/api/games/${g.id}/join`)}>Beitreten</Btn>}
        {g.status === 'lobby' && g.host && g.seats.length < g.maxPlayers && <Btn small kind="ghost" onClick={() => act(`/api/games/${g.id}/bots`)}>+ Bot</Btn>}
        {g.status === 'lobby' && g.host && <Btn small kind="ok" disabled={g.seats.length < 2} onClick={() => act(`/api/games/${g.id}/start`)}>Starten</Btn>}
        {g.status === 'lobby' && g.joined && !g.host && <Btn small kind="ghost" onClick={() => act(`/api/games/${g.id}/leave`)}>Verlassen</Btn>}
        {g.status === 'lobby' && g.host && <Btn small kind="danger" onClick={() => confirm('Partie löschen?') && act(`/api/games/${g.id}`, 'DELETE')}>Löschen</Btn>}
        {g.status === 'running' && me.isAdmin && <Btn small kind="danger" onClick={() => confirm('Laufende Partie endgültig löschen?') && act(`/api/games/${g.id}`, 'DELETE')}>Löschen (Admin)</Btn>}
      </div>
    </div>
  );
}

function CreateGame({ onCreated }: { onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const [maxPlayers, setMax] = useState(4);
  const [bots, setBots] = useState(0);
  const [setupMode, setSetup] = useState<'quick' | 'classic'>('quick');
  const [deadline, setDeadline] = useState(24);
  const [err, setErr] = useState('');
  const submit = async () => {
    try {
      const r = await api<{ game: GameSummary }>('/api/games', { body: { name, maxPlayers, bots, setupMode, deadlineHours: deadline } });
      onCreated(r.game.id);
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div class="box form">
      <div class="title">Neue Partie</div>
      <label>Name<input value={name} placeholder="z. B. Freitagsrunde" maxLength={40} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></label>
      <label>Spieler (inkl. Bots): <b>{maxPlayers}</b><input type="range" min={2} max={5} value={maxPlayers} onInput={(e) => { const v = Number((e.target as HTMLInputElement).value); setMax(v); setBots(Math.min(bots, v - 1)); }} /></label>
      <label>Bots sofort hinzufügen: <b>{bots}</b><input type="range" min={0} max={maxPlayers - 1} value={bots} onInput={(e) => setBots(Number((e.target as HTMLInputElement).value))} /></label>
      <label>Aufstellung
        <select value={setupMode} onChange={(e) => setSetup((e.target as HTMLSelectElement).value as 'quick')}>
          <option value="quick">Schnell: Gebiete zufällig verteilt, Rest gleichzeitig platzieren (empfohlen)</option>
          <option value="classic">Klassisch: Gebiete reihum wählen (wie im Regelheft)</option>
        </select>
      </label>
      <label>Frist pro Zug (danach übernimmt ein Bot)
        <select value={String(deadline)} onChange={(e) => setDeadline(Number((e.target as HTMLSelectElement).value))}>
          {[0, 1, 6, 12, 24, 48, 72].map((h) => <option key={h} value={String(h)}>{h === 0 ? 'keine Frist (live)' : `${h} Stunden`}</option>)}
        </select>
      </label>
      {err && <div class="error">{err}</div>}
      <Btn kind="ok" onClick={submit}>Partie anlegen</Btn>
    </div>
  );
}

function Leaderboard() {
  const [rows, setRows] = useState<{ id: number; name: string; color: string | null; played: number; won: number }[]>([]);
  useEffect(() => { api<{ players: typeof rows }>('/api/leaderboard').then((r) => setRows(r.players)).catch(() => {}); }, []);
  if (!rows.length) return null;
  return (
    <section class="section">
      <h2>Rangliste</h2>
      <div class="box">
        <table class="scores">
          <thead><tr><th>Spieler</th><th>Siege</th><th>Partien</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td><Dot color={r.color ?? '#64748b'} /> {r.name}</td><td>{r.won ?? 0}</td><td>{r.played ?? 0}</td></tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}

export function Profile({ me, onChange, onLogout, navigate }: { me: Me; onChange: (u: Me) => void; onLogout: () => void; navigate: (p: string) => void }) {
  const [msg, setMsg] = useState('');
  const [oldPw, setOld] = useState('');
  const [newPw, setNew] = useState('');
  const [adminPw, setAdminPw] = useState('');
  const [history, setHistory] = useState<{ id: string; name: string; rank: number; score: number; updated_at: number }[]>([]);
  useEffect(() => { api<{ history: typeof history }>('/api/me/games').then((r) => setHistory(r.history)).catch(() => {}); }, []);
  const setColor = async (c: string | null) => { const r = await api<{ user: Me }>('/api/me', { method: 'PUT', body: { color: c } }); onChange(r.user); };
  return (
    <div class="screen lobby">
      <header class="topbar">
        <button class="back" onClick={() => navigate('/')}>‹</button>
        <div class="tb-main"><div class="tb-title">Profil</div><div class="tb-sub">{me.name}</div></div>
      </header>
      <main class="lobby-main">
        {msg && <div class="box">{msg}</div>}
        <div class="box profile">
          <div class="avatar big" style={{ background: me.color ?? '#475569' }}>{me.name[0]?.toUpperCase()}</div>
          <div>
            <div class="title">{me.name} {me.isAdmin && <span class="tag">Admin</span>}</div>
            <div class="hint">dabei seit {new Date(me.createdAt).toLocaleDateString('de-DE')}</div>
            <div class="stats"><span><b>{me.stats.played}</b> Partien</span><span><b>{me.stats.won}</b> Siege</span><span><b>{me.stats.running}</b> laufend</span><span><b>{me.stats.avgScore}</b> Ø Punkte</span></div>
          </div>
        </div>
        <div class="box">
          <div class="title">Wunschfarbe</div>
          <div class="btnrow wrap">
            {PLAYER_COLORS.map((c) => <button key={c} class={`colorpick ${me.color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} title={COLOR_NAMES[c]} />)}
            <Btn small kind="ghost" onClick={() => setColor(null)}>keine</Btn>
          </div>
        </div>
        <div class="box">
          <div class="title">Benachrichtigungen</div>
          <div class="hint">Push-Nachricht, wenn du am Zug bist (benötigt HTTPS; auf iOS die App zuerst zum Home-Bildschirm hinzufügen).</div>
          <Btn onClick={async () => { const r = await enablePush().catch((e) => String(e.message)); setMsg(r === 'ok' ? 'Push-Benachrichtigungen aktiviert.' : r); }}>Push aktivieren</Btn>
        </div>
        {history.length > 0 && (
          <div class="box">
            <div class="title">Letzte Partien</div>
            <table class="scores"><tbody>{history.map((h) => <tr key={h.id} onClick={() => navigate(`/game/${h.id}`)}><td>{h.name}</td><td>Platz {h.rank}</td><td>{h.score} P.</td></tr>)}</tbody></table>
          </div>
        )}
        <div class="box form">
          <div class="title">Passwort ändern</div>
          <label>Altes Passwort<input type="password" value={oldPw} onInput={(e) => setOld((e.target as HTMLInputElement).value)} /></label>
          <label>Neues Passwort<input type="password" value={newPw} onInput={(e) => setNew((e.target as HTMLInputElement).value)} /></label>
          <Btn onClick={async () => { try { await api('/api/me/password', { method: 'PUT', body: { oldPassword: oldPw, newPassword: newPw } }); setMsg('Passwort geändert – bitte neu anmelden.'); onLogout(); } catch (e) { setMsg((e as Error).message); } }}>Ändern</Btn>
        </div>
        {!me.isAdmin && (
          <div class="box form">
            <div class="title">Admin-Rechte</div>
            <label>Admin-Passwort des Servers<input type="password" value={adminPw} onInput={(e) => setAdminPw((e.target as HTMLInputElement).value)} /></label>
            <Btn kind="ghost" onClick={async () => { try { await api('/api/admin/promote', { body: { password: adminPw } }); const r = await api<{ user: Me }>('/api/me'); onChange(r.user); setMsg('Du bist jetzt Admin.'); } catch (e) { setMsg((e as Error).message); } }}>Freischalten</Btn>
          </div>
        )}
        <Btn kind="danger" onClick={onLogout}>Abmelden</Btn>
      </main>
    </div>
  );
}
