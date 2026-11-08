import type { Params } from '../types';
import { mulberry32 } from './rng';

/** Upper bound on dots, so the drawing and the SVG stay a manageable size. */
const MAX_CELLS = 600_000;

/**
 * Lays a rotated grid over the image and measures the average brightness under
 * each cell. Returns (u, v, luminance) triplets in grid space: the renderer
 * rotates the whole drawing by `angle`, so shapes stay aligned to the grid.
 */
export function halftoneCells(L: Float32Array, w: number, h: number, p: Params) {
  const cell = Math.max(p.cellSize, Math.sqrt((w * h) / MAX_CELLS), 1);
  const a = (p.angle * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);

  // Summed-area table, so the average under any box costs four lookups.
  const W = w + 1;
  const S = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += L[y * w + x];
      S[(y + 1) * W + x + 1] = S[y * W + x + 1] + row;
    }
  }

  let umin = Infinity;
  let umax = -Infinity;
  let vmin = Infinity;
  let vmax = -Infinity;
  for (const [x, y] of [[0, 0], [w, 0], [0, h], [w, h]]) {
    const u = x * cos + y * sin;
    const v = -x * sin + y * cos;
    umin = Math.min(umin, u);
    umax = Math.max(umax, u);
    vmin = Math.min(vmin, v);
    vmax = Math.max(vmax, v);
  }
  const i0 = Math.floor(umin / cell) - 1;
  const i1 = Math.ceil(umax / cell) + 1;
  const j0 = Math.floor(vmin / cell) - 1;
  const j1 = Math.ceil(vmax / cell) + 1;

  const cells = new Float32Array((i1 - i0 + 1) * (j1 - j0 + 1) * 3);
  const rand = mulberry32(p.seed);
  const jitter = p.jitter * cell;
  const half = cell / 2;
  const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
  let n = 0;

  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      // Always draw both random numbers so the pattern does not shift with the crop.
      const ju = rand() - 0.5;
      const jv = rand() - 0.5;
      const u = (i + 0.5) * cell + ju * jitter;
      const v = (j + 0.5) * cell + jv * jitter;
      const x = u * cos - v * sin;
      const y = u * sin + v * cos;
      if (x < -cell || y < -cell || x > w + cell || y > h + cell) continue;

      let x0 = clamp(Math.round(x - half), 0, w);
      let x1 = clamp(Math.round(x + half), 0, w);
      let y0 = clamp(Math.round(y - half), 0, h);
      let y1 = clamp(Math.round(y + half), 0, h);
      if (x1 <= x0) {
        x0 = clamp(Math.floor(x), 0, w - 1);
        x1 = x0 + 1;
      }
      if (y1 <= y0) {
        y0 = clamp(Math.floor(y), 0, h - 1);
        y1 = y0 + 1;
      }
      const sum = S[y1 * W + x1] - S[y0 * W + x1] - S[y1 * W + x0] + S[y0 * W + x0];
      cells[n++] = u;
      cells[n++] = v;
      cells[n++] = sum / ((x1 - x0) * (y1 - y0));
    }
  }

  return { cells: cells.slice(0, n), count: n / 3, cellSize: cell };
}
