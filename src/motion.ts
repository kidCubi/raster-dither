/**
 * Motion for Raster Dither, built on GSAP.
 *
 * The style matches the ink-and-paper look: short, precise, eased out, with no
 * bounce. Everything collapses to instant changes when the OS asks for
 * reduced motion.
 */
import { gsap } from 'gsap';
import { SplitText } from 'gsap/SplitText';
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin';

gsap.registerPlugin(SplitText, ScrambleTextPlugin);
gsap.defaults({ ease: 'expo.out' });

const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const reduced = () => reducedQuery.matches;
/** Duration helper: 0 when reduced motion is on, so timelines jump to their end. */
const d = (seconds: number) => (reduced() ? 0 : seconds);

const SCRAMBLE_CHARS = '0123456789×—·';

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel);
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll<T>(sel)];

// ---- Boot sequence --------------------------------------------------------

/**
 * Hides everything that the boot sequence will bring in, before the first
 * paint. Call it synchronously at startup, then call boot().
 */
export function prepareBoot() {
  if (reduced()) return;
  gsap.set(['#masthead', '.intro'], { autoAlpha: 0 });
}

/** Waits for the web fonts (so SplitText measures real glyphs), but never longer than `ms`. */
function fontsReady(ms = 1200): Promise<void> {
  return Promise.race([document.fonts.ready.then(() => undefined), new Promise<void>((r) => setTimeout(r, ms))]);
}

/** Opening sequence: logo dots, wordmark, then the intro. (The sidebar waits for the first image.) */
export async function boot() {
  await fontsReady();
  if (reduced()) {
    gsap.set(['#masthead', '.intro'], { autoAlpha: 1 });
    return;
  }
  const tl = gsap.timeline();
  tl.set('#masthead', { autoAlpha: 1 });

  // Logo: dots appear in random order, like a matrix display powering on.
  tl.from($$('.mark circle'), {
    scale: 0,
    transformOrigin: '50% 50%',
    duration: 0.5,
    stagger: { each: 0.018, from: 'random' },
  }, 0);
  tl.from(['.wordmark', '.meta'], { autoAlpha: 0, y: -6, duration: 0.7, stagger: 0.08 }, 0.15);

  const intro = $('.intro');
  if (intro && !$('#empty')?.hidden) {
    tl.set(intro, { autoAlpha: 1 }, 0.25);

    // Mono labels start blank and scramble in (the intro is still hidden here).
    const scrambleIn = (el: HTMLElement, at: number, chars = SCRAMBLE_CHARS) => {
      const text = el.textContent ?? '';
      el.textContent = '';
      tl.to(el, { duration: 0.8, scrambleText: { text, chars, speed: 0.5 } }, at);
    };

    const eyebrow = $('.eyebrow', intro);
    if (eyebrow) scrambleIn(eyebrow, 0.25);

    // Title: each letter rises out of its own mask.
    const h1 = $('h1', intro);
    if (h1) {
      const split = SplitText.create(h1, { type: 'chars', mask: 'chars' });
      tl.from(split.chars, { yPercent: 110, duration: 1.1, stagger: 0.028 }, 0.3);
    }

    tl.from($('.lede', intro), { autoAlpha: 0, y: 10, duration: 0.9 }, 0.6);

    // Steps wipe in left to right: text and hairline together.
    tl.fromTo(
      $$('.steps li', intro),
      { clipPath: 'inset(0% 100% 0% 0%)' },
      { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.9, ease: 'power3.inOut', stagger: 0.09, clearProps: 'clipPath' },
      0.65,
    );
    $$('.steps li span', intro).forEach((num, i) => scrambleIn(num, 0.75 + i * 0.09, '0123456789'));

    tl.from($$('.actions button', intro), { autoAlpha: 0, y: 10, duration: 0.8, stagger: 0.07 }, 0.95);
    tl.from($('.hint', intro), { autoAlpha: 0, duration: 0.8 }, 1.1);
  }
}

/** Fades the intro away before the first image appears. Resolves when done. */
export function introOut(): Promise<void> {
  return new Promise((resolve) => {
    const items = $$('.intro > *');
    gsap.killTweensOf(items);
    gsap.to(items, {
      autoAlpha: 0,
      y: -12,
      duration: d(0.4),
      ease: 'power2.in',
      stagger: d(0.035),
      onComplete: resolve,
    });
  });
}

// ---- Sidebar --------------------------------------------------------------

const MOBILE = '(max-width: 760px)';

/**
 * Brings the controls in once there is an image to control. The page makes
 * room by tweening `--gui-w`, so the masthead, stage and status bar all move
 * with the sidebar. The sidebar slides in, then its sections cascade in.
 * Resolves when the layout has settled.
 */
