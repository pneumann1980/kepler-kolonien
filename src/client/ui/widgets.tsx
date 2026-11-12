import type { ComponentChildren } from 'preact';
import { COMMANDER_NAMES, units } from '../../engine/index.ts';
import type { CommanderType, TerritoryState, UnitMove } from '../../engine/index.ts';

export function Btn(props: { onClick?: () => void; kind?: 'primary' | 'danger' | 'ghost' | 'ok' | 'warn'; disabled?: boolean; children: ComponentChildren; small?: boolean; title?: string }) {
  return (
    <button type="button" title={props.title} class={`btn ${props.kind ?? 'primary'} ${props.small ? 'small' : ''}`} disabled={props.disabled} onClick={props.onClick}>
      {props.children}
    </button>
  );
}

export function Dot({ color, size = 12 }: { color: string; size?: number }) {
  return <span class="dot" style={{ background: color, width: size, height: size }} />;
}

export function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div class="stepper">
      <button type="button" disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>−</button>
      <span>{value}</span>
      <button type="button" disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>+</button>
    </div>
  );
}

/** Auswahl zu bewegender Einheiten (MODs per Regler, Kommandanten per Chip) */
export function UnitPicker({ t, value, onChange, min, mustCmd = [], leave = 1 }: {
  t: TerritoryState; value: UnitMove; onChange: (m: UnitMove) => void; min: number; mustCmd?: CommanderType[]; leave?: number;
}) {
  const total = units(t);
  const maxMove = total - leave;
  const cmdCount = value.commanders.length;
  const maxMods = Math.max(0, Math.min(t.mods, maxMove - cmdCount));
  const minMods = Math.max(0, min - cmdCount);
  return (
    <div class="unitpicker">
      <div class="row">
        <span>MODs</span>
        <input type="range" min={Math.min(minMods, maxMods)} max={maxMods} value={value.mods}
          onInput={(e) => onChange({ ...value, mods: Number((e.target as HTMLInputElement).value) })} />
        <b>{value.mods}</b>
      </div>
      {t.commanders.length > 0 && (
        <div class="row chips">
          {t.commanders.map((c) => {
            const on = value.commanders.includes(c);
            const locked = mustCmd.includes(c);
            return (
              <button type="button" key={c} class={`chip ${on ? 'on' : ''}`} disabled={locked}
                onClick={() => {
                  const next = on ? value.commanders.filter((x) => x !== c) : [...value.commanders, c];
                  if (next.length + value.mods > maxMove) return;
                  onChange({ ...value, commanders: next });
                }}>
                {COMMANDER_NAMES[c]}{locked ? ' (Pflicht)' : ''}
              </button>
            );
          })}
        </div>
      )}
      <div class="hint">Bewegt: {value.mods + value.commanders.length} von max. {maxMove} {min > 0 ? `· mindestens ${min}` : ''}</div>
    </div>
  );
}

export function timeLeft(ts: number | null): string {
  if (!ts) return '';
  const ms = ts - Date.now();
  if (ms <= 0) return 'Frist abgelaufen';
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  return h >= 1 ? `noch ${h} h ${m} min` : `noch ${m} min`;
}
