// HTTP: REST-API und statische PWA-Auslieferung
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { config } from './config.ts';
import {
  register, login, createSession, destroySession, userFromToken, tokenFromRequest, sessionCookie, changePassword,
  userStats, AuthError, type User,
} from './auth.ts';
import { db } from './db.ts';
import * as games from './games.ts';
import { HttpError } from './games.ts';
import { vapidPublicKey, subscribe, unsubscribe } from './push.ts';
import { PLAYER_COLORS } from '../engine/index.ts';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.map': 'application/json',
};

export function clientIp(req: IncomingMessage): string {
  const mode = config.trustProxy;
  if (mode === 'cloudflare') {
    const cf = req.headers['cf-connecting-ip'];
    if (typeof cf === 'string') return cf;
  }
  if (mode === 'true' || mode === 'cloudflare') {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string') return xff.split(',')[0].trim();
  }
  return req.socket.remoteAddress ?? 'unknown';
}

function isSecure(req: IncomingMessage): boolean {
  return config.publicUrl.startsWith('https://') || req.headers['x-forwarded-proto'] === 'https';
}

// einfaches Rate-Limit pro IP und Bucket
const buckets = new Map<string, { n: number; reset: number }>();
function rateLimit(req: IncomingMessage, bucket: string, max: number, windowMs = 60_000): void {
  const key = `${bucket}:${clientIp(req)}`;
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) { buckets.set(key, { n: 1, reset: now + windowMs }); return; }
  if (++b.n > max) throw new HttpError('Zu viele Anfragen – bitte kurz warten', 429);
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k); }, 60_000).unref();

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 64 * 1024) { reject(new HttpError('Anfrage zu groß', 413)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError('Ungültiges JSON')); }
    });
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(data);
}

function publicUser(u: User) {
  return { id: u.id, name: u.name, color: u.color, isAdmin: Boolean(u.is_admin), createdAt: u.created_at, stats: userStats(u.id) };
}

function requireUser(req: IncomingMessage): User {
  const u = userFromToken(tokenFromRequest(req));
  if (!u) throw new HttpError('Bitte anmelden', 401);
  return u;
}

type Handler = (req: IncomingMessage, res: ServerResponse, params: string[], body: Record<string, unknown>) => unknown;
const routes: [string, RegExp, Handler][] = [];
const route = (method: string, path: string, h: Handler) => {
  routes.push([method, new RegExp('^' + path.replace(/:[a-z]+/g, '([A-Za-z0-9_-]+)') + '$'), h]);
};

// ---------------- Auth / Profil
route('POST', '/api/auth/register', (req, res, _p, b) => {
  rateLimit(req, 'register', 5);
  const u = register(String(b.name ?? ''), String(b.password ?? ''), b.code ? String(b.code) : undefined);
  const token = createSession(u.id);
  send(res, 200, { user: publicUser(u), token }, { 'Set-Cookie': sessionCookie(token, isSecure(req)) });
});
route('POST', '/api/auth/login', (req, res, _p, b) => {
  rateLimit(req, 'login', 10);
  const u = login(String(b.name ?? ''), String(b.password ?? ''));
  const token = createSession(u.id);
  send(res, 200, { user: publicUser(u), token }, { 'Set-Cookie': sessionCookie(token, isSecure(req)) });
});
route('POST', '/api/auth/logout', (req, res) => {
  const t = tokenFromRequest(req);
  if (t) destroySession(t);
  send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', isSecure(req), true) });
});
route('GET', '/api/me', (req) => ({ user: publicUser(requireUser(req)) }));
route('PUT', '/api/me', (req, _res, _p, b) => {
  const u = requireUser(req);
  if (b.color !== undefined) {
    if (b.color !== null && !PLAYER_COLORS.includes(String(b.color))) throw new HttpError('Unbekannte Farbe');
    db.prepare('UPDATE users SET color = ? WHERE id = ?').run(b.color === null ? null : String(b.color), u.id);
  }
  return { user: publicUser(requireUser(req)) };
});
route('PUT', '/api/me/password', (req, _res, _p, b) => {
  const u = requireUser(req);
  changePassword(u.id, String(b.oldPassword ?? ''), String(b.newPassword ?? ''));
  return { ok: true };
});
route('GET', '/api/me/games', (req) => {
  const u = requireUser(req);
  const rows = db.prepare(`SELECT g.id, g.name, g.status, g.updated_at, gp.rank, gp.score FROM game_players gp JOIN games g ON g.id = gp.game_id
     WHERE gp.user_id = ? AND g.status = 'finished' ORDER BY g.updated_at DESC LIMIT 30`).all(u.id);
  return { history: rows };
});
route('GET', '/api/leaderboard', (req) => {
  requireUser(req);
  const rows = db.prepare(`SELECT u.id, u.name, u.color,
      SUM(CASE WHEN g.status = 'finished' THEN 1 ELSE 0 END) AS played,
      SUM(CASE WHEN g.status = 'finished' AND gp.rank = 1 THEN 1 ELSE 0 END) AS won
    FROM users u LEFT JOIN game_players gp ON gp.user_id = u.id LEFT JOIN games g ON g.id = gp.game_id
    GROUP BY u.id ORDER BY won DESC, played DESC, u.name LIMIT 50`).all();
  return { players: rows };
});

