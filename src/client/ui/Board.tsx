// Interaktives Spielbrett (SVG, Darstellung v2): Gesamtansicht, Pinch-Zoom, Verschieben, Tippen, Ost-West-Umlauf,
// Regionsfarben + Beschriftungen, Landpassagen/Wasserrouten, Trefferflächen für Wasserfelder, Landeplätze.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import geometry from '../../../content/board/geometry.json' with { type: 'json' };
import { TDEF, RDEF, REGION_MEMBERS, COMMANDER_SHORT, MAP_ID_V2, units } from '../../engine/index.ts';
import type { GameView } from '../api.ts';

type Pt = [number, number];
export type Route = { a: string; b: string; kind: 'strait' | 'coast' | 'water' | 'colony'; pts: [Pt, Pt]; pts2?: [Pt, Pt]; wrap?: boolean; rev?: number; label?: string };
type Geo = {
  boards: { planet: { width: number; height: number }; moon: { width: number; height: number; radius: number; cx: number; cy: number } };
  territories: Record<string, { d: string; label: Pt; hit?: string; marker?: Pt }>;
  regions: Record<string, { outline: string; color: string; label: Pt; labelMode: string }>;
  routes: Route[];
  borders: [string, string][];
  landShadow: string;
  landingShort: Record<string, string>;
};
export const GEO = geometry as unknown as Geo;
const PLANET_IDS = Object.keys(GEO.territories).filter((id) => TDEF[id].board === 'planet');
const MOON_IDS = Object.keys(GEO.territories).filter((id) => TDEF[id].board === 'moon');
const PLANET_REGIONS = Object.keys(GEO.regions).filter((r) => RDEF[r].kind !== 'lunarColony');
const MOON_REGIONS = Object.keys(GEO.regions).filter((r) => RDEF[r].kind === 'lunarColony');

/** Routen, die in einer Partie gelten (Landroute über den Rand nur in Kartenrevision 2) */
export function routesFor(mapId: string): Route[] {
  return GEO.routes.filter((r) => !r.rev || (r.rev === 2 && mapId === MAP_ID_V2));
}

export interface BoardProps {
  view: GameView;
  board: 'planet' | 'moon';
  selected?: string | null;
  focus?: string | null;          // Gebiet, dessen Routen hervorgehoben werden
  targets?: Set<string>;
  overlay?: Record<string, number>;
  flash?: string[];
  onTap?: (id: string) => void;
}

type Cam = { cx: number; cy: number; sc: number };
const camMemory: Record<string, Cam> = {}; // Kamera je Partie/Brett bleibt bei neuen Serverständen erhalten

