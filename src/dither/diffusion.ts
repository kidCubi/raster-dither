import type { DiffusionMethod, Params } from '../types';
import { nearestIndex, type Planes } from './preprocess';

/** [dx, dy, weight]; weights are divided by `div`. */
type Tap = [number, number, number];

const KERNELS: Record<DiffusionMethod, { div: number; taps: Tap[] }> = {
  floyd: { div: 16, taps: [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]] },
  // Atkinson passes on only 6/8 of the error, which keeps highlights and shadows clean.
  atkinson: { div: 8, taps: [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]] },
  jjn: {
    div: 48,
    taps: [
      [1, 0, 7], [2, 0, 5],
      [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3],
      [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1],
    ],
  },
  stucki: {
    div: 42,
    taps: [
      [1, 0, 8], [2, 0, 4],
      [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2],
      [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1],
    ],
  },
  burkes: {
    div: 32,
    taps: [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2]],
  },
  sierra3: {
    div: 32,
    taps: [
      [1, 0, 5], [2, 0, 3],
      [-2, 1, 2], [-1, 1, 4], [0, 1, 5], [1, 1, 4], [2, 1, 2],
      [-1, 2, 2], [0, 2, 3], [1, 2, 2],
    ],
  },
  sierra2: {
    div: 16,
    taps: [[1, 0, 4], [2, 0, 3], [-2, 1, 1], [-1, 1, 2], [0, 1, 3], [1, 1, 2], [2, 1, 1]],
  },
  sierralite: { div: 4, taps: [[1, 0, 2], [-1, 1, 1], [0, 1, 1]] },
};

interface Kernel {
  dx: Int8Array;
  dy: Int8Array;
  wt: Float32Array;
  n: number;
}

function kernel(method: DiffusionMethod, strength: number): Kernel {
  const { div, taps } = KERNELS[method];
  return {
    dx: Int8Array.from(taps.map((t) => t[0])),
    dy: Int8Array.from(taps.map((t) => t[1])),
    wt: Float32Array.from(taps.map((t) => (t[2] / div) * strength)),
    n: taps.length,
  };
}

const clampErr = (v: number) => (v < -0.5 ? -0.5 : v > 1.5 ? 1.5 : v);

/** Tonal mode: round each pixel to the nearest of N brightness levels and push the error onward. */
export function diffuseTonal(L: Float32Array, w: number, h: number, N: number, method: DiffusionMethod, p: Params): Uint8Array {
  const buf = Float32Array.from(L);
  const out = new Uint8Array(w * h);
  const levels = N - 1;
  const k = kernel(method, p.strength);
  for (let y = 0; y < h; y++) {
    const rtl = p.serpentine && (y & 1) === 1;
    const dir = rtl ? -1 : 1;
    for (let step = 0; step < w; step++) {
      const x = rtl ? w - 1 - step : step;
      const i = y * w + x;
      const v = clampErr(buf[i]);
      let q = Math.round(v * levels);
      q = q < 0 ? 0 : q > levels ? levels : q;
      out[i] = q;
      const err = v - q / levels;
      if (err === 0) continue;
      for (let t = 0; t < k.n; t++) {
        const nx = x + k.dx[t] * dir;
        const ny = y + k.dy[t];
        if (nx < 0 || nx >= w || ny >= h) continue;
        buf[ny * w + nx] += err * k.wt[t];
      }
    }
  }
  return out;
}

/** Nearest-colour mode: same idea, but the error is tracked per channel against real palette colours. */
export function diffuseNearest(pl: Planes, w: number, h: number, pal: Float32Array, N: number, method: DiffusionMethod, p: Params): Uint8Array {
  const r = Float32Array.from(pl.r);
  const g = Float32Array.from(pl.g);
  const b = Float32Array.from(pl.b);
  const out = new Uint8Array(w * h);
  const k = kernel(method, p.strength);
  for (let y = 0; y < h; y++) {
    const rtl = p.serpentine && (y & 1) === 1;
    const dir = rtl ? -1 : 1;
    for (let step = 0; step < w; step++) {
      const x = rtl ? w - 1 - step : step;
      const i = y * w + x;
      const vr = clampErr(r[i]);
      const vg = clampErr(g[i]);
      const vb = clampErr(b[i]);
      const q = nearestIndex(vr, vg, vb, pal, N);
      out[i] = q;
      const er = vr - pal[q * 3];
      const eg = vg - pal[q * 3 + 1];
      const eb = vb - pal[q * 3 + 2];
      for (let t = 0; t < k.n; t++) {
        const nx = x + k.dx[t] * dir;
        const ny = y + k.dy[t];
        if (nx < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        const wt = k.wt[t];
        r[j] += er * wt;
        g[j] += eg * wt;
        b[j] += eb * wt;
      }
    }
  }
  return out;
}
