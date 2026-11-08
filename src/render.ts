import type { Params, RGB, Shape } from './types';

/** One ink colour's worth of halftone shapes, as an SVG path. */
export interface Layer {
  /** Palette index of the fill colour. */
  k: number;
  d: string;
  path?: Path2D;
}

const f = (n: number) => String(Math.round(n * 100) / 100);

/**
 * Grows from area-proportional size (small dots) to full coverage at solid ink,
 * so midtones stay true and dark areas close up without gaps.
 */
const grow = (c: number, kArea: number, kFull: number) => Math.sqrt(c) * (kArea + (kFull - kArea) * c * c);

function shapePath(shape: Shape, u: number, v: number, c: number, cell: number, scale: number): string {
  const half = cell / 2;
  switch (shape) {
    case 'circle': {
      const r = grow(c, 0.5642, 0.7072) * cell * scale;
      return `M${f(u - r)} ${f(v)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`;
    }
    case 'square': {
      const a = Math.sqrt(c) * half * scale;
      return `M${f(u - a)} ${f(v - a)}h${f(2 * a)}v${f(2 * a)}h${f(-2 * a)}Z`;
    }
    case 'diamond': {
      const d = grow(c, 0.7072, 1) * cell * scale;
      return `M${f(u)} ${f(v - d)}L${f(u + d)} ${f(v)}L${f(u)} ${f(v + d)}L${f(u - d)} ${f(v)}Z`;
    }
    case 'ellipse': {
      const r = grow(c, 0.5642, 0.8) * cell * scale;
      const rx = r * 1.4;
      const ry = r / 1.4;
      return `M${f(u - rx)} ${f(v)}a${f(rx)} ${f(ry)} 0 1 0 ${f(2 * rx)} 0a${f(rx)} ${f(ry)} 0 1 0 ${f(-2 * rx)} 0Z`;
    }
    case 'line': {
      // Slight overlap so neighbouring cells join into a continuous line.
      const t = c * cell * scale;
      const len = cell + 0.6;
      return `M${f(u - len / 2)} ${f(v - t / 2)}h${f(len)}v${f(t)}h${f(-len)}Z`;
    }
    case 'cross': {
      // Arm width chosen so the cross covers a fraction c of the cell.
      const wArm = cell * (1 - Math.sqrt(1 - c)) * scale;
      return (
        `M${f(u - half)} ${f(v - wArm / 2)}h${f(cell)}v${f(wArm)}h${f(-cell)}Z` +
        `M${f(u - wArm / 2)} ${f(v - half)}h${f(wArm)}v${f(cell)}h${f(-wArm)}Z`
      );
    }
  }
}

/**
 * Builds one path per ink colour. With N colours, each cell gets concentric
 * shapes: the lightest ink grows first, and darker inks grow on top of it as
 * the tone deepens. Paper (the last colour) is the background.
 */
export function halftoneLayers(
  cells: Float32Array,
  count: number,
  cellSize: number,
  p: Pick<Params, 'shape' | 'dotScale' | 'minDot' | 'colorCount'>,
): Layer[] {
  const N = p.colorCount;
  const levels = N - 1;
  const layers: Layer[] = [];
  for (let k = N - 2; k >= 0; k--) {
    const offset = levels - 1 - k;
    const parts: string[] = [];
    for (let i = 0; i < count; i++) {
      const lum = cells[i * 3 + 2];
      const c = Math.min(1, Math.max(0, (1 - lum) * levels - offset));
      if (c <= 0.002 || c < p.minDot) continue;
      parts.push(shapePath(p.shape, cells[i * 3], cells[i * 3 + 1], c, cellSize, p.dotScale));
    }
    layers.push({ k, d: parts.join('') });
  }
  return layers;
}

export function drawHalftone(
  ctx: CanvasRenderingContext2D,
  layers: Layer[],
  colors: string[],
  N: number,
  transparent: boolean,
  angle: number,
  w: number,
  h: number,
  scale: number,
) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  if (!transparent) {
    ctx.fillStyle = colors[N - 1];
    ctx.fillRect(0, 0, w, h);
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  ctx.rotate((angle * Math.PI) / 180);
  for (const layer of layers) {
    if (!layer.d) continue;
    layer.path ??= new Path2D(layer.d);
    ctx.fillStyle = colors[layer.k];
    ctx.fill(layer.path);
  }
  ctx.restore();
}

export function halftoneSVG(
  layers: Layer[],
  colors: string[],
  N: number,
  transparent: boolean,
  angle: number,
  w: number,
  h: number,
  scale: number,
): string {
  const paper = transparent ? '' : `<rect width="${w}" height="${h}" fill="${colors[N - 1]}"/>\n`;
  const paths = layers
    .filter((l) => l.d)
    .map((l) => `<path fill="${colors[l.k]}" d="${l.d}"/>`)
    .join('\n');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w * scale)}" height="${Math.round(h * scale)}" viewBox="0 0 ${w} ${h}">\n` +
    `<defs><clipPath id="frame"><rect width="${w}" height="${h}"/></clipPath></defs>\n` +
    paper +
    `<g clip-path="url(#frame)"><g transform="rotate(${angle})">\n${paths}\n</g></g>\n</svg>\n`
  );
}

/** Maps palette indices to RGBA pixels. */
export function paintPixels(indices: Uint8Array, w: number, h: number, colors: RGB[], N: number, transparent: boolean): ImageData {
  const img = new ImageData(w, h);
  const d = img.data;
  const paper = N - 1;
  const lut = new Uint8Array(N * 4);
  for (let k = 0; k < N; k++) {
    lut[k * 4] = colors[k][0];
    lut[k * 4 + 1] = colors[k][1];
    lut[k * 4 + 2] = colors[k][2];
    lut[k * 4 + 3] = transparent && k === paper ? 0 : 255;
  }
  for (let i = 0, j = 0; i < indices.length; i++, j += 4) {
    const k = Math.min(indices[i], paper) * 4;
    d[j] = lut[k];
    d[j + 1] = lut[k + 1];
    d[j + 2] = lut[k + 2];
    d[j + 3] = lut[k + 3];
  }
  return img;
}
