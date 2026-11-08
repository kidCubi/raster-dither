import { familyOf, type DiffusionMethod, type Job, type JobResult, type OrderedMethod } from './types';
import { luminance, preprocess } from './dither/preprocess';
import { orderedNearest, orderedTonal } from './dither/ordered';
import { diffuseNearest, diffuseTonal } from './dither/diffusion';
import { halftoneCells } from './dither/halftone';

const post = (msg: JobResult, transfer: Transferable[]) =>
  (self as unknown as { postMessage(m: unknown, t: Transferable[]): void }).postMessage(msg, transfer);

self.onmessage = (e: MessageEvent<Job>) => {
  const job = e.data;
  const t0 = performance.now();
  const { width: w, height: h, params: p } = job;
  const planes = preprocess(job.data, w, h, p);
  const family = familyOf(p.method);
  const base = { id: job.id, src: job.src, key: job.key, params: p, width: w, height: h };

  if (family === 'halftone') {
    const { cells, count, cellSize } = halftoneCells(luminance(planes), w, h, p);
    post({ ...base, kind: 'halftone', cells, count, cellSize, ms: performance.now() - t0 }, [cells.buffer]);
    return;
  }

  const N = p.colorCount;
  let indices: Uint8Array;
  if (p.mapping === 'tonal') {
    const L = luminance(planes);
    indices =
      family === 'ordered'
        ? orderedTonal(L, w, h, N, p.method as OrderedMethod, p)
        : diffuseTonal(L, w, h, N, p.method as DiffusionMethod, p);
  } else {
    const pal = new Float32Array(N * 3);
    for (let k = 0; k < N; k++) for (let c = 0; c < 3; c++) pal[k * 3 + c] = job.palette[k][c] / 255;
    indices =
      family === 'ordered'
        ? orderedNearest(planes, w, h, pal, N, p.method as OrderedMethod, p)
        : diffuseNearest(planes, w, h, pal, N, p.method as DiffusionMethod, p);
  }
  post({ ...base, kind: 'pixels', indices, ms: performance.now() - t0 }, [indices.buffer]);
};
