// Profile und Sitzungen: scrypt-Passwörter, zufällige Session-Tokens (gespeichert als SHA-256)
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { db } from './db.ts';
import { config } from './config.ts';

export interface User { id: number; name: string; color: string | null; is_admin: number; created_at: number }

const NAME_RE = /^[\p{L}\p{N} _.-]{3,24}$/u;

export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, saltHex, hashHex] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const hash = scryptSync(pw, Buffer.from(saltHex, 'hex'), 32, { N: 16384, r: 8, p: 1 });
  const expected = Buffer.from(hashHex, 'hex');
  return expected.length === hash.length && timingSafeEqual(expected, hash);
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export class AuthError extends Error {
  status: number;
  constructor(msg: string, status = 400) { super(msg); this.status = status; }
}

export function register(name: string, password: string, code?: string): User {
  name = String(name ?? '').trim();
  if (!config.registrationOpen) throw new AuthError('Registrierung ist deaktiviert', 403);
  if (config.registrationCode && code !== config.registrationCode) throw new AuthError('Einladungscode falsch', 403);
  if (!NAME_RE.test(name)) throw new AuthError('Name: 3–24 Zeichen (Buchstaben, Ziffern, Leerzeichen, _ . -)');
  if (typeof password !== 'string' || password.length < 6 || password.length > 200) throw new AuthError('Passwort: mindestens 6 Zeichen');
  if (db.prepare('SELECT 1 FROM users WHERE name = ?').get(name)) throw new AuthError('Name ist bereits vergeben', 409);
  const count = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  const info = db.prepare('INSERT INTO users (name, pass_hash, is_admin, created_at) VALUES (?, ?, ?, ?)')
    .run(name, hashPassword(password), count === 0 ? 1 : 0, Date.now());
  return getUser(Number(info.lastInsertRowid))!;
}

export function login(name: string, password: string): User {
  const row = db.prepare('SELECT * FROM users WHERE name = ?').get(String(name ?? '').trim()) as (User & { pass_hash: string }) | undefined;
  if (!row || !verifyPassword(String(password ?? ''), row.pass_hash)) throw new AuthError('Name oder Passwort falsch', 401);
  return getUser(row.id)!;
}

export function changePassword(userId: number, oldPw: string, newPw: string): void {
  const row = db.prepare('SELECT pass_hash FROM users WHERE id = ?').get(userId) as { pass_hash: string };
  if (!verifyPassword(oldPw, row.pass_hash)) throw new AuthError('Altes Passwort falsch', 401);
  if (typeof newPw !== 'string' || newPw.length < 6) throw new AuthError('Passwort: mindestens 6 Zeichen');
  db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(newPw), userId);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function getUser(id: number): User | null {
  return (db.prepare('SELECT id, name, color, is_admin, created_at FROM users WHERE id = ?').get(id) as User | undefined) ?? null;
}

export function createSession(userId: number): string {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_seen) VALUES (?, ?, ?, ?)').run(sha(token), userId, now, now);
  return token;
}

export function destroySession(token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
}

const SESSION_MAX_AGE = 180 * 86400_000;

export function userFromToken(token: string | null | undefined): User | null {
  if (!token) return null;
  const row = db.prepare('SELECT user_id, last_seen FROM sessions WHERE token_hash = ?').get(sha(token)) as { user_id: number; last_seen: number } | undefined;
  if (!row || Date.now() - row.last_seen > SESSION_MAX_AGE) return null;
  if (Date.now() - row.last_seen > 3600_000) db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(Date.now(), sha(token));
  return getUser(row.user_id);
}

export const COOKIE = 'kk_session';

export function tokenFromRequest(req: IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  const cookie = req.headers.cookie ?? '';
  for (const part of cookie.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function sessionCookie(token: string, secure: boolean, clear = false): string {
  const attrs = [`${COOKIE}=${clear ? '' : encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${clear ? 0 : SESSION_MAX_AGE / 1000}`];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

export function userStats(userId: number) {
  const rows = db.prepare(`SELECT g.status, gp.rank, gp.score FROM game_players gp JOIN games g ON g.id = gp.game_id WHERE gp.user_id = ?`).all(userId) as { status: string; rank: number | null; score: number | null }[];
  const finished = rows.filter((r) => r.status === 'finished');
  return {
    played: finished.length,
    won: finished.filter((r) => r.rank === 1).length,
    running: rows.filter((r) => r.status === 'running').length,
    avgScore: finished.length ? Math.round((finished.reduce((n, r) => n + (r.score ?? 0), 0) / finished.length) * 10) / 10 : 0,
  };
}
