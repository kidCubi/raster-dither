/**
 * Crop: rectangle geometry plus the on-canvas editor (drag, resize, draw).
 *
 * Rectangles are normalised to the source image: x, y, w, h all run from 0 to
 * 1. That way they stay valid at any zoom, working size or pixel size.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 };

/** Panel label → aspect key. "a:b" keys are width:height in pixels. */
export const ASPECT_OPTIONS = {
  Free: 'free',
  Original: 'original',
  '1:1': '1:1',
  '4:5': '4:5',
  '5:4': '5:4',
  '3:2': '3:2',
  '2:3': '2:3',
  '16:9': '16:9',
  '9:16': '9:16',
} as const;
export type Aspect = (typeof ASPECT_OPTIONS)[keyof typeof ASPECT_OPTIONS];

/** Pixel width/height ratio for an aspect key, or null when free. */
export function pixelRatio(aspect: Aspect, imageW: number, imageH: number): number | null {
  if (aspect === 'free') return null;
  if (aspect === 'original') return imageW / imageH;
  const [a, b] = aspect.split(':').map(Number);
  return a / b;
}

/** Converts a pixel ratio into the equivalent ratio in normalised (0–1) space. */
export function normRatio(ratio: number, imageW: number, imageH: number): number {
  return (ratio * imageH) / imageW;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export function isFull(r: Rect): boolean {
  return r.x < 0.001 && r.y < 0.001 && r.w > 0.999 && r.h > 0.999;
}

/** Largest rectangle of the given normalised ratio that fits the image, centred. */
export function fitRatio(ratio: number): Rect {
  const w = ratio >= 1 ? 1 : ratio;
  const h = ratio >= 1 ? 1 / ratio : 1;
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

export function moveRect(s: Rect, dx: number, dy: number): Rect {
  return { ...s, x: clamp(s.x + dx, 0, 1 - s.w), y: clamp(s.y + dy, 0, 1 - s.h) };
}

/**
 * Resizes `s` by dragging `handle` by (dx, dy). The opposite side (or corner)
 * stays fixed. With a ratio, edge handles grow the other axis around the
 * centre. The result always stays inside the image and at least minW × minH.
 */
export function resizeRect(
  s: Rect,
  handle: Handle,
  dx: number,
  dy: number,
  ratio: number | null,
  minW: number,
  minH: number,
): Rect {
  const L = s.x;
  const T = s.y;
  const R = s.x + s.w;
  const B = s.y + s.h;
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  const hasW = handle.includes('w');
  const hasE = handle.includes('e');
  const hasN = handle.includes('n');
  const hasS = handle.includes('s');

  // Size implied by the pointer, measured from the fixed side.
  let w = hasE ? R + dx - L : hasW ? R - (L + dx) : s.w;
  let h = hasS ? B + dy - T : hasN ? B - (T + dy) : s.h;
  // Room available in the direction(s) the box can grow.
  const availW = hasE ? 1 - L : hasW ? R : 2 * Math.min(cx, 1 - cx);
  const availH = hasS ? 1 - T : hasN ? B : 2 * Math.min(cy, 1 - cy);

  w = Math.max(minW, w);
  h = Math.max(minH, h);
  if (ratio) {
    if (handle === 'e' || handle === 'w') h = w / ratio;
    else if (handle === 'n' || handle === 's') w = h * ratio;
    else if (w / ratio > h) h = w / ratio;
    else w = h * ratio;
    if (w > availW) {
      w = availW;
      h = w / ratio;
    }
    if (h > availH) {
      h = availH;
      w = h * ratio;
    }
  } else {
    w = Math.min(w, availW);
    h = Math.min(h, availH);
  }

  return {
    x: hasE ? L : hasW ? R - w : cx - w / 2,
    y: hasS ? T : hasN ? B - h : cy - h / 2,
    w,
    h,
  };
}

/** Minimum crop box size on screen, in CSS pixels. */
const MIN_PX = 24;
/** Pointer travel before a click outside the box starts drawing a new one. */
const DRAW_THRESHOLD_PX = 3;

/**
 * The crop editor laid over the output frame. It owns the draft rectangle;
 * the app reads `rect` when the crop is applied.
 */
export class CropOverlay {
  rect: Rect = { ...FULL };
  private box: HTMLElement;

  constructor(
    private layer: HTMLElement,
    private frame: HTMLElement,
    private opts: { ratio: () => number | null; onChange: (r: Rect) => void },
  ) {
    this.box = layer.querySelector<HTMLElement>('.crop-box')!;
    layer.addEventListener('pointerdown', (e) => this.onPointerDown(e));
  }

  set(r: Rect) {
    this.rect = { ...r };
    const s = this.box.style;
    s.left = `${r.x * 100}%`;
    s.top = `${r.y * 100}%`;
    s.width = `${r.w * 100}%`;
    s.height = `${r.h * 100}%`;
    this.opts.onChange(this.rect);
  }

  private onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    const handle = target.dataset.h as Handle | undefined;
    const mode: Handle | 'move' | 'draw' = handle ?? (target.closest('.crop-box') ? 'move' : 'draw');

    const fr = this.frame.getBoundingClientRect();
    const start = { ...this.rect };
    const sx = e.clientX;
    const sy = e.clientY;
    const origin = { x: clamp((sx - fr.left) / fr.width, 0, 1), y: clamp((sy - fr.top) / fr.height, 0, 1) };
    const minW = Math.min(1, MIN_PX / fr.width);
    const minH = Math.min(1, MIN_PX / fr.height);

    e.preventDefault();
    this.layer.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      const dxPx = ev.clientX - sx;
      const dyPx = ev.clientY - sy;
      const dx = dxPx / fr.width;
      const dy = dyPx / fr.height;
      const ratio = this.opts.ratio();
      let next: Rect;
      if (mode === 'move') {
        next = moveRect(start, dx, dy);
      } else if (mode === 'draw') {
        if (Math.hypot(dxPx, dyPx) < DRAW_THRESHOLD_PX) return;
        // A new box grows from the press point toward the pointer.
        const corner = `${dy < 0 ? 'n' : 's'}${dx < 0 ? 'w' : 'e'}` as Handle;
        next = resizeRect({ ...origin, w: 0, h: 0 }, corner, dx, dy, ratio, minW, minH);
      } else {
        next = resizeRect(start, mode, dx, dy, ratio, minW, minH);
      }
      this.layer.classList.add('dragging');
      this.set(next);
    };
    const onUp = () => {
      this.layer.classList.remove('dragging');
      this.layer.removeEventListener('pointermove', onMove);
      this.layer.removeEventListener('pointerup', onUp);
      this.layer.removeEventListener('pointercancel', onUp);
    };
    this.layer.addEventListener('pointermove', onMove);
    this.layer.addEventListener('pointerup', onUp);
    this.layer.addEventListener('pointercancel', onUp);
  }
}
