import type { Params } from '../types';

/** The image as three float channels in [0, 1]. */
export interface Planes {
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
}

/** Splits RGBA bytes into float planes. Transparent pixels are composited on white. */
function toPlanes(data: Uint8ClampedArray, n: number): Planes {
  const r = new Float32Array(n);
  const g = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const a = data[j + 3] / 255;
    const bg = 1 - a;
    r[i] = (data[j] / 255) * a + bg;
    g[i] = (data[j + 1] / 255) * a + bg;
    b[i] = (data[j + 2] / 255) * a + bg;
  }
  return { r, g, b };
}

/** One separable box-blur pass of radius r, with clamped edges. */
export function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const d = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += src[row + Math.min(Math.max(i, 0), w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / d;
      sum += src[row + Math.min(x + r + 1, w - 1)] - src[row + Math.max(x - r, 0)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += tmp[Math.min(Math.max(i, 0), h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / d;
      sum += tmp[Math.min(y + r + 1, h - 1) * w + x] - tmp[Math.max(y - r, 0) * w + x];
    }
  }
  return out;
}

/** Three box passes approximate a gaussian blur. */
function softBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  return boxBlur(boxBlur(boxBlur(src, w, h, r), w, h, r), w, h, r);
}

/**
 * Prepares the tones before dithering: blur, sharpen, brightness, contrast,
 * gamma and invert, applied to every channel.
 */
export function preprocess(data: Uint8ClampedArray, w: number, h: number, p: Params): Planes {
  const n = w * h;
  let { r, g, b } = toPlanes(data, n);

  const radius = Math.round(p.blur);
  if (radius > 0) {
    r = softBlur(r, w, h, radius);
    g = softBlur(g, w, h, radius);
    b = softBlur(b, w, h, radius);
  }

  if (p.sharpen > 0) {
    const amount = p.sharpen;
    for (const c of [r, g, b]) {
      const blurred = softBlur(c, w, h, 1);
      for (let i = 0; i < n; i++) c[i] += amount * (c[i] - blurred[i]);
    }
  }

  const contrast = p.contrast >= 0 ? 1 / Math.max(1 - p.contrast, 0.01) : 1 + p.contrast;
  const invGamma = 1 / Math.max(p.gamma, 0.01);
  const brightness = p.brightness;
  const invert = p.invert;
  for (const c of [r, g, b]) {
    for (let i = 0; i < n; i++) {
      let v = (c[i] + brightness - 0.5) * contrast + 0.5;
      v = v < 0 ? 0 : v > 1 ? 1 : v;
      v = Math.pow(v, invGamma);
      c[i] = invert ? 1 - v : v;
    }
  }

  return { r, g, b };
}

/** Perceived brightness (Rec. 709 weights). */
export function luminance({ r, g, b }: Planes): Float32Array {
  const n = r.length;
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = 0.2126 * r[i] + 0.7152 * g[i] + 0.0722 * b[i];
  return L;
}

/** Index of the palette colour closest to (r, g, b). `pal` is flat RGB in [0, 1]. */
export function nearestIndex(r: number, g: number, b: number, pal: Float32Array, n: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let k = 0; k < n; k++) {
    const dr = r - pal[k * 3];
    const dg = g - pal[k * 3 + 1];
    const db = b - pal[k * 3 + 2];
    const d = 0.299 * dr * dr + 0.587 * dg * dg + 0.114 * db * db;
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}
