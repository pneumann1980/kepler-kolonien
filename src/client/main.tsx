import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { api, Live, type Me } from './api.ts';
import { Login, Lobby, Profile } from './ui/Lobby.tsx';
import { Game } from './ui/Game.tsx';
import './styles.css';

function usePath(): [string, (p: string) => void] {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  const navigate = (p: string) => { if (p !== location.pathname) history.pushState(null, '', p); setPath(p); window.scrollTo(0, 0); };
  return [path, navigate];
}

let live: Live | null = null;

function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [path, navigate] = usePath();
  const [, force] = useState(0);
  useEffect(() => {
    api<{ user: Me }>('/api/me').then((r) => setMe(r.user)).catch(() => setMe(null));
  }, []);
  useEffect(() => {
    if (me && !live) { live = new Live(); live.onStatus = () => force((x) => x + 1); }
    if (me === null && live) { live.close(); live = null; }
  }, [me]);
  if (me === undefined) return <div class="screen center"><div class="spinner" /></div>;
  if (!me) return <Login onLogin={(u) => setMe(u)} />;
  if (!live) return <div class="screen center"><div class="spinner" /></div>;
  const logout = async () => { await api('/api/auth/logout', { body: {} }).catch(() => {}); setMe(null); navigate('/'); };
  const gm = /^\/game\/([A-Za-z0-9_-]+)/.exec(path);
  if (gm) return <Game key={gm[1]} gameId={gm[1]} live={live} me={me} navigate={navigate} />;
  if (path === '/profile') return <Profile me={me} onChange={setMe} onLogout={logout} navigate={navigate} />;
  return <Lobby me={me} live={live} navigate={navigate} />;
}

render(<App />, document.getElementById('app')!);

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
