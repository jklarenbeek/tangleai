/**
 * Theme kits: each a complete look, as one JSON document — palettes for light
 * and dark, a procedural wallpaper, and a shape (corners, glass, spacing). A
 * person picks a kit and adjusts any part of it; the result is an ordinary
 * theme document, so it can be exported, shared and imported as text.
 */
import { DEFAULT_THEMES, checkTheme, type ThemeDocument } from './theme.ts';

export type Corners = 'sharp' | 'soft' | 'round';
export type Spacing = 'compact' | 'comfortable';
export type ThemeKit = {
  $themekit: '0.1';
  id: string;
  name: string;
  description: string;
  pattern: string;
  shape: { corners: Corners, glass: number, spacing: Spacing };
  light: Record<string, string>;
  dark: Record<string, string>;
};
/** What a person changed on top of a kit; every member is optional. */
export type ThemeCustom = Partial<{ accent: string, knot: string, pattern: string, seed: number, density: number, glass: number, corners: Corners, spacing: Spacing }>;

const kit = (id: string, name: string, description: string, pattern: string, shape: ThemeKit['shape'], light: Record<string, string>, dark: Record<string, string>): ThemeKit =>
  ({ $themekit: '0.1', id, name, description, pattern, shape, light, dark });

export const THEME_KITS: ThemeKit[] = [
  kit('loom', 'Loom', 'Threads woven across fog, with knots where they cross.', 'weave', { corners: 'soft', glass: 0.6, spacing: 'comfortable' }, {}, {}),
  kit('topograph', 'Topograph', 'A surveyor\'s sheet: contour lines of a landscape that is only yours.', 'contours', { corners: 'sharp', glass: 0.35, spacing: 'compact' },
    { '--bg': '#eaf0e8', '--accent': '#2d6959', '--accent-hover': '#235247', '--accent-soft': 'rgba(45, 105, 89, 0.12)', '--os-ground-1': '#f1f5ee', '--os-ground-2': '#cddbc9', '--os-thread-1': '#2f5d50', '--os-thread-2': '#6d8f80', '--os-thread-3': '#a7b9a8', '--os-knot': '#d9480f' },
    { '--bg': '#0f1714', '--surface': '#16211d', '--accent': '#6fd3a8', '--accent-fg': '#04140d', '--accent-hover': '#8be0bb', '--accent-soft': 'rgba(111, 211, 168, 0.15)', '--os-ground-1': '#1b2a24', '--os-ground-2': '#080e0b', '--os-thread-1': '#7fbf9f', '--os-thread-2': '#4c7a66', '--os-thread-3': '#2c4239', '--os-knot': '#ff8a4c', '--os-window-bg': 'rgba(22, 33, 29, 0.9)', '--os-titlebar': 'rgba(28, 41, 36, 0.8)', '--os-dock-bg': 'rgba(22, 33, 29, 0.62)' }),
  kit('risograph', 'Risograph', 'Two fluorescent inks printed a hair off register.', 'halftone', { corners: 'round', glass: 0.2, spacing: 'comfortable' },
    { '--bg': '#f3f1f7', '--accent': '#b81c5c', '--accent-hover': '#9a164c', '--accent-soft': 'rgba(184, 28, 92, 0.12)', '--os-ground-1': '#f8f6fb', '--os-ground-2': '#e2ddec', '--os-thread-1': '#ff3d8b', '--os-thread-2': '#3255a4', '--os-thread-3': '#9aa6cf', '--os-knot': '#ffb800' },
    { '--bg': '#120f22', '--surface': '#1a1630', '--accent': '#ff5fa2', '--accent-fg': '#25051a', '--accent-hover': '#ff86ba', '--accent-soft': 'rgba(255, 95, 162, 0.16)', '--os-ground-1': '#211a3d', '--os-ground-2': '#0a0816', '--os-thread-1': '#ff5fa2', '--os-thread-2': '#5f86ff', '--os-thread-3': '#3b3466', '--os-knot': '#ffd23f', '--os-window-bg': 'rgba(26, 22, 48, 0.9)', '--os-titlebar': 'rgba(33, 28, 60, 0.8)', '--os-dock-bg': 'rgba(26, 22, 48, 0.6)' }),
  kit('cyanotype', 'Cyanotype', 'Plants laid on blue paper and left in the sun.', 'sunprint', { corners: 'soft', glass: 0.5, spacing: 'comfortable' },
    { '--accent': '#1f5fa8', '--accent-hover': '#184c86', '--accent-soft': 'rgba(31, 95, 168, 0.12)', '--os-ground-1': '#2a5f9e', '--os-ground-2': '#123566', '--os-thread-1': '#ffffff', '--os-thread-2': '#d6e6ff', '--os-thread-3': '#9fc2f0', '--os-knot': '#ffd28a' },
    { '--bg': '#0b1630', '--surface': '#111f3d', '--accent': '#7fb2ff', '--accent-fg': '#061229', '--accent-hover': '#a1c6ff', '--accent-soft': 'rgba(127, 178, 255, 0.16)', '--os-ground-1': '#16376a', '--os-ground-2': '#050f24', '--os-thread-1': '#e8f1ff', '--os-thread-2': '#9fc2f0', '--os-thread-3': '#4d6fa3', '--os-knot': '#ffc46b', '--os-window-bg': 'rgba(17, 31, 61, 0.9)', '--os-titlebar': 'rgba(22, 40, 76, 0.8)', '--os-dock-bg': 'rgba(17, 31, 61, 0.6)' }),
  kit('tide', 'Tide', 'Two swells meeting, drawn as rings that interfere.', 'moire', { corners: 'round', glass: 0.75, spacing: 'comfortable' },
    { '--bg': '#ecf5f7', '--accent': '#1b6a85', '--accent-hover': '#15576d', '--accent-soft': 'rgba(27, 106, 133, 0.12)', '--os-ground-1': '#f2f9fb', '--os-ground-2': '#cbe1e9', '--os-thread-1': '#2a7f9e', '--os-thread-2': '#6a5acd', '--os-thread-3': '#9cc3d1', '--os-knot': '#ff6b5a' },
    { '--bg': '#07141b', '--surface': '#0d1f29', '--accent': '#5cc4e6', '--accent-fg': '#03161e', '--accent-hover': '#80d2ee', '--accent-soft': 'rgba(92, 196, 230, 0.15)', '--os-ground-1': '#0f2c3a', '--os-ground-2': '#03090d', '--os-thread-1': '#4fb3d9', '--os-thread-2': '#9c8cff', '--os-thread-3': '#24495a', '--os-knot': '#ff7d6e', '--os-window-bg': 'rgba(13, 31, 41, 0.88)', '--os-titlebar': 'rgba(17, 40, 53, 0.78)', '--os-dock-bg': 'rgba(13, 31, 41, 0.58)' }),
];

