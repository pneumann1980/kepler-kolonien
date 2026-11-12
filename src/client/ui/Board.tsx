// Interaktives Spielbrett (SVG): Pinch-Zoom, Verschieben, Tippen, Ost-West-Umlauf
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import geometry from '../../../content/board/geometry.json' with { type: 'json' };
import { TDEF, COMMANDER_SHORT, units } from '../../engine/index.ts';
import type { GameView } from '../api.ts';

type Geo = {
  boards: { planet: { width: number; height: number }; moon: { width: number; height: number; radius: number } };
  territories: Record<string, { d: string; label: [number, number] }>;
  regions: Record<string, string>;
  seaLanes: [string, string, [number, number], [number, number]][];
  wrapLinks: [string, string, number][];
};
const GEO = geometry as unknown as Geo;
const PLANET_IDS = Object.keys(GEO.territories).filter((id) => TDEF[id].board === 'planet');
const MOON_IDS = Object.keys(GEO.territories).filter((id) => TDEF[id].board === 'moon');

export interface BoardProps {
  view: GameView;
  board: 'planet' | 'moon';
  selected?: string | null;
  targets?: Set<string>;
  overlay?: Record<string, number>;
  flash?: string[];
  onTap?: (id: string) => void;
}

const baseFill = (type: string) => (type === 'water' ? '#1d4a78' : type === 'moon' ? '#8a93a3' : '#4b5563');

