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
  const wrap = board === 'planet';
  const ids = board === 'planet' ? PLANET_IDS : MOON_IDS;
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 360, h: 300 });
  // Kamera: Mittelpunkt (Brett-Einheiten) und Maßstab (Brett-Einheiten pro Pixel)
  const [cam, setCam] = useState<{ cx: number; cy: number; sc: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ sx: number; sy: number; moved: boolean; cam0: { cx: number; cy: number; sc: number }; dist?: number; mid?: { x: number; y: number } } | null>(null);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitScale = Math.max(W / size.w, H / size.h);           // alles sichtbar
  const heightScale = wrap ? H / size.h : fitScale;             // Planet: volle Höhe, horizontal scrollen
  const minScale = Math.min(heightScale, fitScale) / 5;         // max. 5x hineinzoomen
  const maxScale = wrap ? Math.max(heightScale, W / size.w) : fitScale;

  const clamp = (c: { cx: number; cy: number; sc: number }) => {
    const sc = Math.max(minScale, Math.min(maxScale, c.sc));
    const vw = size.w * sc, vh = size.h * sc;
    let cx = c.cx, cy = c.cy;
    if (wrap) cx = ((cx % W) + W) % W;
    else cx = vw >= W ? W / 2 : Math.min(W - vw / 2, Math.max(vw / 2, cx));
    cy = vh >= H ? H / 2 : Math.min(H - vh / 2, Math.max(vh / 2, cy));
    return { cx, cy, sc };
  };

  // Startansicht: Planet auf volle Höhe, zentriert auf eigene Gebiete
  useEffect(() => {
    const mine = ids.filter((id) => view.territories[id].owner && view.territories[id].owner === view.me);
    let cx = W / 2;
    if (wrap && mine.length) {
      // Kreismittel der x-Koordinaten (wegen Umlauf)
      let sx = 0, cy2 = 0;
      for (const id of mine) { const a = (GEO.territories[id].label[0] / W) * 2 * Math.PI; sx += Math.sin(a); cy2 += Math.cos(a); }
      cx = ((Math.atan2(sx, cy2) / (2 * Math.PI)) * W + W) % W;
    }
    setCam(clamp({ cx, cy: H / 2, sc: heightScale }));
  }, [board, size.w, size.h]);

  const c = cam ? clamp(cam) : clamp({ cx: W / 2, cy: H / 2, sc: heightScale });
  const vw = size.w * c.sc, vh = size.h * c.sc;
  const vx = c.cx - vw / 2, vy = c.cy - vh / 2;

  const onPointerDown = (e: PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) gesture.current = { sx: e.clientX, sy: e.clientY, moved: false, cam0: c };
    else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { sx: 0, sy: 0, moved: true, cam0: c, dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    }
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    if (pointers.current.size === 1) {
      const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
      if (Math.hypot(dx, dy) > 8) g.moved = true;
      if (g.moved) setCam(clamp({ cx: g.cam0.cx - dx * g.cam0.sc, cy: g.cam0.cy - dy * g.cam0.sc, sc: g.cam0.sc }));
    } else if (pointers.current.size === 2 && g.dist && g.mid) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAt(g.cam0, g.cam0.sc * (g.dist / d), g.mid.x, g.mid.y);
    }
  };
  const zoomAt = (base: { cx: number; cy: number; sc: number }, sc: number, px: number, py: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const ox = px - rect.left - rect.width / 2, oy = py - rect.top - rect.height / 2;
    const bx = base.cx + ox * base.sc, by = base.cy + oy * base.sc;
    const nsc = Math.max(minScale, Math.min(maxScale, sc));
    setCam(clamp({ cx: bx - ox * nsc, cy: by - oy * nsc, sc: nsc }));
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
    zoomAt(c, c.sc * (e.deltaY < 0 ? 1 / 1.2 : 1.2), e.clientX, e.clientY);
  };

  const players = useMemo(() => Object.fromEntries(view.players.map((p) => [p.id, p])), [view.players]);
  const showNames = c.sc <= heightScale / 1.6;
  const offsets = wrap ? [-W, 0, W].filter((dx) => dx + W > vx && dx < vx + vw) : [0];

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
    const r = Math.min(34, Math.max(10, 12 * c.sc));
    return (
      <g key={`b-${id}-${dx}`} data-tid={id} class="badge">
        {showNames && <text x={x} y={ly - r - 6} class="tname" font-size={Math.min(20, 12 * c.sc)}>{TDEF[id].name}</text>}
        {t.devastated && <text x={x} y={ly + 5} class="devast" font-size={r}>✕</text>}
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
        {TDEF[id].landingSite && <text x={x} y={ly + r + 16} class="landing" font-size={Math.min(30, 11 * c.sc)}>▼ Landeplatz</text>}
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
      viewBox={`${vx} ${vy} ${vw} ${vh}`}
      preserveAspectRatio="none"
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
      <rect x={vx - 10} y={vy - 10} width={vw + 20} height={vh + 20} fill={board === 'planet' ? '#173456' : 'url(#moonGlow)'} />
      <g>
        {offsets.map((dx) => renderTerritories(dx))}
        {offsets.map((dx) => Object.entries(GEO.regions)
          .filter(([r]) => (board === 'planet') === !['HOC', 'TEN', 'POL'].includes(r))
          .map(([r, d]) => <path key={`${r}-${dx}`} d={d} transform={dx ? `translate(${dx},0)` : undefined} fill="none" stroke="#050a14" stroke-width={4.5} stroke-opacity={0.9} pointer-events="none" />))}
        {board === 'planet' && offsets.flatMap((dx) => GEO.seaLanes.map(([a, b, p1, p2]) => (
          <line key={a + b + dx} transform={`translate(${dx},0)`} x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]} stroke="#fff" stroke-width={3} stroke-dasharray="10 8" stroke-opacity={0.7} pointer-events="none" />
        )))}
        {offsets.map((dx) => renderBadges(dx))}
      </g>

    </svg>
  );
}
