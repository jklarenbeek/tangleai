/**
 * Apply the desktop's theme and language to a root element: shared by the
 * shell and a joined module page, and free of any transport.
 */

/** Set token values as custom properties on a root element, and the colour scheme. */
export function applyTheme(root: any, theme: { tokens: Record<string, string>, scheme?: 'light' | 'dark' }) {
  if (!root?.style) return;
  for (const [name, value] of Object.entries(theme.tokens)) {
    if (/^--[a-z0-9-]+$/.test(name)) root.style.setProperty(name, value);
  }
  // `data-theme` too: Jaren's component stylesheets follow it, so its Markdown, diagrams and charts turn with the desktop
  if (theme.scheme) { root.style.colorScheme = theme.scheme; if (root.dataset) { root.dataset.scheme = theme.scheme; root.dataset.theme = theme.scheme; } }
}

export function applyLocale(root: any, locale: { locale: string, dir: 'ltr' | 'rtl' }) {
  if (!root?.setAttribute) return;
  root.setAttribute('lang', locale.locale);
  root.setAttribute('dir', locale.dir);
}