export function Board({ view, board, selected, targets, overlay, flash, onTap }: BoardProps) {
  const dims = board === 'planet' ? GEO.boards.planet : GEO.boards.moon;
  const W = dims.width, H = dims.height;
  const ids = board === 'planet' ? PLANET_IDS : MOON_IDS;
  const svgRef = useRef<SVGSVGElement>(null);
  const [tf, setTf] = useState({ k: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ startX: number; startY: number; moved: boolean; dist?: number; k0?: number; mid?: { x: number; y: number }; tf0?: typeof tf } | null>(null);

  useEffect(() => { setTf({ k: 1, x: 0, y: 0 }); }, [board]);

  const unitPerPx = () => {
    const el = svgRef.current;
    if (!el) return 1;
    const r = el.getBoundingClientRect();
    return 1 / Math.min(r.width / W, r.height / H);
  };
  const clampTf = (t: typeof tf) => {
    const k = Math.max(1, Math.min(6, t.k));
    let x = t.x;
    if (board === 'planet') { x = ((x % (W * k)) + W * k) % (W * k); if (x > 0) x -= W * k; if (k === 1) x = Math.round(x / W) * W; }
    else x = Math.min(0, Math.max(W - W * k, x));
    const y = Math.min(0, Math.max(H - H * k, t.y));
    return { k, x: board === 'planet' && k === 1 ? 0 : x, y };
  };

  const onPointerDown = (e: PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) gesture.current = { startX: e.clientX, startY: e.clientY, moved: false, tf0: tf };
    else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { startX: 0, startY: 0, moved: true, dist: Math.hypot(a.x - b.x, a.y - b.y), k0: tf.k, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, tf0: tf };
    }
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    const u = unitPerPx();
    if (pointers.current.size === 1 && g.tf0) {
      const dx = e.clientX - g.startX, dy = e.clientY - g.startY;
      if (Math.hypot(dx, dy) > 8) g.moved = true;
      if (g.moved) setTf(clampTf({ k: g.tf0.k, x: g.tf0.x + dx * u, y: g.tf0.y + dy * u }));
    } else if (pointers.current.size === 2 && g.dist && g.tf0 && g.mid) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const k = Math.max(1, Math.min(6, g.k0! * (d / g.dist)));
      const rect = svgRef.current!.getBoundingClientRect();
      const mx = (g.mid.x - rect.left) * u, my = (g.mid.y - rect.top) * u;
      const ratio = k / g.tf0.k;
      setTf(clampTf({ k, x: mx - (mx - g.tf0.x) * ratio, y: my - (my - g.tf0.y) * ratio }));
    }
  };
  const onPointerUp = (e: PointerEvent) => {
    const g = gesture.current;
    const wasSingle = pointers.current.size === 1;
    pointers.current.delete(e.pointerId);
    if (wasSingle && g && !g.moved && onTap) {
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-tid]');
      const id = el?.getAttribute('data-tid');
      if (id) onTap(id);
    }
    if (pointers.current.size === 0) gesture.current = null;
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const rect = svgRef.current!.getBoundingClientRect();
    const u = unitPerPx();
    const mx = (e.clientX - rect.left) * u, my = (e.clientY - rect.top) * u;
    const k = Math.max(1, Math.min(6, tf.k * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
    const ratio = k / tf.k;
    setTf(clampTf({ k, x: mx - (mx - tf.x) * ratio, y: my - (my - tf.y) * ratio }));
  };

  const players = useMemo(() => Object.fromEntries(view.players.map((p) => [p.id, p])), [view.players]);
  const showNames = tf.k >= 1.7;
  const offsets = board === 'planet' && tf.k > 1 ? [0, W] : [0];

  const renderTerritories = (dx: number) => ids.map((id) => {
    const t = view.territories[id];
    const def = TDEF[id];
    const owner = t.owner ? players[t.owner] : null;
    const isSel = selected === id;
    const isTarget = targets?.has(id);
    return (
      <g key={`${id}-${dx}`} data-tid={id} transform={dx ? `translate(${dx},0)` : undefined} class="terr">
        <path d={GEO.territories[id].d} fill={baseFill(def.type)} />
        {owner && <path d={GEO.territories[id].d} fill={owner.color} fill-opacity={def.type === 'water' ? 0.5 : 0.82} />}
        {t.devastated && <path d={GEO.territories[id].d} fill="url(#hatch)" />}
        <path d={GEO.territories[id].d} fill="none" stroke={def.type === 'water' ? '#9cc3ea' : '#0b1322'} stroke-width={def.type === 'water' ? 1.2 : 2} stroke-opacity={0.7} />
        {isTarget && <path d={GEO.territories[id].d} fill="#fde047" fill-opacity={0.18} stroke="#fde047" stroke-width={5} stroke-dasharray="14 8" class="pulse" />}
        {isSel && <path d={GEO.territories[id].d} fill="#ffffff" fill-opacity={0.15} stroke="#ffffff" stroke-width={6} />}
        {flash?.includes(id) && <path d={GEO.territories[id].d} fill="#ef4444" fill-opacity={0.35} class="flash" />}
      </g>
    );
  });

  const renderBadges = (dx: number) => ids.map((id) => {
    const t = view.territories[id];
    const [lx, ly] = GEO.territories[id].label;
    const x = lx + dx;
    const owner = t.owner ? players[t.owner] : null;
    const n = units(t);
    const extra = overlay?.[id] ?? 0;
    const r = 17 / Math.sqrt(tf.k) + 3;
    return (
      <g key={`b-${id}-${dx}`} data-tid={id} class="badge">
        {showNames && <text x={x} y={ly - r - 6} class="tname" font-size={14 / Math.sqrt(tf.k) + 4}>{TDEF[id].name}</text>}
        {t.devastated && <text x={x} y={ly + 5} class="devast" font-size={13}>✕</text>}
        {owner && (n > 0 || t.station) && (
          <>
            <circle cx={x} cy={ly} r={r} fill={owner.color} stroke="#fff" stroke-width={2.5} />
            <text x={x} y={ly + r * 0.38} class="count" font-size={r * 1.05}>{n}</text>
          </>
        )}
        {t.commanders.map((c, i) => (
          <g key={c}>
            <rect x={x + r * 0.6 + i * r * 1.05} y={ly - r * 1.75} width={r * 1.0} height={r * 0.95} rx={4} fill="#0b1322" stroke="#fff" stroke-width={1.5} />
            <text x={x + r * 1.1 + i * r * 1.05} y={ly - r * 1.0} class="cmd" font-size={r * 0.75}>{COMMANDER_SHORT[c]}</text>
          </g>
        ))}
        {t.station && (
          <polygon points={`${x - r * 1.7},${ly - r * 0.9} ${x - r * 1.15},${ly - r * 1.55} ${x - r * 0.6},${ly - r * 0.9} ${x - r * 1.15},${ly - r * 0.25}`} fill="#22d3ee" stroke="#fff" stroke-width={1.5} />
        )}
        {TDEF[id].landingSite && <text x={x} y={ly + r + 16} class="landing" font-size={13}>▼ Landeplatz</text>}
        {extra > 0 && (
          <g>
            <rect x={x - 18} y={ly + r + 2} width={36} height={20} rx={10} fill="#22c55e" stroke="#fff" stroke-width={1.5} />
            <text x={x} y={ly + r + 16} class="plus" font-size={13}>+{extra}</text>
          </g>
        )}
      </g>
    );
  });

  return (
    <svg
      ref={svgRef}
      class={`board board-${board}`}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      onPointerDown={onPointerDown as never}
      onPointerMove={onPointerMove as never}
      onPointerUp={onPointerUp as never}
      onPointerCancel={onPointerUp as never}
      onWheel={onWheel as never}
    >
      <defs>
        <pattern id="hatch" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="12" height="12" fill="#2a2f3a" />
          <line x1="0" y1="0" x2="0" y2="12" stroke="#6b7280" stroke-width="5" />
        </pattern>
        <radialGradient id="moonGlow" cx="50%" cy="45%" r="60%">
          <stop offset="0%" stop-color="#2b3550" />
          <stop offset="100%" stop-color="#0b0f19" />
        </radialGradient>
      </defs>
      <rect x={0} y={0} width={W} height={H} fill={board === 'planet' ? '#173456' : 'url(#moonGlow)'} />
      <g transform={`translate(${tf.x},${tf.y}) scale(${tf.k})`}>
        {offsets.map((dx) => renderTerritories(dx))}
        {offsets.map((dx) => Object.entries(GEO.regions)
          .filter(([r]) => (board === 'planet') === !['HOC', 'TEN', 'POL'].includes(r))
          .map(([r, d]) => <path key={`${r}-${dx}`} d={d} transform={dx ? `translate(${dx},0)` : undefined} fill="none" stroke="#050a14" stroke-width={4.5} stroke-opacity={0.9} pointer-events="none" />))}
        {board === 'planet' && GEO.seaLanes.map(([a, b, p1, p2]) => (
          <line key={a + b} x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]} stroke="#fff" stroke-width={3} stroke-dasharray="10 8" stroke-opacity={0.7} pointer-events="none" />
        ))}
        {offsets.map((dx) => renderBadges(dx))}
      </g>
      {board === 'planet' && tf.k === 1 && GEO.wrapLinks.length > 0 && (
        <g class="wrapHint" pointer-events="none">
          <text x={8} y={H - 12} font-size={22}>◀ ▶ Karte ist an Ost- und Westrand verbunden</text>
        </g>
      )}
    </svg>
  );
}