const HEX = /^#[0-9a-f]{6}$/i;
const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const alpha = (hex: string, a: number) => `rgba(${rgb(hex).join(', ')}, ${a})`;
const shade = (hex: string, f: number) => `#${rgb(hex).map(c => Math.max(0, Math.min(255, Math.round(c * f))).toString(16).padStart(2, '0')).join('')}`;
const luminance = (c: number[]) => { const [r, g, b] = c.map(x => { const v = x / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a: number[], b: number[]) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const hexOf = (c: number[]) => `#${c.map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('')}`;
/** Text on an accent: whichever of a dark ink and white reads better on it. */
const onAccent = (hex: string) => contrast(rgb(hex), rgb('#0b1020')) > contrast(rgb(hex), [255, 255, 255]) ? '#0b1020' : '#ffffff';
/**
 * A person's accent as the scheme can read it: the chosen colour when it reads
 * at 4.5:1 as text on the theme's surface and background, and on its own soft
 * tint over them; otherwise the same hue moved toward white (dark) or black
 * (light), only as far as it takes.
 */
function readableAccent(hex: string, scheme: 'light' | 'dark', tokens: Record<string, string>): string {
  const grounds = [tokens['--surface'], tokens['--bg']].filter(g => HEX.test(g ?? '')).map(rgb);
  const soft = scheme === 'dark' ? 0.16 : 0.12, target = scheme === 'dark' ? 255 : 0;
  const reads = (c: number[]) => grounds.every(g => contrast(c, g) >= 4.5 && contrast(c, c.map((x, i) => x * soft + g[i] * (1 - soft))) >= 4.5);
  const chosen = rgb(hex);
  for (let step = 0; step <= 25; step++) {
    const c = chosen.map(x => x + (target - x) * step * 0.04);
    if (reads(c)) return step === 0 ? hex : hexOf(c);
  }
  return hexOf(chosen.map(() => target));
}

const RADII: Record<Corners, [string, string, string]> = { sharp: ['4px', '3px', '6px'], soft: ['12px', '8px', '14px'], round: ['18px', '12px', '22px'] };

/** The theme document for a kit, a scheme and a person's changes. Invalid changes are ignored, never applied. */
export function composeTheme(kitId: string, scheme: 'light' | 'dark', custom: ThemeCustom = {}): ThemeDocument {
  const chosen = THEME_KITS.find(k => k.id === kitId) ?? THEME_KITS[0];
  const base = DEFAULT_THEMES[scheme];
  const corners = custom.corners ?? chosen.shape.corners;
  const glass = Math.max(0, Math.min(1, custom.glass ?? chosen.shape.glass));
  const spacing = custom.spacing ?? chosen.shape.spacing;
  const [radius, radiusSm, radiusWindow] = RADII[corners] ?? RADII.soft;
  const tokens: Record<string, string> = { ...base.tokens, ...chosen[scheme] };
  // glass: from nearly opaque to clear; the blur follows
  const windowRgb = (tokens['--os-window-bg'].match(/\d+(\.\d+)?/g) ?? ['255', '255', '255']).slice(0, 3).join(', ');
  const titleRgb = (tokens['--os-titlebar'].match(/\d+(\.\d+)?/g) ?? ['255', '255', '255']).slice(0, 3).join(', ');
  Object.assign(tokens, {
    '--radius': radius, '--radius-sm': radiusSm, '--os-radius-window': radiusWindow,
    '--os-window-bg': `rgba(${windowRgb}, ${(0.97 - glass * 0.22).toFixed(2)})`,
    '--os-titlebar': `rgba(${titleRgb}, ${(0.92 - glass * 0.3).toFixed(2)})`,
    '--os-glass': `saturate(${Math.round(100 + glass * 80)}%) blur(${Math.round(4 + glass * 26)}px)`,
    '--os-titlebar-height': spacing === 'compact' ? '34px' : '42px',
    '--os-dock-size': spacing === 'compact' ? '40px' : '46px',
    '--os-desktop': custom.pattern && custom.pattern !== '' ? custom.pattern : chosen.pattern,
    '--os-pattern-seed': String(Number.isInteger(custom.seed) ? custom.seed : 7),
    '--os-pattern-density': String(typeof custom.density === 'number' ? Math.max(0.3, Math.min(2, custom.density)) : 1),
  });
  if (custom.accent && HEX.test(custom.accent)) {
    const a = readableAccent(custom.accent, scheme, tokens);
    Object.assign(tokens, { '--accent': a, '--accent-fg': onAccent(a), '--accent-hover': shade(a, scheme === 'dark' ? 1.12 : 0.86), '--accent-soft': alpha(a, scheme === 'dark' ? 0.16 : 0.12) });
  }
  if (custom.knot && HEX.test(custom.knot)) tokens['--os-knot'] = custom.knot;
  const theme: ThemeDocument = { $theme: '0.1', name: chosen.name, scheme, tokens };
  return checkTheme(theme).length ? base : theme;
}
