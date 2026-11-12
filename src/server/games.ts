// Partien: Lobby, Start, Befehle, Persistenz, Bots, Fristen/Bot-Vertretung, Benachrichtigungen
import { randomBytes, createHash } from 'node:crypto';
import { db } from './db.ts';
import { config, logError, logInfo } from './config.ts';
import type { User } from './auth.ts';
import {
  createGame, applyCommand, botCommand, pendingActors, project, PLAYER_COLORS, GameError,
} from '../engine/index.ts';
import type { Command, GameState, ProjectedState, SetupMode } from '../engine/index.ts';

export interface GameOptions { setupMode: SetupMode; deadlineHours: number }
export interface SeatRow { game_id: string; player_id: string; user_id: number | null; name: string; color: string; seat: number; is_bot: number; rank: number | null; score: number | null }
interface GameRow {
  id: string; name: string; status: 'lobby' | 'running' | 'finished'; host_user: number; max_players: number;
  options_json: string; seed: string | null; commitment: string | null; state_json: string | null; version: number;
  deadline_at: number | null; winners_json: string | null; created_at: number; updated_at: number;
}

export class HttpError extends Error {
  status: number;
  constructor(msg: string, status = 400) { super(msg); this.status = status; }
}

const BOT_NAMES = ['Ada', 'Turing', 'Hopper', 'Lovelace', 'Noether', 'Curie', 'Tesla', 'Meitner'];
const cache = new Map<string, GameState>();
type Listener = (gameId: string) => void;
const listeners = new Set<Listener>();
export function onGameChange(l: Listener): void { listeners.add(l); }
function emit(gameId: string): void { for (const l of listeners) try { l(gameId); } catch (e) { logError('listener', { e: String(e) }); } }

type Notifier = (userId: number, title: string, body: string, gameId: string) => void;
let notifier: Notifier = () => {};
export function setNotifier(n: Notifier): void { notifier = n; }
let isUserConnected: (userId: number, gameId: string) => boolean = () => false;
export function setPresenceCheck(f: typeof isUserConnected): void { isUserConnected = f; }

function row(id: string): GameRow {
  const r = db.prepare('SELECT * FROM games WHERE id = ?').get(id) as GameRow | undefined;
  if (!r) throw new HttpError('Partie nicht gefunden', 404);
  return r;
}
export function seats(id: string): SeatRow[] {
  return db.prepare('SELECT * FROM game_players WHERE game_id = ? ORDER BY seat').all(id) as unknown as SeatRow[];
}
function stateOf(id: string): GameState {
  let s = cache.get(id);
  if (!s) {
    const r = row(id);
    if (!r.state_json) throw new HttpError('Partie noch nicht gestartet', 409);
    s = JSON.parse(r.state_json) as GameState;
    cache.set(id, s);
  }
  return s;
}

// ------------------------------------------------------------------ Lobby
export function listGames(user: User) {
  const rows = db.prepare(`SELECT * FROM games WHERE status != 'finished'
      OR id IN (SELECT game_id FROM game_players WHERE user_id = ?) ORDER BY updated_at DESC LIMIT 100`).all(user.id) as unknown as GameRow[];
  return rows.map((r) => summary(r, user));
}

function summary(r: GameRow, user: User) {
  const ss = seats(r.id);
  const s = r.status !== 'lobby' ? (cache.get(r.id) ?? (r.state_json ? JSON.parse(r.state_json) as GameState : null)) : null;
  const mine = ss.find((x) => x.user_id === user.id);
  const pending = s ? pendingActors(s) : [];
  return {
    id: r.id, name: r.name, status: r.status, maxPlayers: r.max_players, options: JSON.parse(r.options_json),
    host: r.host_user === user.id, createdAt: r.created_at, updatedAt: r.updated_at, deadlineAt: r.deadline_at,
    seats: ss.map((x) => ({ playerId: x.player_id, name: x.name, color: x.color, isBot: Boolean(x.is_bot), isMe: x.user_id === user.id, rank: x.rank, score: x.score })),
    joined: Boolean(mine), myTurn: Boolean(mine && pending.includes(mine.player_id)),
    year: s?.year ?? 0, phase: s?.phase ?? 'lobby',
    winners: r.winners_json ? JSON.parse(r.winners_json) : null,
  };
}

export function gameSummary(id: string, user: User) { return summary(row(id), user); }

