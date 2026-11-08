export const ORDERED_METHODS = [
  'threshold',
  'bayer2',
  'bayer4',
  'bayer8',
  'bayer16',
  'cluster4',
  'cluster8',
  'bluenoise',
  'whitenoise',
  'lines',
  'diagonal',
] as const;

export const DIFFUSION_METHODS = [
  'floyd',
  'atkinson',
  'jjn',
  'stucki',
  'burkes',
  'sierra3',
  'sierra2',
  'sierralite',
] as const;

export type OrderedMethod = (typeof ORDERED_METHODS)[number];
export type DiffusionMethod = (typeof DIFFUSION_METHODS)[number];
export type Method = OrderedMethod | DiffusionMethod | 'halftone';
export type Family = 'ordered' | 'diffusion' | 'halftone';

export function familyOf(m: Method): Family {
  if (m === 'halftone') return 'halftone';
  return (DIFFUSION_METHODS as readonly string[]).includes(m) ? 'diffusion' : 'ordered';
}

/** Dropdown label → method id. Order here is the order in the UI. */
export const METHOD_OPTIONS: Record<string, Method> = {
  Threshold: 'threshold',
  'Bayer 2×2': 'bayer2',
  'Bayer 4×4': 'bayer4',
  'Bayer 8×8': 'bayer8',
  'Bayer 16×16': 'bayer16',
  'Clustered dot 4×4': 'cluster4',
  'Clustered dot 8×8': 'cluster8',
  'Blue noise': 'bluenoise',
  'White noise': 'whitenoise',
  'Line screen': 'lines',
  'Diagonal screen': 'diagonal',
  'Floyd–Steinberg': 'floyd',
  Atkinson: 'atkinson',
  'Jarvis–Judice–Ninke': 'jjn',
  Stucki: 'stucki',
  Burkes: 'burkes',
  Sierra: 'sierra3',
  'Two-row Sierra': 'sierra2',
  'Sierra Lite': 'sierralite',
  'Halftone (shapes)': 'halftone',
};

export function methodLabel(m: Method): string {
  return Object.keys(METHOD_OPTIONS).find((k) => METHOD_OPTIONS[k] === m) ?? m;
}

export type Shape = 'circle' | 'square' | 'diamond' | 'ellipse' | 'line' | 'cross';

export const SHAPE_OPTIONS: Record<string, Shape> = {
  Circle: 'circle',
  Square: 'square',
  Diamond: 'diamond',
  Ellipse: 'ellipse',
  Line: 'line',
  Cross: 'cross',
};

export type Mapping = 'tonal' | 'nearest';
export type Zoom = 'fit' | number;
export type ColorCount = 2 | 3 | 4;
export type RGB = [number, number, number];

export interface Params {
  // Image
  workingSize: number;
  pixelSize: number;
  brightness: number;
  contrast: number;
  gamma: number;
  blur: number;
  sharpen: number;
  invert: boolean;
  // Dither
  method: Method;
  threshold: number;
  spread: number;
  patternScale: number;
  seed: number;
  strength: number;
  serpentine: boolean;
  shape: Shape;
  cellSize: number;
  angle: number;
  dotScale: number;
  minDot: number;
  jitter: number;
  // Palette
  palette: string;
  colorCount: ColorCount;
  mapping: Mapping;
  color1: string;
  color2: string;
  color3: string;
  color4: string;
  transparent: boolean;
  // View & export
  zoom: Zoom;
  exportScale: number;
  showOriginal: boolean;
}

export const DEFAULTS: Params = {
  workingSize: 1600,
  pixelSize: 2,
  brightness: 0,
  contrast: 0,
  gamma: 1,
  blur: 0,
  sharpen: 0,
  invert: false,

  method: 'atkinson',
  threshold: 0.5,
  spread: 1,
  patternScale: 1,
  seed: 1,
  strength: 1,
  serpentine: true,
  shape: 'circle',
  cellSize: 8,
  angle: 45,
  dotScale: 1,
  minDot: 0,
  jitter: 0,

  palette: 'Ink & paper',
  colorCount: 2,
  mapping: 'tonal',
  color1: '#141414',
  color2: '#f2eee3',
  color3: '#8a8780',
  color4: '#d0ccc2',
  transparent: false,

  zoom: 'fit',
  exportScale: 1,
  showOriginal: false,
};

// ---- Worker messages -------------------------------------------------------

export interface Job {
  id: number;
  /** Version of the loaded source image, so stale results can be dropped. */
  src: number;
  key: string;
  width: number;
  height: number;
  data: Uint8ClampedArray;
  params: Params;
  palette: RGB[];
}

interface ResultBase {
  id: number;
  src: number;
  key: string;
  params: Params;
  width: number;
  height: number;
  ms: number;
}

export type PixelResult = ResultBase & { kind: 'pixels'; indices: Uint8Array };
export type HalftoneResult = ResultBase & {
  kind: 'halftone';
  /** Triplets of (u, v, luminance) in rotated grid space. */
  cells: Float32Array;
  count: number;
  /** Cell size actually used (it is raised when the dot count would be huge). */
  cellSize: number;
};
export type JobResult = PixelResult | HalftoneResult;
