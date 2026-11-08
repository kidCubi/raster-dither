import type { OrderedMethod, Params } from '../types';
import { getMatrix } from './matrices';
import { nearestIndex, type Planes } from './preprocess';
import { hash2 } from './rng';

type Sampler = (x: number, y: number) => number;

/** Returns the threshold-pattern value (0..1) at a pixel. */
function sampler(method: OrderedMethod, p: Params): Sampler {
  const s = Math.max(1, Math.round(p.patternScale));
  if (method === 'whitenoise') {
    const seed = p.seed | 0;
    return (x, y) => hash2((x / s) | 0, (y / s) | 0, seed);
  }
  const { size, data } = getMatrix(method);
  return (x, y) => data[(((y / s) | 0) % size) * size + (((x / s) | 0) % size)];
}

/**
 * Tonal mode: brightness is split into N even levels. Between two levels,
 * the pattern decides whether a pixel rounds up or down.
 */
export function orderedTonal(L: Float32Array, w: number, h: number, N: number, method: OrderedMethod, p: Params): Uint8Array {
  const out = new Uint8Array(w * h);
  const levels = N - 1;
  const sample = sampler(method, p);
  const { threshold, spread } = p;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const s = L[i] * levels;
      const base = Math.floor(s);
      if (base >= levels) {
        out[i] = levels;
        continue;
      }
      const t = threshold + (sample(x, y) - 0.5) * spread;
      out[i] = s - base > t ? base + 1 : base;
    }
  }
  return out;
}

/** Nearest-colour mode: the pattern nudges each channel, then the closest palette colour wins. */
export function orderedNearest(pl: Planes, w: number, h: number, pal: Float32Array, N: number, method: OrderedMethod, p: Params): Uint8Array {
  const out = new Uint8Array(w * h);
  const sample = sampler(method, p);
  const amp = 1 / (N - 1);
  const bias = 0.5 - p.threshold;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const off = ((sample(x, y) - 0.5) * p.spread + bias) * amp;
      out[i] = nearestIndex(pl.r[i] + off, pl.g[i] + off, pl.b[i] + off, pal, N);
    }
  }
  return out;
}
