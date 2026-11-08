import type { RGB } from './types';

/** Colours are listed darkest (ink / shadows) first, lightest (paper) last. */
export const PALETTES: Record<string, string[]> = {
  'Ink & paper': ['#141414', '#f2eee3'],
  'Pure black & white': ['#000000', '#ffffff'],
  'Riso blue': ['#1f3fbf', '#f4efe1'],
  'Riso red': ['#c8243a', '#f7f1e5'],
  'Navy & fluoro pink': ['#16213e', '#ff5d9e'],
  'Amber terminal': ['#1a0e00', '#ffb000'],
  'Green phosphor': ['#03170a', '#3cff7a'],
  Blueprint: ['#0d2a5c', '#dbe8ff'],
  'Sepia (3)': ['#2a1c12', '#8a6748', '#efe1c6'],
  'Riso duo (3)': ['#1b1b3a', '#e4572e', '#f3eee0'],
  'Moss (4)': ['#1b2b1a', '#3f5d33', '#8ea85b', '#d8e4aa'],
  'Cool grey (4)': ['#101418', '#4b5661', '#9ba6af', '#eef1f3'],
  'Dusk (4)': ['#2b1b3d', '#a83a57', '#ee8159', '#ffd88a'],
  'Ocean (4)': ['#0b1d2e', '#1f5f7a', '#5fb3b3', '#e8f4ef'],
};

export function hexToRgb(hex: string): RGB {
  let h = hex.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.replace(/./g, (c) => c + c);
  const n = /^[0-9a-f]{6}$/i.test(h) ? parseInt(h, 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
}

export function mixHex(a: string, b: string, t: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
}
