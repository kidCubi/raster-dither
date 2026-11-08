/** A built-in test image: tonal ramps, shaded spheres and a hue strip. */
export async function makeSample(): Promise<ImageBitmap> {
  const w = 1500;
  const h = 1000;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;

  const ramp = ctx.createLinearGradient(0, 0, w, 0);
  ramp.addColorStop(0, '#000');
  ramp.addColorStop(1, '#fff');
  ctx.fillStyle = ramp;
  ctx.fillRect(0, 0, w, h);

  const top = ctx.createLinearGradient(0, 0, w, 0);
  top.addColorStop(0, '#fff');
  top.addColorStop(1, '#000');
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, w, h * 0.1);

  for (const [cx, cy, r] of [
    [430, 520, 260],
    [980, 470, 190],
    [1270, 720, 120],
  ]) {
    const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.04, cx, cy, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.45, '#9a9a9a');
    g.addColorStop(1, '#0c0c0c');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const hue = ctx.createLinearGradient(0, 0, w, 0);
  for (let i = 0; i <= 6; i++) hue.addColorStop(i / 6, `hsl(${i * 60} 90% 55%)`);
  ctx.fillStyle = hue;
  ctx.fillRect(0, h * 0.9, w, h * 0.1);

  return createImageBitmap(c);
}
