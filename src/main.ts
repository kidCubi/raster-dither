import GUI from 'lil-gui';
import './style.css';
import {
  DEFAULTS,
  METHOD_OPTIONS,
  SHAPE_OPTIONS,
  familyOf,
  methodLabel,
  type ColorCount,
  type Family,
  type HalftoneResult,
  type Job,
  type JobResult,
  type Params,
  type RGB,
} from './types';
import { PALETTES, hexToRgb, mixHex } from './palettes';
import { drawHalftone, halftoneLayers, halftoneSVG, paintPixels, type Layer } from './render';
import { makeSample } from './sample';
import * as motion from './motion';
import { ASPECT_OPTIONS, CropOverlay, FULL, fitRatio, isFull, normRatio, pixelRatio, type Aspect, type Rect } from './crop';

const STORAGE_KEY = 'raster-dither:v1';
const COLOR_KEYS = ['color1', 'color2', 'color3', 'color4'] as const;
const COLOR_LABELS: Record<ColorCount, string[]> = {
  2: ['Ink', 'Paper'],
  3: ['Shadows', 'Midtones', 'Highlights'],
  4: ['Shadows', 'Dark mids', 'Light mids', 'Highlights'],
};
/** Browsers refuse to draw canvases past roughly these limits. */
const MAX_SIDE = 16384;
const MAX_AREA = 200_000_000;
const MAX_PREVIEW_SIDE = 8192;
/**
 * Allowed values for enum-like settings, used by sanitize(). Declared up here
 * because sanitize() already runs when the stored settings load at startup.
 */
const ENUMS: Partial<Record<keyof Params, readonly unknown[]>> = {
  method: Object.values(METHOD_OPTIONS),
  shape: Object.values(SHAPE_OPTIONS),
  mapping: ['tonal', 'nearest'],
  colorCount: [2, 3, 4],
  zoom: ['fit', 0.5, 1, 2, 4],
  exportScale: [1, 2, 3, 4, 8],
};
/** Settings that only change how the result is drawn, not what the worker computes. */
const DRAW_ONLY = new Set<keyof Params>(['zoom', 'exportScale', 'showOriginal', 'palette', 'transparent', 'shape', 'dotScale', 'minDot']);

