# Raster Dither

A small browser tool that turns a picture into a 1-bit (or 2–4 colour) dithered image. Every setting is live: tweak it in the panel and the preview redraws.

## Run it

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
```

## What it does

- **Load** an image with the button, by drag-and-drop, or by pasting. There is also a built-in sample (tone ramps and shaded spheres) for testing.
- **Image:** working size, pixel size (chunkier pixels), brightness, contrast, gamma, blur, sharpen, invert.
- **Dither methods**
  - *Ordered / threshold:* plain threshold, Bayer 2×2 to 16×16, clustered dot, blue noise, white noise, line and diagonal screens. Controls: threshold, pattern strength, pattern scale.
  - *Error diffusion:* Floyd–Steinberg, Atkinson, Jarvis–Judice–Ninke, Stucki, Burkes, Sierra, Two-row Sierra, Sierra Lite. Controls: error strength, serpentine scan.
  - *Halftone:* circle, square, diamond, ellipse, line or cross on a rotated grid. Controls: spacing, angle, dot scale, dropping tiny dots, jitter.
- **Palette:** 2, 3 or 4 colours, with presets.
  - *Tonal* mapping splits brightness into even steps, from the first colour (darkest) to the last (paper).
  - *Nearest colour* matches the real colours of the picture.
  - The paper colour can be made transparent.
- **Crop:** press C or use "Crop image…" in the panel. The editor shows the whole image with a box: drag it, use the 8 handles, or drag outside it to draw a new one.
  - Aspect ratios: Free, Original, 1:1, 4:5, 5:4, 3:2, 2:3, 16:9 and 9:16.
  - Applying (Enter, or C again) re-dithers just the cropped region, so the working size is spent on the part you keep. Esc cancels.
  - Exporting from inside the editor applies the crop first.
  - The crop belongs to the image and is not saved in presets.
- **Export:** PNG at 1–8× scale. Halftone also exports as SVG.
- **Presets:** save the current settings under a name. They are kept in the browser's local storage for this address (e.g. `http://localhost:5173`), and you can pick, load or delete them from the panel.
  - "Download all as JSON" and "Import JSON…" move presets to another browser, port or the deployed site.
  - Your last settings are also remembered automatically.
- **Keys:** hold Space to compare with the original · C crops (Enter applies, Esc cancels) · ⌘/Ctrl+S exports a PNG · ⌘/Ctrl+O opens an image.

## How it is built

Vite and plain TypeScript, with [lil-gui](https://lil-gui.georgealways.com/) for the panel and [GSAP](https://gsap.com/) for motion (`src/motion.ts`; it respects the OS reduced-motion setting). All processing runs on the CPU in a Web Worker (`src/worker.ts`), so the interface stays responsive. The code lives in `src/dither/`, and `src/render.ts` draws the result.
