/**
 * A theme is a document of token values: Jaren's host vocabulary (so every
 * Jaren component inside a window follows it) plus the desktop's own tokens.
 * Values are checked before they reach a style: a theme cannot carry a URL to
 * a foreign origin, a script or an `expression()`; appearance stays CSS.
 */
export type ThemeDocument = { $theme: '0.1', name: string, scheme: 'light' | 'dark', tokens: Record<string, string> };

const LIGHT: Record<string, string> = {
  '--bg': '#f4f5f8', '--fg': '#1b1d24', '--muted': '#5d6273', '--surface': '#ffffff', '--border': 'rgba(27, 29, 36, 0.12)',
  '--accent': '#5b5bd6', '--accent-fg': '#ffffff', '--accent-soft': 'rgba(91, 91, 214, 0.12)',
  '--ok': '#1f8a4c', '--ok-soft': 'rgba(31, 138, 76, 0.12)', '--fail': '#c93a3a', '--fail-soft': 'rgba(201, 58, 58, 0.12)', '--warn': '#b7791f', '--warn-soft': 'rgba(183, 121, 31, 0.14)',
  '--code-bg': '#f1f2f6', '--code-fg': '#1b1d24',
  '--radius': '12px', '--radius-sm': '8px',
  '--font': '"Inter", "Segoe UI", system-ui, -apple-system, "Noto Sans", "Noto Sans Arabic", "Noto Sans JP", "Noto Sans KR", "Noto Sans TC", sans-serif',
  '--mono': '"JetBrains Mono", "SFMono-Regular", ui-monospace, Menlo, Consolas, monospace',
  '--os-desktop': 'radial-gradient(120% 90% at 15% 10%, #c9d3ff 0%, #e8e3ff 38%, #f6e9f2 70%, #fdf3ea 100%)',
  '--os-window-bg': 'rgba(255, 255, 255, 0.86)', '--os-titlebar': 'rgba(255, 255, 255, 0.72)',
  '--os-glass': 'saturate(170%) blur(22px)', '--os-shadow': '0 24px 60px -18px rgba(29, 32, 64, 0.38), 0 2px 6px rgba(29, 32, 64, 0.08)',
  '--os-shadow-focus': '0 32px 80px -20px rgba(29, 32, 64, 0.5), 0 2px 8px rgba(29, 32, 64, 0.12)',
  '--os-dock-bg': 'rgba(255, 255, 255, 0.55)', '--os-radius-window': '14px',
};
const DARK: Record<string, string> = {
  ...LIGHT,
  '--bg': '#0f1117', '--fg': '#e8eaf2', '--muted': '#9aa0b4', '--surface': '#171a23', '--border': 'rgba(232, 234, 242, 0.1)',
  '--accent': '#8b8cff', '--accent-fg': '#0f1117', '--accent-soft': 'rgba(139, 140, 255, 0.16)',
  '--ok': '#4cc38a', '--fail': '#ff6b6b', '--warn': '#f0b04f',
  '--code-bg': '#1d212c', '--code-fg': '#e8eaf2',
  '--os-desktop': 'radial-gradient(120% 90% at 15% 10%, #2a2f6b 0%, #1b1f3d 40%, #14162a 70%, #0d0e18 100%)',
  '--os-window-bg': 'rgba(23, 26, 35, 0.86)', '--os-titlebar': 'rgba(30, 34, 46, 0.72)',
  '--os-shadow': '0 24px 60px -18px rgba(0, 0, 0, 0.7), 0 2px 6px rgba(0, 0, 0, 0.4)',
  '--os-shadow-focus': '0 32px 80px -20px rgba(0, 0, 0, 0.8), 0 2px 8px rgba(0, 0, 0, 0.5)',
  '--os-dock-bg': 'rgba(23, 26, 35, 0.55)',
};

export const DEFAULT_THEMES: Record<'light' | 'dark', ThemeDocument> = {
  light: { $theme: '0.1', name: 'Daylight', scheme: 'light', tokens: LIGHT },
  dark: { $theme: '0.1', name: 'Nightfall', scheme: 'dark', tokens: DARK },
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
