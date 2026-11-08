# AGENTS.md: Raster Dither

A browser tool that dithers an uploaded picture to 1-bit or 2–4 colours, with a lil-gui control panel. It is a static site: Vite and plain TypeScript, no framework.

## Commands

- `npm run dev`: local dev server
- `npm run typecheck`: `tsc`, must pass clean
- `npm run build`: type-check, then build the static site into `dist/`

## Layout

- `src/main.ts`: control panel, image loading, render scheduling, zoom, export, presets
- `src/worker.ts`: runs a dither job off the main thread
- `src/dither/`: the pure algorithms, with no DOM (`preprocess`, `ordered`, `matrices`, `diffusion`, `halftone`, `rng`)
- `src/render.ts`: turns results into pixels, canvas paths and SVG
- `src/types.ts`: the `Params` shape, defaults, method lists, and the worker message types
- `src/crop.ts`: crop rectangle geometry (pure functions) and `CropOverlay`, the on-canvas editor
- `src/motion.ts`: all GSAP animation

## Conventions

- Palette colours run darkest → lightest. The last colour is the paper / background.
- A setting that only changes drawing (colours in tonal mode, halftone shape, dot scale, zoom) must not re-run the worker. Add it to `DRAW_ONLY` in `main.ts`.
- New settings go in `Params` and `DEFAULTS` in `types.ts`. `sanitize()` in `main.ts` then accepts them in presets and in local storage automatically. Enum-like values also need an entry in `ENUMS`. Keep `ENUMS` near the top of `main.ts`: `sanitize()` already runs at startup.
- Local storage keys: `raster-dither:v1` holds the last settings. `raster-dither:presets:v1` holds the named presets, as `{ [name]: { params, savedAt } }`. Storage is per address, so a new port or the deployed site starts with an empty list.
- Panel-only state (such as the presets and crop sections) must not live in `params`. The root `gui.onChange` ignores changes from other objects.
- Crop rectangles are normalised (0–1) to the source image, so they survive zoom, working-size and pixel-size changes. The crop is applied to the source **before** dithering (`srcRect()` in `main.ts`), and it is part of `workerKey()`. While the editor is open (`cropping`), the preview renders the whole image. The crop is image state: it resets on a new image and is never stored in presets or local storage.

## Visual style

Ink and paper: ultra-minimal and technical, after Dieter Rams, Apple and Nothing. Every element has to earn its place.

- The colour tokens are on `:root` in `src/style.css`.
  - `--paper` background and `--ink` text.
  - `--ink-2` and `--ink-3` for secondary and tertiary text.
  - `--hair` and `--hair-strong` for the 1px rules and input outlines.
  - `--signal` red, used **only** for the "processing" dot and for errors. No other accent colours.
- Type: one size, `--fs: 18px`, everywhere. The start-screen title is the only exception. Geist (`--sans`) for text, sentence case with slightly tight tracking on titles. Geist Mono (`--mono`) for numbers, codes and readouts. Both load from Google Fonts in `index.html`.
- Shapes: 1px borders only, with no shadows or gradients. **No border radius anywhere.** The only round things are dots: the slider handles, the status dot and the logo.
- Slider handles: a 16px ink circle drawn in lil-gui's reserved knob space (`--slider-knob-width`), so the handle stays inside the track at both ends.
- The sidebar is hidden, and takes no width, until the first image loads. `:root` has `--gui-w: 0px`, and `body.has-panel` sets it to 380px (0 on phones, where the panel docks at the bottom). `motion.panelIn()` adds the class and tweens `--gui-w`, so the masthead, stage and status bar make room together.
- The 380px width is set twice, in `body.has-panel { --gui-w }` in `style.css` and in `new GUI({ width })` in `main.ts`. Keep them equal.
- Motifs: numbered panel sections (`01 Image`, `02.A …`), a dot-grid background, corner registration ticks on the output, the dot-matrix logo, and a status bar of labelled mono cells.
- The lil-gui theme lives at the end of `style.css`. lil-gui inserts its own CSS before the first stylesheet, so plain overrides win. Where lil-gui sets a `background` shorthand (for example, slider hover), override with the full shorthand.

## Motion

All animation is GSAP, kept in `src/motion.ts`. `main.ts` only calls named moments (`boot`, `introOut`, `panelIn`, `prepareReveal` / `revealFrame`, `sizeFrame`, `compare`, `shutter`, `cropIn` / `cropOut`, `logoBusy`, `scrambleTo`, `revealSection`, `enter`).

- First image: `introOut` and `panelIn` run together. The image reveal waits for both (`introGone`) and re-fits the frame first, because the stage shrinks while the sidebar slides in.

- Character: precise and quiet. Ease with `expo.out` or `power3.inOut`, 0.4–1.1 s, never bouncy or elastic. Motion explains state (loading, printing, comparing, exporting); it never decorates.
- Every function must respect `prefers-reduced-motion` through the `reduced()` / `d()` helpers. Never run an infinite tween when reduced motion is on.
- Never animate on every render. Parameter tweaks must stay instant. Reveals play only for a new image, and label scrambles play only when the method changes.
- `prepareBoot()` hides the elements the boot sequence animates, synchronously, before first paint. Anything new added to the boot needs the same treatment.

## Rules

- Never commit and never push (the owner's global rule; nothing here overrides it). Staging and read-only git commands are fine. Hand over the exact `git add` / `git commit` / `git push` commands for the owner to run.
- Deploy later with the Vercel or Netlify command-line tools from a local `dist/`, which needs no git remote.