export function panelIn(panel: HTMLElement, sections: HTMLElement[]): Promise<void> {
  const body = document.body;
  body.classList.add('has-panel'); // CSS sets the final --gui-w (380px, or 0 on phones)
  if (reduced()) return Promise.resolve();

  const target = getComputedStyle(body).getPropertyValue('--gui-w').trim() || '0px';
  const mobile = window.matchMedia(MOBILE).matches;
  return new Promise((resolve) => {
    const tl = gsap.timeline({
      onComplete: () => {
        body.style.removeProperty('--gui-w'); // hand control back to the stylesheet
        resolve();
      },
    });
    tl.fromTo(body, { '--gui-w': '0px' }, { '--gui-w': target, duration: 0.9, ease: 'expo.inOut' }, 0);
    tl.fromTo(
      panel,
      mobile ? { yPercent: 100 } : { xPercent: 100 },
      { xPercent: 0, yPercent: 0, duration: 0.9, ease: 'expo.inOut', clearProps: 'transform' },
      0,
    );
    tl.fromTo(
      sections,
      { autoAlpha: 0, x: 24 },
      { autoAlpha: 1, x: 0, duration: 0.8, stagger: 0.06, clearProps: 'transform' },
      0.35,
    );
  });
}

// ---- Output frame ---------------------------------------------------------

/** Keeps a new image hidden until its reveal plays, so it never flashes in early. */
export function prepareReveal(frame: HTMLElement, canvas: HTMLElement) {
  if (reduced()) return;
  gsap.set(frame, { autoAlpha: 0 }); // outline and label too, until the layout has settled
  gsap.set(canvas, { clipPath: 'inset(0% 0% 100% 0%)' });
  gsap.set($$('.tick', frame), { autoAlpha: 0 });
}

function ensureChild(frame: HTMLElement, className: string): HTMLElement {
  let el = $(`.${className}`, frame);
  if (!el) {
    el = document.createElement('div');
    el.className = className;
    el.setAttribute('aria-hidden', 'true');
    frame.append(el);
  }
  return el;
}

/** Inward starting offsets for the four corner ticks (tl, tr, bl, br). */
const TICK_IN = [
  [8, 8],
  [-8, 8],
  [8, -8],
  [-8, -8],
];

/** "Print pass": a scan line sweeps down and the image is revealed behind it. */
export function revealFrame(frame: HTMLElement, canvas: HTMLElement) {
  const scan = ensureChild(frame, 'scanline');
  const ticks = $$('.tick', frame);
  gsap.killTweensOf([canvas, scan, ...ticks]);
  gsap.set(frame, { autoAlpha: 1 });
  if (reduced()) {
    gsap.set(canvas, { clearProps: 'clipPath' });
    gsap.set(ticks, { clearProps: 'all' });
    return;
  }
  const tl = gsap.timeline();
  tl.fromTo(
    canvas,
    { clipPath: 'inset(0% 0% 100% 0%)' },
    { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.1, ease: 'power3.inOut', clearProps: 'clipPath' },
    0,
  );
  tl.fromTo(scan, { top: '0%', autoAlpha: 1 }, { top: '100%', duration: 1.1, ease: 'power3.inOut' }, 0);
  tl.to(scan, { autoAlpha: 0, duration: 0.25, ease: 'power1.out' });
  tl.fromTo(
    ticks,
    { autoAlpha: 0, x: (i: number) => TICK_IN[i][0], y: (i: number) => TICK_IN[i][1] },
    { autoAlpha: 1, x: 0, y: 0, duration: 0.8, stagger: 0.05 },
    0.15,
  );
}

/** Animates the frame to a new size (zoom changes). Without `animate`, jumps there. */
export function sizeFrame(frame: HTMLElement, w: number, h: number, animate: boolean) {
  gsap.killTweensOf(frame, 'width,height');
  if (animate && !reduced() && !frame.hidden) {
    gsap.to(frame, { width: w, height: h, duration: 0.6, ease: 'expo.inOut' });
  } else {
    gsap.set(frame, { width: w, height: h });
  }
}

/** Camera-shutter flash on export, with the corner ticks briefly opening. */
export function shutter(frame: HTMLElement) {
  if (reduced()) return;
  const flash = ensureChild(frame, 'flash');
  const ticks = $$('.tick', frame);
  gsap.fromTo(flash, { autoAlpha: 0.9 }, { autoAlpha: 0, duration: 0.7, ease: 'power2.out' });
  gsap.fromTo(
    ticks,
    { x: 0, y: 0 },
    {
      x: (i: number) => -TICK_IN[i][0] / 2,
      y: (i: number) => -TICK_IN[i][1] / 2,
      duration: 0.16,
      ease: 'power2.out',
      yoyo: true,
      repeat: 1,
    },
  );
}

