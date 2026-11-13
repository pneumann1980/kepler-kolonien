// Interaktives Spielbrett (SVG): Gesamtansicht, Pinch-Zoom, Verschieben, Tippen, Ost-West-Umlauf,
// Regionsfarben + Beschriftungen, Routen, Trefferflächen, Landeplätze.
// Darstellung je Kartenrevision: Rev. 3 = Erde & Mond (geometry/v3), Rev. 1/2 = Kepler-Fantasiekarte (geometry/v2).
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import geometry from '../../../content/board/geometry.json' with { type: 'json' };
import legacyGeometry from '../../../content/board/legacy/kepler-colonies-geometry.json' with { type: 'json' };
import { TDEF, RDEF, REGION_MEMBERS, MAP_ID_V2, isLegacyMap, units } from '../../engine/index.ts';
import type { GameView } from '../api.ts';
import { tn, rn } from '../names.ts';
import { IcoG, Ico, CMD_COLOR } from './icons.tsx';

type Pt = [number, number];
export type Route = { a: string; b: string; kind: 'strait' | 'coast' | 'water' | 'colony'; pts: Pt[]; pts2?: Pt[]; wrap?: boolean; rev?: number; label?: string };
export type Geo = {
  schema: string;
  boards: { planet: { width: number; height: number }; moon: { width: number; height: number; radius: number; cx: number; cy: number; texture?: string } };
  territories: Record<string, { d: string; label: Pt; hit?: string; marker?: Pt }>;
  regions: Record<string, { outline: string; color: string; label: Pt; labelMode: string }>;
  routes: Route[];
  borders: [string, string][];
  landShadow: string;
  landingShort: Record<string, string>;
  graticule?: { lon: number[]; lat: number[] };
};
const GEO_EARTH = geometry as unknown as Geo;
const GEO_LEGACY = legacyGeometry as unknown as Geo;
/** Darstellung zur Kartenrevision einer Partie */
export function geoFor(mapId: string | undefined): Geo {
  return mapId && isLegacyMap(mapId) ? GEO_LEGACY : GEO_EARTH;
}
const IDS = (board: 'planet' | 'moon') => Object.keys(TDEF).filter((id) => TDEF[id].board === board);
const PLANET_IDS = IDS('planet');
const MOON_IDS = IDS('moon');
const PLANET_REGIONS = Object.keys(RDEF).filter((r) => RDEF[r].kind !== 'lunarColony');
const MOON_REGIONS = Object.keys(RDEF).filter((r) => RDEF[r].kind === 'lunarColony');

/** Routen, die in einer Partie gelten (Rev.-2-Landroute nur in Rev.-2-Partien) */
export function routesFor(mapId: string): Route[] {
  return geoFor(mapId).routes.filter((r) => !r.rev || (r.rev === 2 && mapId === MAP_ID_V2));
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
  onTapEmpty?: () => void;       // Tippen auf freie Fläche (Menü schließen)
  menu?: { id: string; node: ComponentChildren } | null;   // kleines Aktionsmenü am Gebiet
}

type Cam = { cx: number; cy: number; sc: number; fitted?: boolean };
const camMemory: Record<string, Cam> = {}; // Kamera je Partie/Brett bleibt bei neuen Serverständen erhalten

