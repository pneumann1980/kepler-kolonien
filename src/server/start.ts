// Container-Einstieg: als root gestartet -> /data an PUID:PGID übergeben und Rechte abgeben, dann Server laden.
import { chownSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dataDir = resolve(process.env.DATA_DIR ?? './data');
if (typeof process.getuid === 'function' && process.getuid() === 0) {
  const uid = Number(process.env.PUID ?? 99);
  const gid = Number(process.env.PGID ?? 100);
  mkdirSync(dataDir, { recursive: true });
  const walk = (p: string) => {
    const st = statSync(p);
    if (st.uid !== uid || st.gid !== gid) chownSync(p, uid, gid);
    if (st.isDirectory()) for (const f of readdirSync(p)) walk(join(p, f));
  };
  walk(dataDir);
  process.setgid!(gid);
  process.setuid!(uid);
}
await import('./main.ts');