// ---------------- Lobby / Partien
route('GET', '/api/games', (req) => ({ games: games.listGames(requireUser(req)) }));
route('POST', '/api/games', (req, _r, _p, b) => {
  rateLimit(req, 'create', 20);
  return { game: games.createLobby(requireUser(req), b as never) };
});
route('GET', '/api/games/:id', (req, _r, p) => ({ game: games.gameSummary(p[0], requireUser(req)) }));
route('POST', '/api/games/:id/join', (req, _r, p) => ({ game: games.join(requireUser(req), p[0]) }));
route('POST', '/api/games/:id/leave', (req, _r, p, b) => games.leave(requireUser(req), p[0], b.playerId ? String(b.playerId) : undefined));
route('POST', '/api/games/:id/bots', (req, _r, p) => ({ game: games.addBot(requireUser(req), p[0]) }));
route('POST', '/api/games/:id/start', (req, _r, p) => ({ game: games.start(requireUser(req), p[0]) }));
route('DELETE', '/api/games/:id', (req, _r, p) => games.deleteGame(requireUser(req), p[0]));
route('GET', '/api/games/:id/state', (req, _r, p) => ({ state: games.viewFor(requireUser(req), p[0]) }));
route('POST', '/api/games/:id/command', (req, _r, p, b) => {
  rateLimit(req, 'cmd', 600);
  const version = games.command(requireUser(req), p[0], b.cmd as never, b.expectedVersion as number | undefined);
  return { ok: true, version };
});

// ---------------- Push
route('GET', '/api/push/key', () => ({ publicKey: vapidPublicKey() }));
route('POST', '/api/push/subscribe', (req, _r, _p, b) => { subscribe(requireUser(req).id, b as never); return { ok: true }; });
route('POST', '/api/push/unsubscribe', (req, _r, _p, b) => { requireUser(req); unsubscribe(String(b.endpoint ?? '')); return { ok: true }; });

// ---------------- Test-API (nur mit ENABLE_TEST_API=1, niemals produktiv aktivieren)
if (process.env.ENABLE_TEST_API === '1') {
  route('GET', '/api/test/games/:id/state', (req, _r, p) => { requireUser(req); return { state: games.testGetState(p[0]) }; });
  route('POST', '/api/test/games/:id/state', (req, _r, p, b) => { requireUser(req); games.testSetState(p[0], b.state as never); return { ok: true }; });
}

// ---------------- Admin
route('POST', '/api/admin/promote', (req, _r, _p, b) => {
  rateLimit(req, 'admin', 10);
  const u = requireUser(req);
  if (!config.adminPassword || b.password !== config.adminPassword) throw new HttpError('Admin-Passwort falsch', 403);
  db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(u.id);
  return { ok: true };
});

export async function handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://x');
  const path = url.pathname;
  try {
    if (path === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return; }
    if (path.startsWith('/api/')) {
      for (const [m, re, h] of routes) {
        if (m !== req.method) continue;
        const match = re.exec(path);
        if (!match) continue;
        const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readJson(req);
        const out = await h(req, res, match.slice(1), body);
        if (!res.headersSent) send(res, 200, out ?? { ok: true });
        return;
      }
      send(res, 404, { error: 'Nicht gefunden' });
      return;
    }
    serveStatic(path, res);
  } catch (e) {
    const status = e instanceof HttpError || e instanceof AuthError ? e.status : 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) send(res, status, { error: status === 500 ? 'Interner Fehler' : (e as Error).message });
  }
}

function serveStatic(path: string, res: ServerResponse): void {
  const root = config.publicDir;
  let file = normalize(join(root, decodeURIComponent(path)));
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html'); // SPA-Fallback
  if (!existsSync(file)) { res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Client nicht gebaut (npm run build)'); return; }
  const ext = extname(file);
  const immutable = /\/assets\//.test(file);
  const headers: Record<string, string> = {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
  };
  if (ext === '.html') {
    headers['Content-Security-Policy'] = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws: wss:; manifest-src 'self'; worker-src 'self'";
    headers['X-Frame-Options'] = 'DENY';
  }
  res.writeHead(200, headers);
  createReadStream(file).pipe(res);
}
