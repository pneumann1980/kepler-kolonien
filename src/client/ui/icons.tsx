// Eigener Piktogramm-Satz (24×24, Strichgrafik, currentColor). Wird für Menüs, Karten und Brettmarker genutzt.
import type { ComponentChildren } from 'preact';
import type { CommanderType } from '../../engine/index.ts';

const P = (d: string, extra: Record<string, string | number> = {}) => <path d={d} {...extra} />;

const ICONS: Record<string, ComponentChildren> = {
  // --- Menü
  map: <>{P('M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z')}{P('M3.4 9.5h17.2M3.4 14.5h17.2')}{P('M12 3c-3 2.5-3 15.5 0 18M12 3c3 2.5 3 15.5 0 18')}</>,
  cards: <>{P('M8.5 5.5h8a1.8 1.8 0 0 1 1.8 1.8v10a1.8 1.8 0 0 1-1.8 1.8h-8a1.8 1.8 0 0 1-1.8-1.8v-10a1.8 1.8 0 0 1 1.8-1.8z')}{P('M6.7 8.2l-2.5.8a1.6 1.6 0 0 0-1 2l2.2 8')}{P('M12.5 9.5l1.7 3.2-1.7 3.2-1.7-3.2z', { fill: 'currentColor', stroke: 'none' })}</>,
  rank: <>{P('M8 4h8v5a4 4 0 0 1-8 0z')}{P('M8 6H5.5a1 1 0 0 0-1 1.2c.3 1.8 1.6 3 3.5 3.2M16 6h2.5a1 1 0 0 1 1 1.2c-.3 1.8-1.6 3-3.5 3.2')}{P('M12 13v3.5M8.5 20h7M9.5 20l.6-3.5h3.8l.6 3.5')}</>,
  log: <>{P('M7 3.5h8.5L19 7v13.5H7z')}{P('M15.5 3.5V7H19')}{P('M10 11h6M10 14h6M10 17h4')}</>,
  info: <>{P('M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z')}{P('M12 11v5.5')}{P('M12 7.6v.2', { 'stroke-width': 2.6 })}</>,
  home: <>{P('M4 11l8-7 8 7')}{P('M6 10v9.5h4.5v-5h3v5H18V10')}</>,
  plus: P('M12 5v14M5 12h14'),
  minus: P('M5 12h14'),
  fit: P('M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'),
  full: P('M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3'),
  close: P('M6 6l12 12M18 6L6 18'),
  check: P('M5 12.5l4.5 4.5L19 7.5'),
  panel: <>{P('M4 5h16v14H4z')}{P('M14.5 5v14')}</>,
  chevronUp: P('M6 15l6-6 6 6'),
  chevronDown: P('M6 9l6 6 6-6'),
  rotate: <>{P('M8 3.5h8a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 19V5A1.5 1.5 0 0 1 8 3.5z')}{P('M20.5 8.5a6 6 0 0 0-3-3.6M20.5 8.5l-.2-2.6M20.5 8.5l-2.4.3')}</>,
  // --- Ressourcen / Statistik
  bolt: P('M13 2.5L5.5 13.2H11l-1 8.3 7.5-10.7H12z', { fill: 'currentColor', 'stroke-linejoin': 'round' }),
  territory: <>{P('M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z')}{P('M12 8.5v7M8.8 10.3l6.4 3.4M15.2 10.3l-6.4 3.4', { 'stroke-width': 1.2, opacity: 0.8 })}</>,
  units: <>{P('M5 11l7-5.5 7 5.5M5 17l7-5.5 7 5.5')}</>,
  station: <>{P('M2.5 9.5h6v5h-6zM15.5 9.5h6v5h-6z')}{P('M8.5 12h7')}{P('M12 9v-3M12 15v3')}{P('M12 8.2a3.2 3.2 0 1 1 0 .01z', { fill: 'currentColor' })}</>,
  moon: P('M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z'),
  earth: <>{P('M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z')}{P('M7 7.5c1.5.5 2 1.8 3 2.2s2.5-.4 2.6 1.3c0 1.7-1.8 1.7-2 3-.2 1.2.8 2.2.4 3.3M14.5 5.2c-.3 1.2.6 2 1.8 2.2 1.3.2 2.2.9 2.7 2.1', { 'stroke-width': 1.6 })}</>,
  sword: <>{P('M5 19l9.5-9.5M14.5 9.5L19 5l-.5 4.5L14 14M8.5 15.5l-3 3M6.5 14l3.5 3.5')}</>,
  // --- Kommandanten
  LAND: <>{P('M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z')}{P('M8.8 12.2l3.2-3.2 3.2 3.2M8.8 15.7L12 12.5l3.2 3.2')}</>,
  NAVAL: <>{P('M12 3.8a2 2 0 1 1 0 4a2 2 0 0 1 0-4z')}{P('M12 7.8V20M8.2 11h7.6')}{P('M4.5 14c.2 3.6 3.4 6 7.5 6s7.3-2.4 7.5-6M4.5 14l-1.2 2.2M19.5 14l1.2 2.2')}</>,
  SPACE: <>{P('M12 2.5c3.2 2.2 4.8 5.6 4.8 9.6l-2.2 3.4H9.4l-2.2-3.4c0-4 1.6-7.4 4.8-9.6z')}{P('M12 8.6a1.7 1.7 0 1 0 0 3.4a1.7 1.7 0 0 0 0-3.4z')}{P('M7.4 12.5L4.2 16.8l3.8-.9M16.6 12.5l3.2 4.3-3.8-.9')}{P('M10.2 18.2L12 21.8l1.8-3.6')}</>,
  NUCLEAR: <>{P('M12 21.5c-3.4 0-5.5-2.3-5.5-5.6 0-3.1 2-6 5.5-8.4 3.5 2.4 5.5 5.3 5.5 8.4 0 3.3-2.1 5.6-5.5 5.6z')}{P('M9.2 7.8L7.6 3.4h8.8l-1.6 4.4')}{P('M12 12.2l-1.9 3.3h3.8z', { fill: 'currentColor', 'stroke-width': 1.2 })}{P('M12 16.9v.1', { 'stroke-width': 2.2 })}</>,
  atom: <>
    <ellipse cx="12" cy="12" rx="9.6" ry="3.7" />
    <ellipse cx="12" cy="12" rx="9.6" ry="3.7" transform="rotate(60 12 12)" />
    <ellipse cx="12" cy="12" rx="9.6" ry="3.7" transform="rotate(120 12 12)" />
    <circle cx="12" cy="12" r="1.9" fill="currentColor" stroke="none" />
  </>,
  hammer: <>{P('M4 20l7-7M9.5 9.5l5-5 4 4-5 5z')}{P('M14.5 4.5l2.5-1.5 3.5 3.5-1.5 2.5')}</>,
  DIPLOMAT: <>{P('M6 21V3.5')}{P('M6 4.5c3.5-1.6 5.5 1.6 9 0 1.7-.8 3-.7 4 0v8c-1-.7-2.3-.8-4 0-3.5 1.6-5.5-1.6-9 0')}{P('M4.5 21h3')}</>,
  // --- Kampf / Sonstiges
  dice: <>{P('M5 5h14v14H5z')}{P('M8.8 8.8v.1M15.2 8.8v.1M12 12v.1M8.8 15.2v.1M15.2 15.2v.1', { 'stroke-width': 2.6 })}</>,
  pad: <>{P('M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 0 0 0-17z')}{P('M8.5 8v8M15.5 8v8M8.5 12h7')}</>,
  skull: <>{P('M12 3.5c-4 0-6.5 2.7-6.5 6.2 0 2.3 1 3.7 2.5 4.7V18h8v-3.6c1.5-1 2.5-2.4 2.5-4.7 0-3.5-2.5-6.2-6.5-6.2z')}{P('M9.7 10.5v.1M14.3 10.5v.1M10.5 18v2.5M13.5 18v2.5', { 'stroke-width': 2.2 })}</>,
};

