/**
 * A theme is a document of token values: Jaren's host vocabulary (so every
 * Jaren component inside a window follows it) plus the desktop's own tokens.
 * Values are checked before they reach a style: a theme cannot carry a URL to
 * a foreign origin, a script or an `expression()`; appearance stays CSS.
 */
export type ThemeDocument = { $theme: '0.1', name: string, scheme: 'light' | 'dark', tokens: Record<string, string> };

/** The previous gradient wallpapers, kept for people who chose them. */
export const AURORA = {
  light: 'radial-gradient(120% 90% at 15% 10%, #c9d3ff 0%, #e8e3ff 38%, #f6e9f2 70%, #fdf3ea 100%)',
  dark: 'radial-gradient(120% 90% at 15% 10%, #2a2f6b 0%, #1b1f3d 40%, #14162a 70%, #0d0e18 100%)',
};

/**
 * Fog and ink by day, night and thread by night. Teal is the thread colour and
 * the accent; magenta marks only the knots where threads cross.
 * `--os-desktop: weave` asks the shell to draw the woven-thread wallpaper from
 * `--os-ground-*`, `--os-thread-*` and `--os-knot`.
 */
const LIGHT: Record<string, string> = {
  '--bg': '#eef1f6', '--fg': '#161a2b', '--muted': '#596078', '--surface': '#ffffff', '--border': 'rgba(22, 26, 43, 0.12)',
  '--accent': '#0a6d67', '--accent-fg': '#ffffff', '--accent-soft': 'rgba(10, 109, 103, 0.12)', '--accent-hover': '#085a55',
  '--ok': '#186d3c', '--ok-soft': 'rgba(24, 109, 60, 0.12)', '--fail': '#ae2c43', '--fail-fg': '#ffffff', '--fail-soft': 'rgba(174, 44, 67, 0.12)', '--warn': '#86520c', '--warn-soft': 'rgba(134, 82, 12, 0.14)',
  '--code-bg': '#f2f4f8', '--code-fg': '#161a2b',
  '--radius': '12px', '--radius-sm': '8px',
  '--space-1': '.25rem', '--space-2': '.5rem', '--space-3': '.75rem', '--space-4': '1rem', '--space-5': '1.25rem', '--space-6': '1.5rem', '--space-8': '2rem', '--space-10': '2.5rem', '--space-14': '3.5rem',
  '--font': '"Inter", "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Noto Sans", "Noto Sans Arabic", "Noto Sans JP", "Noto Sans KR", "Noto Sans TC", sans-serif',
  '--mono': '"JetBrains Mono", "SFMono-Regular", ui-monospace, Menlo, Consolas, monospace',
  '--os-desktop': 'weave',
  '--os-ground-1': '#f6f8fb', '--os-ground-2': '#d6dfea',
  '--os-thread-1': '#0f9d94', '--os-thread-2': '#3e5a8c', '--os-thread-3': '#8c96b0', '--os-knot': '#c2367b',
  '--os-window-bg': 'rgba(255, 255, 255, 0.9)', '--os-titlebar': 'rgba(248, 250, 252, 0.8)',
  '--os-glass': 'saturate(160%) blur(24px)', '--os-shadow': '0 22px 56px -20px rgba(22, 26, 43, 0.34), 0 2px 6px rgba(22, 26, 43, 0.07)',
  '--os-shadow-focus': '0 34px 84px -22px rgba(22, 26, 43, 0.46), 0 2px 8px rgba(22, 26, 43, 0.1)',
  '--os-dock-bg': 'rgba(255, 255, 255, 0.62)', '--os-radius-window': '14px',
};
const DARK: Record<string, string> = {
  ...LIGHT,
  '--bg': '#0d1020', '--fg': '#e6e9f5', '--muted': '#98a0bc', '--surface': '#151a2e', '--border': 'rgba(230, 233, 245, 0.1)',
  '--accent': '#3cc8bd', '--accent-fg': '#05201d', '--accent-soft': 'rgba(60, 200, 189, 0.16)', '--accent-hover': '#5ad6cc',
  '--ok': '#4cc38a', '--ok-soft': 'rgba(76, 195, 138, 0.14)', '--fail': '#ff6b81', '--fail-fg': '#2a0710', '--fail-soft': 'rgba(255, 107, 129, 0.14)', '--warn': '#f0b04f', '--warn-soft': 'rgba(240, 176, 79, 0.14)',
  '--code-bg': '#1a2036', '--code-fg': '#e6e9f5',
  '--os-ground-1': '#1b2550', '--os-ground-2': '#080a16',
  '--os-thread-1': '#2bb7ac', '--os-thread-2': '#5b79c9', '--os-thread-3': '#39426a', '--os-knot': '#e0568f',
  '--os-window-bg': 'rgba(21, 26, 46, 0.9)', '--os-titlebar': 'rgba(27, 33, 58, 0.8)',
  '--os-shadow': '0 24px 60px -18px rgba(0, 0, 0, 0.72), 0 2px 6px rgba(0, 0, 0, 0.4)',
  '--os-shadow-focus': '0 34px 84px -20px rgba(0, 0, 0, 0.82), 0 2px 8px rgba(0, 0, 0, 0.5)',
  '--os-dock-bg': 'rgba(21, 26, 46, 0.62)',
};

export const DEFAULT_THEMES: Record<'light' | 'dark', ThemeDocument> = {
  light: { $theme: '0.1', name: 'Fog', scheme: 'light', tokens: LIGHT },
  dark: { $theme: '0.1', name: 'Night', scheme: 'dark', tokens: DARK },
};

const TOKEN = /^--[a-z][a-z0-9-]{0,63}$/;
const UNSAFE = /(expression\s*\(|javascript:|@import|<|>|\\|url\(\s*(?!['"]?data:image\/(?:png|jpeg|webp|gif|svg\+xml)[;,]))/i;

/** Check a theme's token values; returns the problems, empty when safe to apply. */
export function checkTheme(theme: ThemeDocument): string[] {
  const problems: string[] = [];
  if (theme?.$theme !== '0.1') problems.push('a theme document declares "$theme": "0.1"');
  if (theme?.scheme !== 'light' && theme?.scheme !== 'dark') problems.push('scheme must be light or dark');
  for (const [name, value] of Object.entries(theme?.tokens ?? {})) {
    if (!TOKEN.test(name)) problems.push(`${name}: not a custom property name`);
    else if (typeof value !== 'string' || value.length > 400) problems.push(`${name}: a value is a string of at most 400 characters`);
    else if (UNSAFE.test(value)) problems.push(`${name}: a value may not import, script or load from another origin`);
  }
  return problems;
}
