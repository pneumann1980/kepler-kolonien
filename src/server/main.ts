// Kepler-Kolonien Server – Einstiegspunkt
import { createServer } from 'node:http';
import { config, logInfo } from './config.ts';
import { backup } from './db.ts';
import { handleHttp } from './http.ts';
import { attachWs } from './ws.ts';
import * as games from './games.ts';
import { notify } from './push.ts';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  console.error('Node.js >= 22.18 erforderlich (TypeScript-Type-Stripping, node:sqlite).');
  process.exit(1);
}

games.setNotifier(notify);
const server = createServer((req, res) => { void handleHttp(req, res); });
server.requestTimeout = 30_000;
attachWs(server);

server.listen(config.port, config.host, () => {
  logInfo('Kepler-Kolonien gestartet', { port: config.port, dataDir: config.dataDir, publicUrl: config.publicUrl || '(nicht gesetzt)' });
  games.resumeAll();
});

setInterval(() => games.checkDeadlines(), 60_000).unref();
setInterval(() => { const f = backup('daily'); if (f) logInfo('Backup erstellt', { file: f }); }, 24 * 3600_000).unref();

function shutdown(sig: string): void {
  logInfo('Beende Server', { sig });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
