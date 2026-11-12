import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';

const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
let proc: ChildProcess;
let dataDir: string;

async function api(path: string, opts: { method?: string; body?: unknown; token?: string } = {}) {
  const res = await fetch(BASE + path, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json: json as Record<string, any> };
}

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'kk-test-'));
  proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server/main.ts'], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: dataDir, BOT_DELAY_MS: '1', LOG_LEVEL: 'silent', ADMIN_PASSWORD: 'adm' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(BASE + '/healthz')).ok) return; } catch { /* */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Server startet nicht');
});

after(() => {
  proc?.kill('SIGTERM');
  rmSync(dataDir, { recursive: true, force: true });
});

test('Profil, Lobby, Start, WebSocket und Partie bis zur Wertung', async () => {
  const a = await api('/api/auth/register', { body: { name: 'Alice', password: 'geheim1' } });
  assert.equal(a.status, 200);
  assert.ok(a.json.user.isAdmin, 'erster Nutzer ist Admin');
  const b = await api('/api/auth/register', { body: { name: 'Bob', password: 'geheim2' } });
  assert.equal(b.status, 200);
  assert.equal((await api('/api/auth/register', { body: { name: 'alice', password: 'xxxxxx' } })).status, 409);
  assert.equal((await api('/api/auth/login', { body: { name: 'Alice', password: 'falsch' } })).status, 401);
  const ta = a.json.token as string;
  const tb = b.json.token as string;

  const g = await api('/api/games', { token: ta, body: { name: 'Testpartie', maxPlayers: 3, bots: 1, deadlineHours: 0 } });
  assert.equal(g.status, 200);
  const id = g.json.game.id as string;
  assert.equal(g.json.game.seats.length, 2);
  assert.equal((await api(`/api/games/${id}/start`, { token: tb, body: {} })).status, 403);
  assert.equal((await api(`/api/games/${id}/join`, { token: tb, body: {} })).status, 200);
  const started = await api(`/api/games/${id}/start`, { token: ta, body: {} });
  assert.equal(started.status, 200);
  assert.equal(started.json.game.status, 'running');

  // WebSocket-Abo liefert projizierten Zustand ohne fremde Handkarten
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { Authorization: `Bearer ${tb}` } });
  const firstState = await new Promise<any>((resolve, reject) => {
    ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.type === 'state') resolve(m.state); });
    ws.on('open', () => ws.send(JSON.stringify({ type: 'subscribe', gameId: id })));
    ws.on('error', reject);
  });
  assert.equal(firstState.me, `u${(b.json.user.id)}`);
  assert.ok(!('rng' in firstState));

  // Ungültiger Befehl wird abgelehnt
  const bad = await api(`/api/games/${id}/command`, { token: ta, body: { cmd: { t: 'EndTurn' } } });
  assert.equal(bad.status, 422);

  // Beide Menschen geben an Bots ab -> Partie läuft bis zum Ende
  assert.equal((await api(`/api/games/${id}/command`, { token: ta, body: { cmd: { t: 'Resign' } } })).status, 200);
  assert.equal((await api(`/api/games/${id}/command`, { token: tb, body: { cmd: { t: 'Resign' } } })).status, 200);
  let status = '';
  for (let i = 0; i < 600 && status !== 'finished'; i++) {
    await new Promise((r) => setTimeout(r, 100));
    status = (await api(`/api/games/${id}`, { token: ta })).json.game.status;
  }
  assert.equal(status, 'finished');
  const st = await api(`/api/games/${id}/state`, { token: ta });
  assert.equal(st.json.state.phase, 'gameOver');
  assert.ok(st.json.state.revealedSeed, 'Seed wird nach Spielende offengelegt');
  const me = await api('/api/me', { token: ta });
  assert.equal(me.json.user.stats.played, 1);
  ws.close();
});

test('Statische PWA-Auslieferung und Healthcheck', async () => {
  const res = await fetch(BASE + '/healthz');
  assert.equal(await res.text(), 'ok');
  const unauth = await api('/api/games');
  assert.equal(unauth.status, 401);
});
