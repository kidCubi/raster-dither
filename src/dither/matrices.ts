import type { OrderedMethod } from '../types';
import { mulberry32 } from './rng';

/** A square threshold pattern, values in (0, 1). */
export interface Matrix {
  size: number;
  data: Float32Array;
}

const cache = new Map<string, Matrix>();

/** Turns integer ranks 0..n-1 into evenly spaced thresholds. */
function fromRanks(ranks: ArrayLike<number>, size: number): Matrix {
  const n = size * size;
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = (ranks[i] + 0.5) / n;
  return { size, data };
}

/** Classic recursive Bayer matrix. */
function bayer(size: number): Matrix {
  let m = [0];
  let s = 1;
  while (s < size) {
    const ns = s * 2;
    const next = new Array<number>(ns * ns);
    for (let y = 0; y < ns; y++) {
      for (let x = 0; x < ns; x++) {
        const v = m[(y % s) * s + (x % s)];
        const q = (y < s ? 0 : 2) + (x < s ? 0 : 1);
        next[y * ns + x] = 4 * v + [0, 2, 3, 1][q];
      }
    }
    m = next;
    s = ns;
  }
  return fromRanks(m, size);
}

/** Clustered dot: thresholds grow outward from the centre, so ink forms round dots. */
function cluster(size: number): Matrix {
  const n = size * size;
  const c = (size - 1) / 2;
  const order = [...Array(n).keys()].sort((a, b) => {
    const ax = (a % size) - c;
    const ay = Math.floor(a / size) - c;
    const bx = (b % size) - c;
    const by = Math.floor(b / size) - c;
    const da = ax * ax + ay * ay;
    const db = bx * bx + by * by;
    if (da !== db) return db - da;
    return Math.atan2(ay, ax) - Math.atan2(by, bx);
  });
  const ranks = new Array<number>(n);
  order.forEach((idx, r) => (ranks[idx] = r));
  return fromRanks(ranks, size);
}

const BITREV8 = [0, 4, 2, 6, 1, 5, 3, 7];

/** Rows nearest the centre keep ink longest, so dark tones become thick lines. */
function rowRanks(size: number): number[] {
  const mid = (size - 1) / 2;
  const order = [...Array(size).keys()].sort((a, b) => Math.abs(b - mid) - Math.abs(a - mid) || a - b);
  const ranks = new Array<number>(size);
  order.forEach((row, r) => (ranks[row] = r));
  return ranks;
}

function lineScreen(diagonal: boolean): Matrix {
  const size = 8;
  const rows = rowRanks(size);
  const ranks = new Array<number>(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const row = diagonal ? (x + y) % size : y;
      ranks[y * size + x] = rows[row] * size + BITREV8[x];
    }
  }
  return fromRanks(ranks, size);
}

/**
 * Blue noise through Ulichney's void-and-cluster method: points are placed one
 * at a time in the emptiest spot, which spreads them evenly without a visible grid.
 */
function blueNoise(size = 64, sigma = 1.5): Matrix {
  const n = size * size;
  const kernel = new Float32Array(n);
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const x = Math.min(dx, size - dx);
      const y = Math.min(dy, size - dy);
      kernel[dy * size + dx] = Math.exp(-(x * x + y * y) / (2 * sigma * sigma));
    }
  }
  const energy = new Float32Array(n);
  const bits = new Uint8Array(n);

  const toggle = (p: number, sign: number) => {
    const px = p % size;
    const py = (p / size) | 0;
    for (let y = 0; y < size; y++) {
      const ky = ((y - py + size) % size) * size;
      const row = y * size;
      for (let x = 0; x < size; x++) energy[row + x] += sign * kernel[ky + ((x - px + size) % size)];
    }
  };
  const tightestCluster = () => {
    let best = -1;
    let e = -Infinity;
    for (let i = 0; i < n; i++) if (bits[i] && energy[i] > e) (e = energy[i]), (best = i);
    return best;
  };
  const largestVoid = () => {
    let best = -1;
    let e = Infinity;
    for (let i = 0; i < n; i++) if (!bits[i] && energy[i] < e) (e = energy[i]), (best = i);
    return best;
  };

  // Random initial pattern (~10% filled), then relax it until stable.
  const rand = mulberry32(7);
  let ones = 0;
  for (let i = 0; i < n; i++) {
    if (rand() < 0.1) {
      bits[i] = 1;
      toggle(i, 1);
      ones++;
    }
  }
  for (let iter = 0; iter < n; iter++) {
    const c = tightestCluster();
    bits[c] = 0;
    toggle(c, -1);
    const v = largestVoid();
    bits[v] = 1;
    toggle(v, 1);
    if (v === c) break;
  }

  const ranks = new Int32Array(n);
  const protoBits = bits.slice();
  const protoEnergy = energy.slice();

  // Phase 1: remove points from the initial pattern, tightest clusters first.
  for (let r = ones - 1; r >= 0; r--) {
    const c = tightestCluster();
    bits[c] = 0;
    toggle(c, -1);
    ranks[c] = r;
  }
  // Phase 2: from the initial pattern, fill the largest voids until full.
  bits.set(protoBits);
  energy.set(protoEnergy);
  for (let r = ones; r < n; r++) {
    const v = largestVoid();
    bits[v] = 1;
    toggle(v, 1);
    ranks[v] = r;
  }
  return fromRanks(ranks, size);
}

/** Threshold pattern for an ordered method (white noise is computed per pixel instead). */
export function getMatrix(method: Exclude<OrderedMethod, 'whitenoise'>): Matrix {
  const hit = cache.get(method);
  if (hit) return hit;
  let m: Matrix;
  switch (method) {
    case 'threshold':
      m = { size: 1, data: new Float32Array([0.5]) };
      break;
    case 'bayer2':
      m = bayer(2);
      break;
    case 'bayer4':
      m = bayer(4);
      break;
    case 'bayer8':
      m = bayer(8);
      break;
    case 'bayer16':
      m = bayer(16);
      break;
    case 'cluster4':
      m = cluster(4);
      break;
    case 'cluster8':
      m = cluster(8);
      break;
    case 'bluenoise':
      m = blueNoise();
      break;
    case 'lines':
      m = lineScreen(false);
      break;
    case 'diagonal':
      m = lineScreen(true);
      break;
  }
  cache.set(method, m);
  return m;
}
