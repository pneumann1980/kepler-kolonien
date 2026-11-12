import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 8210),
  host: env.HOST ?? '0.0.0.0',
  dataDir: resolve(env.DATA_DIR ?? './data'),
  publicDir: resolve(env.PUBLIC_DIR ?? './dist/public'),
  publicUrl: (env.PUBLIC_URL ?? '').replace(/\/$/, ''),
  adminPassword: env.ADMIN_PASSWORD ?? '',
  /** false | true (X-Forwarded-For) | cloudflare (CF-Connecting-IP) */
  trustProxy: (env.TRUST_PROXY ?? 'false').toLowerCase(),
  registrationCode: env.REGISTRATION_CODE ?? '',
  registrationOpen: (env.REGISTRATION_OPEN ?? 'true').toLowerCase() !== 'false',
  defaultDeadlineHours: Number(env.TURN_DEADLINE_HOURS ?? 24),
  botDelayMs: Number(env.BOT_DELAY_MS ?? 700),
  maxActiveGames: Number(env.MAX_ACTIVE_GAMES ?? 30),
  vapidSubject: env.VAPID_SUBJECT ?? 'mailto:admin@localhost',
  backupRetentionDays: Number(env.BACKUP_RETENTION_DAYS ?? 14),
  logLevel: env.LOG_LEVEL ?? 'info',
};

mkdirSync(config.dataDir, { recursive: true });

export function logInfo(msg: string, extra?: Record<string, unknown>): void {
  if (config.logLevel === 'silent') return;
  console.log(JSON.stringify({ t: new Date().toISOString(), level: 'info', msg, ...extra }));
}
export function logError(msg: string, extra?: Record<string, unknown>): void {
  console.error(JSON.stringify({ t: new Date().toISOString(), level: 'error', msg, ...extra }));
}