export type IconName = keyof typeof ICONS;

export function Ico({ name, size = 22, class: cls, title }: { name: string; size?: number; class?: string; title?: string }) {
  return (
    <svg class={`ico ${cls ?? ''}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden={title ? undefined : 'true'} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      {ICONS[name] ?? null}
    </svg>
  );
}

/** Piktogramm innerhalb eines SVG-Bretts (zentriert auf x,y, Kantenlänge size) */
export function IcoG({ name, x, y, size, color = '#fff', sw = 2 }: { name: string; x: number; y: number; size: number; color?: string; sw?: number }) {
  const k = size / 24;
  return (
    <g transform={`translate(${x - size / 2},${y - size / 2}) scale(${k})`} fill="none" stroke={color} stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" style={{ color }} pointer-events="none">
      {ICONS[name] ?? null}
    </g>
  );
}

/** Farbe je Kommandant (Marker, Karten, Chips) */
export const CMD_COLOR: Record<CommanderType, string> = {
  LAND: '#f59e0b', NAVAL: '#38bdf8', SPACE: '#a78bfa', NUCLEAR: '#fb7185', DIPLOMAT: '#34d399',
};

/** Rundes Kommandanten-Abzeichen (HTML) */
export function CmdBadge({ type, size = 26, title }: { type: CommanderType; size?: number; title?: string }) {
  const c = CMD_COLOR[type];
  return (
    <span class="cmdbadge" title={title} style={{ width: size, height: size, borderColor: c, color: c }}>
      <Ico name={type} size={Math.round(size * 0.62)} />
    </span>
  );
}
