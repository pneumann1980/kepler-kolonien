// Web Push (VAPID). Schlüssel werden beim ersten Start erzeugt und in der DB gespeichert.
import webpush from 'web-push';
import { db, kvGet, kvSet } from './db.ts';
import { config, logError } from './config.ts';

let keys = (() => {
  const stored = kvGet('vapid');
  if (stored) return JSON.parse(stored) as { publicKey: string; privateKey: string };
  const k = webpush.generateVAPIDKeys();
  kvSet('vapid', JSON.stringify(k));
  return k;
})();
webpush.setVapidDetails(config.vapidSubject, keys.publicKey, keys.privateKey);

export function vapidPublicKey(): string {
  return keys.publicKey;
}

export function subscribe(userId: number, sub: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }): void {
  if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error('Ungültige Push-Subscription');
  db.prepare(`INSERT INTO push_subscriptions (endpoint, user_id, keys_json, created_at) VALUES (?, ?, ?, ?)
              ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, keys_json = excluded.keys_json`)
    .run(sub.endpoint, userId, JSON.stringify(sub.keys), Date.now());
}

export function unsubscribe(endpoint: string): void {
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
}

const lastSent = new Map<string, number>();

export function notify(userId: number, title: string, body: string, gameId: string): void {
  const key = `${userId}:${gameId}:${body}`;
  if (Date.now() - (lastSent.get(key) ?? 0) < 60_000) return;
  lastSent.set(key, Date.now());
  const subs = db.prepare('SELECT endpoint, keys_json FROM push_subscriptions WHERE user_id = ?').all(userId) as { endpoint: string; keys_json: string }[];
  const payload = JSON.stringify({ title: `Kepler-Kolonien · ${title}`, body, url: `/game/${gameId}`, tag: gameId });
  for (const s of subs) {
    webpush.sendNotification({ endpoint: s.endpoint, keys: JSON.parse(s.keys_json) }, payload, { TTL: 86400 })
      .catch((e: { statusCode?: number }) => {
        if (e.statusCode === 404 || e.statusCode === 410) unsubscribe(s.endpoint);
        else logError('Push fehlgeschlagen', { status: e.statusCode });
      });
  }
}

export function _resetKeysForTest(): void {
  keys = webpush.generateVAPIDKeys();
}