function shade(hex: string, f: number): string {
  const h = hex.replace('#', '');
  const v = [0, 2, 4].map((i) => Math.max(0, Math.min(255, Math.round(parseInt(h.slice(i, i + 2), 16) * f))));
  return `#${v.map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}
const TINT: Record<string, number> = Object.fromEntries(Object.keys(TDEF).map((id, k) => [id, 1 + 0.06 * ((k * 7) % 5 - 2)]));

export function Board({ view, board, selected, focus, targets, overlay, flash, onTap, onTapEmpty, menu }: BoardProps) {
  const GEO = geoFor(view.mapId);
  const earth = GEO.schema === 'geometry/v3';
  const dims = board === 'planet' ? GEO.boards.planet : GEO.boards.moon;
  const W = dims.width, H = dims.height;
  const wrap = board === 'planet';
  const ids = board === 'planet' ? PLANET_IDS : MOON_IDS;
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 360, h: 300 });
  const memKey = `${view.gameId}:${board}`;
  const [cam, setCamState] = useState<Cam | null>(camMemory[memKey] ?? null);
  const memKeyRef = useRef(memKey);
  memKeyRef.current = memKey;
  const setCam = (c: Cam) => { const f = { ...c, fitted: Math.abs(c.sc - fitScale) < fitScale * 0.02 }; camMemory[memKey] = f; setCamState(f); };
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [mdim, setMdim] = useState({ w: 210, h: 150 });
  // Größe des Aktionsmenüs messen, damit es im sichtbaren Brett bleibt
  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    if (Math.abs(w - mdim.w) > 1 || Math.abs(h - mdim.h) > 1) setMdim({ w, h });
  });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ sx: number; sy: number; moved: boolean; cam0: Cam; dist?: number; mid?: { x: number; y: number } } | null>(null);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        setSize({ w: r.width, h: r.height });
        // war die Gesamtansicht aktiv (z. B. vor dem Drehen des Geräts), passt sie sich der neuen Größe an
        if (camMemory[memKeyRef.current]?.fitted) { delete camMemory[memKeyRef.current]; setCamState(null); }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { setCamState(camMemory[memKey] ?? null); }, [memKey]);
  // iOS Safari zoomt sonst die ganze Seite statt der Karte
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const stop = (e: Event) => e.preventDefault();
    el.addEventListener('gesturestart', stop);
    el.addEventListener('gesturechange', stop);
    el.addEventListener('dblclick', stop);
    return () => { el.removeEventListener('gesturestart', stop); el.removeEventListener('gesturechange', stop); el.removeEventListener('dblclick', stop); };
  }, []);

  // Gesamtansicht: immer die ganze Welt; auf hohen Flächen (Tablet) läuft das Meer oben/unten einfach weiter
  const fitW = W / size.w, fitH = H / size.h;
  const fitScale = Math.max(fitW, fitH);
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
      if (id) onTap(id); else onTapEmpty?.();
    }
    if (wasSingle && g && !g.moved) {
      // Doppeltippen: hineinzoomen bzw. zurück zur Gesamtansicht
      const now = Date.now(), lt = lastTap.current;
      if (lt && now - lt.t < 320 && Math.hypot(lt.x - e.clientX, lt.y - e.clientY) < 30) {
        if (c.sc > fitScale * 0.6) zoomAt(c, c.sc / 2.2, e.clientX, e.clientY); else setCam(overview());
        lastTap.current = null;
      } else lastTap.current = { t: now, x: e.clientX, y: e.clientY };
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
  const r = Math.min(40, Math.max(11, px(narrow ? 9 : 10)));          // Einheitenmarker
  const focusRoutes = focus ? routes.filter((rt) => rt.a === focus || rt.b === focus) : [];

  const seg = (rt: Route, k: string, style: Record<string, string | number>, dx: number) => [rt.pts, ...(rt.pts2 ? [rt.pts2] : [])].map((p, i) => (
    <polyline key={`${k}-${i}-${dx}`} points={p.map(([x, y]) => `${x + dx},${y}`).join(' ')} fill="none" stroke-linejoin="round" {...style} pointer-events="none" />
  ));
  // Pfeilspitzen am Kartenrand für Ost-West-Übergänge
  const wrapArrows = (rt: Route, dx: number) => {
    if (!rt.wrap || !rt.pts2) return null;
    const a = rt.pts[rt.pts.length - 1], b = rt.pts2[0];
    const s_ = Math.max(7, px(4));
    return [a, b].map(([x, y], i) => {
      const dir = x <= 0 ? -1 : 1;
      return <path key={`wa-${rt.a}-${rt.b}-${i}-${dx}`} d={`M${x + dx - dir * s_ * 0.6},${y - s_}L${x + dx + dir * s_ * 0.9},${y}L${x + dx - dir * s_ * 0.6},${y + s_}Z`} fill="#fff3c4" pointer-events="none" />;
    });
  };
  const colonyColor = (rt: Route) => GEO.regions[TDEF[TDEF[rt.a].type === 'water' ? rt.a : rt.b].region].color;
  const routeStyle = (kind: Route['kind'], hi: boolean, rt?: Route): Record<string, string | number> => {
    const w = (n: number) => Math.max(n, px(n / 2.6));
    if (earth) {
      const col = rt ? colonyColor(rt) : '#9fe3ff';
      switch (kind) {
        case 'strait': return { stroke: hi ? '#fff3b0' : '#fff3c4', 'stroke-width': w(hi ? 6 : 3.5), 'stroke-dasharray': `${w(2.5)} ${w(7)}`, 'stroke-linecap': 'round' };
        case 'colony': return { stroke: col, 'stroke-width': w(hi ? 8 : 6), 'stroke-linecap': 'round', 'stroke-opacity': 0.95 };
        case 'water': return { stroke: hi ? '#ffffff' : '#bfe9ff', 'stroke-width': w(hi ? 4.5 : 3), 'stroke-dasharray': `${w(12)} ${w(7)}`, 'stroke-linecap': 'round', 'stroke-opacity': hi ? 1 : 0.75 };
        case 'coast': return { stroke: hi ? '#ffffff' : col, 'stroke-width': w(hi ? 4.5 : 2.5), 'stroke-linecap': 'round', 'stroke-opacity': hi ? 1 : 0.8 };
      }
    }
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
        {def.type === 'water' ? (earth ? (
          <>
            <path d={g.d} fill="none" stroke={GEO.regions[def.region].color} stroke-width={12} stroke-opacity={0.3} />
            <path d={g.d} fill="#062a38" fill-opacity={0.9} stroke={GEO.regions[def.region].color} stroke-width={5} />
          </>
        ) : (
          <>
            <path d={g.d} fill="#123a63" stroke={GEO.regions[def.region].color} stroke-width={7} />
            <path d={g.d} fill="none" stroke="#e8fbff" stroke-width={1.5} />
          </>
        )) : def.type === 'moon' && earth ? (
          <path d={g.d} fill={GEO.regions[def.region].color} fill-opacity={0.16} stroke={GEO.regions[def.region].color} stroke-width={2.2} stroke-opacity={0.9} />
        ) : <path d={g.d} fill={earth ? GEO.regions[def.region].color : base} stroke={earth ? '#13232b' : '#0b1322'} stroke-width={1.6} stroke-linejoin="round" />}
        {owner && <path d={g.d} fill={def.type === 'water' ? owner.color : 'none'} fill-opacity={def.type === 'water' ? 0.35 : 1} stroke={owner.color} stroke-width={def.type === 'water' ? (earth ? 10 : 16) : 12} clip-path={`url(#clip-${id})`} stroke-opacity={0.95} />}
        {t.devastated && <path d={g.d} fill="url(#hatch)" />}
        {isTarget && <path d={g.d} fill="#fde047" fill-opacity={0.22} stroke="#fde047" stroke-width={Math.max(4, px(2.2))} stroke-dasharray={`${px(6)} ${px(4)}`} class="pulse" />}
        {selected === id && <path d={g.d} fill="#ffffff" fill-opacity={0.16} stroke="#ffffff" stroke-width={Math.max(5, px(2.6))} />}
        {flash?.includes(id) && <path d={g.d} fill="#ef4444" fill-opacity={0.35} class="flash" />}
      </g>
    );
  };

  // Einheitenmarker: Form je Spieler (Farbenblindheit), Kommandanten als Piktogramme, Station als Satelliten-Symbol
  const seatOf = (pid: string | null) => (pid ? Math.max(0, view.seatOrder.indexOf(pid)) : 0);
  const shapePath = (k: number, x: number, y: number, rr: number): string => {
    const poly = (n: number, rot: number, f = 1) => Array.from({ length: n }, (_, i) => {
      const a = rot + (i * 2 * Math.PI) / n;
      return `${i ? 'L' : 'M'}${(x + Math.cos(a) * rr * f).toFixed(1)},${(y + Math.sin(a) * rr * f).toFixed(1)}`;
    }).join('') + 'Z';
    switch (k % 5) {
      case 1: return poly(6, -Math.PI / 2, 1.08);       // Sechseck
      case 2: return poly(4, Math.PI / 4, 1.25);        // Quadrat
      case 3: return poly(4, -Math.PI / 2, 1.22);       // Raute
      case 4: return poly(5, -Math.PI / 2, 1.08);       // Fünfeck
      default: return `M${x - rr},${y}a${rr},${rr} 0 1 0 ${rr * 2},0a${rr},${rr} 0 1 0 ${-rr * 2},0Z`;
    }
  };

  const renderBadge = (id: string, dx: number) => {
    const t = view.territories[id];
    const g = GEO.territories[id];
    const [lx, ly] = TDEF[id].landingSite && g.marker ? g.marker : g.label;
    const x = lx + dx;
    const owner = t.owner ? players[t.owner] : null;
    const n = units(t);
    const extra = overlay?.[id] ?? 0;
    const cr = r * 0.74;                                   // Radius der Kommandanten-Abzeichen
    const cmds = [...t.commanders].sort();
    const startX = x - ((cmds.length - 1) * cr * 2.15) / 2;
    const [nx, ny] = [g.label[0] + dx, g.label[1]];
    return (
      <g key={`b-${id}@${dx}`} data-tid={id} data-copy={dx} class="badge">
        <circle cx={x} cy={ly} r={r * 0.9} class="anchor" fill="#000" fill-opacity={0.001} />
        {showNames && <text x={nx} y={TDEF[id].landingSite ? ny - 2 : ly - r - px(4)} class="tname" font-size={px(10.5)} stroke-width={px(2.5)}>{tn(id)}</text>}
        {t.devastated && (
          <g class="contam">
            <circle cx={x} cy={ly} r={r * 1.12} fill="#14130a" fill-opacity={0.92} stroke="#facc15" stroke-width={Math.max(2, r * 0.16)} stroke-dasharray={`${r * 0.9} ${r * 0.45}`} />
            <IcoG name="atom" x={x} y={ly} size={r * 1.55} color="#facc15" sw={2.1} />
          </g>
        )}
        {owner && (n > 0 || t.station) && (
          <>
            <path d={shapePath(seatOf(t.owner), x, ly, r + Math.max(1.5, r * 0.14))} fill="#050a14" fill-opacity={0.9} />
            <path d={shapePath(seatOf(t.owner), x, ly, r)} fill={owner.color} stroke="#fff" stroke-width={Math.max(2, r * 0.13)} stroke-linejoin="round" class="unitdisc" />
            <text x={x} y={ly + r * 0.37} class="count" font-size={r * 1.05}>{n}</text>
          </>
        )}
        {cmds.map((cm, i) => {
          const cx = startX + i * cr * 2.15, cy = ly + r + cr * 0.95;
          return (
            <g key={cm} class={`cmdmark cmd-${cm}`}>
              <circle cx={cx} cy={cy} r={cr} fill="#0b1322" stroke={CMD_COLOR[cm]} stroke-width={Math.max(1.6, cr * 0.16)} />
              <IcoG name={cm} x={cx} y={cy} size={cr * 1.35} color={CMD_COLOR[cm]} sw={2.1} />
            </g>
          );
        })}
        {t.station && (
          <g class="stationmark">
            <circle cx={x - r * 1.05} cy={ly - r * 0.95} r={cr * 1.05} fill="#0b1322" stroke="#22d3ee" stroke-width={Math.max(1.6, cr * 0.16)} />
            <IcoG name="station" x={x - r * 1.05} y={ly - r * 0.95} size={cr * 1.5} color="#22d3ee" sw={2} />
          </g>
        )}
        {extra > 0 && (
          <g>
            <rect x={x - r * 1.1} y={ly - r * 2.15} width={r * 2.2} height={r * 1.15} rx={r * 0.55} fill="#22c55e" stroke="#fff" stroke-width={Math.max(1, r * 0.08)} />
            <text x={x} y={ly - r * 1.3} class="plus" font-size={r * 0.85}>+{extra}</text>
          </g>
        )}
      </g>
    );
  };

  const pill = (rid: string) => {
    const def = RDEF[rid];
    const big = def.kind === 'continent' || def.kind === 'lunarColony';
    const fpx = narrow ? (big ? 11.5 : 9.5) : big ? 14 : 11.5;
    const fs = px(fpx);
    const text = `${rn(rid)} +${def.bonus}`;
    const w = fs * (text.length * 0.58) + fs * 1.1;
    const mine = view.me ? REGION_MEMBERS[rid].filter((id) => view.territories[id].owner === view.me).length : 0;
    const total = REGION_MEMBERS[rid].filter((id) => !view.territories[id].devastated).length;
    const [x, y] = GEO.regions[rid].label;
    return { big, fs, text, w, mine, total, x, y, h: fs * 1.7 + (mine > 0 ? fs * 1.1 : 0) };
  };
  // Beschriftungen ohne Überlappung: Kontinente/Mondkolonien zuerst, verdeckte Wasserkolonie-Labels entfallen
  // (beim Hineinzoomen werden sie relativ kleiner und erscheinen wieder; die Legende listet alle Regionen)
  const shownLabels = (() => {
    const order = [...(board === 'planet' ? PLANET_REGIONS : MOON_REGIONS)].sort((a, b) => Number(pill(b).big) - Number(pill(a).big));
    const taken: [number, number, number, number][] = [];
    const ok = new Map<string, number>();   // Schlüssel -> vertikale Verschiebung
    for (const dx of offsets) for (const rid of order) {
      const p = pill(rid);
      const shifts = p.big ? [0, 1, -1, 2, -2] : [0, 1, -1];
      for (const k of shifts) {
        const dy = k * p.h * 0.9;
        const bx: [number, number, number, number] = [p.x + dx - p.w / 2, p.y + dy - p.fs * 0.85, p.x + dx + p.w / 2, p.y + dy - p.fs * 0.85 + p.h];
        if (bx[2] < vx || bx[0] > vx + vw) break;
        if (taken.some((t) => bx[0] < t[2] && bx[2] > t[0] && bx[1] < t[3] && bx[3] > t[1])) continue;
        taken.push(bx);
        ok.set(`${rid}@${dx}`, dy);
        break;
      }
    }
    return ok;
  })();

  const renderRegionLabel = (rid: string, dx: number) => {
    const dy = shownLabels.get(`${rid}@${dx}`);
    if (dy === undefined) return null;
    const reg = GEO.regions[rid];
    const { fs, text, w, mine, total, x, y: y0 } = pill(rid);
    const y = y0 + dy;
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
    const rr = r * 1.55;
    const t = view.territories[id];
    const held = Boolean(t.owner);
    return (
      <g key={`lm-${id}`} data-tid={id} class="landing-marker">
        <circle cx={mx} cy={my} r={rr} fill="#fde047" fill-opacity={held ? 0.12 : 0.22} stroke="#fde047" stroke-width={Math.max(2, r * 0.2)} stroke-dasharray={held ? undefined : `${r * 0.7} ${r * 0.5}`} />
        {!held && <IcoG name="pad" x={mx} y={my} size={r * 1.5} color="#fde047" sw={2.2} />}
        <text x={mx} y={my + rr + r * 0.95} class="landing" font-size={r * 1.05} stroke-width={r * 0.3}>{GEO.landingShort[id]}</text>
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
        <span>{rn(r.id)}</span>
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
          <pattern id="hatch" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="14" height="14" fill="#2b2a14" fill-opacity="0.92" />
            <line x1="0" y1="0" x2="0" y2="14" stroke="#a8930f" stroke-width="5" stroke-opacity="0.75" />
          </pattern>
          <radialGradient id="seaGrad" cx="50%" cy="45%" r="75%"><stop offset="0" stop-color="#1d4f80" /><stop offset="1" stop-color="#0f2c4d" /></radialGradient>
          <linearGradient id="seaEarth" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0c3f52" /><stop offset="0.5" stop-color="#0a3445" /><stop offset="1" stop-color="#072634" /></linearGradient>
          <clipPath id="moonDisc"><circle cx={GEO.boards.moon.cx} cy={GEO.boards.moon.cy} r={GEO.boards.moon.radius} /></clipPath>
          <radialGradient id="space" cx="50%" cy="45%" r="70%"><stop offset="0" stop-color="#1b2540" /><stop offset="1" stop-color="#070b14" /></radialGradient>
          {ids.map((id) => <clipPath key={`c-${id}`} id={`clip-${id}`}><path d={GEO.territories[id].d} /></clipPath>)}
        </defs>
        {board === 'planet' ? (
          <>
            <rect x={vx - 10} y={vy - 10} width={vw + 20} height={vh + 20} fill={earth ? '#0a3445' : '#0f2c4d'} />
            {earth && <rect x={vx - 10} y={vy - 10} width={vw + 20} height={Math.max(0, 10 - vy)} fill="#0c3f52" />}
            {earth && <rect x={vx - 10} y={H} width={vw + 20} height={Math.max(0, vy + vh + 10 - H)} fill="#072634" />}
            {offsets.map((dx) => (
              <g key={`sea-${dx}`} transform={dx ? `translate(${dx},0)` : undefined} pointer-events="none">
                <rect x={0} y={0} width={W} height={H} fill={earth ? 'url(#seaEarth)' : 'url(#seaGrad)'} />
                {earth && GEO.graticule ? (
                  <>
                    {GEO.graticule.lon.map((x) => <line key={`gx${x}`} x1={x} y1={0} x2={x} y2={H} stroke="#2c6a80" stroke-opacity={0.35} stroke-width={1} />)}
                    {GEO.graticule.lat.map((y) => <line key={`gy${y}`} x1={0} y1={y} x2={W} y2={y} stroke="#2c6a80" stroke-opacity={0.35} stroke-width={1} />)}
                    <path d={GEO.landShadow} fill="#04131a" fill-opacity={0.55} transform="translate(3,4)" />
                  </>
                ) : (
                  <>
                    {[200, 400, 600, 800].map((y) => <line key={y} x1={0} y1={y} x2={W} y2={y} stroke="#fff" stroke-opacity={0.04} />)}
                    <path d={GEO.landShadow} fill="#2d6a95" fill-opacity={0.5} />
                  </>
                )}
              </g>
            ))}
            {!earth && offsets.map((dx) => routes.filter((rt) => rt.kind === 'coast' || rt.kind === 'water').map((rt) => seg(rt, `r-${rt.a}-${rt.b}`, routeStyle(rt.kind, false, rt), dx)))}
            {!earth && offsets.map((dx) => regions.filter((rid) => RDEF[rid].kind === 'waterColony').map((rid) => (
              <path key={`halo-${rid}@${dx}`} d={GEO.regions[rid].outline} transform={dx ? `translate(${dx},0)` : undefined} fill={GEO.regions[rid].color} fill-opacity={0.12} stroke={GEO.regions[rid].color} stroke-opacity={0.55} stroke-width={2} stroke-dasharray="4 5" pointer-events="none" />
            )))}
            {!earth && offsets.map((dx) => routes.filter((rt) => rt.kind === 'coast').map((rt) => coastStub(rt, dx)))}
          </>
        ) : (
          <>
            <rect x={vx - 10} y={vy - 10} width={vw + 20} height={vh + 20} fill="url(#space)" />
            <circle cx={GEO.boards.moon.cx} cy={GEO.boards.moon.cy} r={GEO.boards.moon.radius + (earth ? 10 : 14)} fill={earth ? '#9fb4d8' : '#1a2236'} fill-opacity={earth ? 0.12 : 1} />
            {earth && GEO.boards.moon.texture && (
              <image href={`/${GEO.boards.moon.texture}`} x={0} y={0} width={W} height={H} clip-path="url(#moonDisc)" pointer-events="none" />
            )}
          </>
        )}
        {offsets.map((dx) => ids.filter((id) => !earth || TDEF[id].type !== 'water').map((id) => renderTerritory(id, dx)))}
        {offsets.map((dx) => regions.filter((rid) => RDEF[rid].kind !== 'waterColony').map((rid) => (
          <path key={`ol-${rid}@${dx}`} d={GEO.regions[rid].outline} transform={dx ? `translate(${dx},0)` : undefined} fill="none" stroke={earth && board === 'moon' ? GEO.regions[rid].color : earth ? '#0b1418' : '#050a14'} stroke-width={board === 'moon' ? (earth ? 5 : 6) : earth ? 2.6 : 4.5} stroke-linejoin="round" pointer-events="none" />
        )))}
        {board === 'planet' && offsets.map((dx) => routes.filter((rt) => earth || rt.kind === 'strait' || rt.kind === 'colony').map((rt) => seg(rt, `s-${rt.a}-${rt.b}`, routeStyle(rt.kind, false, rt), dx)))}
        {board === 'planet' && earth && offsets.map((dx) => routes.map((rt) => wrapArrows(rt, dx)))}
        {board === 'planet' && earth && offsets.map((dx) => ids.filter((id) => TDEF[id].type === 'water').map((id) => renderTerritory(id, dx)))}
        {board === 'planet' && offsets.map((dx) => focusRoutes.map((rt) => seg(rt, `f-${rt.a}-${rt.b}`, routeStyle(rt.kind, true, rt), dx)))}
        {board === 'planet' && offsets.map((dx) => ids.filter((id) => GEO.territories[id].hit).map((id) => (
          <path key={`hit-${id}@${dx}`} d={GEO.territories[id].hit} transform={dx ? `translate(${dx},0)` : undefined} data-tid={id} data-copy={dx} class="hit" fill="#000" fill-opacity={0.001} />
        )))}
        {board === 'moon' && MOON_IDS.filter((id) => TDEF[id].landingSite).map(renderLanding)}
        {offsets.map((dx) => ids.map((id) => renderBadge(id, dx)))}
        {offsets.map((dx) => regions.map((rid) => renderRegionLabel(rid, dx)))}
      </svg>
      {menu && (() => {
        const g = GEO.territories[menu.id];
        if (!g || TDEF[menu.id].board !== board) return null;
        const [px0, py0] = TDEF[menu.id].landingSite && g.marker ? g.marker : g.label;
        // sichtbare Umlaufkopie wählen
        let best: number | null = null;
        for (const dx of offsets) { const sx = ((px0 + dx - vx) / vw) * size.w; if (sx > -20 && sx < size.w + 20 && (best === null || Math.abs(sx - size.w / 2) < Math.abs(best - size.w / 2))) best = sx; }
        if (best === null) return null;
        const sy = ((py0 - vy) / vh) * size.h;
        if (sy < -20 || sy > size.h + 20) return null;
        const gap = Math.max(14, r / c.sc * 1.0 + 8);
        const { w: mw, h: mh } = mdim;
        let left = Math.max(6, Math.min(size.w - mw - 62, best - mw / 2));
        const above = sy - gap - mh - 6 >= 0 || sy - gap > size.h - sy - gap;
        let top = Math.max(6, Math.min(size.h - mh - 6, above ? sy - gap - mh : sy + gap));
        let covers = sy > top - 10 && sy < top + mh + 10;        // Menü überdeckt das Gebiet selbst
        if (covers) {                                            // dann seitlich neben das Gebiet setzen
          const right = best + gap + 10 + mw <= size.w - 62, leftOk = best - gap - 10 - mw >= 6;
          if (right || leftOk) { left = right ? best + gap + 10 : best - gap - 10 - mw; top = Math.max(6, Math.min(size.h - mh - 6, sy - mh / 2)); covers = true; }
        }
        return (
          <div ref={menuRef} class={`ctxmenu ${above ? 'above' : 'below'} ${covers ? 'nocaret' : ''}`}
            style={{ left: `${left}px`, top: `${top}px`, '--maxh': `${Math.max(90, size.h - 16)}px`, '--cx': `${Math.max(14, Math.min(mw - 14, best - left))}px` } as never}
            onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
            {menu.node}
          </div>
        );
      })()}
      {legend && (
        <div class="legend" onClick={() => setLegend(false)}>
          <div class="lg-title">Marker</div>
          <div class="lg-row"><svg width="34" height="24" viewBox="0 0 34 24"><circle cx="9" cy="12" r="8" fill="#e5484d" stroke="#fff" stroke-width="2" /><path d="M22,5l7,4v6l-7,4l-7-4V9z" fill="#30a46c" stroke="#fff" stroke-width="2" /></svg><span>Einheiten (Form = Spieler)</span></div>
          {(['LAND', 'NAVAL', 'SPACE', 'NUCLEAR', 'DIPLOMAT'] as const).map((c) => (
            <div class="lg-row" key={c}><span class="lg-ico" style={{ borderColor: CMD_COLOR[c], color: CMD_COLOR[c] }}><Ico name={c} size={15} /></span><span>{{ LAND: 'Land-Kommandant', NAVAL: 'Marine-Kommandant', SPACE: 'Raum-Kommandant', NUCLEAR: 'Nuklear-Kommandant (Sprengkopf)', DIPLOMAT: 'Diplomat' }[c]}</span></div>
          ))}
          <div class="lg-row"><span class="lg-ico" style={{ borderColor: '#22d3ee', color: '#22d3ee' }}><Ico name="station" size={15} /></span><span>Station (Brücke zum Mond)</span></div>
          <div class="lg-row"><span class="lg-ico" style={{ borderColor: '#facc15', color: '#facc15' }}><Ico name="atom" size={15} /></span><span>Kontaminiert (unpassierbar)</span></div>
          <div class="lg-row"><span class="lg-ico" style={{ borderColor: '#fde047', color: '#fde047' }}><Ico name="pad" size={15} /></span><span>Mond: Landeplatz</span></div>
          <div class="lg-title">Kontinente</div>{legendRows('continent')}
          <div class="lg-title">Unterwasserkolonien</div>{legendRows('waterColony')}
          <div class="lg-title">Mondkolonien</div>{legendRows('lunarColony')}
          <div class="lg-title">Routen</div>
          {earth ? (
            <>
              <div class="lg-row"><svg width="34" height="10"><line x1="2" y1="5" x2="32" y2="5" stroke="#fff3c4" stroke-width="3.5" stroke-dasharray="2.5 6" stroke-linecap="round" /></svg><span>Seeweg / Meerenge zwischen Landgebieten (ohne Marine)</span></div>
              <div class="lg-row"><svg width="34" height="10"><line x1="2" y1="5" x2="32" y2="5" stroke="#4fb0f0" stroke-width="2.5" /></svg><span>Küstenzugang zur Wasserkolonie (Marine-Kdt im Spiel)</span></div>
              <div class="lg-row"><svg width="34" height="10"><line x1="2" y1="5" x2="32" y2="5" stroke="#4fb0f0" stroke-width="5" stroke-linecap="round" /></svg><span>innerhalb einer Wasserkolonie</span></div>
              <div class="lg-row"><svg width="34" height="10"><line x1="2" y1="5" x2="32" y2="5" stroke="#bfe9ff" stroke-width="3" stroke-dasharray="8 5" /></svg><span>Meeresströmung zwischen Kolonien</span></div>
              <div class="lg-row"><span class="hint">Gebiete mit gemeinsamer Grenze sind benachbart. Pfeile am Kartenrand = Ost-West-Übergang (z. B. Beringstraße). Gebiet antippen zeigt seine Routen.</span></div>
              <div class="lg-row"><span class="hint">Küsten: Natural Earth · Mond: NASA/GSFC/Arizona State University</span></div>
            </>
          ) : (
            <>
              <div class="lg-row"><svg width="34" height="10"><line x1="2" y1="5" x2="32" y2="5" stroke="#f3e6b8" stroke-width="4" stroke-dasharray="2 6" stroke-linecap="round" /></svg><span>Landpassage (ohne Marine)</span></div>
              <div class="lg-row"><svg width="34" height="10"><line x1="2" y1="5" x2="32" y2="5" stroke="#9fe3ff" stroke-width="3" stroke-dasharray="6 4" /></svg><span>Küste / Seeweg (Marine-Kdt im Spiel)</span></div>
              <div class="lg-row"><svg width="34" height="10"><line x1="2" y1="5" x2="32" y2="5" stroke="#e6fbff" stroke-width="5" stroke-linecap="round" /></svg><span>innerhalb einer Unterwasserkolonie</span></div>
              <div class="lg-row"><span class="hint">Linien zum Kartenrand = Ost-West-Übergang. Gebiet antippen zeigt seine Routen.</span></div>
            </>
          )}
        </div>
      )}
      <div class="mapctl">
        <button type="button" class={legend ? 'on' : ''} onClick={() => setLegend(!legend)} aria-label="Legende"><Ico name="info" size={20} /></button>
        <button type="button" onClick={() => zoomButton(1 / 1.6)} aria-label="Hineinzoomen"><Ico name="plus" size={20} /></button>
        <button type="button" onClick={() => zoomButton(1.6)} aria-label="Herauszoomen"><Ico name="minus" size={20} /></button>
        <button type="button" class={isOverview ? 'on' : ''} onClick={() => setCam(overview())} aria-label="Gesamtansicht"><Ico name="fit" size={20} /></button>
      </div>
    </div>
  );
}
