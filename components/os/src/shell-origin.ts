/** The origin rule for framed applications, apart from the DOM shell so a headless check can use it. */

/**
 * Why an application page may not be framed as an origin module, or null.
 * A page on the desktop's own origin would be framed with that origin's
 * rights and could read the desktop's storage and keys (all project sites of
 * one GitHub Pages account share an origin), so it is refused.
 */
export function originHostProblem(url: string, desktopOrigin: string | undefined): string | null {
  let target: URL;
  try { target = new URL(url); } catch { return `'${url}' is not a URL`; }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') return `'${url}' is not an http(s) page`;
  if (desktopOrigin && target.origin === desktopOrigin) return `'${url}' shares the desktop's origin; an application must be served from its own origin`;
  return null;
}