/** Before/after compare: the original wipes across from the left, then back out. */
export function compare(orig: HTMLCanvasElement, on: boolean, onHidden: () => void) {
  gsap.killTweensOf(orig);
  if (reduced()) {
    gsap.set(orig, { clearProps: 'clipPath' });
    if (!on) onHidden();
    return;
  }
  if (on) {
    gsap.fromTo(
      orig,
      { clipPath: 'inset(0% 100% 0% 0%)' },
      { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.45, ease: 'expo.out' },
    );
  } else {
    gsap.to(orig, {
      clipPath: 'inset(0% 0% 0% 100%)',
      duration: 0.35,
      ease: 'expo.out',
      onComplete: () => {
        gsap.set(orig, { clearProps: 'clipPath' });
        onHidden();
      },
    });
  }
}

/** Crop editor appears: the wash fades in, then the handles pop in around the box. */
export function cropIn(layer: HTMLElement) {
  const handles = $$('.h', layer);
  gsap.killTweensOf([layer, ...handles]);
  if (reduced()) {
    gsap.set(layer, { autoAlpha: 1 });
    gsap.set(handles, { clearProps: 'transform' });
    return;
  }
  gsap.fromTo(layer, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.35, ease: 'power2.out' });
  gsap.fromTo(handles, { scale: 0 }, { scale: 1, duration: 0.45, stagger: 0.025, delay: 0.1, clearProps: 'transform' });
}

/** Crop editor leaves. Resolves when it has faded out. */
export function cropOut(layer: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    gsap.killTweensOf(layer);
    gsap.to(layer, { autoAlpha: 0, duration: d(0.25), ease: 'power2.in', onComplete: resolve });
  });
}

// ---- Text -----------------------------------------------------------------

/** Swaps a mono label, scrambling through digits on the way. */
export function scrambleTo(el: HTMLElement, text: string) {
  gsap.killTweensOf(el);
  if (reduced() || !el.textContent) {
    el.textContent = text;
    return;
  }
  gsap.to(el, { duration: 0.6, scrambleText: { text, chars: SCRAMBLE_CHARS, speed: 0.6 } });
}

/** Sets a label instantly, cancelling any scramble in progress. */
export function setText(el: HTMLElement, text: string) {
  gsap.killTweensOf(el);
  el.textContent = text;
}

/** Slides a freshly added status cell into place. */
export function enter(el: Element | null) {
  if (!el || reduced()) return;
  gsap.from(el, { autoAlpha: 0, x: -8, duration: 0.5 });
}

/** Panel section that just appeared (e.g. after switching dither method). */
export function revealSection(el: HTMLElement) {
  if (reduced()) return;
  gsap.killTweensOf(el);
  gsap.fromTo(el, { autoAlpha: 0, y: -6 }, { autoAlpha: 1, y: 0, duration: 0.5, clearProps: 'transform' });
}

// ---- Logo "thinking" ------------------------------------------------------

let busyDelay: gsap.core.Tween | null = null;
let busyTween: gsap.core.Tween | null = null;

function logoDots(): SVGCircleElement[] {
  const dots = $$<SVGCircleElement>('.mark circle');
  for (const c of dots) c.dataset.r ??= c.getAttribute('r') ?? '1';
  return dots;
}

/**
 * While the worker runs, the logo's dot matrix flickers like a display
 * computing. It waits 150 ms first, so quick renders don't make it twitch.
 */
export function logoBusy(on: boolean) {
  if (reduced()) return;
  const dots = logoDots();
  if (on) {
    if (busyDelay || busyTween) return;
    busyDelay = gsap.delayedCall(0.15, () => {
      busyDelay = null;
      busyTween = gsap.to(dots, {
        attr: { r: () => gsap.utils.random([0.4, 1.1, 1.6]) },
        duration: 0.12,
        ease: 'steps(1)',
        stagger: { each: 0.006, from: 'random' },
        repeat: -1,
        repeatRefresh: true,
      });
    });
  } else {
    busyDelay?.kill();
    busyDelay = null;
    if (!busyTween) return;
    busyTween.kill();
    busyTween = null;
    gsap.to(dots, {
      attr: { r: (_i: number, el: SVGCircleElement) => Number(el.dataset.r) },
      duration: 0.4,
      ease: 'power2.out',
      stagger: { each: 0.01, from: 'center' },
    });
  }
}