export function createLobby(user: User, body: { name?: string; maxPlayers?: number; bots?: number; setupMode?: string; deadlineHours?: number }) {
  const active = (db.prepare(`SELECT COUNT(*) AS n FROM games WHERE status != 'finished'`).get() as { n: number }).n;
  if (active >= config.maxActiveGames) throw new HttpError('Maximale Anzahl aktiver Partien erreicht', 429);
  const name = String(body.name ?? '').trim().slice(0, 40) || `Partie von ${user.name}`;
  const maxPlayers = Math.max(2, Math.min(5, Number(body.maxPlayers) || 4));
  const options: GameOptions = {
    setupMode: body.setupMode === 'classic' ? 'classic' : 'quick',
    deadlineHours: Math.max(0, Math.min(168, Number(body.deadlineHours ?? config.defaultDeadlineHours))),
  };
  const id = randomBytes(6).toString('base64url');
  const now = Date.now();
  db.prepare('INSERT INTO games (id, name, status, host_user, max_players, options_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, name, 'lobby', user.id, maxPlayers, JSON.stringify(options), now, now);
  join(user, id);
  const bots = Math.max(0, Math.min(maxPlayers - 1, Number(body.bots) || 0));
  for (let i = 0; i < bots; i++) addBot(user, id);
  logInfo('Partie angelegt', { id, user: user.name });
  return gameSummary(id, user);
}

function freeColor(ss: SeatRow[], preferred?: string | null): string {
  const used = new Set(ss.map((x) => x.color));
  if (preferred && PLAYER_COLORS.includes(preferred) && !used.has(preferred)) return preferred;
  return PLAYER_COLORS.find((c) => !used.has(c))!;
}

export function join(user: User, id: string) {
  const r = row(id);
  if (r.status !== 'lobby') throw new HttpError('Partie läuft bereits', 409);
  const ss = seats(id);
  if (ss.some((x) => x.user_id === user.id)) return gameSummary(id, user);
  if (ss.length >= r.max_players) throw new HttpError('Partie ist voll', 409);
  const seat = ss.length ? Math.max(...ss.map((x) => x.seat)) + 1 : 0;
  db.prepare('INSERT INTO game_players (game_id, player_id, user_id, name, color, seat) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, `u${user.id}`, user.id, user.name, freeColor(ss, user.color), seat);
  touch(id);
  return gameSummary(id, user);
}

export function addBot(user: User, id: string) {
  const r = row(id);
  if (r.host_user !== user.id && !user.is_admin) throw new HttpError('Nur der Host kann Bots hinzufügen', 403);
  if (r.status !== 'lobby') throw new HttpError('Partie läuft bereits', 409);
  const ss = seats(id);
  if (ss.length >= r.max_players) throw new HttpError('Partie ist voll', 409);
  const used = new Set(ss.map((x) => x.name));
  const name = `Bot ${BOT_NAMES.find((n) => !used.has(`Bot ${n}`)) ?? ss.length}`;
  const seat = ss.length ? Math.max(...ss.map((x) => x.seat)) + 1 : 0;
  db.prepare('INSERT INTO game_players (game_id, player_id, user_id, name, color, seat, is_bot) VALUES (?, ?, NULL, ?, ?, ?, 1)')
    .run(id, `b${seat}`, name, freeColor(ss), seat);
  touch(id);
  return gameSummary(id, user);
}

export function leave(user: User, id: string, playerId?: string) {
  const r = row(id);
  if (r.status !== 'lobby') throw new HttpError('Laufende Partien können nicht verlassen werden (Kontrolle an Bot abgeben möglich)', 409);
  const target = playerId ?? `u${user.id}`;
  if (target !== `u${user.id}` && r.host_user !== user.id) throw new HttpError('Nur der Host kann Plätze entfernen', 403);
  db.prepare('DELETE FROM game_players WHERE game_id = ? AND player_id = ?').run(id, target);
  if (!seats(id).some((x) => !x.is_bot)) db.prepare('DELETE FROM games WHERE id = ?').run(id);
  else touch(id);
  return { ok: true };
}

export function deleteGame(user: User, id: string) {
  const r = row(id);
  if (r.host_user !== user.id && !user.is_admin) throw new HttpError('Nur Host oder Admin', 403);
  if (r.status === 'running' && !user.is_admin) throw new HttpError('Laufende Partien kann nur ein Admin löschen', 403);
  db.prepare('DELETE FROM games WHERE id = ?').run(id);
  cache.delete(id);
  emit(id);
  return { ok: true };
}

export function start(user: User, id: string) {
  const r = row(id);
  if (r.host_user !== user.id) throw new HttpError('Nur der Host kann starten', 403);
  if (r.status !== 'lobby') throw new HttpError('Partie läuft bereits', 409);
  const ss = seats(id);
  if (ss.length < 2) throw new HttpError('Mindestens 2 Spieler (Bots zählen mit)', 409);
  const opts = JSON.parse(r.options_json) as GameOptions;
  const seed = randomBytes(16).toString('hex');
  const commitment = createHash('sha256').update(seed).digest('hex');
  const s = createGame({
    players: ss.map((x) => ({ id: x.player_id, name: x.name, color: x.color, isBot: Boolean(x.is_bot) })),
    seedHex: seed, commitment, config: { setupMode: opts.setupMode },
  });
  db.prepare('UPDATE games SET status = ?, seed = ?, commitment = ?, state_json = ?, version = ?, updated_at = ? WHERE id = ?')
    .run('running', seed, commitment, JSON.stringify(s), s.version, Date.now(), id);
  cache.set(id, s);
  afterChange(id, [], s);
  logInfo('Partie gestartet', { id, players: ss.length });
  return gameSummary(id, user);
}

function touch(id: string): void {
  db.prepare('UPDATE games SET updated_at = ? WHERE id = ?').run(Date.now(), id);
  emit(id);
}

// ------------------------------------------------------------------ Spielzustand / Befehle
export function viewFor(user: User | null, id: string): ProjectedState & { gameId: string; gameName: string; deadlineAt: number | null; options: GameOptions } {
  const r = row(id);
  const s = stateOf(id);
  const me = user ? seats(id).find((x) => x.user_id === user.id)?.player_id ?? null : null;
  const v = project(s, me);
  if (s.phase === 'gameOver') v.revealedSeed = r.seed ?? undefined;
  return { ...v, gameId: id, gameName: r.name, deadlineAt: r.deadline_at, options: JSON.parse(r.options_json) };
}

export function playerIdFor(user: User, id: string): string {
  const seat = seats(id).find((x) => x.user_id === user.id);
  if (!seat) throw new HttpError('Du spielst in dieser Partie nicht mit', 403);
  return seat.player_id;
}

export function command(user: User, id: string, cmd: Command, expectedVersion?: number): number {
  const r = row(id);
  if (r.status !== 'running') throw new HttpError('Partie läuft nicht', 409);
  const pid = playerIdFor(user, id);
  const s = stateOf(id);
  if (expectedVersion !== undefined && expectedVersion !== s.version && !['SetAutoReact', 'SetDefendMax'].includes(cmd?.t)) {
    throw new HttpError('Spielstand hat sich geändert – bitte neu laden', 409);
  }
  return apply(id, pid, cmd, false);
}

function apply(id: string, pid: string, cmd: Command, byBot: boolean): number {
  if (!cmd || typeof cmd !== 'object' || typeof cmd.t !== 'string') throw new HttpError('Ungültiger Befehl');
  const before = stateOf(id);
  let after: GameState;
  try {
    after = applyCommand(before, pid, cmd);
  } catch (e) {
    if (e instanceof GameError) throw new HttpError(e.message, 422);
    throw e;
  }
  cache.set(id, after);
  const now = Date.now();
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO commands (game_id, seq, player_id, cmd_json, by_bot, ts) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, after.version, pid, JSON.stringify(cmd), byBot ? 1 : 0, now);
    db.prepare('UPDATE games SET state_json = ?, version = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(after), after.version, now, id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    cache.set(id, before);
    throw e;
  }
  afterChange(id, pendingActors(before), after);
  return after.version;
}

function afterChange(id: string, prevPending: string[], s: GameState): void {
  const pending = pendingActors(s);
  const r = row(id);
  const opts = JSON.parse(r.options_json) as GameOptions;
  if (s.phase === 'gameOver') {
    finish(id, s);
  } else {
    const changed = pending.join(',') !== prevPending.join(',');
    if (changed) {
      const deadline = opts.deadlineHours > 0 ? Date.now() + opts.deadlineHours * 3600_000 : null;
      db.prepare('UPDATE games SET deadline_at = ? WHERE id = ?').run(deadline, id);
      const ss = seats(id);
      for (const pid of pending) {
        if (prevPending.includes(pid)) continue;
        const seat = ss.find((x) => x.player_id === pid);
        const pl = s.players.find((p) => p.id === pid);
        if (seat?.user_id && !pl?.isBot && !isUserConnected(seat.user_id, id)) {
          const what = s.phase === 'bid' ? 'Gebot abgeben' : s.phase === 'pickSlot' ? 'Zugplatz wählen' : s.phase === 'turn' ? 'Du bist am Zug' : 'Aufstellung';
          notifier(seat.user_id, r.name, `${what} (Jahr ${Math.max(1, s.year)})`, id);
        }
      }
    }
  }
  emit(id);
  scheduleBots(id);
}

function finish(id: string, s: GameState): void {
  const r = row(id);
  if (r.status === 'finished') return;
  db.prepare('UPDATE games SET status = ?, winners_json = ?, deadline_at = NULL WHERE id = ?').run('finished', JSON.stringify(s.winner ?? []), id);
  for (const l of s.scores ?? []) {
    db.prepare('UPDATE game_players SET rank = ?, score = ? WHERE game_id = ? AND player_id = ?').run(l.rank, l.total, id, l.player);
  }
  for (const seat of seats(id)) {
    if (seat.user_id) notifier(seat.user_id, r.name, 'Partie beendet – Ergebnis ansehen', id);
  }
  logInfo('Partie beendet', { id, winners: s.winner });
}

// ------------------------------------------------------------------ Bots und Fristen
const botTimers = new Map<string, NodeJS.Timeout>();
const botBudget = new Map<string, number>();

function scheduleBots(id: string, delay = config.botDelayMs): void {
  if (botTimers.has(id)) return;
  const t = setTimeout(() => { botTimers.delete(id); runBotStep(id); }, delay);
  botTimers.set(id, t);
}

function runBotStep(id: string): void {
  let s: GameState;
  try { s = stateOf(id); } catch { return; }
  if (s.phase === 'gameOver') return;
  const bots = s.players.filter((p) => p.isBot && !p.eliminated && !p.isNeutral);
  for (const b of bots) {
    let cmd: Command | null = null;
    try { cmd = botCommand(s, b.id); } catch (e) { logError('Bot-Fehler', { id, bot: b.id, e: String(e) }); }
    if (!cmd) continue;
    const key = `${id}:${s.year}:${s.turnIndex}:${b.id}`;
    const used = (botBudget.get(key) ?? 0) + 1;
    botBudget.set(key, used);
    if (used > 400) cmd = s.turn?.player === b.id ? { t: 'EndTurn' } : cmd;
    try {
      apply(id, b.id, cmd, true);
    } catch (e) {
      logError('Bot-Befehl abgelehnt', { id, bot: b.id, cmd: cmd.t, e: String((e as Error).message) });
      // Notausgang: Zug beenden, damit die Partie nicht hängt
      if (s.turn?.player === b.id) { try { apply(id, b.id, { t: 'EndTurn' }, true); } catch { /* */ } }
    }
    return; // ein Befehl pro Schritt; afterChange plant den nächsten
  }
}

/** Fristablauf: Bot-Vertretung für säumige Spieler */
export function checkDeadlines(): void {
  const due = db.prepare(`SELECT id FROM games WHERE status = 'running' AND deadline_at IS NOT NULL AND deadline_at < ?`).all(Date.now()) as { id: string }[];
  for (const { id } of due) {
    try {
      let s = stateOf(id);
      const humans = pendingActors(s).filter((pid) => !s.players.find((p) => p.id === pid)?.isBot);
      for (const pid of humans) {
        logInfo('Bot-Vertretung', { id, pid });
        let guard = 0;
        while (pendingActors(s).includes(pid) && guard++ < 400) {
          const cmd = botCommand(s, pid) ?? (s.turn?.player === pid ? { t: 'EndTurn' } as Command : null);
          if (!cmd) break;
          try { apply(id, pid, cmd, true); } catch { if (s.turn?.player === pid) apply(id, pid, { t: 'EndTurn' }, true); else break; }
          s = stateOf(id);
        }
      }
    } catch (e) {
      logError('Fristprüfung', { id, e: String(e) });
    }
  }
}

/** Beim Serverstart: laufende Partien fortsetzen (Bots anstoßen) */
export function resumeAll(): void {
  const rows = db.prepare(`SELECT id FROM games WHERE status = 'running'`).all() as { id: string }[];
  for (const { id } of rows) scheduleBots(id, 2000);
  logInfo('Laufende Partien geladen', { count: rows.length });
}

export function setAway(user: User, id: string) {
  return command(user, id, { t: 'Resign' });
}

// ------------------------------------------------------------------ Nur für Tests (ENABLE_TEST_API=1)
export function testGetState(id: string): GameState {
  return stateOf(id);
}
export function testSetState(id: string, state: GameState): void {
  if (!state || typeof state !== 'object' || !state.territories || !state.players) throw new HttpError('Ungültiger Zustand');
  const before = stateOf(id);
  state.version = before.version + 1;
  cache.set(id, state);
  db.prepare('UPDATE games SET state_json = ?, version = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(state), state.version, Date.now(), id);
  afterChange(id, pendingActors(before), state);
}
