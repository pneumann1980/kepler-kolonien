// REST- und WebSocket-Anbindung des Clients
import type { Command, ProjectedState } from '../engine/index.ts';

export interface Me {
  id: number; name: string; color: string | null; isAdmin: boolean; createdAt: number;
  stats: { played: number; won: number; running: number; avgScore: number };
}
export interface Seat { playerId: string; name: string; color: string; isBot: boolean; isMe: boolean; rank: number | null; score: number | null }
export interface GameSummary {
  id: string; name: string; status: 'lobby' | 'running' | 'finished'; maxPlayers: number;
  options: { setupMode: 'quick' | 'classic'; deadlineHours: number }; host: boolean; createdAt: number; updatedAt: number;
  deadlineAt: number | null; seats: Seat[]; joined: boolean; myTurn: boolean; year: number; phase: string; winners: string[] | null;
}
export type GameView = ProjectedState & { gameId: string; gameName: string; deadlineAt: number | null; options: GameSummary['options'] };

export class ApiError extends Error {
  status: number;
  constructor(msg: string, status: number) { super(msg); this.status = status; }
}

export async function api<T = Record<string, unknown>>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((json as { error?: string }).error ?? `Fehler ${res.status}`, res.status);
  return json as T;
}

export function sendCommand(gameId: string, cmd: Command, expectedVersion?: number) {
  return api<{ ok: boolean; version: number }>(`/api/games/${gameId}/command`, { body: { cmd, expectedVersion } });
}

// ------------------------------------------------------------------ WebSocket mit Reconnect
type Handler = (msg: { type: string; state?: GameView; [k: string]: unknown }) => void;

export class Live {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private sub: { type: 'subscribe'; gameId: string } | { type: 'lobby' } | null = null;
  private retry = 0;
  private closed = false;
  connected = false;
  onStatus: (connected: boolean) => void = () => {};

  constructor() {
    this.connect();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && (!this.ws || this.ws.readyState > 1)) this.connect();
    });
    window.addEventListener('online', () => this.connect());
  }

  private connect(): void {
    if (this.closed) return;
    if (this.ws && this.ws.readyState <= 1) return;
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.connected = true;
      this.onStatus(true);
      if (this.sub) ws.send(JSON.stringify(this.sub));
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      for (const h of this.handlers) h(msg);
    };
    ws.onclose = () => {
      this.connected = false;
      this.onStatus(false);
      if (this.closed) return;
      const delay = Math.min(15000, 500 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
  }

  on(h: Handler): () => void {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  subscribe(gameId: string | null): void {
    this.sub = gameId ? { type: 'subscribe', gameId } : { type: 'lobby' };
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(this.sub));
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
  }
}

// ------------------------------------------------------------------ Web Push
export async function enablePush(): Promise<string> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return 'Dieses Gerät/dieser Browser unterstützt keine Push-Benachrichtigungen (iOS: App zuerst zum Home-Bildschirm hinzufügen).';
  }
  if (!window.isSecureContext) return 'Push benötigt HTTPS (z. B. über den Cloudflare Tunnel).';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return 'Benachrichtigungen wurden nicht erlaubt.';
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await api<{ publicKey: string }>('/api/push/key');
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
  await api('/api/push/subscribe', { body: sub.toJSON() });
  return 'ok';
}

function urlBase64ToUint8Array(b64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
