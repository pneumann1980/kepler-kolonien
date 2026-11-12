// Deterministischer PRNG (sfc32). Der Zustand liegt im GameState -> Partien sind aus Seed + Commands reproduzierbar.

export type RngState = [number, number, number, number];

export function seedFromHex(hex: string): RngState {
  const h = hex.padEnd(32, '0');
  const s: RngState = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) s[i] = parseInt(h.slice(i * 8, i * 8 + 8), 16) >>> 0;
  if (s.every((v) => v === 0)) s[0] = 0x9e3779b9;
  // Aufwärmen
  for (let i = 0; i < 16; i++) nextU32(s);
  return s;
}

export function nextU32(s: RngState): number {
  let [a, b, c, d] = s;
  a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
  const t = (((a + b) >>> 0) + d) >>> 0;
  d = (d + 1) >>> 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) >>> 0;
  c = (c << 21) | (c >>> 11);
  c = (c + t) >>> 0;
  s[0] = a >>> 0; s[1] = b >>> 0; s[2] = c >>> 0; s[3] = d >>> 0;
  return t;
}

/** Gleichverteilte Ganzzahl in [0, n) ohne Modulo-Bias */
export function randInt(s: RngState, n: number): number {
  if (n <= 1) return 0;
  const limit = Math.floor(0x100000000 / n) * n;
  let x: number;
  do { x = nextU32(s); } while (x >= limit);
  return x % n;
}

export function roll(s: RngState, sides: number): number {
  return randInt(s, sides) + 1;
}

export function shuffle<T>(s: RngState, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(s, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