function shade(hex: string, f: number): string {
  const h = hex.replace('#', '');
  const v = [0, 2, 4].map((i) => Math.max(0, Math.min(255, Math.round(parseInt(h.slice(i, i + 2), 16) * f))));
  return `#${v.map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}
const TINT: Record<string, number> = Object.fromEntries(Object.keys(GEO.territories).map((id, k) => [id, 1 + 0.06 * ((k * 7) % 5 - 2)]));

export function Board({ view, board, selected, focus, targets, overlay, flash, onTap }: BoardProps) {
  const dims = board === 'planet' ? GEO.boards.planet : GEO.boards.moon;
  const W = dims.width, H = dims.height;
  const wrap = board === 'planet';
  const ids = board === 'planet' ? PLANET_IDS : MOON_IDS;
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 360, h: 300 });
  const memKey = `${view.gameId}:${board}`;
  const [cam, setCamState] = useState<Cam | null>(camMemory[memKey] ?? null);
  const setCam = (c: Cam) => { camMemory[memKey] = c; setCamState(c); };
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ sx: number; sy: number; moved: boolean; cam0: Cam; dist?: number; mid?: { x: number; y: number } } | null>(null);

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
  useEffect(() => { setCamState(camMemory[memKey] ?? null); }, [memKey]);

  const fitScale = Math.max(W / size.w, H / size.h);     // Gesamtansicht
  const minScale = Math.min(H / size.h, fitScale) / 4.5;  // stärkster Zoom
  const maxScale = fitScale;

  const clamp = (c: Cam): Cam => {
    const sc = Math.max(minScale, Math.min(maxScale, c.sc));
    const vw = size.w * sc, vh = size.h * sc;
    let cx = c.cx, cy = c.cy;
    // Spielraum über den Rand, damit Randgebiete nicht unter den Bedienelementen liegen
    const pad = 70 * sc;
    if (wrap) cx = vw >= W ? W / 2 : ((cx % W) + W) % W;
    else cx = vw >= W + 2 * pad ? W / 2 : Math.min(W + pad - vw / 2, Math.max(vw / 2 - pad, cx));
    cy = vh >= H + 2 * pad ? H / 2 : Math.min(H + pad - vh / 2, Math.max(vh / 2 - pad, cy));
    return { cx, cy, sc };
  };
  const overview = (): Cam => ({ cx: W / 2, cy: H / 2, sc: fitScale });
  const c = clamp(cam ?? overview());
  const vw = size.w * c.sc, vh = size.h * c.sc;
  const vx = c.cx - vw / 2, vy = c.cy - vh / 2;
  const isOverview = Math.abs(c.sc - fitScale) < fitScale * 0.02;

  const zoomAt = (base: Cam, sc: number, px: number, py: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const ox = px - rect.left - rect.width / 2, oy = py - rect.top - rect.height / 2;
    const bx = base.cx + ox * base.sc, by = base.cy + oy * base.sc;
    const nsc = Math.max(minScale, Math.min(maxScale, sc));
    setCam(clamp({ cx: bx - ox * nsc, cy: by - oy * nsc, sc: nsc }));
  };
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
      zoomAt(g.cam0, g.cam0.sc * (g.dist / Math.hypot(a.x - b.x, a.y - b.y)), g.mid.x, g.mid.y);
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
    zoomAt(c, c.sc * (e.deltaY < 0 ? 1 / 1.25 : 1.25), e.clientX, e.clientY);
  };
  const zoomButton = (f: number) => { const r = svgRef.current!.getBoundingClientRect(); zoomAt(c, c.sc * f, r.left + r.width / 2, r.top + r.height / 2); };

  const players = useMemo(() => Object.fromEntries(view.players.map((p) => [p.id, p])), [view.players]);
  const routes = useMemo(() => routesFor(view.mapId), [view.mapId]);
  const offsets = wrap ? [-W, 0, W].filter((dx) => dx + W > vx - 5 && dx < vx + vw + 5) : [0];
  const px = (n: number) => n * c.sc;                                   // Bildschirm-Pixel -> Brett-Einheiten
  const narrow = size.w < 520;
  const showNames = c.sc <= Math.min(1.7, fitScale / 2.2);
  const r = Math.min(30, Math.max(9, px(narrow ? 7.5 : 8.5)));          // Einheitenmarker
  const focusRoutes = focus ? routes.filter((rt) => rt.a === focus || rt.b === focus) : [];

  const seg = (rt: Route, k: string, style: Record<string, string | number>, dx: number) => [rt.pts, ...(rt.pts2 ? [rt.pts2] : [])].map((p, i) => (
    <line key={`${k}-${i}-${dx}`} x1={p[0][0] + dx} y1={p[0][1]} x2={p[1][0] + dx} y2={p[1][1]} {...style} pointer-events="none" />
  ));
  const routeStyle = (kind: Route['kind'], hi: boolean): Record<string, string | number> => {
    const w = (n: number) => Math.max(n, px(n / 2.6));
    switch (kind) {
      case 'strait': return { stroke: hi ? '#fff3b0' : '#f3e6b8', 'stroke-width': w(hi ? 7 : 5), 'stroke-dasharray': `${w(2)} ${w(8)}`, 'stroke-linecap': 'round' };
      case 'colony': return { stroke: '#e6fbff', 'stroke-width': w(hi ? 9 : 7), 'stroke-linecap': 'round', 'stroke-opacity': 0.9 };
      case 'water': return { stroke: hi ? '#7ff0ff' : '#9fe3ff', 'stroke-width': w(hi ? 4 : 2), 'stroke-dasharray': `${w(10)} ${w(6)}`, 'stroke-opacity': hi ? 1 : 0.32 };
      case 'coast': return { stroke: hi ? '#7ff0ff' : '#9fe3ff', 'stroke-width': w(hi ? 4 : 1.5), 'stroke-dasharray': `${w(5)} ${w(6)}`, 'stroke-opacity': hi ? 1 : 0.16 };
    }
  };
  // Küstenzugänge in der Übersicht: kurzer Stummel am Wasserfeld + Anker an der Küste
  const coastStub = (rt: Route, dx: number) => {
    const water = TDEF[rt.a].type === 'water' ? rt.a : rt.b;
    const segs = [rt.pts, ...(rt.pts2 ? [rt.pts2] : [])];
    const [p1, p2] = rt.a === water ? segs[0] : [segs[segs.length - 1][1], segs[segs.length - 1][0]];
    const L = Math.max(1, Math.hypot(p2[0] - p1[0], p2[1] - p1[1]));
    const k = Math.min(1, 30 / L);
    const coast = rt.a === water ? segs[segs.length - 1][1] : segs[0][0];
    return (
      <g key={`st-${rt.a}-${rt.b}-${dx}`} pointer-events="none">
        <line x1={p1[0] + dx} y1={p1[1]} x2={p1[0] + (p2[0] - p1[0]) * k + dx} y2={p1[1] + (p2[1] - p1[1]) * k} stroke="#bdefff" stroke-width={3} stroke-linecap="round" />
        <circle cx={coast[0] + dx} cy={coast[1]} r={Math.max(4, px(2.6))} fill="#bdefff" stroke="#0b2540" stroke-width={1.5} />
      </g>
    );
  };

  const renderTerritory = (id: string, dx: number) => {
    const t = view.territories[id];
    const def = TDEF[id];
    const g = GEO.territories[id];
    const owner = t.owner ? players[t.owner] : null;
    const base = shade(GEO.regions[def.region].color, TINT[id]);
    const tr = dx ? `translate(${dx},0)` : undefined;
    const isTarget = targets?.has(id);
    return (
      <g key={`${id}@${dx}`} data-tid={id} data-copy={dx} transform={tr} class={`terr t-${def.type}`}>
        {def.type === 'water' ? (
          <>
            <path d={g.d} fill="#123a63" stroke={GEO.regions[def.region].color} stroke-width={7} />
            <path d={g.d} fill="none" stroke="#e8fbff" stroke-width={1.5} />
          </>
        ) : <path d={g.d} fill={base} stroke="#0b1322" stroke-width={1.6} stroke-linejoin="round" />}
        {owner && <path d={g.d} fill={def.type === 'water' ? owner.color : 'none'} fill-opacity={def.type === 'water' ? 0.35 : 1} stroke={owner.color} stroke-width={def.type === 'water' ? 16 : 12} clip-path={`url(#clip-${id})`} stroke-opacity={0.95} />}
        {t.devastated && <path d={g.d} fill="url(#hatch)" />}
        {isTarget && <path d={g.d} fill="#fde047" fill-opacity={0.22} stroke="#fde047" stroke-width={Math.max(4, px(2.2))} stroke-dasharray={`${px(6)} ${px(4)}`} class="pulse" />}
        {selected === id && <path d={g.d} fill="#ffffff" fill-opacity={0.16} stroke="#ffffff" stroke-width={Math.max(5, px(2.6))} />}
        {flash?.includes(id) && <path d={g.d} fill="#ef4444" fill-opacity={0.35} class="flash" />}
      </g>
    );
  };

  const renderBadge = (id: string, dx: number) => {
    const t = view.territories[id];
    const g = GEO.territories[id];
    const [lx, ly] = g.label;
    const x = lx + dx;
    const owner = t.owner ? players[t.owner] : null;
    const n = units(t);
    const extra = overlay?.[id] ?? 0;
    return (
      <g key={`b-${id}@${dx}`} data-tid={id} data-copy={dx} class="badge">
        <circle cx={x} cy={ly} r={r * 0.9} class="anchor" fill="#000" fill-opacity={0.001} />
        {showNames && <text x={x} y={ly - r - px(4)} class="tname" font-size={px(10.5)} stroke-width={px(2.5)}>{TDEF[id].name}</text>}
        {t.devastated && <text x={x} y={ly + r * 0.4} class="devast" font-size={r * 1.2}>✕</text>}
        {owner && (n > 0 || t.station) && (
          <>
            <circle cx={x} cy={ly} r={r} fill={owner.color} stroke="#fff" stroke-width={Math.max(2, r * 0.14)} />
            <text x={x} y={ly + r * 0.37} class="count" font-size={r * 1.05}>{n}</text>
          </>
        )}
        {t.commanders.map((cm, i) => (
          <g key={cm}>
            <rect x={x + r * 0.62 + i * r * 1.02} y={ly - r * 1.72} width={r * 0.98} height={r * 0.95} rx={r * 0.2} fill="#0b1322" stroke="#fff" stroke-width={Math.max(1, r * 0.08)} />
            <text x={x + r * 1.11 + i * r * 1.02} y={ly - r * 1.0} class="cmd" font-size={r * 0.74}>{COMMANDER_SHORT[cm]}</text>
          </g>
        ))}
        {t.station && (
          <polygon points={`${x - r * 1.7},${ly - r * 0.9} ${x - r * 1.15},${ly - r * 1.55} ${x - r * 0.6},${ly - r * 0.9} ${x - r * 1.15},${ly - r * 0.25}`} fill="#22d3ee" stroke="#fff" stroke-width={Math.max(1, r * 0.08)} />
        )}
        {extra > 0 && (
          <g>
            <rect x={x - r * 1.1} y={ly + r * 1.1} width={r * 2.2} height={r * 1.2} rx={r * 0.6} fill="#22c55e" stroke="#fff" stroke-width={Math.max(1, r * 0.08)} />
            <text x={x} y={ly + r * 1.98} class="plus" font-size={r * 0.85}>+{extra}</text>
          </g>
        )}
      </g>
    );
  };

  const renderRegionLabel = (rid: string, dx: number) => {
    const reg = GEO.regions[rid];
    const def = RDEF[rid];
    const big = def.kind === 'continent' || def.kind === 'lunarColony';
    const fpx = narrow ? (big ? 11.5 : 9.5) : big ? 14 : 11.5;
    const fs = px(fpx);
    const text = `${def.name} +${def.bonus}`;
    const w = fs * (text.length * 0.58) + fs * 1.1;
    const [x, y] = reg.label;
    const mine = view.me ? REGION_MEMBERS[rid].filter((id) => view.territories[id].owner === view.me).length : 0;
    const total = REGION_MEMBERS[rid].filter((id) => !view.territories[id].devastated).length;
    return (
      <g key={`rl-${rid}@${dx}`} class="rlabel" pointer-events="none" transform={dx ? `translate(${dx},0)` : undefined}>
        <rect x={x - w / 2} y={y - fs * 0.85} width={w} height={fs * 1.7} rx={fs * 0.85} fill="#0b1220" fill-opacity={0.82} stroke={reg.color} stroke-width={Math.max(1.5, px(1.4))} />
        <text x={x} y={y + fs * 0.36} font-size={fs} fill={reg.color} font-weight={800} text-anchor="middle">{text}</text>
        {view.me && mine > 0 && (
          <text x={x} y={y + fs * 1.75} font-size={fs * 0.72} fill="#e8eef7" text-anchor="middle" font-weight={700} paint-order="stroke" stroke="#0b1220" stroke-width={fs * 0.25}>
            {mine}/{total}{mine === total ? ' ✓' : ''}
          </text>
        )}
      </g>
    );
  };

  const renderLanding = (id: string) => {
    const g = GEO.territories[id];
    if (!g.marker) return null;
    const [mx, my] = g.marker;
    const rr = Math.min(26, Math.max(10, px(9)));
    return (
      <g key={`lm-${id}`} data-tid={id} class="landing-marker">
        <circle cx={mx} cy={my} r={rr} fill="#fde047" stroke="#141824" stroke-width={rr * 0.15} />
        <path d={`M${mx - rr * 0.45},${my - rr * 0.3} L${mx},${my + rr * 0.42} L${mx + rr * 0.45},${my - rr * 0.3} Z`} fill="#141824" />
        <text x={mx} y={my + rr * 2.05} class="landing" font-size={rr * 0.95} stroke-width={rr * 0.3}>{GEO.landingShort[id]}</text>
      </g>
    );
  };

  const regions = board === 'planet' ? PLANET_REGIONS : MOON_REGIONS;
  const [legend, setLegend] = useState(false);
  const legendRows = (kind: string) => Object.values(RDEF).filter((r) => r.kind === kind).map((r) => {
    const members = REGION_MEMBERS[r.id].filter((x) => !view.territories[x].devastated);
    const mine = view.me ? members.filter((x) => view.territories[x].owner === view.me).length : 0;
    return (
      <div class="lg-row" key={r.id}>
        <i style={{ background: GEO.regions[r.id].color }} />
        <span>{r.name}</span>
        <b>+{r.bonus}</b>
        <span class="hint">{members.length} {view.me ? `· du ${mine}` : ''}</span>
      </div>
    );
  });
  return (
    <div class="boardbox">
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
          <radialGradient id="seaGrad" cx="50%" cy="45%" r="75%"><stop offset="0" stop-color="#1d4f80" /><stop offset="1" stop-color="#0f2c4d" /></radialGradient>
          <radialGradient id="space" cx="50%" cy="45%" r="70%"><stop offset="0" stop-color="#1b2540" /><stop offset="1" stop-color="#070b14" /></radialGradient>
          {ids.map((id) => <clipPath key={`c-${id}`} id={`clip-${id}`}><path d={GEO.territories[id].d} /></clipPath>)}
        </defs>
        {board === 'planet' ? (
          <>
            <rect x={vx - 10} y={vy - 10} width={vw + 20} height={vh + 20} fill="#0f2c4d" />
            {offsets.map((dx) => (
              <g key={`sea-${dx}`} transform={dx ? `translate(${dx},0)` : undefined} pointer-events="none">
                <rect x={0} y={0} width={W} height={H} fill="url(#seaGrad)" />
                {[200, 400, 600, 800].map((y) => <line key={y} x1={0} y1={y} x2={W} y2={y} stroke="#fff" stroke-opacity={0.04} />)}
                <path d={GEO.landShadow} fill="#2d6a95" fill-opacity={0.5} />
              </g>
            ))}
            {offsets.map((dx) => routes.filter((rt) => rt.kind === 'coast' || rt.kind === 'water').map((rt) => seg(rt, `r-${rt.a}-${rt.b}`, routeStyle(rt.kind, false), dx)))}
            {offsets.map((dx) => regions.filter((rid) => RDEF[rid].kind === 'waterColony').map((rid) => (
              <path key={`halo-${rid}@${dx}`} d={GEO.regions[rid].outline} transform={dx ? `translate(${dx},0)` : undefined} fill={GEO.regions[rid].color} fill-opacity={0.12} stroke={GEO.regions[rid].color} stroke-opacity={0.55} stroke-width={2} stroke-dasharray="4 5" pointer-events="none" />
            )))}
            {offsets.map((dx) => routes.filter((rt) => rt.kind === 'coast').map((rt) => coastStub(rt, dx)))}
          </>
        ) : (
          <>
            <rect x={vx - 10} y={vy - 10} width={vw + 20} height={vh + 20} fill="url(#space)" />
            <circle cx={GEO.boards.moon.cx} cy={GEO.boards.moon.cy} r={GEO.boards.moon.radius + 14} fill="#1a2236" />
          </>
        )}
        {offsets.map((dx) => ids.map((id) => renderTerritory(id, dx)))}
        {offsets.map((dx) => regions.filter((rid) => RDEF[rid].kind !== 'waterColony').map((rid) => (
          <path key={`ol-${rid}@${dx}`} d={GEO.regions[rid].outline} transform={dx ? `translate(${dx},0)` : undefined} fill="none" stroke="#050a14" stroke-width={board === 'moon' ? 6 : 4.5} stroke-linejoin="round" pointer-events="none" />
        )))}
        {board === 'planet' && offsets.map((dx) => routes.filter((rt) => rt.kind === 'strait' || rt.kind === 'colony').map((rt) => seg(rt, `s-${rt.a}-${rt.b}`, routeStyle(rt.kind, false), dx)))}
        {board === 'planet' && offsets.map((dx) => focusRoutes.map((rt) => seg(rt, `f-${rt.a}-${rt.b}`, routeStyle(rt.kind, true), dx)))}
        {board === 'planet' && offsets.map((dx) => ids.filter((id) => GEO.territories[id].hit).map((id) => (
          <path key={`hit-${id}@${dx}`} d={GEO.territories[id].hit} transform={dx ? `translate(${dx},0)` : undefined} data-tid={id} data-copy={dx} class="hit" fill="#000" fill-opacity={0.001} />
        )))}
        {offsets.map((dx) => ids.map((id) => renderBadge(id, dx)))}
        {board === 'moon' && MOON_IDS.filter((id) => TDEF[id].landingSite).map(renderLanding)}
        {offsets.map((dx) => regions.map((rid) => renderRegionLabel(rid, dx)))}
      </svg>
      {legend && (
        <div class="legend" onClick={() => setLegend(false)}>
          <div class="lg-title">Kontinente</div>{legendRows('continent')}
          <div class="lg-title">Unterwasserkolonien</div>{legendRows('waterColony')}
          <div class="lg-title">Mondkolonien</div>{legendRows('lunarColony')}
          <div class="lg-title">Routen</div>
          <div class="lg-row"><svg width="34" height="10"><line x1="2" y1="5" x2="32" y2="5" stroke="#f3e6b8" stroke-width="4" stroke-dasharray="2 6" stroke-linecap="round" /></svg><span>Landpassage (ohne Marine)</span></div>
          <div class="lg-row"><svg width="34" height="10"><line x1="2" y1="5" x2="32" y2="5" stroke="#9fe3ff" stroke-width="3" stroke-dasharray="6 4" /></svg><span>Küste / Seeweg (Marine-Kdt im Spiel)</span></div>
          <div class="lg-row"><svg width="34" height="10"><line x1="2" y1="5" x2="32" y2="5" stroke="#e6fbff" stroke-width="5" stroke-linecap="round" /></svg><span>innerhalb einer Unterwasserkolonie</span></div>
          <div class="lg-row"><span class="hint">Linien zum Kartenrand = Ost-West-Übergang. Gebiet antippen zeigt seine Routen.</span></div>
        </div>
      )}
      <div class="mapctl">
        <button type="button" class={legend ? 'on' : ''} onClick={() => setLegend(!legend)} aria-label="Legende">ℹ</button>
        <button type="button" onClick={() => zoomButton(1 / 1.6)} aria-label="Hineinzoomen">＋</button>
        <button type="button" onClick={() => zoomButton(1.6)} aria-label="Herauszoomen">－</button>
        <button type="button" class={isOverview ? 'on' : ''} onClick={() => setCam(overview())} aria-label="Gesamtansicht">⤢</button>
      </div>
    </div>
  );
}
