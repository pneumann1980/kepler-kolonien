// WebSocket: Echtzeit-Synchronisation der projizierten Spielstände + Befehle
import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { userFromToken, tokenFromRequest, type User } from './auth.ts';
import * as games from './games.ts';
import { HttpError } from './games.ts';
import { logError } from './config.ts';

interface Client { ws: WebSocket; user: User; gameId: string | null; lobby: boolean; alive: boolean }
const clients = new Set<Client>();

export function attachWs(server: Server): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith('/ws')) { socket.destroy(); return; }
    const user = userFromToken(tokenFromRequest(req));
    if (!user) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const c: Client = { ws, user, gameId: null, lobby: false, alive: true };
      clients.add(c);
      ws.on('pong', () => { c.alive = true; });
      ws.on('close', () => clients.delete(c));
      ws.on('message', (raw) => onMessage(c, raw.toString()));
      ws.send(JSON.stringify({ type: 'hello', user: { id: user.id, name: user.name } }));
    });
  });
  // Herzschlag (Cloudflare trennt inaktive Verbindungen nach ~100 s)
  setInterval(() => {
    for (const c of clients) {
      if (!c.alive) { c.ws.terminate(); clients.delete(c); continue; }
      c.alive = false;
      try { c.ws.ping(); } catch { /* */ }
    }
  }, 25_000).unref();

  games.onGameChange((gameId) => {
    for (const c of clients) {
      if (c.gameId === gameId) pushState(c);
      if (c.lobby) safeSend(c, { type: 'lobbyChanged' });
    }
  });
  games.setPresenceCheck((userId, gameId) => [...clients].some((c) => c.user.id === userId && c.gameId === gameId));
}

function safeSend(c: Client, msg: unknown): void {
  if (c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(msg));
}

function pushState(c: Client): void {
  try {
    safeSend(c, { type: 'state', state: games.viewFor(c.user, c.gameId!) });
  } catch (e) {
    safeSend(c, { type: 'gone', gameId: c.gameId, error: (e as Error).message });
  }
}

function onMessage(c: Client, raw: string): void {
  let msg: { type?: string; gameId?: string; cmd?: unknown; id?: string; version?: number };
  try { msg = JSON.parse(raw); } catch { return; }
  switch (msg.type) {
    case 'subscribe':
      c.gameId = typeof msg.gameId === 'string' ? msg.gameId : null;
      c.lobby = false;
      if (c.gameId) pushState(c);
      return;
    case 'lobby':
      c.lobby = true;
      c.gameId = null;
      return;
    case 'cmd':
      if (!c.gameId) return;
      try {
        const version = games.command(c.user, c.gameId, msg.cmd as never, msg.version);
        safeSend(c, { type: 'ack', id: msg.id, version });
      } catch (e) {
        const status = e instanceof HttpError ? e.status : 500;
        if (status === 500) logError('WS-Befehl', { e: String(e) });
        safeSend(c, { type: 'error', id: msg.id, status, error: status === 500 ? 'Interner Fehler' : (e as Error).message });
        if (status === 409) pushState(c);
      }
      return;
    case 'ping':
      safeSend(c, { type: 'pong' });
      return;
  }
}