// ---- DOM ------------------------------------------------------------------

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} is missing from index.html`);
  return node as T;
}

const stage = $('stage');
const frame = $('frame');
const out = $<HTMLCanvasElement>('out');
const orig = $<HTMLCanvasElement>('orig');
const empty = $('empty');
const statusText = $('status-text');
const statusState = $('status-state');
const frameTag = $('frame-tag');
const cropLayer = $('crop');
const fileInput = $<HTMLInputElement>('file');
const presetInput = $<HTMLInputElement>('preset-file');

// ---- State ------------------------------------------------------------------

const params: Params = loadStoredParams();
let source: ImageBitmap | null = null;
let sourceName = 'image';
let sourceVersion = 0;
let procCache: { key: string; img: ImageData } | null = null;
let last: JobResult | null = null;
let layerCache: { key: string; layers: Layer[] } | null = null;
let busy = false;
let pending = false;
let jobId = 0;
let prevColorCount = params.colorCount;
/** Resolves once the intro has faded out; the first image reveal waits for it. */
let introGone: Promise<void> = Promise.resolve();
/** Set when a new image is loaded, so its first render plays the reveal. */
let revealNext = false;
/** Method shown in the frame tag, to scramble the label only when it changes. */
let tagMethod = '';
/** Dither family whose panel section is showing, to animate it in when it changes. */
let shownFamily: Family | null = null;
/** Applied crop, normalised to the source image; null means the whole image. Belongs to the image, not to presets. */
let crop: Rect | null = null;
/** True while the crop editor is open; the preview then shows the whole image. */
let cropping = false;
/** Export requested while cropping: it runs once the cropped render arrives. */
let pendingExport: 'png' | 'svg' | null = null;
/** Holds the dithered result at its native size, for display and export. */
const pixCanvas = document.createElement('canvas');

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

// ---- Control panel --------------------------------------------------------

const actions = {
  open: () => fileInput.click(),
  sample: () => void loadSample(),
  reverse: () => reversePalette(),
  exportPNG: () => void exportPNG(),
  exportSVG: () => exportSVG(),
  savePresetLocal: () => savePresetLocal(),
  loadSelected: () => loadSelectedPreset(),
  deleteSelected: () => deleteSelectedPreset(),
  exportPresets: () => exportPresets(),
  importPresets: () => presetInput.click(),
  randomise: () => randomise(),
  reset: () => resetParams(),
  cropToggle: () => (cropping ? applyCrop() : enterCrop()),
  cropCancel: () => cancelCrop(),
  cropReset: () => removeCrop(),
};

// Width must match `body.has-panel { --gui-w }` in style.css. Hidden until the first image (see showPanel).
const gui = new GUI({ title: 'Controls', width: 380 });
motion.prepareBoot(); // hide what the opening sequence brings in, before first paint

const fImage = gui.addFolder('01 Image');
fImage.add(actions, 'open').name('Open image…');
fImage.add(actions, 'sample').name('Use sample image');
const cWorking = fImage.add(params, 'workingSize', 128, 4000, 1).name('Working size (px)');
const cPixel = fImage.add(params, 'pixelSize', 1, 16, 1).name('Pixel size');
fImage.add(params, 'brightness', -1, 1, 0.01).name('Brightness');
fImage.add(params, 'contrast', -1, 1, 0.01).name('Contrast');
fImage.add(params, 'gamma', 0.2, 3, 0.01).name('Gamma');
fImage.add(params, 'blur', 0, 20, 1).name('Blur');
fImage.add(params, 'sharpen', 0, 3, 0.05).name('Sharpen');
fImage.add(params, 'invert').name('Invert');

const fDither = gui.addFolder('02 Dither');
fDither.add(params, 'method', METHOD_OPTIONS).name('Method');

const fOrdered = fDither.addFolder('02.A Threshold & pattern');
fOrdered.add(params, 'threshold', 0, 1, 0.01).name('Threshold');
const cSpread = fOrdered.add(params, 'spread', 0, 2, 0.01).name('Pattern strength');
const cPatternScale = fOrdered.add(params, 'patternScale', 1, 16, 1).name('Pattern scale');
const cNoiseSeed = fOrdered.add(params, 'seed', 1, 9999, 1).name('Noise seed');

const fDiffusion = fDither.addFolder('02.B Error diffusion');
fDiffusion.add(params, 'strength', 0, 1.5, 0.01).name('Error strength');
fDiffusion.add(params, 'serpentine').name('Serpentine scan');

const fHalftone = fDither.addFolder('02.C Halftone');
fHalftone.add(params, 'shape', SHAPE_OPTIONS).name('Shape');
fHalftone.add(params, 'cellSize', 2, 80, 0.5).name('Spacing (px)');
fHalftone.add(params, 'angle', 0, 360, 1).name('Angle (°)');
fHalftone.add(params, 'dotScale', 0.1, 2, 0.01).name('Dot scale');
fHalftone.add(params, 'minDot', 0, 0.95, 0.01).name('Drop dots below');
fHalftone.add(params, 'jitter', 0, 1, 0.01).name('Jitter');
fHalftone.add(params, 'seed', 1, 9999, 1).name('Jitter seed');

const fPalette = gui.addFolder('03 Palette');
const cPalette = fPalette.add(params, 'palette', [...Object.keys(PALETTES), 'Custom']).name('Preset');
const cCount = fPalette.add(params, 'colorCount', [2, 3, 4]).name('Colours');
const cMapping = fPalette
  .add(params, 'mapping', { 'Tonal (by brightness)': 'tonal', 'Nearest colour': 'nearest' })
  .name('Mapping');
const colorCtrls = COLOR_KEYS.map((k) => fPalette.addColor(params, k));
fPalette.add(actions, 'reverse').name('Reverse order');
fPalette.add(params, 'transparent').name('Transparent paper');

/** Panel-only state for the crop section (not part of the dither settings). */
const cropUI: { aspect: Aspect } = { aspect: 'free' };
const fCrop = gui.addFolder('04 Crop');
const cCropToggle = fCrop.add(actions, 'cropToggle');
const cAspect = fCrop
  .add(cropUI, 'aspect', ASPECT_OPTIONS)
  .name('Aspect')
  .onChange(() => onAspectChange());
const cCropCancel = fCrop.add(actions, 'cropCancel').name('Cancel (Esc)');
const cCropReset = fCrop.add(actions, 'cropReset').name('Remove crop');

const fOutput = gui.addFolder('05 View & export');
fOutput.add(params, 'zoom', { Fit: 'fit', '50%': 0.5, '100%': 1, '200%': 2, '400%': 4 }).name('Zoom');
const cOriginal = fOutput.add(params, 'showOriginal').name('Show original (Space)');
fOutput.add(params, 'exportScale', [1, 2, 3, 4, 8]).name('Export scale');
fOutput.add(actions, 'exportPNG').name('Export PNG');
const cSVG = fOutput.add(actions, 'exportSVG').name('Export SVG (halftone only)');
fOutput.add(actions, 'randomise').name('Randomise');
fOutput.add(actions, 'reset').name('Reset settings');

/** Panel-only state for the presets section (not part of the dither settings). */
const presetUI = { name: '', selected: '' };
const NO_PRESETS = '— none saved —';
const fPresets = gui.addFolder('06 Presets · this browser');
const cPresetName = fPresets.add(presetUI, 'name').name('Name');
fPresets.add(actions, 'savePresetLocal').name('Save current settings');
const cPresetList = fPresets
  .add(presetUI, 'selected', [NO_PRESETS])
  .name('Saved')
  .onChange(() => loadSelectedPreset());
const cLoadPreset = fPresets.add(actions, 'loadSelected').name('Load selected');
const cDeletePreset = fPresets.add(actions, 'deleteSelected').name('Delete selected');
fPresets.add(actions, 'exportPresets').name('Download all as JSON');
fPresets.add(actions, 'importPresets').name('Import JSON…');

gui.onChange(({ object, property }) => {
  if (object !== params) return; // the presets section has its own handlers
  const prop = property as keyof Params;
  if (prop === 'palette') applyPalette(params.palette);
  else if (prop === 'colorCount') {
    resizePalette(prevColorCount, params.colorCount);
    params.palette = 'Custom';
  } else if ((COLOR_KEYS as readonly string[]).includes(prop)) params.palette = 'Custom';
  prevColorCount = params.colorCount;

  syncPaletteDisplay();
  updateVisibility();
  persist();

  if (prop === 'zoom') return present(true);
  if (prop === 'exportScale') return;
  if (prop === 'showOriginal') return showOriginal(params.showOriginal);
  requestRender();
});

updateVisibility();

function updateVisibility() {
  const family = familyOf(params.method);
  cPixel.show(family !== 'halftone');
  fOrdered.show(family === 'ordered');
  fDiffusion.show(family === 'diffusion');
  fHalftone.show(family === 'halftone');
  if (shownFamily !== null && shownFamily !== family) {
    motion.revealSection({ ordered: fOrdered, diffusion: fDiffusion, halftone: fHalftone }[family].domElement);
  }
  shownFamily = family;
  const patterned = params.method !== 'threshold';
  cSpread.show(patterned);
  cPatternScale.show(patterned);
  cNoiseSeed.show(params.method === 'whitenoise');
  cMapping.show(family !== 'halftone');
  const labels = COLOR_LABELS[params.colorCount];
  colorCtrls.forEach((c, i) => {
    c.show(i < params.colorCount);
    if (i < params.colorCount) c.name(labels[i]);
  });
  cSVG.enable(family === 'halftone');
  frame.classList.toggle('checker', params.transparent);
}

function refreshPanel() {
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
  prevColorCount = params.colorCount;
  updateVisibility();
  persist();
  requestRender();
}

// ---- Palette helpers ------------------------------------------------------

function applyPalette(name: string) {
  const cols = PALETTES[name];
  if (!cols) return;
  params.colorCount = cols.length as ColorCount;
  cols.forEach((c, i) => (params[COLOR_KEYS[i]] = c));
}

/** When the colour count changes, keep the darkest and lightest colours and blend the ones in between. */
function resizePalette(from: number, to: number) {
  if (from === to) return;
  const dark = params.color1;
  const light = params[COLOR_KEYS[from - 1]];
  for (let i = 0; i < to; i++) params[COLOR_KEYS[i]] = mixHex(dark, light, i / (to - 1));
}

function reversePalette() {
  const n = params.colorCount;
  const cols = COLOR_KEYS.slice(0, n).map((k) => params[k]).reverse();
  cols.forEach((c, i) => (params[COLOR_KEYS[i]] = c));
  params.palette = 'Custom';
  syncPaletteDisplay();
  persist();
  requestRender();
}

function syncPaletteDisplay() {
  cPalette.updateDisplay();
  cCount.updateDisplay();
  colorCtrls.forEach((c) => c.updateDisplay());
}

const currentHex = () => COLOR_KEYS.map((k) => params[k]);
const currentRGB = (): RGB[] => currentHex().map(hexToRgb);

// ---- Loading images -------------------------------------------------------

async function decode(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Some formats (e.g. SVG) only decode through an <img>.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return await createImageBitmap(img);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

async function openFile(file: File) {
  if (file.type === 'application/json' || /\.json$/i.test(file.name)) return loadPresetFile(file);
  try {
    const bmp = await decode(file);
    loadImage(bmp, file.name.replace(/\.[^.]+$/, ''));
  } catch {
    setState('error');
    setSegments([['Err', `Could not read “${file.name}”. Try a PNG, JPEG, WebP or GIF.`]]);
  }
}

async function loadSample() {
  loadImage(await makeSample(), 'sample');
}

function loadImage(bmp: ImageBitmap, name: string) {
  source?.close();
  source = bmp;
  sourceName = name || 'image';
  sourceVersion++;
  params.workingSize = Math.min(1600, Math.max(bmp.width, bmp.height));
  cWorking.updateDisplay();
  procCache = null;
  last = null;
  layerCache = null;
  crop = null;
  closeCropEditor(false);
  // First image: the intro leaves and the sidebar arrives together; the reveal waits for both.
  const settling: Promise<void>[] = [];
  if (!empty.hidden) settling.push(motion.introOut().then(() => void (empty.hidden = true)));
  if (!document.body.classList.contains('has-panel')) settling.push(showPanel());
  if (settling.length) introGone = Promise.all(settling).then(() => undefined);
  revealNext = true;
  setSegments([['File', sourceName], ['Src', `${bmp.width}×${bmp.height}`]]);
  requestRender();
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (file) void openFile(file);
});
$('btn-open').addEventListener('click', () => fileInput.click());
$('btn-sample').addEventListener('click', () => void loadSample());

window.addEventListener('dragover', (e) => {
  e.preventDefault();
  document.body.classList.add('dragging');
});
window.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) document.body.classList.remove('dragging');
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.classList.remove('dragging');
  const file = e.dataTransfer?.files[0];
  if (file) void openFile(file);
});
window.addEventListener('paste', (e) => {
  const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
  if (file) void openFile(file);
});

// ---- Rendering pipeline ---------------------------------------------------

/** Region of the source being dithered, in source pixels: the crop, or everything while editing it. */
function srcRect() {
  const W = source!.width;
  const H = source!.height;
  const c = cropping ? null : crop;
  if (!c) return { sx: 0, sy: 0, sw: W, sh: H };
  const sx = Math.round(c.x * W);
  const sy = Math.round(c.y * H);
  return { sx, sy, sw: Math.max(1, Math.min(W - sx, Math.round(c.w * W))), sh: Math.max(1, Math.min(H - sy, Math.round(c.h * H))) };
}

/** Working size: the source region scaled so its long edge equals `workingSize`. */
function workSize() {
  const { sw, sh } = srcRect();
  const s = params.workingSize / Math.max(sw, sh);
  return { w: Math.max(1, Math.round(sw * s)), h: Math.max(1, Math.round(sh * s)) };
}

/** The source resized to the grid the worker dithers (working size ÷ pixel size). */
function getProcImage(): ImageData {
  const { w: ww, h: wh } = workSize();
  const ps = familyOf(params.method) === 'halftone' ? 1 : params.pixelSize;
  const w = Math.max(1, Math.round(ww / ps));
  const h = Math.max(1, Math.round(wh / ps));
  const { sx, sy, sw, sh } = srcRect();
  const key = `${sourceVersion}:${sx},${sy},${sw},${sh}:${w}x${h}`;
  if (procCache?.key === key) return procCache.img;

  // Cut out the cropped region at full resolution first.
  let cur: CanvasImageSource = source!;
  if (sw !== source!.width || sh !== source!.height) {
    const c = document.createElement('canvas');
    c.width = sw;
    c.height = sh;
    c.getContext('2d')!.drawImage(source!, sx, sy, sw, sh, 0, 0, sw, sh);
    cur = c;
  }

  // Halve in steps first: one big downscale skips pixels and adds aliasing.
  let cw = sw;
  let ch = sh;
  while (cw / 2 >= w && ch / 2 >= h) {
    const c = document.createElement('canvas');
    c.width = Math.round(cw / 2);
    c.height = Math.round(ch / 2);
    const x = c.getContext('2d')!;
    x.imageSmoothingQuality = 'high';
    x.drawImage(cur, 0, 0, c.width, c.height);
    cur = c;
    cw = c.width;
    ch = c.height;
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.imageSmoothingQuality = 'high';
  x.drawImage(cur, 0, 0, w, h);
  const img = x.getImageData(0, 0, w, h);
  procCache = { key, img };
  return img;
}

/** Fingerprint of everything the worker's output depends on. */
function workerKey(): string {
  const family = familyOf(params.method);
  const parts: Record<string, unknown> = { src: sourceVersion, crop: source ? srcRect() : null };
  for (const [k, v] of Object.entries(params) as [keyof Params, unknown][]) {
    if (DRAW_ONLY.has(k)) continue;
    const isColor = (COLOR_KEYS as readonly string[]).includes(k);
    if (isColor && (family === 'halftone' || params.mapping === 'tonal')) continue;
    if ((k === 'colorCount' || k === 'mapping') && family === 'halftone') continue;
    parts[k] = v;
  }
  return JSON.stringify(parts);
}

function requestRender() {
  if (!source) return;
  const key = workerKey();
  if (last && last.key === key) return present();
  if (busy) {
    pending = true;
    return;
  }
  runJob(key);
}

function runJob(key: string) {
  busy = true;
  pending = false;
  setState('busy');
  const img = getProcImage();
  const data = new Uint8ClampedArray(img.data);
  const job: Job = {
    id: ++jobId,
    src: sourceVersion,
    key,
    width: img.width,
    height: img.height,
    data,
    params: { ...params },
    palette: currentRGB(),
  };
  worker.postMessage(job, [data.buffer]);
}

worker.onmessage = (e: MessageEvent<JobResult>) => {
  busy = false;
  setState('ready');
  if (e.data.src === sourceVersion) {
    last = e.data;
    present();
    updateStatus();
  }
  if (pending || e.data.src !== sourceVersion) requestRender();
  else flushPendingExport();
};

worker.onerror = (e) => {
  busy = false;
  setState('error');
  setSegments([['Err', `Render error: ${e.message}`]]);
};

function getLayers(r: HalftoneResult): Layer[] {
  const key = `${r.id}|${params.shape}|${params.dotScale}|${params.minDot}|${params.colorCount}`;
  if (layerCache?.key === key) return layerCache.layers;
  const layers = halftoneLayers(r.cells, r.count, r.cellSize, params);
  layerCache = { key, layers };
  return layers;
}

/** Sizes the frame for the current zoom. In pixel modes, fit snaps to whole device pixels to avoid moiré. */
function layout(animate = false): { cssW: number; cssH: number } {
  if (!last) return { cssW: 0, cssH: 0 };
  const ps = last.kind === 'pixels' ? last.params.pixelSize : 1;
  const w = last.width * ps;
  const h = last.height * ps;
  const dpr = window.devicePixelRatio || 1;
  let scale: number;
  if (params.zoom === 'fit') {
    // Stage padding plus room for the crop marks and the frame tag.
    const availW = Math.max(50, stage.clientWidth - 80);
    const availH = Math.max(50, stage.clientHeight - 96);
    scale = Math.min(availW / w, availH / h);
    if (last.kind === 'pixels') {
      const devicePerCell = scale * ps * dpr;
      if (devicePerCell >= 1) scale = Math.floor(devicePerCell) / (ps * dpr);
    }
  } else {
    // 100% = one working pixel per device pixel.
    scale = params.zoom / dpr;
  }
  const cssW = w * scale;
  const cssH = h * scale;
  motion.sizeFrame(frame, cssW, cssH, animate);
  return { cssW, cssH };
}

/** Draws the latest result. `animateZoom` tweens the frame to its new size (zoom changes only). */
function present(animateZoom = false) {
  if (!source || !last) return;
  frame.hidden = false;
  frame.classList.toggle('checker', params.transparent);
  const { cssW, cssH } = layout(animateZoom);
  const dpr = window.devicePixelRatio || 1;
  const ctx = out.getContext('2d')!;

  if (last.kind === 'pixels') {
    const img = paintPixels(last.indices, last.width, last.height, currentRGB(), last.params.colorCount, params.transparent);
    pixCanvas.width = last.width;
    pixCanvas.height = last.height;
    pixCanvas.getContext('2d')!.putImageData(img, 0, 0);
    out.width = last.width;
    out.height = last.height;
    out.classList.add('pixelated');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, out.width, out.height);
    ctx.drawImage(pixCanvas, 0, 0);
  } else {
    const scale = Math.min((cssW * dpr) / last.width, MAX_PREVIEW_SIDE / Math.max(last.width, last.height));
    out.width = Math.max(1, Math.round(last.width * scale));
    out.height = Math.max(1, Math.round(last.height * scale));
    out.classList.remove('pixelated');
    drawHalftone(ctx, getLayers(last), currentHex(), params.colorCount, params.transparent, last.params.angle, last.width, last.height, scale);
  }

  if (params.showOriginal) drawOriginal(cssW, cssH);

  if (revealNext) {
    revealNext = false;
    motion.prepareReveal(frame, out); // stay hidden until the reveal plays
    void introGone.then(() => {
      present(); // re-fit: the stage may have changed size while the sidebar slid in
      motion.revealFrame(frame, out);
    });
  }
}

function drawOriginal(cssW: number, cssH: number) {
  if (!source) return;
  const dpr = window.devicePixelRatio || 1;
  orig.width = Math.max(1, Math.min(MAX_PREVIEW_SIDE, Math.round(cssW * dpr)));
  orig.height = Math.max(1, Math.min(MAX_PREVIEW_SIDE, Math.round(cssH * dpr)));
  const ctx = orig.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  const { sx, sy, sw, sh } = srcRect();
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, orig.width, orig.height);
}

function showOriginal(on: boolean) {
  if (!on && orig.hidden) return;
  params.showOriginal = on;
  cOriginal.updateDisplay();
  if (on) {
    orig.hidden = false;
    if (last) {
      const { cssW, cssH } = layout();
      drawOriginal(cssW, cssH);
    }
  }
  // Hide only if it wasn't switched back on while wiping out.
  motion.compare(orig, on, () => void (orig.hidden = !params.showOriginal));
}

type Segment = [label: string, value: string, note?: boolean];

const STATE_LABELS = { idle: 'Standby', busy: 'Processing', ready: 'Ready', error: 'Error' } as const;

function setState(state: keyof typeof STATE_LABELS) {
  statusState.dataset.state = state;
  statusState.textContent = STATE_LABELS[state];
  motion.logoBusy(state === 'busy');
}

/** Renders the status bar as labelled data cells. Built with textContent, since file names are user input. */
function setSegments(segments: Segment[]) {
  statusText.replaceChildren(
    ...segments.map(([label, value, note]) => {
      const seg = document.createElement('span');
      seg.className = note ? 'seg note' : 'seg';
      const b = document.createElement('b');
      b.textContent = label;
      seg.append(b, document.createTextNode(value));
      return seg;
    }),
  );
}

const IDLE_SEGMENTS: Segment[] = [['Image', 'None loaded']];

/** A short message shown at the end of the status bar for a few seconds. */
let note: Segment | null = null;
let noteTimer = 0;

function notify(message: string, error = false) {
  clearTimeout(noteTimer);
  note = [error ? 'Err' : 'Preset', message, true];
  if (error) setState('error');
  if (last) updateStatus();
  else setSegments([note]);
  motion.enter(statusText.querySelector('.seg.note:last-child'));
  noteTimer = window.setTimeout(() => {
    note = null;
    if (last) {
      if (!busy) setState('ready');
      updateStatus();
    } else {
      if (error) setState('idle');
      setSegments(IDLE_SEGMENTS);
    }
  }, 3500);
}

function updateStatus() {
  if (!last) return;
  const method = methodLabel(last.params.method);
  const segments: Segment[] = [
    ['File', sourceName],
    ['Grid', `${last.width}×${last.height}`],
    last.kind === 'pixels' ? ['Pixel', `×${last.params.pixelSize}`] : ['Cells', last.count.toLocaleString()],
    ['Mode', method],
    ['Time', `${Math.round(last.ms)} ms`],
  ];
  if (crop && !cropping) {
    const { sw, sh } = srcRect();
    segments.splice(1, 0, ['Crop', `${sw}×${sh}`]);
  }
  if (last.kind === 'halftone' && last.cellSize > last.params.cellSize + 0.01) {
    segments.push(['!', `Spacing raised to ${last.cellSize.toFixed(1)} px`, true]);
  }
  if (note) segments.push(note);
  setSegments(segments);
  if (cropping) return updateCropTag();
  // Scramble the label when the method changes; size-only updates (e.g. while dragging) just swap the text.
  const tag = `${last.width} × ${last.height} — ${method}`;
  if (method !== tagMethod) motion.scrambleTo(frameTag, tag);
  else motion.setText(frameTag, tag);
  tagMethod = method;
}

setSegments(IDLE_SEGMENTS);

let resizeFrame = 0;
window.addEventListener('resize', () => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => present());
});

// ---- Crop -----------------------------------------------------------------
// The editor shows the whole (dithered) image with a box on top. Applying
// re-runs the dither on just the boxed region, so the working size is spent
// on the part you keep.

const overlay = new CropOverlay(cropLayer, frame, {
  ratio: () => currentRatio(),
  onChange: () => updateCropTag(),
});

/** Selected aspect as a ratio in normalised (0–1) image space, or null when free. */
function currentRatio(): number | null {
  if (!source) return null;
  const r = pixelRatio(cropUI.aspect, source.width, source.height);
  return r ? normRatio(r, source.width, source.height) : null;
}

function enterCrop() {
  if (!source || cropping) return;
  cropping = true;
  overlay.set(crop ?? FULL);
  cropLayer.hidden = false;
  motion.cropIn(cropLayer);
  updateCropPanel();
  updateCropTag();
  requestRender(); // the editor needs the uncropped image
}

/** Closes the editor; with `animate`, it fades out first. */
function closeCropEditor(animate: boolean) {
  const wasOpen = cropping;
  cropping = false;
  if (wasOpen && animate) {
    void motion.cropOut(cropLayer).then(() => {
      if (!cropping) cropLayer.hidden = true;
    });
  } else {
    cropLayer.hidden = true;
  }
  updateCropPanel();
}

function applyCrop() {
  if (!cropping) return;
  const r = overlay.rect;
  crop = isFull(r) ? null : { ...r };
  closeCropEditor(true);
  revealNext = true; // print the cropped result in
  requestRender();
  flushPendingExport();
}

function cancelCrop() {
  if (!cropping) return;
  pendingExport = null;
  closeCropEditor(true);
  requestRender();
}

/** Inside the editor: reset the box to the whole image. Outside: drop the applied crop. */
function removeCrop() {
  if (cropping) {
    cropUI.aspect = 'free';
    cAspect.updateDisplay();
    overlay.set(FULL);
    return;
  }
  if (!crop) return;
  crop = null;
  revealNext = true;
  updateCropPanel();
  requestRender();
}

function onAspectChange() {
  if (!cropping) return;
  const ratio = currentRatio();
  overlay.set(ratio ? fitRatio(ratio) : overlay.rect);
}

/** While editing, the frame label reads out the crop size in source pixels. */
function updateCropTag() {
  if (!cropping || !source) return;
  const r = overlay.rect;
  const w = Math.round(r.w * source.width);
  const h = Math.round(r.h * source.height);
  const aspect = cropUI.aspect === 'free' ? '' : ` · ${cropUI.aspect === 'original' ? 'original ratio' : cropUI.aspect}`;
  motion.setText(frameTag, `Crop ${w} × ${h}${aspect}`);
  tagMethod = ''; // re-scramble the method label once the crop is applied
}

function updateCropPanel() {
  cCropToggle.name(cropping ? 'Apply crop (↵)' : crop ? 'Edit crop… (C)' : 'Crop image… (C)');
  cCropToggle.enable(!!source);
  cAspect.show(cropping);
  cCropCancel.show(cropping);
  cCropReset.name(cropping ? 'Reset box' : 'Remove crop');
  cCropReset.enable(cropping || !!crop);
}

updateCropPanel();

// ---- Export ---------------------------------------------------------------

function fileStem() {
  return `${sourceName}-${last?.params.method ?? 'dither'}`;
}

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function fitsCanvas(w: number, h: number) {
  if (w <= MAX_SIDE && h <= MAX_SIDE && w * h <= MAX_AREA) return true;
  alert(`That export would be ${w}×${h} px, larger than a browser can draw. Lower the export scale or the working size.`);
  return false;
}

/** Exporting from the crop editor applies the crop first, then exports once the cropped render is in. */
function deferExportUntilCropped(kind: 'png' | 'svg'): boolean {
  if (!cropping) return false;
  pendingExport = kind;
  applyCrop();
  return true;
}

function flushPendingExport() {
  if (!pendingExport || busy || pending || !last || last.key !== workerKey()) return;
  const kind = pendingExport;
  pendingExport = null;
  if (kind === 'png') void exportPNG();
  else exportSVG();
}

async function exportPNG() {
  if (deferExportUntilCropped('png')) return;
  if (!last) return;
  const s = params.exportScale;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  if (last.kind === 'pixels') {
    const k = last.params.pixelSize * s;
    if (!fitsCanvas(last.width * k, last.height * k)) return;
    c.width = last.width * k;
    c.height = last.height * k;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(pixCanvas, 0, 0, c.width, c.height);
  } else {
    const W = Math.round(last.width * s);
    const H = Math.round(last.height * s);
    if (!fitsCanvas(W, H)) return;
    c.width = W;
    c.height = H;
    drawHalftone(ctx, getLayers(last), currentHex(), params.colorCount, params.transparent, last.params.angle, last.width, last.height, s);
  }
  const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, 'image/png'));
  if (blob) {
    download(blob, `${fileStem()}.png`);
    motion.shutter(frame);
  }
}

function exportSVG() {
  if (familyOf(params.method) === 'halftone' && deferExportUntilCropped('svg')) return;
  if (!last || last.kind !== 'halftone') return;
  const svg = halftoneSVG(getLayers(last), currentHex(), params.colorCount, params.transparent, last.params.angle, last.width, last.height, params.exportScale);
  download(new Blob([svg], { type: 'image/svg+xml' }), `${fileStem()}.svg`);
  motion.shutter(frame);
}

// ---- Presets & persistence ------------------------------------------------

/** Keeps only known keys with the right type; image-specific and momentary settings are dropped. */
function sanitize(input: unknown): Partial<Params> {
  const outp: Record<string, unknown> = {};
  if (!input || typeof input !== 'object') return outp;
  for (const k of Object.keys(DEFAULTS) as (keyof Params)[]) {
    if (k === 'workingSize' || k === 'showOriginal') continue;
    const v = (input as Record<string, unknown>)[k];
    if (v === undefined) continue;
    const allowed = ENUMS[k];
    if (allowed ? allowed.includes(v) : typeof v === typeof DEFAULTS[k]) outp[k] = v;
  }
  return outp as Partial<Params>;
}

function loadStoredParams(): Params {
  const base = { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) Object.assign(base, sanitize(JSON.parse(raw)));
  } catch {
    /* storage unavailable: use defaults */
  }
  return base;
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitize(params)));
  } catch {
    /* storage unavailable: settings just won't be remembered */
  }
}

function applyParams(input: unknown) {
  Object.assign(params, sanitize(input));
  refreshPanel();
}

// ---- Saved presets (browser storage) ---------------------------------------
// Stored per origin, so http://localhost:5173 keeps its own list. Use
// "Download all as JSON" to move presets to another port or the deployed site.

const PRESETS_KEY = 'raster-dither:presets:v1';
const MAX_NAME = 60;

interface SavedPreset {
  params: Partial<Params>;
  savedAt: string;
}
type PresetStore = Record<string, SavedPreset>;

/** Validates a store read from storage or from an imported file. */
function normalizeStore(data: unknown): PresetStore {
  const store: PresetStore = {};
  if (!data || typeof data !== 'object') return store;
  for (const [rawName, entry] of Object.entries(data as Record<string, unknown>)) {
    const name = rawName.trim().slice(0, MAX_NAME);
    const e = entry as Partial<SavedPreset> | null;
    if (!name || !e || typeof e !== 'object' || !e.params) continue;
    store[name] = {
      params: sanitize(e.params),
      savedAt: typeof e.savedAt === 'string' ? e.savedAt : new Date().toISOString(),
    };
  }
  return store;
}

function readPresets(): PresetStore {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    return raw ? normalizeStore(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

function writePresets(store: PresetStore): boolean {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(store));
    return true;
  } catch {
    notify('Could not save: browser storage is unavailable or full', true);
    return false;
  }
}

/** Rebuilds the "Saved" dropdown, optionally selecting `select`. */
function refreshPresetList(select?: string) {
  const names = Object.keys(readPresets()).sort((a, b) => a.localeCompare(b));
  const has = names.length > 0;
  cPresetList.options(has ? names : [NO_PRESETS]);
  if (select && names.includes(select)) presetUI.selected = select;
  else if (!names.includes(presetUI.selected)) presetUI.selected = has ? names[0] : NO_PRESETS;
  cPresetList.updateDisplay();
  cPresetList.enable(has);
  cLoadPreset.enable(has);
  cDeletePreset.enable(has);
}

function savePresetLocal() {
  const store = readPresets();
  let name = presetUI.name.trim().slice(0, MAX_NAME);
  if (!name) {
    let i = Object.keys(store).length + 1;
    do name = `Preset ${String(i++).padStart(2, '0')}`;
    while (store[name]);
  }
  if (store[name] && !confirm(`Replace the saved preset “${name}”?`)) return;
  store[name] = { params: sanitize(params), savedAt: new Date().toISOString() };
  if (!writePresets(store)) return;
  presetUI.name = '';
  cPresetName.updateDisplay();
  refreshPresetList(name);
  notify(`Saved “${name}”`);
}

function loadSelectedPreset() {
  const name = presetUI.selected;
  const entry = readPresets()[name];
  if (!entry) return;
  applyParams(entry.params);
  notify(`Loaded “${name}”`);
}

function deleteSelectedPreset() {
  const name = presetUI.selected;
  const store = readPresets();
  if (!store[name] || !confirm(`Delete the saved preset “${name}”?`)) return;
  delete store[name];
  if (!writePresets(store)) return;
  refreshPresetList();
  notify(`Deleted “${name}”`);
}

/** Downloads every saved preset; with none saved, downloads the current settings instead. */
function exportPresets() {
  const store = readPresets();
  const empty = Object.keys(store).length === 0;
  const data = empty
    ? { app: 'raster-dither', version: 1, params: sanitize(params) }
    : { app: 'raster-dither', version: 1, presets: store };
  download(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    empty ? 'raster-dither-preset.json' : 'raster-dither-presets.json',
  );
}

/**
 * Accepts either a bundle ({ presets: {...} }, merged into the list) or a
 * single preset ({ params }), which is applied and kept under the file name.
 */
async function loadPresetFile(file: File) {
  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch {
    return notify('That file is not valid JSON', true);
  }
  const obj = (json ?? {}) as { presets?: unknown; params?: unknown };

  if (obj.presets) {
    const incoming = normalizeStore(obj.presets);
    const names = Object.keys(incoming);
    if (!names.length) return notify('No presets found in that file', true);
    if (!writePresets({ ...readPresets(), ...incoming })) return;
    refreshPresetList(names[0]);
    return notify(`Imported ${names.length} preset${names.length === 1 ? '' : 's'}`);
  }

  const single = sanitize(obj.params ?? obj);
  if (!Object.keys(single).length) return notify('That file is not a Raster Dither preset', true);
  applyParams(single);
  const name = file.name.replace(/\.json$/i, '').trim().slice(0, MAX_NAME) || 'Imported';
  const store = readPresets();
  store[name] = { params: single, savedAt: new Date().toISOString() };
  if (writePresets(store)) refreshPresetList(name);
  notify(`Imported and loaded “${name}”`);
}

refreshPresetList();

presetInput.addEventListener('change', () => {
  const file = presetInput.files?.[0];
  presetInput.value = '';
  if (file) void loadPresetFile(file);
});

function randomise() {
  const r = (a: number, b: number, step = 0.01) => Math.round((a + Math.random() * (b - a)) / step) * step;
  const pick = <T>(arr: readonly T[]) => arr[Math.floor(Math.random() * arr.length)];
  Object.assign(params, {
    method: pick(Object.values(METHOD_OPTIONS)),
    pixelSize: pick([1, 1, 2, 2, 3, 4, 6]),
    brightness: r(-0.1, 0.1),
    contrast: r(-0.1, 0.5),
    gamma: r(0.7, 1.6),
    blur: pick([0, 0, 0, 1, 2]),
    sharpen: pick([0, 0, 0.5, 1]),
    invert: Math.random() < 0.1,
    threshold: r(0.4, 0.6),
    spread: r(0.6, 1.3),
    patternScale: pick([1, 1, 1, 2, 3, 4]),
    seed: Math.floor(r(1, 9999, 1)),
    strength: r(0.6, 1.05),
    serpentine: Math.random() < 0.7,
    shape: pick(Object.values(SHAPE_OPTIONS)),
    cellSize: r(4, 24, 0.5),
    angle: pick([0, 15, 22, 30, 45, 60, 75]),
    dotScale: r(0.85, 1.25),
    minDot: pick([0, 0, 0.05, 0.15]),
    jitter: pick([0, 0, 0, 0.1, 0.3]),
    mapping: Math.random() < 0.8 ? 'tonal' : 'nearest',
    palette: pick(Object.keys(PALETTES)),
  } satisfies Partial<Params>);
  applyPalette(params.palette);
  refreshPanel();
}

function resetParams() {
  const workingSize = params.workingSize;
  Object.assign(params, DEFAULTS, { workingSize });
  refreshPanel();
}

// ---- Keyboard -------------------------------------------------------------

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;

window.addEventListener('keydown', (e) => {
  if (isTyping(e.target)) return;
  const mod = e.metaKey || e.ctrlKey;
  if (e.code === 'Space' && !e.repeat) {
    e.preventDefault();
    showOriginal(true);
  } else if (mod && e.key.toLowerCase() === 's') {
    e.preventDefault();
    void exportPNG();
  } else if (mod && e.key.toLowerCase() === 'o') {
    e.preventDefault();
    fileInput.click();
  } else if (!mod && !e.altKey && e.key.toLowerCase() === 'c') {
    e.preventDefault();
    if (cropping) applyCrop();
    else enterCrop();
  } else if (cropping && e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
    e.preventDefault();
    applyCrop();
  } else if (cropping && e.key === 'Escape') {
    e.preventDefault();
    cancelCrop();
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') showOriginal(false);
});

// ---- Opening sequence -----------------------------------------------------

void motion.boot();

/** Reveals the controls sidebar (first image only). Resolves when the layout has settled. */
function showPanel(): Promise<void> {
  return motion.panelIn(gui.domElement, gui.folders.map((f) => f.domElement));
}
